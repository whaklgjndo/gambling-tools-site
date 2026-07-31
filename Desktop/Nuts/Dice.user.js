// ==UserScript==
// @name         Nuts Dice — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.36
// @description  Standalone single-tool build, extracted from the unified bundle.
// @author       .
// @match        https://nuts.gg/*
// @match        https://*.nuts.gg/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cNuts Dice — Desktop — standalone build v3.36', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: nuts-iow-smart-desktop.user.js === */
    function tool_nuts_iow_smart() {
        'use strict';
// ================== SETTINGS & STATE ==================
    let ACTIVE_MODE = 'smart';
    let baseBet = 0.00000001;
    let manualBet = 0.00000001;    // Manual mode's wager (mirrors baseBet's role for Manual)
    let winIncreasePercent = 125;
    let lossStreakReset = 3;
    let winsBeforeReset = 5;
    let autoStopBalance = null;
    let minBaseBet = 0.00000001;
    let maxBaseBet = 99999999999999;
    let lastBetId = null;
    let lossStreak = 0;
    let counter = 0;
    let isRapidFiring = false;
    let sessionPeak = 0;
    let initialBalance = 0;
    let lastKnownBalance = 0;
    let totalWagered = 0;
    let highestProfit = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalBets = 0;
    let observer = null;
    let pastBetsContainer = null;
    let profitHistory = [0];
    const MAX_GRAPH_POINTS = 10000;
    const RAPID_BLOCKED_STOP_MS = 1200;
    const RAPID_STALL_STOP_MS = 3000;
    let aggressionLevel = 1.0;
    let historyWindow = 30;
    let safeDivisor = 300;
    let aggressiveDivisor = 150;
    let winsNeeded = 15;
    let lastAmount = 0;
    let curLossStreak = 0;
    let maxLossStreak = 0;
    let curWinStreak = 0;
    let maxWinStreak = 0;
    let betHistory = [];
    let recentWins = [];
    let topWinStreaks = [];
    let topLossStreaks = [];
    let trackedMultiplier = 0;
    let multGames = 0;
    let multWins = 0;
    let lastResult = null;
    let stopLossPct = 0;
    let takeProfitPct = 0;
    let autoPaused = false;
    let winResetPulseTimer = null;
    let rapidBlockedSince = 0;
    let rapidFireStartedAt = 0;
    let lastObservedBetTime = 0;
    let lockAggressionState = false;
    let lockedGearLevel = 1;
    // === BET LOCK STATE ===
    let desiredBetAmount = null;
    let betGuardObserver = null;
    // === IOW RELIABLE PROGRESSION ===
    let lastPlacedBet = 0.00000010;
    // === ADVANCED RAPID STATE ===
    let clickInterval = null;
    let isSpaceHeldDown = false;
    let playButton = null;
    // === IOW ENFORCER ===
    let iowEnforcerInterval = null;
    // === ADVANCED IOW MODE (condition engine) ===
    // Userscript-side condition engine. Nuts has no native Advanced bet mode
    // or strategy editor (which is what Advanced IOW drives on Stake and
    // Shuffle), so the DiceTool calculator here imports the same 4-condition
    // strategy into our own blocks and the cond-mode rapid-fire runs it.
    const COND_STORE_KEY = 'nuts-dice-conditions-v1';
    const COND_STRAT_KEY = 'nuts-dice-strategies-v1';
    let condBaseBet = 0.00000001;
    // Calculator params — same fields and defaults as the DiceTool.exe
    // replica calculator on Stake/Shuffle (m = (1 + w) * l * buffer).
    let condCalc = { balance: '', div: '500', winInc: '78', lossReset: '5', profitMult: '100', buffer: '25' };
    /* Stats-deck preferences, mirroring Stake's Advanced IOW deck. Persisted
       with the rest of the cond state.

       These MUST be declared before the loadCondState() call below, which
       restores them. They used to sit after it, and because `let` bindings are
       in the temporal dead zone until their declaration is evaluated, the
       restore threw `ReferenceError: Cannot access 'condWsStopOn' before
       initialization`. loadCondState() wraps its whole body in try/catch, so
       the throw was swallowed and the function fell through to its first-run
       return — silently replacing the user's saved conditions with the two demo
       blocks on every single page load, but only once prefs had ever been
       written (which saveCondState always does). Keep these above line. */
    let condWsStopOn = false;      // Autostop @ Win Streak enabled
    let condWsTarget = 10;         // ...at this many consecutive wins
    let condTrackPer = 'session';  // stats scope: 'session' | 'cycle' (since START)
    let condVolume = 100;          // win-beep volume, 0-100
    /* Baseline captured at START so the deck can show per-cycle stats. */
    let condCycle = null;
    let condBlocks = loadCondState();   // also restores condBaseBet + condCalc + prefs
    let condRuntime = condBlocks.map(condDefaultRuntime);
    let condResumePending = false;
    let condNotice = null;
    let condStrategies = loadCondStrategies();
    let condSyncing = false;   // re-entry guard for the deck ↔ calculator binding

    GM_addStyle(`
        /* NOTE: this rule used to begin with a stray "[]" token, which made the
           whole selector list invalid — so border-box silently never applied to
           the Nuts HUD, and any width:100% element with padding/border overflowed
           its column. */
        #ratchet-master-container,
        #ratchet-master-container * { box-sizing: border-box !important; }
        #ratchet-master-container {
            --hud-bg:
                radial-gradient(circle at 8% 10%, rgba(122, 124, 255, 0.18), transparent 22%),
                radial-gradient(circle at 94% 4%, rgba(255, 79, 216, 0.2), transparent 24%),
                radial-gradient(circle at 50% 100%, rgba(24, 240, 255, 0.09), transparent 34%),
                linear-gradient(135deg, rgba(7, 10, 18, 0.96), rgba(18, 24, 35, 0.94) 42%, rgba(10, 12, 18, 0.98));
            --hud-panel: linear-gradient(160deg, rgba(36, 42, 56, 0.54), rgba(14, 18, 28, 0.76));
            --hud-border: rgba(128, 202, 255, 0.28);
            --hud-border-soft: rgba(255, 255, 255, 0.1);
            --hud-green: #19f3ff;
            --hud-green-dark: #8f63ff;
            --hud-red: #ff4c94;
            --hud-accent-a: #19f3ff;
            --hud-accent-b: #8f63ff;
            --hud-accent-c: #ff4fd8;
            --hud-positive: #43f6ff;
            --hud-negative: #ff6bb0;
            --hud-text: #f5fbff;
            --hud-text-soft: #aab6c9;
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: none !important;
            height: 100% !important;
            max-height: none !important;
            background: var(--hud-bg) !important;
            border: 1px solid var(--hud-border) !important;
            border-radius: 0 !important;
            padding: 8px !important;
            box-shadow: 0 28px 80px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
            z-index: auto !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important;
            pointer-events: auto !important;
            overflow: hidden !important;
            backdrop-filter: blur(24px) saturate(1.32);
            line-height: 1.15;
            color: var(--hud-text) !important;
        }
        #ratchet-master-container::before {
            content: '';
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
                linear-gradient(120deg, rgba(255, 255, 255, 0.05), transparent 22%, transparent 78%, rgba(255, 255, 255, 0.03)),
                radial-gradient(circle at 15% 18%, rgba(25, 243, 255, 0.08), transparent 18%),
                radial-gradient(circle at 82% 14%, rgba(255, 79, 216, 0.1), transparent 20%);
            opacity: 0.95;
        }
        #ratchet-master-container::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 0;
            pointer-events: none;
            opacity: 0;
            border: 1px solid transparent;
            box-shadow: inset 0 0 0 0 rgba(25, 243, 255, 0), inset 0 0 0 0 rgba(255, 79, 216, 0);
        }
        #ratchet-master-container.iow-win-reset-pulse::after { animation: ratchet-iow-win-reset-pulse 720ms ease-out 1; }
        @keyframes ratchet-iow-win-reset-pulse {
            0% { opacity: 0; }
            20% { opacity: 1; border-color: rgba(25, 243, 255, 0.88); box-shadow: inset 0 0 0 1px rgba(25, 243, 255, 0.74), inset 0 0 18px rgba(143, 99, 255, 0.26); }
            55% { opacity: 1; border-color: rgba(255, 79, 216, 0.78); box-shadow: inset 0 0 0 2px rgba(255, 79, 216, 0.72), inset 0 0 24px rgba(25, 243, 255, 0.24); }
            100% { opacity: 0; border-color: transparent; box-shadow: inset 0 0 0 0 rgba(25, 243, 255, 0), inset 0 0 0 0 rgba(255, 79, 216, 0); }
        }
        #ratchet-master-container[data-mode="iow"] { min-height: 0 !important; }
        #ratchet-master-container .hud-frame { display: flex; flex: 1 1 0; min-height: 0; min-width: 0; gap: 8px; overflow: hidden; position: relative; z-index: 2; }
        #ratchet-master-container .hud-workspace { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; min-width: 0; gap: 8px; overflow: hidden; position: relative; z-index: 3; }
        #ratchet-master-container .hud-native-sidebar-slot { display: flex; flex: 0 0 300px; width: 300px; min-width: 300px; max-width: 300px; min-height: 0; overflow: hidden; position: relative; z-index: 4; }
        #ratchet-master-container .hud-native-sidebar-slot:empty,
        #ratchet-master-container .hud-native-past-bets-slot:empty,
        #ratchet-master-container .hud-native-game-footer-slot:empty,
        #ratchet-master-container .hud-footer-slot:empty { display: none !important; }
        #ratchet-master-container .hud-native-sidebar-slot > .sc-8d275cfe-1 {
            width: 100% !important;
            height: 100% !important;
            min-width: 0 !important;
            min-height: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            padding: 10px !important;
            background: var(--hud-panel) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 12px !important;
            overflow: auto !important;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
            backdrop-filter: blur(22px) saturate(1.28) !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot > .sc-8d275cfe-1 > .sc-8d275cfe-2 {
            width: 100% !important;
            min-width: 0 !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot > .sc-8d275cfe-1 .sc-fe9b8b64-1,
        #ratchet-master-container .hud-native-sidebar-slot > .sc-8d275cfe-1 .sc-80ffdcd5-0,
        #ratchet-master-container .hud-native-sidebar-slot > .sc-8d275cfe-1 .sc-9e158b58-0 {
            width: 100% !important;
            max-width: 100% !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot > .sc-9b1418e2-1,
        #ratchet-master-container .hud-native-sidebar-slot > .sc-9b1418e2-0 {
            width: 100% !important;
            height: 100% !important;
            min-width: 0 !important;
            min-height: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            padding: 10px !important;
            background: var(--hud-panel) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 12px !important;
            overflow: auto !important;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
            backdrop-filter: blur(22px) saturate(1.28) !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot > .sc-9b1418e2-1 {
            padding-top: 10px !important;
            margin-top: 0 !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .styles-module___IID9a__game {
            width: 100% !important;
            min-height: 28px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            border-radius: 8px !important;
        }
        #ratchet-master-container .hud-native-past-bets-slot { display: flex; flex: 0 0 auto; min-height: 42px; min-width: 0; overflow: hidden; position: relative; z-index: 5; }
        #ratchet-master-container .hud-native-past-bets-slot > .sc-9b1418e2-1,
        #ratchet-master-container .hud-native-past-bets-slot > .sc-9b1418e2-0 {
            width: 100% !important;
            min-width: 0 !important;
            display: flex !important;
            align-items: center !important;
            gap: 6px !important;
            padding: 6px !important;
            background: var(--hud-panel) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 12px !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            box-shadow: 0 14px 30px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
            backdrop-filter: blur(20px) saturate(1.22) !important;
        }
        #ratchet-master-container .hud-native-past-bets-slot > .sc-9b1418e2-1 {
            height: auto !important;
            width: 100% !important;
            padding-left: 6px !important;
            margin-left: 0 !important;
            flex-direction: row !important;
            align-items: center !important;
            padding-top: 0 !important;
            margin-top: 0 !important;
        }
        #ratchet-master-container .hud-native-past-bets-slot .styles-module___IID9a__game { flex: 0 0 auto !important; }
        #ratchet-master-container #hud-content { display: flex; flex: 1 1 0; min-height: 0; min-width: 0; overflow: hidden; position: relative; z-index: 4; }
        #ratchet-master-container .hud-shell { display: flex; flex-direction: column; flex: 1 1 0; min-height: 0; min-width: 0; gap: 8px; overflow: hidden; position: relative; z-index: 4; }
        #ratchet-master-container .hud-panel { background: var(--hud-panel); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px) saturate(1.24); }
        #ratchet-master-container .mode-wrap { display: flex; flex: 0 0 auto; flex-wrap: nowrap; gap: 5px; background: linear-gradient(180deg, rgba(23, 29, 42, 0.7), rgba(14, 18, 27, 0.82)); padding: 6px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.09); box-shadow: 0 18px 36px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.05); position: relative; z-index: 3; backdrop-filter: blur(22px) saturate(1.26); }
        #ratchet-master-container .mode-btn { flex: 1 1 0; min-width: 0; padding: 8px 12px; border: none; border-radius: 999px; font-size: 12px; font-weight: 900; cursor: pointer; transition: transform 0.18s ease, filter 0.18s ease, background 0.18s ease, color 0.18s ease; text-transform: uppercase; letter-spacing: 0.4px; }
        #ratchet-master-container .mode-btn.active { background: linear-gradient(135deg, var(--hud-accent-a), var(--hud-accent-b) 45%, var(--hud-accent-c)); color: #070911; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2) inset, 0 0 18px rgba(25, 243, 255, 0.22), 0 0 26px rgba(255, 79, 216, 0.18); }
        #ratchet-master-container .mode-btn:not(.active) { background: rgba(77, 97, 123, 0.45); color: #c1cbda; }
        #ratchet-master-container .mode-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
        #ratchet-master-container .hud-top-bar, #ratchet-master-container .hud-controls-deck, #ratchet-master-container .hud-body, #ratchet-master-container .hud-split, #ratchet-master-container .input-row, #ratchet-master-container .input-cluster, #ratchet-master-container .btn-group, #ratchet-master-container .hud-stat-rail, #ratchet-master-container .hud-stats-grid, #ratchet-master-container .hud-meta-row, #ratchet-master-container .hud-header { display: flex; min-width: 0; }
        #ratchet-master-container .hud-header, #ratchet-master-container .hud-top-bar, #ratchet-master-container .hud-controls-deck { flex: 0 0 auto; }
        #ratchet-master-container .hud-top-bar, #ratchet-master-container .hud-controls-deck, #ratchet-master-container .hud-body, #ratchet-master-container .hud-split { gap: 8px; align-items: stretch; }
        #ratchet-master-container .hud-body, #ratchet-master-container .hud-split { flex: 1 1 0; min-height: 0; min-width: 0; overflow: hidden; flex-wrap: nowrap; position: relative; z-index: 4; }
        #ratchet-master-container .hud-body { justify-content: space-between; }
        #ratchet-master-container .hud-header, #ratchet-master-container .input-row, #ratchet-master-container .hud-meta-row { justify-content: space-between; align-items: center; gap: 8px; }
        #ratchet-master-container .hud-pane, #ratchet-master-container .graph-col, #ratchet-master-container .stats-col { flex: 1 1 0; min-height: 0; min-width: 0; overflow: hidden; position: relative; z-index: 4; }
        #ratchet-master-container .hud-pane { display: flex; flex-direction: column; gap: 8px; }
        #ratchet-master-container .hud-pane.primary { flex: 1.15 1 0; }
        #ratchet-master-container .hud-pane.secondary, #ratchet-master-container .stats-col { flex: 0 0 340px; width: 340px; min-width: 340px; max-width: 340px; display: flex; flex-direction: column; gap: 8px; }
        #ratchet-master-container .graph-col { display: flex; flex: 1 1 auto; min-width: 320px; }
        #ratchet-master-container .control-section { flex: 1 1 0; min-width: 0; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
        #ratchet-master-container .input-row { align-items: flex-end; flex-wrap: nowrap; }
        #ratchet-master-container .input-cluster { flex: 1 1 0; flex-wrap: wrap; align-items: flex-end; gap: 8px; min-width: 0; }
        #ratchet-master-container .input-group { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; }
        #ratchet-master-container .quick-btn { padding: 0; width: 26px; height: 26px; font-size: 10px; font-weight: 900; background: linear-gradient(180deg, rgba(39, 48, 63, 0.88), rgba(17, 22, 33, 0.94)); border: 1px solid rgba(142, 174, 212, 0.18); color: var(--hud-text); border-radius: 8px; cursor: pointer; flex: 0 0 auto; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05); }
        #ratchet-master-container .quick-btn:hover { background: linear-gradient(180deg, rgba(78, 96, 123, 0.7), rgba(24, 29, 43, 0.94)); }
        #ratchet-master-container input[type="number"] { background: rgba(8, 11, 18, 0.78); border: 1px solid rgba(142, 174, 212, 0.18); color: var(--hud-text); padding: 5px 6px; border-radius: 9px; width: 76px; font-size: 12px; font-weight: 700; text-align: center; outline: none; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04); }
        #ratchet-master-container input[type="number"]:focus { border-color: rgba(25, 243, 255, 0.72); box-shadow: 0 0 0 2px rgba(25, 243, 255, 0.12), 0 0 18px rgba(255, 79, 216, 0.12); }
        #ratchet-master-container .hud-risk-container { display: flex; flex: 1 1 100%; flex-wrap: nowrap; gap: 6px; min-width: 0; }
        #ratchet-master-container .hud-risk-container label { color: var(--hud-text-soft); font-size: 10px; font-weight: 800; display: flex; flex-direction: column; justify-content: space-between; gap: 4px; text-transform: uppercase; flex: 1 1 0; min-width: 0; }
        #ratchet-master-container .hud-risk-container input[type="number"] { width: 100%; min-width: 0; }
        #ratchet-master-container .btn-group { align-items: stretch; gap: 6px; flex-wrap: nowrap; justify-content: flex-end; flex: 0 0 auto; }
        #ratchet-master-container .hud-rapid-btn, #ratchet-master-container .hud-reset-btn { min-height: 38px; }
        #ratchet-master-container .hud-rapid-btn { border: none; color: #fff; font-size: 12px; font-weight: 900; padding: 8px 16px; border-radius: 9px; cursor: pointer; min-width: 108px; letter-spacing: 0.5px; text-transform: uppercase; flex: 1 1 0; }
        #ratchet-master-container .hud-rapid-btn.start { background: linear-gradient(135deg, var(--hud-accent-a), var(--hud-accent-b) 44%, var(--hud-accent-c)); color: #070911; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18) inset, 0 0 20px rgba(25, 243, 255, 0.2), 0 0 28px rgba(255, 79, 216, 0.16); }
        #ratchet-master-container .hud-rapid-btn.start:hover { filter: brightness(1.05) saturate(1.04); }
        #ratchet-master-container .hud-rapid-btn.stop { background: linear-gradient(135deg, rgba(255, 79, 216, 0.94), rgba(255, 76, 148, 0.94)); box-shadow: 0 0 18px rgba(255, 79, 216, 0.18); }
        #ratchet-master-container .hud-rapid-btn.stop:hover { filter: brightness(1.05); }
        #ratchet-master-container .hud-reset-btn { background: rgba(255, 79, 216, 0.06); border: 1px solid rgba(255, 79, 216, 0.58); color: #ff78bf; font-size: 11px; font-weight: 900; padding: 8px 14px; border-radius: 11px; cursor: pointer; flex: 1 1 0; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04); }
        #ratchet-master-container .hud-reset-btn:hover { background: linear-gradient(135deg, rgba(255, 79, 216, 0.18), rgba(255, 76, 148, 0.22)); color: #fff; }
        #ratchet-master-container .status-bar { background: var(--hud-panel); padding: 8px 10px; border-radius: 14px; text-align: center; font-size: 13px; font-weight: 900; letter-spacing: 0.2px; border: 1px solid rgba(255, 255, 255, 0.1); display: flex; align-items: center; justify-content: center; min-height: 42px; flex: 0 0 auto; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px) saturate(1.24); }
        #ratchet-master-container .hud-graph-box { flex: 1 1 0; min-height: 0; height: 100%; background: radial-gradient(circle at top left, rgba(25, 243, 255, 0.08), transparent 24%), radial-gradient(circle at top right, rgba(255, 79, 216, 0.1), transparent 24%), linear-gradient(180deg, rgba(8, 10, 17, 0.95), rgba(14, 17, 25, 0.98)); border: 1px solid rgba(146, 184, 224, 0.16); border-radius: 16px; overflow: hidden; position: relative; display: flex; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 20px 40px rgba(0, 0, 0, 0.28); }
        #ratchet-master-container .hud-graph-box canvas { width: 100%; height: 100%; display: block; flex: 1 1 auto; }
        #ratchet-master-container .hud-header { padding: 8px 12px; background: var(--hud-panel); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.05); position: relative; z-index: 4; backdrop-filter: blur(20px) saturate(1.24); }
        #ratchet-master-container .hud-header h2 { margin: 0; color: #fff; font-size: 14px; font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase; }
        #ratchet-master-container .hud-target-text { color: #eef8ff; font-size: 12px; font-weight: 800; font-style: italic; letter-spacing: 0.2px; text-shadow: 0 0 14px rgba(25, 243, 255, 0.14); }
        /* Controls-deck layout: wrap onto multiple rows, align labels at the
           bottom, separate columns and rows independently so a wrapped row
           sits closer to the row above than control-groups within a row. */
        #ratchet-master-container .hud-controls-deck { padding: 10px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.1); background: var(--hud-panel); flex-wrap: wrap; column-gap: 12px; row-gap: 8px; align-items: flex-end; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.05); position: relative; z-index: 2; backdrop-filter: blur(20px) saturate(1.24); }
        /* Each control-group sizes to its content; ranges expand to fill */
        #ratchet-master-container .hud-control-group { display: flex; flex-direction: column; gap: 4px; flex: 0 1 auto; min-width: 0; max-width: 100%; }
        #ratchet-master-container .hud-control-group:has(input[type="range"]) { flex: 1 1 160px; min-width: 140px; }
        /* Labels stay on one line so they never wrap and overlap their input */
        #ratchet-master-container .hud-control-group label { color: var(--hud-text-soft); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; overflow: visible; display: flex; justify-content: space-between; gap: 6px; }
        #ratchet-master-container .hud-control-group input[type="range"] { width: 100%; height: 6px; accent-color: var(--hud-green); cursor: pointer; }
        #ratchet-master-container .hud-control-group input[type="number"] { width: 100%; }
        #ratchet-master-container select { background: rgba(8, 11, 18, 0.78); border: 1px solid rgba(142, 174, 212, 0.18); color: var(--hud-text); padding: 4px 6px; border-radius: 9px; font-size: 11px; font-weight: 700; width: 100%; outline: none; appearance: auto; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04); }
        #ratchet-master-container select:disabled { opacity: 0.4; cursor: not-allowed; }
        #ratchet-master-container input[type="checkbox"] { accent-color: var(--hud-green); cursor: pointer; margin: 0; width: 14px; height: 14px; }
        #ratchet-master-container .hud-stat-rail { flex: 1 1 0; min-height: 0; min-width: 0; flex-direction: column; gap: 8px; overflow: hidden; }
        #ratchet-master-container .hud-stats-grid { flex: 1 1 0; min-height: 0; min-width: 0; display: grid; grid-template-columns: 1fr; grid-auto-rows: minmax(0, 1fr); gap: 6px; align-content: stretch; overflow: hidden; position: relative; z-index: 4; }
        #ratchet-master-container .stats-col-inner, #ratchet-master-container .hud-stat-card { min-height: 0; min-width: 0; background: var(--hud-panel); padding: 6px; border-radius: 14px; border: 1px solid rgba(255, 255, 255, 0.1); display: flex; flex-direction: column; gap: 3px; box-shadow: 0 18px 36px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.05); overflow: hidden; position: relative; z-index: 4; backdrop-filter: blur(20px) saturate(1.24); }
        #ratchet-master-container .hud-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; padding: 3px 8px; background: rgba(255, 255, 255, 0.045); border: 1px solid rgba(148, 177, 214, 0.08); border-radius: 999px; flex: 1 1 0; min-height: 0; }
        #ratchet-master-container .hud-label { color: var(--hud-text-soft); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.34px; }
        #ratchet-master-container .hud-val { color: var(--hud-text); font-size: 12px; font-weight: 800; font-family: "Roboto Mono", monospace; text-align: right; }
        #ratchet-master-container .hud-meta-row { gap: 8px; padding: 0 2px; flex: 0 0 auto; position: relative; z-index: 4; }
        #ratchet-master-container .hud-meta-chip { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex: 1 1 0; min-width: 0; padding: 8px 10px; background: var(--hud-panel); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 14px; overflow: hidden; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.05); backdrop-filter: blur(20px) saturate(1.24); }
        #ratchet-master-container .gear-text { font-style: italic; font-weight: 900; text-transform: uppercase; }
        #ratchet-master-container .gear-1-text { color: #94a3b8; }
        #ratchet-master-container .gear-2-text { color: #cbd5e1; }
        #ratchet-master-container .gear-3-text { color: #facc15; }
        #ratchet-master-container .gear-4-text { color: #fb923c; }
        #ratchet-master-container .gear-5-text { color: #f43f5e; text-shadow: 0 0 8px rgba(244, 63, 94, 0.4); }
        #ratchet-master-container .hud-footer-slot { display: flex; flex: 0 0 auto; min-width: 0; min-height: 88px; max-height: 88px; overflow: hidden; position: relative; z-index: 5; }
        #ratchet-master-container .hud-footer-slot > .sc-1d9445d-1 {
            width: 100% !important;
            height: 100% !important;
            display: flex !important;
            gap: 8px !important;
            align-items: stretch !important;
            background: transparent !important;
            overflow: hidden !important;
        }
        #ratchet-master-container .hud-footer-slot > .sc-1d9445d-1 > * {
            flex: 1 1 0 !important;
            min-width: 0 !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: space-between !important;
            gap: 8px !important;
            padding: 10px 12px !important;
            background: var(--hud-panel) !important;
            border: 1px solid rgba(255, 255, 255, 0.1) !important;
            border-radius: 14px !important;
            box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
            overflow: hidden !important;
            backdrop-filter: blur(20px) saturate(1.24) !important;
        }
        #ratchet-master-container .hud-footer-slot > .sc-1d9445d-1 > * > span {
            color: var(--hud-text-soft) !important;
            font-size: 12px !important;
            font-weight: 700 !important;
            text-transform: none !important;
            text-align: left !important;
        }
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-0,
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-1,
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-2 { width: 100% !important; }
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-1 {
            background: rgba(8, 11, 18, 0.78) !important;
            border: 1px solid rgba(142, 174, 212, 0.18) !important;
            border-radius: 11px !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
            padding: 0 10px !important;
        }
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-2 { display: flex !important; align-items: center !important; gap: 8px !important; }
        #ratchet-master-container .hud-footer-slot .sc-941e0ad-0,
        #ratchet-master-container .hud-footer-slot .sc-4932c000-0 {
            display: block !important;
            width: 100% !important;
            min-width: 0 !important;
            background: rgba(8, 11, 18, 0.78) !important;
            border: 1px solid rgba(142, 174, 212, 0.18) !important;
            border-radius: 9px !important;
            color: var(--hud-text) !important;
            font-size: 12px !important;
            font-weight: 800 !important;
            font-family: "Roboto Mono", monospace !important;
            padding: 6px 10px !important;
            box-shadow: none !important;
        }
        #ratchet-master-container .hud-footer-slot .sc-4932c000-1 {
            color: var(--hud-text) !important;
            font-size: 12px !important;
            font-weight: 800 !important;
            font-family: "Roboto Mono", monospace !important;
        }
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-4 {
            margin-left: auto !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            min-width: 20px !important;
            color: var(--hud-text-soft) !important;
        }
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-4 svg path { fill: var(--hud-text-soft) !important; }
        #ratchet-master-container .hud-footer-slot .sc-7201bf1a-1:hover { border-color: rgba(25, 243, 255, 0.52) !important; box-shadow: 0 0 0 1px rgba(255, 79, 216, 0.16) inset !important; }
        #ratchet-master-container .hud-native-game-footer-slot { display: flex; flex: 0 0 auto; min-height: 0; min-width: 0; overflow: hidden; }
        @media (max-width: 980px) {
            #ratchet-master-container { padding: 6px !important; }
            #ratchet-master-container .hud-frame { flex-direction: column !important; }
            #ratchet-master-container .hud-native-sidebar-slot {
                width: 100% !important;
                min-width: 0 !important;
                max-width: none !important;
                flex: 0 0 auto !important;
                max-height: 240px !important;
            }
            #ratchet-master-container .hud-footer-slot {
                min-height: 0 !important;
                max-height: none !important;
            }
            #ratchet-master-container .hud-footer-slot > .sc-1d9445d-1 {
                flex-direction: column !important;
                height: auto !important;
            }
        }
        .result.svelte-1oweb16, .multiplier-result, .result-multiplier, .crash-result, .limbo-result, [class*="crash"], [class*="result"][class*="multiplier"], span.result { display: none !important; }
        /* === HIDE THE NATIVE DICE SLIDER that bleeds through the HUD ===
           The thumb/track is absolutely positioned inside the bet panel we
           re-parent, so it paints on top of whatever the HUD renders below it.
           The three hashed classes below are Nuts build artefacts and change on
           every deploy — which is why the slider kept coming back — so match it
           structurally as well: anything slider-shaped inside the re-parented
           bet panel, by tag, role, or class stem. Keep the legacy hashes too;
           they cost nothing and still catch older builds. */
        .sc-1d9445d-12.dVJOJA,
        .sc-1d9445d-5.dWEMRV,
        .sc-1d9445d-13.ktRmlk,
        #ratchet-master-container #hud-native-sidebar-slot input[type="range"],
        #ratchet-master-container #hud-native-sidebar-slot [role="slider"],
        #ratchet-master-container #hud-native-sidebar-slot [class*="slider"],
        #ratchet-master-container #hud-native-sidebar-slot [class*="Slider"],
        #ratchet-master-container #hud-native-sidebar-slot [class*="thumb"],
        #ratchet-master-container #hud-native-sidebar-slot [class*="Thumb"] {
            display: none !important;
        }
        /* ...and the wrapper holding a range input, in case it carries the track
           styling itself. Ignored by engines without :has(), which is harmless. */
        #ratchet-master-container #hud-native-sidebar-slot :has(> input[type="range"]) { display: none !important; }
        /* === ADVANCED IOW (Nuts) — chrome around the mounted DiceTool panel.
           Palette and typography deliberately mirror the DiceTool.exe replica
           skin the panel itself uses (ttk clam: #162a35 frames, 2px #c9d1d9
           sunken LabelFrames with Times New Roman italic underlined titles,
           #071824 entries/buttons, #00ff80 accent) so the action bar and
           strategy frame read as part of the panel rather than the neon HUD. */
        /* The panel is the only child of #hud-content and fills it; everything
           lives inside its Stats tab, which scrolls with .dt-body. */
        #ratchet-master-container[data-mode="cond"] #hud-content { flex-direction: column; }
        /* Stats tab: nothing clips or scrolls internally, so the tab's real
           height propagates up to the HUD where fitCondHostHeight() can measure
           it and grow the game container to match — that is what stops the
           bottom being cut off. Scoped to [data-active-tab="stats"] so the other
           tabs (a 500-row Strategy Finder table) keep their own scrollbar and
           can't balloon the page. */
        #ratchet-master-container[data-mode="cond"] #hud-content { overflow: visible !important; }
        #ratchet-master-container[data-mode="cond"] .hud-frame,
        #ratchet-master-container[data-mode="cond"] .hud-workspace { overflow: visible !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel[data-active-tab="stats"] { height: auto !important; overflow: visible !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel[data-active-tab="stats"] .dt-body { overflow: visible !important; max-height: none !important; }
        /* Stats tab shell — mirrors the rules Stake's bridge CSS applies.
           Scoped through #hud-content so it outranks the replica skin's
           .dt-panel.active rules that follow it in the stylesheet.
           (No backticks in here — this block is a JS template literal.) */
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats { padding: 10px !important; flex-direction: column !important; gap: 8px !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats.active { display: flex !important; flex: 1 1 auto !important; min-height: 0 !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats * { box-sizing: border-box; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats > .hud-shell { display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; min-height: 0 !important; gap: 8px !important; }
        /* The HUD's stats grid divides a FIXED height into equal rows and clips
           the overflow, which truncates rows as soon as the panel is short. In
           the Stats tab everything sizes to its content instead and .dt-body
           does the scrolling, so no row is ever cut off at any panel height. */
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-body { flex: 0 0 auto !important; height: auto !important; min-height: 170px !important; align-items: stretch !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .graph-col { min-height: 170px !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-graph-box { min-height: 170px !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .stats-col { height: auto !important; overflow: visible !important; }
        /* flex:0 0 auto is the key one: as flex:1 1 0 the grid collapses into the
           leftover space and squeezes its cards instead of growing the column. */
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-stats-grid { flex: 0 0 auto !important; height: auto !important; grid-auto-rows: auto !important; align-content: start !important; overflow: visible !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .stats-col-inner,
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-stat-card { height: auto !important; overflow: visible !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-row { flex: 0 0 auto !important; min-height: 21px !important; }
        /* ---- Action bar ---- */
        #ratchet-master-container .cond-actionbar { display: flex; flex: 0 0 auto; align-items: center; gap: 10px; flex-wrap: wrap; padding: 9px 11px;
            background: #162a35 !important; border: 1px solid #2f4553 !important; border-radius: 8px !important;
            box-shadow: none !important; backdrop-filter: none !important; font-family: "Segoe UI", -apple-system, sans-serif; }
        #ratchet-master-container .cond-actionbar label { color: #c9d1d9 !important; font-size: 12px !important; font-weight: 700 !important; text-transform: none !important; letter-spacing: 0 !important; }
        #ratchet-master-container .cond-actionbar .input-group,
        #ratchet-master-container .cond-actionbar .btn-group { flex: 0 0 auto; gap: 7px; }
        /* Command bar — bet size and START, always on screen together.
           Takes the full width of the wrapping action bar so it reads as one
           surface rather than another chip in the row of inputs. */
        #ratchet-master-container .cond-actionbar .hud-cmd-bar {
            flex: 1 0 100%; display: flex; flex-direction: column; gap: 7px;
            margin-top: 2px; padding-top: 9px;
            border-top: 1px solid var(--hud-border-soft, rgba(255, 255, 255, 0.08));
        }
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-row {
            display: flex; gap: 7px; align-items: stretch;
        }
        /* Never wraps: these two are the point of the bar. */
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-primary { flex-wrap: nowrap; }
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-bet {
            flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 5px;
            padding: 0 7px 0 9px; border-radius: 4px;
            background: #071824; border: 1px solid #2f4553;
        }
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-bet-label {
            flex: 0 0 auto; font-size: 9px; font-weight: 800;
            letter-spacing: 0.12em; opacity: 0.6;
        }
        /* Overrides the fixed 108px above: an 8dp SOL figure must never be the
           thing that gets truncated, so the amount takes the slack in the row. */
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-bet input[type="number"] {
            flex: 1 1 auto; width: auto; min-width: 0;
            background: transparent; border: 0; box-shadow: none;
            font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
            text-align: right; padding: 8px 2px;
        }
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-bet input[type="number"]:focus {
            border: 0; box-shadow: none;
        }
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-bet .quick-btn {
            flex: 0 0 auto; min-width: 30px; padding: 5px 8px; font-size: 11px; font-weight: 800;
        }
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-primary > .hud-rapid-btn {
            flex: 0 0 34%; min-height: 40px; font-size: 13px; font-weight: 900; letter-spacing: 0.08em;
        }
        /* Wraps freely — it sits BELOW the primary row, so wrapping can never
           displace START. */
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-secondary { flex-wrap: wrap; }
        #ratchet-master-container .cond-actionbar .hud-cmd-bar .cmd-secondary > button {
            flex: 1 1 auto; min-width: 78px; min-height: 30px; padding: 0 10px;
            font-size: 11px; font-weight: 800; white-space: nowrap;
        }
        /* Nothing to report = no strip. In cond mode this carries warnings only. */
        #ratchet-master-container .cond-actionbar .status-bar:empty { display: none; }
        #ratchet-master-container .cond-actionbar input[type="number"] { width: 108px; background: #071824; border: 1px solid #2f4553; border-radius: 3px; color: #c9d1d9;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 400; text-align: left; padding: 5px 8px; box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4); }
        #ratchet-master-container .cond-actionbar input[type="number"]:focus { border-color: #c9d1d9; box-shadow: 0 0 0 1px #c9d1d9; }
        #ratchet-master-container .cond-actionbar .quick-btn { background: #071824; border: 1px solid #2f4553; color: #c9d1d9; border-radius: 3px; box-shadow: none; font-size: 11px; }
        #ratchet-master-container .cond-actionbar .quick-btn:hover { background: #1a2c38; color: #fff; border-color: #3a5566; }
        #ratchet-master-container .cond-actionbar select { background: #071824; border: 1px solid #2f4553; color: #c9d1d9; border-radius: 3px;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 400; padding: 5px 6px; width: auto; box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4); }
        #ratchet-master-container .cond-actionbar input[type="checkbox"] { appearance: auto; -webkit-appearance: auto; width: 15px; height: 15px; accent-color: #00ff80; flex: 0 0 auto; }
        #ratchet-master-container .cond-actionbar input[type="range"] { width: 96px; accent-color: #00ff80; flex: 0 0 auto; }
        #ratchet-master-container .cond-actionbar input#h-stats-ws-target { width: 56px; }
        /* W/L read-out chip — the deck's equivalent of Stake's wins/losses counter */
        #ratchet-master-container .cond-chip { display: flex; flex-direction: column; align-items: center; gap: 1px; flex: 0 0 auto;
            background: #071824; border: 1px solid #2f4553; border-radius: 3px; padding: 3px 10px; box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4); }
        #ratchet-master-container .cond-chip-head { display: flex; gap: 14px; }
        #ratchet-master-container .cond-chip-head span { font-size: 9px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #7d8a96; min-width: 34px; text-align: center; }
        #ratchet-master-container .cond-chip-vals { display: flex; gap: 14px; }
        #ratchet-master-container .cond-chip-vals b { font-family: "Roboto Mono", monospace; font-size: 14px; font-weight: 700; min-width: 34px; text-align: center; color: #00ff80; }
        #ratchet-master-container .cond-chip-vals b#h-stats-ctr-l { color: #7d8a96; }
        #ratchet-master-container .cond-chip-vals b#h-stats-ctr-l.has-loss { color: #e11d48; }
        #ratchet-master-container .cond-actionbar .status-bar { flex: 1 1 220px; min-height: 0; justify-content: flex-start; text-align: left; padding: 6px 10px;
            background: #071824 !important; border: 1px solid #2f4553 !important; border-radius: 3px !important; color: #c9d1d9 !important;
            font-family: "Segoe UI", -apple-system, sans-serif !important; font-size: 11.5px !important; font-weight: 400 !important; letter-spacing: 0 !important;
            box-shadow: none !important; backdrop-filter: none !important; }
        #ratchet-master-container .cond-actionbar .hud-reset-btn,
        #ratchet-master-container .cond-actionbar .hud-switch-ou-btn { background: #071824 !important; border: 1px solid #2f4553 !important; color: #c9d1d9 !important;
            border-radius: 3px !important; font-family: "Segoe UI", -apple-system, sans-serif !important; font-size: 12px !important; font-weight: 600 !important;
            text-transform: none !important; letter-spacing: 0 !important; padding: 6px 12px !important; min-height: 30px !important; box-shadow: none !important; }
        #ratchet-master-container .cond-actionbar .hud-reset-btn:hover,
        #ratchet-master-container .cond-actionbar .hud-switch-ou-btn:hover { background: #1a2c38 !important; color: #fff !important; border-color: #3a5566 !important; }
        /* UPDATE reads the balance and retunes the loaded strategy — a primary
           action, so it gets the accent outline without stealing START's fill. */
        #ratchet-master-container .cond-actionbar .hud-update-btn { background: #071824 !important; border: 1px solid #00ff80 !important; color: #00ff80 !important;
            border-radius: 3px !important; font-family: "Segoe UI", -apple-system, sans-serif !important; font-size: 12px !important; font-weight: 700 !important;
            text-transform: none !important; letter-spacing: 0 !important; padding: 6px 12px !important; min-height: 30px !important; cursor: pointer; box-shadow: none !important; }
        #ratchet-master-container .cond-actionbar .hud-update-btn:hover { background: rgba(0, 255, 128, 0.14) !important; color: #fff !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn { border-radius: 3px !important; font-family: "Segoe UI", -apple-system, sans-serif !important;
            font-size: 12px !important; font-weight: 700 !important; letter-spacing: 0.3px !important; padding: 6px 18px !important; min-height: 30px !important;
            min-width: 0 !important; box-shadow: none !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn.start { background: #00ff80 !important; border: 1px solid #00ff80 !important; color: #03171a !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn.start:hover { background: #4dffa6 !important; filter: none !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn.stop { background: #e11d48 !important; border: 1px solid #e11d48 !important; color: #fff !important; }
        /* ---- Left column: native bet panel on top, Strategy editor beneath ---- */
        #ratchet-master-container .hud-left-col { display: flex; flex-direction: column; flex: 0 0 300px; width: 300px; min-width: 300px; max-width: 300px;
            min-height: 0; gap: 8px; position: relative; z-index: 4; }
        #ratchet-master-container .hud-left-col > .hud-native-sidebar-slot { flex: 0 0 auto; width: 100%; min-width: 0; max-width: none; }
        #ratchet-master-container .hud-cond-left-slot { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
        #ratchet-master-container .hud-cond-left-slot:empty { display: none !important; }
        /* Advanced IOW: the column and its editor size to content so nothing is
           clipped — fitCondHostHeight() grows the page to match. */
        #ratchet-master-container[data-mode="cond"] .hud-left-col,
        #ratchet-master-container[data-mode="cond"] .hud-cond-left-slot { overflow: visible !important; }
        #ratchet-master-container .hud-cond-left-slot { max-width: 300px; }
        /* Everything in here must be free to shrink to the 300px column; the
           !importants beat the wider default field widths further down the
           sheet (same specificity, later in source order). */
        #ratchet-master-container .hud-cond-left-slot > .cond-deck-wrap { width: 100%; min-width: 0; max-width: 100%; }
        #ratchet-master-container .hud-cond-left-slot .cond-row { min-width: 0; }
        #ratchet-master-container .hud-cond-left-slot .cond-row > * { min-width: 0 !important; max-width: 100%; }
        #ratchet-master-container .hud-cond-left-slot .cond-row input,
        #ratchet-master-container .hud-cond-left-slot .cond-row select { width: 100% !important; }
        #ratchet-master-container .hud-cond-left-slot .cond-row .cond-del { width: 26px !important; }
        /* Narrow layout for the 300px column: stack each control full-width and
           drop the inline arrow, so a condition reads top-to-bottom. */
        #ratchet-master-container .hud-cond-left-slot .cond-strat-bar { flex-direction: column; align-items: stretch; gap: 6px; }
        #ratchet-master-container .hud-cond-left-slot .cond-strat-bar input#h-strat-name,
        #ratchet-master-container .hud-cond-left-slot .cond-strat-bar select#h-strat-select,
        #ratchet-master-container .hud-cond-left-slot .cond-strat-bar .cond-btn { flex: 0 0 auto; width: 100%; }
        #ratchet-master-container .hud-cond-left-slot .cond-strat-sep { display: none; }
        #ratchet-master-container .hud-cond-left-slot .cond-row { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; align-items: center; }
        #ratchet-master-container .hud-cond-left-slot .cond-row .cond-arrow { display: none; }
        #ratchet-master-container .hud-cond-left-slot .cond-row select,
        #ratchet-master-container .hud-cond-left-slot .cond-row input[type="number"] { width: 100%; min-width: 0; }
        #ratchet-master-container .hud-cond-left-slot .cond-row .cond-trigger,
        #ratchet-master-container .hud-cond-left-slot .cond-row .cond-action,
        #ratchet-master-container .hud-cond-left-slot .cond-row .cond-value,
        #ratchet-master-container .hud-cond-left-slot .cond-row input.cond-amount { grid-column: 1 / -1; }
        #ratchet-master-container .hud-cond-left-slot .cond-row .cond-del { grid-column: 1 / -1; justify-self: end; margin-left: 0; }
        #ratchet-master-container .hud-cond-left-slot .cond-add-btn { width: 100%; text-align: center; }
        /* ---- Strategy frame (sunken LabelFrame, like the panel's dt-card) ---- */
        #ratchet-master-container .cond-deck-wrap { position: relative; flex: 0 0 auto; display: flex; flex-direction: column; gap: 9px; padding: 16px 12px 12px;
            background: #162a35 !important; border: 2px solid #c9d1d9 !important; border-radius: 4px !important;
            box-shadow: inset 1px 1px 4px rgba(0,0,0,0.35) !important; backdrop-filter: none !important;
            font-family: "Segoe UI", -apple-system, sans-serif; color: #c9d1d9; }
        #ratchet-master-container .cond-deck-head { position: absolute; top: -11px; left: 10px; background: #162a35; padding: 0 7px;
            font-family: "Times New Roman", Georgia, serif; font-style: italic; font-weight: 700; text-decoration: underline;
            font-size: 14px; color: #c9d1d9; letter-spacing: 0; text-transform: none; white-space: nowrap; }
        /* Shared clam fields/buttons inside the frame */
        #ratchet-master-container .cond-deck-wrap input[type="number"],
        #ratchet-master-container .cond-deck-wrap input[type="text"],
        #ratchet-master-container .cond-deck-wrap select { background: #071824; border: 1px solid #2f4553; border-radius: 3px; color: #c9d1d9;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 400; padding: 5px 7px;
            box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4); appearance: auto; outline: none; }
        #ratchet-master-container .cond-deck-wrap input:focus,
        #ratchet-master-container .cond-deck-wrap select:focus { border-color: #c9d1d9; box-shadow: 0 0 0 1px #c9d1d9; }
        #ratchet-master-container .cond-deck-wrap .cond-btn { background: #071824; border: 1px solid #2f4553; color: #c9d1d9; border-radius: 3px; cursor: pointer;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 600; padding: 6px 12px; min-height: 30px; flex: 0 0 auto; }
        #ratchet-master-container .cond-deck-wrap .cond-btn:hover:not(:disabled) { background: #1a2c38; color: #fff; border-color: #3a5566; }
        #ratchet-master-container .cond-deck-wrap .cond-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        /* ---- Saved-strategy bar ---- */
        #ratchet-master-container .cond-strat-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-bottom: 9px; border-bottom: 1px solid #2f4553; }
        #ratchet-master-container .cond-strat-bar input#h-strat-name { flex: 1 1 160px; min-width: 0; }
        #ratchet-master-container .cond-strat-bar select#h-strat-select { flex: 1 1 190px; min-width: 0; }
        #ratchet-master-container .cond-strat-bar .cond-strat-sep { width: 1px; align-self: stretch; background: #2f4553; margin: 0 2px; }
        /* ---- Condition rows ---- */
        /* No inner scroller: the condition list grows and the game container is
           extended to fit it (fitCondHostHeight), so a long strategy is fully
           visible instead of scrolling inside a 168px window. */
        #ratchet-master-container .cond-deck { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; }
        #ratchet-master-container .cond-deck::-webkit-scrollbar { width: 10px; }
        #ratchet-master-container .cond-deck::-webkit-scrollbar-thumb { background: #2f4553; border-radius: 2px; border: 2px solid #162a35; }
        #ratchet-master-container .cond-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; background: #10202b; border: 1px solid #2f4553; border-radius: 3px; padding: 6px 8px; }
        #ratchet-master-container .cond-row select { width: auto; flex: 0 0 auto; }
        #ratchet-master-container .cond-row input[type="number"] { width: 64px; text-align: center; }
        #ratchet-master-container .cond-row input.cond-amount, #ratchet-master-container .cond-row input.cond-value { width: 106px; text-align: left; }
        #ratchet-master-container .cond-row .cond-arrow { color: #7d8a96; font-weight: 700; }
        #ratchet-master-container .cond-row .cond-del { margin-left: auto; background: #071824; border: 1px solid #2f4553; color: #e08a9b; border-radius: 3px;
            width: 26px; height: 26px; cursor: pointer; font-weight: 700; line-height: 1; flex: 0 0 auto; font-size: 14px; }
        #ratchet-master-container .cond-row .cond-del:hover { background: #e11d48; border-color: #e11d48; color: #fff; }
        #ratchet-master-container .cond-add-btn { align-self: flex-start; background: #071824; border: 1px solid #2f4553; color: #c9d1d9; border-radius: 3px; cursor: pointer;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0; text-transform: none; padding: 6px 12px; min-height: 30px; }
        #ratchet-master-container .cond-add-btn:hover { background: #1a2c38; color: #fff; border-color: #3a5566; }
        #ratchet-master-container .cond-empty { color: #7d8a96; font-size: 11.5px; font-style: italic; padding: 4px 2px; }
        /* =====================================================================
           NUTS THEME — Advanced IOW chrome.
           Everything above dresses this mode as the DiceTool.exe replica (ttk
           clam slate: #162a35 frames, 2px #c9d1d9 LabelFrames with Times New
           Roman titles, #00ff80 accent). This block repaints it in the HUD's
           own neon-glass palette so Advanced IOW reads as part of Nuts instead
           of a slate window pasted into it. Last in the sheet, so it wins ties
           against the rules above without touching them.
           Colour, type and radii only - nothing here moves a box.
           (No backticks in here - this block is a JS template literal.) */
        #ratchet-master-container .cond-actionbar { background: var(--hud-panel) !important; border: 1px solid var(--hud-border-soft) !important;
            border-radius: 12px !important; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.05) !important;
            backdrop-filter: blur(20px) saturate(1.24) !important; font-family: "Proxima Nova", "Segoe UI", sans-serif !important; }
        #ratchet-master-container .cond-actionbar label { color: var(--hud-text-soft) !important; font-size: 10px !important; font-weight: 800 !important;
            text-transform: uppercase !important; letter-spacing: 0.06em !important; }
        #ratchet-master-container .cond-actionbar input[type="number"],
        #ratchet-master-container .cond-actionbar select { background: rgba(8, 11, 18, 0.78) !important; border: 1px solid rgba(142, 174, 212, 0.18) !important;
            border-radius: 9px !important; color: var(--hud-text) !important; font-family: "Proxima Nova", "Segoe UI", sans-serif !important;
            font-weight: 700 !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; }
        #ratchet-master-container .cond-actionbar input[type="number"]:focus,
        #ratchet-master-container .cond-actionbar select:focus { border-color: var(--hud-accent-a) !important;
            box-shadow: 0 0 0 2px rgba(25, 243, 255, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; }
        #ratchet-master-container .cond-actionbar input[type="checkbox"] { accent-color: var(--hud-accent-a) !important; }
        #ratchet-master-container .cond-actionbar input[type="range"] { accent-color: var(--hud-accent-a) !important; }
        #ratchet-master-container .cond-actionbar .quick-btn { background: linear-gradient(180deg, rgba(39, 48, 63, 0.88), rgba(17, 22, 33, 0.94)) !important;
            border: 1px solid rgba(142, 174, 212, 0.18) !important; color: var(--hud-text) !important; border-radius: 8px !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05) !important; }
        #ratchet-master-container .cond-actionbar .quick-btn:hover { background: linear-gradient(180deg, rgba(52, 64, 84, 0.92), rgba(22, 28, 42, 0.96)) !important;
            border-color: rgba(25, 243, 255, 0.4) !important; color: #fff !important; }
        /* W/L chip */
        #ratchet-master-container .cond-chip { background: rgba(8, 11, 18, 0.62) !important; border: 1px solid var(--hud-border-soft) !important;
            border-radius: 10px !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; }
        #ratchet-master-container .cond-chip-head span { color: var(--hud-text-soft) !important; letter-spacing: 0.08em !important; }
        #ratchet-master-container .cond-chip-vals b { color: var(--hud-accent-a) !important; text-shadow: 0 0 12px rgba(25, 243, 255, 0.35) !important; }
        #ratchet-master-container .cond-chip-vals b#h-stats-ctr-l { color: var(--hud-text-soft) !important; text-shadow: none !important; }
        #ratchet-master-container .cond-chip-vals b#h-stats-ctr-l.has-loss { color: var(--hud-negative) !important;
            text-shadow: 0 0 12px rgba(255, 107, 176, 0.4) !important; }
        #ratchet-master-container .cond-actionbar .status-bar { background: rgba(8, 11, 18, 0.62) !important; border: 1px solid var(--hud-border-soft) !important;
            border-radius: 10px !important; color: var(--hud-text-soft) !important; font-family: "Proxima Nova", "Segoe UI", sans-serif !important; }
        #ratchet-master-container .cond-actionbar .hud-reset-btn,
        #ratchet-master-container .cond-actionbar .hud-switch-ou-btn { background: linear-gradient(180deg, rgba(39, 48, 63, 0.88), rgba(17, 22, 33, 0.94)) !important;
            border: 1px solid rgba(142, 174, 212, 0.18) !important; color: var(--hud-text) !important; border-radius: 9px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important; font-size: 10.5px !important; font-weight: 800 !important;
            text-transform: uppercase !important; letter-spacing: 0.06em !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05) !important; }
        #ratchet-master-container .cond-actionbar .hud-reset-btn:hover,
        #ratchet-master-container .cond-actionbar .hud-switch-ou-btn:hover { background: linear-gradient(180deg, rgba(52, 64, 84, 0.92), rgba(22, 28, 42, 0.96)) !important;
            border-color: rgba(25, 243, 255, 0.4) !important; color: #fff !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 14px rgba(25, 243, 255, 0.14) !important; }
        /* UPDATE keeps the accent outline; START keeps the accent fill. */
        #ratchet-master-container .cond-actionbar .hud-update-btn { background: rgba(25, 243, 255, 0.08) !important;
            border: 1px solid rgba(25, 243, 255, 0.55) !important; color: var(--hud-accent-a) !important; border-radius: 9px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important; font-size: 10.5px !important; font-weight: 800 !important;
            text-transform: uppercase !important; letter-spacing: 0.06em !important; box-shadow: 0 0 14px rgba(25, 243, 255, 0.14) !important; }
        #ratchet-master-container .cond-actionbar .hud-update-btn:hover { background: rgba(25, 243, 255, 0.18) !important; color: #fff !important;
            box-shadow: 0 0 20px rgba(25, 243, 255, 0.26) !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn { border-radius: 9px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important; font-size: 11px !important; font-weight: 800 !important;
            text-transform: uppercase !important; letter-spacing: 0.08em !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn.start { background: linear-gradient(135deg, var(--hud-accent-a), var(--hud-accent-b) 44%, var(--hud-accent-c)) !important;
            border: 1px solid rgba(255, 255, 255, 0.18) !important; color: #070911 !important;
            box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.18) inset, 0 0 20px rgba(25, 243, 255, 0.2), 0 0 28px rgba(255, 79, 216, 0.16) !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn.start:hover { filter: brightness(1.08) !important; background: linear-gradient(135deg, var(--hud-accent-a), var(--hud-accent-b) 44%, var(--hud-accent-c)) !important; }
        #ratchet-master-container .cond-actionbar .hud-rapid-btn.stop { background: var(--hud-red) !important; border: 1px solid var(--hud-red) !important;
            color: #fff !important; box-shadow: 0 0 20px rgba(255, 76, 148, 0.28) !important; }
        /* Strategy deck: glass card. The Times-italic title notched into a 2px
           border becomes a lettered cyan caption over a hairline, which is also
           what the panel's dt-card titles become in the theme block. */
        #ratchet-master-container .cond-deck-wrap { padding: 12px !important; background: rgba(10, 14, 22, 0.42) !important;
            border: 1px solid var(--hud-border-soft) !important; border-radius: 12px !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; backdrop-filter: blur(14px) saturate(1.2) !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important; color: var(--hud-text) !important; }
        #ratchet-master-container .cond-deck-head { position: static !important; top: auto !important; left: auto !important; display: block !important;
            background: none !important; padding: 0 0 7px !important; margin: 0 0 4px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important; font-style: normal !important; text-decoration: none !important;
            font-size: 10.5px !important; font-weight: 800 !important; letter-spacing: 0.1em !important; text-transform: uppercase !important;
            color: var(--hud-accent-a) !important; border-bottom: 1px solid rgba(25, 243, 255, 0.25) !important; }
        #ratchet-master-container .cond-deck-wrap input[type="number"],
        #ratchet-master-container .cond-deck-wrap input[type="text"],
        #ratchet-master-container .cond-deck-wrap select { background: rgba(8, 11, 18, 0.78) !important; border: 1px solid rgba(142, 174, 212, 0.18) !important;
            border-radius: 9px !important; color: var(--hud-text) !important; font-family: "Proxima Nova", "Segoe UI", sans-serif !important;
            font-weight: 700 !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; }
        #ratchet-master-container .cond-deck-wrap input:focus,
        #ratchet-master-container .cond-deck-wrap select:focus { border-color: var(--hud-accent-a) !important;
            box-shadow: 0 0 0 2px rgba(25, 243, 255, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; }
        #ratchet-master-container .cond-deck-wrap .cond-btn { background: linear-gradient(180deg, rgba(39, 48, 63, 0.88), rgba(17, 22, 33, 0.94)) !important;
            border: 1px solid rgba(142, 174, 212, 0.18) !important; color: var(--hud-text) !important; border-radius: 9px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important; font-size: 10.5px !important; font-weight: 800 !important;
            text-transform: uppercase !important; letter-spacing: 0.06em !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05) !important; }
        #ratchet-master-container .cond-deck-wrap .cond-btn:hover:not(:disabled) { background: linear-gradient(180deg, rgba(52, 64, 84, 0.92), rgba(22, 28, 42, 0.96)) !important;
            border-color: rgba(25, 243, 255, 0.4) !important; color: #fff !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 14px rgba(25, 243, 255, 0.14) !important; }
        #ratchet-master-container .cond-strat-bar { border-bottom: 1px solid var(--hud-border-soft) !important; }
        #ratchet-master-container .cond-strat-bar .cond-strat-sep { background: var(--hud-border-soft) !important; }
        #ratchet-master-container .cond-deck::-webkit-scrollbar-thumb { background: rgba(25, 243, 255, 0.28) !important; border-radius: 999px !important;
            border: 2px solid transparent !important; background-clip: padding-box !important; }
        #ratchet-master-container .cond-row { background: rgba(8, 11, 18, 0.55) !important; border: 1px solid rgba(255, 255, 255, 0.07) !important;
            border-radius: 10px !important; transition: border-color 0.15s ease !important; }
        #ratchet-master-container .cond-row:hover { border-color: rgba(25, 243, 255, 0.28) !important; }
        #ratchet-master-container .cond-row .cond-arrow { color: var(--hud-accent-b) !important; }
        #ratchet-master-container .cond-row .cond-del { background: rgba(255, 107, 176, 0.1) !important; border: 1px solid rgba(255, 107, 176, 0.35) !important;
            color: var(--hud-negative) !important; border-radius: 8px !important; }
        #ratchet-master-container .cond-row .cond-del:hover { background: var(--hud-red) !important; border-color: var(--hud-red) !important; color: #fff !important; }
        #ratchet-master-container .cond-add-btn { background: rgba(25, 243, 255, 0.06) !important; border: 1px dashed rgba(25, 243, 255, 0.45) !important;
            color: var(--hud-accent-a) !important; border-radius: 9px !important; font-family: "Proxima Nova", "Segoe UI", sans-serif !important;
            font-size: 10.5px !important; font-weight: 800 !important; text-transform: uppercase !important; letter-spacing: 0.06em !important; }
        #ratchet-master-container .cond-add-btn:hover { background: rgba(25, 243, 255, 0.16) !important; border-style: solid !important; color: #fff !important;
            box-shadow: 0 0 16px rgba(25, 243, 255, 0.18) !important; }
        #ratchet-master-container .cond-empty { color: var(--hud-text-soft) !important; }
        /* ---- Conditions popup ----
           Overlays the HUD (see ensureCondModal for why it is absolute-in-HUD
           rather than viewport-fixed). Everything inside is the same
           .cond-deck-wrap markup that used to sit in the left column, so it
           inherits the themed field/button rules above unchanged. */
        #ratchet-master-container .cond-modal { position: absolute; inset: 0; z-index: 60; display: none;
            align-items: center; justify-content: center; padding: 20px; }
        #ratchet-master-container .cond-modal.show { display: flex; }
        #ratchet-master-container .cond-modal-backdrop { position: absolute; inset: 0; background: rgba(4, 6, 12, 0.74);
            backdrop-filter: blur(6px) saturate(1.1); }
        #ratchet-master-container .cond-modal-card { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 10px;
            /* 760px so a full condition row (trigger, count, result, arrow,
               action, value, delete) fits on ONE line — at 620 the delete
               button wrapped onto a second row and left a gap. */
            width: min(760px, 100%); max-height: 100%; overflow-y: auto; padding: 14px;
            background: var(--hud-panel); border: 1px solid var(--hud-border); border-radius: 16px;
            box-shadow: 0 30px 70px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.05); }
        #ratchet-master-container .cond-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 auto; }
        #ratchet-master-container .cond-modal-title { font-size: 11px; font-weight: 800; letter-spacing: 0.1em;
            text-transform: uppercase; color: var(--hud-accent-a); }
        #ratchet-master-container .cond-modal-close { width: 28px; height: 28px; flex: 0 0 auto; cursor: pointer;
            background: rgba(255, 255, 255, 0.05); border: 1px solid var(--hud-border-soft); border-radius: 8px;
            color: var(--hud-text); font-size: 16px; line-height: 1; font-weight: 700; }
        #ratchet-master-container .cond-modal-close:hover { background: rgba(255, 107, 176, 0.18);
            border-color: var(--hud-negative); color: #fff; }
        #ratchet-master-container .cond-modal .cond-deck-wrap { width: 100%; }
        /* The opener carries the condition count, so the strategy stays legible
           without opening the popup. Accent-b so it reads as distinct from the
           cyan UPDATE and the gradient START beside it. */
        #ratchet-master-container .cond-actionbar .cond-open-btn { flex: 0 0 auto; cursor: pointer;
            background: rgba(143, 99, 255, 0.12) !important; border: 1px solid rgba(143, 99, 255, 0.5) !important;
            color: var(--hud-accent-b) !important; border-radius: 9px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important; font-size: 10.5px !important; font-weight: 800 !important;
            text-transform: uppercase !important; letter-spacing: 0.06em !important; padding: 6px 12px !important; min-height: 30px !important; }
        #ratchet-master-container .cond-actionbar .cond-open-btn:hover { background: rgba(143, 99, 255, 0.24) !important; color: #fff !important;
            box-shadow: 0 0 16px rgba(143, 99, 255, 0.28) !important; }
    `);

    function getUserSetMultiplier() {
        const inpTarget = document.querySelector('input[aria-label="payout selector"]');
        if (inpTarget) return parseFloat(inpTarget.value) || 2.00;
        const inpDice = document.querySelector('input.sc-941e0ad-0.eaPPXw');
        if (inpDice) return parseFloat(inpDice.value) || 1.98;
        return 2;
    }
    function findBalanceContainer() {
        const titled = document.querySelectorAll('div[title$=" SOL"]');
        for (const el of titled) {
            if (/^[\d.,]+\s+SOL$/.test((el.getAttribute('title') || '').trim())) return el;
        }
        return document.querySelector('.sc-cfbf8337-1.eaQLvl') || null;
    }
    /* Which unit the balance is DISPLAYED in.
       Decided from the visible text, and never from a title attribute: nuts.gg
       puts the USD equivalent inside the SOL span's own title
       (title="0.00000408 SOL ($0.00)") while the text reads "0.00000000 SOL",
       so the old `span[title*="$"]` test matched in BOTH modes and could never
       return false — silently forcing USD mode on a SOL site. Verified against
       the live DOM 2026-07-25.
       The pill shows both units, primary first, so the leading one wins. */
    function isUSDDisplayMode() {
        const bal = findBalanceContainer();
        if (!bal) return false;
        const txt = (bal.textContent || '').replace(/\s+/g, ' ').trim();
        /* Only a LEADING '$' means USD is the displayed unit. Do NOT decide from
           where 'SOL' sits relative to '$': the pill does not always spell the
           word out (a narrow header can render just the number plus a $
           sub-label), and a '$'-anywhere test then flips a SOL balance to USD
           and every money input back to 2dp. A bare leading number is the SOL
           balance whether or not 'SOL' is written beside it. */
        if (txt.startsWith('$')) return true;
        if (/\bSOL\b/i.test(txt)) return false;
        return /\bUSD\b/i.test(txt);
    }
    function getSolToUsdRate() {
        const bal = findBalanceContainer();
        if (!bal) return null;
        const innerSpan = bal.querySelector('span[title*="$"][title*="SOL"]');
        /* nuts.gg renders "0.00006839 SOL ($0.01)" — SOL first, USD in parentheses.
           The old pattern pinned the opposite order ("$0.01 (0.00006839 SOL)") and
           so returned null on the live site. In USD display mode that made
           displayToSol() an identity function, i.e. a dollar figure was used as a
           SOL amount. Pull the two numbers out independently instead of fixing an
           order. Verified against the live pill 2026-07-26. */
        const candidates = [
            bal.textContent || '',
            innerSpan ? (innerSpan.getAttribute('title') || '') : '',
            bal.getAttribute('title') || ''
        ];
        for (const t of candidates) {
            const sm = t.match(/([\d,]+\.?\d*)\s*SOL/i);
            const um = t.match(/\$\s*([\d,]+\.?\d*)/);
            if (!sm || !um) continue;
            const sol = parseFloat(sm[1].replace(/,/g, ''));
            const usd = parseFloat(um[1].replace(/,/g, ''));
            if (sol > 0 && usd > 0 && isFinite(usd) && isFinite(sol)) return usd / sol;
        }
        return null;
    }
    function displayToSol(displayVal) {
        if (!isUSDDisplayMode()) return displayVal;
        const rate = getSolToUsdRate();
        return (rate && rate > 0) ? displayVal / rate : displayVal;
    }
    function solToDisplay(solVal) {
        if (!isUSDDisplayMode()) return solVal;
        const rate = getSolToUsdRate();
        return (rate && rate > 0) ? solVal * rate : solVal;
    }
    function getCurrentBalance() {
        // Always returns SOL. The outer title reads "X SOL" and is invariant to
        // display mode — but nuts.gg writes that attribute ONCE, at page load, and
        // never updates it, so it is also invariant to the BALANCE. Measured on the
        // live logged-in page 2026-07-26: title stuck at 0.00006839 while the
        // visible text moved 0.00003647 -> 0.00004719. Reading the title made this
        // function return a constant, which zeroes every balance delta. The visible
        // text is the only live source; the titles are skeleton-state fallbacks.
        const bal = findBalanceContainer();
        if (!bal) return lastKnownBalance || 0;
        const innerSpan = bal.querySelector('span[title*="SOL"]');
        const candidates = [
            bal.textContent || '',
            innerSpan ? (innerSpan.getAttribute('title') || '') : '',
            bal.getAttribute('title') || ''
        ];
        for (const raw of candidates) {
            if (!raw.trim()) continue;
            // Strip USD sub-labels ("$0.00", "($0.01)") first so the fiat figure can
            // never be parsed as the SOL amount.
            const src = raw.replace(/\(\s*\$[\d.,]+\s*\)/g, ' ').replace(/\$\s*[\d.,]+/g, ' ');
            const match = src.match(/([\d,]+(?:\.\d+)?)\s*SOL/i) || src.match(/([\d,]+(?:\.\d+)?)/);
            if (!match) continue;
            const val = parseFloat(match[1].replace(/,/g, ''));
            if (isFinite(val)) {
                lastKnownBalance = val;
                return val;
            }
        }
        return lastKnownBalance || 0;
    }
    function getCurrentBet() {
        // Returns SOL-equivalent. Input value is in active display unit.
        const wagerInp = document.querySelector('input[aria-label="wager"]');
        if (!wagerInp) return minBaseBet;
        const rawVal = parseFloat(wagerInp.value.replace(/[^0-9.]/g, ''));
        if (!isFinite(rawVal) || rawVal <= 0) return minBaseBet;
        return displayToSol(rawVal);
    }
    function formatBetForInput(solAmount) {
        if (!isUSDDisplayMode()) return solAmount.toFixed(8);
        const usd = solToDisplay(solAmount);
        const twoDp = usd.toFixed(2);
        // 2dp USD for clean display, but keep 8dp when 2dp would round to 0
        return (parseFloat(twoDp) === 0 && solAmount > 0) ? usd.toFixed(8) : twoDp;
    }
    function typeIntoInput(inp, value) {
        inp.focus();
        try {
            inp.select();
            document.execCommand('selectAll', false, null);
            document.execCommand('insertText', false, value);
        } catch (e) {
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(inp, value);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
        }
        inp.dispatchEvent(new Event('change', { bubbles: true }));
        inp.blur();
    }
    function setBet(amount) {
        if (!isFinite(amount) || amount < minBaseBet) return false;
        const clamped = Math.min(Math.max(amount, minBaseBet), maxBaseBet);
        desiredBetAmount = clamped;
        lastPlacedBet = clamped;
        const inp = document.querySelector('input[aria-label="wager"]');
        if (!inp) return false;
        typeIntoInput(inp, formatBetForInput(clamped));
        setTimeout(() => {
            if (desiredBetAmount) {
                const currentDisplay = parseFloat(inp.value) || 0;
                const targetDisplay = solToDisplay(desiredBetAmount);
                const tol = isUSDDisplayMode() ? 0.005 : 0.00000005;
                if (Math.abs(currentDisplay - targetDisplay) > tol) {
                    typeIntoInput(inp, formatBetForInput(desiredBetAmount));
                }
            }
        }, 50);
        return true;
    }
    function forceSetBet(amount) {
        setBet(amount);
        setTimeout(() => setBet(amount), 8);
        setTimeout(() => setBet(amount), 25);
        setTimeout(() => setBet(amount), 60);
        setTimeout(() => setBet(amount), 120);
    }
    function startBetGuardian() {
        if (betGuardObserver) return;
        const inp = document.querySelector('input[aria-label="wager"]');
        if (!inp) return;
        betGuardObserver = new MutationObserver(() => {
            if (!desiredBetAmount || !isRapidFiring) return;
            const currentDisplay = parseFloat(inp.value) || 0;
            const targetDisplay = solToDisplay(desiredBetAmount);
            const tol = isUSDDisplayMode() ? 0.005 : 0.00000005;
            if (Math.abs(currentDisplay - targetDisplay) > tol) {
                typeIntoInput(inp, formatBetForInput(desiredBetAmount));
            }
        });
        betGuardObserver.observe(inp, { attributes: true, attributeFilter: ['value'] });
    }
    function stopBetGuardian() {
        if (betGuardObserver) {
            betGuardObserver.disconnect();
            betGuardObserver = null;
        }
        desiredBetAmount = null;
    }
    function getPlayButton() {
        let btn = document.querySelector('.sc-fe9b8b64-1.fmKmkj button.sc-67df7f38-0.kkdRMi');
        if (btn) return btn;
        return Array.from(document.querySelectorAll('button')).find(b =>
            (b.textContent || '').trim().includes('PLAY') || (b.textContent || '').trim().includes('ROLL')
        );
    }
    function findPastBetsContainer() {
        return document.querySelector('.sc-9b1418e2-1') || document.querySelector('.sc-9b1418e2-0');
    }
    function isWin(betDiv) {
        if (!betDiv) return false;
        const style = window.getComputedStyle(betDiv);
        return style.backgroundColor.includes('40, 67, 50');
    }
    function getLatestBetEntry(container) {
        if (!container) return null;
        const elements = container.querySelectorAll('.styles-module___IID9a__game');
        if (elements.length === 0) return null;
        const latest = elements[0];
        // ID derivation: prefer a stable attribute (so React rerenders of
        // the tile's content don't mint a new ID), then fall back to the
        // bet count. The previous formula `textContent + count` flipped
        // mid-bet whenever Nuts re-rendered the tile after the round
        // resolved — visible as a double-count in the stats whenever
        // hotkeys were off (slower bet cadence gives React time to do the
        // two-step render the observer was catching twice).
        const id = latest.getAttribute('data-bet-id')
                || latest.getAttribute('data-game-id')
                || latest.getAttribute('id')
                || ('idx-' + elements.length);
        return { element: latest, id };
    }
    function getLowestCommonAncestor(a, b) {
        if (!a || !b) return null;
        const ancestors = new Set();
        let node = a;
        while (node) {
            ancestors.add(node);
            node = node.parentElement;
        }
        node = b;
        while (node) {
            if (ancestors.has(node)) return node;
            node = node.parentElement;
        }
        return null;
    }
    function getHudHost() {
        const nativeSidebar = findNativeElement('.sc-8d275cfe-1.eGfUZM') || findNativeElement('.sc-8d275cfe-1');
        const nativeStage = findNativeElement('.sc-8d275cfe-3.eertbI') || findNativeElement('.sc-8d275cfe-3');
        const sharedHost = getLowestCommonAncestor(nativeSidebar, nativeStage);
        if (sharedHost && sharedHost !== document.body && sharedHost !== document.documentElement) {
            return sharedHost;
        }
        // Returns null when no Nuts game container is on the page — buildHUD
        // then tears the HUD down. Previously this fell back to document.body,
        // which caused our absolute-positioned overlay to cover the home page
        // / lobby after SPA navigation away from /dice or /target.
        return nativeStage
            || nativeSidebar
            || document.querySelector('.sc-1d9445d-0.cCJWrI')
            || document.querySelector('.sc-1d9445d-0')
            || null;
    }
    function findNativeElement(selector) {
        const elements = Array.from(document.querySelectorAll(selector));
        return elements.find(el => !el.closest('#ratchet-master-container')) || elements[0] || null;
    }
    function mountSingleElement(slot, element) {
        if (!slot || !element) return;
        if (slot.childElementCount === 1 && slot.firstElementChild === element) return;
        slot.replaceChildren(element);
    }
    function syncNativeHudElements() {
        const nativeSidebar = findNativeElement('.sc-8d275cfe-1.eGfUZM') || findNativeElement('.sc-8d275cfe-1');
        const recentBets = findNativeElement('.sc-9b1418e2-1') || findNativeElement('.sc-9b1418e2-0');
        const sidebarSlot = document.getElementById('hud-native-sidebar-slot');
        const pastBetsSlot = document.getElementById('hud-native-past-bets-slot');
        mountSingleElement(sidebarSlot, nativeSidebar);
        mountSingleElement(pastBetsSlot, recentBets);
        mountSingleElement(
            document.getElementById('hud-footer-slot'),
            findNativeElement('.sc-1d9445d-1.hFwXoL') || findNativeElement('.sc-1d9445d-1')
        );
    }
    /** Map the current Nuts URL to one of the two split tool ids and check
     *  if the user has that specific tool enabled. */
    function isCurrentGameEnabledNuts() {
        const path = location.pathname || '';
        let toolId = null;
        if (/\/dice(?:\/|$|\?|#)/i.test(path)) toolId = 'nuts-dice';
        else if (/\/target(?:\/|$|\?|#)/i.test(path)) return false; // Dice standalone: never mount on Target
        if (!toolId) return true; // unknown URL — getHudHost null-check handles it
        try { return isToolIdEnabled(toolId); }
        catch (e) { return true; }
    }

    /** True on a Nuts Dice page only (not Target). Used to conditionally
     *  render the Switch Over/Under button — Target has no direction. */
    function isOnDicePage() {
        return /\/dice(?:\/|$|\?|#)/i.test(location.pathname || '');
    }

    /** Find Nuts's "Roll Over / Roll Under" swap button. Nuts uses
     *  hashed CSS module classes that change on every deploy, so we
     *  walk up from the text label to the enclosing button. */
    function getRollOverUnderSwap() {
        const label = Array.from(document.querySelectorAll('span'))
            .find(s => /^Roll\s+Over$|^Roll\s+Under$|^ROLL\s+OVER$|^ROLL\s+UNDER$/.test((s.textContent || '').trim()));
        if (!label) return null;
        return label.closest('button');
    }

    function buildHUD() {
        const gameDisplay = getHudHost();
        if (!gameDisplay || !isCurrentGameEnabledNuts()) {
            // SPA navigation away from a Nuts game page (e.g. user clicked
            // the nuts.gg logo to go home / open the lobby), OR the user
            // disabled the specific game tool (Nuts Dice / Nuts Limbo/Target).
            // Remove any existing HUD so its absolute-positioned overlay
            // doesn't sit on top of the new page. Native elements we
            // relocated into HUD slots get torn down with the HUD; Nuts
            // re-renders them when the user navigates back to a game.
            const existing = document.getElementById('ratchet-master-container');
            if (existing) existing.remove();
            return;
        }
        let hud = document.getElementById('ratchet-master-container');
        if (window.getComputedStyle(gameDisplay).position === 'static') gameDisplay.style.position = 'relative';
        if (hud && hud.parentElement !== gameDisplay) gameDisplay.appendChild(hud);
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'ratchet-master-container';
            hud.innerHTML = `
                <div class="hud-frame">
                    <div class="hud-left-col">
                        <div id="hud-native-sidebar-slot" class="hud-native-sidebar-slot"></div>
                        <!-- Advanced IOW puts the Strategy / conditions editor here, under
                             the native bet panel — the way Stake's strategy editor lives in
                             its left bet column. It is a SIBLING of the native slot because
                             syncNativeHudElements() calls replaceChildren() on that slot
                             every tick and would wipe anything placed inside it. -->
                        <div id="hud-cond-left-slot" class="hud-cond-left-slot">${ACTIVE_MODE === 'cond' ? condDeckHTML() : ''}</div>
                    </div>
                    <div class="hud-workspace">
                        <div id="hud-native-past-bets-slot" class="hud-native-past-bets-slot"></div>
                        <div class="mode-wrap">
                            <button id="mode-manual" class="mode-btn">Manual</button>
                            <button id="mode-iow" class="mode-btn">IOW</button>
                            <button id="mode-smart" class="mode-btn">Smart</button>
                            <button id="mode-cond" class="mode-btn">Advanced IOW</button>
                        </div>
                        <div id="hud-content"></div>
                        <div id="hud-footer-slot" class="hud-footer-slot"></div>
                    </div>
                </div>
                <div id="hud-native-game-footer-slot" class="hud-native-game-footer-slot"></div>
            `;
            gameDisplay.appendChild(hud);
            document.getElementById('mode-manual').onclick = () => switchMode('manual');
            document.getElementById('mode-iow').onclick = () => switchMode('iow');
            document.getElementById('mode-smart').onclick = () => switchMode('smart');
            document.getElementById('mode-cond').onclick = () => switchMode('cond');
            buildHUDContent();
        }
        hud.dataset.mode = ACTIVE_MODE;
        hud.style.removeProperty('height');
        syncModeButtons();
        syncNativeHudElements();
        setTimeout(syncNativeHudElements, 350);
    }
    function buildHUDContent() {
        const content = document.getElementById('hud-content');
        const hud = document.getElementById('ratchet-master-container');
        if (!content) return;
        if (hud) hud.dataset.mode = ACTIVE_MODE;
        syncModeButtons();
        // Park the DiceTool panel out of #hud-content before we wipe it, so
        // `content.innerHTML = ''` can't destroy it (Advanced IOW mounts it).
        // Reset the column layout too; the cond branch re-applies it.
        unmountDicePanel();
        // The left-column strategy editor lives outside #hud-content, so it has
        // to be torn down explicitly when leaving Advanced IOW.
        if (ACTIVE_MODE !== 'cond') clearCondModal();
        content.style.removeProperty('flex-direction');
        content.style.removeProperty('gap');
        content.innerHTML = '';
        let html = '';
        if (ACTIVE_MODE === 'cond') {
            // Advanced IOW mirrors Stake exactly: the DiceTool panel is the ONLY
            // child of #hud-content, and every control lives inside its "Stats"
            // tab (built by ensureNutsStatsTab from attachListeners). Nothing is
            // a sibling here, so nothing can overflow the game area and get
            // clipped by the native bet panel below it.
            html = '';
        } else if (ACTIVE_MODE === 'iow') {
            html = `
                <div class="hud-shell">
                    <div class="hud-top-bar">
                        <div class="control-section hud-panel">
                            <div class="input-row">
                                <div class="input-cluster">
                                    <label style="color:#94a3b8;font-size:10px;font-weight:800;white-space:nowrap;">Base bet</label>
                                    <div class="input-group">
                                        <input id="h-base" type="number" step="0.00000001" value="${baseBet.toFixed(8)}">
                                        <button id="h-double-base" class="quick-btn">2x</button>
                                        <button id="h-half-base" class="quick-btn">1/2</button>
                                    </div>
                                    <div class="hud-risk-container">
                                        <label>Win increase % <input id="h-win-inc" type="number" min="0" value="${winIncreasePercent}"></label>
                                        <label>Loss reset <input id="h-loss-reset" type="number" min="1" value="${lossStreakReset}"></label>
                                        <label>Win reset <input id="h-wins-reset" type="number" min="1" value="${winsBeforeReset || ''}"></label>
                                        <label>Autostop on Balance: <input id="h-autostop" type="number" step="0.00000001" value="${autoStopBalance !== null ? autoStopBalance.toFixed(8) : ''}" placeholder="OFF"></label>
                                    </div>
                                </div>
                                <div class="btn-group">
                                    <button id="h-reset" class="hud-reset-btn">RESET STATS</button>
                                    ${isOnDicePage() ? '<button id="h-switch-ou" class="hud-switch-ou-btn">Switch Over/Under</button>' : ''}
                                    <button id="h-rapid-toggle" class="hud-rapid-btn start">START</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="hud-split">
                        <div class="hud-pane primary">
                            <div class="status-bar" id="h-target"> base bet: 0.00000010 | Wins: 0 | LossStreak: 0 </div>
                            <div class="hud-graph-box" id="h-graph-box">
                                <canvas id="h-custom-graph"></canvas>
                            </div>
                        </div>
                        <div class="hud-pane secondary">
                            <div class="hud-stat-rail">
                                <div class="hud-stat-card">
                                    <div class="hud-row"><span class="hud-label">Starting Balance</span><span id="h-start-bal" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Profit/Loss</span><span id="h-profit" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Balance</span><span id="h-peak-bal" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                                </div>
                                <div class="hud-stat-card">
                                    <div class="hud-row"><span class="hud-label">Session RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                                    <div class="hud-row"><span class="hud-label">Total Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Total Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                                    <div class="hud-row"><span class="hud-label">Wins / Losses</span><span id="h-wl" class="hud-val">0 / 0</span></div>
                                </div>
                                <div class="hud-stat-card">
                                    <div class="hud-row"><span class="hud-label">Multiplier Performance</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                                </div>
                            </div>
                            <div class="hud-meta-row">
                                <div class="hud-meta-chip">
                                    <span class="hud-label">Best Streaks</span>
                                    <span id="h-best-w" class="hud-val" style="color:var(--hud-positive);">-</span>
                                </div>
                                <div class="hud-meta-chip">
                                    <span class="hud-label">Worst Streaks</span>
                                    <span id="h-worst-l" class="hud-val" style="color:var(--hud-negative);">-</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else if (ACTIVE_MODE === 'smart') {
            html = `
                <div class="hud-shell">
                    <div class="hud-header">
                        <span id="h-target" class="hud-target-text">Initializing Data Link...</span>
                    </div>
                    <div class="hud-controls-deck hud-panel">
                        <div class="hud-control-group">
                            <label>Aggression <span id="h-agg-val" style="color:#fff;">${aggressionLevel.toFixed(1)}x</span></label>
                            <input type="range" id="h-agg" min="0.5" max="3.0" step="0.1" value="${aggressionLevel.toFixed(1)}">
                        </div>
                        <div class="hud-control-group">
                            <label style="flex-direction: row; justify-content: flex-start; gap: 6px; cursor: pointer; color: #94a3b8;">
                                <input type="checkbox" id="h-lock-agg-chk" ${lockAggressionState ? 'checked' : ''}> Lock State
                            </label>
                            <select id="h-lock-gear-sel" ${lockAggressionState ? '' : 'disabled'}>
                                <option value="1" ${lockedGearLevel === 1 ? 'selected' : ''}>Conservative</option>
                                <option value="2" ${lockedGearLevel === 2 ? 'selected' : ''}>Steady</option>
                                <option value="3" ${lockedGearLevel === 3 ? 'selected' : ''}>Balanced</option>
                                <option value="4" ${lockedGearLevel === 4 ? 'selected' : ''}>Press</option>
                                <option value="5" ${lockedGearLevel === 5 ? 'selected' : ''}>Aggro</option>
                            </select>
                        </div>
                        <div class="hud-control-group">
                            <label>Stop Loss %</label>
                            <input id="h-sl" type="number" min="0" max="50" value="0" step="0.5">
                        </div>
                        <div class="hud-control-group">
                            <label>Take Profit %</label>
                            <input id="h-tp" type="number" min="0" max="100" value="0" step="0.5">
                        </div>
                        <div class="hud-control-group">
                            <label>Autostop on Balance:</label>
                            <input id="h-autostop" type="number" step="0.00000001" value="${autoStopBalance !== null ? autoStopBalance.toFixed(8) : ''}" placeholder="OFF">
                        </div>
                        <div class="btn-group">
                            <button id="h-reset" class="hud-reset-btn">RESET</button>
                            ${isOnDicePage() ? '<button id="h-switch-ou" class="hud-switch-ou-btn">Switch Over/Under</button>' : ''}
                            <button id="h-rapid-toggle" class="hud-rapid-btn start">START</button>
                        </div>
                    </div>
                    <div class="hud-body">
                        <div class="graph-col">
                            <div class="hud-graph-box">
                                <canvas id="h-custom-graph"></canvas>
                            </div>
                        </div>
                        <div class="stats-col">
                            <div class="hud-stats-grid">
                                <div class="stats-col-inner">
                                    <div class="hud-row"><span class="hud-label">Starting Balance</span><span id="h-start-bal" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Profit/Loss</span><span id="h-profit" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Balance</span><span id="h-peak-bal" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                                </div>
                                <div class="stats-col-inner">
                                    <div class="hud-row"><span class="hud-label">Total Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                                    <div class="hud-row"><span class="hud-label">Total Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Wins / Losses</span><span id="h-wl" class="hud-val">0 / 0</span></div>
                                    <div class="hud-row"><span class="hud-label">Session RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                                </div>
                                <div class="stats-col-inner">
                                    <div class="hud-row"><span class="hud-label">Aggression state</span><span id="h-state" class="hud-val gear-text gear-1-text">GEAR 1</span></div>
                                    <div class="hud-row"><span class="hud-label">Momentum Window</span><span id="h-hot" class="hud-val">0/0</span></div>
                                    <div class="hud-row"><span class="hud-label">Streak (W|L)</span><span id="h-streaks" class="hud-val">0/0 | 0/0</span></div>
                                    <div class="hud-row"><span class="hud-label">Multiplier Performance</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                                </div>
                            </div>
                            <div class="hud-meta-row">
                                <div class="hud-meta-chip">
                                    <span class="hud-label">Best Streaks</span>
                                    <span id="h-best-w" class="hud-val" style="color:var(--hud-positive);">-</span>
                                </div>
                                <div class="hud-meta-chip">
                                    <span class="hud-label">Worst Streaks</span>
                                    <span id="h-worst-l" class="hud-val" style="color:var(--hud-negative);">-</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            html = `
                <div class="hud-shell">
                    <div class="hud-header">
                        <span id="h-target" class="hud-target-text">Manual • Full Stats • Spacebar Rapid</span>
                    </div>
                    <div class="hud-controls-deck hud-panel">
                        <div class="hud-control-group">
                            <label>Bet</label>
                            <div class="input-group">
                                <input id="h-manual-bet" type="number" step="0.00000001" min="0.00000001" value="${manualBet.toFixed(8)}" style="width: 96px; flex: 0 0 auto;">
                                <button id="h-manual-double" class="quick-btn">2x</button>
                                <button id="h-manual-half" class="quick-btn">1/2</button>
                            </div>
                        </div>
                        <div class="hud-control-group">
                            <label>Stop Loss %</label>
                            <input id="h-sl" type="number" min="0" max="50" value="0" step="0.5">
                        </div>
                        <div class="hud-control-group">
                            <label>Take Profit %</label>
                            <input id="h-tp" type="number" min="0" max="100" value="0" step="0.5">
                        </div>
                        <div class="hud-control-group">
                            <label>Autostop on Balance:</label>
                            <input id="h-autostop" type="number" step="0.00000001" value="${autoStopBalance !== null ? autoStopBalance.toFixed(8) : ''}" placeholder="OFF">
                        </div>
                        <div class="btn-group">
                            <button id="h-reset" class="hud-reset-btn">RESET</button>
                            ${isOnDicePage() ? '<button id="h-switch-ou" class="hud-switch-ou-btn">Switch Over/Under</button>' : ''}
                            <button id="h-rapid-toggle" class="hud-rapid-btn start">START</button>
                        </div>
                    </div>
                    <div class="hud-body">
                        <div class="graph-col">
                            <div class="hud-graph-box">
                                <canvas id="h-custom-graph"></canvas>
                            </div>
                        </div>
                        <div class="stats-col">
                            <div class="hud-stats-grid">
                                <div class="stats-col-inner">
                                    <div class="hud-row"><span class="hud-label">Starting Balance</span><span id="h-start-bal" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Profit/Loss</span><span id="h-profit" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Balance</span><span id="h-peak-bal" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                                </div>
                                <div class="stats-col-inner">
                                    <div class="hud-row"><span class="hud-label">Total Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                                    <div class="hud-row"><span class="hud-label">Total Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Wins / Losses</span><span id="h-wl" class="hud-val">0 / 0</span></div>
                                    <div class="hud-row"><span class="hud-label">Session RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                                    <div class="hud-row"><span class="hud-label">Streak (W|L)</span><span id="h-streaks" class="hud-val">0/0 | 0/0</span></div>
                                    <div class="hud-row"><span class="hud-label">Multiplier Performance</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                                </div>
                                <div class="stats-col-inner">
                                    <div class="hud-meta-row">
                                        <div class="hud-meta-chip">
                                            <span class="hud-label">Best Streaks</span>
                                            <span id="h-best-w" class="hud-val" style="color:var(--hud-positive);">-</span>
                                        </div>
                                        <div class="hud-meta-chip">
                                            <span class="hud-label">Worst Streaks</span>
                                            <span id="h-worst-l" class="hud-val" style="color:var(--hud-negative);">-</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        content.innerHTML = html;
        attachListeners();
    }
    function switchMode(newMode) {
        // Detect "empty hud-content" — happens when leaving Advanced IOW
        // back to the same mode that was active before (activateTools clears
        // #hud-content but doesn't touch ACTIVE_MODE, so a same-mode click
        // would otherwise early-return and leave the HUD blank).
        const content = document.getElementById('hud-content');
        const needsRebuild = !!content && content.children.length === 0;
        if (newMode === ACTIVE_MODE && !needsRebuild) return;
        ACTIVE_MODE = newMode;
        syncModeButtons();
        if (isRapidFiring) stopRapidFire();
        // Entering Manual: seed manualBet from the wager input so the HUD's
        // bet field reflects what the user already had typed there.
        if (newMode === 'manual') {
            const cur = getCurrentBet();
            if (isFinite(cur) && cur >= minBaseBet) manualBet = cur;
        }
        buildHUDContent();
        resetStats();
    }
    function syncModeButtons() {
        document.querySelectorAll('#ratchet-master-container .mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.id === `mode-${ACTIVE_MODE}`);
        });
    }
    function attachListeners() {
        // Advanced IOW: mount the DiceTool panel and build its Stats tab BEFORE
        // any wiring below, because every control now lives inside that tab.
        if (ACTIVE_MODE === 'cond') {
            mountDicePanel();
            ensureNutsStatsTab();
            /* The conditions editor lives in the LEFT SIDE PANEL, under the native
               bet panel, not in a popup. #hud-cond-left-slot was built for exactly
               this and the HUD markup now fills it, so the deck is always on screen
               and needs no button to reveal it.
               The modal is deliberately NOT created: it renders the same
               condDeckHTML(), so having both alive would duplicate every
               #h-cond-* / #h-strat-* id and getElementById would silently favour
               whichever came first. Any stale modal from a previous mode is torn
               down here for the same reason. */
            clearCondModal();
            /* Fill the side panel here, not only in the HUD template. The shell is
               built once (while the mode is still 'smart') and switching modes
               swaps only the mode panel, so a template-only insert left the slot
               empty — and .hud-cond-left-slot is `:empty { display: none }`, so it
               collapsed to zero width and the editor was simply absent. */
            const condSlot = document.getElementById('hud-cond-left-slot');
            if (condSlot && !condSlot.querySelector('.cond-deck-wrap')) {
                condSlot.innerHTML = condDeckHTML();
            }
            renderCondStrategyBar();
            renderCondBlocks();
        }
        const rapidBtn = document.getElementById('h-rapid-toggle');
        if (rapidBtn) rapidBtn.onclick = () => { if (!isRapidFiring) startRapidFire(); else stopRapidFire(); };
        const resetBtn = document.getElementById('h-reset');
        if (resetBtn) resetBtn.onclick = resetStats;
        // Autostop on Balance — shared across Manual / IOW / Smart modes.
        // Each mode's HTML renders its own #h-autostop input; the rapid-fire
        // tick already checks autoStopBalance globally and stops when reached.
        const autostopInp = document.getElementById('h-autostop');
        if (autostopInp) {
            autostopInp.addEventListener('input', () => { autoStopBalance = parseFloat(autostopInp.value) || null; });
            autostopInp.addEventListener('blur', () => { let v = parseFloat(autostopInp.value) || 0; autostopInp.value = v ? v.toFixed(8) : ''; autoStopBalance = v || null; });
        }
        // Switch Over/Under — Dice only, shared across Manual / IOW / Smart.
        // Briefly pause rapid-fire so the swap click always commits cleanly
        // between bets; without this the swap often lands mid-click-cycle
        // and Nuts ignores it.
        const switchOuBtn = document.getElementById('h-switch-ou');
        if (switchOuBtn) {
            switchOuBtn.addEventListener('click', async () => {
                if (switchOuBtn.disabled) return;
                switchOuBtn.disabled = true;
                try {
                    const wasRunning = isRapidFiring;
                    if (wasRunning) stopRapidFire();
                    await new Promise(r => setTimeout(r, 40));
                    const swap = getRollOverUnderSwap();
                    if (swap) swap.click();
                    await new Promise(r => setTimeout(r, 60));
                    if (wasRunning) startRapidFire();
                } catch (e) { console.error('[Switch Over/Under] failed:', e); }
                setTimeout(() => { switchOuBtn.disabled = false; }, 250);
            });
        }
        if (ACTIVE_MODE === 'cond') {
            const condInp = document.getElementById('h-cond-base');
            if (condInp) {
                condInp.addEventListener('input', () => { condBaseBet = parseFloat(condInp.value) || minBaseBet; saveCondState(); });
                condInp.addEventListener('blur', () => { let v = parseFloat(condInp.value) || minBaseBet; condInp.value = v.toFixed(8); condBaseBet = v; saveCondState(); });
            }
            const condDouble = document.getElementById('h-cond-double');
            if (condDouble) condDouble.addEventListener('click', () => {
                let val = parseFloat(document.getElementById('h-cond-base').value) || minBaseBet;
                val *= 2;
                document.getElementById('h-cond-base').value = val.toFixed(8);
                condBaseBet = val;
                saveCondState();
            });
            const condHalf = document.getElementById('h-cond-half');
            if (condHalf) condHalf.addEventListener('click', () => {
                let val = parseFloat(document.getElementById('h-cond-base').value) || minBaseBet;
                val = Math.max(minBaseBet, val * 0.5);
                document.getElementById('h-cond-base').value = val.toFixed(8);
                condBaseBet = val;
                saveCondState();
            });
            const condAdd = document.getElementById('h-cond-add');
            if (condAdd) condAdd.addEventListener('click', () => {
                condBlocks.push({ trigger: 'every', count: 1, result: 'win', cmp: 'gte', amount: '', action: 'increaseBet', value: 100 });
                condRuntime.push(condDefaultRuntime());
                saveCondState();
                renderCondBlocks();
            });
            renderCondBlocks();
            // Saved strategies — name + Save, and a dropdown that loads on pick
            // (Delete stays disabled until something is selected).
            const stratSave = document.getElementById('h-strat-save');
            const stratName = document.getElementById('h-strat-name');
            if (stratSave) stratSave.addEventListener('click', () => condSaveStrategy(stratName ? stratName.value : ''));
            if (stratName) stratName.addEventListener('keydown', e => {
                if (e.key === 'Enter') { e.preventDefault(); condSaveStrategy(stratName.value); }
            });
            const stratSel = document.getElementById('h-strat-select');
            if (stratSel) stratSel.addEventListener('change', () => {
                const del = document.getElementById('h-strat-del');
                if (del) del.disabled = !stratSel.value;
                if (stratSel.value) condLoadStrategy(stratSel.value);
            });
            const stratDel = document.getElementById('h-strat-del');
            if (stratDel) stratDel.addEventListener('click', () => {
                const sel = document.getElementById('h-strat-select');
                if (sel && sel.value) condDeleteStrategy(sel.value);
            });
            renderCondStrategyBar();
            /* Balance Divisor / Profit Multiplier are the same two knobs the
               calculator owns, surfaced in the deck so you can retune without
               leaving the Stats tab — two-way bound, exactly like Stake's deck. */
            const bindCalcField = (deckId, calcId) => {
                const deck = document.getElementById(deckId);
                const calc = document.getElementById(calcId);
                if (!deck || !calc) return;
                deck.value = calc.value;
                deck.addEventListener('input', () => {
                    if (condSyncing) return;
                    condSyncing = true;
                    try {
                        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                        setter.call(calc, deck.value);
                        calc.dispatchEvent(new Event('input', { bubbles: true }));
                        calc.dispatchEvent(new Event('change', { bubbles: true }));
                    } finally { condSyncing = false; }
                });
                calc.addEventListener('input', () => {
                    if (condSyncing) return;
                    condSyncing = true;
                    try { deck.value = calc.value; } finally { condSyncing = false; }
                });
            };
            bindCalcField('h-stats-bet-div', 'dt-bet_div');
            bindCalcField('h-stats-profit-mult', 'dt-profit_mult');
            // UPDATE = the dice tool's own "Send To Game" path (read balance →
            // recompute → retune the loaded strategy), so there's one code path.
            const updBtn = document.getElementById('h-stats-update');
            if (updBtn) updBtn.addEventListener('click', () => {
                const sync = document.getElementById('dt-game_sync');
                if (sync) sync.click();
                else { condNotice = { text: 'Calculator not ready yet.', until: Date.now() + 3000 }; updateUI(); }
            });
            // Autostop @ Win Streak
            const wsChk = document.getElementById('h-stats-ws-chk');
            if (wsChk) wsChk.addEventListener('change', () => { condWsStopOn = wsChk.checked; saveCondState(); });
            const wsTar = document.getElementById('h-stats-ws-target');
            if (wsTar) wsTar.addEventListener('input', () => {
                const n = parseInt(wsTar.value, 10);
                if (Number.isFinite(n) && n > 0) { condWsTarget = n; saveCondState(); }
            });
            // Stats scope: whole session, or just since the last START
            const trackSel = document.getElementById('h-stats-track');
            if (trackSel) trackSel.addEventListener('change', () => {
                condTrackPer = trackSel.value === 'cycle' ? 'cycle' : 'session';
                saveCondState();
                updateUI();
            });
            // Win-beep volume
            const volInp = document.getElementById('h-stats-vol');
            if (volInp) volInp.addEventListener('input', () => {
                condVolume = Math.max(0, Math.min(100, parseInt(volInp.value, 10) || 0));
                const lbl = document.getElementById('h-stats-vol-val');
                if (lbl) lbl.textContent = condVolume;
                saveCondState();
            });
        } else if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base');
            if (baseInp) {
                baseInp.addEventListener('input', () => { baseBet = parseFloat(baseInp.value) || minBaseBet; });
                baseInp.addEventListener('blur', () => { let v = parseFloat(baseInp.value) || minBaseBet; baseInp.value = v.toFixed(8); baseBet = v; });
            }
            const doubleBtn = document.getElementById('h-double-base');
            if (doubleBtn) doubleBtn.addEventListener('click', () => {
                let val = parseFloat(document.getElementById('h-base').value) || minBaseBet;
                val *= 2;
                document.getElementById('h-base').value = val.toFixed(8);
                baseBet = val;
                if (isRapidFiring) forceSetBet(val);
            });
            const halfBtn = document.getElementById('h-half-base');
            if (halfBtn) halfBtn.addEventListener('click', () => {
                let val = parseFloat(document.getElementById('h-base').value) || minBaseBet;
                val *= 0.5;
                val = Math.max(minBaseBet, val);
                document.getElementById('h-base').value = val.toFixed(8);
                baseBet = val;
                if (isRapidFiring) forceSetBet(val);
            });
            const winInc = document.getElementById('h-win-inc'); if (winInc) winInc.addEventListener('input', () => { winIncreasePercent = parseFloat(winInc.value) || 125; });
            const lossReset = document.getElementById('h-loss-reset'); if (lossReset) lossReset.addEventListener('input', () => { lossStreakReset = parseInt(lossReset.value, 10) || 3; });
            const winsReset = document.getElementById('h-wins-reset'); if (winsReset) winsReset.addEventListener('input', () => { winsBeforeReset = parseInt(winsReset.value, 10) || null; });
        } else {
            const slInp = document.getElementById('h-sl'); if (slInp) slInp.addEventListener('input', () => { stopLossPct = parseFloat(slInp.value) || 0; });
            const tpInp = document.getElementById('h-tp'); if (tpInp) tpInp.addEventListener('input', () => { takeProfitPct = parseFloat(tpInp.value) || 0; });
            if (ACTIVE_MODE === 'manual') {
                // Manual mode bet controls — input + 2x/1/2 buttons that
                // immediately push the new value into the wager input when
                // rapid-fire is running, so the user can change bet size
                // without stopping autoplay. Mirrors IOW's pattern above.
                const manualInp = document.getElementById('h-manual-bet');
                if (manualInp) {
                    manualInp.addEventListener('input', () => {
                        const v = parseFloat(manualInp.value);
                        if (isFinite(v) && v >= minBaseBet) {
                            manualBet = v;
                            if (isRapidFiring) forceSetBet(v);
                        }
                    });
                    manualInp.addEventListener('blur', () => {
                        let v = parseFloat(manualInp.value) || minBaseBet;
                        if (v < minBaseBet) v = minBaseBet;
                        manualInp.value = v.toFixed(8);
                        manualBet = v;
                        if (isRapidFiring) forceSetBet(v);
                    });
                }
                const manualDouble = document.getElementById('h-manual-double');
                if (manualDouble) manualDouble.addEventListener('click', () => {
                    const inp = document.getElementById('h-manual-bet');
                    let v = parseFloat(inp.value) || minBaseBet;
                    v *= 2;
                    inp.value = v.toFixed(8);
                    manualBet = v;
                    if (isRapidFiring) forceSetBet(v);
                });
                const manualHalf = document.getElementById('h-manual-half');
                if (manualHalf) manualHalf.addEventListener('click', () => {
                    const inp = document.getElementById('h-manual-bet');
                    let v = parseFloat(inp.value) || minBaseBet;
                    v = Math.max(minBaseBet, v * 0.5);
                    inp.value = v.toFixed(8);
                    manualBet = v;
                    if (isRapidFiring) forceSetBet(v);
                });
            }
            if (ACTIVE_MODE === 'smart') {
                const aggInp = document.getElementById('h-agg');
                if (aggInp) aggInp.addEventListener('input', e => { aggressionLevel = parseFloat(e.target.value); const valEl = document.getElementById('h-agg-val'); if (valEl) valEl.textContent = `${aggressionLevel.toFixed(1)}x`; });
                const lockChk = document.getElementById('h-lock-agg-chk');
                const gearSel = document.getElementById('h-lock-gear-sel');
                if (lockChk && gearSel) {
                    lockChk.addEventListener('change', (e) => {
                        lockAggressionState = e.target.checked;
                        gearSel.disabled = !lockAggressionState;
                        updateUI();
                    });
                    gearSel.addEventListener('change', (e) => {
                        lockedGearLevel = parseInt(e.target.value, 10);
                        updateUI();
                    });
                }
            }
        }
    }
    function resetStats() {
        const bal = getCurrentBalance();
        sessionPeak = bal; initialBalance = bal; lastKnownBalance = bal;
        totalWagered = 0; highestProfit = 0; totalWins = 0; totalLosses = 0; totalBets = 0;
        lossStreak = 0; counter = 0; lastBetId = null; profitHistory = [0]; lastAmount = 0;
        betHistory = []; recentWins = []; topWinStreaks = []; topLossStreaks = [];
        curLossStreak = 0; maxLossStreak = 0; curWinStreak = 0; maxWinStreak = 0;
        multGames = 0; multWins = 0; lastResult = null; autoPaused = false; stopLossPct = 0; takeProfitPct = 0;
        rapidBlockedSince = 0; rapidFireStartedAt = 0; lastObservedBetTime = 0;
        lastPlacedBet = ACTIVE_MODE === 'cond' ? condBaseBet : baseBet;
        resetCondRuntime();
        if (isRapidFiring) stopRapidFire();
        if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base'); if (baseInp) baseInp.value = baseBet.toFixed(8);
        } else if (ACTIVE_MODE === 'cond') {
            const condInp = document.getElementById('h-cond-base'); if (condInp) condInp.value = condBaseBet.toFixed(8);
        } else if (ACTIVE_MODE === 'smart') {
            const aggInp = document.getElementById('h-agg'); if (aggInp) aggInp.value = aggressionLevel.toFixed(1);
            const valEl = document.getElementById('h-agg-val'); if (valEl) valEl.textContent = `${aggressionLevel.toFixed(1)}x`;
        }
        const sl = document.getElementById('h-sl'); if (sl) sl.value = '0';
        const tp = document.getElementById('h-tp'); if (tp) tp.value = '0';
        syncLastSeenBet();
        updateUI();
    }
    function syncLastSeenBet(container = pastBetsContainer || findPastBetsContainer()) {
        const latestBet = getLatestBetEntry(container);
        lastBetId = latestBet ? latestBet.id : null;
    }
    function triggerWinResetPulse() {
        const hud = document.getElementById('ratchet-master-container');
        // IOW and Advanced IOW both flash when the progression resets to base.
        if (!hud || (ACTIVE_MODE !== 'iow' && ACTIVE_MODE !== 'cond')) return;
        if (winResetPulseTimer) clearTimeout(winResetPulseTimer);
        hud.classList.remove('iow-win-reset-pulse');
        void hud.offsetWidth;
        hud.classList.add('iow-win-reset-pulse');
        winResetPulseTimer = setTimeout(() => {
            hud.classList.remove('iow-win-reset-pulse');
            winResetPulseTimer = null;
        }, 800);
    }
    /* ================== ADVANCED IOW (conditions + DiceTool panel) ================== */
    /* ---- DiceTool panel (#dt-aio-panel) mount helpers. The panel is built by
       tool_dice_tool() (bundled on Nuts) and parked off-screen in <body> via
       its base CSS until Advanced IOW mounts it as a direct child of
       #hud-content, where the injected bridge CSS makes it fill the tab. ---- */
    function unmountDicePanel() {
        const p = document.getElementById('dt-aio-panel');
        if (p && p.parentElement && p.parentElement.id === 'hud-content') {
            document.body.appendChild(p);
            p.classList.remove('show');
        }
        // Empty the Stats tab whenever the panel is parked. Its controls reuse
        // the HUD's element ids (h-rapid-toggle, h-autostop, …), so leaving them
        // in a detached panel would create duplicate ids that getElementById
        // could hand back to Manual / IOW / Smart mode.
        const statsPanel = document.getElementById('dt-panel-stats');
        if (statsPanel) statsPanel.textContent = '';
    }
    function mountDicePanel() {
        const p = document.getElementById('dt-aio-panel');
        const content = document.getElementById('hud-content');
        if (!p || !content) return;
        if (p.parentElement !== content) content.appendChild(p);
        p.classList.add('show');
    }
    /** Grow the Nuts game container so the whole Advanced IOW panel is visible
     *  without scrolling. The HUD is absolutely positioned (inset: 0) inside the
     *  host, so its height IS the host's height — we can't measure a natural
     *  height directly. Instead we read how much the panel body is overflowing
     *  and add exactly that to the host's min-height, which converges in one or
     *  two ticks. Growth-only, so it can't oscillate; capped so a 500-row
     *  Strategy Finder result can't push the page to absurd heights (that tab
     *  keeps its own scrollbar). Cleared when leaving Advanced IOW. */
    /** Hide native game UI that bleeds through the HUD — the dice slider being
     *  the visible offender.
     *
     *  Identifying the slider is a dead end: its classes are deploy hashes (the
     *  old CSS pinned .dVJOJA/.dWEMRV/.ktRmlk and went stale) and it's a plain
     *  div, so there is no tag, role or class stem to match on. Invert the
     *  problem instead — the HUD covers the whole game area, so ANYTHING else
     *  painting in there is bleed-through by definition.
     *
     *  Walk from the HUD up hiding each level's siblings. That can never hit the
     *  HUD or its own ancestors. `visibility: hidden` rather than
     *  `display: none` so the boxes keep their size and the container doesn't
     *  collapse under the absolutely-positioned HUD.
     *
     *  The walk is bounded by GEOMETRY, not by a class. Pinning the top of the
     *  walk to `.sc-1d9445d-0` is what made the first version a no-op on the
     *  live site: that hash isn't an ancestor of the HUD at all (the real chain
     *  is .sc-8d275cfe-0 < .sc-37732b3d-1 < .sc-37732b3d-0 < .sc-22ee21c-*),
     *  so `root.contains(hud)` was false and the function returned immediately.
     *  Instead: the HUD is inset:0 in the game host, so every wrapper that IS
     *  the game area has the HUD's box; the first ancestor that is materially
     *  bigger is page furniture (the 1920px-wide page column, the site nav) and
     *  we stop before touching its children. A sibling is only hidden if it
     *  actually paints inside the HUD's box — where the HUD is drawing over it
     *  regardless, so hiding it can only remove bleed-through. */
    function hideNativeBleedThrough() {
        const hud = document.getElementById('ratchet-master-container');
        const restore = el => {
            el.style.removeProperty('visibility');
            delete el.dataset.nutsBleedHidden;
        };
        if (!hud) {
            // HUD gone (tool disabled / navigated away): give the page back.
            document.querySelectorAll('[data-nuts-bleed-hidden]').forEach(restore);
            return;
        }
        // Anything we've since adopted INTO the HUD must be visible again — the
        // native bet panel and past-bets feed get re-parented on a later tick
        // than they may first have been hidden on.
        hud.querySelectorAll('[data-nuts-bleed-hidden]').forEach(restore);
        const hb = hud.getBoundingClientRect();
        if (hb.width < 40 || hb.height < 40) return;   // not laid out yet
        let node = hud;
        for (let hops = 0; hops < 6; hops++) {
            const parent = node.parentElement;
            if (!parent || parent === document.body || parent === document.documentElement) break;
            const pb = parent.getBoundingClientRect();
            if (pb.width > hb.width + 24 || pb.height > hb.height + 24) break;   // page furniture
            for (const sib of Array.from(parent.children)) {
                if (sib === node || sib === hud || sib.dataset.nutsBleedHidden) continue;
                const sb = sib.getBoundingClientRect();
                if (sb.width < 2 || sb.height < 2) continue;
                if (sb.right <= hb.left || sb.left >= hb.right
                    || sb.bottom <= hb.top || sb.top >= hb.bottom) continue;   // not under the HUD
                sib.dataset.nutsBleedHidden = '1';
                sib.style.setProperty('visibility', 'hidden', 'important');
            }
            node = parent;
        }
    }
    const COND_HOST_MAX_H = 2400;
    /** Undo every layout override fitCondHostHeight applied. */
    function releaseCondHostHeight() {
        document.querySelectorAll('[data-cond-fitted]').forEach(el => {
            el.style.removeProperty('min-height');
            el.style.removeProperty('overflow-y');
            delete el.dataset.condFitted;
        });
    }
    function fitCondHostHeight() {
        const host = getHudHost();
        const hud = document.getElementById('ratchet-master-container');
        if (!host || !hud) return;
        if (ACTIVE_MODE !== 'cond') {
            // Leaving Advanced IOW: hand the page back exactly as we found it.
            releaseCondHostHeight();
            return;
        }
        /* How much taller does the content need to be than the box it's in?
           Always a DIFFERENCE (scrollHeight - clientHeight), never an absolute:
           comparing scrollHeight against the host's height creeps upward
           forever, because for a box whose content fits, scrollHeight IS
           clientHeight.

           The HUD alone is not enough to measure. Its own scrollHeight only
           sees content spilling past the HUD's bottom edge, but the panel
           overflows into the footer slot INSIDE the HUD — the native
           MULTIPLIER / ROLL OVER / WIN CHANCE bar — where it stays within the
           HUD box and reports zero overflow while visibly sitting on top of the
           stats rail. So probe the boxes that actually hold content too and
           take the largest excess.

           Note these must be scroll-overflow probes, not "deepest descendant
           bottom": .dt-panel stretches to its container, so a geometric
           deepest-bottom metric grows every time the host grows and never
           converges. Measured on the live page this settles in one tick
           (105 -> 0 -> 0). */
        let overflow = hud.scrollHeight - hud.clientHeight;
        for (const sel of ['#hud-content', '.dt-body', '.hud-left-col', '#hud-cond-left-slot']) {
            const box = document.querySelector(sel);
            if (!box) continue;
            const excess = box.scrollHeight - box.clientHeight;
            if (excess > overflow) overflow = excess;
        }
        if (overflow <= 2) return;
        const current = Math.ceil(host.getBoundingClientRect().height);
        const needed = Math.min(COND_HOST_MAX_H, current + overflow);
        /* Grow the host AND every ancestor that would otherwise clip it. Nuts
           nests the game area in flex wrappers that have their own heights (and
           `flex: 1 1 0; min-height: 0` items never grow from content), so
           sizing only the immediate host leaves a parent cutting it off — which
           is exactly what happened on the live page while the mock, with a
           single plain wrapper, looked fine. Everything touched is tagged so
           releaseCondHostHeight() can put it back on exit. */
        let el = host;
        for (let hops = 0; el && hops < 8 && el !== document.body && el !== document.documentElement; hops++) {
            if (el.clientHeight > 0 && el.clientHeight < needed) {
                el.style.setProperty('min-height', needed + 'px', 'important');
                el.dataset.condFitted = '1';
            }
            const oy = getComputedStyle(el).overflowY;
            if (oy === 'hidden' || oy === 'auto' || oy === 'scroll') {
                el.style.setProperty('overflow-y', 'visible', 'important');
                el.dataset.condFitted = '1';
            }
            el = el.parentElement;
        }
    }
    /** Build (or refill) the Advanced IOW "Stats" tab — the tab the user
     *  actually plays from, mirroring the one Stake's integration injects: it
     *  goes first in the tab strip and is the landing tab. Returns false until
     *  the DiceTool panel exists. */
    function ensureNutsStatsTab() {
        const panel = document.getElementById('dt-aio-panel');
        if (!panel) return false;
        const tabsNav = panel.querySelector('.dt-tabs');
        const body = panel.querySelector('.dt-body');
        if (!tabsNav || !body) return false;
        let statsBtn = tabsNav.querySelector('[data-tab="stats"]');
        let statsPanel = panel.querySelector('#dt-panel-stats');
        if (!statsBtn) {
            statsBtn = document.createElement('button');
            statsBtn.className = 'dt-tab-btn';
            statsBtn.dataset.tab = 'stats';
            statsBtn.textContent = 'Play';
            // Sit ahead of Find New Strategy so Play is the first tab in the strip.
            const firstBtn = tabsNav.querySelector('[data-tab="easy"]');
            if (firstBtn) tabsNav.insertBefore(statsBtn, firstBtn);
            else tabsNav.insertBefore(statsBtn, tabsNav.firstChild);
        }
        if (!statsPanel) {
            statsPanel = document.createElement('section');
            statsPanel.className = 'dt-panel';
            statsPanel.id = 'dt-panel-stats';
            body.insertBefore(statsPanel, body.firstChild);
        }
        statsPanel.innerHTML = condStatsTabHTML();
        // Land on Stats when Advanced IOW opens (the dice tool's own delegated
        // tab handler takes over from here).
        tabsNav.querySelectorAll('.dt-tab-btn').forEach(b => b.classList.toggle('active', b === statsBtn));
        panel.querySelectorAll('.dt-panel').forEach(p => p.classList.toggle('active', p === statsPanel));
        panel.setAttribute('data-active-tab', 'stats');
        body.scrollTop = 0;
        return true;
    }
    /** Stats-tab markup. Uses the HUD's own .hud-* classes so the existing HUD
     *  CSS paints it like the Manual / IOW / Smart panels, and keeps the element
     *  ids updateUI() and attachListeners() already look up. */
    function condStatsTabHTML() {
        return `
            <div class="hud-shell">
                <div class="cond-actionbar hud-panel">
                    <!-- Base bet is NOT here any more: it sits in the pinned
                         command bar at the bottom of this panel, beside START, so
                         the bet size and the button that commits it are always on
                         screen together instead of being separated by six other
                         inputs and a status line restating both. -->
                    <div class="input-group">
                        <label>Bal divisor</label>
                        <input id="h-stats-bet-div" type="number" step="any" min="1" title="Balance ÷ this = bet size (higher = smaller bets)">
                    </div>
                    <div class="input-group">
                        <label>Profit mult</label>
                        <input id="h-stats-profit-mult" type="number" step="any" min="0" title="Bet size × this = profit stop, which sets the balance target">
                    </div>
                    <div class="input-group">
                        <label>Autostop</label>
                        <input id="h-autostop" type="number" step="0.00000001" value="${autoStopBalance !== null ? autoStopBalance.toFixed(8) : ''}" placeholder="OFF">
                    </div>
                    <div class="cond-chip" title="Wins since the bet last reset to base (zeroes when the loss reset fires) / current loss streak">
                        <span class="cond-chip-head"><span>Wins</span><span>L streak</span></span>
                        <span class="cond-chip-vals"><b id="h-stats-ctr-w">0</b><b id="h-stats-ctr-l">0</b></span>
                    </div>
                    <div class="input-group" title="Stop autoplay after this many consecutive wins">
                        <label>Autostop @ W streak</label>
                        <input type="checkbox" id="h-stats-ws-chk" ${condWsStopOn ? 'checked' : ''}>
                        <input id="h-stats-ws-target" type="number" min="1" step="1" value="${condWsTarget}">
                    </div>
                    <div class="input-group">
                        <label>Track per</label>
                        <select id="h-stats-track">
                            <option value="session" ${condTrackPer === 'session' ? 'selected' : ''}>Session</option>
                            <option value="cycle" ${condTrackPer === 'cycle' ? 'selected' : ''}>Cycle</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>🔊 <span id="h-stats-vol-val">${condVolume}</span></label>
                        <input type="range" id="h-stats-vol" min="0" max="100" step="1" value="${condVolume}">
                    </div>
                    <!-- Warnings only, and collapsed entirely when empty. -->
                    <div class="status-bar" id="h-target"></div>
                    <!-- Always-visible command bar. Same ids as before, so every
                         listener and updateUI() lookup keeps working — the elements
                         are moved, never duplicated. The primary row (bet size +
                         START) cannot wrap; the secondary actions wrap below it, so
                         a narrow panel can never push START out of reach. -->
                    <!-- No bet-size field here. The site's own wager box already is
                         the bet size, and the conditions engine writes to it — a
                         second copy in the HUD was one more thing to keep in sync
                         and one more row between the user and START. condBaseBet is
                         read from the native wager input instead (see the ticker).
                         No Conditions button either: the editor is always visible in
                         the left side panel. -->
                    <div class="hud-cmd-bar">
                        <div class="cmd-row cmd-primary">
                            <button id="h-rapid-toggle" class="hud-rapid-btn start">START</button>
                            ${isOnDicePage() ? '<button id="h-switch-ou" class="hud-switch-ou-btn">O/U</button>' : ''}
                            <button id="h-stats-update" class="hud-update-btn" title="Read the current balance, recompute, and retune the loaded strategy">UPDATE</button>
                            <button id="h-reset" class="hud-reset-btn">RESET</button>
                        </div>
                    </div>
                </div>
                <div class="hud-body">
                    <div class="graph-col">
                        <div class="hud-graph-box"><canvas id="h-custom-graph"></canvas></div>
                    </div>
                    <div class="stats-col">
                        <div class="hud-stats-grid">
                            <div class="stats-col-inner">
                                <div class="hud-row"><span class="hud-label">Starting Balance</span><span id="h-start-bal" class="hud-val">0.00</span></div>
                                <div class="hud-row"><span class="hud-label">Profit/Loss</span><span id="h-profit" class="hud-val">0.00</span></div>
                                <div class="hud-row"><span class="hud-label">Peak Balance</span><span id="h-peak-bal" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                                <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:var(--hud-positive);">0.00</span></div>
                            </div>
                            <div class="stats-col-inner">
                                <div class="hud-row"><span class="hud-label">Total Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                                <div class="hud-row"><span class="hud-label">Total Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>
                                <div class="hud-row"><span class="hud-label">Wins / Losses</span><span id="h-wl" class="hud-val">0 / 0</span></div>
                                <div class="hud-row"><span class="hud-label">Session RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                            </div>
                            <div class="stats-col-inner">
                                <div class="hud-row"><span class="hud-label">Balance Target</span><span id="h-stats-bal-target" class="hud-val" style="color:var(--hud-positive);">—</span></div>
                                <div class="hud-row"><span class="hud-label">Profit Stop</span><span id="h-stats-profit-stop" class="hud-val">—</span></div>
                                <div class="hud-row"><span class="hud-label">Streak (W|L)</span><span id="h-streaks" class="hud-val">0/0 | 0/0</span></div>
                                <div class="hud-row"><span class="hud-label">Multiplier Performance</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                            </div>
                        </div>
                        <div class="hud-meta-row">
                            <div class="hud-meta-chip"><span class="hud-label">Best Streaks</span><span id="h-best-w" class="hud-val" style="color:var(--hud-positive);">-</span></div>
                            <div class="hud-meta-chip"><span class="hud-label">Worst Streaks</span><span id="h-worst-l" class="hud-val" style="color:var(--hud-negative);">-</span></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    /** The Strategy / conditions editor, rendered into the LEFT column under the
     *  native bet panel (see #hud-cond-left-slot) so it sits where Stake's
     *  strategy editor does. Narrow layout — the column is 300px. */
    function condDeckHTML() {
        return `
            <div id="h-cond-deck-wrap" class="cond-deck-wrap">
                <div class="cond-deck-head">Strategy</div>
                <div class="cond-strat-bar">
                    <input id="h-strat-name" type="text" placeholder="Strategy name" spellcheck="false" autocomplete="off">
                    <button id="h-strat-save" class="cond-btn">Save Strategy</button>
                    <div class="cond-strat-sep"></div>
                    <select id="h-strat-select" title="Load a saved strategy"></select>
                    <button id="h-strat-del" class="cond-btn">Delete</button>
                </div>
                <div id="h-cond-list" class="cond-deck"></div>
                <button id="h-cond-add" class="cond-add-btn">+ Add condition</button>
            </div>
        `;
    }
    function condModalHTML() {
        return `
            <div class="cond-modal-backdrop" data-cond-close="1"></div>
            <div class="cond-modal-card">
                <div class="cond-modal-head">
                    <span class="cond-modal-title">Strategy Conditions</span>
                    <button type="button" id="h-cond-modal-close" class="cond-modal-close" data-cond-close="1" title="Close">&times;</button>
                </div>
                ${condDeckHTML()}
            </div>
        `;
    }
    /** Create the conditions popup, hidden, as a child of the HUD.
     *
     *  Deliberately appended to the HUD and positioned `absolute; inset: 0`
     *  rather than being a viewport-fixed dialog on document.body: the HUD root
     *  carries `backdrop-filter`, which makes it the containing block for fixed
     *  descendants AND clips them via `overflow: hidden`, so `position: fixed`
     *  would be laid out against the HUD anyway — with none of the `.cond-*`
     *  rules or `--hud-*` theme vars in scope, since both are scoped through
     *  #ratchet-master-container. Overlaying the HUD gets the same modal effect
     *  and keeps the editor's styling and theming for free.
     *
     *  Rebuilt with the HUD (it is a child), so the listener pass re-wires
     *  #h-cond-add / #h-strat-* naturally. */
    function ensureCondModal() {
        const hud = document.getElementById('ratchet-master-container');
        if (!hud) return false;
        let modal = document.getElementById('h-cond-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'h-cond-modal';
            modal.className = 'cond-modal';
            modal.innerHTML = condModalHTML();
            hud.appendChild(modal);
            // Backdrop and × both carry data-cond-close, so one handler covers both.
            modal.addEventListener('click', e => {
                if (e.target instanceof Element && e.target.closest('[data-cond-close]')) closeCondModal();
            });
            /* Escape closes. Registered once per page, not per HUD build, since
               the HUD is rebuilt on SPA navigation and this would otherwise
               stack duplicate listeners. Its own listener rather than the tool's
               main keydown handler, which ignores events from inputs — you want
               Escape to work while typing a condition amount. */
            if (!window.__nuts_cond_esc__) {
                window.__nuts_cond_esc__ = true;
                document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCondModal(); });
            }
        }
        return true;
    }
    function openCondModal() {
        if (!ensureCondModal()) return;
        renderCondStrategyBar();
        renderCondBlocks();
        const m = document.getElementById('h-cond-modal');
        if (m) m.classList.add('show');
    }
    function closeCondModal() {
        const m = document.getElementById('h-cond-modal');
        if (m) m.classList.remove('show');
    }
    /** Remove it entirely when leaving Advanced IOW, so its element ids can't
     *  collide with another mode's markup. */
    function clearCondModal() {
        const m = document.getElementById('h-cond-modal');
        if (m) m.remove();
    }
    /** The opener doubles as the condition count, so the strategy is legible
     *  without opening the popup. */
    function refreshCondOpenBtn() {
        const b = document.getElementById('h-cond-open');
        if (b) b.textContent = 'Conditions (' + condBlocks.length + ')';
    }
    /* ---- Cross-scope bridge: the DiceTool panel (a separate function scope)
       calls these when its "Create Strategy" / "Send To Game" buttons fire on
       Nuts, since it can't reach this tool's condition engine directly. ---- */
    window.__nuts_cond_balance__ = function () { return getCurrentBalance(); };
    /** "Update Strategy" / "Send To Game" — the Nuts equivalent of
     *  stake_updateExisting. Keeps the loaded condition list and only retunes it
     *  for the current balance: new bet size (from Balance ÷ Balance Divisor) and
     *  a new balance-target stop (from Profit Multiplier). Win increase, loss
     *  reset and payout are deliberately left alone, so this is safe to hit
     *  between cycles as the bankroll grows. */
    window.__nuts_cond_update__ = function (v) {
        const bet = parseFloat(v.bet_size);
        const target = parseFloat(v.balance_target);
        if (isFinite(bet) && bet > 0) {
            condBaseBet = Math.max(minBaseBet, bet);
            const ci = document.getElementById('h-cond-base');
            if (ci) ci.value = condBaseBet.toFixed(8);
            forceSetBet(condBaseBet);
        }
        if (isFinite(target)) {
            // Retune the existing "balance ≥ X → stop" block; add one if the
            // loaded strategy doesn't have a stop yet.
            const stop = condBlocks.find(b => b.trigger === 'balance' && b.action === 'stop');
            if (stop) stop.amount = target.toFixed(8);
            else condBlocks.push({ trigger: 'balance', count: 1, result: 'win', cmp: 'gte', amount: target.toFixed(8), action: 'stop', value: '' });
        }
        resetCondRuntime();
        saveCondState();
        if (ACTIVE_MODE === 'cond') renderCondBlocks();
        condNotice = {
            text: `Updated for balance ${formatCurrency(getCurrentBalance())} — bet ${formatCurrency(condBaseBet)}, stop at ${isFinite(target) ? formatCurrency(target) : '—'}`,
            until: Date.now() + 5000
        };
        updateUI();
    };
    /** Build the 4-condition Advanced IOW strategy from the panel's calculator
     *  outputs — the same strategy the Stake/Shuffle native import creates:
     *  every win → +win_inc%, streak of loss_reset losses → reset to base,
     *  balance ≥ target → stop. Also sets the payout + base bet. */
    window.__nuts_cond_import__ = function (v) {
        const bet = parseFloat(v.bet_size);
        const target = parseFloat(v.balance_target);
        const winInc = parseFloat(v.win_increase);
        const lossReset = Math.max(1, parseInt(v.loss_reset, 10) || 1);
        const mult = parseFloat(v.multiplier);
        if (isFinite(mult)) { const pay = getNutsPayoutInput(); if (pay) typeIntoInput(pay, mult.toFixed(2)); }
        if (isFinite(bet) && bet > 0) {
            condBaseBet = Math.max(minBaseBet, bet);
            const ci = document.getElementById('h-cond-base');
            if (ci) ci.value = condBaseBet.toFixed(8);
            forceSetBet(condBaseBet);
        }
        condBlocks = [
            { trigger: 'every', count: 1, result: 'win', cmp: 'gte', amount: '', action: 'increaseBet', value: isFinite(winInc) ? winInc : 100 },
            { trigger: 'streak', count: lossReset, result: 'lose', cmp: 'gte', amount: '', action: 'resetBet', value: '' },
            { trigger: 'balance', count: 1, result: 'win', cmp: 'gte', amount: isFinite(target) ? target.toFixed(8) : '', action: 'stop', value: '' }
        ];
        resetCondRuntime();
        saveCondState();
        if (ACTIVE_MODE === 'cond') renderCondBlocks();
        // Pre-fill the strategy name with the multiplier, the same way Stake's
        // native "Create Strategy" names it `<multiplier>x` before you save.
        const nameInp = document.getElementById('h-strat-name');
        if (nameInp && isFinite(mult)) nameInp.value = mult.toFixed(2) + 'x';
        condNotice = { text: `Strategy imported: ${isFinite(mult) ? mult.toFixed(2) : '?'}x — Save Strategy or press START`, until: Date.now() + 5000 };
        updateUI();
    };
    function condDefaultRuntime() { return { count: 0, streak: 0, armed: true }; }
    function resetCondRuntime() { condRuntime = condBlocks.map(condDefaultRuntime); }
    function loadCondState() {
        try {
            const raw = localStorage.getItem(COND_STORE_KEY);
            if (raw) {
                const st = JSON.parse(raw);
                if (st && typeof st === 'object') {
                    const base = parseFloat(st.baseBet);
                    if (isFinite(base) && base >= minBaseBet) condBaseBet = base;
                    if (st.calc && typeof st.calc === 'object') Object.assign(condCalc, st.calc);
                    const p = st.prefs;
                    if (p && typeof p === 'object') {
                        condWsStopOn = !!p.wsStopOn;
                        if (Number.isFinite(+p.wsTarget) && +p.wsTarget > 0) condWsTarget = +p.wsTarget;
                        if (p.trackPer === 'cycle' || p.trackPer === 'session') condTrackPer = p.trackPer;
                        if (Number.isFinite(+p.volume)) condVolume = Math.max(0, Math.min(100, +p.volume));
                    }
                    if (Array.isArray(st.blocks)) return st.blocks.filter(b => b && typeof b === 'object' && b.trigger && b.action);
                }
            }
        } catch (e) {}
        // First run: seed with the classic IOW shape so the mode demonstrates
        // itself (every win +125%, 3-loss streak resets to base).
        return [
            { trigger: 'every', count: 1, result: 'win', cmp: 'gte', amount: '', action: 'increaseBet', value: 125 },
            { trigger: 'streak', count: 3, result: 'lose', cmp: 'gte', amount: '', action: 'resetBet', value: '' }
        ];
    }
    function saveCondState() {
        try {
            localStorage.setItem(COND_STORE_KEY, JSON.stringify({
                baseBet: condBaseBet, blocks: condBlocks, calc: condCalc,
                prefs: { wsStopOn: condWsStopOn, wsTarget: condWsTarget, trackPer: condTrackPer, volume: condVolume }
            }));
        } catch (e) {}
    }
    /* ---- Win beep. Same shape as the dice tool's Advanced IOW sound (880Hz
       sine, 200ms, gain = volume × 0.35) and likewise only ever heard in
       Advanced IOW — the other modes stay silent. ---- */
    let condAudioCtx = null;
    function condPlayWinSound() {
        if (ACTIVE_MODE !== 'cond') return;
        const vol = condVolume / 100;
        if (!vol) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            /* ONE AudioContext for the page, reused. The first version built a
               fresh context per win and closed it on a 200ms timer: browsers cap
               how many a page may create (mobile Safari throws once a handful are
               live), so a long run leaked contexts until the beep started
               throwing and the page was under needless memory pressure. Schedule
               the stop on the audio clock and release the nodes on ended. */
            if (!condAudioCtx) condAudioCtx = new Ctx();
            const ctx = condAudioCtx;
            if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.value = vol * 0.35;
            osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
            osc.start();
            osc.stop(ctx.currentTime + 0.18);
        } catch (e) {}
    }
    /** Snapshot the counters so the deck can report per-cycle ("since START")
     *  stats, which is what Stake's Stats Track Per = Cycle shows. */
    function condStartCycle() {
        const bal = getCurrentBalance();
        condCycle = {
            balance: bal, peakBalance: bal, peakProfit: 0,
            totalBets: totalBets, totalWagered: totalWagered,
            totalWins: totalWins, totalLosses: totalLosses
        };
    }
    /** Keep the cycle's peaks current; called once per settled bet. */
    function condTrackCycle() {
        if (!condCycle) return;
        const bal = getCurrentBalance();
        if (bal > condCycle.peakBalance) condCycle.peakBalance = bal;
        const profit = bal - condCycle.balance;
        if (profit > condCycle.peakProfit) condCycle.peakProfit = profit;
    }
    /** The numbers the deck paints — session-wide, or just this cycle. */
    function condStatsView() {
        const bal = getCurrentBalance();
        if (condTrackPer === 'cycle' && condCycle) {
            const c = condCycle;
            const wagered = totalWagered - c.totalWagered;
            const profit = bal - c.balance;
            return {
                startBal: c.balance, profit, peakBal: c.peakBalance, peakProfit: c.peakProfit,
                bets: totalBets - c.totalBets, wagered,
                wins: totalWins - c.totalWins, losses: totalLosses - c.totalLosses,
                rtp: wagered > 0 ? ((wagered + profit) / wagered) * 100 : 100
            };
        }
        return {
            startBal: initialBalance, profit: bal - initialBalance, peakBal: sessionPeak, peakProfit: highestProfit,
            bets: totalBets, wagered: totalWagered, wins: totalWins, losses: totalLosses,
            rtp: totalWagered > 0 ? ((totalWagered + (bal - initialBalance)) / totalWagered) * 100 : 100
        };
    }
    /* ---- Saved strategies — the Nuts stand-in for Stake's native strategy
       list. A strategy is the condition set plus the bet size and payout it was
       built for (the calculator keeps its own state in the panel, exactly as it
       does on Stake). Name it, "Save Strategy" stores it, and picking it from
       the dropdown loads it straight back. ---- */
    function loadCondStrategies() {
        try {
            const arr = JSON.parse(localStorage.getItem(COND_STRAT_KEY) || 'null');
            if (Array.isArray(arr)) return arr.filter(s => s && typeof s.name === 'string' && Array.isArray(s.blocks));
        } catch (e) {}
        return [];
    }
    function saveCondStrategies() {
        try { localStorage.setItem(COND_STRAT_KEY, JSON.stringify(condStrategies)); } catch (e) {}
    }
    function condSaveStrategy(rawName) {
        const name = String(rawName || '').trim().slice(0, 60);
        if (!name) {
            condNotice = { text: 'Name the strategy first.', until: Date.now() + 3000 };
            updateUI();
            return;
        }
        const payEl = getNutsPayoutInput();
        const entry = {
            name,
            baseBet: condBaseBet,
            blocks: JSON.parse(JSON.stringify(condBlocks)),
            payout: payEl ? (parseFloat(payEl.value) || null) : null
        };
        const i = condStrategies.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
        if (i >= 0) condStrategies[i] = entry; else condStrategies.push(entry);
        condStrategies.sort((a, b) => a.name.localeCompare(b.name));
        saveCondStrategies();
        renderCondStrategyBar(name);
        condNotice = { text: `Saved strategy “${name}”.`, until: Date.now() + 3500 };
        updateUI();
    }
    function condLoadStrategy(name) {
        const s = condStrategies.find(x => x.name === name);
        if (!s) return;
        if (isRapidFiring) stopRapidFire();
        condBlocks = JSON.parse(JSON.stringify(s.blocks));
        if (isFinite(s.baseBet) && s.baseBet >= minBaseBet) {
            condBaseBet = s.baseBet;
            const ci = document.getElementById('h-cond-base');
            if (ci) ci.value = condBaseBet.toFixed(8);
            forceSetBet(condBaseBet);
        }
        if (isFinite(s.payout) && s.payout > 0) {
            const pay = getNutsPayoutInput();
            if (pay) typeIntoInput(pay, Number(s.payout).toFixed(2));
        }
        resetCondRuntime();
        saveCondState();
        renderCondBlocks();
        const nameInp = document.getElementById('h-strat-name');
        if (nameInp) nameInp.value = s.name;
        condNotice = { text: `Loaded “${s.name}” — press START`, until: Date.now() + 4000 };
        updateUI();
    }
    function condDeleteStrategy(name) {
        const i = condStrategies.findIndex(s => s.name === name);
        if (i < 0) return;
        condStrategies.splice(i, 1);
        saveCondStrategies();
        renderCondStrategyBar('');
        condNotice = { text: `Deleted “${name}”.`, until: Date.now() + 3000 };
        updateUI();
    }
    /** Repopulate the saved-strategy dropdown. Options are built with the DOM
     *  API so user-entered names can never inject markup. */
    function renderCondStrategyBar(selected) {
        const sel = document.getElementById('h-strat-select');
        if (!sel) return;
        const keep = selected != null ? selected : sel.value;
        sel.textContent = '';
        const ph = document.createElement('option');
        ph.value = '';
        ph.textContent = condStrategies.length ? 'Load saved strategy…' : 'No saved strategies';
        sel.appendChild(ph);
        condStrategies.forEach(s => {
            const o = document.createElement('option');
            o.value = s.name;
            o.textContent = s.name;
            sel.appendChild(o);
        });
        sel.value = condStrategies.some(s => s.name === keep) ? keep : '';
        const del = document.getElementById('h-strat-del');
        if (del) del.disabled = !sel.value;
    }
    /** Nuts payout/multiplier input. aria-label first (Target page), then a
     *  generic label scan outside our HUD, then the hashed dice class. Used by
     *  the Create Strategy bridge to set the payout the calculator produced. */
    function getNutsPayoutInput() {
        const target = document.querySelector('input[aria-label="payout selector"]');
        if (target) return target;
        const generic = Array.from(document.querySelectorAll('input')).find(inp => {
            if (inp.closest('#ratchet-master-container')) return false;
            const label = [inp.getAttribute('aria-label'), inp.getAttribute('placeholder'), inp.getAttribute('name'), inp.getAttribute('data-testid')].join(' ');
            return /(payout|multiplier)/i.test(label) && isFinite(parseFloat(inp.value));
        });
        if (generic) return generic;
        return document.querySelector('input.sc-941e0ad-0.eaPPXw');
    }
    function condSetBet(amount) {
        if (!isFinite(amount)) return;
        forceSetBet(Math.min(Math.max(amount, minBaseBet), maxBaseBet));
    }
    function condSwitchOverUnder() {
        // Same pause-swap-resume dance as the Switch Over/Under button: the
        // swap click is ignored if it lands mid rapid-fire click cycle. Bet
        // and per-block counters are restored after the restart so a switch
        // doesn't reset the progression.
        if (condResumePending) return;
        const wasRunning = isRapidFiring;
        const savedBet = lastPlacedBet;
        const savedRuntime = condRuntime;
        condResumePending = true;
        if (wasRunning) stopRapidFire();
        setTimeout(() => {
            const swap = getRollOverUnderSwap();
            if (swap) swap.click();
            setTimeout(() => {
                condResumePending = false;
                if (wasRunning && ACTIVE_MODE === 'cond' && !isRapidFiring) {
                    startRapidFire();
                    condRuntime = savedRuntime;
                    condSetBet(savedBet);
                }
            }, 80);
        }, 40);
    }
    function applyCondAction(b) {
        const val = parseFloat(b.value);
        if (b.action === 'increaseBet') { if (isFinite(val)) condSetBet(lastPlacedBet * (1 + val / 100)); }
        else if (b.action === 'decreaseBet') { if (isFinite(val)) condSetBet(lastPlacedBet * Math.max(0, 1 - val / 100)); }
        else if (b.action === 'resetBet') {
            condSetBet(condBaseBet);
            // Back to base bet = a fresh progression, so the win counter starts
            // over — same as IOW mode, where hitting the loss reset zeroes it.
            counter = 0;
            triggerWinResetPulse();
        }
        else if (b.action === 'setBet') { if (isFinite(val) && val > 0) condSetBet(val); }
        else if (b.action === 'switchOverUnder') condSwitchOverUnder();
        else if (b.action === 'stop') stopRapidFire();
    }
    /** Evaluate every condition block against the bet that just resolved.
     *  Trigger semantics mirror Stake's native Advanced autobet:
     *  - every N wins/losses/bets: cumulative counter, fires then resets;
     *  - every streak of N: consecutive run, fires at N, 2N, ...;
     *  - first streak of N: fires once when the run reaches exactly N;
     *  - balance/profit >=/<= X: edge-triggered — fires on crossing, re-arms
     *    when the comparison goes false again (so % actions can't compound
     *    on every bet while the threshold stays true). */
    function runConditionEngine(won) {
        if (!isRapidFiring || ACTIVE_MODE !== 'cond') return;
        const balance = getCurrentBalance();
        const profit = balance - initialBalance;
        for (let i = 0; i < condBlocks.length; i++) {
            const b = condBlocks[i];
            const rt = condRuntime[i] || (condRuntime[i] = condDefaultRuntime());
            let fire = false;
            if (b.trigger === 'every') {
                const match = b.result === 'bet' || (b.result === 'win' ? won : !won);
                if (match && ++rt.count >= Math.max(1, parseInt(b.count, 10) || 1)) { rt.count = 0; fire = true; }
            } else if (b.trigger === 'streak' || b.trigger === 'firstStreak') {
                const match = b.result === 'bet' || (b.result === 'win' ? won : !won);
                if (match) {
                    rt.streak++;
                    const n = Math.max(1, parseInt(b.count, 10) || 1);
                    if (b.trigger === 'streak') {
                        if (rt.streak >= n) { rt.streak = 0; fire = true; }
                    } else if (rt.streak === n) fire = true;
                } else {
                    rt.streak = 0;
                }
            } else if (b.trigger === 'balance' || b.trigger === 'profit') {
                const threshold = parseFloat(b.amount);
                if (!isFinite(threshold)) continue; // blank amount = inactive block
                const lhs = b.trigger === 'balance' ? balance : profit;
                const hit = b.cmp === 'lte' ? lhs <= threshold : lhs >= threshold;
                if (hit && rt.armed) { rt.armed = false; fire = true; }
                else if (!hit) rt.armed = true;
            }
            if (fire) applyCondAction(b);
            if (!isRapidFiring) break; // a stop / O/U-switch action ended the run
        }
    }
    function renderCondBlocks() {
        // Before the early return: the count on the opener has to stay live even
        // while the popup (and therefore #h-cond-list) does not exist.
        refreshCondOpenBtn();
        const list = document.getElementById('h-cond-list');
        if (!list) return;
        list.innerHTML = '';
        if (!condBlocks.length) {
            list.innerHTML = '<div class="cond-empty">No conditions — add one to build a strategy.</div>';
            return;
        }
        condBlocks.forEach((b, i) => list.appendChild(buildCondRow(b, i)));
    }
    function syncCondRowVisibility(row, b) {
        const isCount = b.trigger === 'every' || b.trigger === 'streak' || b.trigger === 'firstStreak';
        row.querySelector('.cond-count').style.display = isCount ? '' : 'none';
        row.querySelector('.cond-result').style.display = isCount ? '' : 'none';
        row.querySelector('.cond-cmp').style.display = isCount ? 'none' : '';
        row.querySelector('.cond-amount').style.display = isCount ? 'none' : '';
        const needsValue = b.action === 'increaseBet' || b.action === 'decreaseBet' || b.action === 'setBet';
        row.querySelector('.cond-value').style.display = needsValue ? '' : 'none';
    }
    function buildCondRow(b, i) {
        const row = document.createElement('div');
        row.className = 'cond-row';
        row.innerHTML = `
            <select class="cond-trigger">
                <option value="every">Every</option>
                <option value="streak">Every streak of</option>
                <option value="firstStreak">First streak of</option>
                <option value="balance">On balance</option>
                <option value="profit">On profit</option>
            </select>
            <input class="cond-count" type="number" min="1" step="1">
            <select class="cond-result">
                <option value="win">wins</option>
                <option value="lose">losses</option>
                <option value="bet">bets</option>
            </select>
            <select class="cond-cmp">
                <option value="gte">&ge;</option>
                <option value="lte">&le;</option>
            </select>
            <input class="cond-amount" type="number" step="0.00000001" placeholder="amount">
            <span class="cond-arrow">&rarr;</span>
            <select class="cond-action">
                <option value="increaseBet">increase bet by %</option>
                <option value="decreaseBet">decrease bet by %</option>
                <option value="resetBet">reset bet to base</option>
                <option value="setBet">set bet to</option>
                <option value="switchOverUnder">switch over/under</option>
                <option value="stop">stop autoplay</option>
            </select>
            <input class="cond-value" type="number" step="any" placeholder="value">
            <button class="cond-del" title="Remove condition">&times;</button>
        `;
        row.querySelector('.cond-trigger').value = b.trigger;
        row.querySelector('.cond-count').value = b.count;
        row.querySelector('.cond-result').value = b.result;
        row.querySelector('.cond-cmp').value = b.cmp;
        row.querySelector('.cond-amount').value = b.amount;
        row.querySelector('.cond-action').value = b.action;
        row.querySelector('.cond-value').value = b.value;
        const commit = () => {
            b.trigger = row.querySelector('.cond-trigger').value;
            b.count = row.querySelector('.cond-count').value;
            b.result = row.querySelector('.cond-result').value;
            b.cmp = row.querySelector('.cond-cmp').value;
            b.amount = row.querySelector('.cond-amount').value;
            b.action = row.querySelector('.cond-action').value;
            b.value = row.querySelector('.cond-value').value;
            condRuntime[i] = condDefaultRuntime();
            saveCondState();
            syncCondRowVisibility(row, b);
        };
        row.querySelectorAll('select').forEach(el => el.addEventListener('change', commit));
        row.querySelectorAll('input').forEach(el => el.addEventListener('input', commit));
        row.querySelector('.cond-del').addEventListener('click', () => {
            condBlocks.splice(i, 1);
            condRuntime.splice(i, 1);
            saveCondState();
            renderCondBlocks();
        });
        syncCondRowVisibility(row, b);
        return row;
    }

    // Tracks bet tile DOM nodes we've already counted. WeakSet so we don't
    // pin DOM nodes alive after Nuts GC's old bets out of the feed. Solves
    // the double-count seen on Nuts target/limbo when hotkeys are off:
    // there, the slower bet cadence lets the observer see two distinct
    // mutations per bet (placeholder + real result render), and the prior
    // ID-based dedup couldn't keep them apart.
    const _nutsProcessedBetEls = new WeakSet();
    function startObserver() {
        pastBetsContainer = findPastBetsContainer();
        if (!pastBetsContainer) { setTimeout(startObserver, 500); return; }
        if (observer) observer.disconnect();
        // Seed already-present bet tiles into the processed set so they
        // don't get re-counted on first mount or after resetStats.
        const existing = pastBetsContainer.querySelectorAll('.styles-module___IID9a__game');
        existing.forEach(el => _nutsProcessedBetEls.add(el));
        syncLastSeenBet(pastBetsContainer);
        observer = new MutationObserver((mutations) => {
            // Confirmed live: Nuts Target/Limbo emits **TWO tiles per single
            // bet** in the same mutation batch — different multipliers but
            // both share the win/loss background color (one bet shown two
            // ways in the feed). Counting both was the "double-count when
            // hotkeys are off" symptom. Solution: per-callback-batch dedup —
            // only the first matching tile in this batch gets counted. Real
            // back-to-back bets always land in separate mutation batches
            // (separate microtasks) so this doesn't undercount rapid fire.
            let countedThisBatch = false;
            outer: for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (countedThisBatch) break outer;
                    if (node.nodeType !== 1) continue;
                    const tile = node.matches && node.matches('.styles-module___IID9a__game')
                        ? node
                        : (node.querySelector && node.querySelector('.styles-module___IID9a__game'));
                    if (!tile) continue;
                    // Per-tile WeakSet dedup — protects against the same DOM
                    // node bubbling through twice (defense in depth on top
                    // of per-batch).
                    if (_nutsProcessedBetEls.has(tile)) continue;
                    // Skip placeholder/loading tiles (empty text).
                    if (!(tile.textContent || '').trim()) continue;
                    _nutsProcessedBetEls.add(tile);
                    countedThisBatch = true;
                    processNewBet(pastBetsContainer, tile);
                }
            }
        });
        observer.observe(pastBetsContainer, { childList: true, subtree: true });
    }
    function processNewBet(container, specificTile) {
        // If called with a specific tile (from the observer's addedNodes
        // path), use it directly. Falling back to "find latest" preserves
        // compatibility with the syncLastSeenBet / manual probe callers.
        const latestBet = specificTile
            ? { element: specificTile, id: specificTile }
            : getLatestBetEntry(container);
        if (!latestBet || (!specificTile && latestBet.id === lastBetId)) return;
        lastBetId = latestBet.id;
        lastObservedBetTime = Date.now();
        rapidBlockedSince = 0;
        totalBets++;
        const betAmt = getCurrentBet();
        const won = isWin(latestBet.element);
        handleBetResult(won, betAmt);
        if (ACTIVE_MODE === 'iow') {
            if (won) {
                lossStreak = 0; counter++;
                if (isRapidFiring) {
                    const curBet = lastPlacedBet;
                    let newBet = curBet * (1 + winIncreasePercent / 100);
                    newBet = Math.min(newBet, maxBaseBet);
                    forceSetBet(newBet);
                    lastPlacedBet = newBet;
                }
                if (winsBeforeReset && counter >= winsBeforeReset) {
                    counter = 0;
                    triggerWinResetPulse();
                    if (isRapidFiring) {
                        forceSetBet(baseBet);
                        lastPlacedBet = baseBet;
                    }
                }
            } else {
                lossStreak++;
                if (lossStreak >= lossStreakReset) {
                    counter = 0;
                    if (isRapidFiring) {
                        forceSetBet(baseBet);
                        lastPlacedBet = baseBet;
                    }
                }
            }
            if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) stopRapidFire();
        } else if (ACTIVE_MODE === 'cond') {
            if (won) { lossStreak = 0; counter++; condPlayWinSound(); } else { lossStreak++; }
            condTrackCycle();
            if (isRapidFiring) runConditionEngine(won);
            // Autostop @ Win Streak — checked after the engine so a condition
            // that fires on the same bet still gets to run.
            if (isRapidFiring && condWsStopOn && curWinStreak >= condWsTarget) {
                stopRapidFire();
                condNotice = { text: `Stopped: ${curWinStreak} win streak reached.`, until: Date.now() + 5000 };
            }
            if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) stopRapidFire();
        }
        updateUI();
    }
    function handleBetResult(isWinResult, betAmt) {
        if (isWinResult) totalWins++; else totalLosses++;
        totalWagered += betAmt || minBaseBet;
        const currentProfit = getCurrentBalance() - initialBalance;
        if (currentProfit > highestProfit) highestProfit = currentProfit;
        profitHistory.push(currentProfit); if (profitHistory.length > MAX_GRAPH_POINTS) profitHistory.shift();
        if (isWinResult) {
            if (lastResult === false && curLossStreak > 0) { topLossStreaks.push(curLossStreak); topLossStreaks.sort((a,b)=>b-a); if (topLossStreaks.length > 10) topLossStreaks.pop(); }
            curWinStreak++; curLossStreak = 0; multWins++;
        } else {
            if (lastResult === true && curWinStreak > 0) { topWinStreaks.push(curWinStreak); topWinStreaks.sort((a,b)=>b-a); if (topWinStreaks.length > 10) topWinStreaks.pop(); }
            curLossStreak++; curWinStreak = 0;
        }
        lastResult = isWinResult;
        betHistory.push(isWinResult); recentWins.push(isWinResult);
        if (recentWins.length > 10) recentWins.shift();
        if (betHistory.length > historyWindow) betHistory.shift();
        multGames++;
        maxLossStreak = Math.max(maxLossStreak, curLossStreak);
        maxWinStreak = Math.max(maxWinStreak, curWinStreak);
        if ((ACTIVE_MODE === 'smart' || ACTIVE_MODE === 'manual')) {
            if (stopLossPct > 0 && currentProfit <= -initialBalance * (stopLossPct / 100)) autoPaused = true;
            if (takeProfitPct > 0 && currentProfit >= initialBalance * (takeProfitPct / 100)) autoPaused = true;
            if (autoPaused && isRapidFiring) stopRapidFire();
        }
        // Autostop on Balance — fires for every mode (Manual / IOW / Smart).
        // Previously this check was nested inside the IOW-only branch of the
        // bet handler, so the input did nothing in Manual or Smart mode.
        if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) stopRapidFire();
    }
    function updateClicks(cps) {
        if (clickInterval) { clearInterval(clickInterval); clickInterval = null; }
        if (cps > 0 && playButton) {
            const clickIntervalTime = 1000 / cps;
            clickInterval = setInterval(() => { playButton.click(); }, clickIntervalTime);
        }
    }
    /* Spacebar: pressed ONCE and genuinely held for the whole run, released on
       stop. No feathering of any kind — not the old PWM duty cycle, and not the
       30ms auto-repeat that replaced it. The play-button click loop
       (updateClicks) is what actually paces the bets here, so the key only has
       to stay down; re-firing it just made the cadence uneven. */
    function startSpaceHold() {
        if (isSpaceHeldDown) return;
        simulateKeyDown(32, false);
        isSpaceHeldDown = true;
    }
    function stopSpaceHold() {
        if (!isSpaceHeldDown) return;
        simulateKeyUp(32);
        isSpaceHeldDown = false;
    }
    function simulateKeyDown(keyCode, repeat = false) {
        const downEvent = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true, repeat: repeat });
        document.dispatchEvent(downEvent);
        const pressEvent = new KeyboardEvent('keypress', { key: ' ', code: 'Space', keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true, repeat: repeat });
        document.dispatchEvent(pressEvent);
    }
    function simulateKeyUp(keyCode) {
        const event = new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: keyCode, which: keyCode, bubbles: true, cancelable: true });
        document.dispatchEvent(event);
    }
    function startRapidFire() {
        if (isRapidFiring) return;
        isRapidFiring = true;
        rapidBlockedSince = 0;
        rapidFireStartedAt = Date.now();
        lastObservedBetTime = 0;
        syncLastSeenBet();
        lastPlacedBet = ACTIVE_MODE === 'cond' ? condBaseBet : baseBet;
        if (ACTIVE_MODE === 'iow') forceSetBet(baseBet);
        if (ACTIVE_MODE === 'cond') {
            /* The HUD has no bet field any more, so the base bet is whatever the
               site's wager box says at the moment START is pressed. Read it HERE
               rather than relying on the ticker having sampled it: this is the one
               instant the value has to be right, and it makes the source of the
               base bet obvious instead of timing-dependent. */
            if (!document.getElementById('h-cond-base')) {
                const nativeBet = getCurrentBet();
                if (isFinite(nativeBet) && nativeBet >= minBaseBet) condBaseBet = nativeBet;
            }
            resetCondRuntime(); condStartCycle(); forceSetBet(condBaseBet);
        }
        if (ACTIVE_MODE === 'manual') forceSetBet(manualBet);
        if (ACTIVE_MODE === 'smart') updateBetAmount();
        startBetGuardian();
        updateUI();
        playButton = getPlayButton();
        if (!playButton) {
            console.error('Play button not found!');
            stopRapidFire();
            return;
        }
        updateClicks(30);
        startSpaceHold();
        if ((ACTIVE_MODE === 'iow' || ACTIVE_MODE === 'cond') && !iowEnforcerInterval) {
            iowEnforcerInterval = setInterval(() => {
                if (isRapidFiring && (ACTIVE_MODE === 'iow' || ACTIVE_MODE === 'cond')) {
                    const current = getCurrentBet();
                    if (Math.abs(current - lastPlacedBet) > 0.00000005) {
                        forceSetBet(lastPlacedBet);
                    }
                }
            }, 80);
        }
    }
    function stopRapidFire() {
        isRapidFiring = false;
        updateClicks(0);
        stopSpaceHold();
        if (iowEnforcerInterval) {
            clearInterval(iowEnforcerInterval);
            iowEnforcerInterval = null;
        }
        stopBetGuardian();
        updateUI();
    }
    function monitorRapidFireHealth() {
        if (!isRapidFiring) return;
        const now = Date.now();
        const betBtn = getPlayButton();
        if (!betBtn || betBtn.disabled) {
            if (!rapidBlockedSince) rapidBlockedSince = now;
            if (now - rapidBlockedSince >= RAPID_BLOCKED_STOP_MS) stopRapidFire();
            return;
        }
        rapidBlockedSince = 0;
        const lastSeenBetTime = lastObservedBetTime || rapidFireStartedAt;
        if (lastSeenBetTime && now - lastSeenBetTime >= RAPID_STALL_STOP_MS) stopRapidFire();
    }
    function drawGraph() {
        const canvas = document.getElementById('h-custom-graph');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;
        ctx.clearRect(0, 0, width, height);
        if (profitHistory.length < 2) return;
        let maxVal = Math.max(...profitHistory, 0);
        let minVal = Math.min(...profitHistory, 0);
        const range = (maxVal - minVal) || 1;
        const padding = range * 0.15;
        maxVal += padding; minVal -= padding;
        const totalRange = maxVal - minVal;
        const zeroY = height - ((0 - minVal) / totalRange) * height;
        const zeroPct = Math.max(0, Math.min(1, zeroY / height));
        const lineGrad = ctx.createLinearGradient(0, 0, 0, height);
        lineGrad.addColorStop(0, '#43f6ff'); lineGrad.addColorStop(zeroPct, '#43f6ff'); lineGrad.addColorStop(zeroPct, '#ff6bb0'); lineGrad.addColorStop(1, '#ff6bb0');
        const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
        fillGrad.addColorStop(0, 'rgba(67, 246, 255, 0.22)'); fillGrad.addColorStop(zeroPct, 'rgba(67, 246, 255, 0.22)'); fillGrad.addColorStop(zeroPct, 'rgba(255, 107, 176, 0.22)'); fillGrad.addColorStop(1, 'rgba(255, 107, 176, 0.22)');
        const stepX = width / (profitHistory.length - 1);
        ctx.beginPath();
        profitHistory.forEach((val, i) => {
            const x = i * stepX;
            const y = height - ((val - minVal) / totalRange) * height;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = lineGrad; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.lineTo(width, zeroY); ctx.lineTo(0, zeroY); ctx.closePath();
        ctx.fillStyle = fillGrad; ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, zeroY); ctx.lineTo(width, zeroY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    function formatCurrency(solAmount) {
        if (!isFinite(solAmount)) return '0.00';
        if (isUSDDisplayMode()) {
            const rate = getSolToUsdRate();
            if (rate && rate > 0) {
                const usd = solAmount * rate;
                const sign = usd < 0 ? '-$' : '$';
                return `${sign}${Math.abs(usd).toFixed(2)}`;
            }
        }
        return solAmount.toFixed(8);
    }
    /* Keep Multiplier Performance honest in EVERY mode — Advanced IOW included.
       "1 in N" only means something measured against ONE payout, so the samples
       must reset when the target changes — and the comparison that colours the
       number needs the CURRENT target. Both used to live inside
       updateBetAmount(), which returns early unless ACTIVE_MODE is 'smart', the
       loop is running, AND the HUD is not being driven by Advanced IOW
       (dataset.toolsActive === '1' bails out by design, so the bet field is left
       to the strategy editor). Outside Smart, trackedMultiplier therefore sat at
       its initial 0 forever: the ratio accumulated across every payout the
       session had touched, and `ratio <= (trackedMultiplier || 1)` painted the
       value red however well the multiplier was actually running — reported as
       "multi perf is inaccurate on adv iow". Driven off the UI ticker now, so it
       is mode-agnostic, survives toolsActive, and works while stopped. The
       Advanced IOW stats deck reads the same figure through
       __iow_smart_publish__, so it is fixed by the same change. */
    const MULT_SETTLE_MS = 1200;
    let pendingMult = 0, pendingMultSince = 0;
    function syncTrackedMultiplier() {
        const m = getUserSetMultiplier();
        if (!isFinite(m) || m <= 1) return;                  // unreadable payout field
        if (Math.abs(m - trackedMultiplier) < 1e-9) { pendingMultSince = 0; return; }
        /* A new target has to hold still before it counts. The payout box is a
           text input: retyping it passes through blank and half-typed values,
           and the per-site readers answer those with their OWN default (1.01 on
           Stake dice, 2 elsewhere) rather than with "unknown" — so resetting on
           the way past would wipe the session's samples every time the field was
           touched. Costs ~1.2s before a genuine change takes effect, during
           which the colour still compares against the previous target. */
        if (Math.abs(m - pendingMult) > 1e-9) { pendingMult = m; pendingMultSince = Date.now(); return; }
        if (Date.now() - pendingMultSince < MULT_SETTLE_MS) return;
        trackedMultiplier = m;
        multGames = 0; multWins = 0; recentWins = [];
    }
    /** Populate Multiplier Performance + Best/Worst Streaks for whichever
     *  mode is currently rendering them. Idempotent — silently skips any
     *  element id that's absent from the current HUD layout. */
    function populateAdvancedStats() {
        const perfEl = document.getElementById('h-mult-perf');
        if (perfEl && multWins > 0) {
            const actualRatio = multGames / multWins;
            const recentHit = recentWins.filter(Boolean).length;
            const recentRatio = recentWins.length > 0 ? recentWins.length / Math.max(1, recentHit) : actualRatio;
            const trend = recentWins.length >= 10 ? (recentRatio <= actualRatio ? ' ▲' : ' ▼') : '';
            const trendColor = recentWins.length >= 10 ? (recentRatio <= actualRatio ? 'var(--hud-positive)' : 'var(--hud-negative)') : 'inherit';
            perfEl.innerHTML = `1 in ${actualRatio.toFixed(2)}<span style="color:${trendColor}; font-size:12px;">${trend}</span>`;
            perfEl.style.color = actualRatio <= (trackedMultiplier || 1) ? 'var(--hud-positive)' : 'var(--hud-negative)';
        }
        const displayW = topWinStreaks.concat([curWinStreak]).filter(x => x > 0).sort((a, b) => b - a).slice(0, 10);
        const displayL = topLossStreaks.concat([curLossStreak]).filter(x => x > 0).sort((a, b) => b - a).slice(0, 10);
        const bestWEl = document.getElementById('h-best-w');
        if (bestWEl) bestWEl.textContent = displayW.join(', ') || '-';
        const worstLEl = document.getElementById('h-worst-l');
        if (worstLEl) worstLEl.textContent = displayL.join(', ') || '-';
    }

    function updateUI() {
        syncTrackedMultiplier();
        const balance = getCurrentBalance();
        const profit = balance - initialBalance;
        const startBalEl = document.getElementById('h-start-bal'); if (startBalEl) startBalEl.textContent = formatCurrency(initialBalance);
        const profitEl = document.getElementById('h-profit'); if (profitEl) { profitEl.textContent = formatCurrency(profit); profitEl.style.color = profit > 0 ? 'var(--hud-positive)' : (profit < 0 ? 'var(--hud-negative)' : 'var(--hud-text)'); }
        const peakBalEl = document.getElementById('h-peak-bal'); if (peakBalEl) peakBalEl.textContent = formatCurrency(sessionPeak);
        const highProfitEl = document.getElementById('h-high-profit'); if (highProfitEl) highProfitEl.textContent = formatCurrency(highestProfit);
        const wageredEl = document.getElementById('h-wagered'); if (wageredEl) wageredEl.textContent = formatCurrency(totalWagered);
        const rtp = totalWagered > 0 ? ((totalWagered + profit) / totalWagered) * 100 : 100;
        const rtpEl = document.getElementById('h-rtp'); if (rtpEl) { rtpEl.textContent = rtp.toFixed(2) + '%'; rtpEl.style.color = rtp >= 100 ? 'var(--hud-positive)' : 'var(--hud-negative)'; }
        const totalBetsEl = document.getElementById('h-total-bets'); if (totalBetsEl) totalBetsEl.textContent = totalBets;
        const wlEl = document.getElementById('h-wl'); if (wlEl) wlEl.innerHTML = `<span style="color:var(--hud-positive);">${totalWins}</span> / <span style="color:var(--hud-negative);">${totalLosses}</span>`;
        const rapidBtn = document.getElementById('h-rapid-toggle');
        if (rapidBtn) {
            if (isRapidFiring) { rapidBtn.textContent = 'STOP'; rapidBtn.className = 'hud-rapid-btn stop'; }
            else { rapidBtn.textContent = 'START'; rapidBtn.className = 'hud-rapid-btn start'; }
        }
        if (ACTIVE_MODE === 'iow') {
            const targetEl = document.getElementById('h-target');
            if (targetEl) targetEl.innerHTML = `base bet: ${formatCurrency(baseBet)} | Wins: <span style="color:var(--hud-positive)">${counter}</span> | LossStreak: <span style="color:var(--hud-negative)">${lossStreak}</span>`;
            populateAdvancedStats();
        } else if (ACTIVE_MODE === 'cond') {
            const targetEl = document.getElementById('h-target');
            if (targetEl) {
                /* Warnings ONLY. This line used to restate the live bet, the base
                   bet, the block count, wins and loss streak on every tick — all
                   five already shown by the stats grid, and the first two now in
                   the command bar. It was noise sitting directly on top of the
                   controls. Empty means nothing is wrong, and the CSS collapses
                   it entirely. */
                if (condNotice && Date.now() < condNotice.until) targetEl.innerHTML = condNotice.text;
                else targetEl.textContent = '';
            }
            /* Repaint the stat rows for the selected scope (Session or Cycle).
               These ids were already written above with session values, so this
               overwrite is what makes "Track per = Cycle" work. */
            const sv = condStatsView();
            const setTxt = (id, text, color) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = text;
                if (color) el.style.color = color;
            };
            setTxt('h-start-bal', formatCurrency(sv.startBal));
            setTxt('h-profit', formatCurrency(sv.profit),
                sv.profit > 0 ? 'var(--hud-positive)' : (sv.profit < 0 ? 'var(--hud-negative)' : 'var(--hud-text)'));
            setTxt('h-peak-bal', formatCurrency(sv.peakBal));
            setTxt('h-high-profit', formatCurrency(sv.peakProfit));
            setTxt('h-total-bets', String(sv.bets));
            setTxt('h-wagered', formatCurrency(sv.wagered));
            setTxt('h-rtp', sv.rtp.toFixed(2) + '%', sv.rtp >= 100 ? 'var(--hud-positive)' : 'var(--hud-negative)');
            const wlEl2 = document.getElementById('h-wl');
            if (wlEl2) wlEl2.innerHTML = `<span style="color:var(--hud-positive);">${sv.wins}</span> / <span style="color:var(--hud-negative);">${sv.losses}</span>`;
            /* The chip shows the PROGRESSION counters, not session totals: wins
               since the bet was last reset to base (so it zeroes when the loss
               reset fires) and the current loss streak. Session/cycle totals
               live in the "Wins / Losses" stat row below. */
            setTxt('h-stats-ctr-w', String(counter));
            setTxt('h-stats-ctr-l', String(lossStreak));
            const ctrL = document.getElementById('h-stats-ctr-l');
            if (ctrL) ctrL.classList.toggle('has-loss', lossStreak > 0);
            /* Streak (W|L). The row has always been in this deck, but only the
               Manual / IOW / Smart branches ever filled it — so on Nuts the
               Advanced IOW tab showed a frozen "0/0 | 0/0" while the same row on
               Stake and Shuffle (fed by the published state) counted properly.
               Session-wide like the other modes, not scoped to the cycle. */
            const condStreaks = document.getElementById('h-streaks');
            if (condStreaks) condStreaks.innerHTML = `<span style="color:var(--hud-positive);">${curWinStreak}/${maxWinStreak}</span> | <span style="color:var(--hud-negative);">${curLossStreak}/${maxLossStreak}</span>`;
            /* Balance Target / Profit Stop mirror the calculator's outputs, so
               they track whatever the divisor + profit multiplier currently say
               (and the live balance after an UPDATE). */
            const balTargetEl = document.getElementById('h-stats-bal-target');
            const profStopEl = document.getElementById('h-stats-profit-stop');
            if (balTargetEl || profStopEl) {
                const fmtOut = id => {
                    const el = document.getElementById(id);
                    const n = el ? parseFloat(el.value) : NaN;
                    return isFinite(n) ? formatCurrency(n) : '—';
                };
                if (balTargetEl) balTargetEl.textContent = fmtOut('dt-out_target');
                if (profStopEl) profStopEl.textContent = fmtOut('dt-out_profit');
            }
            populateAdvancedStats();
        } else if (ACTIVE_MODE === 'smart') {
            const streaksEl = document.getElementById('h-streaks'); if (streaksEl) streaksEl.innerHTML = `<span style="color:var(--hud-positive);">${curWinStreak}/${maxWinStreak}</span> | <span style="color:var(--hud-negative);">${curLossStreak}/${maxLossStreak}</span>`;
            const hotEl = document.getElementById('h-hot'); if (hotEl) hotEl.textContent = `${betHistory.filter(Boolean).length}/${betHistory.length}`;
            const perfEl = document.getElementById('h-mult-perf');
            if (perfEl && multWins > 0) {
                const actualRatio = multGames / multWins;
                const recentHit = recentWins.filter(Boolean).length;
                const recentRatio = recentWins.length > 0 ? recentWins.length / Math.max(1, recentHit) : actualRatio;
                const trend = recentWins.length >= 10 ? (recentRatio <= actualRatio ? ' ▲' : ' ▼') : '';
                const trendColor = recentWins.length >= 10 ? (recentRatio <= actualRatio ? 'var(--hud-positive)' : 'var(--hud-negative)') : 'inherit';
                perfEl.innerHTML = `1 in ${actualRatio.toFixed(2)}<span style="color:${trendColor}; font-size:12px;">${trend}</span>`;
                perfEl.style.color = actualRatio <= (trackedMultiplier || 1) ? 'var(--hud-positive)' : 'var(--hud-negative)';
            }
            const winsCount = betHistory.filter(Boolean).length;
            const progress = winsNeeded > 0 ? winsCount / winsNeeded : 0;
            let gear = 1; let label = 'Gear 1 (Cold)';
            if (lockAggressionState) {
                gear = lockedGearLevel;
                if (gear === 1) label = 'Conservative (LOCKED)';
                else if (gear === 2) label = 'Steady (LOCKED)';
                else if (gear === 3) label = 'Balanced (LOCKED)';
                else if (gear === 4) label = 'Press (LOCKED)';
                else { gear = 5; label = 'Aggro (LOCKED)'; }
            } else {
                if (progress <= 0.4) { gear = 1; label = 'Conservative'; }
                else if (progress <= 0.8) { gear = 2; label = 'Steady'; }
                else if (progress <= 1.1) { gear = 3; label = 'Balanced'; }
                else if (progress <= 1.45) { gear = 4; label = 'Press'; }
                else { gear = 5; label = 'Aggro'; }
            }
            const stateEl = document.getElementById('h-state');
            if (stateEl) { stateEl.textContent = label; stateEl.className = `hud-val gear-text gear-${gear}-text`; }
            const displayW = topWinStreaks.concat([curWinStreak]).filter(x => x > 0).sort((a, b) => b - a).slice(0, 10);
            const displayL = topLossStreaks.concat([curLossStreak]).filter(x => x > 0).sort((a, b) => b - a).slice(0, 10);
            const bestWEl = document.getElementById('h-best-w'); if (bestWEl) bestWEl.textContent = displayW.join(', ') || '-';
            const worstLEl = document.getElementById('h-worst-l'); if (worstLEl) worstLEl.textContent = displayL.join(', ') || '-';
            const targetEl = document.getElementById('h-target');
            const targetMult = getUserSetMultiplier();
            if (targetEl) {
                let txt = `Target: ${targetMult.toFixed(2)}x`;
                if (autoPaused) { targetEl.style.color = 'var(--hud-negative)'; txt = 'PAUSED - THRESHOLD TRIGGERED'; } else { targetEl.style.color = 'var(--hud-text-soft)'; }
                targetEl.innerHTML = txt;
            }
        } else if (ACTIVE_MODE === 'manual') {
            const streaksEl = document.getElementById('h-streaks');
            if (streaksEl) streaksEl.innerHTML = `<span style="color:var(--hud-positive);">${curWinStreak}/${maxWinStreak}</span> | <span style="color:var(--hud-negative);">${curLossStreak}/${maxLossStreak}</span>`;
            const hotEl = document.getElementById('h-hot'); if (hotEl) hotEl.textContent = `${betHistory.filter(Boolean).length}/${betHistory.length}`;
            populateAdvancedStats();
            const targetEl = document.getElementById('h-target');
            if (targetEl) {
                targetEl.textContent = isRapidFiring ? '' : '';
                targetEl.style.color = isRapidFiring ? 'var(--hud-positive)' : 'var(--hud-text-soft)';
            }
        }
        drawGraph();
    }
    function updateBetAmount() {
        if (ACTIVE_MODE !== 'smart') return;
        // Only size the native bet input while the auto-bet loop is actually
        // running. Without this guard the HUD ticker rewrites the wager during
        // manual play, fighting the value the user typed (reported on mobile:
        // bet "adjusts itself" with the dice tool not running).
        if (!isRapidFiring) return;
        // While the user is in the Advanced IOW mode (cross-tool integration
        // owns the bet field via the dice tool's strategy editor), do NOT
        // overwrite the wager input. ACTIVE_MODE stays 'smart' here because
        // the injected Advanced IOW button is added by the integration and
        // doesn't go through switchMode(), so the integration signals via
        // a data attribute on the HUD root.
        const hudRoot = document.getElementById('ratchet-master-container');
        if (hudRoot && hudRoot.dataset.toolsActive === '1') return;
        const input = document.querySelector('input[aria-label="wager"]');
        const balance = getCurrentBalance();
        if (!input || !balance) return;
        if (initialBalance === 0) initialBalance = balance;
        sessionPeak = Math.max(sessionPeak, balance);
        syncTrackedMultiplier();        // also on the UI ticker; idempotent
        const wins = betHistory.filter(Boolean).length;
        let progress = winsNeeded > 0 ? wins / winsNeeded : 0;
        if (lockAggressionState) {
            if (lockedGearLevel === 1) progress = 0.2;
            else if (lockedGearLevel === 2) progress = 0.6;
            else if (lockedGearLevel === 3) progress = 0.95;
            else if (lockedGearLevel === 4) progress = 1.3;
            else if (lockedGearLevel === 5) progress = 1.6;
        }
        const baseWindow = 30 + Math.round(trackedMultiplier * 8);
        const baseDivisor = 300 + Math.round(trackedMultiplier * 6);
        historyWindow = Math.max(5, Math.round(baseWindow / aggressionLevel));
        safeDivisor = Math.max(15, Math.round(baseDivisor / aggressionLevel));
        winsNeeded = Math.max(1, Math.floor(historyWindow / (trackedMultiplier * 0.8)));
        aggressiveDivisor = Math.max(1, Math.round(safeDivisor * (0.6 / aggressionLevel)));
        const dynamicDivisor = safeDivisor - ((safeDivisor - aggressiveDivisor) * Math.min(1, progress / 1.5));
        let targetBet = (sessionPeak / dynamicDivisor) * aggressionLevel;
        const maxBetPct = Math.min(0.18, 0.05 + aggressionLevel * 0.04);
        targetBet = Math.max(minBaseBet, Math.min(targetBet, balance * maxBetPct));
        if (Math.abs(targetBet - lastAmount) > 0.00000005) {
            lastAmount = targetBet;
            setBet(targetBet);
        }
    }
    function startObserverWrapper() {
        if (!pastBetsContainer || !pastBetsContainer.isConnected) {
            if (observer) observer.disconnect();
            startObserver();
        }
    }
    setInterval(() => {
        buildHUD();
        const bal = getCurrentBalance();
        if (bal > 0.00000001) {
            if (initialBalance === 0) initialBalance = bal;
            sessionPeak = Math.max(sessionPeak, bal);
            lastKnownBalance = bal;
        }
        // Autostop on Balance — read every tick regardless of mode so the
        // Manual / IOW / Smart inputs all stay synced with autoStopBalance.
        {
            const autostopEl = document.getElementById('h-autostop');
            if (autostopEl) {
                const v = parseFloat(autostopEl.value);
                autoStopBalance = !isNaN(v) && v > 0 ? v : null;
            }
        }
        // Periodic safety check — also catches the case where balance ticked
        // past the target between observed bets, or where a bet-result event
        // got missed. Runs for every mode.
        if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) {
            stopRapidFire();
        }
        if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base'); if (baseInp) baseBet = parseFloat(baseInp.value) || minBaseBet;
            const winIncEl = document.getElementById('h-win-inc'); if (winIncEl) winIncreasePercent = parseFloat(winIncEl.value) || 125;
            const lossResetEl = document.getElementById('h-loss-reset'); if (lossResetEl) lossStreakReset = parseInt(lossResetEl.value, 10) || 3;
            const winsResetEl = document.getElementById('h-wins-reset'); if (winsResetEl) winsBeforeReset = parseInt(winsResetEl.value, 10) || null;
        }
        if (ACTIVE_MODE === 'cond') {
            /* The HUD no longer carries its own base-bet field, so the SITE's wager
               box is the source of truth. Only adopt it while a run is NOT in
               progress: during rapid fire the engine is itself writing that box on
               every bet, and reading it back would feed the escalated stake in as a
               new base and compound it away from the strategy. The `condInp` branch
               remains for any build that still renders the field. */
            const condInp = document.getElementById('h-cond-base');
            if (condInp) condBaseBet = parseFloat(condInp.value) || minBaseBet;
            else if (!isRapidFiring) {
                const nativeBet = getCurrentBet();
                if (isFinite(nativeBet) && nativeBet >= minBaseBet) condBaseBet = nativeBet;
            }
            // The DiceTool panel builds asynchronously (document-ready), so it
            // may not have existed when the tab was first opened. Once it shows
            // up, mount it, build the Stats tab, and wire its controls.
            const dp = document.getElementById('dt-aio-panel');
            const hc = document.getElementById('hud-content');
            if (dp && hc && (dp.parentElement !== hc || !document.getElementById('h-rapid-toggle'))) {
                mountDicePanel();
                if (ensureNutsStatsTab()) attachListeners();
            }
        }
        if (ACTIVE_MODE === 'manual') {
            // Keep manualBet synced from the HUD input so user edits take
            // effect even if the input listener missed an event.
            const manualInp = document.getElementById('h-manual-bet');
            if (manualInp) {
                const v = parseFloat(manualInp.value);
                if (isFinite(v) && v >= minBaseBet) manualBet = v;
            }
        }
        updateUI();
        startObserverWrapper();
        monitorRapidFireHealth();
        hideNativeBleedThrough();
        fitCondHostHeight();
        if (ACTIVE_MODE === 'smart') updateBetAmount();
        if (isRapidFiring) startBetGuardian();
        else stopBetGuardian();
    }, 500);
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key.toLowerCase() === 'r') resetStats();
        if (ACTIVE_MODE === 'smart') {
            if (e.key === ']' || e.key === '[') {
                if (!lockAggressionState) {
                    lockAggressionState = true;
                    const chk = document.getElementById('h-lock-agg-chk');
                    if (chk) chk.checked = true;
                    const sel = document.getElementById('h-lock-gear-sel');
                    if (sel) sel.disabled = false;
                }
                if (e.key === ']') lockedGearLevel = Math.min(5, lockedGearLevel + 1);
                if (e.key === '[') lockedGearLevel = Math.max(1, lockedGearLevel - 1);
                const gearSel = document.getElementById('h-lock-gear-sel');
                if (gearSel) gearSel.value = lockedGearLevel;
                updateUI();
            }
        }
    });
    setTimeout(() => { buildHUD(); startObserver(); }, 800);
    console.log('%c✅ IOW / Smart v3.6 loaded - CONDITIONS MODE + SOLID SPACEBAR HOLD', 'color:#43f6ff;font-weight:900;font-size:14px');

    }


    /* === source: stake-shuffle-dice-tool-desktop.user.js === */
    function tool_dice_tool() {
        'use strict';
/* =========================================================
       STATE & CONSTANTS
       ========================================================= */
    const STORE_KEY = 'dice_tool_aio_desktop_state_v1';
    const RES_COLS = [
        'StartingBalance', 'Trials', 'BetDiv', 'ProfitMult', 'W%', 'L', 'Buffer%',
        'AvgHigh', 'StdDev', 'MaxHigh', 'AvgCycles', 'AvgRounds',
        'CycleSuccess%', 'Bust%', 'Score'
    ];
    // Exact DiceTool.exe column headers: labels fall back to the raw RES_COLS
    // keys (BetDiv, ProfitMult, W%, ...), matching the desktop app's treeview.
    const RES_COL_LABELS = {};
    const RES_COL_HELP = {
        StartingBalance: 'Starting bankroll used for the simulations.',
        Trials: 'Number of simulated runs per combo.',
        BetDiv: 'Balance divided by this = starting bet (higher = smaller bets).',
        ProfitMult: 'Multiplier that sets the profit stop.',
        'W%': 'Bet increase after each win.',
        L: 'Consecutive losses before the bet resets.',
        'Buffer%': 'Extra safety margin added to the multiplier.',
        AvgHigh: 'Median highest balance reached.',
        StdDev: 'Variation in the highest balance (lower = steadier).',
        MaxHigh: 'Best single highest balance seen.',
        AvgCycles: 'Average completed profit cycles.',
        AvgRounds: 'Average bets placed per run.',
        'CycleSuccess%': 'Share of cycles that hit their profit goal.',
        'Bust%': 'Share of runs that busted (lower is safer).',
        Score: 'Risk-adjusted score = (Avg High - Start) / Std Dev. Higher is better.'
    };
    // Default-visible columns; the rest sit behind the "More columns" toggle.
    const RES_COLS_PRIMARY = ['BetDiv', 'ProfitMult', 'W%', 'L', 'Buffer%', 'AvgHigh', 'Bust%', 'Score'];
    const SAFE_BUST_MAX = 10;

    const state = {
        balance: '20', win_inc: '78', loss_reset: '5',
        bet_div: '500', profit_mult: '100', buffer: '25', n_trials: '100',
        opt_balance: '20', opt_trials: '10',
        opt_betdiv: '256,500', opt_profit: '50,100',
        opt_w: '50-100;step=5', opt_l: '3-5;step=1', opt_buf: '25,30,40',
        theme: 'original', large_fonts: false, keep_prev: false,
        worker_count: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4))),
        panel_open: false,
        results: [],
        // Streak counter (win/loss tracking + autoplay stopper)
        show_counter: true,
        counter_target: 10,
        counter_volume: 100,
        counter_autostop: true,
        counter_x: null, counter_y: null
    };

    let simWorker = null, simRunning = false;
    let optWorkers = [], optRunning = false, optQueue = [], optResults = [];
    let optDone = 0, optTotal = 0;
    let selectedRowIdx = -1;
    let resultsSortCol = 'Score';
    let resultsSortAsc = false;
    let showAllCols = true;    // Results: all 15 DiceTool.exe columns, always (matches the app)
    let safeOnly = false;      // Results: hide rows with Bust% above SAFE_BUST_MAX

    /* =========================================================
       STATE PERSISTENCE
       ========================================================= */
    function saveState() {
        try {
            const snap = {};
            const ids = ['balance', 'win_inc', 'loss_reset', 'bet_div', 'profit_mult', 'buffer', 'n_trials',
                         'opt_balance', 'opt_trials', 'easy_mult'];
            for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'])
                for (const s of ['from', 'to', 'step', 'values']) ids.push(p + '_' + s);
            for (const k of ids) {
                const el = $(k);
                if (el) snap[k] = el.value;
            }
            const theme = $('theme_select');
            if (theme) snap.theme = theme.value;
            const lf = $('large_fonts'); if (lf) snap.large_fonts = lf.checked;
            const kp = $('keep_prev'); if (kp) snap.keep_prev = kp.checked;
            const wc = $('worker_count'); if (wc) snap.worker_count = parseInt(wc.value) || 1;
            const sc = $('show_counter'); if (sc) snap.show_counter = sc.checked;
            const cas = $('counter_autostop'); if (cas) snap.counter_autostop = cas.checked;
            snap.counter_target = state.counter_target;
            snap.counter_volume = state.counter_volume;
            snap.counter_x = state.counter_x;
            snap.counter_y = state.counter_y;
            snap.panel_open = state.panel_open;
            snap.results = optResults.slice();
            Object.assign(state, snap);
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (e) { /* best effort */ }
    }

    function loadState() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return;
            Object.assign(state, JSON.parse(raw));
        } catch (e) { /* ignore */ }
    }

    /* =========================================================
       DOM HELPERS (scoped — only look inside our panel)
       ========================================================= */
    const PANEL_ID = 'dt-aio-panel';
    const BUTTON_ID = 'dt-aio-button';
    const COUNTER_ID = 'dt-aio-counter';
    const $ = (id) => document.getElementById('dt-' + id);
    const $$ = (sel) => document.querySelectorAll('#' + PANEL_ID + ' ' + sel);

    function toast(msg, duration = 2000) {
        const t = $('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => t.classList.remove('show'), duration);
    }

    /* =========================================================
       SHARED GAME HELPERS (from existing userscript)
       ========================================================= */
    const sleep = ms => new Promise(res => setTimeout(res, ms));
    const waitFor = async (selector, timeout = 15000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(200);
        }
        throw new Error(`Timeout waiting for selector: ${selector}`);
    };
    const waitForText = async (tag, text, timeout = 10000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const els = Array.from(document.querySelectorAll(tag));
            const found = els.find(el => el.textContent.trim().toLowerCase().includes(text.toLowerCase()));
            if (found) return found;
            await sleep(200);
        }
        return null;
    };
    const setNativeValue = (element, value) => {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const prototype = Object.getPrototypeOf(element);
        const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
        if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
            prototypeValueSetter.call(element, value);
        } else {
            valueSetter.call(element, value);
        }
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    const setSelectValue = (sel, val) => {
        sel.value = val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const trigger = el => {
        ['input', 'change', 'blur'].forEach(type => {
            el.dispatchEvent(new Event(type, { bubbles: true }));
        });
    };

    /* Read current calculated values for strategy import */
    function currentCalcValues() {
        return {
            bet_size: $('out_bet').value,
            profit_stop: $('out_profit').value,
            balance_target: $('out_target').value,
            multiplier: ($('out_mult').value || '').replace(/x$/, ''),
            win_increase: $('win_inc').value,
            loss_reset: $('loss_reset').value
        };
    }

    /* =========================================================
       WEB WORKER SOURCE — Stake RNG + simulator + optimizer.
       Port of simulation_core.py. Verified bit-identical vs Python.
       ========================================================= */
    const WORKER_SOURCE = `
'use strict';
async function hmacSha256(keyStr, msgStr) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
  return new Uint8Array(sig);
}
function randomHex(len) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('');
}
class StakeRNG {
  constructor() {
    this.server_seed = randomHex(32);
    this.client_seed = randomHex(32);
    this.nonce = 0;
    this.round_idx = 0;
    this.cache = new Uint8Array(0);
    this.cacheOffset = 0;
  }
  async _ensureBytes(n) {
    while (this.cache.length - this.cacheOffset < n) {
      const msg = this.client_seed + ':' + this.nonce + ':' + this.round_idx;
      const chunk = await hmacSha256(this.server_seed, msg);
      const remaining = this.cache.length - this.cacheOffset;
      const merged = new Uint8Array(remaining + chunk.length);
      if (remaining > 0) merged.set(this.cache.subarray(this.cacheOffset), 0);
      merged.set(chunk, remaining);
      this.cache = merged;
      this.cacheOffset = 0;
      this.round_idx += 1;
    }
  }
  async nextRollBatch(count) {
    if (count <= 0) return [];
    const needed = count * 4;
    await this._ensureBytes(needed);
    const rolls = new Float64Array(count);
    let off = this.cacheOffset;
    for (let i = 0; i < count; i++) {
      const b0 = this.cache[off], b1 = this.cache[off+1], b2 = this.cache[off+2], b3 = this.cache[off+3];
      off += 4;
      const f = b0/256 + b1/65536 + b2/16777216 + b3/4294967296;
      rolls[i] = f * 10001 / 100;
    }
    this.cacheOffset = off;
    this.nonce += count;
    return rolls;
  }
}
async function runCompoundedTrial(params, batchSize = 1024) {
  const rng = new StakeRNG();
  let balance = params.starting_balance;
  let peak = balance;
  let cycles = 0;
  let rounds = 0;
  const MAX_ROUNDS_SAFETY = 10000000;
  while (balance > 0 && rounds < MAX_ROUNDS_SAFETY) {
    const bet = balance / params.bet_div;
    const profit_stop = bet * params.profit_mult;
    const target = balance + profit_stop;
    const m = ((1 + params.w) * params.l) * params.buffer;
    const win_chance = m === 0 ? 0 : Math.max(0, Math.min(1, (1 - 0.01) / m));
    let current_bet = bet;
    let loss_streak = 0;
    let batch = [];
    let idx = 0;
    while (balance > 0 && balance < target && rounds < MAX_ROUNDS_SAFETY) {
      if (idx >= batch.length) {
        batch = await rng.nextRollBatch(batchSize);
        idx = 0;
        if (!batch.length) break;
      }
      const roll = batch[idx++];
      rounds++;
      if (roll < win_chance * 100) {
        balance += current_bet * (m - 1);
        current_bet *= (1 + params.w);
        loss_streak = 0;
      } else {
        balance -= current_bet;
        loss_streak++;
        if (loss_streak >= params.l) {
          current_bet = bet;
          loss_streak = 0;
        }
      }
      if (balance > peak) peak = balance;
    }
    if (balance < target) break;
    cycles += 1;
  }
  return { highest_balance: peak, cycles, rounds };
}
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x,y)=>x-y);
  const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1]+s[m])/2;
}
function mean(a) { return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }
function stdev(a) {
  if (a.length < 2) return 0;
  const mu = mean(a);
  return Math.sqrt(a.reduce((s,x)=>s+(x-mu)*(x-mu),0)/(a.length-1));
}

async function runSimulatorTask(params) {
  const results = [];
  for (let i = 0; i < params.n_trials; i++) {
    if (self._stopFlag) break;
    const r = await runCompoundedTrial(params);
    results.push(r);
    self.postMessage({ kind: 'sim_progress', done: i + 1, total: params.n_trials });
  }
  const highs = results.map(r => r.highest_balance);
  const cyc = results.map(r => r.cycles);
  const rnd = results.map(r => r.rounds);
  const successes = cyc.reduce((a,b)=>a+b,0);
  const attempts = results.length + successes;
  const stats = {
    avg_high: highs.length ? median(highs) : 0,
    std_high: highs.length > 1 ? stdev(highs) : 0,
    max_high: highs.length ? Math.max(...highs) : 0,
    avg_cycles: mean(cyc),
    avg_rounds: mean(rnd),
    cycle_success: attempts ? (successes / attempts * 100) : 0,
    bust_rate: params.n_trials ? (cyc.filter(c => c === 0).length / params.n_trials * 100) : 0,
    n_completed: results.length
  };
  self.postMessage({ kind: 'sim_done', stats });
}

async function runOptimizerCombo(combo) {
  const params = {
    starting_balance: combo.starting_balance,
    bet_div: combo.bet_div, profit_mult: combo.profit_mult,
    w: combo.w, l: combo.l, buffer: combo.buffer, n_trials: combo.n_trials
  };
  const results = [];
  for (let i = 0; i < params.n_trials; i++) {
    if (self._stopFlag) break;
    const r = await runCompoundedTrial(params);
    results.push(r);
  }
  const highs = results.map(r => r.highest_balance);
  const cyc = results.map(r => r.cycles);
  const rnd = results.map(r => r.rounds);
  const successes = cyc.reduce((a,b)=>a+b,0);
  const attempts = results.length + successes;
  const avg_high = highs.length ? median(highs) : 0;
  const std_high = highs.length > 1 ? stdev(highs) : 0;
  const max_high = highs.length ? Math.max(...highs) : 0;
  const score = std_high !== 0 ? (avg_high - combo.starting_balance) / std_high : 0;
  const row = {
    StartingBalance: +combo.starting_balance.toFixed(2),
    Trials: combo.n_trials,
    BetDiv: +combo.bet_div.toFixed(2),
    ProfitMult: +combo.profit_mult.toFixed(2),
    'W%': +(combo.w * 100).toFixed(2),
    L: combo.l,
    'Buffer%': +((combo.buffer - 1) * 100).toFixed(2),
    AvgHigh: +avg_high.toFixed(2),
    StdDev: +std_high.toFixed(2),
    MaxHigh: +max_high.toFixed(2),
    AvgCycles: +mean(cyc).toFixed(2),
    AvgRounds: +mean(rnd).toFixed(2),
    'CycleSuccess%': +(attempts ? successes / attempts * 100 : 0).toFixed(2),
    'Bust%': +(params.n_trials ? cyc.filter(c=>c===0).length / params.n_trials * 100 : 0).toFixed(2),
    Score: +score.toFixed(2)
  };
  self.postMessage({ kind: 'opt_row', row });
}

self._stopFlag = false;
self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.kind === 'stop') { self._stopFlag = true; return; }
  if (msg.kind === 'run_sim') {
    self._stopFlag = false;
    try { await runSimulatorTask(msg.params); } catch (err) { self.postMessage({ kind: 'error', error: String(err) }); }
    return;
  }
  if (msg.kind === 'run_combo') {
    self._stopFlag = false;
    try { await runOptimizerCombo(msg.combo); }
    catch (err) {
      self.postMessage({ kind: 'opt_row', row: {
        StartingBalance: msg.combo.starting_balance, Trials: msg.combo.n_trials,
        BetDiv: msg.combo.bet_div, ProfitMult: msg.combo.profit_mult,
        'W%': msg.combo.w*100, L: msg.combo.l, 'Buffer%': (msg.combo.buffer-1)*100,
        AvgHigh: 0, StdDev: 0, MaxHigh: 0, AvgCycles: 0, AvgRounds: 0,
        'CycleSuccess%': 0, 'Bust%': 100, Score: 0
      }});
    }
    self.postMessage({ kind: 'opt_combo_done' });
  }
};
`;

    function makeWorker() {
        const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }


    /* =========================================================
       CSS — injected once into the casino page
       ========================================================= */
    const CSS = `
#${PANEL_ID}, #${BUTTON_ID} {
  --dt-bg: #161616;
  --dt-fg: #e6fffb;
  --dt-label-fg: #17c7b8;
  --dt-field-bg: #050505;
  --dt-select-bg: #17c7b8;
  --dt-select-fg: #000;
  --dt-button-bg: #0a0a0a;
  --dt-border: #17c7b8;
  --dt-danger: #ff5a44;
  --dt-progress: #00ff80;
  --dt-trough: #2a2a2a;
  --dt-row-even: #1c1c1c;
  --dt-row-odd: #252525;
  --dt-font-scale: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
#${PANEL_ID}[data-theme="stake"], #${BUTTON_ID}[data-theme="stake"] {
  --dt-bg: #0b1a22; --dt-fg: #ffffff; --dt-label-fg: #17c7b8;
  --dt-field-bg: #030a0f; --dt-select-bg: #1f333e; --dt-select-fg: #ffffff;
  --dt-button-bg: #030a0f; --dt-border: #17c7b8; --dt-progress: #00ff80;
  --dt-row-even: #0f212e; --dt-row-odd: #162a35;
}
#${PANEL_ID}[data-theme="shuffle"], #${BUTTON_ID}[data-theme="shuffle"] {
  --dt-bg: #0c0c0c; --dt-fg: #ffffff; --dt-label-fg: #c084fc;
  --dt-field-bg: #050505; --dt-select-bg: #a855f7; --dt-select-fg: #ffffff;
  --dt-button-bg: #1a1a1a; --dt-border: #a855f7; --dt-progress: #c084fc;
  --dt-row-even: #171717; --dt-row-odd: #202020;
}
#${PANEL_ID}[data-large-fonts="true"] { --dt-font-scale: 1.2; }

/* Floating toggle button */
#${BUTTON_ID} {
  position: fixed;
  top: 90px;
  right: 16px;
  z-index: 2147483646;
  width: 48px; height: 48px;
  border-radius: 50%;
  background: var(--dt-bg);
  border: 2px solid var(--dt-border);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5), 0 0 10px color-mix(in srgb, var(--dt-border) 40%, transparent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: var(--dt-label-fg);
  user-select: none;
  -webkit-user-select: none;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
  padding: 0;
}
#${BUTTON_ID}:hover { transform: scale(1.06); }
#${BUTTON_ID}:active { transform: scale(0.92); }

/* Backdrop when panel is open (lighter than mobile; desktop users expect to click-through) */
#dt-backdrop {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.25);
  z-index: 2147483645;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease;
}
#dt-backdrop.show {
  opacity: 1;
  pointer-events: auto;
}

/* The panel itself — desktop right-side drawer.
   NOTE: z-index is intentionally one lower than #dt-tooltip / #dt-toast
   so tooltips pop in front of the panel instead of behind it. */
#${PANEL_ID} {
  position: fixed;
  top: 50%;
  right: 16px;
  transform: translate(120%, -50%);
  width: 1020px;
  max-width: calc(100vw - 32px);
  height: 90vh;
  max-height: 900px;
  z-index: 2147483646;
  background: var(--dt-bg);
  color: var(--dt-fg);
  border: 2px solid var(--dt-border);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease;
  opacity: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  font-size: calc(14px * var(--dt-font-scale));
  line-height: 1.5;
}
#${PANEL_ID}.show { transform: translate(0, -50%); opacity: 1; pointer-events: auto; }
#${PANEL_ID} * { box-sizing: border-box; }

/* Panel header — draggable */
#${PANEL_ID} .dt-head {
  position: relative;
  padding: 10px 44px 10px 16px;
  text-align: center;
  flex-shrink: 0;
  border-bottom: 1px solid var(--dt-border);
  cursor: move;
  -webkit-user-select: none;
  user-select: none;
  background: color-mix(in srgb, var(--dt-bg) 92%, black 8%);
  border-radius: 10px 10px 0 0;
}
#${PANEL_ID} .dt-title {
  font-family: 'Times New Roman', Georgia, serif;
  font-style: italic;
  font-weight: bold;
  font-size: 1.2em;
  color: var(--dt-label-fg);
  text-decoration: underline;
  margin: 0;
}
#${PANEL_ID} .dt-close {
  position: absolute;
  top: 6px; right: 8px;
  width: 28px; height: 28px;
  border: none;
  background: transparent;
  color: var(--dt-fg);
  font-size: 20px;
  font-weight: 700;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
#${PANEL_ID} .dt-close:hover { background: var(--dt-field-bg); }

/* Panel body & panels */
#${PANEL_ID} .dt-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 12px 8px;
}
#${PANEL_ID} .dt-panel { display: none; animation: dt-fade 0.2s ease; }
#${PANEL_ID} .dt-panel.active { display: block; }
@keyframes dt-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

/* Cards — clearly elevated from the darker panel surface. */
#${PANEL_ID} .dt-card {
  background: color-mix(in srgb, var(--dt-bg) 78%, white 22%);
  border: 2px solid var(--dt-border);
  border-radius: 10px;
  padding: 14px 12px 12px;
  margin-bottom: 14px;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
#${PANEL_ID} .dt-card-title {
  position: absolute;
  top: -11px; left: 14px;
  background: var(--dt-bg);
  color: var(--dt-label-fg);
  padding: 0 8px;
  font-family: 'Times New Roman', Georgia, serif;
  font-weight: bold;
  font-style: italic;
  font-size: 0.95em;
  text-decoration: underline;
}

/* Fields */
#${PANEL_ID} .dt-field {
  display: flex;
  align-items: center;
  margin: 6px 0;
  gap: 8px;
}
#${PANEL_ID} .dt-field label,
#${PANEL_ID} .dt-field .dt-label {
  flex: 1;
  color: var(--dt-label-fg);
  font-weight: 600;
  font-size: 0.95em;
  display: flex;
  align-items: center;
  gap: 6px;
}
#${PANEL_ID} .dt-help {
  width: 20px; height: 20px;
  border: 1px solid var(--dt-border);
  border-radius: 50%;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--dt-label-fg);
  background: transparent;
  cursor: help;
  font-weight: 700;
  flex-shrink: 0;
  padding: 0;
  line-height: 1;
  -webkit-appearance: none;
  appearance: none;
  touch-action: manipulation;
}
#${PANEL_ID} .dt-help:active { background: var(--dt-label-fg); color: var(--dt-bg); }
#${PANEL_ID} .dt-field input[type="text"],
#${PANEL_ID} .dt-field input[type="number"],
#${PANEL_ID} input.dt-text-input {
  width: 100px;
  min-width: 80px;
  padding: 8px 10px;
  background: var(--dt-field-bg);
  color: var(--dt-fg);
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  font-size: 1em;
  font-family: inherit;
  text-align: right;
  -webkit-appearance: none;
  appearance: none;
}
#${PANEL_ID} .dt-field input:focus { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--dt-label-fg) 35%, transparent); }
#${PANEL_ID} .dt-field input[readonly] { opacity: 0.95; font-weight: 600; color: var(--dt-label-fg); }
#${PANEL_ID} .dt-field-wide { flex-direction: column; align-items: stretch; gap: 4px; }
#${PANEL_ID} .dt-field-wide input { width: 100%; text-align: left; }
#${PANEL_ID} .dt-hint { font-size: 0.78em; color: var(--dt-fg); opacity: 0.55; margin: -2px 0 6px; font-style: italic; }

/* Buttons */
#${PANEL_ID} .dt-btn {
  padding: 10px 14px;
  background: var(--dt-button-bg);
  color: var(--dt-label-fg);
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  font-size: 0.95em;
  font-weight: 700;
  cursor: pointer;
  font-family: inherit;
  min-height: 42px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  -webkit-user-select: none;
  user-select: none;
  touch-action: manipulation;
}
#${PANEL_ID} .dt-btn:active { background: color-mix(in srgb, var(--dt-button-bg) 70%, white 30%); transform: scale(0.985); }
#${PANEL_ID} .dt-btn:disabled { opacity: 0.45; }
#${PANEL_ID} .dt-btn-primary { background: var(--dt-label-fg); color: var(--dt-bg); border-color: var(--dt-label-fg); }
#${PANEL_ID} .dt-btn-danger { background: transparent; color: var(--dt-danger); border-color: var(--dt-danger); }
#${PANEL_ID} .dt-btn-row { display: flex; gap: 8px; margin-top: 8px; }
#${PANEL_ID} .dt-btn-row .dt-btn { flex: 1; }
#${PANEL_ID} .dt-btn-block { display: block; width: 100%; margin-top: 8px; }
#${PANEL_ID} .dt-btn-small { padding: 6px 10px; min-height: 34px; font-size: 0.85em; }

/* Progress */
#${PANEL_ID} .dt-progress-wrap {
  margin: 10px 0 4px;
  background: var(--dt-trough);
  border-radius: 6px;
  overflow: hidden;
  height: 10px;
  border: 1px solid var(--dt-border);
}
#${PANEL_ID} .dt-progress-bar {
  height: 100%;
  width: 0%;
  background: var(--dt-progress);
  transition: width 0.2s ease;
}
#${PANEL_ID} .dt-status-line {
  text-align: center;
  font-size: 0.85em;
  opacity: 0.8;
  margin: 4px 0 10px;
  min-height: 1.2em;
}

/* Tables */
#${PANEL_ID} .dt-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  background: var(--dt-field-bg);
  max-height: 45vh;
  overflow-y: auto;
}
#${PANEL_ID} table.dt-results {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85em;
}
#${PANEL_ID} table.dt-results th, #${PANEL_ID} table.dt-results td {
  padding: 5px 6px;
  text-align: center;
  white-space: nowrap;
  border-bottom: 1px solid var(--dt-border);
}
#${PANEL_ID} table.dt-results th {
  background: var(--dt-button-bg);
  color: var(--dt-label-fg);
  font-weight: 700;
  position: sticky;
  top: 0;
  cursor: pointer;
}
#${PANEL_ID} table.dt-results tr:nth-child(even) td { background: var(--dt-row-even); }
#${PANEL_ID} table.dt-results tr:nth-child(odd) td { background: var(--dt-row-odd); }
#${PANEL_ID} table.dt-results tr.selected td { background: var(--dt-select-bg) !important; color: var(--dt-select-fg); font-weight: 600; }
#${PANEL_ID} table.dt-stats { width: 100%; font-size: 0.92em; }
#${PANEL_ID} table.dt-stats td { padding: 8px 10px; border-bottom: 1px solid var(--dt-border); }
#${PANEL_ID} table.dt-stats tr:last-child td { border-bottom: none; }
#${PANEL_ID} table.dt-stats td:first-child { color: var(--dt-label-fg); font-weight: 600; width: 55%; }
#${PANEL_ID} table.dt-stats td:last-child { text-align: right; font-variant-numeric: tabular-nums; }

/* Settings rows */
#${PANEL_ID} .dt-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 30%, transparent);
  gap: 10px;
}
#${PANEL_ID} .dt-setting-row:last-child { border-bottom: none; }
#${PANEL_ID} .dt-setting-label { color: var(--dt-label-fg); font-weight: 600; }
#${PANEL_ID} .dt-setting-desc { font-size: 0.8em; opacity: 0.65; margin-top: 2px; font-style: italic; }
#${PANEL_ID} select.dt-theme-select, #${PANEL_ID} input.dt-num-input {
  padding: 8px 10px;
  background: var(--dt-field-bg);
  color: var(--dt-fg);
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.95em;
}
#${PANEL_ID} input.dt-num-input { width: 64px; text-align: center; }
#${PANEL_ID} .dt-switch { position: relative; width: 46px; height: 26px; flex-shrink: 0; }
#${PANEL_ID} .dt-switch input { opacity: 0; width: 0; height: 0; }
#${PANEL_ID} .dt-switch .dt-slider {
  position: absolute; inset: 0;
  background: var(--dt-trough);
  border-radius: 26px;
  transition: 0.2s;
  cursor: pointer;
}
#${PANEL_ID} .dt-switch .dt-slider::before {
  content: '';
  position: absolute;
  height: 20px; width: 20px;
  left: 3px; top: 3px;
  background: white;
  border-radius: 50%;
  transition: 0.2s;
}
#${PANEL_ID} .dt-switch input:checked + .dt-slider { background: var(--dt-label-fg); }
#${PANEL_ID} .dt-switch input:checked + .dt-slider::before { transform: translateX(20px); }

/* Tabs — top-positioned for desktop */
#${PANEL_ID} .dt-tabs {
  display: flex;
  background: var(--dt-button-bg);
  border-bottom: 1px solid var(--dt-border);
  flex-shrink: 0;
}
#${PANEL_ID} .dt-tab-btn {
  flex: 1;
  padding: 10px 6px;
  background: transparent;
  border: none;
  color: var(--dt-fg);
  font-size: 0.82em;
  font-weight: 600;
  cursor: pointer;
  border-bottom: 3px solid transparent;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 5px;
  font-family: inherit;
  -webkit-user-select: none; user-select: none;
  transition: background 0.12s, color 0.12s;
}
#${PANEL_ID} .dt-tab-btn:hover { background: var(--dt-field-bg); }
#${PANEL_ID} .dt-tab-btn .dt-tab-icon { font-size: 1.1em; line-height: 1; }
#${PANEL_ID} .dt-tab-btn.active {
  color: var(--dt-label-fg);
  background: var(--dt-bg);
  border-bottom-color: var(--dt-label-fg);
}

/* Toast */
#dt-toast {
  position: fixed;
  left: 50%;
  top: 24px;
  transform: translateX(-50%) translateY(-20px);
  background: var(--dt-bg, #3f3f3f);
  color: var(--dt-fg, #17c7b8);
  border: 1px solid var(--dt-border, #249f87);
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 0.9em;
  max-width: 600px;
  text-align: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 2147483647;
  box-shadow: 0 4px 14px rgba(0,0,0,0.4);
  font-family: -apple-system, 'Segoe UI', sans-serif;
}
#dt-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

/* Tooltip popover for ? helpers */
#dt-tooltip {
  position: fixed;
  max-width: 260px;
  padding: 10px 12px;
  background: var(--dt-bg, #3f3f3f);
  color: var(--dt-fg, #17c7b8);
  border: 1px solid var(--dt-border, #249f87);
  border-radius: 8px;
  font-size: 0.85em;
  line-height: 1.45;
  z-index: 2147483647;
  box-shadow: 0 6px 18px rgba(0,0,0,0.5);
  display: none;
  font-family: -apple-system, sans-serif;
}
#dt-tooltip.show { display: block; }
#dt-tooltip .dt-tt-title { color: var(--dt-label-fg, #249f87); font-weight: 700; margin: 0 0 4px; }

/* Streak Counter HUD — always-visible draggable widget */
#${COUNTER_ID} {
  --dt-bg: #1a1a1a;
  --dt-fg: #ffffff;
  --dt-label-fg: #17c7b8;
  --dt-border: #249f87;
  --dt-danger: #e74c3c;
  position: fixed;
  top: 150px;
  right: 16px;
  z-index: 2147483644;
  background: var(--dt-bg);
  color: var(--dt-fg);
  border: 2px solid var(--dt-border);
  border-radius: 10px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.5), 0 0 10px color-mix(in srgb, var(--dt-border) 30%, transparent);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  user-select: none;
  -webkit-user-select: none;
  padding: 8px 10px;
  min-width: 180px;
  max-width: 220px;
  display: none;
}
#${COUNTER_ID}[data-theme="stake"] { --dt-bg: #0f212e; --dt-border: #249f87; --dt-label-fg: #17c7b8; }
#${COUNTER_ID}[data-theme="shuffle"] { --dt-bg: #131313; --dt-border: #a855f7; --dt-label-fg: #a855f7; }
#${COUNTER_ID}.show { display: block; }
#${COUNTER_ID} .dt-ctr-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
#${COUNTER_ID} .dt-ctr-row + .dt-ctr-row { margin-top: 4px; }
#${COUNTER_ID} .dt-ctr-w {
  color: var(--dt-label-fg);
  font-weight: 700;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
  transition: transform 0.3s;
  min-width: 28px;
  text-align: center;
}
#${COUNTER_ID} .dt-ctr-l {
  color: var(--dt-fg);
  font-weight: 600;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  transition: transform 0.3s, color 0.3s;
  min-width: 22px;
  text-align: center;
}
#${COUNTER_ID} .dt-ctr-l.has-loss { color: var(--dt-danger); }
#${COUNTER_ID} .dt-ctr-lbl {
  font-size: 10px;
  opacity: 0.7;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
#${COUNTER_ID} .dt-ctr-target {
  background: transparent;
  color: var(--dt-fg);
  border: 1px solid var(--dt-border);
  border-radius: 4px;
  width: 38px;
  padding: 2px 4px;
  font-size: 12px;
  font-family: inherit;
  text-align: center;
  -webkit-appearance: none;
  appearance: none;
}
#${COUNTER_ID} .dt-ctr-btn {
  background: var(--dt-border);
  color: var(--dt-bg);
  border: none;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  padding: 3px 8px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
#${COUNTER_ID} .dt-ctr-btn:active { opacity: 0.75; }
#${COUNTER_ID} .dt-ctr-btn:disabled { opacity: 0.5; cursor: progress; }
#${COUNTER_ID} .dt-ctr-btn-wide { flex: 1; padding: 5px 10px; }
#${COUNTER_ID} .dt-ctr-vol {
  -webkit-appearance: none;
  appearance: none;
  width: 70px;
  height: 3px;
  background: var(--dt-border);
  border-radius: 2px;
  flex: 1;
}
#${COUNTER_ID} .dt-ctr-vol::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 12px; height: 12px;
  background: var(--dt-label-fg);
  border-radius: 50%;
  cursor: pointer;
}
#${COUNTER_ID} .dt-ctr-vol::-moz-range-thumb {
  width: 12px; height: 12px;
  background: var(--dt-label-fg);
  border-radius: 50%;
  border: none;
  cursor: pointer;
}
#${COUNTER_ID} .dt-ctr-drag {
  color: var(--dt-label-fg);
  opacity: 0.55;
  font-size: 10px;
  cursor: move;
  letter-spacing: 1px;
  flex-shrink: 0;
}
`;


    /* =========================================================
       TERMS GLOSSARY — one-line definitions for tooltip helpers.
       Pulled from terms_tab.py content.
       ========================================================= */
    const GLOSSARY = {
        'Balance': 'Your total bankroll for each simulation or calculation.',
        'Win Increase %': 'The percentage amount the bet increases after every win.',
        'Loss Reset': 'Number of consecutive losses required before resetting the bet to its base size.',
        'Balance Divisor': 'Balance is divided by this number to determine the starting bet size. Higher = smaller bets.',
        'Profit Multiplier': 'The multiplier applied to the base bet that defines the profit stop.',
        'Buffer %': 'An additional percentage added to the multiplier for extra margin or protection.',
        'Multiplier': 'The payout odds or target multiplier determined by input parameters.',
        'Bet Size': 'The first wager placed based on the current balance and balance divisor.',
        'Profit Stop': 'The profit goal for the current cycle, derived from the bet and multiplier.',
        'Balance Target': 'The balance amount where the simulation stops a successful cycle.',
        'Trials': 'Number of simulated runs. Higher values improve accuracy but take longer.',
        'Starting Balance': 'The initial balance applied to all combos during the strategy search.',
        'Trials per Combo': 'The number of simulations run for each parameter combination.',
        'Bet Divisor Range': 'Bet divisor values to test. From - To walks a range (using Step); Values tests an exact comma list (e.g. 256,500). Both merge; either may be blank.',
        'Profit Multiplier Range': 'Profit multiplier values to test. From - To walks a range (using Step); Values tests an exact comma list. Both merge; either may be blank.',
        'Win Increase % Range': 'Win increase percentages to test. From - To walks a range (using Step); Values tests an exact comma list. Both merge; either may be blank.',
        'Loss Reset (whole)': 'Loss reset counts to test (whole numbers). From - To walks a range (using Step); Values tests an exact comma list. Both merge; either may be blank.',
        'Buffer % Range': 'Buffer percentages to test. From - To walks a range (using Step); Values tests an exact comma list. Both merge; either may be blank.',
        'Win Chance': 'The dice win chance implied by the multiplier (99 / multiplier).',
        'Reset Odds %': 'The chance that a full run of Loss Reset bets are all losses, triggering a bet reset.'
    };

    /* Extra CSS for the Advanced IOW UX upgrades. Injected on init (see injectUxStyles).
       Built entirely on existing theme vars so all three themes keep working. */
    const DT_EXTRA_CSS = `
        /* ============================================================
           CLEAN LAYOUT — consistent settings-style rows, left-aligned,
           one card per group, minimal decoration.
           ============================================================ */
        /* Section card title: plain, no serif/underline/italic. */
        #${PANEL_ID} .dt-card-title { font-family: inherit !important; font-style: normal !important; font-weight: 800 !important;
            text-decoration: none !important; letter-spacing: 0.02em; }
        /* One brief helper line under a card title. */
        .dt-card-sub { font-size: 0.74em; opacity: 0.6; margin: -2px 0 9px; line-height: 1.35; }
        /* THE row primitive: "Label ............ [control]". Used everywhere. */
        .dt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0;
            border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 22%, transparent); }
        .dt-row:last-child { border-bottom: none; }
        .dt-row-label { flex: 1 1 auto; min-width: 0; font-size: 0.86em; font-weight: 600; color: var(--dt-fg); display: flex; align-items: center; gap: 5px; }
        .dt-row-ctrl { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
        /* Inputs inside a row — fixed, right-aligned, consistent width. Own class so the
           in-HUD .dt-field width clamp never touches them. */
        .dt-row input.dt-in { width: 92px; box-sizing: border-box; padding: 6px 9px; text-align: right;
            background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid var(--dt-border); border-radius: 7px;
            font-size: 0.9em; font-variant-numeric: tabular-nums; }
        .dt-row input.dt-in:focus { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--dt-label-fg) 35%, transparent); }
        .dt-row input.dt-in.dt-invalid { border-color: var(--dt-danger) !important; box-shadow: 0 0 0 1px var(--dt-danger); }
        /* Read-only result rows: big value + copy, still aligned right. */
        .dt-row.dt-row-out .dt-out-val { font-size: 1.05em; font-weight: 800; font-variant-numeric: tabular-nums; color: var(--dt-fg);
            border: none; background: transparent; padding: 0; width: auto; text-align: right; min-width: 64px; }
        .dt-row.dt-row-key .dt-out-val { color: var(--dt-label-fg); font-size: 1.2em; }
        .dt-row.dt-row-key .dt-row-label { color: var(--dt-label-fg); }
        .dt-copy { flex: 0 0 auto; padding: 3px 9px !important; min-height: 0 !important; font-size: 0.9em; line-height: 1.4; }
        .dt-copied { background: var(--dt-progress) !important; color: #0b1216 !important; border-color: var(--dt-progress) !important; }
        /* Full-width primary button. */
        .dt-go { width: 100%; padding: 10px !important; font-weight: 800; }
        /* ===== Guided workflow stepper: Optimize -> Review -> Use ===== */
        .dt-steps { display: flex; align-items: stretch; gap: 0; margin: 0 0 11px; }
        .dt-step { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 3px; padding: 7px 2px;
            position: relative; cursor: pointer; background: none; border: none; color: var(--dt-fg); }
        .dt-step:not(:last-child)::after { content: ''; position: absolute; top: 17px; left: 60%; right: -40%; height: 2px;
            background: color-mix(in srgb, var(--dt-border) 55%, transparent); z-index: 0; }
        .dt-step.done::after { background: var(--dt-label-fg); }
        .dt-step-dot { z-index: 1; width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center;
            justify-content: center; font-size: 0.72em; font-weight: 800; background: var(--dt-field-bg);
            border: 1.5px solid var(--dt-border); color: var(--dt-fg); transition: all .12s; }
        .dt-step-name { font-size: 0.66em; font-weight: 700; letter-spacing: 0.03em; opacity: 0.6; text-transform: uppercase; }
        .dt-step.active .dt-step-dot { background: var(--dt-label-fg); border-color: var(--dt-label-fg); color: var(--dt-bg);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--dt-label-fg) 22%, transparent); }
        .dt-step.active .dt-step-name { opacity: 1; color: var(--dt-label-fg); }
        .dt-step.done .dt-step-dot { background: color-mix(in srgb, var(--dt-label-fg) 22%, var(--dt-field-bg));
            border-color: var(--dt-label-fg); color: var(--dt-label-fg); }
        .dt-step.done .dt-step-name { opacity: 0.85; }
        /* "Next step" CTA that pulls the user forward through the flow. */
        .dt-next { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; margin-top: 11px;
            padding: 11px; border-radius: 9px; cursor: pointer; font-weight: 800; font-size: 0.92em;
            background: var(--dt-label-fg); color: var(--dt-bg); border: none; }
        .dt-next[disabled] { background: var(--dt-field-bg); color: var(--dt-fg); opacity: 0.5; cursor: default;
            border: 1px solid var(--dt-border); }
        .dt-next-sub { font-size: 0.7em; font-weight: 600; opacity: 0.8; }
        /* Optimizer presets — big tappable cards (2x2), the primary way to use this tab. */
        .dt-preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 4px 0 2px; }
        .dt-preset { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left;
            padding: 10px 11px; border-radius: 9px; cursor: pointer; background: var(--dt-field-bg);
            border: 1px solid var(--dt-border); color: var(--dt-fg); transition: border-color .12s, background .12s; }
        .dt-preset:hover { border-color: var(--dt-label-fg); background: color-mix(in srgb, var(--dt-label-fg) 8%, var(--dt-field-bg)); }
        .dt-preset.active { border-color: var(--dt-label-fg); box-shadow: inset 0 0 0 1px var(--dt-label-fg); }
        .dt-preset-name { font-weight: 800; font-size: 0.92em; }
        .dt-preset-desc { font-size: 0.68em; opacity: 0.62; line-height: 1.25; }
        /* Legacy inline presets row (still used if referenced). */
        .dt-opt-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 4px; }
        .dt-opt-presets .dt-btn { flex: 1 1 0; padding: 6px 6px; font-size: 0.82em; }
        /* Collapsible "advanced ranges" disclosure — collapsed by default. */
        .dt-adv-ranges { margin-top: 4px; }
        .dt-adv-ranges > summary { list-style: none; cursor: pointer; user-select: none; padding: 9px 2px;
            font-size: 0.82em; font-weight: 600; color: var(--dt-label-fg); display: flex; align-items: center; gap: 6px; }
        .dt-adv-ranges > summary::-webkit-details-marker { display: none; }
        .dt-adv-ranges > summary::before { content: '▸'; font-size: 0.9em; opacity: 0.7; }
        .dt-adv-ranges[open] > summary::before { content: '▾'; }
        .dt-adv-ranges > summary .dt-adv-hint { margin-left: auto; font-weight: 400; opacity: 0.55; font-size: 0.85em; }
        /* Range row: label on its own line, then min/max/step + advanced toggle. */
        .dt-rng { padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 22%, transparent); }
        .dt-rng:last-child { border-bottom: none; }
        .dt-rng-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 5px; }
        .dt-rng-name { font-size: 0.86em; font-weight: 600; }
        .dt-rng-prev { font-size: 0.7em; opacity: 0.7; font-variant-numeric: tabular-nums; text-align: right; }
        .dt-rng-prev.bad { color: var(--dt-danger); opacity: 0.95; font-style: italic; }
        .dt-rng-row { display: flex; gap: 6px; align-items: stretch; }
        .dt-rng-row input.dt-mms { flex: 1 1 0; width: 100% !important; min-width: 0 !important; box-sizing: border-box; padding: 6px 4px;
            text-align: center; font-size: 0.84em; background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid var(--dt-border);
            border-radius: 6px; font-variant-numeric: tabular-nums; }
        .dt-rng-row input.dt-mms::placeholder { opacity: 0.4; font-variant-numeric: normal; }
        .dt-rng-row input.dt-mms:focus { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--dt-label-fg) 35%, transparent); }
        .dt-rng-adv-btn { flex: 0 0 auto; width: 30px; padding: 0; font-size: 0.9em; background: var(--dt-button-bg); color: var(--dt-fg);
            border: 1px solid var(--dt-border); border-radius: 6px; cursor: pointer; opacity: 0.65; }
        .dt-rng-adv-btn:hover, .dt-rng-adv-btn.active { opacity: 1; color: var(--dt-label-fg); border-color: var(--dt-label-fg); }
        .dt-rng-adv { margin-top: 6px; }
        .dt-rng-adv[hidden] { display: none; }
        .dt-rng-adv input { width: 100% !important; box-sizing: border-box; padding: 6px 8px; font-size: 0.82em;
            background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid var(--dt-border); border-radius: 6px; }
        /* Combo-count estimate line. */
        .dt-est { text-align: center; padding: 7px; margin: 8px 0; border-radius: 8px; background: var(--dt-field-bg);
            border: 1px solid var(--dt-border); font-size: 0.84em; }
        .dt-est strong { color: var(--dt-label-fg); }
        .dt-est.warn { border-color: #e0a23b; } .dt-est.warn::after { content: ' — large run'; color: #e0a23b; }
        .dt-est.bad { color: var(--dt-danger); border-color: var(--dt-danger); }
        /* Results: toolbar + best card. */
        .dt-res-toolbar { display: flex; flex-wrap: wrap; gap: 14px; margin: 4px 0 10px; }
        .dt-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 0.82em; cursor: pointer; user-select: none; }
        .dt-toggle input { accent-color: var(--dt-label-fg); cursor: pointer; }
        .dt-res-best { border: 1px solid var(--dt-label-fg); border-radius: 10px; padding: 11px 12px; margin-bottom: 12px;
            background: var(--dt-field-bg); }
        .dt-res-best-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; }
        .dt-res-best-tag { font-weight: 800; color: var(--dt-label-fg); font-size: 0.92em; }
        .dt-res-best-score { font-weight: 800; font-variant-numeric: tabular-nums; opacity: 0.85; }
        .dt-res-verdict { font-size: 0.8em; line-height: 1.45; opacity: 0.9; margin-bottom: 10px; }
        .dt-res-best-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 10px; }
        .dt-res-best-stats span { display: flex; flex-direction: column; align-items: center; gap: 2px; background: var(--dt-bg);
            border-radius: 7px; padding: 6px 2px; }
        .dt-res-best-stats b { font-size: 0.95em; font-weight: 800; font-variant-numeric: tabular-nums; }
        .dt-res-best-stats i { font-size: 0.6em; opacity: 0.6; font-style: normal; text-transform: uppercase; letter-spacing: 0.03em; }
        .dt-results td.dt-cell-good { background: rgba(46, 204, 113, 0.22); }
        .dt-results td.dt-cell-mid { background: rgba(230, 200, 80, 0.16); }
        .dt-results td.dt-cell-bad { background: rgba(225, 70, 80, 0.22); }
        /* Terms search. */
        .dt-terms-search { width: 100% !important; box-sizing: border-box; margin: 0 0 10px; padding: 8px 11px; border-radius: 8px;
            background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid var(--dt-border); font-size: 0.85em; }
        .dt-terms-search:focus { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--dt-label-fg) 35%, transparent); }
        .dt-terms-empty { opacity: 0.55; font-style: italic; font-size: 0.8em; padding: 10px 2px; }
    `;

    /* ============================================================
       BLEND REDESIGN CSS — beginner-first "Coach" layout + terminal
       risk bars, for the dice/limbo Advanced-IOW tabs (calc/opt/results).
       Injected LAST (see injectUI) so it layers cleanly over base CSS +
       DT_EXTRA_CSS. Everything is scoped to #${PANEL_ID} and built on the
       existing theme vars, so all three themes keep working.
       ============================================================ */
    const DT_BLEND_CSS = `
        /* Layout: even spacing between a tab's blocks; comfortable body padding. */
        #${PANEL_ID} .dt-body { padding: 15px; }
        #${PANEL_ID} .dt-panel.active { display: flex; flex-direction: column; gap: 13px; }
        #${PANEL_ID} .dt-title { font-family: inherit; font-style: normal; font-weight: 800; text-decoration: none; letter-spacing: .02em; font-size: 15px; color: var(--dt-fg); }

        /* Card primitive */
        #${PANEL_ID} .dt-card { background: color-mix(in srgb, var(--dt-bg) 82%, white 4%); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); border-radius: 13px; padding: 14px; }
        #${PANEL_ID} .dt-card-title { font-family: inherit; font-style: normal; font-weight: 800; text-decoration: none; letter-spacing: .02em; font-size: 13.5px; margin: 0; display: flex; align-items: center; gap: 8px; }
        #${PANEL_ID} .dt-card-sub { font-size: 11.5px; color: color-mix(in srgb, var(--dt-fg) 55%, transparent); line-height: 1.45; margin: 3px 0 11px; }
        #${PANEL_ID} .dt-opt-tag { font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 50%, transparent); border: 1px solid color-mix(in srgb, var(--dt-border) 24%, transparent); border-radius: 20px; padding: 2px 8px; }

        /* Guided step rail: Find -> Pick -> Use (reuses .dt-step[data-step]) */
        #${PANEL_ID} .dt-steps { display: flex; align-items: center; gap: 0; margin: 0; }
        #${PANEL_ID} .dt-step { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 0; background: none; border: none; color: var(--dt-fg); cursor: pointer; font-family: inherit; }
        #${PANEL_ID} .dt-step + .dt-step { flex: 1; }
        #${PANEL_ID} .dt-step::before { content: ""; flex: 1; height: 2px; background: color-mix(in srgb, var(--dt-border) 22%, transparent); border-radius: 2px; margin: 0 9px; }
        #${PANEL_ID} .dt-step:first-child::before { display: none; }
        #${PANEL_ID} .dt-step::after { content: none; } /* neutralize the legacy DT_EXTRA_CSS absolute connector line */
        #${PANEL_ID} .dt-step.done::before, #${PANEL_ID} .dt-step.active::before { background: var(--dt-label-fg); }
        #${PANEL_ID} .dt-step-dot { width: 24px; height: 24px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 11px; font-weight: 800; background: var(--dt-field-bg); border: 1.5px solid color-mix(in srgb, var(--dt-border) 30%, transparent); color: color-mix(in srgb, var(--dt-fg) 55%, transparent); transition: all .14s; }
        #${PANEL_ID} .dt-step-name { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 38%, transparent); }
        #${PANEL_ID} .dt-step.done .dt-step-dot { background: color-mix(in srgb, var(--dt-label-fg) 22%, var(--dt-field-bg)); border-color: var(--dt-label-fg); color: var(--dt-label-fg); }
        #${PANEL_ID} .dt-step.done .dt-step-name { color: color-mix(in srgb, var(--dt-fg) 60%, transparent); }
        #${PANEL_ID} .dt-step.active .dt-step-dot { background: var(--dt-label-fg); border-color: var(--dt-label-fg); color: var(--dt-bg); box-shadow: 0 0 0 4px color-mix(in srgb, var(--dt-label-fg) 18%, transparent); }
        #${PANEL_ID} .dt-step.active .dt-step-name { color: var(--dt-label-fg); }

        /* One-line "what to do now" coach line */
        #${PANEL_ID} .dt-coach { font-size: 12.5px; color: color-mix(in srgb, var(--dt-fg) 62%, transparent); line-height: 1.45; margin: -2px 2px 0; }
        #${PANEL_ID} .dt-coach b { color: var(--dt-fg); font-weight: 700; }

        /* Hero output tiles — the numbers you paste into the game */
        #${PANEL_ID} .dt-heroes { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
        #${PANEL_ID} .dt-hero { position: relative; background: linear-gradient(160deg, color-mix(in srgb, var(--dt-label-fg) 14%, var(--dt-field-bg)), var(--dt-field-bg)); border: 1px solid color-mix(in srgb, var(--dt-label-fg) 32%, transparent); border-radius: 12px; padding: 13px 14px; }
        #${PANEL_ID} .dt-hero-k { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--dt-label-fg); font-weight: 700; display: flex; align-items: center; gap: 5px; }
        #${PANEL_ID} .dt-hero-row { display: flex; align-items: baseline; gap: 2px; margin-top: 5px; }
        #${PANEL_ID} .dt-hero-cur { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 18px; font-weight: 700; color: color-mix(in srgb, var(--dt-fg) 70%, transparent); }
        #${PANEL_ID} .dt-hero .dt-out-val { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 26px; font-weight: 700; color: var(--dt-fg); background: transparent; border: none; padding: 0; width: 100%; letter-spacing: -.02em; }
        #${PANEL_ID} .dt-hero .dt-copy { position: absolute; top: 10px; right: 10px; }
        #${PANEL_ID} .dt-subout { display: grid; grid-template-columns: 1fr 1fr; gap: 11px; }
        #${PANEL_ID} .dt-so { position: relative; background: var(--dt-field-bg); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); border-radius: 10px; padding: 9px 12px; }
        #${PANEL_ID} .dt-so-k { font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 52%, transparent); display: flex; align-items: center; gap: 5px; }
        #${PANEL_ID} .dt-so .dt-out-val { font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 16px; font-weight: 700; color: var(--dt-fg); background: transparent; border: none; padding: 0; width: 100%; margin-top: 2px; }
        #${PANEL_ID} .dt-so .dt-copy { position: absolute; top: 7px; right: 7px; }
        #${PANEL_ID} .dt-out-val:focus { outline: none; }

        /* Copy buttons */
        #${PANEL_ID} .dt-copy { padding: 3px 8px; font-size: 11px; line-height: 1.4; min-height: 0; border-radius: 7px; background: color-mix(in srgb, var(--dt-bg) 60%, black 40%); border: 1px solid color-mix(in srgb, var(--dt-border) 28%, transparent); color: color-mix(in srgb, var(--dt-fg) 70%, transparent); cursor: pointer; }
        #${PANEL_ID} .dt-copy:hover { color: var(--dt-label-fg); border-color: var(--dt-label-fg); }
        #${PANEL_ID} .dt-copied { background: var(--dt-progress) !important; color: #03171a !important; border-color: var(--dt-progress) !important; }

        /* Big primary action buttons */
        #${PANEL_ID} .dt-go { width: 100%; font-weight: 800; }
        #${PANEL_ID} .dt-go-big { padding: 14px !important; font-size: 15px; } /* !important beats legacy .dt-go padding:10px!important */

        /* Input rows: label (+ optional hint) on the left, control on the right */
        #${PANEL_ID} .dt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 13%, transparent); }
        #${PANEL_ID} .dt-row:last-child { border-bottom: none; }
        #${PANEL_ID} .dt-row-label { flex: 1 1 auto; min-width: 0; font-size: 12.5px; font-weight: 600; color: color-mix(in srgb, var(--dt-fg) 92%, transparent); display: flex; flex-direction: column; align-items: flex-start; gap: 1px; }
        #${PANEL_ID} .dt-rl-nm { display: flex; align-items: center; gap: 6px; }
        #${PANEL_ID} .dt-row-hint { font-size: 10.5px; font-weight: 500; color: color-mix(in srgb, var(--dt-fg) 38%, transparent); }
        #${PANEL_ID} .dt-row-ctrl { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; }
        #${PANEL_ID} input.dt-in { width: 104px; text-align: right; background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid color-mix(in srgb, var(--dt-border) 26%, transparent); border-radius: 8px; padding: 8px 10px; font-family: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace; font-size: 13px; }
        #${PANEL_ID} input.dt-in:focus { outline: none; border-color: var(--dt-label-fg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dt-label-fg) 22%, transparent); }
        #${PANEL_ID} input.dt-in.dt-invalid { border-color: var(--dt-danger) !important; box-shadow: 0 0 0 1px var(--dt-danger); }

        /* Optimizer preset cards — wide, tappable, vertical list */
        #${PANEL_ID} .dt-preset-grid { display: flex; flex-direction: column; gap: 9px; margin: 2px 0 4px; }
        #${PANEL_ID} .dt-preset { display: flex; align-items: center; gap: 13px; text-align: left; background: var(--dt-field-bg); border: 1px solid color-mix(in srgb, var(--dt-border) 20%, transparent); border-radius: 12px; padding: 12px 14px; cursor: pointer; position: relative; color: var(--dt-fg); font-family: inherit; }
        #${PANEL_ID} .dt-preset:hover { border-color: var(--dt-label-fg); }
        #${PANEL_ID} .dt-preset-ic { font-size: 21px; flex: 0 0 auto; width: 28px; text-align: center; }
        #${PANEL_ID} .dt-preset-name { font-size: 14px; font-weight: 800; display: block; }
        #${PANEL_ID} .dt-preset-desc { font-size: 11.5px; color: color-mix(in srgb, var(--dt-fg) 52%, transparent); display: block; margin-top: 1px; }
        #${PANEL_ID} .dt-preset.active { border-color: var(--dt-label-fg); background: color-mix(in srgb, var(--dt-label-fg) 12%, var(--dt-field-bg)); box-shadow: inset 0 0 0 1px var(--dt-label-fg); }
        #${PANEL_ID} .dt-preset-rec { position: absolute; top: -9px; right: 14px; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; background: var(--dt-label-fg); color: var(--dt-bg); padding: 2px 8px; border-radius: 20px; }

        /* Combo estimate */
        #${PANEL_ID} .dt-est { text-align: center; padding: 9px; border-radius: 8px; background: var(--dt-field-bg); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); font-size: 12px; font-family: ui-monospace, monospace; margin-bottom: 10px; }
        #${PANEL_ID} .dt-est b { color: var(--dt-label-fg); }
        #${PANEL_ID} .dt-est.warn { border-color: #e0a23b; } #${PANEL_ID} .dt-est.bad { color: var(--dt-danger); border-color: var(--dt-danger); }

        /* Progress + status */
        #${PANEL_ID} .dt-progress-wrap { height: 7px; border-radius: 6px; background: var(--dt-field-bg); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); overflow: hidden; margin: 10px 0 7px; }
        #${PANEL_ID} .dt-progress-bar { height: 100%; width: 0; background: linear-gradient(90deg, var(--dt-label-fg), var(--dt-progress)); transition: width .2s; }
        #${PANEL_ID} .dt-status-line { font-size: 11px; color: color-mix(in srgb, var(--dt-fg) 55%, transparent); text-align: center; font-family: ui-monospace, monospace; }

        /* Next-step CTA */
        #${PANEL_ID} .dt-next { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; margin-top: 11px; padding: 12px; border-radius: 9px; cursor: pointer; font-weight: 800; font-size: 13px; background: var(--dt-label-fg); color: var(--dt-bg); border: none; font-family: inherit; }
        #${PANEL_ID} .dt-next[disabled] { background: var(--dt-field-bg); color: color-mix(in srgb, var(--dt-fg) 55%, transparent); opacity: .6; cursor: default; border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); }

        /* Scroll regions + sim stats table */
        #${PANEL_ID} .dt-scroll { max-height: 42vh; overflow-y: auto; border: 1px solid color-mix(in srgb, var(--dt-border) 14%, transparent); border-radius: 9px; }
        #${PANEL_ID} table.dt-stats { width: 100%; border-collapse: collapse; font-size: 12px; }
        #${PANEL_ID} table.dt-stats td { padding: 8px 11px; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 11%, transparent); }
        #${PANEL_ID} table.dt-stats td:last-child { text-align: right; font-family: ui-monospace, monospace; font-weight: 700; color: var(--dt-fg); }
        #${PANEL_ID} table.dt-stats td:first-child { color: color-mix(in srgb, var(--dt-fg) 65%, transparent); }
        #${PANEL_ID} table.dt-stats tr:last-child td { border-bottom: none; }

        /* Results: toolbar + table + risk bars */
        #${PANEL_ID} .dt-res-toolbar { display: flex; flex-wrap: wrap; gap: 14px; margin: 2px 0 10px; }
        #${PANEL_ID} .dt-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: color-mix(in srgb, var(--dt-fg) 65%, transparent); cursor: pointer; user-select: none; }
        #${PANEL_ID} .dt-toggle input { accent-color: var(--dt-label-fg); cursor: pointer; }
        #${PANEL_ID} table.dt-results { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        #${PANEL_ID} table.dt-results th { position: sticky; top: 0; background: color-mix(in srgb, var(--dt-bg) 92%, black 8%); font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 55%, transparent); text-align: right; padding: 8px; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 24%, transparent); font-weight: 700; cursor: pointer; white-space: nowrap; }
        #${PANEL_ID} table.dt-results th:first-child, #${PANEL_ID} table.dt-results td:first-child { text-align: left; }
        #${PANEL_ID} table.dt-results td { padding: 7px 8px; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 10%, transparent); font-family: ui-monospace, monospace; text-align: right; color: color-mix(in srgb, var(--dt-fg) 88%, transparent); white-space: nowrap; }
        #${PANEL_ID} table.dt-results tr { cursor: pointer; }
        #${PANEL_ID} table.dt-results tr:hover td { background: color-mix(in srgb, var(--dt-label-fg) 6%, transparent); }
        #${PANEL_ID} table.dt-results tr.selected td { background: color-mix(in srgb, var(--dt-label-fg) 16%, transparent); box-shadow: inset 2px 0 0 var(--dt-label-fg); }
        #${PANEL_ID} td.dt-cell-good { color: var(--dt-progress) !important; background: transparent !important; }
        #${PANEL_ID} td.dt-cell-mid { color: #e6c850 !important; background: transparent !important; }
        #${PANEL_ID} td.dt-cell-bad { color: var(--dt-danger) !important; background: transparent !important; }
        #${PANEL_ID} .dt-riskbar { display: inline-block; height: 7px; border-radius: 2px; vertical-align: middle; margin-right: 6px; min-width: 3px; }
        #${PANEL_ID} .dt-riskbar.good { background: var(--dt-progress); } #${PANEL_ID} .dt-riskbar.mid { background: #e6c850; } #${PANEL_ID} .dt-riskbar.bad { background: var(--dt-danger); }

        /* Recommended-setup card (built by renderBestCard) */
        #${PANEL_ID} .dt-res-best { background: linear-gradient(165deg, color-mix(in srgb, var(--dt-label-fg) 16%, var(--dt-bg)), var(--dt-bg)); border: 1px solid var(--dt-label-fg); border-radius: 14px; padding: 15px; }
        #${PANEL_ID} .dt-rb-tag { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: var(--dt-label-fg); display: flex; align-items: center; gap: 7px; }
        #${PANEL_ID} .dt-rb-verdict { font-size: 13px; line-height: 1.5; color: color-mix(in srgb, var(--dt-fg) 92%, transparent); margin: 9px 0 13px; }
        #${PANEL_ID} .dt-rb-verdict b { color: var(--dt-fg); }
        #${PANEL_ID} .dt-rb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9px; margin-bottom: 13px; }
        #${PANEL_ID} .dt-rb-stat { background: color-mix(in srgb, var(--dt-bg) 70%, black 30%); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); border-radius: 9px; padding: 9px 4px; text-align: center; }
        #${PANEL_ID} .dt-rb-stat b { display: block; font-family: ui-monospace, monospace; font-size: 17px; font-weight: 700; color: var(--dt-fg); }
        #${PANEL_ID} .dt-rb-stat i { display: block; font-size: 8.5px; letter-spacing: .05em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 52%, transparent); font-style: normal; margin-top: 3px; }
        #${PANEL_ID} .dt-rb-stat.good b { color: var(--dt-progress); }
        #${PANEL_ID} .dt-rb-stat.bad b { color: var(--dt-danger); }

        /* Settings tab — clean rows + themed controls, consistent with the blend. */
        #${PANEL_ID} .dt-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 0; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 13%, transparent); }
        #${PANEL_ID} .dt-setting-row:last-child { border-bottom: none; }
        #${PANEL_ID} .dt-setting-label { font-size: 12.5px; font-weight: 600; color: color-mix(in srgb, var(--dt-fg) 92%, transparent); }
        #${PANEL_ID} .dt-setting-desc { font-size: 10.5px; color: color-mix(in srgb, var(--dt-fg) 42%, transparent); margin-top: 1px; line-height: 1.35; }
        #${PANEL_ID} select.dt-theme-select, #${PANEL_ID} input.dt-num-input { background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid color-mix(in srgb, var(--dt-border) 26%, transparent); border-radius: 8px; padding: 7px 9px; font-size: 12.5px; font-family: inherit; }
        #${PANEL_ID} input.dt-num-input { width: 72px; text-align: right; font-family: ui-monospace, "SF Mono", Consolas, monospace; }
        #${PANEL_ID} select.dt-theme-select:focus, #${PANEL_ID} input.dt-num-input:focus { outline: none; border-color: var(--dt-label-fg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dt-label-fg) 22%, transparent); }

        /* Optimizer — clean aligned layout: compact scalar row, then one grid
           with a single From/To/Step/Values caption row (no repeated sublabels). */
        #${PANEL_ID} .dt-opt-scalars { display: flex; align-items: center; gap: 10px 26px; flex-wrap: wrap; margin-bottom: 4px; }
        #${PANEL_ID} .dt-opt-scalars .dt-in { width: 88px; padding: 6px 9px; }
        #${PANEL_ID} .dt-opt-tablewrap { overflow-x: auto; }
        #${PANEL_ID} .dt-opt-table { display: grid; grid-template-columns: 176px 74px 14px 74px 64px 220px; gap: 8px 6px; align-items: center; margin-top: 14px; justify-content: start; }
        #${PANEL_ID} .dt-opt-table .dt-lbl { display: flex; align-items: center; }
        #${PANEL_ID} .dt-opt-table .dt-in { width: 100%; min-width: 0; padding: 6px 8px; font-size: 12.5px; }
        #${PANEL_ID} .dt-opt-table .dt-values-in { text-align: left; }
        #${PANEL_ID} .dt-opt-cap { font-size: 9.5px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 42%, transparent); text-align: center; padding-bottom: 1px; }
        #${PANEL_ID} .dt-opt-cap.values { text-align: left; padding-left: 4px; }
        #${PANEL_ID} .dt-opt-dash { text-align: center; color: color-mix(in srgb, var(--dt-fg) 38%, transparent); font-weight: 600; }

        /* Easy Mode tab */
        #${PANEL_ID} .dt-easy-grid { display: grid; grid-template-columns: auto 1fr; gap: 9px 12px; align-items: center; }
        #${PANEL_ID} .dt-easy-cell { display: flex; align-items: center; gap: 6px; }
        /* Was 86px, sized to leave room for the old "Any" button beside it. With
           the button gone the field takes that space, which the "e.g. 2.00"
           placeholder needs to read in full. */
        #${PANEL_ID} .dt-easy-cell .dt-in { width: 114px; }
        #${PANEL_ID} .dt-easy-meta { display: flex; align-items: center; gap: 10px; margin-top: 11px; flex-wrap: wrap; }
        #${PANEL_ID} .dt-easy-val { font-family: ui-monospace, monospace; color: var(--dt-label-fg); font-weight: 700; }
        #${PANEL_ID} .dt-easy-status { font-size: 11px; font-style: italic; color: color-mix(in srgb, var(--dt-fg) 55%, transparent); }
        #${PANEL_ID} .dt-easy-scroll { flex: 1; }

        /* ===== Extend downward: on the working tabs, the STANDALONE floating
           panel anchors near the top and uses more vertical space (less scrolling).
           Settings keeps the original centered size. No effect when the panel is
           stitched into the IOW HUD (there it is position:static and the HUD's own
           height governs — see the stitched-height rule below). ===== */
        #${PANEL_ID}[data-active-tab="calc"],
        #${PANEL_ID}[data-active-tab="easy"],
        #${PANEL_ID}[data-active-tab="opt"],
        #${PANEL_ID}[data-active-tab="results"] {
            top: 4vh; height: 92vh; max-height: none; transform: translate(120%, 0);
        }
        #${PANEL_ID}.show[data-active-tab="calc"],
        #${PANEL_ID}.show[data-active-tab="easy"],
        #${PANEL_ID}.show[data-active-tab="opt"],
        #${PANEL_ID}.show[data-active-tab="results"] {
            transform: translate(0, 0);
        }
    `;

    /* =========================================================
       DOM BUILDER — inject button + panel into page body
       ========================================================= */
    function injectUI() {
        // Inject styles
        const style = document.createElement('style');
        style.id = 'dt-aio-styles';
        style.textContent = CSS + DT_EXTRA_CSS + DT_BLEND_CSS;
        document.head.appendChild(style);

        // Toggle button
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.innerHTML = '🎲';
        btn.setAttribute('aria-label', 'Open Dice Tools');
        document.body.appendChild(btn);

        // Backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'dt-backdrop';
        document.body.appendChild(backdrop);

        // Toast container
        const toastEl = document.createElement('div');
        toastEl.id = 'dt-toast';
        document.body.appendChild(toastEl);
        toastEl.id = 'dt-toast';

        // Tooltip popover
        const tt = document.createElement('div');
        tt.id = 'dt-tooltip';
        document.body.appendChild(tt);

        // Streak counter HUD (hidden until applyStateToUI runs)
        buildCounterHUD();

        // Panel
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.setAttribute('data-active-tab', 'calc'); // initial tab; drives extend-downward sizing
        panel.innerHTML = `
            <div class="dt-head" data-drag-handle="true">
              <h2 class="dt-title">🎲 Dice &amp; Limbo</h2>
              <button class="dt-close" id="dt-close-btn" aria-label="Close">×</button>
            </div>
            <nav class="dt-tabs" role="tablist">
              <!-- Only two tabs are exposed. "Play" (data-tab="stats") is created at
                   runtime by the site integration and inserts itself ahead of this
                   button. The Calculator / Strategy Finder / Results / Settings panels
                   are still built into .dt-body below — Build Strategy and calcValues()
                   read and write their fields — they just have no tab button now. -->
              <button class="dt-tab-btn active" data-tab="easy">Find New Strategy</button>
            </nav>
            <div class="dt-body">
              ${buildCalcPanel()}
              ${buildEasyPanel()}
              ${buildOptPanel()}
              ${buildResultsPanel()}
              ${buildSettingsPanel()}
            </div>
        `;
        document.body.appendChild(panel);
    }

    /* ---- Helper: field with ? tooltip ----
       Uses <span class="dt-label"> instead of <label> for consistency with
       the mobile AIO (where nested <button> + <label> broke tooltips on iOS). */
    function helpBtn(label) {
        const gl = GLOSSARY[label];
        return gl ? `<button type="button" class="dt-help" data-tooltip="${label}" aria-label="Help about ${label}">?</button>` : '';
    }
    /* Legacy field helpers (kept for any other callers). */
    function fieldHTML(label, id, value, type = 'text', inputmode = 'decimal') {
        return `
          <div class="dt-field">
            <span class="dt-label">${label}${helpBtn(label)}</span>
            <input type="${type}" inputmode="${inputmode}" id="dt-${id}" value="${value}">
          </div>`;
    }
    function fieldWideHTML(label, id, value) {
        return `
          <div class="dt-field dt-field-wide">
            <span class="dt-label">${label}${helpBtn(label)}</span>
            <input type="text" id="dt-${id}" class="dt-text-input" value="${value}">
          </div>`;
    }

    /* === CLEAN ROW PRIMITIVES ===
       One consistent "Label .......... [control]" row, used across every tab.
       Help (?) keys off `term` so glossary tooltips still resolve. */
    function rowInputHTML(label, term, id, value, inputmode, hint) {
        const hintHTML = hint ? `<span class="dt-row-hint">${hint}</span>` : '';
        return `
          <div class="dt-row">
            <span class="dt-row-label"><span class="dt-rl-nm">${label}${helpBtn(term || label)}</span>${hintHTML}</span>
            <span class="dt-row-ctrl"><input type="text" inputmode="${inputmode || 'decimal'}" class="dt-in" id="dt-${id}" value="${value}"></span>
          </div>`;
    }
    /* Read-only result row: label on the left, big value + copy on the right.
       `key` = the headline numbers you paste into the game (accent colored). */
    function rowOutHTML(label, term, outId, key) {
        return `
          <div class="dt-row dt-row-out${key ? ' dt-row-key' : ''}">
            <span class="dt-row-label">${label}${helpBtn(term || label)}</span>
            <span class="dt-row-ctrl">
              <input type="text" class="dt-out-val" id="dt-${outId}" readonly>
              <button class="dt-btn dt-btn-small dt-copy" data-copy="${outId}" title="Copy ${label}">⧉</button>
            </span>
          </div>`;
    }
    /* Hero output tile — the headline numbers you paste into the game (big, mono).
       `cur` is an optional currency prefix shown before the value (display only;
       the copy button still copies the raw value). */
    function heroOutHTML(label, term, outId, cur) {
        return `
          <div class="dt-hero">
            <button class="dt-copy" data-copy="${outId}" title="Copy ${label}">⧉</button>
            <span class="dt-hero-k">${label}${helpBtn(term || label)}</span>
            <div class="dt-hero-row">${cur ? `<span class="dt-hero-cur">${cur}</span>` : ''}<input type="text" class="dt-out-val" id="dt-${outId}" readonly></div>
          </div>`;
    }
    /* Secondary output tile — smaller supporting values. */
    function subOutHTML(label, term, outId) {
        return `
          <div class="dt-so">
            <button class="dt-copy" data-copy="${outId}" title="Copy ${label}">⧉</button>
            <span class="dt-so-k">${label}${helpBtn(term || label)}</span>
            <input type="text" class="dt-out-val" id="dt-${outId}" readonly>
          </div>`;
    }
    /* Optimizer range row: name + live "expands to" preview, then min/max/step
       + a ⌨ toggle that reveals the raw range-syntax field. The syntax field stays
       the source of truth (still accepts lists like 25,30,40). */
    function rangeGroupHTML(label, id, value, hint, term) {
        const hintHTML = hint ? `<div class="dt-hint" style="margin-top:4px;">${hint}</div>` : '';
        return `
          <div class="dt-rng">
            <div class="dt-rng-head">
              <span class="dt-rng-name">${label}${helpBtn(term || label)}</span>
              <span class="dt-rng-prev" id="dt-prev_${id}"></span>
            </div>
            <div class="dt-rng-row">
              <input type="text" inputmode="decimal" class="dt-mms" id="dt-mms_${id}_min" placeholder="min" aria-label="${label} minimum">
              <input type="text" inputmode="decimal" class="dt-mms" id="dt-mms_${id}_max" placeholder="max" aria-label="${label} maximum">
              <input type="text" inputmode="decimal" class="dt-mms" id="dt-mms_${id}_step" placeholder="step" aria-label="${label} step">
              <button type="button" class="dt-rng-adv-btn" data-advtoggle="${id}" title="Type a custom range or list (e.g. 25,30,40)" aria-label="Custom entry">⌨</button>
            </div>
            <div class="dt-rng-adv" id="dt-adv_${id}" hidden>
              <input type="text" id="dt-${id}" value="${value}">
              ${hintHTML}
            </div>
          </div>`;
    }
    /* Guided workflow rail. `active` = 1 (Find) | 2 (Pick) | 3 (Use), mapping to
       Optimizer -> Results -> Calculator. Each step jumps to its tab via switchTab;
       done-state is refreshed by updateStepper() from real engine state. */
    const STEP_TABS = { 1: 'opt', 2: 'results', 3: 'calc' };
    function stepperHTML(active) {
        const steps = [[1, 'Find'], [2, 'Pick'], [3, 'Use']];
        return `<div class="dt-steps">` + steps.map(([n, name]) =>
            `<button type="button" class="dt-step${n === active ? ' active' : ''}" data-step="${n}">
               <span class="dt-step-dot">${n}</span><span class="dt-step-name">${name}</span>
             </button>`).join('') + `</div>`;
    }
    /* Exact DiceTool.exe layout: Calculated Values | Parameters side by side
       (Simulation Controls under Parameters), Simulation Results treeview
       below. Element IDs are unchanged so all existing wiring still lands. */
    function buildCalcPanel() {
        const cvRow = (label, outId, hidden) => `
              <div class="dt-cv-row"${hidden ? ' hidden' : ''}>
                <span class="dt-lbl">${label}</span>
                <input type="text" class="dt-out-val dt-entry" id="dt-${outId}" readonly>
                <button class="dt-btn dt-btn-copy" data-copy="${outId}">Copy</button>
              </div>`;
        const pmCell = (label, id, value, inputmode) => `
                  <span class="dt-lbl">${label}</span>
                  <input type="text" inputmode="${inputmode || 'decimal'}" class="dt-in dt-entry" id="dt-${id}" value="${value}">`;
        return `
          <section class="dt-panel" id="dt-panel-calc">
            <div class="dt-calc-grid">
              <div class="dt-card dt-lf">
                <div class="dt-card-title">Calculated Values</div>
                ${cvRow('Multiplier:', 'out_mult')}
                ${cvRow('Bet Size:', 'out_bet')}
                ${cvRow('Balance Target:', 'out_target')}
                ${cvRow('Profit Stop:', 'out_profit', true)}
              </div>
              <div class="dt-calc-right">
                <div class="dt-card dt-lf">
                  <div class="dt-card-title">Parameters</div>
                  <div class="dt-pm-grid">
                    ${pmCell('Balance:', 'balance', '20')}
                    ${pmCell('Balance Divisor:', 'bet_div', '500')}
                    ${pmCell('Win Increase %:', 'win_inc', '78')}
                    ${pmCell('Profit Multiplier:', 'profit_mult', '100')}
                    ${pmCell('Loss Reset:', 'loss_reset', '5', 'numeric')}
                    ${pmCell('Buffer %:', 'buffer', '25')}
                  </div>
                  <div class="dt-pm-btns">
                    <button class="dt-btn" id="dt-game_sync">Send To Game</button>
                    <button class="dt-btn" id="dt-game_import">Create Strategy</button>
                  </div>
                </div>
                <div class="dt-card dt-lf">
                  <div class="dt-card-title">Simulation Controls</div>
                  <div class="dt-ctl-row">
                    <button class="dt-btn" id="dt-sim_run">Run Simulation</button>
                    <span class="dt-lbl">Trials:</span>
                    <input type="text" inputmode="numeric" class="dt-in dt-entry" id="dt-n_trials" value="100">
                  </div>
                  <div class="dt-ctl-row">
                    <button class="dt-btn" id="dt-sim_stop" disabled>Stop</button>
                    <div class="dt-progress-wrap"><div class="dt-progress-bar" id="dt-sim_progress"></div></div>
                  </div>
                  <div class="dt-status-line" id="dt-sim_status">Idle</div>
                </div>
              </div>
            </div>
            <div class="dt-card dt-lf dt-lf-grow">
              <div class="dt-card-title">Simulation Results</div>
              <div class="dt-scroll">
                <table class="dt-stats" id="dt-sim_results">
                  <thead><tr><th>Statistic</th><th>Value</th></tr></thead>
                  <tbody>
                    <tr><td colspan="2" class="dt-empty">Run a simulation to populate results.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        `;
    }

    /* ---- Tab: Optimizer — mirrors the desktop tool's structured inputs:
       each range row is [From] - [To] with its own Step, plus a Values field
       for individual comma-separated numbers. Range and Values merge into
       one de-duplicated list; either part may be left blank. Run Optimizer
       inside bottom-left, then progress, centered status, and
       Clear Results / Stop on the bottom row. ---- */
    function buildOptPanel() {
        const scalar = (label, id, value) => `
                <span class="dt-lbl">${label}${helpBtn(label)}</span>
                <input type="text" class="dt-in dt-entry" id="dt-${id}" value="${value}">`;
        const rangeRow = (label, id, frm, to, step, values) => `
              <span class="dt-lbl">${label}${helpBtn(label)}</span>
              <input type="text" inputmode="decimal" class="dt-in dt-entry" id="dt-${id}_from" value="${frm}" aria-label="${label} from">
              <span class="dt-opt-dash">&ndash;</span>
              <input type="text" inputmode="decimal" class="dt-in dt-entry" id="dt-${id}_to" value="${to}" aria-label="${label} to">
              <input type="text" inputmode="decimal" class="dt-in dt-entry" id="dt-${id}_step" value="${step}" aria-label="${label} step">
              <input type="text" inputmode="decimal" class="dt-in dt-entry dt-values-in" id="dt-${id}_values" value="${values}" placeholder="e.g. 25,30,40" aria-label="${label} values">`;
        return `
          <section class="dt-panel" id="dt-panel-opt">
            <div class="dt-card dt-lf">
              <div class="dt-card-title">Parameter Ranges</div>
              <div class="dt-opt-scalars">
                ${scalar('Starting Balance', 'opt_balance', '20')}
                ${scalar('Trials per Combo', 'opt_trials', '10')}
              </div>
              <div class="dt-opt-tablewrap">
                <div class="dt-opt-table">
                  <span></span><span class="dt-opt-cap">From</span><span></span><span class="dt-opt-cap">To</span><span class="dt-opt-cap">Step</span><span class="dt-opt-cap values">Values</span>
                  ${rangeRow('Bet Divisor Range', 'opt_betdiv', '', '', '', '256,500')}
                  ${rangeRow('Profit Multiplier Range', 'opt_profit', '', '', '', '50,100')}
                  ${rangeRow('Win Increase % Range', 'opt_w', '50', '100', '5', '')}
                  ${rangeRow('Loss Reset (whole)', 'opt_l', '3', '5', '1', '')}
                  ${rangeRow('Buffer % Range', 'opt_buf', '', '', '', '25,30,40')}
                </div>
              </div>
              <div class="dt-opt-runrow"><button class="dt-btn" id="dt-opt_run">Run Strategy Finder</button></div>
            </div>
            <div class="dt-progress-wrap"><div class="dt-progress-bar" id="dt-opt_progress"></div></div>
            <div class="dt-status-line" id="dt-opt_status">Idle</div>
            <div class="dt-opt-foot">
              <button class="dt-btn" id="dt-opt_clear">Clear Results</button>
              <button class="dt-btn" id="dt-opt_stop" disabled>Stop</button>
            </div>
          </section>
        `;
    }

    /* ---- Tab: Easy Mode — port of the desktop tool's Easy Mode tab.
       Enter a Multiplier and get every whole-number combo; Win Increase %,
       Loss Reset and Buffer % are outputs, worked out automatically so the
       multiplier is matched exactly. The Multiplier is the tab's ONLY input, so
       there is no "Any" any more — nothing would be left to sweep against. ---- */
    function buildEasyPanel() {
        return `
          <section class="dt-panel active" id="dt-panel-easy">
            <div class="dt-card dt-lf">
              <div class="dt-card-title">Desired Parameters</div>
              <div class="dt-easy-grid">
                <span class="dt-lbl">Multiplier:${helpBtn('Multiplier')}</span>
                <span class="dt-easy-cell">
                  <!-- Starts EMPTY with a prompt, not the word "Any". "Any" made
                       sense when Win Increase % was pinnable too and either box
                       could be left open to sweep; with Multiplier the only input
                       there is nothing left to sweep against, so the search needs
                       a number and the old value/reset button just advertised an
                       option that does not exist. -->
                  <input type="text" inputmode="decimal" class="dt-in dt-entry" id="dt-easy_mult" placeholder="e.g. 2.00">
                </span>
              </div>
              <div class="dt-easy-meta">
                <span class="dt-lbl">Win Chance:${helpBtn('Win Chance')}</span><span class="dt-easy-val" id="dt-easy_chance">--</span>
                <span class="dt-lbl">Combos:</span><span class="dt-easy-val" id="dt-easy_count">0</span>
                <span class="dt-easy-status" id="dt-easy_status"></span>
              </div>
            </div>
            <div class="dt-card dt-lf dt-lf-grow">
              <div class="dt-card-title">Matching Combos</div>
              <div class="dt-scroll dt-easy-scroll">
                <table class="dt-results" id="dt-easy_table">
                  <thead><tr id="dt-easy_head"></tr></thead>
                  <tbody id="dt-easy_body"></tbody>
                </table>
              </div>
              <div class="dt-res-foot">
                <button class="dt-btn" id="dt-easy_apply">Build Strategy</button>
              </div>
            </div>
          </section>
        `;
    }

    /* ---- Tab: Optimizer Results — exact DiceTool.exe layout: the full
       15-column treeview filling the tab, with Apply Selected to Calculator
       (left) and Save to CSV (right) underneath. The res_status element is
       kept hidden because renderResults() writes to it unconditionally. ---- */
    function buildResultsPanel() {
        return `
          <section class="dt-panel" id="dt-panel-results">
            <div class="dt-scroll dt-res-scroll">
              <table class="dt-results" id="dt-res_table">
                <thead><tr id="dt-res_head"></tr></thead>
                <tbody id="dt-res_body"></tbody>
              </table>
            </div>
            <div class="dt-status-line" id="dt-res_status" hidden>No results yet.</div>
            <div class="dt-res-foot">
              <button class="dt-btn" id="dt-res_apply">Apply Selected to Calculator</button>
              <button class="dt-btn" id="dt-res_csv">Save to CSV</button>
            </div>
          </section>
        `;
    }

    /* ---- Tab: Settings — exact DiceTool.exe layout: a centered, fixed-width
       column with the app's "Interface Appearance" and "Optimizer Behavior"
       LabelFrames, plus one extra "Advanced" frame (same styling) for the
       web-only controls that have no desktop-app equivalent. ---- */
    function buildSettingsPanel() {
        return `
          <section class="dt-panel" id="dt-panel-settings">
            <div class="dt-settings-center">
              <div class="dt-card dt-lf">
                <div class="dt-card-title">Interface Appearance</div>
                <div class="dt-set-row">
                  <span class="dt-lbl">Color Theme</span>
                  <select class="dt-theme-select" id="dt-theme_select">
                    <option value="original">Original</option>
                    <option value="stake">Stake</option>
                    <option value="shuffle">Shuffle</option>
                  </select>
                </div>
                <div class="dt-sep"></div>
                <div class="dt-set-row">
                  <span class="dt-lbl">Large Fonts Mode (+4pt)</span>
                  <input type="checkbox" class="dt-chk" id="dt-large_fonts">
                </div>
              </div>
              <div class="dt-card dt-lf">
                <div class="dt-card-title">Strategy Finder Behavior</div>
                <div class="dt-set-row">
                  <span class="dt-lbl">Append Results</span>
                  <input type="checkbox" class="dt-chk" id="dt-keep_prev">
                </div>
                <div class="dt-set-desc">If checked, new strategy searches will be added to the existing table instead of clearing it.</div>
              </div>
              <div class="dt-card dt-lf">
                <div class="dt-card-title">Advanced</div>
                <div class="dt-set-row">
                  <span class="dt-lbl">Worker Threads (1–8)</span>
                  <input type="number" min="1" max="8" class="dt-num-input dt-entry" id="dt-worker_count">
                </div>
                <div class="dt-sep"></div>
                <div class="dt-set-row">
                  <span class="dt-lbl">Show Streak Counter</span>
                  <input type="checkbox" class="dt-chk" id="dt-show_counter">
                </div>
                <div class="dt-sep"></div>
                <div class="dt-set-row">
                  <span class="dt-lbl">Autostop On Win Streak</span>
                  <input type="checkbox" class="dt-chk" id="dt-counter_autostop">
                </div>
                <div class="dt-sep"></div>
                <div class="dt-set-row">
                  <span class="dt-lbl">Version</span>
                  <span class="dt-set-val">Dice &amp; Limbo Tools v3.03 (Desktop)</span>
                </div>
                <button class="dt-btn dt-btn-block" id="dt-reset_state">Reset All Saved Data</button>
              </div>
            </div>
          </section>
        `;
    }


    /* =========================================================
       CALCULATOR
       ========================================================= */
    function calcValues() {
        const mark = (id, bad) => { const el = $(id); if (el) el.classList.toggle('dt-invalid', !!bad); };
        try {
            const balance = parseFloat($('balance').value);
            const w = parseFloat($('win_inc').value) / 100;
            const l = parseInt($('loss_reset').value);
            const bet_div = parseFloat($('bet_div').value);
            const profit_mult = parseFloat($('profit_mult').value);
            const buffer = 1 + parseFloat($('buffer').value) / 100;
            mark('balance', !Number.isFinite(balance));
            mark('win_inc', !Number.isFinite(w));
            mark('loss_reset', !Number.isFinite(l));
            mark('bet_div', !Number.isFinite(bet_div) || bet_div === 0);
            mark('profit_mult', !Number.isFinite(profit_mult));
            mark('buffer', !Number.isFinite(buffer));
            if (![balance, w, bet_div, profit_mult, buffer].every(isFinite) || !Number.isFinite(l) || bet_div === 0) throw 0;
            const m = ((1 + w) * l) * buffer;
            const bet_size = balance / bet_div;
            const profit_stop = bet_size * profit_mult;
            const target = balance + profit_stop;
            // Nuts is denominated in SOL (8dp): 4dp/2dp rounds real amounts to a
            // flat 0.0000 / 0.00. Stake and Shuffle keep their original 4dp/2dp.
            const betDp = IS_NUTS_HOST ? 8 : 4;
            const amtDp = IS_NUTS_HOST ? 8 : 2;
            $('out_mult').value = m.toFixed(2) + 'x';
            $('out_bet').value = bet_size.toFixed(betDp);
            $('out_profit').value = profit_stop.toFixed(amtDp);
            $('out_target').value = target.toFixed(amtDp);
        } catch {
            ['out_mult', 'out_bet', 'out_profit', 'out_target'].forEach(id => $(id).value = 'Invalid');
        }
    }

    function getSimParams() {
        const n = parseInt($('n_trials').value);
        if (!Number.isFinite(n) || n < 1) throw new Error('Invalid trials count');
        const p = {
            starting_balance: parseFloat($('balance').value),
            bet_div: parseFloat($('bet_div').value),
            profit_mult: parseFloat($('profit_mult').value),
            w: parseFloat($('win_inc').value) / 100,
            l: parseInt($('loss_reset').value),
            buffer: 1 + parseFloat($('buffer').value) / 100,
            n_trials: n
        };
        for (const [k, v] of Object.entries(p)) {
            if (!Number.isFinite(v)) throw new Error('Invalid value for ' + k);
        }
        return p;
    }

    /* =========================================================
       SIMULATOR
       ========================================================= */
    function startSimulation() {
        if (simRunning) return;
        let params;
        try { params = getSimParams(); } catch { toast('Please enter valid positive numbers.'); return; }
        simRunning = true;
        $('sim_run').disabled = true;
        $('sim_stop').disabled = false;
        $('sim_progress').style.width = '0%';
        $('sim_status').textContent = 'Running...';
        simWorker = makeWorker();
        simWorker.onmessage = (e) => {
            const m = e.data;
            if (m.kind === 'sim_progress') {
                const pct = (m.done / m.total * 100).toFixed(1);
                $('sim_progress').style.width = pct + '%';
                $('sim_status').textContent = `Progress: ${pct}% (${m.done}/${m.total})`;
            } else if (m.kind === 'sim_done') {
                renderSimStats(m.stats);
                endSimulation('Done');
            } else if (m.kind === 'error') {
                toast('Simulation error: ' + m.error);
                endSimulation('Error');
            }
        };
        simWorker.postMessage({ kind: 'run_sim', params });
    }
    function stopSimulation() {
        if (!simRunning || !simWorker) return;
        simWorker.postMessage({ kind: 'stop' });
        setTimeout(() => endSimulation('Stopped'), 200);
    }
    function endSimulation(status) {
        if (simWorker) { try { simWorker.terminate(); } catch {} simWorker = null; }
        simRunning = false;
        $('sim_run').disabled = false;
        $('sim_stop').disabled = true;
        $('sim_status').textContent = status;
    }
    function renderSimStats(s) {
        const rows = [
            ['Average highest balance', s.avg_high ? '$' + s.avg_high.toFixed(2) : 'N/A'],
            ['Std dev (highest)', s.std_high ? '$' + s.std_high.toFixed(2) : 'N/A'],
            ['Max highest balance', s.max_high ? '$' + s.max_high.toFixed(2) : 'N/A'],
            ['Average cycles', s.avg_cycles.toFixed(2)],
            ['Average rounds', s.avg_rounds.toFixed(2)],
            ['Cycle success rate', s.cycle_success.toFixed(2) + '%'],
            ['Bust rate', s.bust_rate.toFixed(2) + '%']
        ];
        const tbody = $('sim_results').querySelector('tbody');
        tbody.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    }

    /* =========================================================
       OPTIMIZER (parseRange + combo pool)
       ========================================================= */
    function parseRange(text, integer = false) {
        try {
            text = (text || '').trim();
            if (!text) return [];
            if (text.includes(',')) {
                return text.split(',').map(s => s.trim()).filter(Boolean)
                    .map(p => integer ? Math.trunc(parseFloat(p)) : parseFloat(p));
            }
            let step = null;
            if (text.includes(';')) {
                const [left, right] = text.split(';', 2).map(s => s.trim());
                text = left;
                if (right.includes('=')) {
                    const [k, v] = right.split('=').map(s => s.trim());
                    if (k.toLowerCase() === 'step') step = integer ? Math.trunc(parseFloat(v)) : parseFloat(v);
                }
            }
            if (text.includes('-') && text.lastIndexOf('-') > 0) {
                const idx = text[0] === '-' ? text.indexOf('-', 1) : text.indexOf('-');
                const start_s = text.slice(0, idx);
                const end_s = text.slice(idx + 1);
                const start = integer ? Math.trunc(parseFloat(start_s)) : parseFloat(start_s);
                const end = integer ? Math.trunc(parseFloat(end_s)) : parseFloat(end_s);
                if (step != null) {
                    if (step === 0) return [];
                    const out = [];
                    if (start <= end) {
                        const count = Math.floor((end - start) / step) + 1;
                        for (let i = 0; i < count; i++) out.push(start + i * step);
                    } else {
                        const count = Math.floor((start - end) / step) + 1;
                        for (let i = 0; i < count; i++) out.push(start - i * step);
                    }
                    return out;
                }
                if (integer) {
                    const dir = start <= end ? 1 : -1;
                    const out = [];
                    for (let v = start; dir > 0 ? v <= end : v >= end; v += dir) out.push(v);
                    return out;
                }
                if (start === end) return [start];
                const out = [];
                for (let i = 0; i < 10; i++) out.push(start + i * (end - start) / 9);
                return out;
            }
            return [integer ? Math.trunc(parseFloat(text)) : parseFloat(text)];
        } catch { return []; }
    }

    /* Merge one param's From/To/Step range with its Values comma list into a
       sorted, de-duplicated list (mirrors the desktop tool's _range_values).
       Either part may be blank; a comma list typed in From still works. */
    function mergedRange(id, integer = false) {
        const g = suf => { const el = $(id + '_' + suf); return el ? el.value.trim() : ''; };
        const frm = g('from'), to = g('to'), step = g('step'), extra = g('values');
        let vals = [];
        if (frm.includes(',')) vals = vals.concat(parseRange(frm, integer));
        else if (frm) {
            let text = to ? (frm + '-' + to) : frm;
            if (to && step) text += ';step=' + step;
            vals = vals.concat(parseRange(text, integer));
        }
        if (extra) vals = vals.concat(parseRange(extra, integer));
        return Array.from(new Set(vals.filter(Number.isFinite))).sort((a, b) => a - b);
    }

    /* ===== EASY MODE ENGINE (port of the desktop tool's easy_tab) =====
       Pin Multiplier and/or Win Increase %; Loss Reset is enumerated up to
       the multiplier (cap 100) and Buffer % is solved so pinned values are
       matched exactly. With no Multiplier there is nothing to solve against, so
       the search returns null and the tab asks for one. */
    const EASY_W_MAX = 500, EASY_L_SWEEP = 10, EASY_L_CAP = 100, EASY_BUF_MAX = 100;
    let easyRows = [], easySelectedIdx = -1, easySortCol = null, easySortAsc = true, easyTimer = null;
    const EASY_COLS = [
        { key: 'm', label: 'Multiplier' },
        { key: 'w', label: 'Win Increase %' },
        { key: 'l', label: 'Loss Reset' },
        { key: 'b', label: 'Buffer %' },
        { key: 'odds', label: 'Reset Odds %' }
    ];
    function easyFindCombos(m, w) {
        if (m == null && w == null) return null; // unbounded search
        const rows = [];
        const add = (mi, wi, li, bi) => {
            if (mi <= 1) return;
            const chance = 0.99 / mi;
            rows.push({ m: mi, w: wi, l: li, b: bi, chance: chance * 100, odds: Math.pow(1 - chance, li) * 100 });
        };
        const lMax = m != null ? Math.min(Math.floor(m), EASY_L_CAP) : EASY_L_SWEEP;
        for (let l = 1; l <= lMax; l++) {
            if (m == null) { // W pinned, no multiplier: whole-number buffer sweep
                for (let b = 0; b <= EASY_BUF_MAX; b++) add((1 + w / 100) * l * (1 + b / 100), w, l, b);
            } else if (w != null) { // both pinned per L: solve the buffer
                const b = (m / ((1 + w / 100) * l) - 1) * 100;
                if (b >= -1e-9 && b <= EASY_BUF_MAX + 1e-9) add(m, w, l, Math.min(Math.max(b, 0), EASY_BUF_MAX));
            } else { // multiplier pinned: whole-number W sweep, solve the buffer
                for (let wi = 1; wi <= EASY_W_MAX; wi++) {
                    const b = (m / ((1 + wi / 100) * l) - 1) * 100;
                    if (b >= -1e-9 && b <= EASY_BUF_MAX + 1e-9) add(m, wi, l, Math.min(Math.max(b, 0), EASY_BUF_MAX));
                }
            }
        }
        rows.sort((a, b) => a.m - b.m || a.l - b.l || a.w - b.w);
        rows.forEach((r, i) => { r._i = i; });
        return rows;
    }
    function easyParse(id, lo, hi) {
        const el = $(id); const t = el ? el.value.trim() : '';
        // Empty = nothing pinned, which the caller turns into "enter a
        // Multiplier to search". A leftover "Any" from a saved state reads the
        // same way rather than as an error (applyStateToUI clears it too).
        if (!t || /^(any|all)$/i.test(t)) return { ok: true, v: null };
        const v = parseFloat(t);
        if (!Number.isFinite(v) || !(v > lo && v <= hi)) return { ok: false, v: null };
        return { ok: true, v };
    }
    function fmtEasyW(w) { return Math.abs(w - Math.round(w)) < 1e-9 ? String(Math.round(w)) : w.toFixed(2); }
    function easyRefresh() {
        easyTimer = null;
        const body = $('easy_body'); if (!body) return;
        const pm = easyParse('easy_mult', 1, 9900);
        // Win Increase % is no longer pinnable from this tab, so the search
        // always sweeps it. Kept as a null parse result so easyFindCombos'
        // three branches stay intact.
        const pw = { ok: true, v: null };
        $('easy_chance').textContent = (pm.ok && pm.v != null) ? (99 / pm.v).toFixed(2) + '%' : '--';
        easySelectedIdx = -1;
        if (!pm.ok || !pw.ok) {
            easyRows = []; body.innerHTML = ''; $('easy_count').textContent = '0';
            $('easy_status').textContent = 'Multiplier must be a number above 1.';
            return;
        }
        const rows = easyFindCombos(pm.v, pw.v);
        if (rows == null) {
            easyRows = []; body.innerHTML = ''; $('easy_count').textContent = '0';
            $('easy_status').textContent = 'Enter a Multiplier to search.';
            return;
        }
        easyRows = rows;
        $('easy_count').textContent = String(rows.length);
        $('easy_status').textContent = rows.length ? '' : 'No combos match - loosen a filter.';
        renderEasyTable();
    }
    function renderEasyTable() {
        const head = $('easy_head'), body = $('easy_body');
        if (!head || !body) return;
        head.innerHTML = EASY_COLS.map(c => {
            const arrow = c.key === easySortCol ? (easySortAsc ? ' ▲' : ' ▼') : '';
            return `<th data-col="${c.key}">${c.label}${arrow}</th>`;
        }).join('');
        let rows = easyRows;
        if (easySortCol) {
            rows = rows.slice().sort((a, b) => easySortAsc ? a[easySortCol] - b[easySortCol] : b[easySortCol] - a[easySortCol]);
        }
        body.innerHTML = rows.map(r =>
            `<tr data-idx="${r._i}" class="${r._i === easySelectedIdx ? 'selected' : ''}">` +
            `<td>${r.m.toFixed(2)}</td><td>${fmtEasyW(r.w)}</td><td>${r.l}</td>` +
            `<td>${r.b.toFixed(2)}</td><td>${r.odds.toFixed(2)}</td></tr>`
        ).join('');
    }
    function onEasyTableClick(e) {
        const th = e.target.closest('th');
        if (th && th.dataset.col) {
            if (easySortCol === th.dataset.col) easySortAsc = !easySortAsc;
            else { easySortCol = th.dataset.col; easySortAsc = true; }
            renderEasyTable();
            return;
        }
        const tr = e.target.closest('tr[data-idx]');
        if (tr) {
            $$('#dt-easy_body tr').forEach(r => r.classList.remove('selected'));
            tr.classList.add('selected');
            easySelectedIdx = parseInt(tr.dataset.idx);
        }
    }
    /** Build the selected combo into the live strategy and hand the user
     *  straight to Play. The Calculator panel still holds these fields and
     *  calcValues() still derives the bet plan from them — the user just
     *  never has to visit that tab to do it. Falls back to staying put on
     *  builds where no Play tab was injected. */
    async function easyBuildStrategy() {
        if (easySelectedIdx < 0 || !easyRows[easySelectedIdx]) { toast('Select a combo row first.'); return; }
        const r = easyRows[easySelectedIdx];
        $('win_inc').value = fmtEasyW(r.w);
        $('loss_reset').value = String(r.l);
        $('buffer').value = r.b.toFixed(2);
        calcValues();
        saveState();
        // calcValues() only refreshes the Calculator's own output fields —
        // on its own it never reaches the game. Building the strategy is a
        // two-step flow: scrape the live balance so the bet size is derived
        // from real money, then create the strategy in-game (sets payout and
        // bet amount, opens Advanced, creates the named "<mult>x" strategy
        // and configures its conditions).
        //
        // Deliberately import rather than "update existing": update only
        // rewrites one threshold on a strategy the game already has, so with
        // nothing set up there is nothing for it to update.
        try {
            await gameExport();
            await sleep(150);   // let the calculator settle before its outputs are read
            await gameImport();
        } catch (e) {
            console.error('[Find New Strategy] build failed:', e);
            toast('Could not build the strategy in-game.');
            return;
        }
        if (document.getElementById('dt-panel-stats')) switchTab('stats');
    }
    function easySchedule() {
        if (easyTimer) clearTimeout(easyTimer);
        easyTimer = setTimeout(easyRefresh, 250);
    }

    function getOptParams() {
        const opt = {
            starting_balance: parseFloat($('opt_balance').value),
            n_trials: parseInt($('opt_trials').value),
            bet_div_range: mergedRange('opt_betdiv'),
            profit_mult_range: mergedRange('opt_profit'),
            w_range: mergedRange('opt_w'),
            l_range: mergedRange('opt_l', true),
            buffer_range: mergedRange('opt_buf')
        };
        if (!Number.isFinite(opt.starting_balance) || !Number.isFinite(opt.n_trials) || opt.n_trials < 1) throw new Error('Invalid balance or trials');
        if ([opt.bet_div_range, opt.profit_mult_range, opt.w_range, opt.l_range, opt.buffer_range].some(r => !r.length)) throw new Error('Empty range');
        return opt;
    }
    function buildCombos(opt) {
        const combos = [];
        for (const bet_div of opt.bet_div_range)
            for (const profit_mult of opt.profit_mult_range)
                for (const w of opt.w_range)
                    for (const l of opt.l_range)
                        for (const buf of opt.buffer_range)
                            combos.push({
                                bet_div, profit_mult,
                                w: w / 100, l,
                                buffer: 1 + buf / 100,
                                starting_balance: opt.starting_balance,
                                n_trials: opt.n_trials
                            });
        return combos;
    }
    function startOptimizer() {
        if (optRunning) return;
        let opt;
        try { opt = getOptParams(); } catch { toast('Check your range syntax (e.g. 100-500 or 20,30,40).'); return; }
        const combos = buildCombos(opt);
        if (!combos.length) { toast('No combinations to run.'); return; }
        if (combos.length > 50000) {
            if (!confirm(`${combos.length} combinations may take a long time. Continue?`)) return;
        }
        if (!$('keep_prev').checked) { optResults = []; renderResults(); }
        optQueue = combos.slice();
        optTotal = combos.length;
        optDone = 0;
        optRunning = true;
        $('opt_run').disabled = true;
        $('opt_stop').disabled = false;
        $('opt_progress').style.width = '0%';
        $('opt_status').textContent = `Running 0 / ${optTotal}...`;
        const poolSize = Math.min(parseInt($('worker_count').value) || 1, combos.length);
        optWorkers = [];
        for (let i = 0; i < poolSize; i++) {
            const w = makeWorker();
            w.onmessage = (e) => handleOptMsg(w, e.data);
            optWorkers.push(w);
            dispatchNext(w);
        }
    }
    function handleOptMsg(worker, msg) {
        if (msg.kind === 'opt_row') optResults.push(msg.row);
        else if (msg.kind === 'opt_combo_done') {
            optDone++;
            const pct = (optDone / optTotal * 100);
            $('opt_progress').style.width = pct.toFixed(1) + '%';
            $('opt_status').textContent = `Running ${optDone} / ${optTotal} (${pct.toFixed(1)}%)`;
            if (optDone >= optTotal || !optRunning) finishOptimizer();
            else dispatchNext(worker);
        }
    }
    function dispatchNext(worker) {
        if (!optRunning) return;
        const combo = optQueue.shift();
        if (!combo) return;
        worker.postMessage({ kind: 'run_combo', combo });
    }
    function stopOptimizer() {
        if (!optRunning) return;
        optRunning = false;
        optQueue = [];
        for (const w of optWorkers) { try { w.postMessage({ kind: 'stop' }); } catch {} }
        setTimeout(finishOptimizer, 250);
    }
    function finishOptimizer() {
        if (!optRunning && !optWorkers.length) return;
        for (const w of optWorkers) { try { w.terminate(); } catch {} }
        optWorkers = [];
        optRunning = false;
        optResults.sort((a, b) => b.Score - a.Score);
        state.results = optResults.slice();
        saveState();
        renderResults();
        $('opt_run').disabled = false;
        $('opt_stop').disabled = true;
        $('opt_status').textContent = `Done (${optResults.length} results)`;
        toast('Strategy Finder complete');
        switchTab('results');
    }

    /* =========================================================
       RESULTS TABLE
       ========================================================= */
    function renderResults() {
        const head = $('res_head');
        const body = $('res_body');
        const best = $('res_best');
        if (!head) return;
        const cols = showAllCols ? RES_COLS : RES_COLS_PRIMARY;
        head.innerHTML = cols.map(c => {
            const help = (RES_COL_HELP[c] || '').replace(/"/g, '&quot;');
            const arrow = c === resultsSortCol ? (resultsSortAsc ? ' ▲' : ' ▼') : '';
            return `<th data-col="${c}" title="${help}">${RES_COL_LABELS[c] || c}${arrow}</th>`;
        }).join('');
        if (!optResults.length) {
            body.innerHTML = '';
            if (best) best.innerHTML = '';
            $('res_status').textContent = 'No results yet. Run the Strategy Finder.';
            return;
        }
        if (best) {
            best.innerHTML = renderBestCard();
            const ab = $('res_best_apply');
            if (ab) ab.onclick = applyBestPick;
        }
        let sorted = optResults.slice().sort((a, b) => {
            const av = a[resultsSortCol], bv = b[resultsSortCol];
            if (av == null && bv == null) return 0;
            const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
            return resultsSortAsc ? cmp : -cmp;
        });
        if (safeOnly) sorted = sorted.filter(r => (typeof r['Bust%'] === 'number' ? r['Bust%'] : 100) <= SAFE_BUST_MAX);
        $('res_status').textContent = safeOnly
            ? `${sorted.length} of ${optResults.length} result${optResults.length === 1 ? '' : 's'} (Bust% ≤ ${SAFE_BUST_MAX})`
            : `${optResults.length} result${optResults.length === 1 ? '' : 's'}`;
        body.innerHTML = sorted.map((r) => {
            const cells = cols.map(c => {
                const v = r[c];
                const cls = resCellClass(c, v);
                let inner = typeof v === 'number' ? v.toFixed(2) : v;
                // Color-coded risk bar in the Bust% column (bar width grows with risk).
                if (c === 'Bust%' && typeof v === 'number') {
                    const w = Math.max(3, Math.min(28, v * 1.4));
                    const bcls = v <= 5 ? 'good' : (v >= 20 ? 'bad' : 'mid');
                    inner = `<span class="dt-riskbar ${bcls}" style="width:${w}px"></span>${v.toFixed(1)}`;
                }
                return `<td class="${cls}">${inner}</td>`;
            }).join('');
            const origIdx = optResults.indexOf(r);
            return `<tr data-idx="${origIdx}" class="${origIdx === selectedRowIdx ? 'selected' : ''}">${cells}</tr>`;
        }).join('');
    }
    function onResTableClick(e) {
        const th = e.target.closest('th');
        if (th && th.dataset.col) {
            const col = th.dataset.col;
            if (resultsSortCol === col) resultsSortAsc = !resultsSortAsc;
            else { resultsSortCol = col; resultsSortAsc = false; }
            renderResults();
            return;
        }
        const tr = e.target.closest('tr[data-idx]');
        if (tr) {
            $$('#dt-res_body tr').forEach(r => r.classList.remove('selected'));
            tr.classList.add('selected');
            selectedRowIdx = parseInt(tr.dataset.idx);
        }
    }
    function applySelectedToCalculator() {
        if (selectedRowIdx < 0 || !optResults[selectedRowIdx]) { toast('Select a row first.'); return; }
        const r = optResults[selectedRowIdx];
        $('bet_div').value = r.BetDiv;
        $('profit_mult').value = r.ProfitMult;
        $('win_inc').value = r['W%'];
        $('loss_reset').value = r.L;
        $('buffer').value = r['Buffer%'];
        calcValues();
        saveState();
        switchTab('calc');
        toast('Parameters applied to Calculator');
    }
    function clearResults() {
        if (!optResults.length) return;
        if (!confirm('Clear all strategy finder results?')) return;
        optResults = [];
        state.results = [];
        selectedRowIdx = -1;
        saveState();
        renderResults();
        updateStepper();
    }
    function exportResultsCSV() {
        if (!optResults.length) { toast('No results to save.'); return; }
        const sorted = optResults.slice().sort((a, b) => {
            const cmp = a[resultsSortCol] - b[resultsSortCol];
            return resultsSortAsc ? cmp : -cmp;
        });
        const lines = [RES_COLS.join(',')];
        for (const r of sorted) {
            lines.push(RES_COLS.map(c => {
                const v = r[c];
                if (v == null) return '';
                const s = String(v);
                return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
            }).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dice_tool_results_' + Date.now() + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('CSV downloaded');
    }


    /* =========================================================
       GAME INTEGRATION — site-aware functions that read balance
       from the casino DOM and write strategy back into it.
       Mirrors the desktop userscript exactly, per-site selectors.
       ========================================================= */

    /* ---- Close the strategy popup after updating. Just clicks the X. ---- */
    // Shuffle's strategy modal ignores a plain .click() on its controls — its
    // handlers fire on pointer/mouse events — so dispatch the full sequence.
    function shfPointerClick(el) {
        if (!el) return false;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
            try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
        });
        return true;
    }
    async function closeStrategyPopup_shuffle() {
        await sleep(400);
        // Target the strategy modal's OWN X specifically. A bare
        // button[aria-label*="close"] search grabs the WRONG "Close" control on
        // shuffle.com (a different one sits earlier in the DOM), so the editor
        // stays open. The modal's X is .ModalClose_closeButton — pointer-clicking
        // that one closes it (verified live). Fall back to a dialog-scoped close,
        // then the bare aria-label, for other skins.
        const btn = document.querySelector('[class*="ModalClose_closeButton"]')
                 || document.querySelector('[role="dialog"] button[aria-label*="close" i]')
                 || document.querySelector('button[aria-label*="close" i]');
        if (btn) { shfPointerClick(btn); return true; }
        return false;
    }
    // Persist the strategy (Save Strategy) then make sure the popup is closed,
    // so after a create/update the user lands back on the game ready to play
    // instead of being left staring at the strategy editor.
    async function saveAndCloseStrategy_shuffle() {
        await sleep(400);
        let saveBtn = await waitForText('button', 'Save Strategy', 4000);
        if (!saveBtn) saveBtn = Array.from(document.querySelectorAll('button')).find(b => /^save strategy$/i.test((b.textContent || '').trim()) && b.offsetParent);
        if (!saveBtn) return false; // no Save button found — leave the editor open rather than risk discarding the strategy
        shfPointerClick(saveBtn);
        await sleep(800);
        // Saved — if the editor is still open, close it (safe now that it's saved).
        if (document.querySelector('[class*="AdvancedDiceCondition_root"]')) await closeStrategyPopup_shuffle();
        return true;
    }
    async function closeStrategyPopup_stake() {
        await sleep(400);
        const btn = document.querySelector('button[data-testid="game-modal-close"]');
        if (btn) { btn.click(); return true; }
        return false;
    }

    /* ---- Shuffle.us ---- */
    async function shuffle_exportBalance() {
        const activeBtn = document.querySelector('button.TabView_active__G842W p');
        if (!activeBtn || !activeBtn.textContent.trim()) { toast('Active balance element not found'); return; }
        const raw = activeBtn.textContent.trim();
        let cleaned = raw.replace(/,/g, '').replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) cleaned = parts.shift() + '.' + parts.join('');
        if (!cleaned || isNaN(cleaned)) { toast('Invalid balance: ' + raw); return; }
        const balance = Number(cleaned);
        $('balance').value = balance;
        calcValues();
        saveState();
        toast(`Balance imported: ${balance}`);
    }
    async function shuffle_updateExisting() {
        try {
            const v = currentCalcValues();
            const betSize = v.bet_size;
            const balanceTarget = v.balance_target;
            // Condition 4 is "On Balance ≥ Balance Target → Stop autoplay", so
            // the value we write into its threshold input is Balance Target
            // (not Profit Stop, which lives elsewhere).
            if (!betSize || !balanceTarget || betSize === 'Invalid' || balanceTarget === 'Invalid') { toast('Missing bet_size or balance_target.'); return; }
            const betInput = document.querySelector('input[data-testid="bet-amount"]');
            if (betInput) setNativeValue(betInput, betSize);
            const editBtn = await waitForText('button', 'Edit');
            if (!editBtn) { toast('Edit button not found'); return; }
            editBtn.click();
            await sleep(1000);
            const headers = document.querySelectorAll('.AdvancedDiceCondition_header__jDZzw');
            const cond4 = Array.from(headers).find(h => h.textContent.includes('Condition 4'));
            if (!cond4) { toast('Condition 4 not found.'); return; }
            cond4.click();
            await sleep(500);
            const conditionDiv = cond4.closest('.AdvancedDiceCondition_root__CaIQo');
            const inputs = conditionDiv ? conditionDiv.querySelectorAll('input[type="number"]') : [];
            if (inputs[0]) setNativeValue(inputs[0], balanceTarget);
            let _saved = await saveAndCloseStrategy_shuffle();
            if (!_saved) _saved = await closeStrategyPopup_shuffle(); // existing-strategy edits apply in place; just close out
            toast(_saved ? 'Strategy updated & saved — ready to play.' : 'Strategy updated — close the popup manually.');
        } catch (err) { toast('Update failed: ' + err); console.error(err); }
    }
    async function shuffle_importNew() {
        try {
            const v = currentCalcValues();
            const { bet_size, profit_stop, balance_target, multiplier, win_increase, loss_reset } = v;
            if (bet_size === 'Invalid' || profit_stop === 'Invalid' || balance_target === 'Invalid') { toast('Calculator values invalid.'); return; }
            const advancedTab = document.getElementById('advanced-bet');
            if (advancedTab && !advancedTab.classList.contains('TabView_active__G842W')) {
                advancedTab.click();
                await sleep(800);
            }
            // Shuffle dropped id="betInfo"; locate the Multiplier (to set) and
            // Chance (to read) inputs by their labeled InfoBetInput containers
            // — same robust approach as getUserSetMultiplier — and keep the old
            // id selector as a fallback in case a future deploy restores it.
            const _shfInputByLabel = (re) => {
                for (const c of document.querySelectorAll('[class*="InfoBetInput_inputContainer"]')) {
                    const lt = (c.querySelector('label, span, p')?.textContent || '').trim();
                    if (re.test(lt)) { const inp = c.querySelector('input'); if (inp) return inp; }
                }
                return null;
            };
            let multInput = _shfInputByLabel(/^multiplier$/i);
            let chanceInput = _shfInputByLabel(/chance/i);
            if (!multInput || !chanceInput) {
                const legacy = document.querySelectorAll('input#betInfo');
                if (legacy.length >= 2) { multInput = multInput || legacy[0]; chanceInput = chanceInput || legacy[1]; }
            }
            if (!multInput || !chanceInput) throw 'betInfo inputs not found';
            setNativeValue(multInput, multiplier);
            await sleep(600);
            const winChance = chanceInput.value;
            const betInput = document.querySelector('input[data-testid="bet-amount"]');
            if (betInput) setNativeValue(betInput, bet_size);
            const createBtn = await waitForText('button', 'Create strategy');
            if (!createBtn) throw 'Create strategy button not found';
            createBtn.click();
            await sleep(800);
            const labels = Array.from(document.querySelectorAll('label'));
            const nameLabel = labels.find(l => l.textContent.includes('Strategy name'));
            let nameInput = null;
            if (nameLabel) {
                const container = nameLabel.closest('div.TextInput_formControlWrapper__iBF1i') || nameLabel.parentElement.parentElement;
                nameInput = container.querySelector('input');
            }
            if (!nameInput) nameInput = document.querySelector('.ModalContent_modalContent__rbnMN input[type="text"]') || document.querySelector('.ModalContent_modalContent__rbnMN input:not([type="hidden"])');
            if (!nameInput) throw 'Could not locate Strategy Name input field.';
            nameInput.focus();
            setNativeValue(nameInput, `${multiplier}x`);
            await sleep(300);
            if (nameInput.value !== `${multiplier}x`) { setNativeValue(nameInput, `${multiplier}x`); await sleep(300); }
            const getStartedBtn = await waitForText('button', 'Get Started');
            if (!getStartedBtn) throw 'Get Started button not found';
            getStartedBtn.click();
            const addBtn = await waitForText('button', 'Add new condition block', 10000);
            if (!addBtn) throw 'Add condition block button not found';
            // "Get Started" auto-creates Condition 1, so 3 adds yields the 4
            // conditions this strategy actually uses — no useless 5th condition
            // is created at all. (The Condition-5 cleanup below stays as a
            // safety net in case the platform ever pre-creates extras.)
            for (let i = 0; i < 3; i++) { addBtn.click(); await sleep(500); }
            await sleep(1000);
            const headers = document.querySelectorAll('.AdvancedDiceCondition_header__jDZzw');
            if (headers.length < 4) throw `Only ${headers.length} conditions created.`;
            for (let i = 0; i < 4; i++) {
                headers[i].click();
                await sleep(500);
                const conditionDiv = headers[i].closest('.AdvancedDiceCondition_root__CaIQo');
                const radioLabels = conditionDiv.querySelectorAll('.AdvancedDiceCondition_customRadio__H__kC');
                const targetRadioIndex = (i === 0 || i === 3) ? 1 : 0;
                if (radioLabels[targetRadioIndex] && !radioLabels[targetRadioIndex].classList.contains('AdvancedDiceCondition_checked__Hivoo')) {
                    radioLabels[targetRadioIndex].click();
                    await sleep(300);
                }
                const selects = conditionDiv.querySelectorAll('select');
                const inputs = conditionDiv.querySelectorAll('input[type="number"]');
                if (i === 0) {
                    setSelectValue(selects[0], 'balance');
                    setSelectValue(selects[1], 'greaterThanOrEqualTo');
                    setNativeValue(inputs[0], '0.00');
                    setSelectValue(selects[2], 'setWinChance');
                    await sleep(300);
                    const refreshedInputs = conditionDiv.querySelectorAll('input[type="number"]');
                    const winChanceInput = refreshedInputs[1];
                    if (!winChanceInput) throw 'Win chance input not found after re-render';
                    setNativeValue(winChanceInput, winChance);
                } else if (i === 1) {
                    setSelectValue(selects[0], 'every');
                    setNativeValue(inputs[0], '1');
                    setSelectValue(selects[1], 'wins');
                    setSelectValue(selects[2], 'increaseBetAmountPercentage');
                    await sleep(300);
                    const refreshedInputs = conditionDiv.querySelectorAll('input[type="number"]');
                    const increaseInput = refreshedInputs[1];
                    if (!increaseInput) throw 'Increase % input not found after re-render';
                    setNativeValue(increaseInput, win_increase);
                } else if (i === 2) {
                    setSelectValue(selects[0], 'everyStreakOf');
                    setNativeValue(inputs[0], loss_reset);
                    setSelectValue(selects[1], 'losses');
                    setSelectValue(selects[2], 'resetBetAmount');
                } else if (i === 3) {
                    // Net-Gain Condition: On Balance, ≥ Balance Target, Do
                    // Stop autoplay. Bubble-radio index 1 (selected via the
                    // targetRadioIndex logic above) puts us in Net Gain mode.
                    setSelectValue(selects[0], 'balance');
                    setSelectValue(selects[1], 'greaterThanOrEqualTo');
                    setNativeValue(inputs[0], balance_target);
                    setSelectValue(selects[2], 'stopAutobet');
                }
                await sleep(400);
            }

            // Delete the leftover empty Condition 5 — "Get Started" pre-creates
            // Condition 1, so 4 adds total 5 conditions. Locate it by index
            // among AdvancedDiceCondition_root elements; expand it if needed,
            // then click whatever delete-style button lives inside.
            try {
                await sleep(400);
                const allConds = document.querySelectorAll('.AdvancedDiceCondition_root__CaIQo');
                const cond5 = allConds[4];
                if (cond5) {
                    const header5 = cond5.querySelector('.AdvancedDiceCondition_header__jDZzw');
                    if (header5) { header5.click(); await sleep(400); }
                    const del = cond5.querySelector('button[aria-label*="delete" i]')
                             || cond5.querySelector('button[aria-label*="remove" i]')
                             || cond5.querySelector('button[title*="delete" i]')
                             || [...cond5.querySelectorAll('button')].find(b => /^(Delete|Remove|×)$/i.test((b.textContent||'').trim()))
                             || cond5.querySelector('svg[class*="trash" i], svg[class*="delete" i], svg[class*="remove" i]')?.closest('button');
                    if (del) {
                        del.click();
                        await sleep(400);
                    }
                }
            } catch (e) { console.warn('[shuffle_importNew] Condition 5 cleanup skipped:', e); }

            let _saved = await saveAndCloseStrategy_shuffle();
            // shuffle.com has no "Save Strategy" button — the built strategy is
            // applied in place — so close the editor out so the user lands back
            // on the game ready to play (update flow does the same).
            if (!_saved) _saved = await closeStrategyPopup_shuffle();
            toast(_saved ? `"${multiplier}x" strategy created — ready to play.` : `"${multiplier}x" strategy created — close the editor manually.`);
        } catch (err) { toast('Import failed: ' + err); console.error(err); }
    }

    /* ---- Stake.us / Stake.com ---- */
    // Stake's bet-amount field differs by domain: stake.com (and the .bet/.games/
    // staketr* family) use a contenteditable #text-field-container; stake.us still
    // uses the legacy <input data-testid="input-game-amount">. Mirror setBet()'s
    // proven dual approach so the strategy import/update works on every domain.
    async function setStakeBetAmount(val) {
        const targetStr = String(val);
        const container = document.getElementById('text-field-container');
        if (container) {
            container.focus(); container.click();
            await sleep(60);
            const display = document.querySelector('#text-field-container #editing-view-port > div') || document.querySelector('#editing-view-port > div');
            if (display) {
                display.focus();
                try { document.execCommand('selectAll', false, null); document.execCommand('insertText', false, targetStr); } catch (e) {}
            }
            ['input','change','blur','keydown','keyup','focus'].forEach(type => {
                const e = new Event(type, { bubbles: true });
                container.dispatchEvent(e); if (display) display.dispatchEvent(e);
            });
            return true;
        }
        const input = document.querySelector('input[data-testid="input-game-amount"]');
        if (input) {
            try { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, targetStr); }
            catch (e) { input.value = targetStr; }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }
    async function stake_exportBalance() {
        const el = document.querySelector('span.ds-body-md-strong[data-ds-text="true"][style*="max-width: 16ch"]') ||
                   document.querySelector('span.ds-body-md-strong[data-ds-text="true"]');
        if (!el) { toast('Balance element not found'); return; }
        const rawText = el.textContent.trim();
        let cleaned = rawText.replace(/,/g, '').replace(/[^\d.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) cleaned = parts.shift() + '.' + parts.join('');
        const balance = parseFloat(cleaned);
        if (isNaN(balance)) { toast('Invalid balance: ' + rawText); return; }
        $('balance').value = balance;
        calcValues();
        saveState();
        toast(`Balance imported: ${balance}`);
    }
    async function stake_updateExisting() {
        try {
            const v = currentCalcValues();
            const betSize = v.bet_size;
            const balanceTarget = v.balance_target;
            // Condition 4 is "On Balance ≥ Balance Target → Stop autoplay", so
            // the value we write into its threshold input is Balance Target
            // (not Profit Stop, which lives elsewhere).
            if (!betSize || !balanceTarget || betSize === 'Invalid' || balanceTarget === 'Invalid') { toast('Missing bet_size or balance_target.'); return; }
            await waitFor('#text-field-container, input[data-testid="input-game-amount"]');
            await setStakeBetAmount(betSize);
            await sleep(200);
            const cond4BlockBtn = await waitFor('button[data-testid="block-condition-4"]');
            cond4BlockBtn.click();
            await sleep(600);
            const editBtn = document.querySelector('button[data-testid="conditional-block-edit-condition-4"]');
            if (editBtn) { editBtn.click(); await sleep(600); }
            const amountInput = await waitFor('input[data-testid="condition-profit-amount-input"]');
            amountInput.value = balanceTarget; trigger(amountInput);
            const closed = await closeStrategyPopup_stake();
            toast(closed ? 'Strategy updated & saved.' : 'Strategy updated — close the popup manually.');
        } catch (err) { toast('Update failed: ' + err); console.error(err); }
    }
    async function stake_importNew() {
        try {
            const v = currentCalcValues();
            const { bet_size, profit_stop, balance_target, multiplier, win_increase, loss_reset } = v;
            if (bet_size === 'Invalid' || profit_stop === 'Invalid' || balance_target === 'Invalid') { toast('Calculator values invalid.'); return; }
            const payoutInput = await waitFor('input[data-testid="payout"]');
            payoutInput.value = multiplier; trigger(payoutInput);
            await sleep(600);
            const chanceEl = await waitFor('input[data-testid="chance"]');
            const winChance = chanceEl.value;
            await setStakeBetAmount(bet_size);
            await sleep(200);
            const advBtn = await waitFor('svg[data-ds-icon="BetAdvanced"]');
            advBtn.closest('button').click();
            await sleep(800);
            const createBtn = await waitFor('button[data-testid="create-strategy-button"]');
            createBtn.click();
            await sleep(800);
            const nameInput = await waitFor('input[data-testid="strategy-name-input"]');
            nameInput.value = `${multiplier}x`; trigger(nameInput);
            const getStartedBtn = Array.from(document.querySelectorAll('div, button')).find(el => el.textContent.trim() === 'Get Started' || el.textContent.trim() === 'Get started');
            if (!getStartedBtn) throw 'Get Started button not found';
            getStartedBtn.click();
            await sleep(1500);
            const addBtn = await waitFor('button[data-testid="conditional-block-add"]');
            // "Get Started" auto-creates Condition 1, so 4 adds yields 5
            // total conditions. We configure 1-4 below, then delete the
            // empty Condition 5 at the end.
            for (let i = 0; i < 4; i++) { addBtn.click(); await sleep(800); }
            await sleep(1000);
            const editPencils = document.querySelectorAll('svg[data-ds-icon="Edit"]');
            if (editPencils.length < 4) throw `Only ${editPencils.length} conditions created`;
            editPencils[0].closest('button').click();
            await sleep(600);
            const profitRadio1 = await waitFor('label[data-testid="condition-type-radio-profit"]');
            profitRadio1.click(); await sleep(300);
            let sel = await waitFor('select[data-testid="condition-profit-type"]');
            sel.value = 'balance'; trigger(sel);
            sel = await waitFor('select[data-testid="condition-profit-term-type-options"]');
            sel.value = 'greaterThanOrEqualTo'; trigger(sel);
            let inp = await waitFor('input[data-testid="condition-profit-amount-input"]');
            inp.value = '0.00'; trigger(inp);
            sel = await waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'setWinChance'; trigger(sel);
            inp = await waitFor('input[data-testid="condition-action-percentage-input"]');
            inp.value = winChance; trigger(inp);
            await sleep(500);
            editPencils[1].closest('button').click(); await sleep(600);
            sel = await waitFor('select[data-testid="condition-term-options"]');
            sel.value = 'every'; trigger(sel);
            inp = await waitFor('input[data-testid="condition-count-input"]');
            inp.value = '1'; trigger(inp);
            sel = await waitFor('select[data-testid="condition-bet-type-options"]');
            sel.value = 'win'; trigger(sel);
            sel = await waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'increaseByPercentage'; trigger(sel);
            inp = await waitFor('input[data-testid="condition-action-percentage-input"]');
            inp.value = win_increase; trigger(inp);
            await sleep(500);
            editPencils[2].closest('button').click(); await sleep(600);
            sel = await waitFor('select[data-testid="condition-term-options"]');
            sel.value = 'everyStreakOf'; trigger(sel);
            inp = await waitFor('input[data-testid="condition-count-input"]');
            inp.value = loss_reset; trigger(inp);
            sel = await waitFor('select[data-testid="condition-bet-type-options"]');
            sel.value = 'lose'; trigger(sel);
            sel = await waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'resetAmount'; trigger(sel);
            await sleep(500);
            editPencils[3].closest('button').click(); await sleep(600);
            // Net-Gain Condition: On Balance, ≥ Balance Target, Do Stop autoplay.
            // The "condition-type-radio-profit" label drives the Net Gain
            // bubble; the "condition-profit-type" select then chooses what
            // we're gating on — Balance here (not Profit), with the target
            // being the calculator's Balance Target output.
            const profitRadio4 = await waitFor('label[data-testid="condition-type-radio-profit"]');
            profitRadio4.click(); await sleep(300);
            sel = await waitFor('select[data-testid="condition-profit-type"]');
            sel.value = 'balance'; trigger(sel);
            sel = await waitFor('select[data-testid="condition-profit-term-type-options"]');
            sel.value = 'greaterThanOrEqualTo'; trigger(sel);
            inp = await waitFor('input[data-testid="condition-profit-amount-input"]');
            inp.value = balance_target; trigger(inp);
            sel = await waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'stop'; trigger(sel);
            await sleep(400);

            // Delete the leftover empty Condition 5 — the loop above always
            // adds 4 (Stake's "Get Started" pre-creates Condition 1, so total
            // becomes 5). Find Condition 5's delete button (only appears when
            // the condition is expanded); if Condition 5 isn't open yet, open
            // it via its edit pencil first.
            try {
                let del5 = document.querySelector('button[data-testid="conditional-block-delete-condition-5"]');
                if (!del5) {
                    const editBtn5 = document.querySelector('button[data-testid="conditional-block-edit-condition-5"]')
                                  || document.querySelector('button[data-testid="block-condition-5"]');
                    if (editBtn5) {
                        editBtn5.click();
                        await sleep(500);
                        del5 = document.querySelector('button[data-testid="conditional-block-delete-condition-5"]');
                    }
                }
                if (del5) {
                    del5.click();
                    await sleep(400);
                }
            } catch (e) { console.warn('[stake_importNew] Condition 5 cleanup skipped:', e); }

            toast(`"${multiplier}x" strategy created. Click "Save Strategy".`);
        } catch (err) { toast('Import failed: ' + err); console.error(err); }
    }

    /* Nuts has no native Advanced strategy editor, so the panel's two
       game-action buttons bridge to the Advanced IOW HUD (tool_nuts_iow_smart)
       over window hooks it exports. "Create Strategy" fills the HUD's
       condition blocks; "Send To Game" sets the wager. */
    const IS_NUTS_HOST = /(^|\.)nuts\.gg$/i.test(location.hostname);
    function nuts_exportBalance() {
        const bal = (typeof window.__nuts_cond_balance__ === 'function') ? window.__nuts_cond_balance__() : NaN;
        if (isFinite(bal) && bal > 0) {
            const el = $('balance');
            if (el) { el.value = bal.toFixed(8); trigger(el); }
        }
        calcValues();
    }
    /** Full-precision calculator values for Nuts.
     *
     *  currentCalcValues() returns the *displayed* outputs, which are rounded for
     *  humans — bet size to 4dp and the targets to 2dp. That is fine for Stake's
     *  2dp currency but wrong for 8dp SOL: a 0.00246913 bet becomes "0.0025", and
     *  anything under 0.00005 collapses to "0.0000" and gets clamped to the
     *  minimum bet. So recompute from the raw inputs with calcValues()'s own
     *  formulas and hand the bridge real numbers. */
    function nuts_preciseCalcValues() {
        const balance = parseFloat($('balance').value);
        const w = parseFloat($('win_inc').value) / 100;
        const l = parseInt($('loss_reset').value, 10);
        const div = parseFloat($('bet_div').value);
        const pm = parseFloat($('profit_mult').value);
        const buffer = 1 + parseFloat($('buffer').value) / 100;
        if (![balance, w, div, pm, buffer].every(Number.isFinite) || !Number.isFinite(l) || div === 0) return null;
        const bet = balance / div;
        const profitStop = bet * pm;
        return {
            multiplier: ((1 + w) * l) * buffer,
            bet_size: bet,
            profit_stop: profitStop,
            balance_target: balance + profitStop,
            win_increase: parseFloat($('win_inc').value),
            loss_reset: Math.max(1, l)
        };
    }
    function nuts_importNew() {
        calcValues();
        const v = nuts_preciseCalcValues();
        if (!v) { toast('Calculator values invalid.'); return; }
        if (typeof window.__nuts_cond_import__ === 'function') {
            window.__nuts_cond_import__(v);
            toast(`"${v.multiplier.toFixed(2)}x" strategy sent to Advanced IOW — press START.`);
        } else {
            toast('Advanced IOW HUD not ready.');
        }
    }
    /** Nuts equivalent of stake_updateExisting: keep the strategy that's already
     *  loaded and only push the recomputed bet size + balance target into it, so
     *  the win-increase / loss-reset / payout the user is running are untouched. */
    function nuts_updateExisting() {
        calcValues();
        const v = nuts_preciseCalcValues();
        if (!v) { toast('Calculator values invalid.'); return; }
        if (typeof window.__nuts_cond_update__ === 'function') {
            window.__nuts_cond_update__(v);
            toast('Strategy updated for balance ' + (($('balance') || {}).value || '?') + '.');
        } else {
            toast('Advanced IOW HUD not ready.');
        }
    }

    /* Pick the right site's implementation */
    function gameExport() {
        if (IS_NUTS_HOST) return nuts_exportBalance();
        if (location.hostname.includes('shuffle.')) return shuffle_exportBalance();
        return stake_exportBalance();
    }
    function gameUpdate() {
        if (IS_NUTS_HOST) return nuts_updateExisting();
        if (location.hostname.includes('shuffle.')) return shuffle_updateExisting();
        return stake_updateExisting();
    }
    function gameImport() {
        if (IS_NUTS_HOST) return nuts_importNew();
        if (location.hostname.includes('shuffle.')) return shuffle_importNew();
        return stake_importNew();
    }
    /* Combined one-click flow: scrape balance → recompute → push new bet size
       and profit stop into the existing in-game strategy. */
    async function gameSync() {
        await gameExport();
        // Let the calculator settle before reading its outputs
        await sleep(150);
        await gameUpdate();
    }


    /* =========================================================
       STREAK COUNTER HUD — win/loss tracking + autoplay stopper.
       Site-aware DOM observers ported from the desktop userscript.
       ========================================================= */
    let _winStreak = 0, _lossStreak = 0;
    let _counterObservers = [];
    let _counterInitPoll = null;

    function buildCounterHUD() {
        const host = document.createElement('div');
        host.id = COUNTER_ID;
        host.innerHTML = `
          <div class="dt-ctr-row" data-ctr-drag="true">
            <div>
              <div class="dt-ctr-lbl">Wins</div>
              <div class="dt-ctr-w" id="dt-ctr_w">0</div>
            </div>
            <div>
              <div class="dt-ctr-lbl">Losses</div>
              <div class="dt-ctr-l" id="dt-ctr_l">0</div>
            </div>
            <span class="dt-ctr-drag" title="Drag">⠿</span>
          </div>
          <div class="dt-ctr-row">
            <span class="dt-ctr-lbl">Stop @</span>
            <input type="number" min="0" class="dt-ctr-target" id="dt-ctr_target" value="10">
            <button class="dt-ctr-btn" id="dt-ctr_reset">Reset</button>
          </div>
          <div class="dt-ctr-row">
            <span id="dt-ctr_vol_icon" style="font-size:13px;">🔊</span>
            <input type="range" min="0" max="100" value="100" class="dt-ctr-vol" id="dt-ctr_vol">
          </div>
          <div class="dt-ctr-row">
            <button class="dt-ctr-btn dt-ctr-btn-wide" id="dt-ctr_update">Update</button>
          </div>
        `;
        document.body.appendChild(host);
        return host;
    }

    function setCounterVisible(visible) {
        const host = document.getElementById(COUNTER_ID);
        if (!host) return;
        host.classList.toggle('show', !!visible);
    }
    function applyCounterTheme() {
        const host = document.getElementById(COUNTER_ID);
        if (!host) return;
        const panel = document.getElementById(PANEL_ID);
        const val = panel ? (panel.getAttribute('data-theme') || '') : '';
        host.setAttribute('data-theme', val);
    }
    function animateSpan(el) {
        if (!el) return;
        el.style.transform = 'scale(1.25)';
        setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
    }
    function updateCounterDisplay() {
        const w = document.getElementById('dt-ctr_w');
        const l = document.getElementById('dt-ctr_l');
        if (w) w.textContent = _winStreak;
        if (l) { l.textContent = _lossStreak; l.classList.toggle('has-loss', _lossStreak > 0); }
    }
    function playBeep() {
        // Win sound is scoped to Advanced IOW mode only. If the IOW/Smart HUD
        // exists on the page but the user isn't in Advanced IOW (toolsActive
        // flag absent), silently skip — Manual / IOW / Smart modes should
        // never trigger the win beep. When the HUD doesn't exist at all (e.g.
        // standalone primedice), the beep behaves as before.
        const hud = document.getElementById('ratchet-master-container');
        if (hud && hud.dataset.toolsActive !== '1') return;
        const vol = state.counter_volume / 100;
        if (!vol) return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, ctx.currentTime);
            osc.connect(gain);
            gain.connect(ctx.destination);
            gain.gain.value = vol * 0.35;
            osc.start();
            setTimeout(() => { osc.stop(); try { ctx.close(); } catch {} }, 200);
        } catch {}
    }
    function stopAutoplay_shuffle() {
        const stopText = document.querySelector('button[data-testid="bet-button"] span.ButtonVariants_buttonContent__mRPrs');
        if (stopText && stopText.innerText.includes('Stop Autoplay')) {
            const btn = stopText.closest('button');
            if (btn && !btn.disabled) btn.click();
        }
    }
    function stopAutoplay_stake() {
        const btn = document.querySelector('button[data-testid="auto-bet-button"][data-autobet-status="stop"]');
        if (btn && !btn.disabled) btn.click();
    }
    function stopAutoplayAction() {
        if (location.hostname.includes('shuffle.')) return stopAutoplay_shuffle();
        return stopAutoplay_stake();
    }
    function onWinDetected() {
        _winStreak++;
        _lossStreak = 0;
        updateCounterDisplay();
        animateSpan(document.getElementById('dt-ctr_w'));
        playBeep();
        if (state.counter_autostop && _winStreak >= (state.counter_target || 0) && state.counter_target > 0) {
            stopAutoplayAction();
        }
    }
    function onLossDetected() {
        _lossStreak++;
        updateCounterDisplay();
        animateSpan(document.getElementById('dt-ctr_l'));
    }

    /* ---- Shuffle observer ---- */
    let _sh_prev3Active = false, _sh_lastSeenText = '';
    function initCounter_shuffle() {
        const conditionContainer = document.querySelector('.AdvancedDiceBet_conditionContainer__6o_z9');
        const resultsWrapper = document.querySelector('.OriginalGameRecentResult_originalGameResultsWrapper__aCNPr');
        if (!conditionContainer || !resultsWrapper) return false;
        const initialNewest = resultsWrapper.children[0];
        if (initialNewest) {
            const initialButton = initialNewest.querySelector('button');
            if (initialButton) _sh_lastSeenText = initialButton.innerText;
        }
        function checkCondition3() {
            const buttons = conditionContainer.querySelectorAll('button.AdvancedDiceConditionTag_condition__8L8IB');
            let cond3Btn = null;
            buttons.forEach(b => { if (b.innerText.trim() === '3') cond3Btn = b; });
            if (!cond3Btn) return;
            const tagDiv = cond3Btn.querySelector('div.AdvancedDiceConditionTag_tag__gdVMG');
            if (!tagDiv) return;
            const current3Active = tagDiv.classList.contains('AdvancedDiceConditionTag_active__7Rex1');
            if (current3Active && !_sh_prev3Active) { _winStreak = 0; updateCounterDisplay(); }
            _sh_prev3Active = current3Active;
        }
        const resultsObs = new MutationObserver(() => {
            const newest = resultsWrapper.children[0];
            if (!newest) return;
            const button = newest.querySelector('button');
            if (!button) return;
            const currentText = button.innerText;
            if (currentText === _sh_lastSeenText) return;
            _sh_lastSeenText = currentText;
            // Win detection: Shuffle colors the result badge via --badge-bg on an
            // inner span, NOT the button's inline background, so read the span's
            // computed background. Win = rgb(61,209,121) (green), loss = rgb(42,46,56)
            // (gray) — verified live on shuffle.us dice. Green-dominant fallback keeps
            // wins classified if the exact palette shifts.
            const badgeSpan = button.querySelector('span[class*="badgeBackground"]') || button.querySelector('span');
            const badgeBg = badgeSpan ? getComputedStyle(badgeSpan).backgroundColor
                                      : (button.style.backgroundColor || getComputedStyle(button).backgroundColor);
            let isWin = badgeBg === 'rgb(61, 209, 121)';
            if (!isWin) { const m = badgeBg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (m) isWin = (+m[2] > +m[1] + 60 && +m[2] > 130); }
            if (isWin) onWinDetected(); else onLossDetected();
        });
        resultsObs.observe(resultsWrapper, { childList: true, subtree: true, attributes: true });
        const condObs = new MutationObserver(checkCondition3);
        condObs.observe(conditionContainer, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
        checkCondition3();
        _counterObservers.push(resultsObs, condObs);
        return true;
    }

    /* ---- Stake observer ---- */
    let _st_prev3Success = false, _st_lastSeenBetId = null;
    function initCounter_stake() {
        const container = document.querySelector('div[class*="condition-list-wrap"]');
        const pastBets = document.querySelector('.past-bets');
        if (!container || !pastBets) return false;
        function checkButton3() {
            const smallBlocks = container.querySelectorAll('div[class*="small-block"]');
            let b3div = null;
            smallBlocks.forEach(div => {
                const b = div.querySelector('button');
                if (b && b.innerText.trim() === '3') b3div = div;
            });
            if (!b3div) return;
            const curr = b3div.classList.contains('success');
            if (curr && !_st_prev3Success) { _winStreak = 0; updateCounterDisplay(); }
            _st_prev3Success = curr;
        }
        const betObs = new MutationObserver(() => {
            const newest = pastBets.querySelector('button[data-last-bet-index="0"]');
            if (!newest) return;
            const betId = newest.getAttribute('data-past-bet-id');
            if (betId === _st_lastSeenBetId) return;
            _st_lastSeenBetId = betId;
            const isWin = newest.classList.contains('variant-positive');
            if (isWin) onWinDetected(); else onLossDetected();
        });
        betObs.observe(pastBets, { childList: true, subtree: true });
        const condObs = new MutationObserver(checkButton3);
        condObs.observe(container, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
        checkButton3();
        _counterObservers.push(betObs, condObs);
        return true;
    }

    function initStreakCounter() {
        const initFn = location.hostname.includes('shuffle.') ? initCounter_shuffle : initCounter_stake;
        if (initFn()) return;
        _counterInitPoll = setInterval(() => {
            if (initFn()) { clearInterval(_counterInitPoll); _counterInitPoll = null; }
        }, 500);
    }

    function setupCounterDrag(host) {
        let dragging = false, startX = 0, startY = 0, offsetX = 0, offsetY = 0;
        const begin = (x, y, ev) => {
            const target = ev && ev.target;
            if (target && target.matches('input, button, .dt-ctr-vol')) return false;
            dragging = true;
            const r = host.getBoundingClientRect();
            offsetX = x - r.left; offsetY = y - r.top;
            startX = x; startY = y;
            return true;
        };
        const move = (x, y) => {
            if (!dragging) return;
            const w = host.offsetWidth, h = host.offsetHeight;
            let nx = Math.max(4, Math.min(x - offsetX, window.innerWidth - w - 4));
            let ny = Math.max(4, Math.min(y - offsetY, window.innerHeight - h - 4));
            host.style.left = nx + 'px';
            host.style.top = ny + 'px';
            host.style.right = 'auto';
            state.counter_x = nx; state.counter_y = ny;
        };
        const end = () => {
            if (!dragging) return;
            dragging = false;
            saveState();
        };
        host.addEventListener('mousedown', e => {
            if (!begin(e.clientX, e.clientY, e)) return;
        });
        host.addEventListener('touchstart', e => {
            const t = e.touches[0];
            if (t && begin(t.clientX, t.clientY, e)) e.preventDefault();
        }, { passive: false });
        document.addEventListener('mousemove', e => move(e.clientX, e.clientY));
        document.addEventListener('touchmove', e => {
            const t = e.touches[0]; if (t) move(t.clientX, t.clientY);
        }, { passive: true });
        document.addEventListener('mouseup', end);
        document.addEventListener('touchend', end);
    }

    function wireCounterControls() {
        const tInput = document.getElementById('dt-ctr_target');
        const reset = document.getElementById('dt-ctr_reset');
        const update = document.getElementById('dt-ctr_update');
        const vol = document.getElementById('dt-ctr_vol');
        const volIcon = document.getElementById('dt-ctr_vol_icon');
        if (tInput) {
            tInput.value = state.counter_target;
            tInput.addEventListener('change', () => {
                state.counter_target = Math.max(0, parseInt(tInput.value) || 0);
                saveState();
            });
        }
        if (reset) reset.addEventListener('click', () => {
            _winStreak = 0; _lossStreak = 0; updateCounterDisplay();
        });
        if (update) update.addEventListener('click', async () => {
            const original = update.textContent;
            update.disabled = true;
            update.textContent = '…';
            try { await gameSync(); }
            finally {
                update.disabled = false;
                update.textContent = original;
            }
        });
        const updateVolIcon = () => {
            const v = state.counter_volume / 100;
            if (!volIcon) return;
            volIcon.textContent = v === 0 ? '🔇' : v < 0.33 ? '🔈' : v < 0.66 ? '🔉' : '🔊';
        };
        if (vol) {
            vol.value = state.counter_volume;
            updateVolIcon();
            vol.addEventListener('input', () => {
                state.counter_volume = parseInt(vol.value) || 0;
                updateVolIcon();
                saveState();
            });
        }
    }


    /* =========================================================
       PANEL OPEN/CLOSE
       ========================================================= */
    function openPanel() {
        state.panel_open = true;
        document.getElementById(PANEL_ID).classList.add('show');
        document.getElementById('dt-backdrop').classList.add('show');
        saveState();
    }
    function closePanel() {
        state.panel_open = false;
        document.getElementById(PANEL_ID).classList.remove('show');
        document.getElementById('dt-backdrop').classList.remove('show');
        saveState();
    }
    function togglePanel() {
        state.panel_open ? closePanel() : openPanel();
    }

    /* =========================================================
       TAB SWITCHING
       ========================================================= */
    function switchTab(name) {
        const panel = document.getElementById(PANEL_ID);
        panel.setAttribute('data-active-tab', name); // drives the extend-downward sizing
        panel.querySelectorAll('.dt-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        panel.querySelectorAll('.dt-panel').forEach(p => p.classList.toggle('active', p.id === 'dt-panel-' + name));
        panel.querySelector('.dt-body').scrollTop = 0;
        updateStepper();
    }
    /* Refresh the guided-workflow stepper from real engine state:
       step 1 (Optimize) is "done" once results exist; step 2 (Review) once a row
       is selected or a best pick exists. Also drives the Optimizer "next" button. */
    function updateStepper() {
        const panel = document.getElementById(PANEL_ID);
        if (!panel) return;
        const hasResults = Array.isArray(optResults) && optResults.length > 0;
        const reviewed = hasResults && (selectedRowIdx >= 0 || bestResultIdx() >= 0);
        panel.querySelectorAll('.dt-step[data-step="1"]').forEach(s => s.classList.toggle('done', hasResults));
        panel.querySelectorAll('.dt-step[data-step="2"]').forEach(s => s.classList.toggle('done', reviewed));
        const next = document.getElementById('dt-next_opt');
        if (next) {
            next.disabled = !hasResults;
            next.textContent = hasResults ? 'See your results →' : 'Run a search to continue';
        }
    }

    /* =========================================================
       TOOLTIPS (? helpers)
       ========================================================= */
    let _ttCurrentTarget = null;
    function showTooltip(target) {
        const term = target.dataset.tooltip;
        const def = GLOSSARY[term];
        if (!def) return;
        const tt = document.getElementById('dt-tooltip');
        if (!tt) return;
        // Toggle off if tapping the same ? again
        if (_ttCurrentTarget === target && tt.classList.contains('show')) {
            hideTooltip();
            return;
        }
        _ttCurrentTarget = target;
        tt.innerHTML = `<div class="dt-tt-title">${term}</div>${def}`;
        tt.style.visibility = 'hidden';
        tt.style.top = '0px';
        tt.style.left = '0px';
        tt.classList.add('show');
        // Force layout then measure
        const ttRect = tt.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        let left = rect.left + rect.width / 2 - ttRect.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - ttRect.width - 8));
        let top = rect.top - ttRect.height - 8;
        if (top < 8) top = rect.bottom + 8;
        tt.style.top = top + 'px';
        tt.style.left = left + 'px';
        tt.style.visibility = '';
    }
    function hideTooltip() {
        const tt = document.getElementById('dt-tooltip');
        if (tt) tt.classList.remove('show');
        _ttCurrentTarget = null;
    }

    /* =========================================================
       COPY TO CLIPBOARD
       ========================================================= */
    async function copyById(id, btn) {
        const val = $(id).value;
        if (!val || val === 'Invalid') { toast('Nothing to copy.'); return; }
        const done = () => { toast('Copied: ' + val); flashCopied(btn); };
        try {
            await navigator.clipboard.writeText(val);
            done();
        } catch {
            const el = $(id);
            el.removeAttribute('readonly');
            el.select();
            try { document.execCommand('copy'); done(); }
            catch { toast('Copy failed.'); }
            el.setAttribute('readonly', '');
            window.getSelection().removeAllRanges();
        }
    }
    function flashCopied(btn) {
        if (!btn) return;
        const prev = btn.dataset._lbl || btn.textContent;
        btn.dataset._lbl = prev;
        btn.classList.add('dt-copied');
        btn.textContent = 'Copied ✓';
        clearTimeout(btn._copT);
        btn._copT = setTimeout(() => { btn.textContent = prev; btn.classList.remove('dt-copied'); }, 1100);
    }

    /* =========================================================
       ADVANCED IOW — UX HELPERS (additive; no core logic changed)
       ========================================================= */
    const OPT_RANGE_FIELDS = [
        { id: 'opt_betdiv', integer: false },
        { id: 'opt_profit', integer: false },
        { id: 'opt_w', integer: false },
        { id: 'opt_l', integer: true },
        { id: 'opt_buf', integer: false }
    ];
    function fmtRangeList(arr) {
        if (arr.length <= 4) return arr.join(', ');
        return arr[0] + ', ' + arr[1] + ' … ' + arr[arr.length - 1];
    }
    function mmsFmt(n) { return String(Math.round(n * 1e6) / 1e6); }
    // Boxes → text field. Build canonical "min-max;step=N" and write it into the
    // existing range field, then refresh the preview + persist. Never rewrites the
    // boxes (so it can't clobber what the user is typing).
    function syncStepperToField(id) {
        const minEl = $('mms_' + id + '_min'), maxEl = $('mms_' + id + '_max'), stepEl = $('mms_' + id + '_step');
        if (!minEl || !maxEl) return;
        const min = minEl.value.trim(), max = maxEl.value.trim(), step = stepEl ? stepEl.value.trim() : '';
        let str;
        if (min !== '' && max !== '') { str = min + '-' + max; if (step !== '') str += ';step=' + step; }
        else if (min !== '') str = min;
        else if (max !== '') str = max;
        else return; // nothing usable (e.g. only Step filled)
        const field = $(id); if (!field) return;
        field.value = str;
        updateOptPreview(); saveState();
    }
    // Text field → boxes. Derive Min/Max from the parsed values; derive Step only when
    // the values are evenly spaced (≥3 of them) so we don't misrepresent a list like 25,30,40.
    function syncFieldToStepper(id) {
        const field = $(id); if (!field) return;
        const f = OPT_RANGE_FIELDS.find(x => x.id === id);
        const minEl = $('mms_' + id + '_min'), maxEl = $('mms_' + id + '_max'), stepEl = $('mms_' + id + '_step');
        if (!minEl || !maxEl || !stepEl) return;
        const vals = parseRange(field.value, f ? f.integer : false);
        if (!vals.length) return; // leave boxes as-is on unparseable input
        minEl.value = mmsFmt(Math.min(...vals));
        maxEl.value = mmsFmt(Math.max(...vals));
        let step = '';
        if (vals.length >= 3) {
            const s = vals.slice().sort((a, b) => a - b);
            const d = s[1] - s[0]; let even = true;
            for (let i = 2; i < s.length; i++) { if (Math.abs((s[i] - s[i - 1]) - d) > 1e-9) { even = false; break; } }
            if (even) step = mmsFmt(d);
        }
        stepEl.value = step;
    }
    function refreshAllSteppers() { OPT_RANGE_FIELDS.forEach(f => syncFieldToStepper(f.id)); }
    function updateOptPreview() {
        let combos = 1, anyBad = false;
        for (const f of OPT_RANGE_FIELDS) {
            const el = $(f.id); if (!el) continue;
            const vals = parseRange(el.value, f.integer);
            const prev = $('prev_' + f.id);
            if (!vals.length) {
                anyBad = true;
                if (prev) { prev.textContent = '⚠ check this range'; prev.classList.add('bad'); }
            } else {
                combos *= vals.length;
                if (prev) { prev.textContent = '→ ' + fmtRangeList(vals) + ' (' + vals.length + ' value' + (vals.length === 1 ? '' : 's') + ')'; prev.classList.remove('bad'); }
            }
        }
        const est = $('opt_preview'); if (!est) return;
        const trialsEl = $('opt_trials');
        const trials = parseInt(trialsEl ? trialsEl.value : '', 10);
        if (anyBad || !Number.isFinite(trials) || trials < 1) {
            est.textContent = 'Fix the ranges above to size the run.';
            est.classList.add('bad'); est.classList.remove('warn');
            return;
        }
        const sims = combos * trials;
        est.innerHTML = '<strong>' + combos.toLocaleString() + '</strong> combo' + (combos === 1 ? '' : 's') + ' × <strong>' + trials + '</strong> trials = <strong>' + sims.toLocaleString() + '</strong> sims';
        est.classList.remove('bad');
        est.classList.toggle('warn', combos > 50000);
    }
    const OPT_PRESETS = {
        quick: { opt_betdiv: '256,500', opt_profit: '50,100', opt_w: '60-90;step=15', opt_l: '3-5;step=1', opt_buf: '25,40', opt_trials: '10' },
        balanced: { opt_betdiv: '256-512;step=128', opt_profit: '50-150;step=50', opt_w: '50-100;step=10', opt_l: '3-6;step=1', opt_buf: '20-40;step=10', opt_trials: '20' },
        thorough: { opt_betdiv: '256-512;step=64', opt_profit: '50-150;step=25', opt_w: '50-150;step=10', opt_l: '3-8;step=1', opt_buf: '20-40;step=5', opt_trials: '30' }
    };
    function applyOptPreset(name) {
        if (name === 'center') { centerOptOnCalc(); return; }
        const p = OPT_PRESETS[name]; if (!p) return;
        for (const k in p) { const el = $(k); if (el) el.value = p[k]; }
        updateOptPreview(); refreshAllSteppers(); saveState();
        toast(name.charAt(0).toUpperCase() + name.slice(1) + ' preset loaded');
    }
    function centerOptOnCalc() {
        const nv = id => { const el = $(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : null; };
        const bal = nv('balance'), bd = nv('bet_div'), pm = nv('profit_mult'), wi = nv('win_inc'), bf = nv('buffer');
        const lrEl = $('loss_reset'); const lr = lrEl ? parseInt(lrEl.value, 10) : NaN;
        if ([bal, bd, pm, wi, bf].some(v => v == null) || !Number.isFinite(lr)) { toast('Enter valid Calculator values first.'); return; }
        const set = (id, v) => { const el = $(id); if (el) el.value = v; };
        const r = Math.round;
        set('opt_balance', String(+bal.toFixed(2)));
        set('opt_betdiv', Math.max(1, r(bd / 2)) + ',' + r(bd) + ',' + r(bd * 2));
        set('opt_profit', Math.max(1, r(pm / 2)) + ',' + r(pm) + ',' + r(pm * 2));
        set('opt_w', Math.max(0, r(wi - 20)) + '-' + r(wi + 20) + ';step=10');
        set('opt_l', Math.max(1, lr - 1) + '-' + (lr + 1) + ';step=1');
        set('opt_buf', Math.max(0, r(bf - 10)) + ',' + r(bf) + ',' + r(bf + 10));
        updateOptPreview(); refreshAllSteppers(); saveState();
        toast('Ranges centered on your Calculator values');
    }
    function resCellClass(col, v) {
        if (typeof v !== 'number') return '';
        if (col === 'Score') return v >= 1 ? 'dt-cell-good' : (v <= 0 ? 'dt-cell-bad' : 'dt-cell-mid');
        if (col === 'Bust%') return v <= 5 ? 'dt-cell-good' : (v >= 20 ? 'dt-cell-bad' : 'dt-cell-mid');
        if (col === 'CycleSuccess%') return v >= 60 ? 'dt-cell-good' : (v < 30 ? 'dt-cell-bad' : 'dt-cell-mid');
        return '';
    }
    function bestResultIdx() {
        if (!optResults.length) return -1;
        let bi = 0;
        for (let i = 1; i < optResults.length; i++) {
            const s = optResults[i].Score, sb = optResults[bi].Score;
            if ((s == null ? -Infinity : s) > (sb == null ? -Infinity : sb)) bi = i;
        }
        return bi;
    }
    function renderBestCard() {
        const bi = bestResultIdx();
        if (bi < 0) return '';
        const r = optResults[bi];
        // Plain-language verdict from the headline stats, then four focal metrics.
        const bust = +r['Bust%'], succ = +r['CycleSuccess%'], avg = +r.AvgHigh, start = +r.StartingBalance;
        const risk = bust <= 5 ? 'very safe' : (bust <= 12 ? 'fairly safe' : (bust <= 25 ? 'moderately risky' : 'high-risk'));
        const grow = (start > 0 && avg > start)
            ? ('grows your $' + start.toFixed(0) + ' to about $' + avg.toFixed(0) + ' on average')
            : 'is roughly break-even on average';
        const verdict = 'This setup is <b>' + risk + '</b> (only <b>' + bust.toFixed(0) + '% chance</b> of busting) and ' + grow + ', winning <b>' + succ.toFixed(0) + '%</b> of its cycles.';
        const bustCls = bust <= 5 ? 'good' : (bust >= 20 ? 'bad' : '');
        const scoreCls = (+r.Score) >= 1 ? 'good' : ((+r.Score) <= 0 ? 'bad' : '');
        const st = (cls, val, lbl) => '<div class="dt-rb-stat ' + cls + '"><b>' + val + '</b><i>' + lbl + '</i></div>';
        return '<div class="dt-res-best">' +
            '<div class="dt-rb-tag">★ Recommended for you</div>' +
            '<div class="dt-rb-verdict">' + verdict + '</div>' +
            '<div class="dt-rb-stats">' +
            st(bustCls, bust.toFixed(0) + '%', 'Bust risk') +
            st('', '$' + avg.toFixed(0), 'Avg high') +
            st('', succ.toFixed(0) + '%', 'Win rate') +
            st(scoreCls, (+r.Score).toFixed(2), 'Score') +
            '</div>' +
            '<button class="dt-btn dt-btn-primary dt-go" id="dt-res_best_apply">Use this setup →</button>' +
            '</div>';
    }
    function applyBestPick() {
        const bi = bestResultIdx();
        if (bi < 0) return;
        selectedRowIdx = bi;
        applySelectedToCalculator();
    }

    /* =========================================================
       THEME & FONT APPLICATION
       ========================================================= */
    function applyTheme() {
        const t = $('theme_select').value;
        const val = t === 'original' ? '' : t;
        document.getElementById(PANEL_ID).setAttribute('data-theme', val);
        document.getElementById(BUTTON_ID).setAttribute('data-theme', val);
        document.getElementById('dt-tooltip').setAttribute('data-theme', val);
        applyCounterTheme();
    }
    function applyFontScale() {
        document.getElementById(PANEL_ID).setAttribute('data-large-fonts', $('large_fonts').checked ? 'true' : 'false');
    }

    /* =========================================================
       STATE RESTORATION TO UI
       ========================================================= */
    function applyStateToUI() {
        const ids = ['balance', 'win_inc', 'loss_reset', 'bet_div', 'profit_mult', 'buffer', 'n_trials',
                     'opt_balance', 'opt_trials', 'easy_mult'];
        for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'])
            for (const s of ['from', 'to', 'step', 'values']) ids.push(p + '_' + s);
        for (const k of ids) if ($(k) && state[k] != null) $(k).value = state[k];
        // Anyone who used the tool before now has "Any" saved for the Multiplier.
        // Restoring that literal text would put the word straight back into the
        // box the moment the panel opened, so drop it and let the placeholder show.
        { const em = $('easy_mult'); if (em && /^(any|all)$/i.test(em.value.trim())) em.value = ''; }
        // Migrate legacy combined range strings ("50-100;step=5" / "25,30,40")
        // into the From/To/Step/Values fields the first time they're seen.
        for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf']) {
            if (state[p] == null || state[p + '_from'] != null || state[p + '_values'] != null) continue;
            let text = String(state[p]).trim(), step = '';
            if (text.includes(';')) {
                const parts = text.split(';', 2);
                text = parts[0].trim();
                const mSt = /step\s*=\s*(.+)/i.exec(parts[1] || '');
                if (mSt) step = mSt[1].trim();
            }
            const set = (suf, v) => { const el = $(p + '_' + suf); if (el) el.value = v; };
            if (text.includes(',') || !text.includes('-')) {
                set('values', text); set('from', ''); set('to', '');
            } else {
                const i = text.indexOf('-', text[0] === '-' ? 1 : 0);
                set('from', text.slice(0, i).trim()); set('to', text.slice(i + 1).trim()); set('values', '');
            }
            if (step) set('step', step);
        }
        $('theme_select').value = state.theme || 'original';
        $('large_fonts').checked = !!state.large_fonts;
        $('keep_prev').checked = !!state.keep_prev;
        $('worker_count').value = state.worker_count || Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4));
        $('show_counter').checked = state.show_counter !== false;
        $('counter_autostop').checked = state.counter_autostop !== false;
        applyTheme();
        applyFontScale();
        setCounterVisible(state.show_counter !== false);
        // Restore counter position if previously dragged
        const host = document.getElementById(COUNTER_ID);
        if (host && state.counter_x != null && state.counter_y != null) {
            host.style.left = state.counter_x + 'px';
            host.style.top = state.counter_y + 'px';
            host.style.right = 'auto';
        }
        if (Array.isArray(state.results) && state.results.length) {
            optResults = state.results.slice();
            renderResults();
        }
    }

    /* =========================================================
       DRAGGABLE FLOATING BUTTON (desktop: click or drag-to-reposition)
       ========================================================= */
    function setupButtonDrag(btn) {
        let dragging = false;
        let moved = false;
        let startX = 0, startY = 0, offsetX = 0, offsetY = 0;

        const begin = (x, y) => {
            moved = false;
            dragging = true;
            const rect = btn.getBoundingClientRect();
            offsetX = x - rect.left;
            offsetY = y - rect.top;
            startX = x; startY = y;
        };
        const move = (x, y) => {
            if (!dragging) return;
            if (Math.abs(x - startX) > 5 || Math.abs(y - startY) > 5) moved = true;
            const w = btn.offsetWidth, h = btn.offsetHeight;
            let nx = x - offsetX, ny = y - offsetY;
            nx = Math.max(4, Math.min(nx, window.innerWidth - w - 4));
            ny = Math.max(4, Math.min(ny, window.innerHeight - h - 4));
            btn.style.left = nx + 'px';
            btn.style.top = ny + 'px';
            btn.style.right = 'auto';
            btn.style.bottom = 'auto';
        };
        const end = (ev) => {
            if (!dragging) return;
            dragging = false;
            if (!moved) {
                ev.preventDefault();
                togglePanel();
            }
        };
        btn.addEventListener('mousedown', e => { if (e.button === 0) begin(e.clientX, e.clientY); });
        document.addEventListener('mousemove', e => move(e.clientX, e.clientY));
        document.addEventListener('mouseup', end);
    }

    /* =========================================================
       DRAGGABLE PANEL HEADER (desktop: click-drag the title bar to move)
       ========================================================= */
    function setupPanelDrag(panel) {
        const head = panel.querySelector('.dt-head');
        if (!head) return;
        let dragging = false;
        let startX = 0, startY = 0, panelStartLeft = 0, panelStartTop = 0;
        head.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.dt-close')) return;
            const rect = panel.getBoundingClientRect();
            panelStartLeft = rect.left;
            panelStartTop = rect.top;
            startX = e.clientX;
            startY = e.clientY;
            dragging = true;
            // Switch from right/transform positioning to absolute left/top while dragging
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
            panel.style.right = 'auto';
            panel.style.transform = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const w = panel.offsetWidth, h = panel.offsetHeight;
            let nx = Math.max(4, Math.min(panelStartLeft + dx, window.innerWidth - w - 4));
            let ny = Math.max(4, Math.min(panelStartTop + dy, window.innerHeight - h - 4));
            panel.style.left = nx + 'px';
            panel.style.top = ny + 'px';
        });
        document.addEventListener('mouseup', () => { dragging = false; });
    }

    /* =========================================================
       INIT / EVENT WIRING
       ========================================================= */
    function init() {
        // Inject UI first
        injectUI();
        loadState();
        applyStateToUI();
        calcValues();

        // Calculator inputs — live recompute + save
        ['balance', 'win_inc', 'loss_reset', 'bet_div', 'profit_mult', 'buffer'].forEach(id => {
            $(id).addEventListener('input', () => { calcValues(); saveState(); });
        });
        ['n_trials', 'opt_balance', 'opt_trials'].forEach(id => $(id).addEventListener('input', saveState));
        // Optimizer From/To/Step/Values fields — persist on edit
        for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'])
            for (const s of ['from', 'to', 'step', 'values']) {
                const el = $(p + '_' + s);
                if (el) el.addEventListener('input', saveState);
            }
        // Advanced IOW UX: live combo-count + per-range previews, presets, results toggles
        ['opt_trials', 'opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf']
            .forEach(id => { const el = $(id); if (el) el.addEventListener('input', updateOptPreview); });
        // Min/Max/Step boxes <-> text field two-way sync
        OPT_RANGE_FIELDS.forEach(f => { const el = $(f.id); if (el) el.addEventListener('input', () => syncFieldToStepper(f.id)); });
        OPT_RANGE_FIELDS.forEach(f => ['min', 'max', 'step'].forEach(part => {
            const el = $('mms_' + f.id + '_' + part);
            if (el) el.addEventListener('input', () => syncStepperToField(f.id));
        }));
        // ⌨ toggle: reveal/hide the per-range custom-syntax field
        $$('.dt-rng-adv-btn').forEach(b => b.addEventListener('click', () => {
            const adv = $('adv_' + b.dataset.advtoggle);
            if (!adv) return;
            const show = adv.hasAttribute('hidden');
            adv.toggleAttribute('hidden', !show);
            b.classList.toggle('active', show);
        }));
        $$('[data-preset]').forEach(b => b.addEventListener('click', () => {
            $$('[data-preset]').forEach(x => x.classList.toggle('active', x === b));
            applyOptPreset(b.dataset.preset);
        }));
        const _resSafe = $('res_safe'); if (_resSafe) _resSafe.addEventListener('change', () => { safeOnly = _resSafe.checked; renderResults(); });
        const _resCols = $('res_allcols'); if (_resCols) _resCols.addEventListener('change', () => { showAllCols = _resCols.checked; renderResults(); });
        refreshAllSteppers();
        updateOptPreview();
        updateStepper();

        // Copy buttons
        document.getElementById(PANEL_ID).querySelectorAll('[data-copy]').forEach(b => {
            b.addEventListener('click', () => copyById(b.dataset.copy, b));
        });

        // Tab delegation
        const tabsNav = document.getElementById(PANEL_ID).querySelector('.dt-tabs');
        tabsNav.addEventListener('click', (ev) => {
            const btn = ev.target.closest('.dt-tab-btn');
            if (!btn) return;
            ev.preventDefault();
            switchTab(btn.dataset.tab);
        });

        // Guided workflow: stepper pills + "next step" buttons jump between tabs.
        document.getElementById(PANEL_ID).addEventListener('click', (ev) => {
            const step = ev.target.closest('.dt-step');
            if (step && step.dataset.step) { switchTab(STEP_TABS[step.dataset.step]); return; }
            const next = ev.target.closest('.dt-next');
            if (next && !next.disabled && next.dataset.goto) { switchTab(next.dataset.goto); }
        });

        // Tooltip helpers — direct listeners on each ? button for iOS reliability,
        // plus a panel-wide handler so tapping elsewhere in the panel closes the tooltip.
        const panelEl = document.getElementById(PANEL_ID);
        panelEl.querySelectorAll('.dt-help').forEach(btn => {
            const handle = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                showTooltip(btn);
            };
            btn.addEventListener('click', handle);
            btn.addEventListener('touchend', handle, { passive: false });
        });
        panelEl.addEventListener('click', (e) => {
            if (e.target.closest('.dt-help')) return;
            const tt = document.getElementById('dt-tooltip');
            if (tt && tt.classList.contains('show')) hideTooltip();
        });
        // Only hide on scroll of the panel body (not document, which can fire
        // from unrelated casino-page scrolls and kill the tooltip instantly).
        panelEl.querySelector('.dt-body').addEventListener('scroll', hideTooltip, { passive: true });

        // Simulator
        $('sim_run').addEventListener('click', startSimulation);
        $('sim_stop').addEventListener('click', stopSimulation);

        // Optimizer
        $('opt_run').addEventListener('click', startOptimizer);
        $('opt_stop').addEventListener('click', stopOptimizer);
        $('opt_clear').addEventListener('click', clearResults);

        // Results
        $('res_apply').addEventListener('click', applySelectedToCalculator);
        $('res_csv').addEventListener('click', exportResultsCSV);
        document.getElementById('dt-res_table').addEventListener('click', onResTableClick);

        // Easy Mode
        $('easy_mult').addEventListener('input', () => { easySchedule(); saveState(); });
        $('easy_apply').addEventListener('click', easyBuildStrategy);
        document.getElementById('dt-easy_table').addEventListener('click', onEasyTableClick);
        easyRefresh();

        // Settings
        $('theme_select').addEventListener('change', () => { applyTheme(); saveState(); });
        $('large_fonts').addEventListener('change', () => { applyFontScale(); saveState(); });
        $('keep_prev').addEventListener('change', saveState);
        $('worker_count').addEventListener('change', saveState);
        $('show_counter').addEventListener('change', () => {
            setCounterVisible($('show_counter').checked);
            saveState();
        });
        $('counter_autostop').addEventListener('change', saveState);
        $('reset_state').addEventListener('click', () => {
            if (!confirm('Reset all saved data?')) return;
            localStorage.removeItem(STORE_KEY);
            location.reload();
        });

        // Streak counter: wire controls, drag, and site observers
        wireCounterControls();
        setupCounterDrag(document.getElementById(COUNTER_ID));
        initStreakCounter();

        // Game buttons
        $('game_sync').addEventListener('click', gameSync);
        $('game_import').addEventListener('click', gameImport);

        // Panel close (X + backdrop)
        document.getElementById('dt-close-btn').addEventListener('click', closePanel);
        document.getElementById('dt-backdrop').addEventListener('click', closePanel);

        // Floating button toggle (drag-aware)
        setupButtonDrag(document.getElementById(BUTTON_ID));

        // Make the panel draggable by its header
        setupPanelDrag(document.getElementById(PANEL_ID));

        // Initial render
        renderResults();
    }

    // Run when DOM is ready (document-end generally means body is present, but be safe)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }


    }


    register({
        id: 'nuts-dice',
        name: 'Nuts Dice',
        description: 'Manual / IOW / Smart / Advanced IOW bet-sizing modes on Nuts Dice.',
        matches: [
            'https://nuts.gg/dice*',
            'https://*.nuts.gg/dice*'
        ],
        runAt: 'document-start',
        defaultEnabled: true,
        group: 'Nuts',
        hijacksPage: true
    }, runNutsIowSmart);
    register({
        id: 'nuts-limbo-target',
        name: 'Nuts Limbo/Target',
        description: 'Manual / IOW / Smart / Advanced IOW modes on Nuts Target (Limbo equivalent).',
        matches: [
            'https://nuts.gg/target*',
            'https://*.nuts.gg/target*'
        ],
        runAt: 'document-start',
        defaultEnabled: true,
        group: 'Nuts',
        hijacksPage: true
    }, runNutsIowSmart);

    register({
        id: 'nuts-dice',
        name: 'Nuts Dice',
        description: 'Manual / IOW / Smart / Advanced IOW bet-sizing modes on Nuts Dice.',
        matches: [
            'https://nuts.gg/dice*',
            'https://*.nuts.gg/dice*'
        ],
        runAt: 'document-start',
        defaultEnabled: true,
        group: 'Nuts',
        hijacksPage: true
    }, runNutsIowSmart);

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


    console.log('%c[Nuts Dice — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
