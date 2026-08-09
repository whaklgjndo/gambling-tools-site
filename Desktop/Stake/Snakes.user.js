// ==UserScript==
// @name         Stake Snakes — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.41
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
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/Snakes.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/Snakes.user.js
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cStake Snakes — Desktop — standalone build v3.41', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: snakes-partial-autoplay (Stake / Nuts) === */
    /**
     * Snakes — partial autoplay.
     *
     * Snakes is a climb. You Bet, then Roll up a spiral of multipliers, and any
     * roll can end the round. The game caps a round at five rolls.
     *
     * This tool plays the OPENING of each round and then gets out of the way.
     * You choose how many rolls it takes for you (1-4); it bets, takes exactly
     * that many, then stops and hands the board back, so the decision that
     * actually matters — roll again or cash out — stays yours. IT NEVER CASHES
     * OUT FOR YOU. The only buttons it ever presses are Bet and Roll.
     *
     * It re-arms for the next round as soon as the current one ends, however it
     * ends: a bust, your cashout, or running out the five-roll cap. Once it has
     * handed over it stays hands-off for the rest of that round no matter how
     * many more times you roll.
     *
     * Site differences that shape the code below, both measured live 2026-08-07:
     *
     *   Stake — stable data-testids. The Bet button is REPLACED by a Cashout
     *           button while a round is live, so "a Bet button exists" is a
     *           reliable "no round in progress".
     *   Nuts  — a visual clone with NO data-testid anywhere (styled-components
     *           hashes only), so its controls are found by their text: PLAY and
     *           roll. Its round-live markup could not be observed (the account
     *           had no balance), so the round-over test is written as "a button
     *           labelled PLAY is present and enabled", which is correct whether
     *           Nuts hides that button mid-round the way Stake does or merely
     *           relabels it.
     */
    function tool_snakes() {
        'use strict';
        if (tool_snakes._booted) return;
        tool_snakes._booted = true;

        var SNK_VERSION  = '1.03';
        /* Tuned to play as fast as the site will let it. The pace is set by the
           GAME, not by us: a control is pressed the instant it becomes usable
           again. A fixed cooldown would either be slower than the game or race
           it, so instead each click waits to see its own control go busy and
           then free — with FALLBACK_MS as the escape hatch, because a round that
           resolves inside one poll never shows the busy frame and the first cut
           of this wedged forever waiting for it. */
        var POLL_MS      = 60;
        var GAME_MAX     = 5;      // the game's own cap — five pips under the board
        var SETTLE_MS    = 120;    // after a round ends, before opening the next
        var MIN_GAP_MS   = 40;     // never two clicks inside a frame
        var FALLBACK_MS  = 500;    // act anyway if the busy frame was never seen
        var MULT_WAIT_MS     = 1000;  // wait this long for a roll's multiplier to render
        var MULT_SETTLE_MS   = 1500;  // grace for the profit text to catch up with the button
        var CASHOUT_GRACE_MS = 4000;  // keep retrying Cashout for this long once a target is hit

        function buttons() { return Array.prototype.slice.call(document.querySelectorAll('button')); }
        function btnByText(re) {
            var b = buttons(), i, t;
            for (i = 0; i < b.length; i++) {
                t = (b[i].textContent || '').trim();
                if (t && re.test(t)) return b[i];
            }
            return null;
        }

        var SITES = {
            stake: {
                label: 'Stake',
                onPage: function () { return /casino\/games\/snakes(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                start:   function () { return document.querySelector('[data-testid="bet-button"]'); },
                roll:    function () { return document.querySelector('[data-testid="game-next"]'); },
                /* Read only, never clicked — it is how we show you the round is
                   yours now, and it is what tells a bust from a cashout. */
                cashout: function () { return document.querySelector('[data-testid="cashout-button"]'); },
                /* Is the game itself still on screen? "Bet is missing" means a
                   round is in progress AND ALSO means the page has blown up and
                   taken every control with it — two states the rest of this code
                   cannot tell apart without asking. */
                present: function () {
                    return !!document.querySelector('[data-testid="bet-button"],' +
                        '[data-testid="cashout-button"],[data-testid="game-next"]');
                },
                mult:    function () {
                    var m = (document.body.innerText || '').match(/Total Profit \(([\d.]+)\s*×\)/);
                    return m ? parseFloat(m[1]) : null;
                },
                multMeansOutcome: true   // a bust zeroes it; a cashout leaves it
            },
            nuts: {
                label: 'Nuts',
                onPage: function () { return /\/snakes(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                start:   function () { return btnByText(/^play$/i); },
                roll:    function () { return btnByText(/^roll$/i); },
                cashout: function () { return btnByText(/cash\s*out/i); },
                /* See the Stake twin. Between the bet and the first roll Nuts
                   labels the top button MUST ROLL ONCE — neither PLAY nor
                   CASHOUT — so that state is probed by name too. Both it and the
                   spinner-only PLAY were observed on a recording, 2026-08-08. */
                present: function () {
                    return !!(btnByText(/^play$/i) || btnByText(/^roll$/i) ||
                              btnByText(/cash\s*out/i) || btnByText(/must roll once/i));
                },
                /* Supplied from the live page 2026-08-08:
                     <div class="snakes-module__3yTeBG__rollMultiplier"
                          style="--color: var(--color-green-500);">1.11x</div>
                   Matched on the stable tail of the CSS-module class, never the
                   whole thing — `3yTeBG` is a build hash and will change the next
                   time Nuts ships. Takes the LAST match: if the page renders one
                   of these per roll rather than a single live figure, the last is
                   the current one. */
                mult:    function () {
                    var els = document.querySelectorAll('[class*="rollMultiplier"]');
                    if (!els.length) return null;
                    var txt = (els[els.length - 1].textContent || '').trim();
                    var m = txt.match(/([\d.]+)\s*x/i) || txt.match(/([\d.]+)/);
                    if (!m) return null;
                    var v = parseFloat(m[1]);
                    return isFinite(v) ? v : null;
                },
                /* Stake zeroes its multiplier on a bust, which is how the status
                   line tells a bust from a cashout. Whether Nuts does the same is
                   unconfirmed, so outcomes here stay worded as a plain "round
                   over" rather than risk announcing a cashout that never was. */
                multMeansOutcome: false
            }
        };
        function detectSite() {
            return /(^|\.)nuts\.gg$/i.test(location.hostname) ? SITES.nuts : SITES.stake;
        }
        var SITE    = detectSite();
        var TOOL_ID = (SITE === SITES.nuts ? 'nuts' : 'stake') + '-snakes';

        function onPage()  { try { return SITE.onPage(); } catch (e) { return false; } }
        function enabled() { try { return isToolIdEnabled(TOOL_ID); } catch (e) { return true; } }

        /* ---------------------------------------------------------------
           SETTINGS
           --------------------------------------------------------------- */
        var KEY = 'snakes-partial-autoplay-v1';
        /* `target` is an optional auto-cashout: the one case where the tool DOES
           take the money off the table for you. If the multiplier reaches it
           during the auto rolls the round is closed there and then, including on
           the very last auto roll — a 50× on roll two of three is not something
           to hand back and hope about. 0 means off, which is the default. */
        var cfg = { rolls: 2, target: 0 };
        try {
            var raw = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (raw && raw.rolls >= 1 && raw.rolls <= GAME_MAX - 1) cfg.rolls = raw.rolls | 0;
            if (raw && isFinite(raw.target) && raw.target >= 0) cfg.target = +raw.target;
        } catch (e) {}
        function saveCfg() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }

        /* ---------------------------------------------------------------
           STATE MACHINE

           Deliberately driven by what the BUTTONS say rather than by a timer or
           a bet count. Every transition below is one of the states measured on
           a live Stake board:

             idle        Bet present + enabled          -> no round
             betting     we clicked Bet, waiting        -> Bet goes away
             rolling     Roll enabled, under the target -> click Roll
             handover    target reached                 -> hands off, yours
             (any)       Bet comes back                 -> round over, re-arm

           A roll in flight shows as Roll present but DISABLED, which is why the
           click path waits to see it disabled and then enabled again rather
           than counting its own clicks — a click that the page drops must not
           be counted as a roll taken.
           --------------------------------------------------------------- */
        var running     = false;  // is the tool armed
        var phase       = 'idle'; // idle | rolling | handover — for the status line only
        var rollsDone   = 0;
        var handedOver  = false;
        var roundActive = false;
        var rounds      = 0;
        /* Counted because the status line is transient — at full speed a round
           can finish and the next one start before you have read what happened. */
        var targetHits  = 0;
        var lastChange  = Date.now();
        var cooldown    = 0;      // set only after a round ends
        var clickAt     = 0;      // when we last pressed something
        var sawBusy     = false;  // that control has since gone disabled
        var multAtRoll  = null;   // the multiplier when we last pressed Roll
        var lastRollAt  = 0;      // when the last Roll was pressed
        var targetPendingSince = 0; // target reached, waiting for Cashout to free up
        var lastSig     = '';
        var statusText  = 'Idle.';
        /* STUCK GATE — not a setting.

           Its job: stop a run that is getting nowhere. Two states from a
           recording of a real session, both of which used to hang until the tool
           was stopped by hand — a mid-round freeze where no control was
           actionable, and the page crashing outright and taking every control
           with it. Neither could place a bet, and neither could be noticed by a
           check that only ran while the Bet button was clickable.

           So the test is not "did a bet happen" but "did ANYTHING on the board
           change while it was the tool's turn to act". It is deliberately not
           exposed in the panel, because a safety gate you can set to zero is not
           a safety gate.

           IT DOES NOT RUN WHILE THE BOARD IS YOURS. Once the tool has handed
           over it is waiting on a human decision, and there is no such thing as
           taking too long over it — the clock is held at the current time for
           the whole of the handover and only starts again between rounds, which
           is the only window where the tool is the one failing to act.

           Same hidden-tab rule as the dice HUD's rapid-fire watchdog: a
           backgrounded tab is not a stalled run. Browsers throttle and often
           suspend timers when the tab is hidden or the phone is locked, so the
           gate is paused while hidden and given a full fresh window on return —
           without that it becomes the "it stops at random" bug. */
        var NO_PROGRESS_MS = 5000;
        var GAME_GONE_MS   = 2000;   // controls absent this long: the page is gone
        var goneSince      = 0;
        var visibleAgainAt = 0;

        function setStatus(t) { statusText = t; paint(); }

        function click(el) {
            if (!el || el.disabled) return false;
            el.click();
            clickAt = Date.now();
            sawBusy = false;
            return true;
        }
        /** True once the thing we pressed has finished. Fast path: we watched it
         *  go busy and come back. Safety net: FALLBACK_MS, so a transition that
         *  happens between two polls can never wedge the loop. */
        function settled(control) {
            var since = Date.now() - clickAt;
            if (since < MIN_GAP_MS) return false;
            if (sawBusy) return !!(control && !control.disabled);
            return since >= FALLBACK_MS;
        }

        function stop(why) {
            running = false;
            phase = 'idle';
            setStatus(why || 'Stopped.');
        }

        function tick() {
            if (!onPage() || !enabled()) return;

            /* For an instant this is just a re-render. For longer, the page has
               crashed or navigated — and every test below would read it as a
               round in progress and wait on it forever. */
            var here = true;
            try { here = SITE.present(); } catch (e) {}
            if (!here) {
                if (!goneSince) goneSince = Date.now();
                if (running && Date.now() - goneSince > GAME_GONE_MS) {
                    stop('Stopped: the game is no longer on the page — reload it.');
                }
                return;
            }
            goneSince = 0;

            var startB = SITE.start();
            var rollB  = SITE.roll();
            var coB    = null;
            try { coB = SITE.cashout(); } catch (e) {}

            var atIdle  = !!(startB && !startB.disabled);
            var canRoll = !!(rollB && !rollB.disabled);
            /* A round is live when the start button has gone (Stake replaces it
               with Cashout), or a Cashout control exists, or Roll is offering
               itself. Any one of those is enough, which is what lets the same
               code cover Nuts without having seen its mid-round markup. */
            var live = (!startB) || !!coB || canRoll;
            if (live) roundActive = true;

            var sig = (startB ? (startB.disabled ? 'S0' : 'S1') : 'S-') +
                      (rollB  ? (rollB.disabled  ? 'R0' : 'R1') : 'R-') + rollsDone;
            if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }

            /* Watch for the pressed control going busy — that is what lets the
               next action fire the moment it comes back, rather than waiting out
               a fixed delay. */
            if (!sawBusy && clickAt &&
                ((rollB && rollB.disabled) || (!startB && !rollB) || (startB && startB.disabled))) {
                sawBusy = true;
            }

            /* ---- the round ended, however it ended ---- */
            if (roundActive && !live && atIdle) {
                var m = null;
                try { m = SITE.mult(); } catch (e) {}
                rounds++;
                /* A bust zeroes the multiplier; a cashout leaves the one you
                   walked away with on screen. Nuts does not expose it, so there
                   the outcome is reported plainly as "round over". */
                var how = (m === null || !SITE.multMeansOutcome) ? 'round over'
                        : (m > 0 ? 'cashed out at ' + m.toFixed(2) + '×' : 'busted');
                roundActive = false;
                rollsDone   = 0;
                targetPendingSince = 0;
                handedOver  = false;
                multAtRoll  = null;
                phase       = 'idle';
                cooldown    = Date.now() + SETTLE_MS;
                setStatus(running ? ('Round ' + rounds + ': ' + how + ' — re-arming…')
                                  : ('Round ' + rounds + ': ' + how + '.'));
            }

            if (!running) return;

            /* ---- stuck gate ----
               lastChange is stamped at the top of every tick the board looked
               different from the last one, so it doubles as "when did anything
               last happen". */
            var nowT = Date.now();
            if (handedOver || document.hidden) {
                /* Your decision time, and time the tab spent in the background,
                   are both held rather than counted. Holding the stamp (instead
                   of just skipping the test) is what gives a full fresh window
                   the moment the tool is answerable again. */
                lastChange = nowT;
                if (document.hidden) visibleAgainAt = 0;
            } else {
                if (!visibleAgainAt) visibleAgainAt = nowT;
                if (nowT - Math.max(lastChange, visibleAgainAt) > NO_PROGRESS_MS) {
                    stop(atIdle
                        ? 'Stopped: ' + (SITE === SITES.nuts ? 'PLAY' : 'Bet') +
                          ' is not starting a round — check your balance.'
                        : 'Stopped: the game stopped responding mid-round.');
                    return;
                }
            }

            if (Date.now() < cooldown) return;

            /* ---- start a round ---- */
            if (atIdle) {
                if (clickAt && !settled(startB)) return;
                if (click(startB)) {
                    /* Deliberately NOT stamping the watchdog here. Pressing Bet
                       is not evidence a bet happened — with an empty balance the
                       press does nothing at all, and stamping on the press would
                       let that loop reset its own safety gate forever, which is
                       the exact case the gate exists for. The stamp goes on the
                       round actually going live. */
                    phase = 'rolling';
                    setStatus('Betting…');
                }
                return;
            }

            if (!settled(rollB)) return;

            /* ---- take our share of the rolls ----

               Guarded twice on purpose. The button being enabled is the primary
               signal, but the FIRST cut of this waited to observe the button go
               disabled and then enabled again, and a roll that resolves inside
               one poll interval never shows that transition — the tool wedged
               after a single roll and sat there forever. A cooldown cannot wedge.
               Where a multiplier is readable it is checked too: unchanged since
               the last press means the previous roll has not landed yet. */
            var nowMult = null;
            try { nowMult = SITE.mult(); } catch (e) {}

            /* ---- auto-cashout target ----

               Checked the moment a roll has landed, BEFORE deciding whether to
               roll again or hand over — so it fires whether the target is hit
               early (50× on roll two of three) or on the very last auto roll.
               Only during the auto phase: once the board is yours it stays
               yours. Needs a readable multiplier, which Nuts does not yet give
               us, so there the field is disabled rather than quietly inert. */
            /* `nowMult !== multAtRoll` is the "this roll actually landed" test —
               multAtRoll holds the reading from just before the last press. It
               matters most on Nuts, where the multiplier is matched by class and
               could in principle be a per-roll list that outlives the round: a
               stale carry-over reads as unchanged and so cannot trip the target
               on the first roll of a fresh round. */
            if (canRoll && !handedOver && rollsDone > 0 &&
                cfg.target > 0 && nowMult !== null && nowMult !== multAtRoll &&
                nowMult >= cfg.target) {
                var co = null;
                try { co = SITE.cashout(); } catch (e) {}
                if (co && !co.disabled) {
                    click(co);
                    targetHits++;
                    setStatus('Hit ' + nowMult.toFixed(2) + '× (target ' + cfg.target + '×) — cashed out.');
                    return;
                }
                /* Cashout is not clickable YET. Sites disable it while the roll
                   settles, so the first look after a roll lands often finds it
                   greyed out — keep trying instead of giving up, because giving
                   up here used to be permanent and silently skipped the cashout
                   the player had asked for. */
                if (!targetPendingSince) targetPendingSince = Date.now();
                if (Date.now() - targetPendingSince < CASHOUT_GRACE_MS) return;
                if (!handedOver) {
                    handedOver = true;
                    phase = 'handover';
                    setStatus('Hit ' + nowMult.toFixed(2) + '× but Cashout never became available — cash out by hand.');
                }
                return;
            }

            if (canRoll && !handedOver && rollsDone < cfg.rolls) {
                /* Wait for the previous roll's multiplier to render before taking
                   the next one, so the reading can never fall behind the rolls.
                   Treating null as a reading is the point: it is what every
                   round's first roll starts from, and skipping the wait there
                   was what let the whole round run ahead of the text. Bounded,
                   so a site whose multiplier cannot be read costs a beat per
                   roll instead of hanging. */
                if (rollsDone > 0 && nowMult === multAtRoll &&
                    Date.now() - lastRollAt < MULT_WAIT_MS) return;
                multAtRoll = nowMult;
                if (click(rollB)) {
                    lastRollAt = Date.now();
                    rollsDone++;
                    phase = 'rolling';
                    setStatus('Rolled ' + rollsDone + ' of ' + cfg.rolls + '…');
                }
                return;
            }

            /* ---- hand the board back ---- */
            if (canRoll && rollsDone >= cfg.rolls && !handedOver) {
                /* WAIT FOR THE MULTIPLIER TO CATCH UP FIRST.

                   The Roll button frees up before the site re-renders the profit
                   text, so on the tick after the final roll the reading is still
                   the PREVIOUS one. The target test above skips a stale reading
                   — correctly — and control used to fall straight through to
                   here, handing over permanently. A target reached on the last
                   auto roll was therefore ignored, which is exactly how it was
                   reported: three rolls set, target hit on the third, no cashout.

                   So when a target is armed and the reading has not moved yet,
                   hold the handover briefly and look again. Bounded, so a site
                   that never updates the text cannot wedge the round. */
                if (cfg.target > 0 && nowMult !== null && nowMult === multAtRoll &&
                    Date.now() - lastRollAt < MULT_SETTLE_MS) return;
                handedOver = true;
                phase = 'handover';
                setStatus('YOUR MOVE — ' + rollsDone + ' roll' + (rollsDone === 1 ? '' : 's') +
                          ' taken. Roll again or cash out.');
            }
        }

        /* ---------------------------------------------------------------
           PANEL — small, draggable, same language as the Mines/Moles huds.
           --------------------------------------------------------------- */
        /* Per-site skin, matching the rest of the bundle: Stake slate, Nuts neon.
           Same colours the Nuts Keno panel already uses, so the two sit together
           on the page instead of one looking like it wandered in from Stake. */
        var THEME = (SITE === SITES.nuts) ? {
            panel:  'background:rgba(16,20,30,.72);backdrop-filter:blur(16px);' +
                    '-webkit-backdrop-filter:blur(16px);border:1px solid rgba(0,255,255,.15);' +
                    'border-top:1px solid rgba(0,255,255,.3);border-left:1px solid rgba(0,255,255,.3);' +
                    'border-radius:14px;color:#e0ffff;' +
                    'box-shadow:0 8px 32px rgba(0,0,0,.35),inset 0 0 20px rgba(0,255,255,.05)',
            headBorder: 'rgba(0,255,255,.15)',
            headText:   '#00ffff;letter-spacing:1px;text-shadow:0 0 10px rgba(0,255,255,.6)',
            field:      'background:rgba(0,0,0,.35);border:1px solid rgba(0,255,255,.25);color:#e0ffff',
            accent:     '#19f3ff',
            onInk:      '#04121a',
            haltBg:     'rgba(0,255,255,.12);color:#bffcff'
        } : {
            panel:  'background:#0f212e;border:1px solid #2f4553;border-radius:8px;color:#b1bad3;' +
                    'box-shadow:0 8px 28px rgba(0,0,0,.45)',
            headBorder: '#2f4553',
            headText:   '#fff',
            field:      'background:#213743;border:1px solid #2f4553;color:#e2e8f0',
            accent:     '#1fff20',
            onInk:      '#0f212e',
            haltBg:     '#2f4553;color:#e2e8f0'
        };
        var CSS =
            '#snakes-auto-gui{position:fixed;z-index:2147483000;top:96px;right:18px;width:212px;' +
              THEME.panel + ';' +
              'font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
              'user-select:none}' +
            '#snakes-auto-gui .sk-head{display:flex;align-items:center;justify-content:space-between;' +
              'padding:8px 10px;border-bottom:1px solid ' + THEME.headBorder + ';cursor:grab;' +
              'font-weight:700;color:' + THEME.headText + '}' +
            '#snakes-auto-gui .sk-head:active{cursor:grabbing}' +
            '#snakes-auto-gui .sk-body{padding:10px;display:flex;flex-direction:column;gap:8px}' +
            '#snakes-auto-gui .sk-row{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
            '#snakes-auto-gui .sk-pills{display:flex;gap:4px}' +
            '#snakes-auto-gui .sk-pill{flex:1;' + THEME.field + ';' +
              'border-radius:5px;padding:5px 0;text-align:center;cursor:pointer;font-weight:700}' +
            '#snakes-auto-gui .sk-pill.on{background:' + THEME.accent + ';border-color:' + THEME.accent +
              ';color:' + THEME.onInk + '}' +
            '#snakes-auto-gui .sk-target{width:60px;' + THEME.field + ';' +
              'border-radius:5px;padding:4px 6px;text-align:right;font-weight:700;' +
              'font-size:12px;margin-right:3px}' +
            '#snakes-auto-gui .sk-target:disabled{opacity:.4;cursor:not-allowed}' +
            '#snakes-auto-gui .sk-btn{flex:1;border:0;border-radius:5px;padding:7px 0;cursor:pointer;' +
              'font-weight:700;font-size:12px}' +
            '#snakes-auto-gui .sk-go{background:' + THEME.accent + ';color:' + THEME.onInk + '}' +
            '#snakes-auto-gui .sk-halt{background:' + THEME.haltBg + '}' +
            '#snakes-auto-gui .sk-status{font-size:11px;line-height:1.35;min-height:2.4em;opacity:.85}' +
            '#snakes-auto-gui .sk-status.yours{color:' + THEME.accent + ';font-weight:700;opacity:1}' +
            '#snakes-auto-gui .sk-foot{display:flex;justify-content:space-between;opacity:.45;font-size:10px;' +
              'padding:0 10px 8px}';

        var gui = null, elStatus = null, elPills = null, elGo = null, elRounds = null;

        function injectCss() {
            if (document.getElementById('snakes-auto-css')) return;
            var viaGM = false;
            try { if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); viaGM = true; } } catch (e) {}
            var marker = document.createElement(viaGM ? 'meta' : 'style');
            marker.id = 'snakes-auto-css';
            if (!viaGM) marker.textContent = CSS;
            (document.head || document.documentElement).appendChild(marker);
        }

        function build() {
            var el = document.createElement('div');
            el.id = 'snakes-auto-gui';
            var pills = '';
            for (var n = 1; n <= GAME_MAX - 1; n++)
                pills += '<div class="sk-pill" data-sk="' + n + '">' + n + '</div>';
            el.innerHTML =
                '<div class="sk-head"><span>Snakes</span>' +
                  '<span data-sk="min" title="Minimise" style="cursor:pointer;opacity:.6;padding:0 4px">−</span></div>' +
                '<div class="sk-body">' +
                  '<div class="sk-row"><span>Auto rolls</span></div>' +
                  '<div class="sk-pills">' + pills + '</div>' +
                  '<div class="sk-row"><span>Cash out at</span>' +
                    '<span><input class="sk-target" type="number" min="0" step="0.01" ' +
                      'data-sk="target" placeholder="off">&times;</span></div>' +
                  '<div class="sk-row">' +
                    '<button class="sk-btn sk-go" data-sk="go">START</button>' +
                    '<button class="sk-btn sk-halt" data-sk="halt">STOP</button>' +
                  '</div>' +
                  '<div class="sk-status"></div>' +
                '</div>' +
                '<div class="sk-foot"><span>v' + SNK_VERSION + '</span><span data-sk="rounds">0 rounds</span></div>';

            elStatus = el.querySelector('.sk-status');
            elPills  = el.querySelector('.sk-pills');
            elGo     = el.querySelector('[data-sk="go"]');
            elRounds = el.querySelector('[data-sk="rounds"]');

            var elTarget = el.querySelector('[data-sk="target"]');
            if (cfg.target > 0) elTarget.value = cfg.target;
            /* The target needs a readable multiplier. Both sites have one now,
               but Nuts' only exists once a round is in progress — so the field is
               left enabled and the check below simply never trips while there is
               nothing to read, rather than being greyed out on a cold page. */
            elTarget.addEventListener('change', function () {
                var v = parseFloat(this.value);
                cfg.target = (isFinite(v) && v > 0) ? v : 0;
                if (!cfg.target) this.value = '';
                saveCfg();
                paint();
            });


            elPills.addEventListener('click', function (e) {
                var p = e.target.closest ? e.target.closest('.sk-pill') : null;
                if (!p) return;
                cfg.rolls = parseInt(p.getAttribute('data-sk'), 10) || 1;
                saveCfg();
                paint();
            });
            el.querySelector('[data-sk="go"]').addEventListener('click', function () {
                if (running) return;
                running = true;
                rollsDone = 0; handedOver = false; roundActive = false; multAtRoll = null;
                phase = 'idle'; cooldown = 0; lastChange = Date.now();
                goneSince = 0; visibleAgainAt = 0;
                setStatus('Armed — ' + cfg.rolls + ' auto roll' + (cfg.rolls === 1 ? '' : 's') + ' per round.');
            });
            el.querySelector('[data-sk="halt"]').addEventListener('click', function () {
                stop('Stopped. The current round is yours to finish.');
            });
            /* Collapses to a draggable pill — the header stays, which is also the
               drag handle. There is deliberately no close: removing the panel
               would need a reload to get it back, and stopping the tool is what
               STOP is for. */
            el.querySelector('[data-sk="min"]').addEventListener('click', function () {
                var body = el.querySelector('.sk-body');
                var foot = el.querySelector('.sk-foot');
                var mini = el.classList.toggle('sk-mini');
                if (body) body.style.display = mini ? 'none' : '';
                if (foot) foot.style.display = mini ? 'none' : '';
                el.style.width = mini ? 'auto' : '';
                this.textContent = mini ? '+' : '−';
                this.title = mini ? 'Restore' : 'Minimise';
            });
            makeDraggableSnk(el, el.querySelector('.sk-head'));
            return el;
        }

        function makeDraggableSnk(panel, handle) {
            var dragging = false, dx = 0, dy = 0;
            handle.addEventListener('mousedown', function (e) {
                if (e.target && e.target.getAttribute && e.target.getAttribute('data-sk') === 'min') return;
                dragging = true;
                var r = panel.getBoundingClientRect();
                dx = e.clientX - r.left; dy = e.clientY - r.top;
                e.preventDefault();
            });
            document.addEventListener('mousemove', function (e) {
                if (!dragging) return;
                panel.style.left = Math.max(0, e.clientX - dx) + 'px';
                panel.style.top  = Math.max(0, e.clientY - dy) + 'px';
                panel.style.right = 'auto';
            });
            document.addEventListener('mouseup', function () { dragging = false; });
        }

        function paint() {
            if (!gui || !gui.isConnected) return;
            var pills = elPills.querySelectorAll('.sk-pill'), i;
            for (i = 0; i < pills.length; i++)
                pills[i].classList.toggle('on', parseInt(pills[i].getAttribute('data-sk'), 10) === cfg.rolls);
            elStatus.textContent = statusText;
            elStatus.classList.toggle('yours', phase === 'handover');
            elGo.textContent = running ? 'RUNNING' : 'START';
            elGo.style.opacity = running ? '.55' : '1';
            elRounds.textContent = rounds + ' round' + (rounds === 1 ? '' : 's') +
                                   (targetHits ? ' · ' + targetHits + ' hit target' : '');
        }

        setInterval(function () {
            try {
                if (!onPage() || !enabled()) {
                    if (gui && gui.parentNode) { running = false; gui.remove(); }
                    return;
                }
                injectCss();
                if (!gui || !gui.isConnected) { gui = build(); document.body.appendChild(gui); paint(); }
                tick();
                paint();
            } catch (e) { /* never let one tick kill the loop */ }
        }, POLL_MS);

        console.log('%c[Snakes] partial autoplay v' + SNK_VERSION + ' on ' + SITE.label,
                    'color:#1fff20;font-weight:700');
    }
    /* === end body: snakes === */

    /* ----- Snakes partial autoplay (Stake + Nuts; one body, branches on host) ----- */
    register({
        id: 'stake-snakes',
        name: 'Stake Snakes',
        description: 'Auto-rolls the first 1-4 rolls of each round, then hands the board back so the cashout call is yours.',
        matches: [
            'https://stake.com/casino/games/snakes*',
            'https://stake.us/casino/games/snakes*',
            'https://stake.bet/casino/games/snakes*',
            'https://stake.games/casino/games/snakes*',
            'https://staketr.com/casino/games/snakes*',
            'https://staketr2.com/casino/games/snakes*',
            'https://staketr3.com/casino/games/snakes*',
            'https://staketr4.com/casino/games/snakes*',
            'https://stake.bz/casino/games/snakes*',
            'https://stake.pet/casino/games/snakes*', 'https://stake.jp/casino/games/snakes*'
        ],
        runAt: 'document-end',
        defaultEnabled: true,
        group: 'Stake',
        uiSelectors: ['#snakes-auto-gui']
    }, tool_snakes);

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


    console.log('%c[Stake Snakes — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
