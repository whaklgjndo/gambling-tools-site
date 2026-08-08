// ==UserScript==
// @name         Stake Keno — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.40
// @description  Standalone single-tool build, extracted from the unified bundle.
// @author       .
// @match        https://stake.com/*
// @match        https://stake.bet/*
// @match        https://stake.games/*
// @match        https://staketr.com/*
// @match        https://staketr2.com/*
// @match        https://staketr3.com/*
// @match        https://staketr4.com/*
// @match        https://stake.bz/*
// @match        https://stake.us/*
// @match        https://stake.pet/*
// @match        https://stake.jp/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/Keno.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/Keno.user.js
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cStake Keno — Desktop — standalone build v3.40', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: stake-keno-desktop.user.js === */
    function tool_stake_keno() {
        'use strict';
const PRESETS_KEY = 'keno-presets';
    const TILE_SELECTOR = 'button[data-testid^="game-tile-"]';
    const RISK_SELECTOR = 'select[data-testid="game-difficulty"]';
    const RISK_VALUES = ['classic', 'low', 'medium', 'high'];

    // --- Presets store (shared across sites via localStorage) ---
    function loadPresets() {
        try {
            const raw = localStorage.getItem(PRESETS_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }
    function savePresets(list) {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    }

    // --- DOM helpers ---
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    function getTiles() {
        return Array.from(document.querySelectorAll(TILE_SELECTOR));
    }

    // Picks are tracked from the user's own click events — Stake also sets
    // data-selected="true" on game-drawn HIT tiles during a round, so reading
    // that attribute reports hits as picks. Source of truth lives here.
    const userPicks = new Set();

    function readPicksFromDOM() {
        // A genuine pick is data-game-tile-status 'selected' (not drawn) or
        // 'match' (picked AND drawn = a hit). data-selected flips to false on a
        // hit, so the old data-selected check missed hits and let drawn results
        // bleed in during the reveal.
        return getTiles()
            .filter(t => { const s = t.getAttribute('data-game-tile-status'); return s === 'selected' || s === 'match'; })
            .map(t => Number(t.dataset.index) + 1)
            .filter(n => !isNaN(n));
    }
    function syncPicksFromDOM() {
        userPicks.clear();
        for (const n of readPicksFromDOM()) userPicks.add(n);
    }
    function getSelectedNumbers() {
        // Read live from the board (status-based) so the panel can't drift out
        // of sync and never counts drawn results. userPicks is only a fallback
        // for when the board isn't mounted yet.
        if (getTiles().length) return readPicksFromDOM().slice().sort((a, b) => a - b);
        return Array.from(userPicks).sort((a, b) => a - b);
    }
    function getRisk() {
        const el = document.querySelector(RISK_SELECTOR);
        return el ? el.value : null;
    }
    function setRisk(risk) {
        const el = document.querySelector(RISK_SELECTOR);
        if (!el || el.value === risk) return !!el;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
        setter.call(el, risk);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }
    function clickTile(number) {
        const tile = document.querySelector(`button[data-testid="game-tile-${number}"]`);
        if (!tile) return false;
        tile.click();
        return true;
    }

    async function applyPreset(preset) {
        if (!preset || !Array.isArray(preset.numbers)) return;
        if (preset.risk && RISK_VALUES.includes(preset.risk)) {
            setRisk(preset.risk);
            await sleep(80);
        }
        const current = new Set(getSelectedNumbers());
        const target = new Set(preset.numbers);
        // Toggle off tiles that shouldn't be on
        for (const n of current) {
            if (!target.has(n)) { clickTile(n); await sleep(40); }
        }
        // Toggle on tiles that should be on
        for (const n of target) {
            if (!current.has(n)) { clickTile(n); await sleep(40); }
        }
    }

    // --- UI ---
    const style = document.createElement('style');
    style.textContent = `
    #keno-preset-gui {
        position: fixed; bottom: 20px; right: 20px; z-index: 999999;
        --kp-accent: #10b981;
        background: #0f212e; color: #b1bad3; border: 1px solid #2f4553;
        border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; width: 260px; user-select: none;
    }
    #keno-preset-gui .kp-header {
        display: flex; align-items: center; justify-content: space-between;
        background: #1a2c38; padding: 8px 12px; border-radius: 8px 8px 0 0;
        border-bottom: 1px solid #2f4553; cursor: grab;
    }
    #keno-preset-gui .kp-header:active { cursor: grabbing; }
    #keno-preset-gui .kp-title {
        font-weight: 600; font-size: 12px; color: #fff; letter-spacing: 0.3px;
    }
    #keno-preset-gui .kp-min {
        background: none; border: none; color: #64748b; cursor: pointer;
        padding: 2px 6px; font-size: 16px; line-height: 1; border-radius: 4px;
    }
    #keno-preset-gui .kp-min:hover { color: #fff; background: #2f4553; }
    #keno-preset-gui .kp-content { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
    #keno-preset-gui select {
        width: 100%; background: #1a2c38; color: #e2e8f0; border: 1px solid #2f4553;
        border-radius: 4px; padding: 6px 8px; font-size: 12px;
    }
    #keno-preset-gui select:focus { outline: none; border-color: #10b981; }
    #keno-preset-gui .kp-btn-row { display: flex; gap: 6px; }
    #keno-preset-gui .kp-btn {
        flex: 1; background: #1a2c38; color: #b1bad3; border: 1px solid #2f4553;
        border-radius: 4px; padding: 6px 8px; font-size: 11px; font-weight: 600;
        cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
    }
    #keno-preset-gui .kp-btn:hover:not(:disabled) { background: #2f4553; color: #fff; }
    #keno-preset-gui .kp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    #keno-preset-gui .kp-btn.primary {
        background: #10b981; border-color: #10b981; color: #fff;
    }
    #keno-preset-gui .kp-btn.primary:hover:not(:disabled) { background: #059669; }
    #keno-preset-gui .kp-btn.danger { color: #ef4444; }
    #keno-preset-gui .kp-btn.danger:hover:not(:disabled) { background: #2a1a1f; color: #fca5a5; }
    #keno-preset-gui .kp-current {
        padding: 6px 8px; background: #1a2c38; border-radius: 4px;
        font-size: 11px; color: #94a3b8; line-height: 1.4;
    }
    #keno-preset-gui .kp-current b { color: #e2e8f0; }
    `;
    document.head.appendChild(style);

    const gui = document.createElement('div');
    gui.id = 'keno-preset-gui';
    gui.innerHTML = `
        <div class="kp-header">
            <span class="kp-title">Stake Keno</span>
            <button class="kp-min" id="kp-min" title="Minimise">−</button>
        </div>
        <div class="kp-content">
            <div class="kp-current" id="kp-current">Loading…</div>
            <select id="kp-select"></select>
            <div class="kp-btn-row">
                <button class="kp-btn primary" id="kp-load">Load</button>
                <button class="kp-btn" id="kp-save">Save As…</button>
                <button class="kp-btn danger" id="kp-delete">Delete</button>
            </div>
        </div>
    `;
    document.body.appendChild(gui);

    const selectEl = gui.querySelector('#kp-select');
    const currentEl = gui.querySelector('#kp-current');
    const loadBtn = gui.querySelector('#kp-load');
    const saveBtn = gui.querySelector('#kp-save');
    const deleteBtn = gui.querySelector('#kp-delete');
    const minBtn = gui.querySelector('#kp-min');
    const header = gui.querySelector('.kp-header');

    function renderPresets() {
        const list = loadPresets();
        selectEl.innerHTML = '';
        if (!list.length) {
            const opt = document.createElement('option');
            opt.textContent = '— no presets saved —';
            opt.disabled = true;
            selectEl.appendChild(opt);
            loadBtn.disabled = true;
            deleteBtn.disabled = true;
            return;
        }
        for (const p of list) {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name} (${p.numbers.length}#, ${p.risk || '—'})`;
            selectEl.appendChild(opt);
        }
        loadBtn.disabled = false;
        deleteBtn.disabled = false;
    }

    function renderCurrent() {
        const nums = getSelectedNumbers();
        const risk = getRisk() || '—';
        currentEl.innerHTML = nums.length
            ? `Current: <b>${nums.length}</b> picks · risk <b>${risk}</b><br>${nums.join(', ')}`
            : `No picks selected · risk <b>${risk}</b>`;
    }

    saveBtn.onclick = () => {
        const nums = getSelectedNumbers();
        if (!nums.length) {
            alert('Select some numbers first, then save as a preset.');
            return;
        }
        const risk = getRisk();
        const name = (prompt('Preset name:') || '').trim();
        if (!name) return;
        const list = loadPresets();
        const existing = list.findIndex(p => p.name === name);
        const preset = { name, numbers: nums, risk };
        if (existing >= 0) {
            if (!confirm(`"${name}" already exists. Overwrite?`)) return;
            list[existing] = preset;
        } else {
            list.push(preset);
        }
        savePresets(list);
        renderPresets();
        selectEl.value = name;
    };

    loadBtn.onclick = async () => {
        const list = loadPresets();
        const p = list.find(x => x.name === selectEl.value);
        if (!p) return;
        loadBtn.disabled = true;
        await applyPreset(p);
        setTimeout(() => {
            loadBtn.disabled = false;
            renderCurrent();
        }, 200);
    };

    deleteBtn.onclick = () => {
        const name = selectEl.value;
        if (!name) return;
        if (!confirm(`Delete preset "${name}"?`)) return;
        const list = loadPresets().filter(p => p.name !== name);
        savePresets(list);
        renderPresets();
    };

    /* Collapse to a draggable pill instead of removing the panel. Closing it
       needed a page reload to get back, and the × sat right next to the drag
       handle — easy to hit by accident on a tool you had left running. Done with
       inline styles rather than a CSS rule because each site themes this panel
       separately and the collapse should not have to be restyled three times. */
    minBtn.onclick = () => {
        const body = gui.querySelector('.kp-content');
        const mini = gui.classList.toggle('kp-mini');
        if (body) body.style.display = mini ? 'none' : '';
        gui.style.width = mini ? 'auto' : '';
        minBtn.textContent = mini ? '+' : '−';
        minBtn.title = mini ? 'Restore' : 'Minimise';
    };

    // Track user clicks on tiles in capture phase — toggles our authoritative
    // pick set. Works for both real taps and programmatic clicks from applyPreset.
    document.addEventListener('click', (e) => {
        const tile = e.target.closest(TILE_SELECTOR);
        if (!tile) return;
        const idx = Number(tile.dataset.index);
        if (isNaN(idx)) return;
        const n = idx + 1;
        if (userPicks.has(n)) userPicks.delete(n);
        else userPicks.add(n);
        setTimeout(renderCurrent, 0);
    }, true);

    // Drag
    let isDragging = false, dx = 0, dy = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.kp-min')) return;
        isDragging = true;
        const rect = gui.getBoundingClientRect();
        dx = e.clientX - rect.left; dy = e.clientY - rect.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        let nl = e.clientX - dx, nt = e.clientY - dy;
        nl = Math.max(0, Math.min(window.innerWidth - gui.offsetWidth, nl));
        nt = Math.max(0, Math.min(window.innerHeight - gui.offsetHeight, nt));
        gui.style.left = nl + 'px'; gui.style.top = nt + 'px';
        gui.style.right = 'auto'; gui.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // Watch for selection / risk changes on the page. The grid element gets
    // destroyed and recreated when the user SPA-navigates away from /keno
    // and back, so we run a persistent attach loop that re-binds whenever
    // the grid identity changes — keeps "Current picks" in sync across
    // unlimited route changes without an F5.
    const observer = new MutationObserver(() => renderCurrent());
    let _observedGrid = null;
    let _observedRisk = null;
    function attachObserver() {
        const grid = document.querySelector('[data-testid="game-keno"]');
        if (grid && grid !== _observedGrid) {
            observer.disconnect();
            observer.observe(grid, { attributes: true, subtree: true, attributeFilter: ['data-selected', 'class'] });
            _observedGrid = grid;
        }
        const risk = document.querySelector(RISK_SELECTOR);
        if (risk && risk !== _observedRisk) {
            if (_observedRisk) _observedRisk.removeEventListener('change', renderCurrent);
            risk.addEventListener('change', renderCurrent);
            _observedRisk = risk;
        }
    }
    // Persistent attach loop. Cheap — only re-binds when the grid element
    // identity changes (initial mount + every SPA navigation that swaps the
    // grid). Re-syncs picks and re-renders the UI on each re-bind.
    setInterval(() => {
        const grid = document.querySelector('[data-testid="game-keno"]');
        if (!grid || !getTiles().length) return;
        if (grid !== _observedGrid) {
            syncPicksFromDOM();
            attachObserver();
            renderCurrent();
        } else {
            attachObserver();
        }
    }, 500);

    renderPresets();
    renderCurrent();


    // The hotspot is part of this tool: it mounts into the panel built
    // above, so there is one Keno panel and one Keno toggle.
    tool_keno_hotspot();
    }
    /* === end tool: stake-keno === */

    /* ----- Stake Keno ----- */
    register({
        id: 'stake-keno',
        name: 'Stake Keno',
        description: 'Save & load Keno number + difficulty presets on Stake.',
        matches: [
            'https://stake.com/casino/games/keno*',
            'https://stake.us/casino/games/keno*',
            'https://stake.bet/casino/games/keno*',
            'https://stake.games/casino/games/keno*',
            'https://staketr.com/casino/games/keno*',
            'https://staketr2.com/casino/games/keno*',
            'https://staketr3.com/casino/games/keno*',
            'https://staketr4.com/casino/games/keno*',
            'https://stake.bz/casino/games/keno*',
            'https://stake.pet/casino/games/keno*', 'https://stake.jp/casino/games/keno*'
        ],
        runAt: 'document-end',
        defaultEnabled: true,
        group: 'Stake',
        uiSelectors: ['#keno-preset-gui', '.keno-hot-tint']
    }, tool_stake_keno);

    /* === source: keno-hotspot (Stake / Shuffle / Nuts) === */
    /**
     * Keno Hotspot — hot/cold heatmap for Stake, Shuffle and Nuts.
     *
     * Records every completed draw, tints the board hot→cold by how often each
     * number has come up over a rolling window, and applies the hottest (or
     * coldest) N numbers in one click.
     *
     * One body serves all three sites. Each casino marks its tiles differently
     * — an attribute on Stake, hashed CSS-module classes on Shuffle, a cover
     * colour on Nuts — so SITES below supplies a `signature` per site: a string
     * that changes whenever that tile's appearance changes.
     *
     * The tool never decides which signature means "drawn". A reveal is the set
     * of tiles whose signature differs from what it was just before the reveal
     * started. That is deliberate: Nuts' drawn colour is documented nowhere and
     * was guessed wrong twice, and a hit there flashes green then reverts to the
     * picked colour, so no single frame — first, last or settled — contains the
     * whole draw. Baseline comparison needs neither the palette nor a lucky
     * frame. Mutations drive the sampling, because a flash can begin and end
     * well inside one polling tick.
     *
     * Your own picks move a signature too, so clicks are tracked and a clicked
     * tile is folded back into the baseline instead of counted.
     *
     * A reveal is banked only when it reaches exactly the expected count. A
     * partial reveal is not a smaller sample but a biased one — the numbers
     * most likely to be missed are the ones you picked — so it is discarded.
     *
     * Heat is a z-score so it is comparable across window sizes, and it makes no
     * assumption about board size or draws-per-round: expected hits per number
     * is simply the total drawn spread evenly over the board,
     *     mean = total / spots,  p = (total / rounds) / spots,
     *     z    = (count − mean) / sqrt(rounds · p · (1 − p)).
     * Worth saying plainly: draws are independent, so a hot number is not a
     * likelier number. This shows what HAS happened, not what will.
     */
    function tool_keno_hotspot() {
        'use strict';
        if (tool_keno_hotspot._booted) return;
        tool_keno_hotspot._booted = true;

        var KH_VERSION   = '1.25';
        var MAX_PICKS    = 10;   // every one of the three caps a ticket at 10
        var DRAWS_CAP    = 2000; // rolling history cap (~100KB of JSON)
        var POLL_MS      = 400;

        function qsa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
        function rgb(el) {
            var m = (getComputedStyle(el).backgroundColor || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
            return m ? [+m[1], +m[2], +m[3]] : null;
        }
        function stakeStatus(b) {
            return String(b.getAttribute('data-game-tile-status') || '').toLowerCase();
        }

        var SITES = {
            stake: {
                label: 'Stake',
                key: 'keno-hotspot-stake-v1',
                onPage: function () { return /casino\/games\/keno(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                tiles: function () { return qsa('button[data-testid^="game-tile-"]'); },
                number: function (b, i) {
                    var m = (b.getAttribute('data-testid') || '').match(/game-tile-(\d+)/);
                    if (m) return parseInt(m[1], 10);
                    var d = parseInt(b.dataset ? b.dataset.index : NaN, 10);
                    return isNaN(d) ? (i + 1) : d + 1;
                },
                signature: function (b) { return stakeStatus(b); },
                expect: 10
            },
            shuffle: {
                label: 'Shuffle',
                key: 'keno-hotspot-shuffle-v1',
                onPage: function () { return /games\/originals\/keno(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                tiles: function () { return qsa('button[data-testid^="keno-button-"]'); },
                number: function (b, i) {
                    var m = ((b.dataset && b.dataset.testid) || b.getAttribute('data-testid') || '').match(/keno-button-(\d+)/);
                    return m ? parseInt(m[1], 10) : (i + 1);
                },
                signature: function (b) { return String(b.className || ''); },
                expect: 10
            },
            nuts: {
                label: 'Nuts',
                key: 'keno-hotspot-nuts-v2',
                onPage: function () { return /\/keno(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                // Content-based, mirroring the Nuts Keno tool: a tile is a
                // <button> whose first <span> is exactly a number 1-40, and all
                // 40 must be present. Returned in number order.
                tiles: function () {
                    var byNum = {}, count = 0, btns = qsa('button'), i;
                    for (i = 0; i < btns.length; i++) {
                        var span = btns[i].querySelector('span');
                        if (!span) continue;
                        var txt = (span.textContent || '').trim();
                        var n = parseInt(txt, 10);
                        if (n >= 1 && n <= 40 && txt === String(n) && !byNum[n]) { byNum[n] = btns[i]; count++; }
                    }
                    if (count < 40) return [];
                    var out = [];
                    for (i = 1; i <= 40; i++) out.push(byNum[i]);
                    return out;
                },
                number: function (b, i) { return i + 1; },   // tiles() is number-ordered
                /* The cover element carries the state as a colour. Which colour
                   means what is deliberately NOT encoded here — only that the
                   colour changing is what matters. */
                signature: function (b) {
                    /* Count the SITE's own children only. Our heat tint is
                       appended into the tile, so on a tile with a single real
                       child index 1 landed on OUR span — the signature then
                       tracked the colour we had just painted, and every repaint
                       looked like the board changing by itself. */
                    var kids = [], i, ch = b.children || [];
                    for (i = 0; i < ch.length; i++) {
                        if (ch[i].classList && ch[i].classList.contains('keno-hot-tint')) continue;
                        kids.push(ch[i]);
                    }
                    var cover = kids[1];
                    var c = cover && rgb(cover);
                    return c ? c.join(',') : '';
                },
                expect: 10
            }
        };

        function detectSite() {
            var h = location.hostname;
            if (/shuffle\./i.test(h)) return SITES.shuffle;
            if (/(^|\.)nuts\.gg$/i.test(h)) return SITES.nuts;
            return SITES.stake;
        }
        var SITE    = detectSite();
        // Governed by the site's Keno toggle — the hotspot is part of that
        // tool now, not a separately registered one.
        var TOOL_ID = (SITE === SITES.shuffle ? 'shuffle' : SITE === SITES.nuts ? 'nuts' : 'stake') + '-keno';

        function onPage() { try { return SITE.onPage(); } catch (e) { return false; } }
        /** The control panel's switch. Unknown ids read as enabled. */
        function khEnabled() {
            try { return isToolIdEnabled(TOOL_ID); } catch (e) { return true; }
        }

        /* ---------------------------------------------------------------
           STORE — a rolling list of draws, {t, n:[numbers]}. Keyed per site;
           localStorage is per-origin anyway, but the explicit key keeps a
           multi-brand origin from ever mixing two boards.
           --------------------------------------------------------------- */
        /* `selSigs` is what this site's tiles look like once YOU have tapped
           them. Learned, never hardcoded, and remembered across sessions — see
           the BOARD READING notes. */
        /* Store version. A v1 store can hold a selSigs list poisoned by the
           learning bug fixed in 1.21: a tap that landed while a reveal was in
           flight taught the tool that the DRAWN state was your selection, after
           which every draw containing one of your picks came up short of
           `expect` and was thrown away — permanently, silently, and surviving
           "Reset draws" because that only ever cleared the history. The recorded
           draws are still good, so an upgrade keeps them and drops only the
           calibration; one tap re-learns it. */
        var KH_STORE_V = 2;
        var store = { v: KH_STORE_V, draws: [], window: 100, selSigs: [] };
        try {
            var raw = JSON.parse(localStorage.getItem(SITE.key) || 'null');
            if (raw && Array.isArray(raw.draws)) {
                store.draws = raw.draws;
                if (raw.window != null) store.window = raw.window;
                if (Array.isArray(raw.selSigs) && raw.v === KH_STORE_V) store.selSigs = raw.selSigs;
            }
        } catch (e) {}
        var storeDirty = false;
        function saveStore() { storeDirty = true; }
        setInterval(function () {          // batch writes; the ticker touches these often
            if (!storeDirty) return;
            storeDirty = false;
            try { localStorage.setItem(SITE.key, JSON.stringify(store)); } catch (e) {}
        }, 1200);

        function recordDraw(nums) {
            store.draws.push({ t: Date.now(), n: nums });
            if (store.draws.length > DRAWS_CAP) store.draws.shift();
            saveStore();
        }
        /* Clears the CALIBRATION as well as the history.

           Someone pressing this is saying that what the tool believes is wrong,
           and the thing most likely to be wrong is the learned selected
           signature — while that is wrong nothing is recorded at all. Wiping
           only the draws left them watching a counter that never moved again,
           which is exactly how this was reported: "reset stats breaks the
           hotspot". One tap re-learns it and the status line asks for it. */
        /* Clears the HISTORY and nothing else. It does NOT touch the learned
           selected signature.

           An earlier cut of this wiped the calibration too, on the theory that
           someone pressing Reset is telling the tool its beliefs are wrong. That
           was worse than the bug it was meant to fix: uncalibrated, the tool
           records nothing until you tap a tile, and after a reset your numbers
           are usually already on the board — so there is no reason to tap one,
           and the counter simply never moves again. Reported as "reset draws
           still fucks it up", and correctly.

           Nothing is lost by keeping the calibration: a poisoned one from before
           1.21 is already dropped by the store-version migration, new poisoning
           is prevented by the tap guard in sample(), and if a calibration ever
           does go bad the odd-reveal check below now clears it on its own. */
        function resetStore() {
            /* ONLY the history. Every one of the capture latches is deliberately
               left alone.

               Clearing them was a second, quieter bug: `revealed` is what stops
               the reveal currently on screen from being banked twice, and
               `lastBankedSig` is the belt-and-braces behind it. Resetting both
               re-opened the finished round sitting right there on the board, so
               pressing Reset immediately banked a phantom draw and the counter
               read "1 draw" a second after you cleared it. Measured. `prevSig`
               is re-armed by paintTiles() below anyway. */
            store.draws = [];
            oddLatched = false;
            oddReveals = 0;
            setStatus('');
            saveStore(); render(); paintTiles();
        }

        /* ---------------------------------------------------------------
           STATS
           --------------------------------------------------------------- */
        /** Draws inside the active window. window = 0 means "everything". */
        function windowDraws() {
            var w = store.window | 0;
            if (!w || w >= store.draws.length) return store.draws;
            return store.draws.slice(store.draws.length - w);
        }

        /**
         * Per-number counts and z-scores. Makes no assumption about board size
         * or draws-per-round — both are taken from the data.
         */
        function computeHeat(draws, spots) {
            spots = spots || 40;
            var counts = new Array(spots + 1).fill(0), total = 0, i, j;
            for (i = 0; i < draws.length; i++) {
                var d = draws[i].n;
                for (j = 0; j < d.length; j++) {
                    var v = d[j];
                    if (v >= 1 && v <= spots) { counts[v]++; total++; }
                }
            }
            var rounds = draws.length;
            var mean = spots > 0 ? total / spots : 0;
            var p = (rounds > 0 && spots > 0) ? (total / rounds) / spots : 0;
            var sd = Math.sqrt(rounds * p * (1 - p));
            var z = new Array(spots + 1).fill(0);
            if (rounds > 0 && sd > 0) {
                for (i = 1; i <= spots; i++) z[i] = (counts[i] - mean) / sd;
            }
            return { counts: counts, z: z, rounds: rounds, mean: mean, sd: sd, spots: spots, total: total };
        }

        /* ---------------------------------------------------------------
           REPEAT GROUPS
           Which COMBINATIONS have come up together in the same draw more than
           once. Raw repeat counts alone are misleading: with ten spots drawn
           from forty, any given PAIR shares a draw 5.8% of the time, so over 200
           rounds the average pair repeats about twelve times and a pair seen
           twice means nothing at all. A specific trio shares a draw 1.2% of the
           time and a specific quad 0.23%, so those carry real weight quickly.

           This exists because people want to SEE which numbers keep landing
           together, so it always lists the top repeats rather than hiding them.
           An earlier cut gated the list behind a multiple-comparison correction
           and was statistically right and practically useless: on real keno it
           printed "nothing beyond what chance produces" every single time. The
           correction is still computed — it just labels a row instead of
           suppressing it, so a repeat that IS unusual is marked and the rest are
           shown with what chance predicts beside them.

           Sizes 2-4 are enumerated directly; a recurring group of five or more
           surfaces as several of its quads.

           Same caveat as the heatmap: draws are independent. A group that has
           repeated is not a group that is due.
           --------------------------------------------------------------- */
        /** P(a specific k-number group all appear in one draw). */
        function comboProb(k, picks, spots) {
            var p = 1, i;
            for (i = 0; i < k; i++) p *= (picks - i) / (spots - i);
            return p;
        }
        /** P(a group appears at least `c` times), Poisson with mean `mean`. */
        function poissonTail(c, mean) {
            if (c <= 0) return 1;
            var term = Math.exp(-mean), cum = term, i;
            for (i = 1; i < c; i++) { term *= mean / i; cum += term; }
            return Math.max(0, 1 - cum);
        }
        function nCk(n, k) {
            var r = 1, i;
            for (i = 0; i < k; i++) r = r * (n - i) / (i + 1);
            return r;
        }
        function computeCombos(draws, spots, maxGroups) {
            spots = spots || 40;
            var rounds = draws.length;
            if (rounds < 2) return [];
            var counts = {}, i, a, b, c, d, key, nums;
            for (i = 0; i < rounds; i++) {
                nums = draws[i].n.slice().sort(function (x, y) { return x - y; });
                for (a = 0; a < nums.length; a++)
                    for (b = a + 1; b < nums.length; b++) {
                        key = nums[a] + ',' + nums[b];
                        counts[key] = (counts[key] || 0) + 1;
                        for (c = b + 1; c < nums.length; c++) {
                            key = nums[a] + ',' + nums[b] + ',' + nums[c];
                            counts[key] = (counts[key] || 0) + 1;
                            for (d = c + 1; d < nums.length; d++) {
                                key = nums[a] + ',' + nums[b] + ',' + nums[c] + ',' + nums[d];
                                counts[key] = (counts[key] || 0) + 1;
                            }
                        }
                    }
            }
            var picksPerDraw = rounds ? Math.round(draws.reduce(function (s, x) { return s + x.n.length; }, 0) / rounds) : 10;
            /* Correct for how many combinations were examined. There are 780
               possible pairs, 9,880 trios and 91,390 quads, and we report the
               most extreme of them — so the winner looks impressive by
               construction. Measured on 400 RANDOM draws the top group scored
               7.4 standard deviations, which ranked by sigma alone would have
               been presented as a real pattern. `expectedByChance` is how many
               groups this extreme random data would throw up: below 0.05 it is
               worth showing, above it we are just admiring noise. */
            var pByK = {}, cByK = {}, bySize = { 2: [], 3: [], 4: [] };
            for (key in counts) {
                if (!Object.prototype.hasOwnProperty.call(counts, key)) continue;
                var cnt = counts[key];
                if (cnt < 2) continue;                       // "more than once" only
                var k = key.split(',').length;
                if (pByK[k] === undefined) {
                    pByK[k] = comboProb(k, picksPerDraw, spots);
                    cByK[k] = nCk(spots, k);
                }
                var mean = rounds * pByK[k];
                /* How many groups this size chance alone would push this far.
                   Below 1 the repeat is genuinely unusual; above it, the only
                   reason this group stands out is that 91,390 quads were
                   examined and one of them had to come top. Kept as a LABEL,
                   not a filter — see the note above.

                   The bar is 0.01, not the usual 0.05. Highlighting is the one
                   claim this panel makes that has to hold up, and it is checked
                   for three group sizes on every scan: at 0.05 roughly one scan
                   in seven of pure noise would light something up. */
                var expectedByChance = poissonTail(cnt, mean) * cByK[k];
                bySize[k].push({
                    nums: key, size: k, count: cnt, expected: mean,
                    chance: expectedByChance, notable: expectedByChance < 0.01
                });
            }
            /* Ranked WITHIN each size and quota'd across them. Ranking the whole
               pool together only ever returns pairs — they repeat far more often
               than trios or quads, so eight near-identical pair rows would crowd
               out the quad that is actually interesting to look at. Within one
               size every group has the same expectation, so "most repeats" and
               "most unusual" are the same ordering. */
            var quota = { 2: 3, 3: 3, 4: 2 }, out = [], k2;
            for (k2 = 2; k2 <= 4; k2++) {
                bySize[k2].sort(function (x, y) { return y.count - x.count || (x.nums < y.nums ? -1 : 1); });
                out = out.concat(bySize[k2].slice(0, quota[k2]));
            }
            out.sort(function (x, y) { return y.size - x.size || y.count - x.count; });
            return out.slice(0, maxGroups || 8);
        }

        /** Numbers ranked hottest-first (or coldest-first). Ties break by number
         *  so the ordering is stable and reproducible. */
        function ranked(heat, coldest) {
            var out = [], i;
            for (i = 1; i <= heat.spots; i++) out.push(i);
            out.sort(function (a, b) {
                var d = coldest ? (heat.counts[a] - heat.counts[b]) : (heat.counts[b] - heat.counts[a]);
                return d || (a - b);
            });
            return out;
        }

        /* ---------------------------------------------------------------
           API CAPTURE — the authoritative source, when it is available.

           Reading pixels was always the fallback plan. The site states the
           result outright; a bet response carries both halves of the round:

             {"kenoBet":{ "id":"914ea109-…", "game":"keno",
               "state":{ "drawnNumbers":[27,8,24,38,37,36,26,32,39,1],
                         "selectedNumbers":[4,2,12,23,15,27,29,28,22,35] }}}

           Captured live from stake.us 2026-08-08. Everything the DOM reader has
           to infer is simply given: which ten came up, which ten were yours, and
           an `id` to deduplicate on. So with the API running there is no settled
           test to lose a fast round, no fade to misread, and NO CALIBRATION —
           the tap that people kept having to be told about stops mattering.

           The hook is installed at tool boot rather than document-start because
           a late hook demonstrably works here: this exact payload was captured
           from the console long after the page had loaded. fetch AND XHR are
           both wrapped, since that console test could not say which one carried
           it and the cost of covering both is nil.

           The DOM reader below is NOT removed. It still runs whenever the API
           has gone quiet — a page opened before the script, a payload change,
           a site that does not expose one — and it is what drives the heat tint
           in every case.
           --------------------------------------------------------------- */
        var apiQueue    = [];      // draws captured, waiting to be banked
        var apiSeen     = {};      // bet id -> true
        var apiSeenAge  = [];      // insertion order, so the id set stays bounded
        var API_ID_CAP  = 400;
        var apiLastAt   = 0;       // when the API last produced a draw
        var apiPicks    = null;    // selectedNumbers from the latest bet
        var API_TRUST_MS = 45000;  // treat the API as live for this long after one

        /** True while the API is carrying the round, so the DOM must not also bank. */
        function apiLive() { return apiLastAt > 0 && (Date.now() - apiLastAt) < API_TRUST_MS; }

        function apiRemember(key) {
            apiSeen[key] = true;
            apiSeenAge.push(key);
            while (apiSeenAge.length > API_ID_CAP) delete apiSeen[apiSeenAge.shift()];
        }

        function apiPush(id, drawn, selected) {
            var nums = [], i, v;
            for (i = 0; i < drawn.length; i++) {
                v = +drawn[i];
                if (isFinite(v) && v >= 1) nums.push(v);
            }
            /* Same completeness rule as the DOM path: a partial set is a biased
               sample, not a smaller one. */
            if (nums.length !== SITE.expect) return;
            nums.sort(function (a, b) { return a - b; });
            /* Dedupe on the bet id — exact, and far better than the DOM path's
               "same ten twice in a row inside 15s" heuristic. Responses do get
               replayed: the same bet can arrive again in a history query. */
            var key = id ? ('i' + id) : ('n' + nums.join(','));
            if (apiSeen[key]) return;
            apiRemember(key);
            if (Array.isArray(selected)) {
                apiPicks = selected.map(Number).filter(function (n) { return isFinite(n) && n >= 1; });
            }
            apiQueue.push(nums);
        }

        /* ONLY YOUR OWN BETS. This allowlist is the whole safety of the feature.

           Both sites publish other people's play in a byte-identical shape —
           Nuts has Live Games and Big Wins beside My Games, Stake has its public
           bet feeds. A scanner that matched on shape alone would happily fold
           strangers' draws into your history, and the numbers would look fine
           while meaning nothing. So a bet counts only when it was reached under
           a key that means "mine":

             kenoBet   Stake — the response to your own bet mutation
             myGames   Nuts  — the socket feed of your own games
                              (the Nuts frame observed 2026-08-08 arrives as
                               payload.data.myGames[].details)

           Fails closed: if either site renames its key, capture stops and the
           DOM reader takes over, rather than quietly recording the wrong thing. */
        var API_OWN_KEYS = { kenoBet: 1, kenoBets: 1, myGames: 1 };

        /** Depth-first: the bet's position inside the envelope is not assumed —
         *  it is wrapped in `data`, sometimes batched, and shaped differently per
         *  site. `ownKey` tracks whether we are inside one of the containers
         *  above. Bounded depth so a huge payload cannot turn this into a stall. */
        function apiScan(node, depth, ownKey) {
            if (!node || typeof node !== 'object' || depth > 8) return;
            if (Array.isArray(node)) {
                for (var i = 0; i < node.length && i < 200; i++) apiScan(node[i], depth + 1, ownKey);
                return;
            }
            /* Stake puts the numbers on `state`, Nuts on `details`. */
            var st = node.state || node.details;
            if (ownKey && st && Array.isArray(st.drawnNumbers) && st.drawnNumbers.length) {
                /* Reject a sibling game that happens to ride the same feed.
                   Nuts tags it (`KenoGameDetails`), Stake names it (`game`). */
                var tn = st.__typename || node.__typename || node.game;
                if (tn === undefined || /keno/i.test(String(tn))) {
                    apiPush(node.id, st.drawnNumbers, st.selectedNumbers);
                }
            }
            for (var k in node) {
                if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
                apiScan(node[k], depth + 1, ownKey || !!API_OWN_KEYS[k]);
            }
        }

        function apiHandleText(text) {
            /* Cheap gate first. Every response and socket frame on the site
               passes through here, so parsing them all would be wasteful; only a
               keno bet can contain this key. */
            if (typeof text !== 'string' || !text || text.length > 400000) return;
            if (text.indexOf('drawnNumbers') < 0) return;
            try { apiScan(JSON.parse(text), 0, false); } catch (e) {}
        }

        function installApiTap() {
            var W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
            if (W.__kenoHotspotTap) return;      // one wrap per page, whatever mounts us
            W.__kenoHotspotTap = true;
            try {
                var of = W.fetch;
                if (of) {
                    W.fetch = function () {
                        var p = of.apply(this, arguments);
                        try {
                            p.then(function (res) {
                                try { res.clone().text().then(apiHandleText).catch(function () {}); } catch (e) {}
                            }).catch(function () {});
                        } catch (e) {}
                        return p;
                    };
                }
            } catch (e) {}
            try {
                var oSend = W.XMLHttpRequest.prototype.send;
                W.XMLHttpRequest.prototype.send = function () {
                    var self = this;
                    try {
                        this.addEventListener('load', function () {
                            try { apiHandleText(self.responseText); } catch (e) {}
                        });
                    } catch (e) {}
                    return oSend.apply(this, arguments);
                };
            } catch (e) {}
            /* WebSocket — this is how Nuts delivers a bet result. Attaching from
               `send` rather than from the constructor is deliberate and is the
               same trick the bundle's existing Nuts hook uses: it catches a
               socket that was ALREADY OPEN before we loaded, because the page
               keeps sending on it. Wrapping only the constructor would miss the
               live socket entirely on a late mount. */
            try {
                var oWsSend = W.WebSocket.prototype.send;
                W.WebSocket.prototype.send = function () {
                    try {
                        if (!this.__kenoHotspotPeek) {
                            this.__kenoHotspotPeek = true;
                            this.addEventListener('message', function (ev) {
                                try { apiHandleText(ev.data); } catch (e) {}
                            });
                        }
                    } catch (e) {}
                    return oWsSend.apply(this, arguments);
                };
            } catch (e) {}
        }

        /** Bank whatever the API has handed us since the last tick. */
        function drainApi() {
            if (!apiQueue.length) return;
            while (apiQueue.length) {
                recordDraw(apiQueue.shift());
                apiLastAt = Date.now();
            }
            render();
            paintTiles();
        }

        /* ---------------------------------------------------------------
           BOARD READING

           A tile's "signature" is however the site renders its state: an
           attribute on Stake, a class on Shuffle, a colour on Nuts. The tool
           deliberately does NOT know which signature means "drawn". A reveal is
           just the set of tiles whose signature changed from what it was
           immediately before that reveal began.

           That is what makes Nuts work. Its hits flash green and then revert to
           the picked colour, and its drawn colour is documented nowhere — it was
           guessed twice here and wrong both times. Comparing against a baseline
           needs neither fact, and it retires the last hardcoded state names on
           Stake and Shuffle too.

           Your own picks change a signature as well, and would otherwise read as
           part of a draw. Clicks are watched to exclude them: a tile you (or
           Pick hottest) click is folded straight back into the baseline; a tile
           the game reveals is not.
           --------------------------------------------------------------- */
        function tiles() { try { return SITE.tiles() || []; } catch (e) { return []; } }
        function boardSize() { var n = tiles().length; return n || 40; }

        /** number -> signature for every tile, or null if the board isn't up. */
        function readSignatures() {
            var all = tiles(), out = {}, i, n;
            if (!all.length) return null;
            for (i = 0; i < all.length; i++) {
                n = SITE.number(all[i], i);
                if (!n) continue;
                try { out[n] = String(SITE.signature(all[i])); } catch (e) { out[n] = ''; }
            }
            return out;
        }
        /** The signature the majority of tiles are showing: the board at rest.
         *  A ticket is at most 10 of 40 and a draw is 10 of 40, so resting always
         *  holds the plurality and no colour or class name has to be known. */
        function restingSig(sig) {
            var freq = {}, best = -1, rest = null, k;
            for (k in sig) {
                if (!Object.prototype.hasOwnProperty.call(sig, k)) continue;
                freq[sig[k]] = (freq[sig[k]] || 0) + 1;
                if (freq[sig[k]] > best) { best = freq[sig[k]]; rest = sig[k]; }
            }
            return best > 0 ? rest : null;
        }
        /** Your live selection: tiles wearing a signature learned from tiles YOU
         *  tapped. Measured on nuts.gg: reading this as "anything not resting"
         *  returned 17 numbers on a settled board — your 1 remaining pick plus
         *  all 10 drawn tiles plus fade frames. */
        function currentPicks() {
            var sig = readSignatures();
            if (!sig) return [];
            var out = [], k;
            for (k in sig) {
                if (!Object.prototype.hasOwnProperty.call(sig, k)) continue;
                if (store.selSigs.indexOf(sig[k]) >= 0) out.push(+k);
            }
            return out;
        }

        /* Every earlier version asked "how many tiles changed?" and guessed from
           the count. It cannot work, because a ticket and a draw are both up to
           ten tiles. Measured on a live nuts.gg board, one round, two picks:

               29 resting · 9 green · 1 transparent · 1 purple

           Clicking a tile settles it to purple, so purple is SELECTED. Green and
           transparent together are exactly ten — the draw, split into "you had
           it" and "you didn't". The tool saw eleven changed tiles and threw the
           whole reveal away; when the counts happened to line up it banked the
           first ten to move, mixing picks into the draw. Both reported bugs, one
           cause. The site's own Auto pick is the same fault from the other side:
           ten tiles enter the selected state with no click for the tool to
           notice, which is indistinguishable from a reveal under a count rule.

           So classify by STATE, and learn the states rather than hardcoding
           them (Nuts' drawn colour was guessed twice here and wrong twice):

             · resting  — the plurality signature
             · selected — what a tile becomes when YOU tap it, learned on first
                          tap and remembered per site
             · drawn    — any other settled signature

           Two supporting rules make it hold up:

           SETTLED ONLY. A signature must be identical to the previous sample's
           to count. Nuts fades between colours, and one click walked through
           REST > 64,73,93 > 92,64,147 > 141,49,238 > PURPLE. Every one of those
           frames is "not resting and not selected", so without this the fade
           itself reads as a draw.

           NOTHING UNTIL A TAP. With no learned selected signature the tool
           cannot tell your ticket from a reveal, so it records nothing and says
           so. One tap per site, once, and it is calibrated for good. */
        var MAX_SEL_SIGS = 6;     // room for hit/selected variants; bounded so a
                                  // theme change cannot grow the list forever
        var CLICK_LEARN_MS = 6000; // how long a tap waits for its tile to settle
        var prevSig = null;       // the previous sample, for the settled test
        var revealed = false;     // this reveal is already banked
        var pendingClick = {};    // number -> when it was tapped, awaiting settle
        var lastBankedSig = '';   // the last set banked, to reject a re-read
        var lastBankedAt = 0;
        var DUPE_WINDOW_MS = 15000;
        var oddReveals = 0;       // consecutive rounds whose reveal was discarded
        var oddLatched = false;   // this reveal has already been counted as odd
        var ODD_REVEAL_WARN = 5;  // rounds of that before saying so out loud

        function learnSelected(sig) {
            if (!sig || store.selSigs.indexOf(sig) >= 0) return;
            store.selSigs.push(sig);
            while (store.selSigs.length > MAX_SEL_SIGS) store.selSigs.shift();
            saveStore();
        }

        /* Both your taps and the tool's own (Pick hottest clicks for real) land
           here, so the selected signature is learned either way. */
        document.addEventListener('click', function (e) {
            try {
                var node = e.target && e.target.closest ? e.target.closest('button') : null;
                if (!node) return;
                var all = tiles(), i;
                for (i = 0; i < all.length; i++) {
                    if (all[i] === node || all[i].contains(node)) {
                        pendingClick[SITE.number(all[i], i)] = Date.now();
                        return;
                    }
                }
            } catch (err) { /* never interfere with the page's own handling */ }
        }, true);

        /** True once this site's selected signature is known. Until then the tool
         *  cannot separate your ticket from a reveal, so it refuses to guess. */
        function calibrated() { return store.selSigs.length > 0; }

        function sample() {
            /* The API is exact; the DOM is an inference. When both are running,
               the DOM must not also bank or every round lands twice. */
            if (apiLive()) return;
            var sig = readSignatures();
            if (!sig) return;
            var prev = prevSig;
            prevSig = sig;
            if (!prev) return;

            /* Settled only — a signature has to match the previous sample. This
               is what keeps a CSS fade from reading as a reveal. */
            var settled = {}, k, now = Date.now();
            for (k in sig) {
                if (!Object.prototype.hasOwnProperty.call(sig, k)) continue;
                if (sig[k] === prev[k]) settled[k] = sig[k];
            }
            var rest = restingSig(settled);
            if (rest === null) return;

            /* A TAP MOVES ONE TILE. A REVEAL MOVES TEN.

               That is the whole of the guard below, and without it the tool can
               be taught a lie it never recovers from. Tap a number while a round
               is resolving and that same tile comes back as a HIT; the tap is
               still pending, the hit signature is settled and not resting, so it
               was learned as "selected". From then on every draw containing one
               of your picks is one tile short of `expect` and is discarded —
               reproduced here on a mock Stake board: one mid-round tap, then ten
               clean rounds, zero recorded. It persists to localStorage, so it
               outlives a reload, and "Reset draws" used to leave it in place.

               So a tap only teaches while nothing else is moving: no UNTAPPED
               tile may be sitting in an unknown state. If one is, the pending
               tap simply waits — when the board clears, the tile settles back to
               your real selected colour and teaches the right thing instead. */
            var strangers = 0;
            for (k in settled) {
                if (!Object.prototype.hasOwnProperty.call(settled, k)) continue;
                if (settled[k] === rest) continue;
                if (store.selSigs.indexOf(settled[k]) >= 0) continue;
                if (pendingClick[k] !== undefined) continue;
                strangers++;
            }

            /* Learn what "selected" looks like from a tile you just tapped, once
               it has stopped moving. A tap that only DESELECTS lands back on the
               resting signature and teaches nothing, which is correct. */
            for (k in pendingClick) {
                if (!Object.prototype.hasOwnProperty.call(pendingClick, k)) continue;
                if (!strangers && settled[k] !== undefined && settled[k] !== rest) {
                    learnSelected(settled[k]);
                    delete pendingClick[k];
                } else if (now - pendingClick[k] > CLICK_LEARN_MS) {
                    delete pendingClick[k];
                }
            }
            if (!calibrated()) return;

            /* Drawn = settled, not resting, not one of the selected states. On
               the measured Nuts board that is the 9 green plus the 1 transparent
               — exactly ten — while the purple pick is correctly left out. */
            var drawn = [];
            for (k in settled) {
                if (!Object.prototype.hasOwnProperty.call(settled, k)) continue;
                if (settled[k] === rest) continue;
                if (store.selSigs.indexOf(settled[k]) >= 0) continue;
                drawn.push(+k);
            }

            /* The result stays on screen until the next round, so the latch is
               released by the board going clear rather than by a timer. */
            if (!drawn.length) { revealed = false; oddLatched = false; return; }
            if (revealed) return;
            /* Only a complete reveal. A partial one is not a smaller sample, it
               is a biased one — the tiles most likely to be missed are the ones
               you picked, whose flash is shortest.

               Throwing one away is routine: it is usually a frame caught
               mid-animation. Throwing away every round is not — that is what a
               wrong calibration looks like from the outside, and it used to
               happen in complete silence, which is why the only symptom anyone
               could report was "it stopped working". Count them once per round
               and say so when it is plainly no longer animation. */
            if (drawn.length !== SITE.expect) {
                if (!oddLatched && drawn.length >= SITE.expect - 3) {
                    oddLatched = true;
                    /* Round after round of near-misses means the learned selected
                       signature is wrong — a tile the tool thinks is your pick is
                       really part of the draw, so every reveal lands short. Drop
                       the calibration and re-learn rather than telling the player
                       to go and press a button: they should not have to know what
                       a signature is, and the old advice pointed at Reset, which
                       no longer clears it. */
                    if (++oddReveals >= ODD_REVEAL_WARN) {
                        store.selSigs = [];
                        oddReveals = 0;
                        saveStore();
                        setStatus('Kept reading ' + drawn.length + ' revealed tiles where ' + SITE.expect +
                                  ' are expected — relearning this site’s colours. Click any number once.');
                    }
                }
                return;
            }
            oddReveals = 0;
            oddLatched = false;

            drawn.sort(function (a, b) { return a - b; });
            /* Belt and braces on top of the latch: never the same ten twice in a
               row. A live store once held 1309 draws of which only 1005 were
               distinct — 303 consecutive duplicates, some sets banked 35 times,
               which on its own made the board look hot. Two identical
               consecutive keno draws are a 1-in-847-million event. */
            var sig10 = drawn.join(',');
            if (sig10 === lastBankedSig && now - lastBankedAt < DUPE_WINDOW_MS) return;
            revealed = true;
            lastBankedSig = sig10;
            lastBankedAt = now;
            recordDraw(drawn);
            render();
            paintTiles();
        }

        /* Driven by mutations rather than by the clock: a Nuts hit can flash and
           revert well inside one 400ms tick, so a poll never sees it. The ticker
           still calls sample() as a safety net for anything that changes without
           mutating the subtree. */
        var mo = null, moRoot = null, sampleQueued = false, confirmTimer = null;
        /* How long after the board stops changing to take a second look. The
           settled test needs the SAME signature twice running, and until this
           existed the only two sources of samples were the mutation itself (one
           look, at the instant of the change) and the POLL_MS tick. Anything
           that came and went inside one poll was therefore seen exactly once and
           thrown away as unsettled.

           That is precisely what a site's own autoplay does. Measured on a mock
           board before this was added: one round every 2000ms captured 10 of 10,
           800ms captured 7, 520ms captured 4, and 320ms captured 1 of 10. The
           player sees a counter that barely moves and reasonably concludes the
           tool has stopped recognising the board — reported after a Reset, where
           a stalled count from zero is most obvious.

           Debounced, so a run of mutations (an animation) pushes it back and it
           fires once things are actually still — which is the moment worth
           reading. Cheap: it only runs when the board has changed. */
        /* Per site, because the risk it trades against is per site. The delay
           exists so a fade cannot be read twice and mistaken for a settled
           state — but only Nuts actually fades: its signature is a COMPUTED
           COLOUR, and one click there was measured walking REST > 64,73,93 >
           92,64,147 > 141,49,238 > PURPLE. Stake's signature is the discrete
           `data-game-tile-status` attribute and Shuffle's is a class list; both
           flip atomically, with no in-between value to catch. So they can
           confirm much sooner and keep up with faster autoplay, while Nuts keeps
           the long window that its colour transition needs. */
        var CONFIRM_MS = (SITE === SITES.nuts) ? 140 : (SITE === SITES.shuffle ? 80 : 60);
        function scheduleSample() {
            if (!sampleQueued) {
                sampleQueued = true;
                var run = function () { sampleQueued = false; try { sample(); } catch (e) {} };
                if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
                else setTimeout(run, 0);
            }
            if (confirmTimer) clearTimeout(confirmTimer);
            confirmTimer = setTimeout(function () {
                confirmTimer = null;
                try { sample(); } catch (e) {}
            }, CONFIRM_MS);
        }
        function watchBoard() {
            var all = tiles();
            if (!all.length) return;
            var root = all[0].parentNode;
            if (!root || root === moRoot) return;      // already watching this board
            if (mo) mo.disconnect();
            moRoot = root;
            mo = new MutationObserver(scheduleSample);
            mo.observe(root, {
                subtree: true, childList: true, attributes: true,
                attributeFilter: ['class', 'style', 'data-game-tile-status']
            });
        }

        /* ---------------------------------------------------------------
           APPLYING PICKS
           --------------------------------------------------------------- */
        function clickTile(n) {
            var all = tiles(), i;
            for (i = 0; i < all.length; i++) {
                if (SITE.number(all[i], i) === n) {
                    if (all[i].disabled) return false;
                    all[i].click();
                    return true;
                }
            }
            return false;
        }
        function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

        /** Toggle the board to exactly `want`; only the difference is clicked. */
        var applying = false;
        async function applyNumbers(want) {
            if (applying) return;
            applying = true;
            try {
                var have = currentPicks(), i;
                for (i = 0; i < have.length; i++) {
                    if (want.indexOf(have[i]) < 0) { clickTile(have[i]); await sleep(45); }
                }
                for (i = 0; i < want.length; i++) {
                    if (have.indexOf(want[i]) < 0) { clickTile(want[i]); await sleep(45); }
                }
            } finally { applying = false; }
            render();
        }

        function applyExtreme(coldest) {
            var heat = computeHeat(windowDraws(), boardSize());
            if (!heat.rounds) { setStatus('No draws recorded yet — play a few rounds.'); return; }
            var count = Math.max(1, Math.min(MAX_PICKS, parseInt(elSpots && elSpots.value, 10) || 10));
            var pick = ranked(heat, coldest).slice(0, count).sort(function (a, b) { return a - b; });
            applyNumbers(pick);
            setStatus((coldest ? 'Coldest ' : 'Hottest ') + count + ': ' + pick.join(', '));
        }

        /* ---------------------------------------------------------------
           TILE TINTING — an absolutely-positioned, pointer-events:none child,
           so the tile stays clickable and the site's own colours read through.
           --------------------------------------------------------------- */
        /* Banded rather than one continuous ramp. A smooth gradient makes
           "slightly above expectation" and "well above" two similar oranges you
           cannot tell apart at a glance; discrete steps give each degree its own
           colour, so a mild lean reads as pale yellow and only a genuine outlier
           reaches red. Thresholds are in standard deviations, so they mean the
           same thing at 50 draws or 500. */
        var HEAT_BANDS = [
            { z: 2.50, hot: '244,63,54',   cold: '37,99,235',   a: 0.60, name: 'very hot',  cname: 'very cold' },
            { z: 1.75, hot: '251,113,36',  cold: '59,130,246',  a: 0.50, name: 'hot',       cname: 'cold' },
            { z: 1.00, hot: '250,176,46',  cold: '96,165,250',  a: 0.38, name: 'warm',      cname: 'cool' },
            /* The mildest band is deliberately PALER and slightly stronger than
               a linear ramp would make it. On these near-black boards a faint
               wash of any colour just reads as muddy olive/grey; lifting the
               luminance is what makes "barely above expectation" look light
               rather than dark. Checked on a live Shuffle board. */
            { z: 0.45, hot: '255,238,160', cold: '190,225,255', a: 0.34, name: 'mild',      cname: 'mild' }
        ];
        function tintFor(z) {
            var az = Math.abs(z), i;
            for (i = 0; i < HEAT_BANDS.length; i++) {
                if (az >= HEAT_BANDS[i].z)
                    return 'rgba(' + (z > 0 ? HEAT_BANDS[i].hot : HEAT_BANDS[i].cold) + ',' + HEAT_BANDS[i].a + ')';
            }
            return null;                                      // near expectation: leave clean
        }
        /** The GLOW colour only — the ring itself stays white. Tried the accent
         *  for both on a live Shuffle board and the pick vanished: Shuffle already
         *  paints a selected tile solid #6c47ff, so a #6c47ff ring on it is
         *  invisible. White reads against every one of the three brand colours
         *  (purple, neon green, slate) and the accent glow keeps it themed. */
        function pickRingColour() {
            return SITE === SITES.shuffle ? '#6c47ff'
                 : SITE === SITES.nuts    ? '#19f3ff'
                 : '#00ff9d';
        }
        /* Anything WE draw on the board has to be invisible to the capture. The
           tint is a child of the tile and the observer watches the subtree, so
           our own repaint fires a sample and can shift a signature. Re-read the
           baseline immediately afterwards and nothing we did can read as a
           reveal. "Reset draws" was the loud version of this: clearing forty
           tints at once changed forty signatures in one go, and the next sample
           banked a phantom draw straight after you cleared the history. */
        function rearmCapture() {
            /* Deliberately does NOT clear `revealed`. That latch is what stops a
               round being banked twice, and clearing it here — right after
               sample() calls paintTiles() — re-opened the round the instant it
               had been banked. Re-reading prevSig only costs the next sample its
               settled test, which the following one recovers. */
            prevSig = readSignatures();
        }
        function clearTints() {
            var old = document.querySelectorAll('.keno-hot-tint'), i;
            for (i = 0; i < old.length; i++) old[i].remove();
            rearmCapture();
        }
        function paintTiles() {
            if (!showHeat) { clearTints(); return; }
            var all = tiles();
            if (!all.length) return;
            var heat = computeHeat(windowDraws(), all.length);
            if (!heat.rounds) { clearTints(); return; }
            /* Your picks get an accent ring. It is drawn on the SAME overlay span
               as the heat tint on purpose: that span is already excluded from the
               tile signature, so outlining a pick cannot be mistaken for the board
               changing. Putting a class or an outline on the tile BUTTON would
               change the signature on Shuffle, where the signature is the button's
               class list — the tool would then read its own highlight as a draw. */
            /* Your ticket, straight from the bet response when we have one —
               `selectedNumbers` needs no learned signature to interpret, so the
               pick ring keeps working even on a board that was never calibrated. */
            var ring = pickRingColour(), picked = {}, pi;
            var pk = (apiLive() && apiPicks) ? apiPicks : currentPicks();
            for (pi = 0; pi < pk.length; pi++) picked[pk[pi]] = true;

            for (var i = 0; i < all.length; i++) {
                var btn = all[i], n = SITE.number(btn, i);
                if (!n) continue;
                var col = tintFor(heat.z[n]);
                var isPick = !!picked[n];
                var tint = btn.querySelector('.keno-hot-tint');
                /* With Counts on, EVERY tile carries its number — a tile sitting
                   at expectation has no tint, and leaving it blank made the count
                   look like it only existed for hot numbers. The figure is
                   recomputed from the window on each repaint, so it falls as
                   draws age out of the last-50/100/250 as well as rising. */
                if (!col && !isPick && !showCounts) { if (tint) tint.remove(); continue; }
                if (!tint) {
                    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
                    tint = document.createElement('span');
                    tint.className = 'keno-hot-tint';
                    btn.appendChild(tint);
                }
                tint.style.background = col || 'transparent';
                tint.style.boxShadow = isPick ? 'inset 0 0 0 2px rgba(255,255,255,.95), 0 0 9px 1px ' + ring : '';
                tint.textContent = showCounts ? String(heat.counts[n]) : '';
            }
            rearmCapture();
        }

        /* ---------------------------------------------------------------
           PANEL — the hotspot is not its own window. It mounts as a section
           inside the Keno preset panel (#keno-preset-gui) that the site's Keno
           tool builds, so there is one panel and one enable/disable toggle.
           Colours come from the host panel: --kp-accent is set per site, and
           everything else is a translucent wash over whatever background the
           host uses, so this section themes itself on Stake, Shuffle and Nuts
           without knowing anything about them.
           --------------------------------------------------------------- */
        var CSS =
            '#keno-preset-gui .kh-sect{border-top:1px solid rgba(255,255,255,.10);' +
            'margin-top:2px;padding-top:10px;display:flex;flex-direction:column;gap:8px}' +
            '#keno-preset-gui .kh-sect *{box-sizing:border-box}' +
            '#keno-preset-gui .kh-sect-head{display:flex;align-items:center;justify-content:space-between;' +
            'font-size:10px;letter-spacing:.6px;text-transform:uppercase;opacity:.65}' +
            '#keno-preset-gui .kh-sect-head b{color:var(--kp-accent,#10b981);font-weight:700}' +
            '#keno-preset-gui .kh-row{display:flex;align-items:center;justify-content:space-between;' +
            'gap:8px;font-size:11px}' +
            '#keno-preset-gui .kh-sect select,#keno-preset-gui .kh-sect input[type=number]{' +
            'background:rgba(0,0,0,.28);color:inherit;border:1px solid rgba(255,255,255,.14);' +
            'border-radius:5px;padding:3px 6px;font-size:11px;font-family:inherit}' +
            '#keno-preset-gui .kh-sect input[type=number]{width:52px;text-align:center}' +
            '#keno-preset-gui .kh-sect select:focus,#keno-preset-gui .kh-sect input:focus{' +
            'outline:none;border-color:var(--kp-accent,#10b981)}' +
            '#keno-preset-gui .kh-list{background:rgba(0,0,0,.24);border-radius:5px;padding:6px 8px;' +
            'font-size:11px;line-height:1.55}' +
            '#keno-preset-gui .kh-list b{font-variant-numeric:tabular-nums}' +
            '#keno-preset-gui .kh-hot b{color:#f87171}' +
            '#keno-preset-gui .kh-cold b{color:#60a5fa}' +
            '#keno-preset-gui .kh-rep b{color:var(--kp-accent,#10b981)}' +
            '#keno-preset-gui .kh-rep i{opacity:.55;font-style:normal;font-size:9px}' +
            '#keno-preset-gui .kh-rep-row{display:block;line-height:1.5}' +
            /* A repeat that chance alone does not account for. Rare by design —
               most rows are ordinary, and marking the odd one keeps the list
               honest without hiding anything. */
            '#keno-preset-gui .kh-rep-hot b{color:#fbbf24}' +
            '#keno-preset-gui .kh-rep-hot i{opacity:.85;color:#fbbf24}' +
            '#keno-preset-gui .kh-scan{margin-left:6px;background:rgba(255,255,255,.09);' +
              'border:1px solid rgba(255,255,255,.16);color:inherit;border-radius:4px;' +
              'font-size:9px;padding:1px 6px;cursor:pointer;text-transform:none;letter-spacing:0}' +
            '#keno-preset-gui .kh-scan:hover{background:rgba(255,255,255,.2)}' +
            '#keno-preset-gui .kh-k{display:block;opacity:.5;text-transform:uppercase;font-size:9px;' +
            'letter-spacing:.5px;margin-bottom:2px}' +
            /* Legend. The swatch is the tint composited over a tile-dark base, so
               it is the colour that lands on the board rather than a description
               of it. Wraps, because the label widths move with the window size. */
            '#keno-preset-gui .kh-legend{display:flex;flex-direction:column;gap:3px}' +
            '#keno-preset-gui .kh-lgrow{display:flex;flex-wrap:wrap;gap:3px 7px;' +
              'font-size:9px;opacity:.75;font-variant-numeric:tabular-nums}' +
            '#keno-preset-gui .kh-lg{display:inline-flex;align-items:center;gap:3px;white-space:nowrap}' +
            '#keno-preset-gui .kh-lg i{width:11px;height:11px;border-radius:3px;flex:0 0 auto;' +
              'box-shadow:inset 0 0 0 1px rgba(255,255,255,.10)}' +
            '#keno-preset-gui .kh-lg i.kh-lg-pick{background:#181c25;' +
              'box-shadow:inset 0 0 0 2px rgba(255,255,255,.95)}' +
            '#keno-preset-gui .kh-btns{display:flex;gap:6px}' +
            '#keno-preset-gui .kh-btn{flex:1;background:rgba(255,255,255,.06);color:inherit;' +
            'border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:5px 8px;font-size:11px;' +
            'font-family:inherit;cursor:pointer}' +
            '#keno-preset-gui .kh-btn:hover{background:rgba(255,255,255,.13)}' +
            '#keno-preset-gui .kh-btn.hot:hover{border-color:#f87171;color:#fca5a5}' +
            '#keno-preset-gui .kh-btn.cold:hover{border-color:#60a5fa;color:#93c5fd}' +
            '#keno-preset-gui .kh-status{font-size:10px;opacity:.55;min-height:1.2em;line-height:1.35}' +
            '#keno-preset-gui .kh-foot{display:flex;justify-content:space-between;align-items:center;' +
            'font-size:10px;opacity:.55}' +
            '#keno-preset-gui .kh-reset{background:transparent;border:1px solid rgba(255,255,255,.14);' +
            'color:inherit;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;' +
            'font-family:inherit;opacity:.8}' +
            '#keno-preset-gui .kh-reset:hover{color:#f87171;border-color:#f87171;opacity:1}' +
            /* The count sits at the FOOT of the tile, not its centre — centred it
               landed straight on top of the tile's own number and you could not
               read either. Smaller and dimmer too: the big digit is the number
               you are picking, this is a footnote about it. */
            '.keno-hot-tint{position:absolute;inset:0;border-radius:inherit;pointer-events:none;' +
            'display:flex;align-items:flex-end;justify-content:center;padding-bottom:2px;' +
            "font:800 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,255,255,.72);" +
            'text-shadow:0 1px 2px rgba(0,0,0,.85)}';

        function injectCss() {
            if (document.getElementById('keno-hot-css')) return;
            var viaGM = false;
            try { if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); viaGM = true; } } catch (e) {}
            var marker = document.createElement(viaGM ? 'meta' : 'style');
            marker.id = 'keno-hot-css';
            if (!viaGM) marker.textContent = CSS;
            (document.head || document.documentElement).appendChild(marker);
        }

        var sect = null, elHot = null, elCold = null, elStat = null, elSpots = null, elCount = null, elRep = null;
        var elLegend = null;
        var showHeat = true, showCounts = true;
        var CALIB_MSG = 'Click any number once so I can learn this site’s selected colour — until then draws are not recorded.';
        function setStatus(t) { if (elStat) elStat.textContent = t || ''; }

        /** Where the section lives: the preset panel's content column. */
        function hostSlot() {
            var host = document.getElementById('keno-preset-gui');
            return host ? (host.querySelector('.kp-content') || host) : null;
        }

        function buildSection() {
            var el = document.createElement('div');
            el.className = 'kh-sect';
            el.innerHTML =
                '<div class="kh-sect-head"><b>Hotspot</b><span data-kh="count">0 draws</span></div>' +
                '<div class="kh-row"><span>Window</span>' +
                  '<select data-kh="window">' +
                    '<option value="50">last 50</option>' +
                    '<option value="100">last 100</option>' +
                    '<option value="250">last 250</option>' +
                    '<option value="500">last 500</option>' +
                    '<option value="0">all</option>' +
                  '</select></div>' +
                '<div class="kh-list kh-hot"><span class="kh-k">Hottest</span><span data-kh="hot">—</span></div>' +
                '<div class="kh-list kh-cold"><span class="kh-k">Coldest</span><span data-kh="cold">—</span></div>' +
                /* Scanned on demand rather than every draw: enumerating every
                   pair, trio and quad in the window is far too much work to
                   repeat on each round. */
                '<div class="kh-list kh-rep"><span class="kh-k">Repeat groups' +
                  '<button class="kh-scan" type="button" data-kh="scan">Scan</button></span>' +
                  '<span data-kh="rep">press Scan</span></div>' +
                '<div class="kh-row"><span>Spots to pick</span>' +
                  '<input type="number" min="1" max="' + MAX_PICKS + '" value="10" data-kh="spots"></div>' +
                '<div class="kh-btns">' +
                  '<button class="kh-btn hot" type="button" data-kh="pick-hot">Pick hottest</button>' +
                  '<button class="kh-btn cold" type="button" data-kh="pick-cold">Pick coldest</button>' +
                '</div>' +
                '<div class="kh-row"><label style="display:flex;align-items:center;gap:5px;cursor:pointer">' +
                  '<input type="checkbox" data-kh="heat" checked>Heatmap</label>' +
                  '<label style="display:flex;align-items:center;gap:5px;cursor:pointer">' +
                  '<input type="checkbox" data-kh="counts" checked>Counts</label></div>' +
                '<div class="kh-legend" data-kh="legend"></div>' +
                '<div class="kh-status"></div>' +
                '<div class="kh-foot"><span>v' + KH_VERSION + '</span>' +
                  '<button class="kh-reset" type="button" data-kh="reset">Reset draws</button></div>';

            elHot   = el.querySelector('[data-kh="hot"]');
            elCold  = el.querySelector('[data-kh="cold"]');
            elStat  = el.querySelector('.kh-status');
            elSpots = el.querySelector('[data-kh="spots"]');
            elCount = el.querySelector('[data-kh="count"]');
            elRep   = el.querySelector('[data-kh="rep"]');
            elLegend = el.querySelector('[data-kh="legend"]');

            el.querySelector('[data-kh="scan"]').addEventListener('click', function () {
                var win = windowDraws();
                if (win.length < 2) { elRep.textContent = 'not enough draws yet'; return; }
                elRep.textContent = 'scanning ' + win.length + '…';
                /* Yield first so the label paints before the scan blocks. */
                setTimeout(function () {
                    var t0 = Date.now();
                    var groups = computeCombos(win, boardSize(), 8);
                    elRep.innerHTML = groups.length ? groups.map(function (g) {
                        return '<span class="kh-rep-row' + (g.notable ? ' kh-rep-hot' : '') + '">' +
                               '<b>' + g.nums + '</b> &times;' + g.count +
                               ' <i>vs ' + g.expected.toFixed(1) + ' expected</i></span>';
                    }).join('') : 'no group has repeated yet';
                    setStatus('scanned ' + win.length + ' draws in ' + (Date.now() - t0) + 'ms');
                }, 30);
            });

            var sel = el.querySelector('[data-kh="window"]');
            sel.value = String(store.window);
            sel.addEventListener('change', function () {
                store.window = parseInt(sel.value, 10) || 0;
                saveStore(); render(); paintTiles();
            });
            el.querySelector('[data-kh="pick-hot"]').addEventListener('click', function () { applyExtreme(false); });
            el.querySelector('[data-kh="pick-cold"]').addEventListener('click', function () { applyExtreme(true); });
            el.querySelector('[data-kh="heat"]').addEventListener('change', function (e) { showHeat = e.target.checked; paintTiles(); });
            el.querySelector('[data-kh="counts"]').addEventListener('change', function (e) { showCounts = e.target.checked; paintTiles(); });
            el.querySelector('[data-kh="reset"]').addEventListener('click', function () {
                if (confirm('Clear all recorded ' + SITE.label + ' Keno draws?')) resetStore();
            });
            return el;
        }

        /** "7 +2.1σ" entries for the top/bottom of the ranking. */
        function listHtml(heat, coldest) {
            if (!heat.rounds) return '—';
            return ranked(heat, coldest).slice(0, 6).map(function (n) {
                var z = heat.z[n];
                var sig = (z >= 0 ? '+' : '−') + Math.abs(z).toFixed(1);
                return '<b>' + n + '</b> <span style="opacity:.55">' + sig + 'σ</span>';
            }).join('  ');
        }

        /** A swatch painted with the REAL tint, composited over a tile-dark base
         *  so it looks like what is actually on the board — naming the shades in
         *  words ("light orange") only invites arguing with the screen. */
        function swatch(col, label) {
            var bg = col ? 'linear-gradient(' + col + ',' + col + '),#181c25' : '#181c25';
            return '<span class="kh-lg"><i style="background:' + bg + '"></i>' + label + '</span>';
        }
        /* Ranges are given as DRAW COUNTS, not standard deviations, because the
           count is the number printed on the tile. The bands are defined in
           sigma, so the counts they map to move with the window size — which is
           the point: the same colour means the same thing at 50 draws or 500. */
        function legendHtml(heat) {
            if (!heat.rounds || !(heat.sd > 0)) return '';
            var lo = function (z) { return Math.ceil(heat.mean + z * heat.sd); };
            var hot = [], cold = [], i, a, b;
            for (i = 0; i < HEAT_BANDS.length; i++) {
                a = lo(HEAT_BANDS[i].z);
                b = (i === 0) ? null : lo(HEAT_BANDS[i - 1].z) - 1;   // top band is open-ended
                if (b !== null && b < a) continue;                    // band spans no whole count
                hot.push(swatch('rgba(' + HEAT_BANDS[i].hot + ',' + HEAT_BANDS[i].a + ')',
                                b === null ? a + '+' : (a === b ? String(a) : a + '&ndash;' + b)));
                a = Math.floor(heat.mean - HEAT_BANDS[i].z * heat.sd);
                b = (i === 0) ? null : Math.floor(heat.mean - HEAT_BANDS[i - 1].z * heat.sd) + 1;
                if (b !== null && b > a) continue;
                cold.push(swatch('rgba(' + HEAT_BANDS[i].cold + ',' + HEAT_BANDS[i].a + ')',
                                 b === null ? '&le;' + (a < 0 ? 0 : a) : (a === b ? String(a) : b + '&ndash;' + a)));
            }
            var mid = Math.floor(heat.mean - HEAT_BANDS[HEAT_BANDS.length - 1].z * heat.sd) + 1;
            var midHi = lo(HEAT_BANDS[HEAT_BANDS.length - 1].z) - 1;
            /* One continuous scale, coldest to hottest, wrapping as it needs to.
               Split into a cold row and a hot row it read as two separate ramps
               and the eye kept jumping back to the middle. */
            return '<div class="kh-lgrow">' + cold.join('') +
                     swatch(null, midHi >= mid ? (mid === midHi ? String(mid) : mid + '&ndash;' + midHi) : 'expected') +
                     hot.reverse().join('') + '</div>' +
                   '<div class="kh-lgrow"><span class="kh-lg"><i class="kh-lg-pick"></i>your picks</span></div>';
        }

        function render() {
            if (!sect || !sect.isConnected) return;
            var heat = computeHeat(windowDraws(), boardSize());
            elHot.innerHTML = listHtml(heat, false);
            elCold.innerHTML = listHtml(heat, true);
            if (elLegend) elLegend.innerHTML = legendHtml(heat);
            elCount.textContent = store.draws.length + ' draw' + (store.draws.length === 1 ? '' : 's') +
                (heat.rounds !== store.draws.length ? ' (' + heat.rounds + ' in window)' : '');
            /* Say so rather than sitting there recording nothing. The old version
               silently banked whatever it saw; this one waits to be shown what a
               selected tile looks like, and has to admit it is waiting.

               Cleared again once it no longer applies: it used to be written the
               once and left there, so the panel went on insisting draws were not
               being recorded for the rest of the session after they were. */
            /* Only ask for a tap when the tap is actually needed. With the bet
               response coming through, calibration is irrelevant — the payload
               already separates the draw from the ticket — so the prompt would
               be asking for something that changes nothing. */
            if (!calibrated() && !apiLive()) {
                if (elStat && !elStat.textContent) setStatus(CALIB_MSG);
            } else if (elStat && elStat.textContent === CALIB_MSG) {
                setStatus('');
            }
        }

        /* ---------------------------------------------------------------
           TICKER — mount, poll, repaint. A bad tick must never kill the loop.
           The host panel is rebuilt on SPA navigation, so re-appending when the
           section loses its parent is the normal path, not an error case.
           --------------------------------------------------------------- */
        setInterval(function () {
            try {
                if (!onPage() || !khEnabled()) {
                    if (sect && sect.parentNode) sect.remove();
                    clearTints();
                    return;
                }
                injectCss();
                var slot = hostSlot();
                if (!slot) return;                      // Keno panel not up yet
                if (!sect) sect = buildSection();
                if (sect.parentNode !== slot) { slot.appendChild(sect); render(); }
                watchBoard();
                drainApi();
                sample();
                paintTiles();
            } catch (e) { /* never let one tick kill the ticker */ }
        }, POLL_MS);

        /* Installed before anything else the tool does, so the very next bet is
           captured rather than the one after it. */
        try { installApiTap(); } catch (e) {}

        console.log('%c[Keno Hotspot] v' + KH_VERSION + ' on ' + SITE.label + ' — ' +
                    store.draws.length + ' draws stored', 'color:#f87171;font-weight:700');
    }
    /* === end body: keno-hotspot === */

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
                // Glyph is a minus, not a cross: this only collapses the panel,
                // and a × on it read as "close the tools".
                '<button class="ut-header-btn" id="ut-collapse" title="Collapse">−</button>' +
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


    console.log('%c[Stake Keno — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
