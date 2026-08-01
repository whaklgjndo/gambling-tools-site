// ==UserScript==
// @name         Shuffle Mines — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.38
// @description  Standalone single-tool build, extracted from the unified bundle.
// @author       .
// @match        https://shuffle.com/*
// @match        https://shuffle.us/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Desktop/Shuffle/Mines.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Desktop/Shuffle/Mines.user.js
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cShuffle Mines — Desktop — standalone build v3.38', 'color:#17c7b8;font-weight:800;font-size:13px');

    /* =========================================================
       UNIFIED LOADER — STORAGE KEYS & SETTINGS
       --------------------------------------------------------
       Settings layout: { [toolId]: boolean } stored as JSON in
       localStorage under SETTINGS_KEY. Missing entries fall back
       to tool.defaultEnabled (defaults to true).
       ========================================================= */

    const SETTINGS_KEY    = '__stake_nuts_unified_tools_v1__';
    const PANEL_POS_KEY   = '__stake_nuts_unified_panel_pos_v1__';
    const PANEL_OPEN_KEY  = '__stake_nuts_unified_panel_open_v1__';
    // Where the user dragged the floating cluster (gear + quick-toggle chips).
    // Declared up here with the other keys, not down beside the drag code, so
    // nothing can read it before it exists.
    const FLOAT_POS_KEY   = '__stake_nuts_unified_float_pos_v1__';
    const VISIBILITY_STYLE_ID = 'unified-tools-visibility-css';

    /** Read tool-enable settings from localStorage. */
    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch { return {}; }
    }
    /** Persist tool-enable settings to localStorage. */
    function saveSettings(s) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
    }
    let settings = loadSettings();

    /** True when the user has the tool enabled (or defaultEnabled if never set). */
    function isEnabled(tool) {
        if (Object.prototype.hasOwnProperty.call(settings, tool.id)) return !!settings[tool.id];
        return tool.defaultEnabled !== false;
    }
    /** Look up a tool by id and check its enabled state. Used by tool
     *  bodies (Stake/Shuffle IOW/Smart, Nuts IOW/Smart) to gate runtime
     *  behavior per-URL without needing the tool object passed in. */
    function isToolIdEnabled(toolId) {
        const tool = TOOLS.find(t => t.id === toolId);
        if (!tool) return true;
        return isEnabled(tool);
    }
    /** Save the user's enable/disable choice. */
    function setEnabled(toolId, enabled) {
        settings[toolId] = !!enabled;
        saveSettings(settings);
    }

    /* =========================================================
       URL MATCHING
       Mirrors Tampermonkey's `*` wildcard (matches any chars).
       Each tool's regex list is compiled lazily and cached on
       tool._matcher.
       ========================================================= */

    function makePatternMatcher(patterns) {
        const regexes = patterns.map(p => {
            let re = '';
            for (const ch of p) {
                if (ch === '*') re += '.*';
                else if ('.+?^${}()|[]\\'.indexOf(ch) !== -1) re += '\\' + ch;
                else re += ch;
            }
            return new RegExp('^' + re + '$');
        });
        return url => regexes.some(r => r.test(url));
    }

    function urlMatches(tool, url) {
        if (!tool._matcher) tool._matcher = makePatternMatcher(tool.matches);
        return tool._matcher(url);
    }

    /** True when at least one of the tool's match patterns covers the current
     *  hostname (regardless of path). Used to scope URL-mismatch CSS so a
     *  tool for site A doesn't accidentally hide site B's UI that shares an
     *  element id (e.g. stake-mines and nuts-mines both use #mines-auto-gui). */
    function isToolOnThisSite(tool) {
        if (!tool._domainMatcher) {
            // Strip everything after the host: https://stake.us/casino/games/dice*
            // becomes https://stake.us/*. Handles subdomain wildcards like
            // https://*.nuts.gg/* by keeping them intact (the matcher knows *).
            const domainPatterns = tool.matches.map(p => {
                const m = String(p).match(/^(https?:\/\/[^/]+)\//);
                return m ? m[1] + '/*' : p;
            });
            tool._domainMatcher = makePatternMatcher(domainPatterns);
        }
        return tool._domainMatcher('https://' + location.hostname + '/');
    }

    /* =========================================================
       TOOL EXECUTION
       --------------------------------------------------------
       Once a tool's URL matches, its body runs exactly once and
       stays loaded for the lifetime of the page. The enable
       toggle does NOT re-gate execution — disabled tools just
       have their UI hidden via `applyToolVisibility` below. This
       means re-enabling is instant: no remount, no replay.

       Exception: tools with hijacksPage:true (IOW/Smart, Nuts
       IOW/Smart) re-parent the site's native bet panel into
       their own HUD. Hiding that container with display:none
       would also hide the relocated bet panel and brick the
       page. For those tools the disable gate is enforced at
       run time and toggles trigger a page reload — see
       buildPanel() in the Control Panel section.
       ========================================================= */

    /** Run a tool body, swallowing exceptions so one bad tool doesn't kill the rest. */
    function safeRun(tool) {
        try {
            tool._fn();
            tool._ran = true;
        } catch (e) {
            console.error('[UnifiedTools] error running ' + tool.id + ':', e);
        }
    }

    /** Execute a tool if it matches the current URL and is in the right boot phase. */
    function maybeRun(tool, phase) {
        if (tool._ran) return;
        if (tool.runAt !== phase) return;
        if (!urlMatches(tool, location.href)) return;
        if (tool.hijacksPage && !isEnabled(tool)) return;
        safeRun(tool);
    }

    /* =========================================================
       PER-TOOL UI VISIBILITY
       --------------------------------------------------------
       Disabled tools aren't unloaded — we just inject a CSS
       rule that hides every selector listed in tool.uiSelectors
       when <html> carries the tool's "disabled" class. Toggling
       back on removes the class instantly.

       Skipped for hijacksPage tools (see TOOL EXECUTION above).
       ========================================================= */

    /** Build the per-tool disabled-class name (sanitized for CSS). */
    function disabledClass(toolId) {
        return 'uts-disabled-' + toolId.replace(/[^a-z0-9_-]/gi, '-');
    }

    /** Build the per-tool URL-mismatch class name. Applied when the user has
     *  SPA-navigated away from a tool's matched game URL — hides the tool's UI
     *  so its overlay doesn't sit on top of an unrelated page. */
    function urlMismatchClass(toolId) {
        return 'uts-url-mismatch-' + toolId.replace(/[^a-z0-9_-]/gi, '-');
    }

    /** Inject the visibility stylesheet. Idempotent; safe to call repeatedly. */
    function injectVisibilityCss() {
        if (document.getElementById(VISIBILITY_STYLE_ID)) return;
        // Wait for <head> to exist — at document-start it might not yet.
        if (!document.head && !document.documentElement) return;
        const HIDE_PROPS = ' { display: none !important; visibility: hidden !important; pointer-events: none !important; }';
        const css = TOOLS
            .filter(t => Array.isArray(t.uiSelectors) && t.uiSelectors.length)
            .map(t => {
                const disSel = t.uiSelectors.map(s => 'html.' + disabledClass(t.id) + ' ' + s).join(',\n');
                const urlSel = t.uiSelectors.map(s => 'html.' + urlMismatchClass(t.id) + ' ' + s).join(',\n');
                return disSel + HIDE_PROPS + '\n' + urlSel + HIDE_PROPS;
            }).join('\n');
        const style = document.createElement('style');
        style.id = VISIBILITY_STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    /** Toggle disabled + url-mismatch classes for a single tool based on
     *  current enable state and URL. Hides the tool's UI when:
     *   - the tool is disabled via the control panel, OR
     *   - the user is on the tool's site but SPA-navigated off the tool's
     *     matched game URL (e.g. moved from /mines to the lobby). */
    function applyToolVisibility(tool) {
        if (!tool || !tool.id) return;
        // hijacksPage tools manage their own visibility via the run gate +
        // page reload. Skipping here avoids the case where hiding the HUD
        // container would also hide the native bet panel relocated inside.
        if (tool.hijacksPage) return;
        const disCls = disabledClass(tool.id);
        const urlCls = urlMismatchClass(tool.id);
        const root = document.documentElement;
        if (!root) return;
        const onSameSite = isToolOnThisSite(tool);
        const onMatchingUrl = urlMatches(tool, location.href);
        // Disabled class: only on matching URL when tool is disabled. Several
        // tools share UI element IDs across sites (e.g. stake-keno and
        // nuts-keno both build #keno-preset-gui; stake-mines and nuts-mines
        // both build #mines-auto-gui) — applying the disable class
        // unconditionally would hide a different site's UI by mistake.
        if (onMatchingUrl && !isEnabled(tool)) {
            root.classList.add(disCls);
        } else {
            root.classList.remove(disCls);
        }
        // URL-mismatch class: applied only when we're on the tool's SITE but
        // off its matched game URL — so it hides the tool's UI after SPA nav
        // away from the game. CRITICAL: skip the class entirely when we're on
        // a different site, otherwise nuts-mines's url-mismatch rule would
        // hide #mines-auto-gui (used by both stake-mines and nuts-mines)
        // while the user is sitting on stake.com/mines.
        if (Array.isArray(tool.uiSelectors) && tool.uiSelectors.length) {
            if (onSameSite && !onMatchingUrl) {
                root.classList.add(urlCls);
            } else {
                root.classList.remove(urlCls);
            }
        }
    }

    /** Refresh visibility for every registered tool. */
    function applyAllVisibility() {
        injectVisibilityCss();
        for (const t of TOOLS) applyToolVisibility(t);
    }

    /* =========================================================
       PER-TOOL QUICK-TOGGLE BUTTONS
       --------------------------------------------------------
       A small floating chip pinned to the bottom-left (above the
       ⚙ control panel button) on every URL that a non-autovault
       tool matches. One click toggles that tool's enabled state.

       The button stays visible whether the tool is enabled or
       disabled — so after disabling, the user still has a way to
       re-enable without opening the control panel.

       Autovault tools are excluded by design: they have no
       game-specific URL ("home") so there's no natural place to
       anchor their quick toggle. Disable/enable them via the ⚙
       control panel instead.
       ========================================================= */

    const QUICK_TOGGLE_STYLE_ID = 'unified-tools-quick-toggle-css';
    // Tools managed only from the control-panel gear — no bottom-left quick-toggle
    // chip (the account-wide auto-vaults and the always-on 7-day wager tracker).
    const NO_QUICK_TOGGLE_IDS = new Set(['stake-autovault', 'shuffle-autovault', 'nuts-autovault', 'stake-7day-tracker']);

    function injectQuickToggleCss() {
        if (document.getElementById(QUICK_TOGGLE_STYLE_ID)) return;
        if (!document.head && !document.documentElement) return;
        const style = document.createElement('style');
        style.id = QUICK_TOGGLE_STYLE_ID;
        style.textContent = `
            .uts-quick-toggle {
                position: fixed;
                left: 64px;
                z-index: 2147483645;
                padding: 7px 14px;
                border-radius: 18px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                border: 1px solid;
                transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
                user-select: none;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                letter-spacing: 0.3px;
                white-space: nowrap;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                /* The chip is a drag handle; on a touchscreen, touch-action
                   manipulation scrolls the page instead of giving us
                   pointermove. (No backticks in here — this block is inside a
                   template literal.) */
                touch-action: none;
            }
            .uts-quick-toggle.on {
                background: linear-gradient(135deg, #10b981, #059669);
                color: #ffffff;
                border-color: rgba(16, 185, 129, 0.7);
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
            }
            .uts-quick-toggle.off {
                background: linear-gradient(135deg, #1f2937, #0f172a);
                color: #94a3b8;
                border-color: rgba(148, 163, 184, 0.3);
            }
            .uts-quick-toggle:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
            }
            .uts-quick-toggle .uts-qt-dot {
                width: 8px; height: 8px; border-radius: 50%;
                flex: 0 0 auto;
            }
            .uts-quick-toggle.on .uts-qt-dot {
                background: #ffffff; box-shadow: 0 0 6px rgba(255, 255, 255, 0.7);
            }
            .uts-quick-toggle.off .uts-qt-dot {
                background: #475569;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
    }

    /* ---- Draggable floating cluster (gear + quick-toggle chips) -------------
       Both were pinned to the bottom-left corner with no way to move them, and
       that corner is where the dice tool's own controls sit — the chips landed
       on top of Build Strategy with nothing the user could do about it. Hold and
       drag any member now and the WHOLE cluster moves together, so the chips
       keep their relation to the gear; the position is clamped to the viewport
       and remembered across loads. A press only becomes a drag once the pointer
       has travelled CLUSTER_DRAG_SLOP px, and the click the browser fires at the
       end of a drag is swallowed for a moment — without that, dragging the Dice
       chip out of the way would toggle the tool off. Until the cluster is dragged
       for the first time nothing is written inline, so the CSS defaults stand.
       Kept byte-identical in intent to the mobile bundle so the two behave the
       same way. */
    const CLUSTER_GEAR_SIZE  = 38;   // gear diameter, matches PANEL_CSS
    const CLUSTER_CHIP_GAP   = 44;   // first chip clears the gear
    const CLUSTER_CHIP_STEP  = 36;   // vertical pitch of the stacked chips
    const CLUSTER_CHIP_INSET = 48;   // chips sit this far right of the gear's left edge
    const CLUSTER_DRAG_SLOP  = 6;
    let clusterDragUntil = 0;        // clicks before this instant are drag artefacts

    function loadFloatPos() {
        try {
            const p = JSON.parse(localStorage.getItem(FLOAT_POS_KEY) || 'null');
            return (p && typeof p.left === 'number' && typeof p.bottom === 'number') ? p : null;
        } catch { return null; }
    }
    function saveFloatPos(left, bottom) {
        try { localStorage.setItem(FLOAT_POS_KEY, JSON.stringify({ left, bottom })); } catch {}
    }
    /** Keep the whole stack on screen — its height grows with the chip count. */
    function clampFloatPos(left, bottom) {
        const chips = document.querySelectorAll('.uts-quick-toggle').length;
        const width = CLUSTER_CHIP_INSET + 130;
        const height = chips
            ? CLUSTER_CHIP_GAP + chips * CLUSTER_CHIP_STEP
            : CLUSTER_GEAR_SIZE;
        return {
            left: Math.max(0, Math.min(Math.max(0, window.innerWidth - width), left)),
            bottom: Math.max(0, Math.min(Math.max(0, window.innerHeight - height), bottom))
        };
    }
    /** Paint the saved position onto the gear and every chip. No-op until the
     *  cluster has actually been dragged, so the default CSS corner stands. */
    function applyFloatPos() {
        const saved = loadFloatPos();
        if (!saved) return;
        const pos = clampFloatPos(saved.left, saved.bottom);
        const gear = document.getElementById(PANEL_TOGGLE_ID);
        if (gear) {
            gear.style.left = pos.left + 'px';
            gear.style.bottom = pos.bottom + 'px';
        }
        document.querySelectorAll('.uts-quick-toggle').forEach(chip => {
            const idx = parseInt(chip.dataset.qtIndex || '0', 10);
            chip.style.left = (pos.left + CLUSTER_CHIP_INSET) + 'px';
            chip.style.bottom = (pos.bottom + CLUSTER_CHIP_GAP + idx * CLUSTER_CHIP_STEP) + 'px';
        });
    }
    /** Turn one cluster member into a drag handle for the whole cluster. */
    function makeClusterDraggable(el) {
        if (!el || el.dataset.clusterDrag === '1') return;
        el.dataset.clusterDrag = '1';
        let pid = null, sx = 0, sy = 0, left0 = 0, bottom0 = 0, moved = false;
        el.addEventListener('pointerdown', (e) => {
            if (!e.isPrimary) return;
            pid = e.pointerId; moved = false;
            sx = e.clientX; sy = e.clientY;
            // Measure the GEAR, never the handle: the chips are offset from it,
            // and dragging a chip must not snap the cluster onto the chip.
            const anchor = document.getElementById(PANEL_TOGGLE_ID) || el;
            const r = anchor.getBoundingClientRect();
            left0 = r.left;
            bottom0 = window.innerHeight - r.bottom;
            try { el.setPointerCapture(pid); } catch (err) {}
        });
        el.addEventListener('pointermove', (e) => {
            if (pid === null || e.pointerId !== pid) return;
            const ddx = e.clientX - sx, ddy = e.clientY - sy;
            if (!moved && Math.abs(ddx) < CLUSTER_DRAG_SLOP && Math.abs(ddy) < CLUSTER_DRAG_SLOP) return;
            moved = true;
            e.preventDefault();
            const pos = clampFloatPos(left0 + ddx, bottom0 - ddy);   // y is inverted: bottom-anchored
            saveFloatPos(pos.left, pos.bottom);
            applyFloatPos();
        });
        const endDrag = () => {
            if (pid === null) return;
            try { el.releasePointerCapture(pid); } catch (err) {}
            pid = null;
            if (moved) clusterDragUntil = Date.now() + 350;
        };
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);
    }
    /** True while the click being handled is really the tail of a drag. */
    function swallowedByDrag() {
        return Date.now() < clusterDragUntil;
    }
    let clusterReflowBound = false;
    function bindClusterReflow() {
        if (clusterReflowBound) return;
        clusterReflowBound = true;
        // Resizing the window can leave a dragged cluster off screen.
        window.addEventListener('resize', applyFloatPos);
    }

    /** Build a short, user-friendly label for the quick-toggle button —
     *  strips site prefix so the chip stays compact. With the {Site} {Game}
     *  naming convention, "Stake Dice" → "Dice", "Nuts Limbo/Target" →
     *  "Limbo/Target", "Shuffle Dice" → "Dice". */
    function quickToggleLabel(tool) {
        return (tool.name || tool.id)
            .replace(/^Stake\/Shuffle\s+/i, '')
            .replace(/^Stake\.gg\s+/i, '')
            .replace(/^Stake\s+/i, '')
            .replace(/^Shuffle\s+/i, '')
            .replace(/^Nuts\.gg\s+/i, '')
            .replace(/^Nuts\s+/i, '')
            .replace(/\s*\(.*\)$/i, '');
    }

    /** (Re)create the quick-toggle buttons for every non-autovault tool that
     *  matches the current URL. Removes stale buttons when the URL no longer
     *  matches. Idempotent — safe to call on every SPA navigation tick. */
    function applyQuickToggles() {
        injectQuickToggleCss();
        if (!document.body) return;
        const matching = TOOLS.filter(t =>
            !NO_QUICK_TOGGLE_IDS.has(t.id) && urlMatches(t, location.href)
        );
        const seen = new Set();
        matching.forEach((tool, idx) => {
            const btnId = 'uts-quick-toggle-' + tool.id;
            seen.add(btnId);
            let btn = document.getElementById(btnId);
            if (!btn) {
                btn = document.createElement('button');
                btn.id = btnId;
                btn.className = 'uts-quick-toggle';
                btn.innerHTML = '<span class="uts-qt-dot"></span><span class="uts-qt-label"></span>';
                btn.addEventListener('click', () => {
                    if (swallowedByDrag()) return;   // this "click" ended a drag
                    quickToggleClick(tool);
                });
                makeClusterDraggable(btn);
                document.body.appendChild(btn);
            }
            // Stack above the ⚙ control panel button (bottom: 16px, ~38px tall).
            // applyFloatPos() overrides both edges once the cluster is dragged.
            btn.dataset.qtIndex = String(idx);
            btn.style.bottom = (16 + 44 + idx * 36) + 'px';
            const enabled = isEnabled(tool);
            btn.classList.toggle('on', enabled);
            btn.classList.toggle('off', !enabled);
            const label = btn.querySelector('.uts-qt-label');
            if (label) label.textContent = quickToggleLabel(tool);
            btn.title = (enabled ? 'Click to disable: ' : 'Click to enable: ') + (tool.name || tool.id);
        });
        // Tear down buttons whose tool no longer matches the URL.
        document.querySelectorAll('.uts-quick-toggle').forEach(b => {
            if (!seen.has(b.id)) b.remove();
        });
        // Re-seat the cluster: the chip count just changed, which changes both
        // the stack height the clamp works from and every chip's offset.
        applyFloatPos();
        bindClusterReflow();
    }

    /** Click handler for a quick-toggle button. Mirrors the control-panel
     *  switch handler: flips state, refreshes visibility, syncs the panel
     *  switch if open, and triggers a reload only for hijacksPage tools or
     *  when enabling a tool that hasn't initialized yet. */
    function quickToggleClick(tool) {
        const newState = !isEnabled(tool);
        setEnabled(tool.id, newState);
        applyToolVisibility(tool);
        applyQuickToggles();
        // Sync the matching control-panel switch if the panel is open.
        document.querySelectorAll('[data-switch="' + tool.id + '"]').forEach(el => {
            el.classList.toggle('on', newState);
        });
        // hijacksPage tools always reload — their HUD owns relocated native
        // page DOM that can't be hidden in place (matches control-panel behavior).
        if (tool.hijacksPage && urlMatches(tool, location.href)) {
            location.reload();
            return;
        }
        // Enabling a tool that didn't initialize on this page → reload so its
        // setup phases (document-start / document-end body) get a clean run.
        if (newState && urlMatches(tool, location.href) && !tool._ran) {
            location.reload();
        }
    }

    /* =========================================================
       TOOL REGISTRY
       The TOOLS array holds every tool's definition + body.
       Use register(definition, fn) to add a tool — see the
       "Tool Registry — Definitions" section near the bottom.
       ========================================================= */
    const TOOLS = [];

    /**
     * Add a tool to the registry.
     * @param {Object} definition - id, name, description, matches, runAt, defaultEnabled, group, uiSelectors, hijacksPage
     * @param {Function} fn - the tool's body function (one of the tool_xxx functions below)
     */
    function register(definition, fn) {
        definition._fn = fn;
        TOOLS.push(definition);
    }

    /* === source: shuffle-mines-desktop.user.js ===
       Auto-plays Mines on Shuffle with weighted random tile picks. Mirrors
       the Stake Mines logic, with Shuffle-specific selectors and a purple
       theme to match the site. */
    function tool_shuffle_mines() {
        'use strict';
        let isRunning = false;
        let runUrl = null; // URL captured when bot starts; bail if it changes
        // 15 ms gives ~66 readiness checks per second — matches Stake's bot.
        // Shuffle's React updates aren't synchronous, so faster polling than
        // this doesn't surface state changes any sooner, it just spins CPU.
        const POLL_INTERVAL_MS = 15;
        // Short pause after cashout so the multiplier popup is visible before
        // the next round starts. Lower = faster cycle time, less readable.
        const POST_WIN_PAUSE_MS = 150;
        const onMinesPage = () => /\/games\/originals\/mines/i.test(location.pathname);
        const urlChanged = () => runUrl !== null && location.pathname !== runUrl;

        const gui = document.createElement('div');
        gui.id = 'mines-auto-gui';
        gui.style.cssText = `
            position: fixed; top: 20px; right: 20px; z-index: 999999;
            background: linear-gradient(180deg, rgba(20, 8, 38, 0.96) 0%, rgba(12, 6, 28, 0.96) 100%);
            color: #e9d5ff; padding: 14px;
            border-radius: 12px; border: 1px solid rgba(168, 85, 247, 0.3);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            min-width: 240px; box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(168, 85, 247, 0.15);
            cursor: move; user-select: none; transition: box-shadow 0.3s ease;
        `;
        gui.innerHTML = `
            <div style="font-weight: 700; margin-bottom: 10px; text-align: center; color: #fff; font-size: 13px; letter-spacing: 0.4px;">
                Shuffle Mines
            </div>
            <div style="display: flex; align-items: center; margin: 6px 0;">
                <label style="flex: 1; color: #c4b5fd; font-size: 12px; font-weight: 600;">Min:</label>
                <input id="minPicks" type="number" value="3" min="1" max="24" style="width: 64px; padding: 5px 6px; border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; background: rgba(0,0,0,0.4); color: #fff; font-weight: 600; text-align: center; outline: none;">
            </div>
            <div style="display: flex; align-items: center; margin: 6px 0;">
                <label style="flex: 1; color: #c4b5fd; font-size: 12px; font-weight: 600;">Max:</label>
                <input id="maxPicks" type="number" value="8" min="1" max="24" style="width: 64px; padding: 5px 6px; border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 4px; background: rgba(0,0,0,0.4); color: #fff; font-weight: 600; text-align: center; outline: none;">
            </div>
            <div style="margin: 12px 0 6px; text-align: center; display: flex; gap: 8px; justify-content: center;">
                <button id="btnStart" style="flex: 1; background: linear-gradient(135deg, #a855f7, #7c3aed); color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-weight: 800; cursor: pointer; transition: all 0.18s; font-size: 12px; letter-spacing: 0.4px; text-transform: uppercase; box-shadow: 0 0 12px rgba(168, 85, 247, 0.3);">
                    Start
                </button>
                <button id="btnStop" style="flex: 1; background: #ef4444; color: #fff; border: none; padding: 7px 14px; border-radius: 6px; font-weight: 800; cursor: pointer; display: none; transition: all 0.18s; font-size: 12px; letter-spacing: 0.4px; text-transform: uppercase;">
                    Stop
                </button>
            </div>
            <div id="status" style="font-size: 11px; color: #c4b5fd; text-align: center; min-height: 1.2em; margin-top: 4px;"></div>
            <div style="margin-top: 12px; border-top: 1px solid rgba(168, 85, 247, 0.2); padding-top: 10px;">
                <div style="font-weight: 700; margin-bottom: 6px; text-align: center; color: #a855f7; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">
                    Live Stats
                </div>
                <p style="margin: 4px 0; font-size: 12px; display: flex; justify-content: space-between;"><span style="color: #c4b5fd;">Multiplier:</span><span id="mult" style="font-weight: 700; color: #fff;">—</span></p>
                <p style="margin: 4px 0; font-size: 12px; display: flex; justify-content: space-between;"><span style="color: #c4b5fd;">Payout:</span><span id="pout" style="font-weight: 700; color: #fff;">—</span></p>
                <p style="margin: 4px 0; font-size: 12px; display: flex; justify-content: space-between;"><span style="color: #c4b5fd;">Next Gem:</span><span id="chance" style="font-weight: 700; color: #fff;">—</span></p>
            </div>
            <div style="margin-top: 8px; border-top: 1px solid rgba(168, 85, 247, 0.2); padding-top: 10px;">
                <div style="font-weight: 700; margin-bottom: 6px; text-align: center; color: #a855f7; font-size: 11px; text-transform: uppercase; letter-spacing: 0.6px;">
                    Projected Range
                </div>
                <p style="margin: 4px 0; font-size: 12px; display: flex; justify-content: space-between;"><span style="color: #c4b5fd;">Min Mult:</span><span id="minMult" style="font-weight: 700; color: #a855f7;">—</span></p>
                <p style="margin: 4px 0; font-size: 12px; display: flex; justify-content: space-between;"><span style="color: #c4b5fd;">Max Mult:</span><span id="maxMult" style="font-weight: 700; color: #a855f7;">—</span></p>
                <p style="margin: 4px 0; font-size: 12px; display: flex; justify-content: space-between;"><span style="color: #c4b5fd;">Min Payout:</span><span id="minPayout" style="font-weight: 700; color: #a855f7;">—</span></p>
                <p style="margin: 4px 0; font-size: 12px; display: flex; justify-content: space-between;"><span style="color: #c4b5fd;">Max Payout:</span><span id="maxPayout" style="font-weight: 700; color: #a855f7;">—</span></p>
            </div>
        `;
        document.body.appendChild(gui);

        // Drag
        let isDragging = false, currentX, currentY, initialX, initialY;
        gui.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL') return;
            initialX = e.clientX - currentX; initialY = e.clientY - currentY;
            isDragging = true;
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            currentX = e.clientX - initialX; currentY = e.clientY - initialY;
            gui.style.left = currentX + 'px'; gui.style.top = currentY + 'px';
            gui.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });
        currentX = window.innerWidth - gui.offsetWidth - 30; currentY = 40;
        gui.style.left = currentX + 'px'; gui.style.top = currentY + 'px';

        const btnStart = document.getElementById('btnStart');
        const btnStop = document.getElementById('btnStop');
        const status = document.getElementById('status');
        function setStatus(txt, color = '#c4b5fd') { status.textContent = txt; status.style.color = color; }

        async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
        async function waitFor(predicate, timeoutMs) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                if (!isRunning) return false;
                try { if (predicate()) return true; } catch (e) {}
                await delay(POLL_INTERVAL_MS);
            }
            return false;
        }

        // ---- Shuffle Mines selectors ----
        // Shuffle's UI behavior, observed on the live page:
        //   - Between rounds: button[data-testid="bet-button"] exists with
        //     text "Play".
        //   - Mid-round: the bet-button is REMOVED from the DOM entirely.
        //     A "REDEEM <amount> <currency>" button replaces it (this is
        //     the cashout). The button has no data-testid.
        //   - Tile state isn't stored in a class — it's in the inline
        //     `background-color` style. Unrevealed tiles use a specific
        //     dark grey; revealed tiles get a colored bg (yellow for gem,
        //     red-ish for bomb). We treat any tile whose inline bg is the
        //     dark grey as still-clickable.
        //   - Bust detection: after clicking a tile, if the round ENDS
        //     (Play button reappears) without us pressing Redeem, we
        //     busted on that pick. Otherwise it was a safe gem.
        const TILE_IDLE_BG = 'rgb(32, 35, 41)';
        function isPlayReady() {
            const el = document.querySelector('button[data-testid="bet-button"]');
            if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            return /^play$/i.test((el.textContent || '').trim());
        }
        function clickPlay() {
            if (!isPlayReady()) return false;
            document.querySelector('button[data-testid="bet-button"]').click();
            return true;
        }
        function findCashoutButton() {
            // The mid-round "REDEEM 200.00 GC" button. Exclude the "Redeem
            // Code" menu item (which is a user-menu entry, not a cashout).
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                if (!b.offsetParent || b.disabled) continue;
                const t = (b.textContent || '').trim();
                if (/^redeem\b/i.test(t) && /\d/.test(t) && !/code/i.test(t)) return b;
            }
            return null;
        }
        function isCashoutReady() { return !!findCashoutButton(); }
        function isTileIdle(tile) {
            // Inline-style bg color is the discriminator; computed style is
            // identical between idle/revealed because Shuffle drives the
            // reveal animation via JS-set inline styles.
            return (tile.style.backgroundColor || '') === TILE_IDLE_BG;
        }
        function getIdleTiles() {
            return Array.from(document.querySelectorAll('button[class*="MinesGameTileWrapper_root"]'))
                .filter(isTileIdle);
        }
        // Batch-pick: fire all clicks in one synchronous burst, then wait
        // for either every requested tile to reveal OR the round to end on
        // a bust. Verified live: Shuffle accepts and processes rapid clicks
        // (7 clicks fired in ~3 ms, full settle in ~275 ms including bust
        // detection — ~10× faster than the per-pick serial approach).
        //
        // Round-state detection after the burst:
        //   - idle tiles == 0  → bust (Shuffle reveals every tile on bust,
        //     regardless of which one was the mine; this is the only fully
        //     reliable bust signal because the Play button can come back
        //     disabled when the user runs out of balance — making
        //     isPlayReady misclassify a bust as "still mid-round")
        //   - idle tiles >  0  AND our N picks landed → safe; cashout
        //     button should be available
        async function batchPickTiles(picks) {
            const idle = getIdleTiles();
            if (idle.length === 0) return { ok: false, busted: false, fired: 0 };
            const n = Math.min(picks, idle.length);
            const revealedBefore = 25 - idle.length;
            const arr = idle.slice();
            for (let i = arr.length - 1; i > arr.length - 1 - n; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            arr.slice(arr.length - n).forEach(t => t.click());
            await waitFor(() => {
                const idleNow = getIdleTiles().length;
                if (idleNow === 0) return true; // bust — all tiles revealed
                return (25 - idleNow) >= revealedBefore + n; // our picks landed
            }, 3000);
            const busted = getIdleTiles().length === 0;
            if (!busted) {
                // Safe path — give the cashout button a brief window to settle
                // into a clickable state before the caller invokes it.
                await waitFor(findCashoutButton, 500);
            }
            return { ok: true, busted, fired: n };
        }
        function getMinesCount() {
            // Shuffle's mines selector has no testid. DOM shape (observed):
            //   <div class="FormControlWrapper_root… Select_formWrapper…">
            //     <div class="LabelBlock_root…"><label>Mines</label></div>
            //     <div><select> with options 1..N </select></div>
            //     <button class="Select_button…">CURRENT_VALUE</button>
            //   </div>
            // Match by walking from the Mines LABEL up to FormControlWrapper.
            // The select holds the canonical value. (Mid-round Shuffle hides
            // the dropdown, but the underlying form element stays mounted.)
            const labels = document.querySelectorAll('label');
            for (const lbl of labels) {
                if (!/^mines$/i.test((lbl.textContent || '').trim())) continue;
                const wrap = lbl.closest('[class*="FormControlWrapper"], [class*="Select_formWrapper"]');
                if (!wrap) continue;
                const sel = wrap.querySelector('select');
                if (sel) {
                    const v = parseInt(sel.value, 10);
                    if (!isNaN(v) && v >= 1 && v < 25) return v;
                }
                // Fallback: read the Select_button text (the visible value).
                const btn = wrap.querySelector('button[class*="Select_button"]');
                if (btn) {
                    const v = parseInt((btn.textContent || '').trim(), 10);
                    if (!isNaN(v) && v >= 1 && v < 25) return v;
                }
            }
            return NaN;
        }
        function getBetAmount() {
            const inp = document.querySelector('input[data-testid="bet-amount"]');
            return inp ? parseFloat(inp.value) : NaN;
        }

        function weightedRandom(min, max) {
            const base = 1.5; let weights = []; let total = 0;
            for (let i = min; i <= max; i++) { const w = Math.pow(base, max - i); weights.push(w); total += w; }
            let r = Math.random() * total, sum = 0;
            for (let idx = 0; idx < weights.length; idx++) { sum += weights[idx]; if (r < sum) return min + idx; }
            return max;
        }

        // Composite live-check: bail not just on user-stop, but also on
        // SPA-navigation away from the mines page. Without this, the bot
        // can fire clickPlay / cashout on whatever the next page happens
        // to render (Stake's bet-button testid is reused across games).
        const stillLive = () => isRunning && !urlChanged();

        // Detect whether Shuffle is currently in an active round (Play button
        // absent from the DOM, idle tiles ready to click). Lets the bot pick
        // up an in-progress round instead of hanging on isPlayReady.
        function isMidRound() {
            return !document.querySelector('button[data-testid="bet-button"]') && getIdleTiles().length > 0;
        }

        async function doOneRound() {
            if (!stillLive()) return;
            setStatus('Running');

            // If we're not already mid-round, wait for Play and start one.
            if (!isMidRound()) {
                const playReadyStart = Date.now();
                const MAX_WAIT_MS = 20000;
                if (!await waitFor(isPlayReady, MAX_WAIT_MS)) {
                    if (isRunning && Date.now() - playReadyStart >= MAX_WAIT_MS) {
                        setStatus('Stopped — out of balance', '#ef4444');
                        stopBot();
                    }
                    return;
                }
                if (!stillLive()) return;
                if (!clickPlay()) { await delay(100); return; }
                if (!await waitFor(() => getIdleTiles().length > 0, 2500)) return;
                if (!stillLive()) return;
            }

            const min = parseInt(document.getElementById('minPicks').value) || 3;
            const max = parseInt(document.getElementById('maxPicks').value) || 12;
            const picks = weightedRandom(min, max);
            setStatus(`Picking ${picks} tiles`);

            const result = await batchPickTiles(picks);
            if (!stillLive()) return;
            if (!result.ok) return;
            if (result.busted) { setStatus('Busted'); return; }

            // Safe — cashout button is up. Click Redeem to lock in the win.
            const cashoutBtn = findCashoutButton();
            if (cashoutBtn) {
                cashoutBtn.click();
                setStatus('Cashed out');
                await delay(POST_WIN_PAUSE_MS);
            }
        }

        async function runLoop() {
            while (stillLive()) {
                await doOneRound();
            }
            if (urlChanged()) { setStatus('Stopped — navigated away', '#ef4444'); stopBot(); }
        }
        function startBot() {
            if (isRunning) return;
            if (!onMinesPage()) { setStatus('Not on Mines page', '#ef4444'); return; }
            isRunning = true;
            runUrl = location.pathname;
            btnStart.style.display = 'none'; btnStop.style.display = 'inline-block';
            setStatus('Running', '#a855f7');
            runLoop();
        }
        function stopBot() {
            isRunning = false;
            runUrl = null;
            btnStart.style.display = 'inline-block'; btnStop.style.display = 'none';
            setStatus('Stopped', '#ef4444');
        }
        btnStart.onclick = startBot;
        btnStop.onclick = stopBot;
        window.addEventListener('beforeunload', stopBot);

        // ---- Multiplier formula (assume 1% house edge, same as Stake) ----
        function binomCoeff(n, k) {
            if (k < 0 || k > n) return 0;
            if (k === 0 || k === n) return 1;
            if (k > n - k) k = n - k;
            let result = 1;
            for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
            return result;
        }
        function computeMult(picks, mines) {
            if (!isFinite(picks) || !isFinite(mines)) return NaN;
            if (picks < 1 || mines < 1 || mines > 24) return NaN;
            const safe = 25 - mines;
            if (picks > safe) return NaN;
            return 0.99 * binomCoeff(25, picks) / binomCoeff(safe, picks);
        }

        // ---- Min/Max pick cap (matches Stake/Nuts Mines behavior) ----
        let _lastSafe = null;
        function getSafeTiles() {
            const m = getMinesCount();
            if (isNaN(m)) return 24;
            return Math.max(1, 25 - m);
        }
        function syncCaps() {
            const safe = getSafeTiles();
            const minInp = document.getElementById('minPicks');
            const maxInp = document.getElementById('maxPicks');
            if (minInp) minInp.max = String(safe);
            if (maxInp) maxInp.max = String(safe);
            return safe;
        }
        function clampInputs() {
            const safe = getSafeTiles();
            const minInp = document.getElementById('minPicks');
            const maxInp = document.getElementById('maxPicks');
            if (!minInp || !maxInp) return;
            const minF = document.activeElement === minInp;
            const maxF = document.activeElement === maxInp;
            let mn = parseInt(minInp.value); if (isNaN(mn)) mn = 1;
            let mx = parseInt(maxInp.value); if (isNaN(mx)) mx = 1;
            mn = Math.max(1, Math.min(mn, safe));
            mx = Math.max(1, Math.min(mx, safe));
            if (mn > mx) mx = mn;
            if (!minF && minInp.value !== String(mn)) minInp.value = String(mn);
            if (!maxF && maxInp.value !== String(mx)) maxInp.value = String(mx);
        }

        function updateInfo() {
            const safe = syncCaps();
            if (_lastSafe !== null && _lastSafe !== safe) clampInputs();
            _lastSafe = safe;

            const mines = getMinesCount();
            const bet = getBetAmount();
            const totalTiles = document.querySelectorAll('button[class*="MinesGameTileWrapper_root"]').length;
            const idleCount = getIdleTiles().length;
            const inRound = totalTiles > 0 && idleCount < totalTiles && !isPlayReady();
            const revealed = inRound ? (totalTiles - idleCount) : NaN;

            let liveMult = NaN, livePayout = NaN, chanceText = '—';
            if (isFinite(revealed) && revealed > 0 && !isNaN(mines)) {
                liveMult = computeMult(revealed, mines);
                if (isFinite(bet) && bet > 0) livePayout = bet * liveMult;
                const remaining = 25 - revealed;
                const safeRemaining = (25 - mines) - revealed;
                if (remaining > 0 && safeRemaining >= 0) chanceText = ((safeRemaining / remaining) * 100).toFixed(2) + '%';
            }
            const multEl = document.getElementById('mult');
            const poutEl = document.getElementById('pout');
            const chanceEl = document.getElementById('chance');
            if (multEl) multEl.textContent = isNaN(liveMult) ? '—' : liveMult.toFixed(2) + '×';
            if (poutEl) poutEl.textContent = isNaN(livePayout) ? '—' : livePayout.toFixed(2);
            if (chanceEl) chanceEl.textContent = chanceText;

            const minPicks = parseInt(document.getElementById('minPicks').value);
            const maxPicks = parseInt(document.getElementById('maxPicks').value);
            const minMultEl = document.getElementById('minMult');
            const maxMultEl = document.getElementById('maxMult');
            const minPayEl = document.getElementById('minPayout');
            const maxPayEl = document.getElementById('maxPayout');
            if (isNaN(minPicks) || isNaN(maxPicks) || isNaN(mines)) {
                [minMultEl, maxMultEl, minPayEl, maxPayEl].forEach(el => { if (el) el.textContent = '—'; });
                return;
            }
            const cMin = Math.max(1, Math.min(minPicks, safe));
            const cMax = Math.max(cMin, Math.min(maxPicks, safe));
            const minMult = computeMult(cMin, mines);
            const maxMult = computeMult(cMax, mines);
            if (minMultEl) minMultEl.textContent = isNaN(minMult) ? '—' : minMult.toFixed(2) + '×';
            if (maxMultEl) maxMultEl.textContent = isNaN(maxMult) ? '—' : maxMult.toFixed(2) + '×';
            if (isFinite(bet) && bet > 0) {
                if (minPayEl) minPayEl.textContent = isNaN(minMult) ? '—' : (bet * minMult).toFixed(2);
                if (maxPayEl) maxPayEl.textContent = isNaN(maxMult) ? '—' : (bet * maxMult).toFixed(2);
            } else {
                if (minPayEl) minPayEl.textContent = '—';
                if (maxPayEl) maxPayEl.textContent = '—';
            }
        }
        setInterval(updateInfo, 1000);
        ['minPicks', 'maxPicks'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', updateInfo);
            el.addEventListener('blur', () => { clampInputs(); updateInfo(); });
        });
        clampInputs();
        updateInfo();
    }


    /* ----- Shuffle Mines ----- */
    register({
        id: 'shuffle-mines',
        name: 'Shuffle Mines',
        description: 'Auto-plays Mines on Shuffle with weighted random tile picks.',
        matches: [
            'https://shuffle.us/games/originals/mines*',
            'https://shuffle.com/games/originals/mines*'
        ],
        runAt: 'document-end',
        defaultEnabled: true,
        group: 'Shuffle',
        uiSelectors: ['#mines-auto-gui']
    }, tool_shuffle_mines);

    /* =========================================================
       CONTROL PANEL UI
       --------------------------------------------------------
       Floating ⚙ button (bottom-left) opens the panel. The panel
       lists every registered tool grouped by site (Stake / Nuts.gg
       / Other), each with a status line and an enable/disable
       switch. Footer has bulk Enable matched / Disable all.
       Header is draggable; position is persisted in localStorage.
       ========================================================= */

    const PANEL_ID         = 'unified-tools-panel';
    const PANEL_TOGGLE_ID  = 'unified-tools-toggle';
    const PANEL_STYLE_ID   = 'unified-tools-style';

    const PANEL_CSS = `
    #${PANEL_TOGGLE_ID} {
        position: fixed; bottom: 16px; left: 16px; z-index: 2147483646;
        width: 38px; height: 38px; border-radius: 50%;
        background: linear-gradient(135deg, #1f2937, #0f172a);
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #e2e8f0; font-size: 18px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 6px 18px rgba(0,0,0,0.45);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        user-select: none;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    #${PANEL_TOGGLE_ID}:hover {
        transform: scale(1.06);
        box-shadow: 0 8px 22px rgba(0,0,0,0.55);
    }
    #${PANEL_TOGGLE_ID}.has-active::after {
        content: ''; position: absolute; top: 4px; right: 4px;
        width: 8px; height: 8px; border-radius: 50%;
        background: #10b981; box-shadow: 0 0 6px #10b981;
    }
    #${PANEL_ID} {
        position: fixed; bottom: 64px; left: 16px; z-index: 2147483647;
        width: 320px; max-height: 70vh;
        background: linear-gradient(180deg, #111827 0%, #0b1220 100%);
        color: #e2e8f0; border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.6);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; user-select: none;
        display: flex; flex-direction: column; overflow: hidden;
    }
    #${PANEL_ID}.hidden { display: none; }
    #${PANEL_ID} .ut-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px;
        background: linear-gradient(135deg, #1f2937, #111827);
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        cursor: grab;
    }
    #${PANEL_ID} .ut-header:active { cursor: grabbing; }
    #${PANEL_ID} .ut-title {
        font-weight: 700; font-size: 13px; color: #f8fafc;
        letter-spacing: 0.3px;
    }
    #${PANEL_ID} .ut-title small {
        display: block; font-weight: 400; font-size: 10px; color: #94a3b8;
        margin-top: 2px;
    }
    #${PANEL_ID} .ut-header-btn {
        background: none; border: none; color: #94a3b8;
        font-size: 18px; line-height: 1; cursor: pointer;
        padding: 2px 6px; border-radius: 4px;
    }
    #${PANEL_ID} .ut-header-btn:hover { color: #fff; background: rgba(148, 163, 184, 0.15); }
    #${PANEL_ID} .ut-body {
        flex: 1 1 auto; overflow-y: auto;
        padding: 8px 0;
    }
    #${PANEL_ID} .ut-body::-webkit-scrollbar { width: 6px; }
    #${PANEL_ID} .ut-body::-webkit-scrollbar-thumb { background: rgba(148, 163, 184, 0.3); border-radius: 3px; }
    #${PANEL_ID} .ut-group {
        padding: 6px 12px 4px;
        font-size: 10px; color: #64748b;
        text-transform: uppercase; letter-spacing: 0.6px;
        border-top: 1px solid rgba(148, 163, 184, 0.08);
    }
    #${PANEL_ID} .ut-group:first-child { border-top: none; }
    #${PANEL_ID} .ut-tool {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 8px 12px;
        transition: background 0.12s ease;
    }
    #${PANEL_ID} .ut-tool:hover { background: rgba(148, 163, 184, 0.06); }
    #${PANEL_ID} .ut-tool.unmatched { opacity: 0.45; }
    #${PANEL_ID} .ut-tool-info { flex: 1 1 auto; min-width: 0; }
    #${PANEL_ID} .ut-tool-name {
        font-weight: 600; color: #f1f5f9; font-size: 12px;
        line-height: 1.3;
    }
    #${PANEL_ID} .ut-tool-desc {
        font-size: 11px; color: #94a3b8; margin-top: 2px;
        line-height: 1.35;
    }
    #${PANEL_ID} .ut-tool-status {
        font-size: 10px; color: #64748b; margin-top: 4px;
        text-transform: uppercase; letter-spacing: 0.4px;
    }
    #${PANEL_ID} .ut-tool-status.running { color: #10b981; }
    #${PANEL_ID} .ut-tool-status.disabled { color: #f59e0b; }
    #${PANEL_ID} .ut-tool-status.unmatched { color: #475569; }
    #${PANEL_ID} .ut-switch {
        position: relative;
        width: 36px; height: 20px;
        background: #334155; border-radius: 10px; cursor: pointer;
        flex: 0 0 auto;
        transition: background 0.15s ease;
    }
    #${PANEL_ID} .ut-switch::after {
        content: ''; position: absolute;
        top: 2px; left: 2px;
        width: 16px; height: 16px;
        border-radius: 50%; background: #f8fafc;
        transition: transform 0.15s ease;
    }
    #${PANEL_ID} .ut-switch.on { background: #10b981; }
    #${PANEL_ID} .ut-switch.on::after { transform: translateX(16px); }
    #${PANEL_ID} .ut-footer {
        padding: 8px 12px;
        border-top: 1px solid rgba(148, 163, 184, 0.15);
        display: flex; gap: 6px;
        background: rgba(15, 23, 42, 0.6);
    }
    #${PANEL_ID} .ut-footer-btn {
        flex: 1 1 auto;
        background: rgba(148, 163, 184, 0.1);
        border: 1px solid rgba(148, 163, 184, 0.25);
        color: #cbd5e1;
        font-size: 11px; font-weight: 600;
        padding: 6px 8px; border-radius: 6px;
        cursor: pointer;
        text-transform: uppercase; letter-spacing: 0.4px;
    }
    #${PANEL_ID} .ut-footer-btn:hover { background: rgba(148, 163, 184, 0.18); color: #fff; }
    #${PANEL_ID} .ut-footer-btn.danger { color: #fca5a5; }
    #${PANEL_ID} .ut-footer-btn.danger:hover { color: #fff; background: rgba(239, 68, 68, 0.2); }
    #${PANEL_ID} .ut-empty {
        padding: 20px 16px; text-align: center;
        color: #64748b; font-size: 11px; font-style: italic;
    }
    `;

    /** Inject the panel stylesheet once. */
    function injectPanelStyle() {
        if (document.getElementById(PANEL_STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = PANEL_STYLE_ID;
        s.textContent = PANEL_CSS;
        document.head.appendChild(s);
    }

    /** Read the user's saved panel position (or null if never moved). */
    function loadPanelPos() {
        try {
            const raw = localStorage.getItem(PANEL_POS_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (typeof p.left === 'number' && typeof p.top === 'number') return p;
        } catch {}
        return null;
    }
    /** Persist the panel position so dragging survives reloads. */
    function savePanelPos(left, top) {
        try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left, top })); } catch {}
    }

    /** Build the toggle button + panel and wire up all its event handlers. */
    function buildPanel() {
        if (document.getElementById(PANEL_ID)) return;
        injectPanelStyle();

        const toggle = document.createElement('button');
        toggle.id = PANEL_TOGGLE_ID;
        toggle.title = 'Open Unified Tools Panel';
        toggle.textContent = '⚙';

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.className = 'hidden';

        const initiallyOpen = localStorage.getItem(PANEL_OPEN_KEY) === '1';
        if (initiallyOpen) panel.classList.remove('hidden');

        const savedPos = loadPanelPos();
        if (savedPos) {
            panel.style.left = savedPos.left + 'px';
            panel.style.top = savedPos.top + 'px';
            panel.style.bottom = 'auto';
        }

        const matching = TOOLS.filter(t => urlMatches(t, location.href));
        const groups = {};
        for (const t of TOOLS) {
            const g = t.group || 'Other';
            if (!groups[g]) groups[g] = [];
            groups[g].push(t);
        }

        let body = '<div class="ut-header">' +
            '<div class="ut-title">Unified Tools' +
                '<small id="ut-count">' + matching.length + ' available on this page</small>' +
            '</div>' +
            '<div>' +
                '<button class="ut-header-btn" id="ut-collapse" title="Collapse">×</button>' +
            '</div>' +
        '</div>' +
        '<div class="ut-body">';

        const groupOrder = ['Stake', 'Shuffle', 'Nuts', 'Other'];
        for (const groupName of groupOrder) {
            const list = groups[groupName];
            if (!list || !list.length) continue;
            body += '<div class="ut-group">' + groupName + '</div>';
            for (const t of list) {
                const matched = urlMatches(t, location.href);
                const enabled = isEnabled(t);
                const cls = 'ut-tool' + (matched ? '' : ' unmatched');
                const switchCls = 'ut-switch' + (enabled ? ' on' : '');
                body += '<div class="' + cls + '" data-tool-id="' + t.id + '">' +
                    '<div class="ut-tool-info">' +
                        '<div class="ut-tool-name">' + escapeHtml(t.name) + '</div>' +
                        '<div class="ut-tool-desc">' + escapeHtml(t.description || '') + '</div>' +
                        '<div class="ut-tool-status" data-status="' + t.id + '"></div>' +
                    '</div>' +
                    '<div class="' + switchCls + '" data-switch="' + t.id + '" title="Toggle"></div>' +
                '</div>';
            }
        }

        if (TOOLS.length === 0) {
            body += '<div class="ut-empty">No tools registered.</div>';
        }

        body += '</div>' +
        '<div class="ut-footer">' +
            '<button class="ut-footer-btn" id="ut-enable-all">Enable matched</button>' +
            '<button class="ut-footer-btn danger" id="ut-disable-all">Disable all</button>' +
        '</div>';

        panel.innerHTML = body;
        document.body.appendChild(panel);
        document.body.appendChild(toggle);
        // The gear is the cluster's anchor and its main drag handle.
        makeClusterDraggable(toggle);
        applyFloatPos();
        bindClusterReflow();

        toggle.onclick = () => {
            if (swallowedByDrag()) return;   // this "click" ended a drag
            const willShow = panel.classList.contains('hidden');
            panel.classList.toggle('hidden', !willShow);
            try { localStorage.setItem(PANEL_OPEN_KEY, willShow ? '1' : '0'); } catch {}
        };

        panel.querySelector('#ut-collapse').onclick = () => {
            panel.classList.add('hidden');
            try { localStorage.setItem(PANEL_OPEN_KEY, '0'); } catch {}
        };

        panel.querySelectorAll('[data-switch]').forEach(el => {
            el.addEventListener('click', () => {
                const id = el.getAttribute('data-switch');
                const tool = TOOLS.find(t => t.id === id);
                if (!tool) return;
                const newState = !isEnabled(tool);
                setEnabled(id, newState);
                el.classList.toggle('on', newState);
                applyToolVisibility(tool);
                try { applyQuickToggles(); } catch (e) {}
                refreshStatuses();
                updateToggleBadge();

                // hijacksPage tools always reload on toggle — their HUD owns
                // relocated native page DOM that can't be hidden in place.
                if (tool.hijacksPage && urlMatches(tool, location.href)) {
                    location.reload();
                    return;
                }

                // Non-hijacking tools toggle hide/show via CSS class instantly.
                // The one corner case is enabling a tool that didn't load
                // (corrupted state, race, prior version that gated by enabled).
                // In that case auto-refresh so it can initialize cleanly.
                if (newState && urlMatches(tool, location.href) && !tool._ran) {
                    location.reload();
                }
            });
        });

        panel.querySelector('#ut-enable-all').onclick = () => {
            const matchedTools = TOOLS.filter(t => urlMatches(t, location.href));
            let needsReload = false;
            for (const t of matchedTools) {
                if (!isEnabled(t) && t.hijacksPage) needsReload = true;
                setEnabled(t.id, true);
                if (!t._ran) needsReload = true;
            }
            refreshSwitches();
            for (const t of TOOLS) applyToolVisibility(t);
            try { applyQuickToggles(); } catch (e) {}
            refreshStatuses();
            updateToggleBadge();
            if (needsReload) location.reload();
        };
        panel.querySelector('#ut-disable-all').onclick = () => {
            let needsReload = false;
            for (const t of TOOLS) {
                if (isEnabled(t) && t.hijacksPage && urlMatches(t, location.href) && t._ran) {
                    needsReload = true;
                }
                setEnabled(t.id, false);
            }
            refreshSwitches();
            for (const t of TOOLS) applyToolVisibility(t);
            try { applyQuickToggles(); } catch (e) {}
            refreshStatuses();
            updateToggleBadge();
            if (needsReload) location.reload();
        };

        const header = panel.querySelector('.ut-header');
        let dragging = false, dx = 0, dy = 0;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            const r = panel.getBoundingClientRect();
            dx = e.clientX - r.left; dy = e.clientY - r.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            let nl = e.clientX - dx, nt = e.clientY - dy;
            nl = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, nl));
            nt = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, nt));
            panel.style.left = nl + 'px';
            panel.style.top = nt + 'px';
            panel.style.bottom = 'auto'; panel.style.right = 'auto';
            savePanelPos(nl, nt);
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        refreshStatuses();
        updateToggleBadge();
    }

    /** Minimal HTML escape used for tool names/descriptions in the panel. */
    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    /** Inline reload-prompt banner (currently unused — kept for future settings flows). */
    function showReloadHint(panel) {
        if (panel.querySelector('.ut-reload-hint')) return;
        const hint = document.createElement('div');
        hint.className = 'ut-reload-hint';
        hint.style.cssText = 'padding:8px 12px;background:rgba(245,158,11,0.15);color:#fbbf24;font-size:11px;text-align:center;border-top:1px solid rgba(245,158,11,0.3);';
        hint.innerHTML = 'Reload the page for new tools to take effect. ' +
            '<button style="margin-left:6px;background:#fbbf24;color:#000;border:none;border-radius:4px;padding:3px 8px;font-weight:700;cursor:pointer;font-size:11px;" onclick="location.reload()">Reload now</button>';
        panel.querySelector('.ut-footer').before(hint);
    }

    /** Sync each switch's visual on/off state to the persisted setting. */
    function refreshSwitches() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        panel.querySelectorAll('[data-switch]').forEach(el => {
            const id = el.getAttribute('data-switch');
            const tool = TOOLS.find(t => t.id === id);
            if (!tool) return;
            el.classList.toggle('on', isEnabled(tool));
        });
    }

    /** Refresh the per-tool status line ("Running" / "Hidden" / "Not for this page" / "Loading…"). */
    function refreshStatuses() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        panel.querySelectorAll('[data-status]').forEach(el => {
            const id = el.getAttribute('data-status');
            const tool = TOOLS.find(t => t.id === id);
            if (!tool) return;
            const matched = urlMatches(tool, location.href);
            const enabled = isEnabled(tool);
            el.className = 'ut-tool-status';
            if (!matched) {
                el.classList.add('unmatched');
                el.textContent = 'Not for this page';
            } else if (!enabled) {
                el.classList.add('disabled');
                el.textContent = tool._ran ? 'Hidden (loaded)' : 'Hidden';
            } else if (tool._ran) {
                el.classList.add('running');
                el.textContent = 'Running';
            } else {
                el.classList.add('disabled');
                el.textContent = 'Loading…';
            }
        });
    }

    /** Add/remove the green dot on the ⚙ toggle button when any tool is running. */
    function updateToggleBadge() {
        const toggle = document.getElementById(PANEL_TOGGLE_ID);
        if (!toggle) return;
        const anyActive = TOOLS.some(t => t._ran);
        toggle.classList.toggle('has-active', anyActive);
    }


    /* =========================================================
       BOOT SEQUENCE
       --------------------------------------------------------
       Order of operations:
         1. document-start: hide disabled-tool selectors as early
            as possible (avoids a flash of UI before they hide).
         2. document-start: run any tools registered with
            runAt: 'document-start' (e.g. the IOW/Smart HUDs that
            need to hijack page DOM before React mounts).
         3. DOMContentLoaded: run document-end tools.
         4. +1500 ms: build the control panel (delay gives slow
            sites time to settle their own DOM mutations so the
            panel doesn't fight a re-render).
         5. setupIowDiceIntegration: stitch the Dice Tool's
            calculator/optimizer into the IOW/Smart HUD as the
            "Advanced IOW" tab.
       ========================================================= */

    /** applyAllVisibility() that swallows pre-DOM errors. */
    function safeApplyAllVisibility() {
        try { applyAllVisibility(); } catch (e) {}
    }

    // Step 1: apply disabled-tool visibility ASAP.
    safeApplyAllVisibility();

    // Re-inject the visibility CSS once <head> exists (in case we ran before
    // <head> was constructed and the style failed to attach).
    if (!document.getElementById(VISIBILITY_STYLE_ID)) {
        const headObserver = new MutationObserver(() => {
            if (document.head) {
                safeApplyAllVisibility();
                if (document.getElementById(VISIBILITY_STYLE_ID)) headObserver.disconnect();
            }
        });
        headObserver.observe(document.documentElement, { childList: true });
    }

    // Step 2: document-start tools.
    for (const t of TOOLS) maybeRun(t, 'document-start');
    safeApplyAllVisibility();

    /** Run `fn` on DOMContentLoaded, or immediately if the DOM is already ready. */
    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    onReady(() => {
        // Step 3: document-end tools.
        for (const t of TOOLS) maybeRun(t, 'document-end');
        safeApplyAllVisibility();
        try { applyQuickToggles(); } catch (e) {}

        // Step 4: control panel (delayed so sites finish mutating).
        setTimeout(() => {
            try { buildPanel(); } catch (e) { console.error('[UnifiedTools] panel build failed:', e); }
            safeApplyAllVisibility();
            try { applyQuickToggles(); } catch (e) {}
        }, 1500);

        // Step 5: cross-tool stitching for IOW/Smart + Dice Tool.
        setupIowDiceIntegration();

        // Step 6: SPA navigation watcher — fires when the user moves between
        // pages without a full reload (Stake/Shuffle/Nuts all use React
        // routers, so clicking between games never reloads the script). Two
        // jobs on each URL change:
        //   1. Re-apply tool visibility, so the URL-mismatch class hides UIs
        //      from tools whose @match patterns no longer match (e.g. Mines
        //      UI stays out of the Stake lobby).
        //   2. Run any not-yet-run tool whose @match now covers the new URL,
        //      so SPA-navigating to /casino/games/mines from elsewhere on
        //      Stake actually loads the Mines tool.
        installSpaNavWatcher();
    });

    /** Detects SPA URL changes (pushState, replaceState, popstate) and
     *  triggers visibility refresh + lazy tool loading. Idempotent — safe
     *  to call once. */
    function installSpaNavWatcher() {
        if (window.__unifiedToolsSpaWatcherInstalled) return;
        window.__unifiedToolsSpaWatcherInstalled = true;

        let lastUrl = location.href;
        function onUrlChange() {
            if (location.href === lastUrl) return;
            lastUrl = location.href;
            safeApplyAllVisibility();
            try { applyQuickToggles(); } catch (e) {}
            // Lazy-load tools that haven't run yet but now match. Uses each
            // tool's registered runAt phase. Tools that already ran keep
            // their original intervals/observers alive — their internal URL
            // guards (where present) take care of tear-down.
            for (const t of TOOLS) {
                try { maybeRun(t, t.runAt || 'document-end'); }
                catch (e) { console.error('[UnifiedTools] error running tool on SPA nav:', e); }
            }
        }

        // Patch history methods so SPA-driven URL changes notify us. Defer
        // by a tick because pushState fires before location.href has
        // finished updating in some browsers.
        try {
            const origPush = history.pushState;
            history.pushState = function () {
                const ret = origPush.apply(this, arguments);
                setTimeout(onUrlChange, 0);
                return ret;
            };
            const origReplace = history.replaceState;
            history.replaceState = function () {
                const ret = origReplace.apply(this, arguments);
                setTimeout(onUrlChange, 0);
                return ret;
            };
        } catch (e) { /* userscript world may not let us patch */ }

        window.addEventListener('popstate', () => setTimeout(onUrlChange, 0));

        // Polling fallback: catches any URL changes the patches above miss
        // (e.g. React router replacements that bypass the patched methods,
        // or sites that swap window.history). Cheap — 500ms compare-strings.
        setInterval(onUrlChange, 500);
    }


    /* Standalone build: no IOW/dice stitching needed for this tool. */
    function setupIowDiceIntegration() {}


    console.log('%c[Shuffle Mines — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
