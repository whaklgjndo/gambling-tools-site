// ==UserScript==
// @name         Shuffle Limbo — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.34
// @description  Standalone single-tool build, extracted from the unified bundle.
// @author       .
// @match        https://shuffle.com/*
// @match        https://shuffle.us/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cShuffle Limbo — Desktop — standalone build v3.34', 'color:#17c7b8;font-weight:800;font-size:13px');

    /* =========================================================
       IOW/SMART → STATS BRIDGE
       --------------------------------------------------------
       Cross-tool integration layer between the IOW/Smart HUD and
       the Dice Tool's Stats tab (now mounted under "Advanced IOW"
       inside the IOW/Smart HUD).

       The IOW/Smart tool body publishes stats here on every bet;
       the Dice Tool's Stats tab subscribes via __iow_smart_on_publish__
       and renders the data without duplicating bookkeeping.

       Two scopes are tracked:
         - sessionStats: lifetime since page load (cleared by Reset)
         - runStats:     per-cycle since the last Start click

       Public API (set by IOW/Smart, read by Stats tab):
         window.__iow_smart_state__         { sessionStats, runBaseline, runStats }
         window.__iow_smart_snapshot_run__  baseline current state for a new cycle
         window.__iow_smart_handle_bet__    record a bet result for streak math
         window.__iow_smart_publish__       update sessionStats + runStats
         window.__iow_smart_on_publish__    subscriber callback (set by Stats tab)
       ========================================================= */

    window.__iow_smart_state__ = window.__iow_smart_state__ || {
        sessionStats: null,   // populated after every updateUI() in IOW/Smart
        runBaseline: null,    // snapshot taken at startRapidFire()
        runStats: null        // computed each updateUI() as session - baseline
    };

    // Per-cycle streak tracking. Reset by snapshot_run, updated by handle_bet.
    const __iowRunStreaks = {
        winStreaks: [], lossStreaks: [],
        curWin: 0, maxWin: 0, curLoss: 0, maxLoss: 0,
        peakBalance: 0, peakProfit: 0, lastResult: null
    };

    /** Baseline current state so subsequent publishes can compute per-run deltas. */
    window.__iow_smart_snapshot_run__ = function (currentBalance, totalBets, totalWagered, totalWins, totalLosses, profitHistoryLen, sessionInitialBalance, multGames, multWins) {
        window.__iow_smart_state__.runBaseline = {
            startingBalance: currentBalance,
            sessionInitialBalance: sessionInitialBalance,
            totalBets: totalBets,
            totalWagered: totalWagered,
            totalWins: totalWins,
            totalLosses: totalLosses,
            profitHistoryLen: profitHistoryLen,
            multGames: multGames || 0,
            multWins: multWins || 0,
            timestamp: Date.now()
        };
        __iowRunStreaks.winStreaks.length = 0;
        __iowRunStreaks.lossStreaks.length = 0;
        __iowRunStreaks.curWin = 0;
        __iowRunStreaks.maxWin = 0;
        __iowRunStreaks.curLoss = 0;
        __iowRunStreaks.maxLoss = 0;
        __iowRunStreaks.peakBalance = currentBalance;
        __iowRunStreaks.peakProfit = 0;
        __iowRunStreaks.lastResult = null;
    };

    /** Record a settled bet for per-run streak / peak / profit tracking. */
    window.__iow_smart_handle_bet__ = function (isWin, currentBalance) {
        if (!window.__iow_smart_state__.runBaseline) return;
        const s = __iowRunStreaks;
        if (isWin) {
            if (s.lastResult === false && s.curLoss > 0) {
                s.lossStreaks.push(s.curLoss);
                s.lossStreaks.sort((a, b) => b - a);
                if (s.lossStreaks.length > 10) s.lossStreaks.length = 10;
            }
            s.curWin++; s.curLoss = 0;
        } else {
            if (s.lastResult === true && s.curWin > 0) {
                s.winStreaks.push(s.curWin);
                s.winStreaks.sort((a, b) => b - a);
                if (s.winStreaks.length > 10) s.winStreaks.length = 10;
            }
            s.curLoss++; s.curWin = 0;
        }
        s.lastResult = isWin;
        s.maxWin = Math.max(s.maxWin, s.curWin);
        s.maxLoss = Math.max(s.maxLoss, s.curLoss);
        if (currentBalance > s.peakBalance) s.peakBalance = currentBalance;
        const baseline = window.__iow_smart_state__.runBaseline;
        const profit = currentBalance - baseline.startingBalance;
        if (profit > s.peakProfit) s.peakProfit = profit;
    };

    // Listener registered by the Stats tab. Called synchronously after every
    // publish so the UI refreshes per-bet instead of waiting for the 500ms
    // ticker — same cadence the SMART/IOW/Manual HUDs render at because they
    // call updateUI() directly inside processNewBet.
    window.__iow_smart_on_publish__ = null;

    /** Push the latest IOW/Smart state into __iow_smart_state__ and notify subscribers. */
    window.__iow_smart_publish__ = function (currentBalance, initialBalance, sessionPeak, highestProfit, totalWagered, totalWins, totalLosses, totalBets, curWinStreak, maxWinStreak, curLossStreak, maxLossStreak, topWinStreaks, topLossStreaks, profitHistory, isRapidFiring, multGames, multWins, trackedMultiplier) {
        const sessionProfit = currentBalance - initialBalance;
        window.__iow_smart_state__.sessionStats = {
            startingBalance: initialBalance,
            balance: currentBalance,
            profit: sessionProfit,
            sessionPeak: sessionPeak,
            peakProfit: highestProfit,
            totalWagered: totalWagered,
            totalWins: totalWins,
            totalLosses: totalLosses,
            totalBets: totalBets,
            rtp: totalWagered > 0 ? ((totalWagered + sessionProfit) / totalWagered) * 100 : 100,
            curWinStreak: curWinStreak,
            maxWinStreak: maxWinStreak,
            curLossStreak: curLossStreak,
            maxLossStreak: maxLossStreak,
            topWinStreaks: topWinStreaks ? topWinStreaks.slice() : [],
            topLossStreaks: topLossStreaks ? topLossStreaks.slice() : [],
            profitHistory: profitHistory ? profitHistory.slice() : [],
            isRapidFiring: isRapidFiring,
            multGames: multGames || 0,
            multWins: multWins || 0,
            trackedMultiplier: trackedMultiplier || 0
        };

        const b = window.__iow_smart_state__.runBaseline;
        if (b) {
            const s = __iowRunStreaks;
            const runProfit = currentBalance - b.startingBalance;
            const runWagered = totalWagered - b.totalWagered;
            // Per-run profit history is profit relative to per-run start.
            // profitHistory entries are balance - sessionInitialBalance, so we
            // shift by (b.startingBalance - sessionInitialBalance).
            const offset = b.startingBalance - b.sessionInitialBalance;
            const ph = profitHistory && profitHistory.length > b.profitHistoryLen
                ? profitHistory.slice(b.profitHistoryLen).map(p => p - offset)
                : [];
            window.__iow_smart_state__.runStats = {
                startingBalance: b.startingBalance,
                balance: currentBalance,
                profit: runProfit,
                sessionPeak: s.peakBalance,
                peakProfit: s.peakProfit,
                totalBets: totalBets - b.totalBets,
                totalWagered: runWagered,
                totalWins: totalWins - b.totalWins,
                totalLosses: totalLosses - b.totalLosses,
                rtp: runWagered > 0 ? ((runWagered + runProfit) / runWagered) * 100 : 100,
                curWinStreak: s.curWin,
                maxWinStreak: s.maxWin,
                curLossStreak: s.curLoss,
                maxLossStreak: s.maxLoss,
                topWinStreaks: s.winStreaks.slice(),
                topLossStreaks: s.lossStreaks.slice(),
                profitHistory: ph,
                multGames: (multGames || 0) - (b.multGames || 0),
                multWins: (multWins || 0) - (b.multWins || 0),
                trackedMultiplier: trackedMultiplier || 0
            };
        } else {
            window.__iow_smart_state__.runStats = null;
        }

        // Notify the Stats tab synchronously so it refreshes per-bet.
        if (typeof window.__iow_smart_on_publish__ === 'function') {
            try { window.__iow_smart_on_publish__(); } catch (e) {}
        }
    };

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

    /* === source: stake-iow-smart-desktop.user.js === */
    function tool_stake_iow_smart() {
        'use strict';

    // ==================== PLATFORM DETECTION ====================
    function isShuffle() { return /shuffle\./.test(location.hostname); }

    /**
     * Returns true only when the current URL is a dice/limbo (or stake primedice)
     * page the IOW/Smart HUD is designed for. Used by buildHUD to tear down the
     * HUD after SPA navigation moves us to a different game (Mines, Plinko, Keno,
     * Blackjack, etc.) — the script's @match patterns only gate the INITIAL load,
     * but Shuffle/Stake's React router can swap the page underneath without
     * reloading the script, so we re-check the URL on every periodic tick.
     */
    function isOnSupportedGamePage() {
        const path = location.pathname || '';
        if (isShuffle()) {
            return /\/games\/originals\/(limbo)(?:\/|$|\?|#)/i.test(path);
        }
        // Stake (stake.com / stake.us)
        return /\/casino\/games\/(limbo)(?:\/|$|\?|#)/i.test(path);
    }

    /** True on a Dice page only (not Limbo). Used to conditionally render
     *  the Switch Over/Under button — Limbo has no direction to swap. */
    function isOnDicePage() {
        const path = location.pathname || '';
        if (isShuffle()) {
            return /\/games\/originals\/dice(?:\/|$|\?|#)/i.test(path);
        }
        return /\/casino\/games\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(path);
    }

    /** Native Roll Over/Under swap clickable — platform-aware (Stake vs Shuffle). */
    function getRollOverUnderSwap() {
        return document.querySelector('button[class*="RollOverInput_inputContainer"]')  // Shuffle
            || document.querySelector('input[data-testid="reverse-roll"]')               // Stake
            || document.querySelector('[data-testid="reverse-roll"]');
    }

    /**
     * Map the current URL to one of the four split tool ids and check whether
     * the user has that specific tool enabled. Returns true when no
     * dice/limbo URL pattern matches (the isOnSupportedGamePage check
     * handles that case separately).
     *
     * Used by buildHUD to tear the HUD down when the user has disabled the
     * specific game they're on (e.g. on Stake Limbo with stake-limbo disabled).
     */
    function isCurrentGameEnabled() {
        const path = location.pathname || '';
        let toolId = null;
        if (isShuffle()) {
            if (/\/games\/originals\/dice(?:\/|$|\?|#)/i.test(path)) toolId = 'shuffle-dice';
            else if (/\/games\/originals\/limbo(?:\/|$|\?|#)/i.test(path)) toolId = 'shuffle-limbo';
        } else {
            if (/\/casino\/games\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(path)) toolId = 'stake-dice';
            else if (/\/casino\/games\/limbo(?:\/|$|\?|#)/i.test(path)) toolId = 'stake-limbo';
        }
        if (!toolId) return true; // unknown URL — buildHUD's isOnSupportedGamePage handles it
        try { return isToolIdEnabled(toolId); }
        catch (e) { return true; }
    }

    // ==================== SHUFFLE TRANSPORT INTERCEPTORS ====================
    // Hook fetch / XHR / WebSocket so we can pull bet results out of
    // Shuffle's GraphQL responses. The DOM observer is also wired below
    // (startShuffleObserver) as a backup — whichever fires first wins
    // (dedup guard via _shuffleLastBetMs).
    if (isShuffle()) {
        const PAGE_WIN = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        // ==================== AUDIO: mute the bet-button click sound ====================
        // Shuffle plays an immediate UI click sound via the Web Audio API when
        // the Play / Bet button is pressed. The win sound plays AFTER the
        // server bet result returns (100ms+). We mute Web Audio playback for
        // a 60ms window starting at the click, which always catches the click
        // (fires within ~20ms of the event) and never catches the win.
        //
        // Tampermonkey scripts run in an isolated world by default — patching
        // window.AudioContext from here would NOT affect the page's audio. So
        // we inject an inline <script> that runs in the main world.
        (function injectShuffleAudioMute() {
            try {
                const s = document.createElement('script');
                s.textContent = '(' + (function () {
                    let suppressUntil = 0;
                    // Bet-button click → arm the suppression window
                    document.addEventListener('click', function (e) {
                        if (!e.target) return;
                        const btn = e.target.closest && e.target.closest('button[data-testid="bet-button"]');
                        if (btn) suppressUntil = Date.now() + 60;
                    }, true);
                    function wrapBufferSource(node) {
                        const origStart = node.start;
                        if (!origStart || origStart.__shuffleMutePatched) return;
                        const wrapped = function () {
                            if (Date.now() < suppressUntil) return;  // skip play
                            return origStart.apply(this, arguments);
                        };
                        wrapped.__shuffleMutePatched = true;
                        try { node.start = wrapped; } catch (e) {}
                    }
                    function patchProto(Ctor) {
                        if (!Ctor || !Ctor.prototype) return;
                        const origCreate = Ctor.prototype.createBufferSource;
                        if (!origCreate || origCreate.__shuffleMutePatched) return;
                        const wrapped = function () {
                            const node = origCreate.apply(this, arguments);
                            wrapBufferSource(node);
                            return node;
                        };
                        wrapped.__shuffleMutePatched = true;
                        Ctor.prototype.createBufferSource = wrapped;
                    }
                    patchProto(window.AudioContext);
                    patchProto(window.webkitAudioContext);
                    // Some sites play one-shot SFX via plain Audio elements.
                    // Wrap HTMLMediaElement.play to honor the same window.
                    const origPlay = HTMLMediaElement.prototype.play;
                    if (origPlay && !origPlay.__shuffleMutePatched) {
                        const wrapped = function () {
                            if (Date.now() < suppressUntil) {
                                // Return a resolved promise so callers awaiting play() don't reject.
                                try { this.pause(); } catch (e) {}
                                return Promise.resolve();
                            }
                            return origPlay.apply(this, arguments);
                        };
                        wrapped.__shuffleMutePatched = true;
                        HTMLMediaElement.prototype.play = wrapped;
                    }
                }).toString() + ')();';
                (document.head || document.documentElement).appendChild(s);
                s.remove();
            } catch (e) { console.error('[Shuffle audio mute] inject failed:', e); }
        })();

        function _extractPlays(container) {
            if (!container || typeof container !== 'object') return;
            for (const k in container) {
                if (!/Play$/.test(k)) continue;
                const v = container[k];
                if (v && typeof v === 'object' && v.amount !== undefined && v.payout !== undefined) onShuffleBetResult(v);
            }
        }
        function _tryParseBet(text) {
            try {
                if (typeof text !== 'string' || text.indexOf('payout') < 0) return;
                const data = JSON.parse(text);
                if (data && data.data) _extractPlays(data.data);
                if (data && data.payload && data.payload.data) _extractPlays(data.payload.data);
                if (Array.isArray(data)) data.forEach(function (item) {
                    if (item && item.data) _extractPlays(item.data);
                    if (item && item.payload && item.payload.data) _extractPlays(item.payload.data);
                });
            } catch (e) {}
        }
        const _origFetch = PAGE_WIN.fetch;
        PAGE_WIN.fetch = async function (...args) {
            const response = await _origFetch.apply(this, args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                if (url.includes('graphql') || url.includes('/main-api/')) {
                    response.clone().text().then(function (t) { _tryParseBet(t); }).catch(function () {});
                }
            } catch (e) {}
            return response;
        };
        const _origOpen = PAGE_WIN.XMLHttpRequest.prototype.open;
        const _origSend = PAGE_WIN.XMLHttpRequest.prototype.send;
        PAGE_WIN.XMLHttpRequest.prototype.open = function (method, url) {
            this._shuffleURL = (typeof url === 'string') ? url : '';
            return _origOpen.apply(this, arguments);
        };
        PAGE_WIN.XMLHttpRequest.prototype.send = function () {
            if (this._shuffleURL && (this._shuffleURL.includes('graphql') || this._shuffleURL.includes('/main-api/'))) {
                this.addEventListener('load', function () { _tryParseBet(this.responseText); });
            }
            return _origSend.apply(this, arguments);
        };
        const _origWS = PAGE_WIN.WebSocket;
        function ShuffleWS(url, protocols) {
            const ws = protocols ? new _origWS(url, protocols) : new _origWS(url);
            ws.addEventListener('message', function (ev) {
                if (typeof ev.data === 'string') _tryParseBet(ev.data);
            });
            return ws;
        }
        ShuffleWS.prototype = _origWS.prototype;
        ShuffleWS.CONNECTING = _origWS.CONNECTING;
        ShuffleWS.OPEN = _origWS.OPEN;
        ShuffleWS.CLOSING = _origWS.CLOSING;
        ShuffleWS.CLOSED = _origWS.CLOSED;
        PAGE_WIN.WebSocket = ShuffleWS;
    }

let ACTIVE_MODE = 'smart';
    let baseBet = 0.01;
    let manualBet = 0.01;          // Manual mode's wager (mirrors baseBet's role for Manual)
    let winIncreasePercent = 125;
    let lossStreakReset = 3;
    let winsBeforeReset = 5;
    let autoStopBalance = null;
    let minBaseBet = 0.01;
    let maxBaseBet = 99999999999999;
    let lastBetId = null;
    let lossStreak = 0;
    let counter = 0;
    // Shuffle-specific state: dedup between WS interceptor and DOM observer
    let _shuffleLastBetMs = 0;
    let _shuffleTransportLastMs = 0;
    const _shuffleSeenIds = new Set();
    const _shuffleSeenIdOrder = [];
    let _shuffleFeedObsEl = null;
    let _shuffleObsBalance = 0;
    let _shuffleBalObsEl = null;

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
    let lastAmount = null;
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
    let spacePressInterval = null;
    // --- Lock Aggression State variables ---
    let lockAggressionState = false;
    let lockedGearLevel = 1;

    GM_addStyle(`
        #ratchet-master-container,
        #ratchet-master-container * { box-sizing: border-box !important; }
        #ratchet-master-container {
            --hud-bg: rgba(15, 33, 46, 0.97);
            --hud-panel: linear-gradient(180deg, rgba(26, 44, 56, 0.98), rgba(15, 33, 46, 0.96));
            --hud-border: rgba(82, 109, 130, 0.55);

            --hud-border-soft: rgba(255, 255, 255, 0.06);
            --hud-green: #00ff9d;
            --hud-green-dark: #00cc7a;
            --hud-red: #e11d48;
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
            box-shadow: 0 18px
            50px rgba(0, 0, 0, 0.82) !important;
            z-index: auto !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 8px !important;
            font-family: "Proxima Nova", "Segoe UI", sans-serif !important;
            pointer-events: auto !important;
            overflow: hidden !important;
            backdrop-filter: blur(10px);
            line-height: 1.15;
        }
        #ratchet-master-container::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 0;
            pointer-events: none;
            opacity: 0;
            border: 1px solid transparent;
            box-shadow: inset 0 0 0 0 rgba(74, 222, 128, 0), inset 0 0 0 0 rgba(74, 222, 128, 0);
        }
        #ratchet-master-container.iow-win-reset-pulse::after { animation: ratchet-iow-win-reset-pulse 720ms ease-out 1;
        }
        @keyframes ratchet-iow-win-reset-pulse {
            0% { opacity: 0;
            }
            20% { opacity: 1;
            border-color: rgba(74, 222, 128, 0.9); box-shadow: inset 0 0 0 1px rgba(74, 222, 128, 0.75), inset 0 0 18px rgba(74, 222, 128, 0.35);
            }
            55% { opacity: 1;
            border-color: rgba(74, 222, 128, 0.8); box-shadow: inset 0 0 0 2px rgba(74, 222, 128, 0.85), inset 0 0 24px rgba(74, 222, 128, 0.45);
            }
            100% { opacity: 0; border-color: transparent;
            box-shadow: inset 0 0 0 0 rgba(74, 222, 128, 0), inset 0 0 0 0 rgba(74, 222, 128, 0);
            }
        }
        #ratchet-master-container[data-mode="iow"] { min-height: 0 !important;
        }
        #ratchet-master-container .hud-frame { display: flex; flex: 1 1 0; min-height: 0;
        min-width: 0; gap: 8px; overflow: hidden; }
        #ratchet-master-container .hud-workspace { display: flex;
        flex-direction: column; flex: 1 1 0; min-height: 0; min-width: 0; gap: 8px; overflow: hidden;
        }
        #ratchet-master-container .hud-native-sidebar-slot { display: flex; flex: 0 0 300px; width: 300px;
        min-width: 300px; max-width: 300px; min-height: 0; overflow: hidden; }
        #ratchet-master-container .hud-native-sidebar-slot:empty,
        #ratchet-master-container .hud-native-past-bets-slot:empty,
        #ratchet-master-container .hud-native-game-footer-slot:empty,
        #ratchet-master-container .hud-footer-slot:empty { display: none !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot > .game-sidebar { width: 100% !important; height: 100% !important;
        min-width: 0 !important; min-height: 0 !important; display: flex !important; flex-direction: column !important; gap: 0 !important; padding: 0 !important;
        overflow: auto !important; }
        #ratchet-master-container .hud-native-sidebar-slot .sticky-top,
        #ratchet-master-container .hud-native-sidebar-slot .sticky-bottom { position: relative !important;
        top: auto !important; bottom: auto !important; z-index: auto !important; flex: 0 0 auto !important; padding: 8px 8px 0 !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .sticky-bottom { padding: 0 8px 8px !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .sticky-top { margin-top: 40px !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content { flex: 1 1 0 !important; min-height: 0 !important;
        max-height: none !important; overflow: auto !important; padding: 0 8px !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .game-tabs { margin: 0 !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .tabs-wrapper,
        #ratchet-master-container .hud-native-sidebar-slot .slider,
        #ratchet-master-container .hud-native-sidebar-slot .content-wrapper { width: 100% !important;
        }
        #ratchet-master-container .hud-native-past-bets-slot { display: flex; flex: 0 0 auto; min-height: 42px;
        min-width: 0; overflow: hidden; }
        #ratchet-master-container .hud-native-past-bets-slot > .past-bets { width: 100% !important;
        min-width: 0 !important; display: flex !important; gap: 6px !important; padding: 6px !important; background: var(--hud-panel) !important; border: 1px solid var(--hud-border-soft) !important;
        border-radius: 12px !important; overflow-x: auto !important; overflow-y: hidden !important; }
        #ratchet-master-container .hud-native-past-bets-slot > .past-bets > button { flex: 0 0 auto !important;
        }
        /* Shuffle's recent-results feed lives inside .hud-native-past-bets-slot
           via syncNativeHudElements. Style it to look like Stake's past-bets row. */
        #ratchet-master-container .hud-native-past-bets-slot > [class*="OriginalGameRecentResult_originalGameResultsWrapper"] {
            width: 100% !important;
            min-width: 0 !important;
            display: flex !important;
            gap: 6px !important;
            padding: 6px !important;
            background: var(--hud-panel) !important;
            border: 1px solid var(--hud-border-soft) !important;
            border-radius: 12px !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            align-items: center !important;
        }
        #ratchet-master-container .hud-native-past-bets-slot > [class*="OriginalGameRecentResult_originalGameResultsWrapper"] > * {
            flex: 0 0 auto !important;
        }
        #ratchet-master-container #hud-content { display: flex; flex: 1 1 0; min-height: 0;
        min-width: 0; overflow: hidden; }
        #ratchet-master-container .hud-shell { display: flex; flex-direction: column;
        flex: 1 1 0; min-height: 0; min-width: 0; gap: 8px; overflow: hidden;
        }
        #ratchet-master-container .hud-panel { background: var(--hud-panel); border: 1px solid var(--hud-border-soft); border-radius: 12px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03); }
        #ratchet-master-container .mode-wrap { display: flex;
        flex: 0 0 auto; flex-wrap: nowrap; gap: 5px; background: #13232d; padding: 5px; border-radius: 12px;
        }
        #ratchet-master-container .mode-btn { flex: 1 1 0; min-width: 0; padding: 8px 12px;
        border: none; border-radius: 999px; font-size: 12px; font-weight: 900; cursor: pointer;
        transition: transform 0.18s ease, filter 0.18s ease, background 0.18s ease, color 0.18s ease; text-transform: uppercase; letter-spacing: 0.4px;
        }
        #ratchet-master-container .mode-btn.active { background: #00ff9d; color: #0f212e; box-shadow: 0 0 12px #00ff9d;
        }
        #ratchet-master-container .mode-btn:not(.active) { background: #2f4553; color: #94a3b8;
        }
        #ratchet-master-container .mode-btn:hover { filter: brightness(1.08); transform: translateY(-1px);
        }
        #ratchet-master-container .hud-top-bar, #ratchet-master-container .hud-controls-deck, #ratchet-master-container .hud-body, #ratchet-master-container .hud-split, #ratchet-master-container .input-row, #ratchet-master-container .input-cluster, #ratchet-master-container .btn-group, #ratchet-master-container .hud-stat-rail, #ratchet-master-container .hud-stats-grid, #ratchet-master-container .hud-meta-row, #ratchet-master-container .hud-header { display: flex;
        min-width: 0; }
        #ratchet-master-container .hud-header, #ratchet-master-container .hud-top-bar, #ratchet-master-container .hud-controls-deck { flex: 0 0 auto;
        }
        #ratchet-master-container .hud-top-bar, #ratchet-master-container .hud-controls-deck, #ratchet-master-container .hud-body, #ratchet-master-container .hud-split { gap: 8px;
        align-items: stretch; }
        #ratchet-master-container .hud-body, #ratchet-master-container .hud-split { flex: 1 1 0;
        min-height: 0; min-width: 0; overflow: hidden; flex-wrap: nowrap; }
        #ratchet-master-container .hud-header, #ratchet-master-container .input-row, #ratchet-master-container .hud-meta-row { justify-content: space-between;
        align-items: center; gap: 8px; }
        #ratchet-master-container .hud-pane, #ratchet-master-container .graph-col, #ratchet-master-container .stats-col { flex: 1 1 0;
        min-height: 0; min-width: 0; overflow: hidden; }
        #ratchet-master-container .hud-pane { display: flex;
        flex-direction: column; gap: 8px; }
        #ratchet-master-container .hud-pane.primary { flex: 1.15 1 0;
        }
        #ratchet-master-container .hud-pane.secondary, #ratchet-master-container .stats-col { flex: 0.95 1 0; display: flex;
        flex-direction: column; gap: 8px; }
        #ratchet-master-container .control-section { flex: 1 1 0;
        min-width: 0; padding: 10px; display: flex; flex-direction: column; gap: 8px;
        }
        #ratchet-master-container .input-row { align-items: flex-end; flex-wrap: nowrap;
        }
        #ratchet-master-container .input-cluster { flex: 1 1 0; flex-wrap: wrap; align-items: flex-end;
        gap: 8px; min-width: 0; }
        #ratchet-master-container .input-group { display: flex; align-items: center;
        gap: 5px; flex: 0 0 auto; }
        #ratchet-master-container .quick-btn { padding: 0;
        width: 26px; height: 26px; font-size: 10px; font-weight: 900; background: #1a2c38; border: 1px solid #2f4553; color: #fff; border-radius: 6px; cursor: pointer;
        flex: 0 0 auto; }
        #ratchet-master-container .quick-btn:hover { background: #2f4553;
        }
        #ratchet-master-container input[type="number"] { background: #0b0e17; border: 1px solid #2f4553; color: white;
        padding: 5px 6px; border-radius: 7px; width: 76px; font-size: 12px; font-weight: 700; text-align: center; outline: none;
        }
        #ratchet-master-container input[type="number"]:focus { border-color: var(--hud-green);
        box-shadow: 0 0 0 2px rgba(0, 255, 157, 0.12); }
        #ratchet-master-container .hud-risk-container { display: flex;
        flex: 1 1 100%; flex-wrap: nowrap; gap: 6px; min-width: 0;
        }
        #ratchet-master-container .hud-risk-container label { color: #94a3b8; font-size: 10px; font-weight: 800; display: flex;
        flex-direction: column; justify-content: space-between; gap: 4px; text-transform: uppercase; flex: 1 1 0; min-width: 0;
        }
        #ratchet-master-container .hud-risk-container input[type="number"] { width: 100%; min-width: 0;
        }
        #ratchet-master-container .btn-group { align-items: stretch; gap: 6px; flex-wrap: nowrap; justify-content: flex-end;
        flex: 0 0 auto; }
        #ratchet-master-container .hud-rapid-btn, #ratchet-master-container .hud-reset-btn { min-height: 38px;
        }
        #ratchet-master-container .hud-rapid-btn { border: none; color: #fff; font-size: 12px; font-weight: 900;
        padding: 8px 16px; border-radius: 9px; cursor: pointer; min-width: 108px; letter-spacing: 0.5px; text-transform: uppercase; flex: 1 1 0;
        }
        #ratchet-master-container .hud-rapid-btn.start { background: var(--hud-green); color: #0f212e;
        }
        #ratchet-master-container .hud-rapid-btn.start:hover { background: var(--hud-green-dark);
        }
        #ratchet-master-container .hud-rapid-btn.stop { background: var(--hud-red);
        }
        #ratchet-master-container .hud-rapid-btn.stop:hover { background: #be123c;
        }
        #ratchet-master-container .hud-reset-btn { background: transparent; border: 1px solid var(--hud-red); color: var(--hud-red);
        font-size: 11px; font-weight: 900; padding: 8px 14px; border-radius: 9px; cursor: pointer; flex: 1 1 0;
        }
        #ratchet-master-container .hud-reset-btn:hover { background: var(--hud-red); color: #fff;
        }
        /* Switch Over/Under — neutral cyan, distinct from green start and red reset. */
        #ratchet-master-container .hud-switch-ou-btn { background: transparent; border: 1px solid #06b6d4; color: #06b6d4;
        font-size: 11px; font-weight: 900; padding: 8px 14px; border-radius: 9px; cursor: pointer; flex: 1 1 0; min-height: 38px; letter-spacing: 0.4px; text-transform: uppercase; transition: background 0.18s, color 0.18s; line-height: 1.1;
        }
        #ratchet-master-container .hud-switch-ou-btn:hover { background: #06b6d4; color: #0f212e;
        }
        #ratchet-master-container .status-bar { background: var(--hud-panel); padding: 8px 10px; border-radius: 12px; text-align: center;
        font-size: 13px; font-weight: 900; letter-spacing: 0.2px; border: 1px solid var(--hud-border-soft); display: flex; align-items: center; justify-content: center; min-height: 42px;
        flex: 0 0 auto; }
        #ratchet-master-container .hud-graph-box { flex: 1 1 0;
        min-height: 0; height: 100%; background: linear-gradient(180deg, rgba(11, 14, 23, 0.96), rgba(15, 33, 46, 0.98)); border: 1px solid #2f4553; border-radius: 12px;
        overflow: hidden; position: relative; display: flex; }
        #ratchet-master-container .hud-graph-box canvas { width: 100%;
        height: 100%; display: block; flex: 1 1 auto; }
        #ratchet-master-container .hud-header { padding: 0 2px;
        }
        #ratchet-master-container .hud-header h2 { margin: 0; color: #fff; font-size: 14px; font-weight: 900;
        letter-spacing: 0.8px; text-transform: uppercase; }
        #ratchet-master-container .hud-target-text { color: #b1bad3; font-size: 12px;
        font-weight: 800; font-style: italic; letter-spacing: 0.2px; }
        /* Controls-deck layout: wrap onto multiple rows, align labels at the
           bottom, separate columns and rows independently so a wrapped row
           sits closer to the row above than control-groups within a row. */
        #ratchet-master-container .hud-controls-deck { padding: 10px;
        border-radius: 12px; border: 1px solid var(--hud-border-soft); background: var(--hud-panel);
        flex-wrap: wrap; column-gap: 12px; row-gap: 8px; align-items: flex-end;
        }
        /* Each control-group sizes to its content; ranges expand to fill */
        #ratchet-master-container .hud-control-group { display: flex; flex-direction: column; gap: 4px;
        flex: 0 1 auto; min-width: 0; max-width: 100%; }
        #ratchet-master-container .hud-control-group:has(input[type="range"]) { flex: 1 1 160px;
        min-width: 140px; }
        /* Labels stay on one line so they never wrap and overlap their input */
        #ratchet-master-container .hud-control-group label { color: #94a3b8;
        font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.02em;
        white-space: nowrap; overflow: visible; display: flex; justify-content: space-between; gap: 6px;
        }
        #ratchet-master-container .hud-control-group input[type="range"] { width: 100%; height: 6px; accent-color: #00ff9d; cursor: pointer;
        }
        #ratchet-master-container .hud-control-group input[type="number"] { width: 100%;
        }
        /* LOCK OPTION STYLES */
        #ratchet-master-container select { background: #0b0e17;
        border: 1px solid #2f4553; color: white; padding: 4px 6px; border-radius: 7px; font-size: 11px; font-weight: 700; width: 100%; outline: none;
        appearance: auto; }
        #ratchet-master-container select:disabled { opacity: 0.4; cursor: not-allowed;
        }
        #ratchet-master-container input[type="checkbox"] { accent-color: #00ff9d; cursor: pointer; margin: 0; width: 14px;
        height: 14px; }
        #ratchet-master-container .hud-stat-rail { flex: 1 1 0; min-height: 0;
        min-width: 0; flex-direction: column; gap: 8px; overflow: hidden; }
        #ratchet-master-container .hud-stats-grid { flex: 1 1 0;
        min-height: 0; min-width: 0; gap: 8px; flex-wrap: wrap; align-content: stretch; overflow: hidden;
        }
        #ratchet-master-container .stats-col-inner, #ratchet-master-container .hud-stat-card { flex: 1 1 calc(50% - 4px);
        min-height: 0; min-width: 0; background: var(--hud-panel); padding: 10px; border-radius: 12px; border: 1px solid var(--hud-border-soft); display: flex; flex-direction: column; gap: 6px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03); overflow: hidden;
        }
        #ratchet-master-container .hud-row { display: flex; justify-content: space-between; align-items: center; gap: 8px;
        min-width: 0; padding: 6px 8px; background: rgba(255, 255, 255, 0.04); border-radius: 8px; flex: 1 1 0; min-height: 0;
        }
        #ratchet-master-container .hud-label { color: #b1bad3; font-size: 10px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.3px; }
        #ratchet-master-container .hud-val { color: #fff; font-size: 12px; font-weight: 800;
        font-family: "Roboto Mono", monospace; text-align: right; }
        #ratchet-master-container .hud-meta-row { gap: 8px;
        padding: 0 2px; flex: 0 0 auto; }
        #ratchet-master-container .hud-meta-chip { display: flex;
        align-items: center; justify-content: space-between; gap: 8px; flex: 1 1 0; min-width: 0; padding: 8px 10px; background: var(--hud-panel);
        border: 1px solid var(--hud-border-soft); border-radius: 10px; overflow: hidden; }
        #ratchet-master-container .gear-text { font-style: italic;
        font-weight: 900; text-transform: uppercase; }
        #ratchet-master-container .gear-1-text { color: #94a3b8;
        }
        #ratchet-master-container .gear-2-text { color: #cbd5e1;
        }
        #ratchet-master-container .gear-3-text { color: #facc15;
        }
        #ratchet-master-container .gear-4-text { color: #fb923c;
        }
        #ratchet-master-container .gear-5-text { color: #f43f5e;
        text-shadow: 0 0 8px rgba(244, 63, 94, 0.4); }
        #ratchet-master-container .hud-footer-slot { display: flex;
        flex: 0 0 auto; min-width: 0; min-height: 88px; max-height: 88px; overflow: hidden;
        }
        #ratchet-master-container .hud-footer-slot > .footer, #ratchet-master-container .hud-footer-slot > .footer.svelte-fjwd2n { width: 100%;
        height: 100%; margin: auto !important; position: relative !important; left: auto !important; right: auto !important; bottom: auto !important; border-radius: 10px;
        overflow: hidden; }
        #ratchet-master-container .hud-footer-slot [class*="input-wrap"] { border-radius: 10px !important;
        }
        #ratchet-master-container .hud-footer-slot label:has([data-testid="reverse-roll"]) { min-width: 0 !important;
        }
        #ratchet-master-container .hud-footer-slot label:has([data-testid="reverse-roll"]) [class*="label-content"] { color: #b1bad3 !important; font-size: 12px !important;
        font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; }
        #ratchet-master-container .hud-footer-slot label:has([data-testid="reverse-roll"]) [class*="label-left-wrapper"] { justify-content: flex-start !important;
        width: auto !important; }
        #ratchet-master-container .hud-footer-slot [class*="input-wrap"]:has([data-testid="reverse-roll"]) { border: 1px solid #2f4553 !important;
        border-radius: 10px !important; background: linear-gradient(180deg, rgba(26, 44, 56, 0.98), rgba(15, 33, 46, 0.96)) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; overflow: hidden !important; padding: 0 10px !important;
        }
        #ratchet-master-container .hud-footer-slot [class*="input-content"]:has([data-testid="reverse-roll"]) { display: flex !important; align-items: center !important;
        gap: 8px !important; width: 100% !important; }
        #ratchet-master-container .hud-footer-slot [class*="input-content"]:has(input[data-testid="reverse-roll"]) [class*="after-icon"] { width: auto !important;
        min-width: 20px !important; height: 100% !important; display: flex !important; align-items: center !important; justify-content: center !important; color: #9fb3c8 !important;
        flex: 0 0 auto !important; margin-left: auto !important; }
        #ratchet-master-container .hud-footer-slot input[data-testid="reverse-roll"] { appearance: none !important;
        -webkit-appearance: none !important; display: block !important; flex: 0 0 96px !important; width: 96px !important; min-width: 96px !important; max-width: 96px !important;
        height: 28px !important; padding: 0 10px !important; border: none !important; border-radius: 7px !important; background: #0b0e17 !important; color: #e2e8f0 !important;
        font-size: 12px !important; font-weight: 800 !important; font-family: "Roboto Mono", monospace !important; text-align: left !important; box-shadow: none !important; white-space: nowrap !important;
        transition: transform 0.18s ease, filter 0.18s ease !important; cursor: pointer !important; outline: none !important;
        }
        #ratchet-master-container .hud-footer-slot input[data-testid="reverse-roll"]:hover { filter: brightness(1.08);
        }
        #ratchet-master-container .hud-footer-slot [class*="input-wrap"]:has([data-testid="reverse-roll"]):hover { border-color: rgba(0, 255, 157, 0.55) !important;
        }
        #ratchet-master-container .hud-footer-slot input[data-testid="reverse-roll"]:active { transform: translateY(1px);
        }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] { min-width: 0 !important;
        }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] [class*="label-content"] { color: #b1bad3 !important; font-size: 12px !important;
        font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] [class*="label-left-wrapper"] { justify-content: flex-start !important;
        width: auto !important; }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] [class*="input-wrap"] { border: 1px solid #2f4553 !important;
        border-radius: 10px !important; background: linear-gradient(180deg, rgba(26, 44, 56, 0.98), rgba(15, 33, 46, 0.96)) !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; overflow: hidden !important; padding: 0 10px !important;
        }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] [class*="input-content"] { display: flex !important; align-items: center !important;
        gap: 8px !important; width: 100% !important; }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] [class*="input-content"] [class*="after-icon"] { width: auto !important;
        min-width: 20px !important; height: 100% !important; display: flex !important; align-items: center !important; justify-content: center !important; color: #9fb3c8 !important;
        flex: 0 0 auto !important; margin-left: auto !important; }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] input { appearance: none !important;
        -webkit-appearance: none !important; display: block !important; flex: 0 0 96px !important; width: 96px !important; min-width: 96px !important; max-width: 96px !important;
        height: 28px !important; padding: 0 10px !important; border: none !important; border-radius: 7px !important; background: #0b0e17 !important; color: #e2e8f0 !important;
        font-size: 12px !important; font-weight: 800 !important; font-family: "Roboto Mono", monospace !important; text-align: left !important; box-shadow: none !important; white-space: nowrap !important;
        outline: none !important; }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field] input[data-testid="reverse-roll"] { cursor: pointer !important;
        transition: transform 0.18s ease, filter 0.18s ease !important; }
        #ratchet-master-container .hud-footer-slot label[data-ratchet-footer-field]:hover [class*="input-wrap"] { border-color: rgba(0, 255, 157, 0.55) !important;
        }
        #ratchet-master-container .hud-native-game-footer-slot { display: flex; flex: 0 0 auto; min-height: 56px;
        min-width: 0; overflow: hidden; }
        #ratchet-master-container .hud-native-game-footer-slot > .game-footer { width: 100% !important;
        height: auto !important; min-height: 56px !important; background: var(--hud-panel) !important; border: 1px solid var(--hud-border-soft) !important; border-radius: 12px !important; overflow: hidden !important;
        }
        #ratchet-master-container .hud-native-game-footer-slot > .game-footer > .stack { width: 100% !important;
        min-height: 56px !important; padding-right: 10px !important; }
        #ratchet-master-container .hud-native-game-footer-slot > .game-footer > .flex.items-center.absolute { display: none !important;
        }
        #ratchet-master-container .hud-native-game-footer-slot > .game-footer .right { margin-left: auto !important;
        }
        @media (max-width: 980px) {
            #ratchet-master-container { padding: 6px !important;
            }
            #ratchet-master-container .hud-frame { flex-direction: column !important;
            }
            #ratchet-master-container .hud-native-sidebar-slot { width: 100% !important;
            min-width: 0 !important; max-width: none !important; flex: 0 0 auto !important; max-height: 330px !important;
            }
        }
        .result.svelte-1oweb16, .multiplier-result, .result-multiplier, .crash-result, .limbo-result, [class*="crash"], [class*="result"][class*="multiplier"], span.result { display: none !important;
        }

        /* UNIFIED STYLING FOR THE SCROLLABLE BETTING AREA */
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content {
            background: var(--hud-panel) !important;
            border: 1px solid var(--hud-border-soft) !important;
            border-radius: 12px !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03) !important;
            margin: 4px 8px !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content .input-wrap,
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content .state-layer-surface {
            background: #0b0e17 !important;
            border: 1px solid #2f4553 !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content input {
            background: #0b0e17 !important;
            color: #fff !important;
            border: 1px solid #2f4553 !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content button {
            background: #1a2c38 !important;
            color: #b1bad3 !important;
            border: 1px solid #2f4553 !important;
        }
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content button:hover {
            background: #2f4553 !important;
            color: #fff !important;
            filter: brightness(1.1);
        }
        #ratchet-master-container .hud-native-sidebar-slot .scrollable-content .ds-body-md-strong {
            color: #b1bad3 !important;
        }

        /* ==================== SHUFFLE THEME ==================== */
        /* Purple palette + full-overlay positioning that covers Shuffle's
           native dice/limbo content area. Activated by .shuffle-theme on
           the HUD root (toggled in buildHUD when on shuffle.us/com). */
        #ratchet-master-container.shuffle-theme {
            --hud-green: #6c47ff;
            --hud-green-dark: #4f35b3;
            --hud-bg: rgba(10, 8, 24, 0.97);
            --hud-panel: linear-gradient(180deg, rgba(26, 18, 56, 0.98), rgba(10, 8, 24, 0.96));
            --hud-border: rgba(108, 71, 255, 0.5);
            --hud-border-soft: rgba(108, 71, 255, 0.18);
            top: 0 !important;
            bottom: auto !important;
            left: 0 !important;
            right: 0 !important;
            inset: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            min-height: 420px !important;
            max-height: none !important;
        }
        /* Shuffle: ensure flex sections have room so graph doesn't collapse */
        #ratchet-master-container.shuffle-theme #hud-content { flex: 1 1 0; min-height: 250px !important; }
        #ratchet-master-container.shuffle-theme .hud-shell { flex: 1 1 0; min-height: 240px !important; }
        #ratchet-master-container.shuffle-theme .hud-body,
        #ratchet-master-container.shuffle-theme .hud-split { min-height: 200px !important; }
        #ratchet-master-container.shuffle-theme .hud-pane { min-height: 180px !important; }
        #ratchet-master-container.shuffle-theme .hud-footer-slot { min-height: 0; max-height: none; flex: 0 0 auto; }
        /* Shuffle: collapse the row-direction .hud-frame + .hud-workspace
           wrappers into a single column flow so mode-wrap can't get
           clipped by inherited overflow:hidden on those wrappers. */
        #ratchet-master-container.shuffle-theme .hud-frame {
            flex-direction: column !important;
            overflow: visible !important;
            gap: 6px !important;
        }
        #ratchet-master-container.shuffle-theme .hud-workspace {
            overflow: visible !important;
            min-height: 0 !important;
        }
        /* Always show the sidebar slot as collapsed on Shuffle (no game-sidebar) */
        #ratchet-master-container.shuffle-theme .hud-native-sidebar-slot { display: none !important; }
        /* Hard-force mode-wrap visible & sized so it can never be clipped */
        #ratchet-master-container.shuffle-theme .mode-wrap {
            background: #140d2e;
            display: flex !important;
            flex: 0 0 auto !important;
            min-height: 38px !important;
            visibility: visible !important;
            opacity: 1 !important;
            z-index: 5 !important;
            position: relative !important;
        }
        #ratchet-master-container.shuffle-theme .mode-wrap .mode-btn {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            visibility: visible !important;
            opacity: 1 !important;
        }
        #ratchet-master-container.shuffle-theme .mode-btn.active { background: #6c47ff !important; color: #fff !important; box-shadow: 0 0 12px #6c47ff !important; }
        #ratchet-master-container.shuffle-theme .mode-btn:not(.active) { background: #2a1a52; color: #7c5cbf; }
        #ratchet-master-container.shuffle-theme .hud-rapid-btn.start { color: #fff; }
        #ratchet-master-container.shuffle-theme .hud-rapid-btn.start:hover { background: var(--hud-green-dark); }
        #ratchet-master-container.shuffle-theme input[type="number"]:focus { border-color: var(--hud-green); box-shadow: 0 0 0 2px rgba(108, 71, 255, 0.18); }
        #ratchet-master-container.shuffle-theme .hud-control-group input[type="range"] { accent-color: var(--hud-green); }
        /* Shuffle native footer relocated into the HUD slot. Match the current
           module names (MultiplierWinChanceFooter = Limbo, DiceGameFooter = Dice)
           as well as the legacy hashed class, so the relocated row fills the slot
           instead of staying absolutely positioned at the bottom of the game. */
        #ratchet-master-container .hud-footer-slot [class*="TBYuRq__footer"],
        #ratchet-master-container .hud-footer-slot [class*="MultiplierWinChanceFooter"],
        #ratchet-master-container .hud-footer-slot [class*="DiceGameFooter"] {
            width: 100% !important; position: relative !important; left: auto !important;
            right: auto !important; bottom: auto !important; border-radius: 10px !important;
            overflow: hidden !important; flex: 1 1 auto !important;
        }
        #ratchet-master-container .hud-footer-slot [class*="DimmedWrapper"],
        #ratchet-master-container .hud-footer-slot [class*="DimOverlay"] { opacity: 1 !important; pointer-events: auto !important; }
        #ratchet-master-container .hud-footer-slot [data-sharkid] { color: #fff !important; background: transparent !important; }

        /* ---- Shuffle dice info panel (roll-over bar) ---- */
        #ratchet-master-container .shuffle-dice-panel { display: flex; flex-direction: column; gap: 5px; padding: 7px 10px; background: var(--hud-panel); border: 1px solid var(--hud-border-soft); border-radius: 12px; width: 100%; }
        #ratchet-master-container .dice-bar-wrapper { display: flex; flex-direction: column; gap: 3px; }
        #ratchet-master-container .dice-bar-ticks { display: flex; justify-content: space-between; padding: 0 1px; }
        #ratchet-master-container .dice-bar-ticks span { color: #b1bad3; font-size: 9px; font-weight: 700; }
        #ratchet-master-container .dice-bar-line { position: relative; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: visible; }
        #ratchet-master-container .dice-bar-fill { position: absolute; top: 0; height: 100%; border-radius: 3px; background: var(--hud-green); opacity: 0.55; transition: width 0.25s, left 0.25s; }
        #ratchet-master-container .dice-bar-thumb { position: absolute; top: 50%; transform: translate(-50%, -50%); width: 3px; height: 14px; background: #fff; border-radius: 2px; transition: left 0.25s; }
        #ratchet-master-container .di-range-overlay { position: absolute; inset: -5px 0; width: 100%; opacity: 0; cursor: pointer; z-index: 2; margin: 0; }
    `);

    /* ==================== SHUFFLE DICE INFO PANEL ==================== */
    function getDiceInfo() {
        const rvEl = document.querySelector('#rollver-input');
        const rollOver = rvEl ? parseFloat(rvEl.value) || 50.5 : 50.5;
        let multiplier = 2, chance = 49.5;
        document.querySelectorAll('label').forEach(lbl => {
            const inp = lbl.parentElement && lbl.parentElement.querySelector('input');
            if (!inp) return;
            const t = (lbl.textContent || '').trim();
            const v = parseFloat(inp.value);
            if (t === 'Multiplier' && !isNaN(v)) multiplier = v;
            else if (t === 'Chance' && !isNaN(v)) chance = v;
        });
        const higherBar = document.querySelector('[class*="higherBar"]');
        const isRollOver = higherBar ? higherBar.className.includes('isRollOver') : true;
        return { multiplier, rollOver, chance, isRollOver };
    }
    function buildDiceInfoPanel() {
        const footerSlot = document.getElementById('hud-footer-slot');
        if (!footerSlot) return;
        const isDice = window.location.pathname.toLowerCase().includes('/dice');
        if (!isShuffle() || !isDice) {
            const existing = document.getElementById('shuffle-dice-panel');
            if (existing) existing.remove();
            return;
        }
        if (document.getElementById('shuffle-dice-panel')) return;
        const { rollOver, isRollOver } = getDiceInfo();
        const fillStyle = isRollOver
            ? 'left:' + rollOver + '%;width:' + (100 - rollOver).toFixed(2) + '%'
            : 'left:0;width:' + rollOver.toFixed(2) + '%';
        const dicePanel = document.createElement('div');
        dicePanel.id = 'shuffle-dice-panel';
        dicePanel.className = 'shuffle-dice-panel';
        dicePanel.innerHTML =
            '<div class="dice-bar-wrapper">' +
              '<div class="dice-bar-ticks"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>' +
              '<div class="dice-bar-line">' +
                '<div id="di-bar-fill" class="dice-bar-fill" style="' + fillStyle + '"></div>' +
                '<div id="di-bar-thumb" class="dice-bar-thumb" style="left:' + rollOver.toFixed(2) + '%"></div>' +
                '<input id="di-range" type="range" min="2" max="98" step="0.01" value="' + rollOver.toFixed(2) + '" class="di-range-overlay">' +
              '</div>' +
            '</div>';
        footerSlot.insertBefore(dicePanel, footerSlot.firstChild);
        attachDiceInputListeners();
    }
    function attachDiceInputListeners() {
        function pushToGame(sharkId, value) {
            const gameInput = document.querySelector('[data-sharkid="' + sharkId + '"]');
            if (!gameInput) return;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(gameInput, String(value));
            ['input', 'change', 'blur'].forEach(t => gameInput.dispatchEvent(new Event(t, { bubbles: true })));
        }
        const rangeInp = document.getElementById('di-range');
        if (rangeInp) rangeInp.addEventListener('input', () => {
            const v = parseFloat(rangeInp.value);
            if (!isNaN(v)) pushToGame('__2', v.toFixed(2));
        });
    }
    function updateDiceInfoPanel() {
        const isDice = window.location.pathname.toLowerCase().includes('/dice');
        if (!isShuffle() || !isDice) return;
        if (!document.getElementById('shuffle-dice-panel')) { buildDiceInfoPanel(); return; }
        const { rollOver, isRollOver } = getDiceInfo();
        const active = document.activeElement;
        const rangeEl = document.getElementById('di-range');
        if (rangeEl && active !== rangeEl) rangeEl.value = rollOver.toFixed(2);
        const fill = document.getElementById('di-bar-fill');
        if (fill) {
            if (isRollOver) { fill.style.left = rollOver.toFixed(2) + '%'; fill.style.width = (100 - rollOver).toFixed(2) + '%'; }
            else { fill.style.left = '0'; fill.style.width = rollOver.toFixed(2) + '%'; }
        }
        const thumb = document.getElementById('di-bar-thumb');
        if (thumb) thumb.style.left = rollOver.toFixed(2) + '%';
    }
    let _clampLast = 0;
    function clampHUDAboveShuffleFooter() {
        if (!isShuffle()) return;
        const footerSlot = document.getElementById('hud-footer-slot');
        const nativeFooter = document.querySelector('[class*="TBYuRq__footer"]');
        // If native footer is already inside our HUD slot, no clamping needed
        if (footerSlot && nativeFooter && footerSlot.contains(nativeFooter)) return;
        const now = Date.now();
        if (now - _clampLast < 3000) return;
        _clampLast = now;
        const hud = document.getElementById('ratchet-master-container');
        if (!hud || !nativeFooter) return;
        const footerH = Math.round(nativeFooter.getBoundingClientRect().height);
        if (footerH > 0) hud.style.bottom = (footerH + 4) + 'px';
    }

    function getUserSetMultiplier() {
        const isDice = window.location.pathname.toLowerCase().includes('/dice');
        if (isShuffle()) {
            // Shuffle's DiceGameFooter has two inputs both with id="betInfo"
            // (Multiplier and Chance) inside .InfoBetInput_inputContainer
            // wrappers. Pick the one whose container has the "Multiplier"
            // label. Fall back to legacy selectors in case Shuffle restores
            // them in a future deploy.
            const containers = document.querySelectorAll('[class*="InfoBetInput_inputContainer"]');
            for (const c of containers) {
                const labelText = (c.querySelector('label, span, p')?.textContent || '').trim();
                if (labelText === 'Multiplier') {
                    const inp = c.querySelector('input');
                    if (inp && inp.value) return parseFloat(inp.value) || 2;
                }
            }
            const mI = document.querySelector('input[data-sharkid="__3"]') ||
                       document.querySelector('input[data-testid="target-multiplier"], input[placeholder*="Multiplier"]');
            return mI ? parseFloat(mI.value) || 2 : 2;
        }
        if (isDice) {
            let inp = document.querySelector('input[data-testid="payout"]');
            if (inp) return parseFloat(inp.value) || 1.01;
            const winningsLabels = document.querySelectorAll('span, label, div');
            for (let el of winningsLabels) {
                if ((el.textContent || '').trim() === 'Winnings' || (el.getAttribute && el.getAttribute('slot') === 'label' && el.textContent.trim() === 'Winnings')) {
                    let container = el.closest('label') ||
                    el.parentElement;
                    if (container && container.shadowRoot) {
                        inp = container.shadowRoot.querySelector('input[data-testid="payout"], input[type="number"]');
                        if (inp) return parseFloat(inp.value) || 1.01;
                    }
                    if (container) {
                        inp = container.querySelector('input[data-testid="payout"], input[type="number"]');
                        if (inp) return parseFloat(inp.value) || 1.01;
                    }
                }
            }
            inp = document.querySelector('input[min="1.0102"], input[data-testid="payout"]');
            if (inp) return parseFloat(inp.value) || 1.01;
            return 1.01;
        }
        const mI = document.querySelector('input[data-testid="target-multiplier"]');
        return mI ? parseFloat(mI.value) || 2 : 2;
    }
    function getLatestBetEntry(container = pastBetsContainer || findPastBetsContainer()) {
        if (!container) return null;
        const element = container.querySelector('button[data-last-bet-index="0"]');
        if (!element) return null;
        const id = element.getAttribute('data-past-bet-id') || element.getAttribute('data-bet-id') || element.getAttribute('aria-label') || element.textContent.trim();
        return id ? { element, id } : null;
    }
    function syncLastSeenBet(container = pastBetsContainer || findPastBetsContainer()) {
        const latestBet = getLatestBetEntry(container);
        lastBetId = latestBet ? latestBet.id : null;
    }
    function triggerWinResetPulse() {
        const hud = document.getElementById('ratchet-master-container');
        if (!hud || ACTIVE_MODE !== 'iow') return;
        if (winResetPulseTimer) clearTimeout(winResetPulseTimer);
        hud.classList.remove('iow-win-reset-pulse');
        void hud.offsetWidth;
        hud.classList.add('iow-win-reset-pulse');
        winResetPulseTimer = setTimeout(() => {
            hud.classList.remove('iow-win-reset-pulse');
            winResetPulseTimer = null;
        }, 800);
    }
    function syncFooterFieldStyles() {
        const footerSlot = document.getElementById('hud-footer-slot');
        if (!footerSlot) return;
        const footerLabels = footerSlot.querySelectorAll('label');
        footerLabels.forEach(label => {
            label.removeAttribute('data-ratchet-footer-field');
            const labelTextEl = label.querySelector('[slot="label"], [class*="label-content"]');
            const labelText = (labelTextEl ? labelTextEl.textContent : label.textContent || '').replace(/\s+/g, ' ').trim();
            if (labelText === 'Winnings' || labelText === 'Roll Over' || labelText === 'Win Chance') {

                label.setAttribute('data-ratchet-footer-field', 'true');
            }
        });
    }
    function syncModeButtons() {
        document.querySelectorAll('#ratchet-master-container .mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.id === `mode-${ACTIVE_MODE}`);
        });
    }
    function getHudHost() {
        if (isShuffle()) {
            // Preferred mount: GameLayout_gameContent — sibling of the
            // sidebar (so we don't cover the native bet panel) and spans the
            // entire right-side game area top to bottom. Larger than the
            // inner DiceGameContent_root by ~24px on all sides, so the HUD's
            // purple overlay fills the visible space the way Stake's does.
            const gameContent = document.querySelector('[class*="GameLayout_gameContent"]');
            if (gameContent) {
                const r = gameContent.getBoundingClientRect();
                if (r.height >= 400 && r.width >= 400) return gameContent;
            }
            // Fallback: walk up from the rolling bar (which only exists
            // inside the dice/limbo game UI) until we find a container
            // that's at least 400px tall.
            const rollingBar = document.querySelector('[class*="rollingWrapper"], [class*="DiceGameRollingBar"], [class*="RollingBar"]');
            if (rollingBar) {
                let p = rollingBar.parentElement;
                for (let i = 0; i < 6 && p; i++) {
                    const r = p.getBoundingClientRect();
                    if (r.height >= 400) return p;
                    p = p.parentElement;
                }
            }
            // Returns null when no Shuffle game container is on the page —
            // buildHUD then tears the HUD down. Previously this fell back to
            // <main>, which caused the absolute-positioned overlay to cover
            // shuffle.us/ (home page / lobby) after SPA navigation away from
            // /dice or /limbo.
            return document.querySelector('[class*="OriginalGameContentWrapper"]')
                || document.querySelector('[class*="DiceGameContent"]')
                || document.querySelector('[class*="LimboGameContent"]')
                || document.querySelector('[class*="GameContentWrapper"]')
                || document.querySelector('[data-testid="game-view"]')
                || document.querySelector('.game-content')
                || null;
        }
        return document.querySelector('div[data-testid="game-frame"]')
            ||
            document.querySelector('.game-frame')
            ||
            document.querySelector('.game-content')
            || document.querySelector('[data-testid="game-view"]');
    }
    // Detect the bottom edge of Shuffle's fixed global nav so the HUD can
    // start below it instead of being hidden behind. Cached in a ref so we
    // don't query every tick. */
    function getShuffleHeaderBottom() {
        // Likely candidates: a fixed/sticky header at the top of the page
        const candidates = [
            'header',
            '[class*="GlobalHeader"]',
            '[class*="globalHeader"]',
            '[class*="TopBar"]',
            '[class*="topbar"]',
            '[class*="MainHeader"]',
            '[class*="NavHeader"]',
            'nav[class*="header"]'
        ];
        let bestBottom = 0;
        for (const sel of candidates) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                const cs = getComputedStyle(el);
                if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
                const r = el.getBoundingClientRect();
                if (r.top <= 4 && r.bottom > bestBottom && r.bottom < 200) {
                    bestBottom = r.bottom;
                }
            }
        }
        return bestBottom;
    }
    // True when el is inside our own HUD, a native modal/dialog, or the chat
    // drawer — OR when it CONTAINS a chat subtree. Stake renders Hotkeys/Game-Info
    // as .game-modal / [data-modal-root] (NOT role=dialog), and wraps chat's
    // message box in a bare `.footer` whose only chat marker (.chat-input) is a
    // DESCENDANT — so both an ancestor and a descendant check are needed. Used to
    // stop HUD relocation from yanking overlay DOM in (which broke chat/settings).
    function isOverlayNode(el) {
        if (!el) return true;
        // Also exclude the Advanced IOW tool's own panel (#dt-aio-panel / .dt-body):
        // its calculator has ~46 inputs and a "Multiplier" label, which the Shuffle
        // footer's label fallback would otherwise grab and rip into the footer slot.
        if (el.closest('#ratchet-master-container, #dt-aio-panel, #dt-aio-button, .dt-body, ' +
                       '[role="dialog"], [aria-modal="true"], [data-modal-root], ' +
                       '.game-modal, [class*="game-modal" i], ' +
                       '[data-testid*="chat" i], [data-test*="chat" i], [class*="chat" i]')) return true;
        if (el.querySelector('.chat-input, [class*="chat-input" i], [data-testid*="chat" i]')) return true;
        return false;
    }
    function findNativeElement(selector) {
        // Only adopt native game chrome — never HUD-internal nodes, a modal, or the
        // chat drawer. If the only matches are overlay/HUD, return null so
        // mountSingleElement leaves the slot untouched (idempotent, no false grab).
        const host = getHudHost();
        const scope = host || document;
        const scoped = Array.from(scope.querySelectorAll(selector)).filter(el => !isOverlayNode(el));
        if (scoped.length) return scoped[0];
        const fallback = Array.from(document.querySelectorAll(selector)).filter(el => !isOverlayNode(el));
        return fallback[0] || null;
    }
    function findShuffleFooter() {
        // Shuffle's CSS-module hashes change on every deploy, so anchor on stable
        // module *names* and on the actual Multiplier/Chance inputs rather than
        // volatile hashes. Verified against shuffle.us (2026-07):
        //   - Limbo -> MultiplierWinChanceFooter_footer___<hash>  (2 inputs)
        //   - Dice  -> DiceGameFooter_footer___<hash>             (3 inputs)
        // The old broad selector matched OriginalGameRuntime_gameFooter (the
        // settings/fairness toolbar, 0 inputs) via [class*="gameFooter"], which
        // is why the Multiplier / Chance row went missing from the HUD.
        const inOverlay = isOverlayNode; // shared guard: dialog/.game-modal/chat (+chat descendant)
        // 1) Limbo's dedicated Multiplier/Win-Chance footer (stable module name).
        const mwc = document.querySelector('[class*="MultiplierWinChanceFooter"]');
        if (mwc && !inOverlay(mwc)) return mwc;
        // 2) Anchor on the bet-input wrappers (Multiplier/Chance live inside
        //    InfoBetInput_inputContainer) and walk up to the nearest ancestor
        //    holding both inputs — the game footer — with no hash dependency.
        //    Catches Dice's DiceGameFooter_footer (Multiplier / Roll Over / Chance).
        const wrap = document.querySelector('[class*="InfoBetInput_inputContainer"]');
        if (wrap && !inOverlay(wrap)) {
            let p = wrap.parentElement;
            for (let i = 0; i < 6 && p && p !== document.body; i++, p = p.parentElement) {
                if (inOverlay(p)) break;
                if (p.querySelectorAll('input').length >= 2) return p;
            }
        }
        // 3) Legacy class selectors for older Shuffle skins. Deliberately EXCLUDE
        //    the generic gameFooter (the toolbar), which is not the control row.
        const byClass = document.querySelector(
            '[class*="footer"][class*="dice"], [class*="Dice"][class*="footer"], ' +
            '[class*="TBYuRq__footer"], [class*="betControls"], [class*="BetControls"], ' +
            '[class*="gameControls"], [class*="GameControls"]'
        );
        if (byClass && !inOverlay(byClass)) return byClass;
        // 4) Last resort: an exact "Multiplier" / "Target Multiplier" label + ≥2 inputs.
        for (const el of document.querySelectorAll('label, p, span, div')) {
            const t = (el.textContent || '').trim();
            if ((t === 'Multiplier' || t === 'Target Multiplier') && !inOverlay(el)) {
                let p = el.parentElement;
                for (let i = 0; i < 7; i++) {
                    if (!p || p === document.body) break;
                    if (!inOverlay(p) && p.querySelectorAll('input').length >= 2) return p;
                    p = p.parentElement;
                }
            }
        }
        return null;
    }
    function findStakeDiceControls() {
        // The Stake dice/limbo control row — Multiplier (payout) / Roll Over
        // (reverse-roll) / Win Chance (chance) on Dice, and Target Multiplier /
        // Win Chance on Limbo — located by anchoring on a control input and
        // returning the enclosing `.footer`. Anchoring on the inputs (NOT
        // findNativeElement('.footer')) avoids stake.com's second, EMPTY `.footer`,
        // which the generic lookup would let replaceChildren() swap in and delete
        // the row. Superset selector covers Dice (payout/chance) AND Limbo
        // (target-multiplier/win-chance) — verified live on stake.us. Returns null
        // once the row is in the HUD (idempotent) or when only overlay copies
        // exist (chat/settings), so the row is never displaced.
        const hud = document.getElementById('ratchet-master-container');
        const ctrls = document.querySelectorAll(
            'input[data-testid="payout"], input[data-testid="target-multiplier"], ' +
            'input[data-testid="chance"], input[data-testid="win-chance"], ' +
            'button[data-testid="reverse-roll"], [data-testid="reverse-roll"]'
        );
        for (const ctrl of ctrls) {
            if (hud && hud.contains(ctrl)) return null; // row already in the HUD -> no-op
            if (isOverlayNode(ctrl)) continue;          // skip chat/settings/modal copies
            const footer = ctrl.closest('.footer');
            if (footer && !isOverlayNode(footer)) return footer;
        }
        return null;
    }
    function mountSingleElement(slot, element) {
        if (!slot || !element) return;
        if (slot.childElementCount === 1 && slot.firstElementChild === element) return;
        slot.replaceChildren(element);
    }
    function syncNativeHudElements() {
        // Suspend while a native overlay (chat / settings / any modal) is open so
        // we never reparent their DOM into the HUD. findNativeElement/findShuffleFooter
        // also exclude overlay matches as a second layer of defense.
        if (nativeOverlayOpen()) return;
        if (isShuffle()) {
            // Shuffle has no .game-sidebar / .past-bets / .footer in the
            // Stake sense — instead we move its bet-controls footer (which
            // contains amount/multiplier/play) into the HUD's footer slot.
            const footer = findShuffleFooter();
            const footerSlot = document.getElementById('hud-footer-slot');
            if (footer && footerSlot && footer.parentElement !== footerSlot) {
                footerSlot.appendChild(footer);
            }
            // Relocate Shuffle's recent-results feed (the row of colored
            // outcome pills above the game) into the HUD's past-bets slot
            // so it appears at the top, mirroring Stake's .past-bets row.
            const feed = document.querySelector('[class*="OriginalGameRecentResult_originalGameResultsWrapper"]');
            const pastBetsSlot = document.getElementById('hud-native-past-bets-slot');
            if (feed && pastBetsSlot && feed.parentElement !== pastBetsSlot) {
                pastBetsSlot.appendChild(feed);
            }
            return;
        }
        mountSingleElement(document.getElementById('hud-native-sidebar-slot'), findNativeElement('.game-sidebar'));
        mountSingleElement(document.getElementById('hud-native-past-bets-slot'), findNativeElement('.past-bets'));
        // Put the Stake dice control row (Multiplier / Roll Over / Win Chance)
        // full-width across the bottom of the workspace via hud-footer-slot —
        // exactly where stake.us shows it. Target THE multiplier footer by its
        // payout/chance inputs (findStakeDiceControls), NOT findNativeElement
        // ('.footer'): stake.com has a second, empty footer that the generic
        // lookup would let replaceChildren() swap in next tick, deleting the dice
        // row. findStakeDiceControls returns null once the row is in the HUD, so
        // mountSingleElement no-ops and the row is never displaced. (On stake.us
        // it resolves to the same footer the generic lookup used.)
        mountSingleElement(document.getElementById('hud-footer-slot'), findStakeDiceControls());
        mountSingleElement(document.getElementById('hud-native-game-footer-slot'), findNativeElement('.game-footer'));
        syncFooterFieldStyles();
    }
    function buildHUD() {
        // URL guard: only build/maintain the HUD on dice/limbo pages. After
        // SPA navigation to a different game (Mines, Plinko, Keno, etc.),
        // tear down the HUD so its overlay doesn't sit on top of the new
        // game's UI. Shuffle's GameLayout_gameContent class is shared by
        // every original-game page, so getHudHost would otherwise mount the
        // HUD on whatever game the user navigated to.
        //
        // Per-game enable gate: also tear down when the user has disabled
        // the specific tool for the current URL (e.g. on Stake Limbo with
        // stake-limbo disabled — the user wants Dice but not Limbo).
        if (!isOnSupportedGamePage() || !isCurrentGameEnabled()) {
            const existing = document.getElementById('ratchet-master-container');
            if (existing) existing.remove();
            return;
        }
        const gameDisplay = getHudHost();
        if (!gameDisplay) {
            // SPA navigation away from a Stake/Shuffle game page (e.g. user
            // clicked the site logo to go home / open the lobby). Remove any
            // existing HUD so its absolute-positioned overlay doesn't sit
            // on top of the new page. Native elements we relocated into
            // HUD slots get torn down with the HUD; the site re-renders them
            // when the user navigates back to a game.
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
                    <div id="hud-native-sidebar-slot" class="hud-native-sidebar-slot"></div>
                    <div class="hud-workspace">
                        <div id="hud-native-past-bets-slot" class="hud-native-past-bets-slot"></div>

                        <div class="mode-wrap">
                            <button id="mode-manual" class="mode-btn">Manual</button>
                            <button id="mode-iow" class="mode-btn">IOW</button>

             <button id="mode-smart" class="mode-btn">Smart</button>
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
            buildHUDContent();
        }
        hud.dataset.mode = ACTIVE_MODE;
        hud.classList.toggle('shuffle-theme', isShuffle());
        if (isShuffle()) {
            // Shuffle: full overlay sized to the container's natural height
            // (rolling bar + footer). Our HUD is position:absolute so
            // containerRect.height reflects only native Shuffle content.
            const containerRect = hud.parentElement ? hud.parentElement.getBoundingClientRect() : null;
            let hudH = 640;
            if (containerRect && containerRect.height > 200) {
                hudH = Math.max(containerRect.height, 400);
            } else {
                const rollingBar = document.querySelector('[class*="rollingWrapper"], [class*="DiceGameRollingBar"], [class*="RollingBar"]');
                if (rollingBar && containerRect) {
                    const rbRect = rollingBar.getBoundingClientRect();
                    hudH = Math.max(rbRect.bottom - containerRect.top + 80, 400);
                }
            }
            hud.style.setProperty('height', hudH + 'px', 'important');
            // If the host is the global page wrapper (MAIN or similar),
            // Shuffle's fixed header sits over our top edge and hides the
            // mode-wrap. Detect the header's bottom edge and push the HUD
            // down by that much so the mode buttons clear it.
            const parent = hud.parentElement;
            const parentRect = parent ? parent.getBoundingClientRect() : null;
            const headerBottom = getShuffleHeaderBottom();
            if (parentRect && headerBottom > parentRect.top) {
                const offset = Math.max(0, headerBottom - parentRect.top + 4);
                hud.style.setProperty('top', offset + 'px', 'important');
                // shrink height so the bottom doesn't fall off the parent
                const adjusted = Math.max(400, hudH - offset);
                hud.style.setProperty('height', adjusted + 'px', 'important');
            } else {
                hud.style.setProperty('top', '0', 'important');
            }
        } else {
            hud.style.removeProperty('height');
            hud.style.removeProperty('top');
        }
        syncModeButtons();
        syncNativeHudElements();
        setTimeout(syncNativeHudElements, 350);
        // Shuffle dice info panel (roll-over bar in the footer slot)
        if (isShuffle()) buildDiceInfoPanel();
    }
    function buildHUDContent() {
        const content = document.getElementById('hud-content');
        const hud = document.getElementById('ratchet-master-container');
        if (!content) return;
        if (hud) hud.dataset.mode = ACTIVE_MODE;
        syncModeButtons();
        content.innerHTML = '';
        let html = '';
        if (ACTIVE_MODE === 'iow') {
            html = `
                <div class="hud-shell">
                    <div class="hud-top-bar">
                        <div class="control-section hud-panel">

                            <div class="input-row">
                                <div class="input-cluster">
                                    <label style="color:#94a3b8;font-size:10px;font-weight:800;white-space:nowrap;">Base bet</label>

                                    <div class="input-group">
                                        <input id="h-base" type="number" step="0.01" value="${baseBet.toFixed(2)}">

         <button id="h-double-base" class="quick-btn">2x</button>
                                        <button id="h-half-base" class="quick-btn">1/2</button>
                                    </div>

                                     <div class="hud-risk-container">
                                        <label>Win increase % <input id="h-win-inc" type="number" min="0" value="${winIncreasePercent}"></label>

         <label>Loss reset <input id="h-loss-reset" type="number" min="1" value="${lossStreakReset}"></label>
                                        <label>Win reset <input id="h-wins-reset" type="number" min="1" value="${winsBeforeReset ||
''}"></label>
                                        <label>Autostop on Balance: <input id="h-autostop" type="number" step="0.01" value="${autoStopBalance !== null ?
autoStopBalance.toFixed(2) : ''}" placeholder="OFF"></label>
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
                            <div class="status-bar" id="h-target"> base bet: 0.01 | Wins: 0 | LossStreak: 0 </div>

             <div class="hud-graph-box" id="h-graph-box">
                                <canvas id="h-custom-graph"></canvas>
                            </div>
                        </div>

                        <div class="hud-pane secondary">
                            <div class="hud-stat-rail">
                                <div class="hud-stat-card">

                                     <div class="hud-row"><span class="hud-label">Starting Balance</span><span id="h-start-bal" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Profit/Loss</span><span id="h-profit" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Balance</span><span id="h-peak-bal" class="hud-val" style="color:#00ff9d;">0.00</span></div>

                                   <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:#00ff9d;">0.00</span></div>
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
                                    <span id="h-best-w" class="hud-val" style="color:#00ff9d;">-</span>
                                </div>
                                <div class="hud-meta-chip">
                                    <span class="hud-label">Worst Streaks</span>
                                    <span id="h-worst-l" class="hud-val" style="color:#f87171;">-</span>
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
                                <input type="checkbox" id="h-lock-agg-chk" ${lockAggressionState ?
'checked' : ''}> Lock State
                            </label>
                            <select id="h-lock-gear-sel" ${lockAggressionState ?
'' : 'disabled'}>
                                <option value="1" ${lockedGearLevel === 1 ?
'selected' : ''}>Conservative</option>
                                <option value="2" ${lockedGearLevel === 2 ?
'selected' : ''}>Steady</option>
                                <option value="3" ${lockedGearLevel === 3 ?
'selected' : ''}>Balanced</option>
                                <option value="4" ${lockedGearLevel === 4 ?
'selected' : ''}>Press</option>
                                <option value="5" ${lockedGearLevel === 5 ?
'selected' : ''}>Aggro</option>
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
                            <input id="h-autostop" type="number" step="0.01" value="${autoStopBalance !== null ? autoStopBalance.toFixed(2) : ''}" placeholder="OFF">
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
                                    <div class="hud-row"><span class="hud-label">Peak Balance</span><span id="h-peak-bal" class="hud-val" style="color:#00ff9d;">0.00</span></div>

                                 <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:#00ff9d;">0.00</span></div>
                                </div>
                                <div class="stats-col-inner">

                                     <div class="hud-row"><span class="hud-label">Total Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                                    <div class="hud-row"><span class="hud-label">Total Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>

                                     <div class="hud-row"><span class="hud-label">Wins / Losses</span><span id="h-wl" class="hud-val">0 / 0</span></div>
                                    <div class="hud-row"><span class="hud-label">Session RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                                </div>

                                <div class="stats-col-inner">
                                    <div class="hud-row"><span class="hud-label">Aggression state</span><span id="h-state" class="hud-val gear-text gear-1-text">GEAR 1</span></div>
                                    <div
class="hud-row"><span class="hud-label">Momentum Window</span><span id="h-hot" class="hud-val">0/0</span></div>
                                    <div class="hud-row"><span class="hud-label">Streak (W|L)</span><span id="h-streaks" class="hud-val">0/0 |
0/0</span></div>
                                    <div class="hud-row"><span class="hud-label">Multiplier Performance</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                                </div>

                            </div>
                            <div class="hud-meta-row">
                                <div class="hud-meta-chip">

                                     <span class="hud-label">Best Streaks</span>
                                    <span id="h-best-w" class="hud-val" style="color:#00ff9d;">-</span>
                                </div>

                                <div class="hud-meta-chip">
                                    <span class="hud-label">Worst Streaks</span>
                                    <span id="h-worst-l" class="hud-val" style="color:#f87171;">-</span>

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
                                <input id="h-manual-bet" type="number" step="0.01" min="0.01" value="${manualBet.toFixed(2)}" style="width: 76px; flex: 0 0 auto;">
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
                            <input id="h-autostop" type="number" step="0.01" value="${autoStopBalance !== null ? autoStopBalance.toFixed(2) : ''}" placeholder="OFF">
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
                                    <div class="hud-row"><span class="hud-label">Peak Balance</span><span id="h-peak-bal" class="hud-val" style="color:#00ff9d;">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:#00ff9d;">0.00</span></div>

                                </div>
                                <div class="stats-col-inner">
                                    <div class="hud-row"><span class="hud-label">Total
Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                                    <div class="hud-row"><span class="hud-label">Total Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>
                                    <div class="hud-row"><span class="hud-label">Wins / Losses</span><span id="h-wl" class="hud-val">0 / 0</span></div>

                                     <div class="hud-row"><span class="hud-label">Session RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                                    <div class="hud-row"><span class="hud-label">Streak (W|L)</span><span id="h-streaks" class="hud-val">0/0 |
0/0</span></div>
                                    <div class="hud-row"><span class="hud-label">Multiplier Performance</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                                </div>
                                <div class="stats-col-inner">
                            <div class="hud-meta-row">

                                <div class="hud-meta-chip">
                                    <span class="hud-label">Best Streaks</span>

                                     <span id="h-best-w" class="hud-val" style="color:#00ff9d;">-</span>
                                </div>
                                <div class="hud-meta-chip">

                                     <span class="hud-label">Worst Streaks</span>
                                    <span id="h-worst-l" class="hud-val" style="color:#f87171;">-</span>
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
        // Entering Manual: seed manualBet from Stake's wager input so the
        // HUD's bet field reflects what the user already had typed there.
        if (newMode === 'manual') {
            const cur = getCurrentBet();
            if (isFinite(cur) && cur >= minBaseBet) manualBet = cur;
        }
        buildHUDContent();
        resetStats();
    }
    function attachListeners() {
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
            autostopInp.addEventListener('blur', () => { let v = parseFloat(autostopInp.value) || 0; autostopInp.value = v ? v.toFixed(2) : ''; autoStopBalance = v || null; });
        }
        // Switch Over/Under — Dice only, shared across Manual / IOW / Smart.
        // Rapid-fire clicks the bet button fast enough that a single direct
        // swap click often lands in the middle of an in-flight bet and gets
        // ignored. Briefly pause rapid-fire → swap → resume so the swap
        // always commits cleanly between bets. The interruption is <100 ms
        // so gameplay barely feels it.
        const switchOuBtn = document.getElementById('h-switch-ou');
        if (switchOuBtn) {
            switchOuBtn.addEventListener('click', async () => {
                if (switchOuBtn.disabled) return;
                switchOuBtn.disabled = true;
                try {
                    const wasRunning = isRapidFiring;
                    if (wasRunning) stopRapidFire();
                    // Tiny pause so the last in-flight bet click settles
                    // before we send the swap click.
                    await new Promise(r => setTimeout(r, 40));
                    const swap = getRollOverUnderSwap();
                    if (swap) swap.click();
                    // Tiny pause so Stake commits the swap state before
                    // rapid-fire resumes and starts placing bets again.
                    await new Promise(r => setTimeout(r, 60));
                    if (wasRunning) startRapidFire();
                } catch (e) { console.error('[Switch Over/Under] failed:', e); }
                setTimeout(() => { switchOuBtn.disabled = false; }, 250);
            });
        }
        if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base');
            if (baseInp) {
                baseInp.addEventListener('input', () => { baseBet = parseFloat(baseInp.value) || minBaseBet; });
                baseInp.addEventListener('blur', () => { let v = parseFloat(baseInp.value) || minBaseBet; baseInp.value = v.toFixed(2); baseBet = v; });
            }
            const doubleBtn = document.getElementById('h-double-base');
            if (doubleBtn) doubleBtn.addEventListener('click', () => {
                let val = parseFloat(document.getElementById('h-base').value) || minBaseBet; val *= 2; document.getElementById('h-base').value = val.toFixed(2); baseBet = val;
            });
            const halfBtn = document.getElementById('h-half-base');
            if (halfBtn) halfBtn.addEventListener('click', () => {
                let val = parseFloat(document.getElementById('h-base').value) || minBaseBet; val *= 0.5; val = Math.max(minBaseBet, val); document.getElementById('h-base').value = val.toFixed(2); baseBet = val;
            });
            const winInc = document.getElementById('h-win-inc'); if (winInc) winInc.addEventListener('input', () => { winIncreasePercent = parseFloat(winInc.value) || 125; });
            const lossReset = document.getElementById('h-loss-reset');
            if (lossReset) lossReset.addEventListener('input', () => { lossStreakReset = parseInt(lossReset.value, 10) || 3; });
            const winsReset = document.getElementById('h-wins-reset');
            if (winsReset) winsReset.addEventListener('input', () => { winsBeforeReset = parseInt(winsReset.value, 10) || null; });
        } else {
            const slInp = document.getElementById('h-sl');
            if (slInp) slInp.addEventListener('input', () => { stopLossPct = parseFloat(slInp.value) || 0; });
            const tpInp = document.getElementById('h-tp');
            if (tpInp) tpInp.addEventListener('input', () => { takeProfitPct = parseFloat(tpInp.value) || 0; });
            if (ACTIVE_MODE === 'manual') {
                // Manual mode bet controls — input + 2x/1/2 buttons that
                // immediately push the new value into Stake's wager input
                // when rapid-fire is running, so the user can change bet
                // size without stopping autoplay.
                const manualInp = document.getElementById('h-manual-bet');
                if (manualInp) {
                    manualInp.addEventListener('input', () => {
                        const v = parseFloat(manualInp.value);
                        if (isFinite(v) && v >= minBaseBet) {
                            manualBet = v;
                            if (isRapidFiring) setBet(v);
                        }
                    });
                    manualInp.addEventListener('blur', () => {
                        let v = parseFloat(manualInp.value) || minBaseBet;
                        if (v < minBaseBet) v = minBaseBet;
                        manualInp.value = v.toFixed(2);
                        manualBet = v;
                        if (isRapidFiring) setBet(v);
                    });
                }
                const manualDouble = document.getElementById('h-manual-double');
                if (manualDouble) manualDouble.addEventListener('click', () => {
                    const inp = document.getElementById('h-manual-bet');
                    let v = parseFloat(inp.value) || minBaseBet;
                    v *= 2;
                    inp.value = v.toFixed(2);
                    manualBet = v;
                    if (isRapidFiring) setBet(v);
                });
                const manualHalf = document.getElementById('h-manual-half');
                if (manualHalf) manualHalf.addEventListener('click', () => {
                    const inp = document.getElementById('h-manual-bet');
                    let v = parseFloat(inp.value) || minBaseBet;
                    v = Math.max(minBaseBet, v * 0.5);
                    inp.value = v.toFixed(2);
                    manualBet = v;
                    if (isRapidFiring) setBet(v);
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
        totalWagered = 0; highestProfit = 0; totalWins = 0;
        totalLosses = 0; totalBets = 0;
        lossStreak = 0; counter = 0; lastBetId = null; profitHistory = [0];
        lastAmount = null;
        betHistory = []; recentWins = []; topWinStreaks = []; topLossStreaks = [];
        curLossStreak = 0;
        maxLossStreak = 0; curWinStreak = 0; maxWinStreak = 0;
        multGames = 0; multWins = 0; lastResult = null;
        autoPaused = false; stopLossPct = 0; takeProfitPct = 0;
        rapidBlockedSince = 0; rapidFireStartedAt = 0; lastObservedBetTime = 0;
        if (isRapidFiring) stopRapidFire();
        if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base');
            if (baseInp) baseInp.value = baseBet.toFixed(2);
        } else if (ACTIVE_MODE === 'smart') {
            const aggInp = document.getElementById('h-agg');
            if (aggInp) aggInp.value = aggressionLevel.toFixed(1);
            const valEl = document.getElementById('h-agg-val'); if (valEl) valEl.textContent = `${aggressionLevel.toFixed(1)}x`;
        }
        const sl = document.getElementById('h-sl'); if (sl) sl.value = '0';
        const tp = document.getElementById('h-tp'); if (tp) tp.value = '0';
        syncLastSeenBet();
        updateUI();
    }
    function getCurrentBalance() {
        if (isShuffle()) {
            // Shuffle balance — active currency tab button (aria-selected, disabled)
            const activeTabBtn = document.querySelector('button[aria-selected="true"][disabled][data-testid]');
            if (activeTabBtn) {
                const p = activeTabBtn.querySelector('p');
                if (p) {
                    const val = parseFloat(p.textContent.trim().replace(/,/g, ''));
                    if (!isNaN(val)) { lastKnownBalance = val; return val; }
                }
            }
            const sels = ['[data-testid="balance"]', '.balance-amount', '.wallet-balance span', 'header [class*="balance"] span', 'div[class*="balance"] strong', 'span[class*="amount"]'];
            for (const sel of sels) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const val = parseFloat(el.textContent.trim().replace(/[^0-9.]/g, ''));
                    if (!isNaN(val) && val > 0.001) { lastKnownBalance = val; return val; }
                }
            }
            return lastKnownBalance || 0;
        }
        const betField = document.getElementById('text-field-container') || document.querySelector('input[data-testid="input-game-amount"]');
        const activeCurrency = (betField && betField.getAttribute('data-bet-amount-active-currency')) || '';
        const iconName = activeCurrency.toUpperCase();
        const parseBalText = (txt) => {
            const cleaned = (txt || '').replace(/[^0-9.]/g, '');
            const val = parseFloat(cleaned);
            return !isNaN(val) ? val : null;
        };
        const balanceElems = document.querySelectorAll('span.text-neutral-default.ds-body-md-strong[data-ds-text="true"][style*="max-width: 16ch"]');
        let fallbackVal = null;
        for (let elem of balanceElems) {
            const val = parseBalText(elem.textContent);
            if (val === null) continue;
            if (fallbackVal === null) fallbackVal = val;
            if (!iconName) continue;
            const sibling = elem.parentElement && elem.parentElement.nextElementSibling;
            if (!sibling) continue;
            const svg = sibling.querySelector('svg[data-ds-icon]');
            const svgIcon = svg && (svg.getAttribute('data-ds-icon') || '').toUpperCase();
            const title = (sibling.getAttribute('title') || '').toUpperCase();
            if (svgIcon === iconName || title === iconName) {
                lastKnownBalance = val;
                return val;
            }
        }
        if (fallbackVal !== null) {
            lastKnownBalance = fallbackVal;
            return fallbackVal;
        }
        return lastKnownBalance || 0;
    }
    function getBetContainer() { return document.getElementById('text-field-container');
    }
    function getCurrentBet() {
        if (isShuffle()) {
            const input = document.querySelector('input[data-testid="bet-amount"], input[placeholder*="Amount"], input[placeholder*="Bet"], input[type="text"][inputmode="decimal"]');
            if (input) return parseFloat(input.value.replace(/[^0-9.]/g, '')) || minBaseBet;
            const displayed = document.querySelector('[class*="bet-amount"], [class*="wager"] span');
            if (displayed) {
                const num = parseFloat(displayed.textContent.replace(/[^0-9.]/g, ''));
                return isNaN(num) ? minBaseBet : num;
            }
            return minBaseBet;
        }
        const amountDiv = document.querySelector('#text-field-container #editing-view-port > div');
        if (amountDiv) return parseFloat(amountDiv.textContent.trim().replace(/[^0-9.]/g, '')) || minBaseBet;
        const oldInput = document.querySelector('input[data-testid="input-game-amount"]');
        return oldInput ? parseFloat(oldInput.value.replace(/,/g, '')) || minBaseBet : minBaseBet;
    }
    function setBet(amount) {
        // IOW + Manual both write to Stake's wager input. Smart writes via its
        // own updateBetAmount() and shouldn't go through this path; Advanced
        // IOW is owned by the dice tool and doesn't write through the HUD.
        if (ACTIVE_MODE !== 'iow' && ACTIVE_MODE !== 'manual') return false;
        if (!isFinite(amount) || amount < 0) return false;
        const targetStr = Math.min(amount, maxBaseBet).toFixed(2);
        if (isShuffle()) {
            const input = document.querySelector('input[data-testid="bet-amount"], input[placeholder*="Amount"], input[placeholder*="Bet"], input[type="text"][inputmode="decimal"]');
            if (!input) return false;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, targetStr);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        const container = getBetContainer();
        if (container) {
            container.focus(); container.click();
            setTimeout(() => {
                const display = document.querySelector('#editing-view-port > div');
                if (display) { display.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, targetStr); }
                ['input','change','blur','keydown','keyup','focus'].forEach(type => {
                    const e = new Event(type, { bubbles: true });

                     container.dispatchEvent(e); if (display) display.dispatchEvent(e);
                });
            }, 10);
            return true;
        }
        const input = document.querySelector('input[data-testid="input-game-amount"]');
        if (input) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, targetStr);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }
    function getPlayButton() {
        if (isShuffle()) {
            return document.querySelector('button[data-testid="bet-button"]') ||
                   Array.from(document.querySelectorAll('button')).find(b => /^(Bet|Roll|Play)$/i.test((b.textContent || '').trim()) && b.offsetParent !== null);
        }
        let btn = document.querySelector('button[data-testid="bet-button"]');
        if (btn) return btn;
        const spans = document.querySelectorAll('span.ds-body-md-strong[data-ds-text="true"]');
        for (let span of spans) {
            if (span.textContent.trim() === 'Play') { const button = span.closest('button');
            if (button) return button; }
        }
        return Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Play') && b.offsetParent !== null);
    }
    function findPastBetsContainer() {
        if (isShuffle()) {
            return document.querySelector('.past-bets, [class*="history"], [class*="bet-history"], [class*="pastBets"], section[class*="history"]') ||
                   document.querySelector('div[class*="bets"]');
        }
        return document.querySelector('div.past-bets');
    }
    function isWin(betDiv) {
        if (!betDiv) return false;
        if (isShuffle()) {
            return betDiv.classList.contains('variant-positive') ||
                   betDiv.classList.contains('win') ||
                   betDiv.querySelector('.positive, .win, svg[class*="green"]') !== null ||
                   /win/i.test(betDiv.textContent || '');
        }
        return betDiv.classList.contains('variant-positive');
    }
    function startObserver() {
        if (isShuffle()) {
            // Shuffle uses a DOM-balance + GraphQL/WS network observer pair
            // (see startShuffleObserver / onShuffleBetResult). The Stake-style
            // past-bets MutationObserver doesn't apply because Shuffle's
            // history layout differs and balances aren't observable from
            // the past-bets container.
            return;
        }
        pastBetsContainer = findPastBetsContainer();
        if (!pastBetsContainer) { setTimeout(startObserver, 500); return; }
        if (observer) observer.disconnect();
        syncLastSeenBet(pastBetsContainer);
        observer = new MutationObserver(() => processNewBet(pastBetsContainer));
        observer.observe(pastBetsContainer, { childList: true, subtree: true });
    }
    function onShuffleBetResult(bet) {
        const now = Date.now();
        const _id = bet && bet.id;
        if (_id != null) {
            if (_shuffleSeenIds.has(_id)) return;
            _shuffleSeenIds.add(_id); _shuffleSeenIdOrder.push(_id);
            if (_shuffleSeenIdOrder.length > 400) _shuffleSeenIds.delete(_shuffleSeenIdOrder.shift());
        }
        _shuffleTransportLastMs = now;
        _shuffleLastBetMs = now;
        const payout  = parseFloat(bet.payout) || 0;
        const won     = payout > 0;
        const betAmt  = parseFloat(bet.amount) || minBaseBet;
        const afterBal = parseFloat(bet.afterBalance);
        if (!isNaN(afterBal) && afterBal > 0 && initialBalance === 0) {
            const beforeBal = afterBal - payout + betAmt;
            initialBalance  = beforeBal;
            sessionPeak     = beforeBal;
            lastKnownBalance = afterBal;
        }
        if (!isNaN(afterBal) && afterBal > 0) _shuffleObsBalance = afterBal;
        lastObservedBetTime = now;
        rapidBlockedSince   = 0;
        totalBets++;
        handleBetResult(won, betAmt);
        applyShuffleIOWLogic(won);
        updateUI();
    }
    function applyShuffleIOWLogic(won) {
        if (ACTIVE_MODE !== 'iow') return;
        if (won) {
            lossStreak = 0;
            counter++;
            if (isRapidFiring) {
                const curBet = getCurrentBet();
                let newBet = curBet * (1 + winIncreasePercent / 100);
                newBet = Math.min(newBet, maxBaseBet);
                setBet(newBet);
            }
            if (winsBeforeReset && counter >= winsBeforeReset) {
                counter = 0;
                triggerWinResetPulse();
                if (isRapidFiring) setBet(baseBet);
            }
        } else {
            lossStreak++;
            if (lossStreak >= lossStreakReset) {
                counter = 0;
                if (isRapidFiring) setBet(baseBet);
            }
        }
        if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) stopRapidFire();
    }
    function startShuffleObserver() {
        if (!isShuffle()) return;
        if (_shuffleBalObsEl && _shuffleBalObsEl.isConnected) return;
        const candidates = [
            'button[aria-selected="true"][disabled][data-testid] p',
            'button[data-testid][disabled] p',
            '[data-testid="balance"]',
            'header [class*="Balance"] span',
            'header [class*="balance"] span',
            '[class*="walletBalance"]',
            '[class*="WalletBalance"]',
            '[class*="balance-amount"]'
        ];
        let el = null;
        for (const s of candidates) {
            const found = document.querySelector(s);
            if (!found) continue;
            const v = parseFloat(found.textContent.replace(/[^0-9.]/g, ''));
            if (v > 0) { el = found; break; }
        }
        if (!el) return;
        const seedBal = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
        if (seedBal > 0) {
            _shuffleObsBalance = seedBal;
            lastKnownBalance   = seedBal;
            if (initialBalance === 0) { initialBalance = seedBal; sessionPeak = seedBal; }
        }
        _shuffleBalObsEl = el;
        const obs = new MutationObserver(function () {
            const newBal = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
            if (isNaN(newBal) || Math.abs(newBal - _shuffleObsBalance) < 0.0001) return;
            const now = Date.now();
            if (now - _shuffleTransportLastMs < 5000) { _shuffleObsBalance = newBal; lastKnownBalance = newBal; return; }
            if (now - _shuffleLastBetMs < 400) { _shuffleObsBalance = newBal; return; }
            _shuffleLastBetMs = now;
            const betAmt = getCurrentBet() || minBaseBet;
            const isWinResult = newBal > _shuffleObsBalance;
            if (initialBalance === 0) {
                initialBalance = isWinResult ? _shuffleObsBalance : _shuffleObsBalance + betAmt;
                sessionPeak    = initialBalance;
            }
            _shuffleObsBalance = newBal;
            lastObservedBetTime = now;
            rapidBlockedSince   = 0;
            totalBets++;
            handleBetResult(isWinResult, betAmt);
            applyShuffleIOWLogic(isWinResult);
            updateUI();
        });
        obs.observe(el, { childList: true, subtree: true, characterData: true });
    }
    /**
     * Per-bet feed observer for Shuffle. The balance MutationObserver
     * (startShuffleObserver) has a 400ms dedup window that drops bets fired
     * faster than that, so high-cadence runs lose entries. The recent-results
     * feed (`OriginalGameRecentResult_originalGameResultsWrapper`) adds one
     * new child PER bet — observing childList is dedup-free and gives us a
     * reliable per-bet signal.
     *
     * Win/loss is read from the new child's inline background-color:
     *   - rgb(61, 209, 121)  → win (Shuffle's green)
     *   - rgb(40, 46, 61)    → loss (Shuffle's dark slate)
     */
    function startShuffleFeedObserver() {
        if (!isShuffle()) return;
        const feed = document.querySelector('[class*="OriginalGameRecentResult_originalGameResultsWrapper"]');
        if (!feed) return;
        if (_shuffleFeedObsEl === feed && _shuffleFeedObsEl.isConnected) return;
        _shuffleFeedObsEl = feed;
        const obs = new MutationObserver(function (mutations) {
            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    const cls = (node.className && typeof node.className === 'string') ? node.className : '';
                    // Each bet result is a div with class BetResultContainer_...
                    if (!/BetResultContainer/i.test(cls)) continue;
                    const now = Date.now();
                    if (now - _shuffleTransportLastMs < 5000) return;
                    // Loose dedup against the balance observer firing for the
                    // same bet — much tighter than its own 400ms because we
                    // want every per-bet event to count.
                    if (now - _shuffleLastBetMs < 80) return;
                    _shuffleLastBetMs = now;
                    // Win/loss from inline background-color. Looks at the
                    // node itself OR a child button (Shuffle wraps results
                    // either way across deploys).
                    // Win/loss from the badge color. Shuffle sets it via --badge-bg
                    // on an inner span, so read the span's COMPUTED background (the
                    // button's inline background is empty -> everything read as a
                    // loss). Win = rgb(61,209,121); loss = rgb(42,46,56). Verified live
                    // on shuffle.us. Green-dominant fallback survives palette tweaks.
                    const target = node.querySelector('button') || node;
                    const badgeSpan = target.querySelector('span[class*="badgeBackground"]') || target.querySelector('span');
                    const bg = badgeSpan ? getComputedStyle(badgeSpan).backgroundColor
                                         : (target.style.backgroundColor || getComputedStyle(target).backgroundColor);
                    let isWinResult = bg === 'rgb(61, 209, 121)' || bg.includes('61, 209, 121');
                    if (!isWinResult) { const cm = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); if (cm) isWinResult = (+cm[2] > +cm[1] + 60 && +cm[2] > 130); }
                    const betAmt = getCurrentBet() || minBaseBet;
                    if (initialBalance === 0) {
                        const curBal = getCurrentBalance();
                        if (curBal > 0) { initialBalance = curBal; sessionPeak = curBal; }
                    }
                    lastObservedBetTime = now;
                    rapidBlockedSince = 0;
                    totalBets++;
                    handleBetResult(isWinResult, betAmt);
                    applyShuffleIOWLogic(isWinResult);
                    updateUI();
                }
            }
        });
        obs.observe(feed, { childList: true });
    }
    function processNewBet(container) {
        const latestBet = getLatestBetEntry(container);
        if (!latestBet || latestBet.id === lastBetId) return;
        lastBetId = latestBet.id;
        lastObservedBetTime = Date.now();
        rapidBlockedSince = 0;
        totalBets++;
        const betAmt = getCurrentBet();
        const won = isWin(latestBet.element);
        handleBetResult(won, betAmt);
        if (ACTIVE_MODE === 'iow') {
            if (won) {
                lossStreak = 0;
                counter++;
                if (isRapidFiring) { const curBet = getCurrentBet(); let newBet = curBet * (1 + winIncreasePercent / 100);
                newBet = Math.min(newBet, maxBaseBet); setBet(newBet); }
                if (winsBeforeReset && counter >= winsBeforeReset) { counter = 0;
                triggerWinResetPulse(); if (isRapidFiring) setBet(baseBet); }
            } else {
                lossStreak++;
                if (lossStreak >= lossStreakReset) { counter = 0; if (isRapidFiring) setBet(baseBet);
                }
            }
            if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) stopRapidFire();
        }
        updateUI();
    }
    function handleBetResult(isWinResult, betAmt) {
        try { if (typeof window.__iow_smart_handle_bet__ === "function") window.__iow_smart_handle_bet__(isWinResult, getCurrentBalance()); } catch (e) {}
        if (isWinResult) totalWins++;
        else totalLosses++;
        totalWagered += betAmt || minBaseBet;
        const currentProfit = getCurrentBalance() - initialBalance;
        if (currentProfit > highestProfit) highestProfit = currentProfit;
        profitHistory.push(currentProfit); if (profitHistory.length > MAX_GRAPH_POINTS) profitHistory.shift();
        if (isWinResult) {
            if (lastResult === false && curLossStreak > 0) { topLossStreaks.push(curLossStreak);
            topLossStreaks.sort((a,b)=>b-a); if (topLossStreaks.length > 10) topLossStreaks.pop(); }
            curWinStreak++;
            curLossStreak = 0; multWins++;
        } else {
            if (lastResult === true && curWinStreak > 0) { topWinStreaks.push(curWinStreak);
            topWinStreaks.sort((a,b)=>b-a); if (topWinStreaks.length > 10) topWinStreaks.pop(); }
            curLossStreak++;
            curWinStreak = 0;
        }
        lastResult = isWinResult;
        betHistory.push(isWinResult); recentWins.push(isWinResult);
        if (recentWins.length > 10) recentWins.shift();
        if (betHistory.length > historyWindow) betHistory.shift();
        multGames++;
        maxLossStreak = Math.max(maxLossStreak, curLossStreak);
        maxWinStreak = Math.max(maxWinStreak, curWinStreak);
        if (ACTIVE_MODE === 'smart' || ACTIVE_MODE === 'manual') {
            if (stopLossPct > 0 && currentProfit <= -initialBalance * (stopLossPct / 100)) autoPaused = true;
            if (takeProfitPct > 0 && currentProfit >= initialBalance * (takeProfitPct / 100)) autoPaused = true;
            if (autoPaused && isRapidFiring) stopRapidFire();
        }
        // Autostop on Balance — fires for every mode (Manual / IOW / Smart).
        // Previously this check was nested inside the IOW-only branch of the
        // bet handlers, so the input did nothing in Manual or Smart mode.
        if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) stopRapidFire();
    }
    function startRapidFire() {
        try { if (typeof window.__iow_smart_snapshot_run__ === "function") window.__iow_smart_snapshot_run__(getCurrentBalance(), totalBets, totalWagered, totalWins, totalLosses, profitHistory.length, initialBalance, multGames, multWins); } catch (e) {}
        if (isRapidFiring) return;
        isRapidFiring = true;
        rapidBlockedSince = 0;
        rapidFireStartedAt = Date.now();
        lastObservedBetTime = 0;
        if (!isShuffle()) syncLastSeenBet();
        if (ACTIVE_MODE === 'iow') setBet(baseBet);
        if (ACTIVE_MODE === 'manual') setBet(manualBet);
        if (ACTIVE_MODE === 'smart') updateBetAmount();
        updateUI();
        if (isShuffle()) {
            // Shuffle: poll every 150ms for an enabled play button and click
            // it. The button disables itself while the bet processes, so the
            // poll naturally rate-limits. Stake's spacebar-hold doesn't work
            // because Shuffle's React shell doesn't bind space → bet.
            spacePressInterval = setInterval(() => {
                if (!isRapidFiring) return;
                const btn = getPlayButton();
                if (btn && !btn.disabled) btn.click();
            }, 150);
            const btn = getPlayButton();
            if (btn && !btn.disabled) btn.click();
            return;
        }
        const keyDown = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true });
        if (!nativeOverlayOpen()) document.dispatchEvent(keyDown);
        spacePressInterval = setInterval(() => {
            if (isRapidFiring && !nativeOverlayOpen()) {
                const repeat = new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
                document.dispatchEvent(repeat);
            }
        }, 42);
    }
    function stopRapidFire() {
        isRapidFiring = false;
        rapidBlockedSince = 0;
        rapidFireStartedAt = 0;
        lastObservedBetTime = 0;
        if (spacePressInterval) {
            clearInterval(spacePressInterval);
            spacePressInterval = null;
        }
        if (!isShuffle()) {
            const keyUp = new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true });
            document.dispatchEvent(keyUp);
        }
        updateUI();
    }
    function monitorRapidFireHealth() {
        if (!isRapidFiring) return;
        const now = Date.now();
        if (isShuffle()) {
            // Shuffle: click-chain driven. The button-disabled state is "bet
            // in progress" (normal) so we can't use it as a freeze indicator.
            // Stall safety: stop autoplay after RAPID_STALL_STOP_MS without a
            // new observed bet — matches Stake dice/limbo behavior so the bot
            // doesn't keep clicking when the site has stopped responding
            // (network freeze, balance gate, captcha, game-screen swap, etc.).
            const lastSeenBetTime = lastObservedBetTime || rapidFireStartedAt;
            if (lastSeenBetTime && now - lastSeenBetTime >= RAPID_STALL_STOP_MS) stopRapidFire();
            return;
        }
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
        lineGrad.addColorStop(0, '#00ff9d'); lineGrad.addColorStop(zeroPct, '#00ff9d');
        lineGrad.addColorStop(zeroPct, '#f87171'); lineGrad.addColorStop(1, '#f87171');
        const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
        fillGrad.addColorStop(0, 'rgba(0, 255, 157, 0.2)');
        fillGrad.addColorStop(zeroPct, 'rgba(0, 255, 157, 0.2)'); fillGrad.addColorStop(zeroPct, 'rgba(248, 113, 113, 0.2)'); fillGrad.addColorStop(1, 'rgba(248, 113, 113, 0.2)');
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
        ctx.beginPath();
        ctx.moveTo(0, zeroY); ctx.lineTo(width, zeroY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
    }
    /* Keep Multiplier Performance honest in EVERY mode.
       "1 in N" only means something measured against ONE payout, so the samples
       must reset when the target changes — and the comparison that colours the
       number needs the CURRENT target. Both used to live inside
       updateBetAmount(), which returns early unless ACTIVE_MODE is 'smart' AND
       the loop is running, so in Manual and IOW trackedMultiplier sat at its
       initial 0 forever: the ratio accumulated across every payout the session
       had touched, and `ratio <= (trackedMultiplier || 1)` painted the value red
       however well the multiplier was actually running. Driven off the UI ticker
       now, so it is mode-agnostic and works while stopped. */
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
            const trendColor = recentWins.length >= 10 ? (recentRatio <= actualRatio ? '#00ff9d' : '#f87171') : 'inherit';
            perfEl.innerHTML = `1 in ${actualRatio.toFixed(2)}<span style="color:${trendColor}; font-size:12px;">${trend}</span>`;
            perfEl.style.color = actualRatio <= (trackedMultiplier || 1) ? '#00ff9d' : '#f87171';
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
        const startBalEl = document.getElementById('h-start-bal'); if (startBalEl) startBalEl.textContent = initialBalance.toFixed(2);
        const profitEl = document.getElementById('h-profit');
        if (profitEl) { profitEl.textContent = profit.toFixed(2); profitEl.style.color = profit > 0 ?
        '#00ff9d' : (profit < 0 ? '#f87171' : '#fff'); }
        const peakBalEl = document.getElementById('h-peak-bal');
        if (peakBalEl) peakBalEl.textContent = sessionPeak.toFixed(2);
        const highProfitEl = document.getElementById('h-high-profit'); if (highProfitEl) highProfitEl.textContent = highestProfit.toFixed(2);
        const wageredEl = document.getElementById('h-wagered');
        if (wageredEl) wageredEl.textContent = totalWagered.toFixed(2);
        const rtp = totalWagered > 0 ?
        ((totalWagered + profit) / totalWagered) * 100 : 100;
        const rtpEl = document.getElementById('h-rtp');
        if (rtpEl) { rtpEl.textContent = rtp.toFixed(2) + '%'; rtpEl.style.color = rtp >= 100 ? '#00ff9d' : '#f87171';
        }
        const totalBetsEl = document.getElementById('h-total-bets'); if (totalBetsEl) totalBetsEl.textContent = totalBets;
        const wlEl = document.getElementById('h-wl'); if (wlEl) wlEl.innerHTML = `<span style="color:#00ff9d;">${totalWins}</span> / <span style="color:#f87171;">${totalLosses}</span>`;
        const rapidBtn = document.getElementById('h-rapid-toggle');
        if (rapidBtn) {
            if (isRapidFiring) { rapidBtn.textContent = 'STOP';
            rapidBtn.className = 'hud-rapid-btn stop'; }
            else { rapidBtn.textContent = 'START';
            rapidBtn.className = 'hud-rapid-btn start'; }
        }
        if (ACTIVE_MODE === 'iow') {
            const targetEl = document.getElementById('h-target');
            if (targetEl) targetEl.innerHTML = `base bet: ${baseBet.toFixed(2)} | Wins: <span style="color:#00ff9d">${counter}</span> | LossStreak: <span style="color:#f87171">${lossStreak}</span>`;
            populateAdvancedStats();
        } else if (ACTIVE_MODE === 'smart') {
            const streaksEl = document.getElementById('h-streaks');
            if (streaksEl) streaksEl.innerHTML = `<span style="color:#00ff9d;">${curWinStreak}/${maxWinStreak}</span> | <span style="color:#f87171;">${curLossStreak}/${maxLossStreak}</span>`;
            const hotEl = document.getElementById('h-hot'); if (hotEl) hotEl.textContent = `${betHistory.filter(Boolean).length}/${betHistory.length}`;
            const perfEl = document.getElementById('h-mult-perf');
            if (perfEl && multWins > 0) {
                const actualRatio = multGames / multWins;
                const recentHit = recentWins.filter(Boolean).length;
                const recentRatio = recentWins.length > 0 ? recentWins.length / Math.max(1, recentHit) : actualRatio;
                const trend = recentWins.length >= 10 ? (recentRatio <= actualRatio ? ' ▲' : ' ▼') : '';
                const trendColor = recentWins.length >= 10 ? (recentRatio <= actualRatio ? '#00ff9d' : '#f87171') : 'inherit';
                perfEl.innerHTML = `1 in ${actualRatio.toFixed(2)}<span style="color:${trendColor}; font-size:12px;">${trend}</span>`;
                perfEl.style.color = actualRatio <= (trackedMultiplier || 1) ? '#00ff9d' : '#f87171';
            }
            const winsCount = betHistory.filter(Boolean).length;
            const progress = winsNeeded > 0 ? winsCount / winsNeeded : 0;
            let gear = 1;
            let label = 'Gear 1 (Cold)';
            if (lockAggressionState) {
                gear = lockedGearLevel;
                if (gear === 1) { label = 'Conservative (LOCKED)'; }
                else if (gear === 2) { label = 'Steady (LOCKED)';
                }
                else if (gear === 3) { label = 'Balanced (LOCKED)';
                }
                else if (gear === 4) { label = 'Press (LOCKED)';
                }
                else { gear = 5;
                label = 'Aggro (LOCKED)'; }
            } else {
                if (progress <= 0.4) { gear = 1;
                label = 'Conservative'; }
                else if (progress <= 0.8) { gear = 2;
                label = 'Steady'; }
                else if (progress <= 1.1) { gear = 3;
                label = 'Balanced'; }
                else if (progress <= 1.45) { gear = 4;
                label = 'Press'; }
                else { gear = 5;
                label = 'Aggro'; }
            }
            const stateEl = document.getElementById('h-state');
            if (stateEl) { stateEl.textContent = label; stateEl.className = `hud-val gear-text gear-${gear}-text`;
            }
            const displayW = topWinStreaks.concat([curWinStreak]).filter(x => x > 0).sort((a, b) => b - a).slice(0, 10);
            const displayL = topLossStreaks.concat([curLossStreak]).filter(x => x > 0).sort((a, b) => b - a).slice(0, 10);
            const bestWEl = document.getElementById('h-best-w');
            if (bestWEl) bestWEl.textContent = displayW.join(', ') || '-';
            const worstLEl = document.getElementById('h-worst-l'); if (worstLEl) worstLEl.textContent = displayL.join(', ') || '-';
            const targetEl = document.getElementById('h-target');
            const targetMult = getUserSetMultiplier();
            if (targetEl) {
                let txt = `Target: ${targetMult.toFixed(2)}x`;
                if (autoPaused) { targetEl.style.color = '#f87171'; txt = 'PAUSED - THRESHOLD TRIGGERED'; } else { targetEl.style.color = '#b1bad3';
                }
                targetEl.innerHTML = txt;
            }
        } else if (ACTIVE_MODE === 'manual') {
            const streaksEl = document.getElementById('h-streaks');
            if (streaksEl) streaksEl.innerHTML = `<span style="color:#00ff9d;">${curWinStreak}/${maxWinStreak}</span> | <span style="color:#f87171;">${curLossStreak}/${maxLossStreak}</span>`;
            const hotEl = document.getElementById('h-hot'); if (hotEl) hotEl.textContent = `${betHistory.filter(Boolean).length}/${betHistory.length}`;
            populateAdvancedStats();
            const targetEl = document.getElementById('h-target');
            if (targetEl) {
                targetEl.textContent = isRapidFiring ?
                '' : '';
                targetEl.style.color = isRapidFiring ? '#00ff9d' : '#b1bad3';
            }
        }
        drawGraph();
        try { if (typeof window.__iow_smart_publish__ === "function") window.__iow_smart_publish__(getCurrentBalance(), initialBalance, sessionPeak, highestProfit, totalWagered, totalWins, totalLosses, totalBets, curWinStreak, maxWinStreak, curLossStreak, maxLossStreak, topWinStreaks, topLossStreaks, profitHistory, isRapidFiring, multGames, multWins, trackedMultiplier); } catch (e) {}
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
        // Platform-aware wager input: Stake uses #input-game-amount; Shuffle
        // uses #bet-amount. Without this, Smart never wrote a bet on Shuffle.
        const input = isShuffle()
            ? document.querySelector('input[data-testid="bet-amount"]')
            : document.querySelector('input[data-testid="input-game-amount"]');
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
        const betStr = targetBet.toFixed(2);
        if (betStr !== lastAmount) {
            lastAmount = betStr;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, betStr);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }
    function startObserverWrapper() {
        if (isShuffle()) {
            // Two parallel observers on Shuffle:
            //   - startShuffleObserver: watches active-currency balance text
            //     (catches every bet but throttled to 400ms intervals).
            //   - startShuffleFeedObserver: watches the recent-results feed
            //     (per-bet, reliable, no rate limiting).
            // The 80ms dedup in the feed observer prevents double-counting
            // when both fire for the same bet.
            startShuffleObserver();
            startShuffleFeedObserver();
            return;
        }
        if (!pastBetsContainer || !pastBetsContainer.isConnected) {
            if (observer) observer.disconnect();
            startObserver();
        }
    }
    setInterval(() => {
        // URL guard: SPA navigation (e.g. dice → mines) keeps this interval
        // alive even though we're no longer on a supported game. Stop any
        // running autoplay, tear down the HUD, and skip the rest of this tick
        // so we don't accidentally write bet amounts into a different game.
        if (!isOnSupportedGamePage()) {
            const existing = document.getElementById('ratchet-master-container');
            if (existing) existing.remove();
            try { if (typeof isRapidFiring !== 'undefined' && isRapidFiring) stopRapidFire(); } catch (e) {}
            return;
        }
        buildHUD();
        syncNativeHudElements();
        clampHUDAboveShuffleFooter();
        updateDiceInfoPanel();
        const bal = getCurrentBalance();
        if (bal > 0.01) {
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
            const winsResetEl = document.getElementById('h-wins-reset');
        if (winsResetEl) winsBeforeReset = parseInt(winsResetEl.value, 10) || null;
        }
        if (ACTIVE_MODE === 'manual') {
            // Keep manualBet synced from the HUD input so any user edits
            // (typing, paste) take effect even if the input listener missed
            // an event.
            const manualInp = document.getElementById('h-manual-bet');
            if (manualInp) {
                const v = parseFloat(manualInp.value);
                if (isFinite(v) && v >= minBaseBet) manualBet = v;
            }
        }
        updateUI();
        startObserverWrapper();
        monitorRapidFireHealth();
        if (ACTIVE_MODE === 'smart') updateBetAmount();
    }, 500);
    // --- Native-UI guard: true while a native Stake/Shuffle overlay is open — a
    // visible modal/dialog (Settings, incl. the Hotkeys panel), the chat drawer,
    // or focus sitting in a text field/contenteditable. Used to suspend our global
    // hotkeys AND the synthetic-spacebar autoclicker so they never leak into those
    // UIs (fixes the Settings>Hotkeys and chat malfunctions). ---
    function nativeOverlayOpen() {
        return false; // neutralized -> pre-blend (2.31) firing behavior
        try {
            const dialogs = document.querySelectorAll('[role="dialog"], [aria-modal="true"]');
            for (let i = 0; i < dialogs.length; i++) {
                const r = dialogs[i].getBoundingClientRect();
                if (r.width > 1 && r.height > 1) return true; // a visible modal is open
            }
            // A plain focused <input> is intentionally NOT treated as an overlay:
            // this gate also pauses the rapid-fire autoclicker, which must keep
            // running while the user edits a game/HUD field. Only real native
            // overlays (modal above, or focus inside chat/settings/hotkeys) count.
            const ae = document.activeElement;
            if (ae && ae.closest && ae.closest('[data-testid*="chat" i], [data-test*="chat" i], [class*="chat" i], [class*="settings" i], [class*="hotkey" i]')) return true;
        } catch (e) {}
        return false;
    }
    function shouldIgnoreHotkey(e) {
        const t = e && e.target;
        if (t) {
            const tag = t.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return true;
            if (t.closest && t.closest('[role="dialog"], [aria-modal="true"], [data-testid*="chat" i], [data-test*="chat" i], [class*="chat" i], [class*="settings" i], [class*="hotkey" i]')) return true;
        }
        return nativeOverlayOpen();
    }
    document.addEventListener('keydown', e => {
        if (shouldIgnoreHotkey(e)) return;
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

    try {
        window.__iow_smart_start__ = startRapidFire;
        window.__iow_smart_stop__ = stopRapidFire;
        window.__iow_smart_reset__ = resetStats;
        window.__iow_smart_is_running__ = function () { return isRapidFiring; };
        window.__iow_smart_baseline_now__ = function () {
            try { if (typeof window.__iow_smart_snapshot_run__ === "function") window.__iow_smart_snapshot_run__(getCurrentBalance(), totalBets, totalWagered, totalWins, totalLosses, profitHistory.length, initialBalance, multGames, multWins); } catch (e) {}
        };
    } catch (e) {}

    }


    /* ----- Stake / Shuffle IOW/Smart + Dice Tool (split into 4 entries) -----
       Same underlying body code as before, but registered as four separate
       tools (Stake Dice, Stake Limbo, Shuffle Dice, Shuffle Limbo) so the
       user can toggle each game independently. All four invoke the same
       shared wrapper `runIowSmartAndDice` which decides what to initialize
       from the current URL — and which uses module-level init-once flags
       so the heavy setup work happens exactly once per page load no matter
       which of the four registered slots fires it. The HUD/dice-tool then
       persists across SPA navigation between the four games, and the
       per-tool enabled state is enforced by buildHUD (via
       isCurrentGameEnabled), which tears the HUD down when the user has
       the specific game disabled. */
    const _iowDiceInit = { iowSmart: false, diceTool: false };
    function runIowSmartAndDice() {
        const url = location.href;
        const isDiceLimbo = /\/(?:casino\/games|games\/originals)\/(?:limbo)(?:\/|$|\?|#)/i.test(url);
        const isDicePrime = /\/(?:casino\/games|games\/originals)\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(url);
        if (isDiceLimbo && !_iowDiceInit.iowSmart) {
            try { tool_stake_iow_smart(); _iowDiceInit.iowSmart = true; }
            catch (e) { console.error('[UnifiedTools] iow-smart init error:', e); }
        }
        if (false && isDicePrime && !_iowDiceInit.diceTool) { // dice tool not bundled in Limbo standalone
            try { /* tool_dice_tool not bundled */ }
            catch (e) { console.error('[UnifiedTools] dice-tool init error:', e); }
        }
    }

    register({
        id: 'shuffle-limbo',
        name: 'Shuffle Limbo',
        description: 'Manual / IOW / Smart bet-sizing modes on Shuffle Limbo.',
        matches: [
            'https://shuffle.us/games/originals/limbo*',
            'https://shuffle.com/games/originals/limbo*'
        ],
        runAt: 'document-start',
        defaultEnabled: true,
        group: 'Shuffle',
        hijacksPage: true
    }, runIowSmartAndDice);

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


    /* =========================================================
       IOW/SMART  ↔  DICE TOOL INTEGRATION
       --------------------------------------------------------
       Two responsibilities:

       1. NATIVE BET-MODE ENFORCEMENT
          When the IOW/Smart HUD is present on a Stake page, the
          injected mode buttons (Manual / IOW / Smart / Advanced
          IOW) must keep Stake's native bet mode tabs aligned:
             Manual / IOW / Smart   → native "Manual"
             Advanced IOW           → native "Advanced"
          We click the wrong native tab only when we positively
          detect it as active — never on a guess — so we don't
          spam-click and stop a running auto-bet.

       2. DICE TOOL INTEGRATION ("Advanced IOW" tab)
          When both the IOW/Smart HUD and the Dice Tool panel are
          mounted on the same page, we add an "Advanced IOW" mode
          button to the HUD's mode-wrap that swaps the Dice Tool's
          panel (Calculator / Optimizer / Results / Settings, plus
          a new Stats and Terms tab) into the HUD's #hud-content
          area. The Stats tab uses the IOW/Smart .hud-* classes
          directly so it visually matches the Manual / IOW / Smart
          panels.
       ========================================================= */
    function setupIowDiceIntegration() {
        // ---- State (closed over by everything below) ----
        let stitched          = false;  // true once tryStitch has wired up the HUD
        let toolsActive       = false;  // true while the "Advanced IOW" mode is showing
        let toolsBtn          = null;   // the injected mode button
        let dicePanel         = null;   // reference to the dice tool's #dt-aio-panel
        let hud               = null;   // reference to #ratchet-master-container
        let originalParent    = null;   // where dicePanel lived before we relocated it
        let lastNonToolsMode  = null;   // remembers Manual/IOW/Smart so toggling back works
        let baseBetAtStart    = null;   // wager value captured the moment the user clicked START — used by Switch Over/Under to restore the bet after stopping autoplay
        // Idempotency flags so tryStitch can re-run after SPA navigation
        // rebuilds the HUD without double-attaching listeners/intervals.
        let toolsSyncerStarted    = false;
        let modeBtnListenersAttached = false;
        // Last-seen value of the strategy editor's Condition 4 threshold —
        // only updated when Condition 4 is set up as "Stop autoplay" on
        // "Balance ≥ X". Cached so the Balance Target stat stays populated
        // after the user closes the Advanced Play modal. Cleared on page
        // reload. null = no compatible Condition 4 has been observed yet.
        let cond4BalanceTarget    = null;

        /* ---- NATIVE STAKE MODE DETECTION ---- */

        /** True for any element that belongs to our injected UI (panel, dice panel, mode buttons). */
        function isOurInternalEl(el) {
            return !!(
                el.closest('#unified-tools-panel') ||
                el.closest('#unified-tools-toggle') ||
                el.closest('#dt-aio-panel') ||
                el.id === 'dt-aio-button' ||
                (el.id && el.id.startsWith && el.id.startsWith('mode-'))
            );
        }

        /** Locate Stake's three native bet-mode tab buttons (Manual / Auto / Advanced). */
        function findNativeStakeModeButtons() {
            const result = { manual: null, auto: null, advanced: null };

            // Stake's live DOM (verified from devtools dump) uses:
            //   Manual tab   → [data-testid="manual-tab"]   (also data-analytics="manual-bet-button")
            //   Auto tab     → [data-testid="auto-tab"]     (also data-analytics="auto-bet-button")
            //   Advanced tab → [data-testid="advanced-tab"] (also data-analytics="advanced-bet-button")
            // The shorter "manual"/"auto" forms appeared in older Stake builds; kept as fallback.
            const testIdMap = {
                manual:   ['button[data-testid="manual-tab"]',  '[data-testid="manual-tab"]',  '[data-analytics="manual-bet-button"]',  '[data-testid="manual"]',  '[data-testid="bet-tab-manual"]'],
                auto:     ['button[data-testid="auto-tab"]',    '[data-testid="auto-tab"]',    '[data-analytics="auto-bet-button"]',    '[data-testid="auto"]',    '[data-testid="bet-tab-auto"]'],
                advanced: ['button[data-testid="advanced-tab"]','[data-testid="advanced-tab"]','[data-analytics="advanced-bet-button"]','[data-testid="advanced"]','[data-testid="bet-tab-advanced"]']
            };
            for (const mode of Object.keys(testIdMap)) {
                for (const sel of testIdMap[mode]) {
                    const el = document.querySelector(sel);
                    if (el && !isOurInternalEl(el)) { result[mode] = el; break; }
                }
            }

            // Fallback: scan buttons / tabs by text for any tab we didn't pick up.
            if (!result.manual || !result.auto || !result.advanced) {
                const candidates = document.querySelectorAll('button, [role="tab"]');
                for (const el of candidates) {
                    if (isOurInternalEl(el)) continue;
                    const txt = (el.textContent || '').trim().toLowerCase();
                    if ((txt === 'manual') && !result.manual) result.manual = el;
                    else if ((txt === 'auto') && !result.auto) result.auto = el;
                    else if ((txt === 'advanced' || txt === 'adv') && !result.advanced) result.advanced = el;
                }
            }

            return result;
        }

        /** Heuristic: does this tab button currently look "active" in the page's UI? */
        function isLikelyActive(btn) {
            if (!btn) return false;
            // Stake uses Tailwind "prime-active:" variants which trigger when
            // the button has data-prime-active="true". That + the standard
            // ARIA / data-state patterns covers most React/Svelte UIs.
            const SEL = '.active, .selected, [aria-selected="true"], [aria-pressed="true"], [data-active="true"], [data-selected="true"], [data-prime-active="true"], [data-state="active"], [data-state="open"]';
            if (btn.matches && btn.matches(SEL)) return true;
            // Walk up two levels in case the active-state lives on a wrapper.
            let p = btn.parentElement;
            for (let i = 0; i < 2 && p; i++) {
                if (p.matches && p.matches(SEL)) return true;
                p = p.parentElement;
            }
            for (const cls of btn.classList) {
                const lower = cls.toLowerCase();
                if (lower === 'active' || lower === 'selected') return true;
            }
            return false;
        }

        /** Clean up styling left over by an older script version that greyed out tabs. */
        function clearAnyOldBlock(btn) {
            // Earlier versions of this script greyed out "wrong" tabs. We now
            // just switch instead — make sure no leftover styling persists.
            if (!btn) return;
            if (btn.hasAttribute('data-unified-blocked')) {
                btn.style.pointerEvents = '';
                btn.style.opacity = '';
                btn.style.cursor = '';
                btn.removeAttribute('data-unified-blocked');
            }
            if (btn.hasAttribute('data-unified-original-title')) {
                btn.title = btn.getAttribute('data-unified-original-title') || '';
                btn.removeAttribute('data-unified-original-title');
            }
        }

        /**
         * Periodic enforcement of the native bet-mode tab.
         * Called from the 500ms ticker. Clicks the desired tab ONLY when we
         * positively detect a wrong tab as active — silent (no-op) when we
         * can't tell, so we don't spam-click and stop a running auto-bet.
         */
        function enforceNativeMode() {
            // Only enforce when the IOW/Smart HUD is actually present.
            const localHud = document.getElementById('ratchet-master-container');
            if (!localHud) return;

            const desired = toolsActive ? 'advanced' : 'manual';
            const wrong   = ['manual', 'auto', 'advanced'].filter(m => m !== desired);
            const btns    = findNativeStakeModeButtons();

            // Only click if we POSITIVELY detect a wrong tab as active.
            // Spamming clicks (when isLikelyActive can't tell) was stopping
            // Stake's running auto-bet every 500 ms.
            let wrongIsActive = false;
            for (const m of wrong) {
                if (btns[m] && isLikelyActive(btns[m])) { wrongIsActive = true; break; }
            }
            if (wrongIsActive && btns[desired]) {
                try { btns[desired].click(); } catch (e) {}
            }

            ['manual', 'auto', 'advanced'].forEach(m => clearAnyOldBlock(btns[m]));
        }

        /**
         * Hard force used at transitions (Advanced IOW toggle, mode change).
         * Always clicks the desired tab regardless of detected state — runs
         * at most once per user action, so it can't loop and stop the auto-bet.
         */
        function forceNativeMode(target) {
            const localHud = document.getElementById('ratchet-master-container');
            if (!localHud) return;
            const btns = findNativeStakeModeButtons();
            const btn = btns[target];
            if (!btn) return;
            // Skip if already active to avoid an unnecessary click that might
            // collapse the strategy editor.
            if (isLikelyActive(btn)) return;
            try { btn.click(); } catch (e) {}
        }

        /* ---- DICE TOOL ↔ IOW/SMART HUD STITCHER ----
           One-shot wiring that runs once both the IOW/Smart HUD and the Dice
           Tool panel are present in the DOM. Adds bridge CSS, hides the
           Dice Tool's own floating chrome, injects the Advanced IOW mode
           button, and creates the Stats + Terms tabs. */

        /** Try to stitch the Dice Tool into the HUD. Returns true once successful.
         *  Idempotent: if the Advanced IOW button is already present, just
         *  sync state and return. Safe to call after SPA navigation rebuilds
         *  the HUD without the button. */
        /** True when the current URL is a dice/primedice page where the
         *  Dice Tool actually runs. Limbo / target / other supported IOW/Smart
         *  pages return false — the Advanced IOW bridge button shouldn't
         *  appear there even if the dice tool's DOM elements happen to be
         *  in the document from a previous SPA visit. */
        function isOnDiceUrl() {
            const path = location.pathname || '';
            // Stake (and Stake-themed variants) — /casino/games/dice* and /primedice*
            // Shuffle — /games/originals/dice*
            return /\/(?:casino\/games|games\/originals)\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(path);
        }

        function tryStitch() {
            // URL gate: only stitch on dice/primedice pages. On limbo (and
            // any other supported-but-not-dice IOW/Smart page) the dice tool
            // isn't running, so the Advanced IOW bridge button shouldn't be
            // exposed there. The dice tool's DOM elements may still be in
            // the page from a previous dice visit (SPA persistence), but
            // they're not our concern — we just gate visibility of the
            // bridge button on the URL.
            if (!isOnDiceUrl()) {
                if (toolsActive) {
                    try { deactivateTools(); } catch (e) {}
                }
                const orphanBtn = document.getElementById('mode-dice-tools');
                if (orphanBtn) orphanBtn.remove();
                toolsBtn = null;
                stitched = false;
                return false;
            }
            // Fast path: if the toolsBtn is already in the DOM, we're done.
            const existingBtn = document.getElementById('mode-dice-tools');
            if (existingBtn) {
                stitched = true;
                if (!toolsBtn || !document.contains(toolsBtn)) toolsBtn = existingBtn;
                return true;
            }
            // If we were marked stitched but the button has disappeared (HUD
            // got rebuilt by SPA navigation), reset and re-wire the new HUD.
            if (stitched) {
                stitched = false;
                toolsBtn = null;
            }
            hud = document.getElementById('ratchet-master-container');
            const modeWrap = hud && hud.querySelector('.mode-wrap');
            dicePanel = document.getElementById('dt-aio-panel');
            const diceBtn = document.getElementById('dt-aio-button');
            const backdrop = document.getElementById('dt-backdrop');
            if (!modeWrap || !dicePanel || !diceBtn) return false;

            stitched = true;
            originalParent = dicePanel.parentNode || document.body;

            // The Stats panel (and its deck) is OUR built-in tab — it should
            // match the rest of the IOW/Smart HUD's mode layouts. The other
            // dice-tool tabs (Calculator/Optimizer/Results/Settings) keep
            // their own theming so the user's --dt-* themes still work.
            // Palette pulled from the IOW/Smart HUD CSS at lines 1630-1637.
            //
            // Site-aware: this bridge runs on Stake AND Shuffle, but the HUD it
            // paints into is purple on Shuffle (the .shuffle-theme block sets
            // --hud-green: #6c47ff and a violet panel/border). These constants
            // used to be Stake-only, so on Shuffle the Stats deck, the Tools
            // pill and the Terms tab rendered Stake green/slate inside a violet
            // HUD. Mirror .shuffle-theme's values instead.
            //
            // Deliberately NOT themed: the positive/negative VALUE colours
            // (green/red profit numbers). .shuffle-theme doesn't override
            // --hud-positive/--hud-negative either — green-is-good is semantic,
            // not brand chrome, and the runtime comparison further down keys off
            // 'rgb(0, 255, 157)' to decide when a value is at its default.
            //
            // The mobile bundle solves the same problem with
            // `var(--hud-green, #00ff9d)` instead, letting the cascade do it.
            // Desktop stays with an explicit host check because several tokens
            // here have no HUD variable to borrow (HUD_LABEL, HUD_FIELD_BG,
            // HUD_BUTTON_BG, the on-accent ink and the Terms accent), and
            // because HUD_PANEL_BG is a FLAT translucent colour while
            // --hud-panel is a gradient — var()-ing that one would silently
            // restyle Stake's deck cards. Keep both lists in sync by hand.
            const IS_SHUF_HOST = /(^|\.)shuffle\.(com|us)$/i.test(location.hostname);
            const HUD_BG       = IS_SHUF_HOST ? '#0a0818' : '#0f212e';
            const HUD_PANEL_BG = IS_SHUF_HOST ? 'rgba(26, 18, 56, 0.85)' : 'rgba(26, 44, 56, 0.85)';
            const HUD_BORDER   = IS_SHUF_HOST ? 'rgba(108, 71, 255, 0.5)' : 'rgba(82, 109, 130, 0.55)';
            const HUD_BORDER_X = IS_SHUF_HOST ? 'rgba(108, 71, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)';
            const HUD_FG       = '#f5fbff';
            const HUD_LABEL    = IS_SHUF_HOST ? '#a99ede' : '#94a3b8';
            const HUD_GREEN    = IS_SHUF_HOST ? '#6c47ff' : '#00ff9d';
            const HUD_GREEN_DK = IS_SHUF_HOST ? '#4f35b3' : '#00cc7a';
            // Text that sits ON the accent. Stake's bright green needs dark ink;
            // Shuffle's mid-violet needs white.
            const HUD_ON_ACCENT = IS_SHUF_HOST ? '#ffffff' : '#0f212e';
            // A faint accent wash for hover states.
            const HUD_GREEN_SOFT = IS_SHUF_HOST ? 'rgba(108, 71, 255, 0.12)' : 'rgba(0, 255, 157, 0.05)';
            // Terms glossary headings: the PySide replica's teal reads as a
            // third brand on Shuffle, so use a lightened violet there.
            const HUD_TERMS_ACCENT = IS_SHUF_HOST ? '#9d7cff' : '#249f87';
            const HUD_TERMS_RULE   = IS_SHUF_HOST ? 'rgba(157, 124, 255, 0.25)' : 'rgba(36, 159, 135, 0.25)';
            const HUD_RED      = '#e11d48';
            const HUD_FIELD_BG = IS_SHUF_HOST ? 'rgba(8, 6, 20, 0.72)' : 'rgba(8, 11, 18, 0.65)';
            const HUD_BUTTON_BG = IS_SHUF_HOST ? 'rgba(22, 15, 48, 0.8)' : 'rgba(15, 33, 46, 0.75)';

            /* ---- ADVANCED IOW — DiceTool.exe replica skin (Stake theme) ----
               Reproduces the desktop Dice Tool app exactly, in its Stake
               theme (Archive/Dice Tool ui/main_window.py THEMES["Stake"]):
               ttk.Notebook tabs, sunken LabelFrames with Times New Roman
               italic underlined titles on 2px #c9d1d9 borders, #071824
               clam entries/buttons, chunky #00ff80 progress bars, and the
               app's gray-striped (#2d2d2d/#383838) results treeview.
               Appended AFTER the compact bridge rules so it wins ties;
               scoped to the stitched HUD panel. Stats tab (.hud-*) is
               untouched. */
            const DT_STAKE_SKIN_CSS = `
/* Panel chrome */
#hud-content > #dt-aio-panel { --dt-font-scale: 1 !important; background: #162a35 !important; border: 1px solid #2f4553 !important; border-radius: 8px !important; font-size: 12.5px !important; line-height: 1.45 !important; color: #c9d1d9; font-family: "Segoe UI", -apple-system, sans-serif !important; overflow: hidden !important; }
/* Tab strip = ttk.Notebook: flat tabs, selected = select_bg #1f333e */
#hud-content > #dt-aio-panel .dt-tabs { background: #162a35 !important; border-bottom: 1px solid #2f4553 !important; padding: 5px 8px 0 !important; gap: 2px; }
#hud-content > #dt-aio-panel .dt-tab-btn { flex: 0 1 auto !important; padding: 7px 13px !important; font-size: 12px !important; font-weight: 700 !important; color: #c9d1d9 !important; background: #10202b !important; border: 1px solid #2f4553 !important; border-bottom: none !important; border-radius: 4px 4px 0 0 !important; text-transform: none; letter-spacing: 0; }
#hud-content > #dt-aio-panel .dt-tab-btn:hover { background: #1a2c38 !important; color: #ffffff !important; }
#hud-content > #dt-aio-panel .dt-tab-btn.active { background: #1f333e !important; color: #ffffff !important; border-color: #3a5566 !important; }
#hud-content > #dt-aio-panel .dt-tab-btn .dt-tab-icon { display: none !important; }
/* Body */
#hud-content > #dt-aio-panel .dt-body { padding: 18px 12px 10px !important; background: #162a35; }
#hud-content > #dt-aio-panel .dt-panel.active { gap: 17px !important; }
#hud-content > #dt-aio-panel .dt-body::-webkit-scrollbar, #hud-content > #dt-aio-panel .dt-scroll::-webkit-scrollbar, #hud-content > #dt-aio-panel .dt-terms-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
#hud-content > #dt-aio-panel .dt-body::-webkit-scrollbar-thumb, #hud-content > #dt-aio-panel .dt-scroll::-webkit-scrollbar-thumb, #hud-content > #dt-aio-panel .dt-terms-scroll::-webkit-scrollbar-thumb { background: #2f4553; border-radius: 2px; border: 2px solid #162a35; }
/* LabelFrames: sunken, 2px slate border, serif italic underlined title on the border */
#hud-content > #dt-aio-panel .dt-card { background: #162a35 !important; border: 2px solid #c9d1d9 !important; border-radius: 4px !important; padding: 16px 12px 12px !important; margin-bottom: 0 !important; box-shadow: inset 1px 1px 4px rgba(0,0,0,0.35) !important; position: relative !important; overflow: visible !important; }
#hud-content > #dt-aio-panel .dt-card-title { position: absolute !important; top: -11px !important; left: 10px !important; background: #162a35 !important; padding: 0 7px !important; font-family: "Times New Roman", Georgia, serif !important; font-style: italic !important; font-weight: 700 !important; text-decoration: underline !important; font-size: 14px !important; color: #c9d1d9 !important; letter-spacing: 0; text-transform: none; white-space: nowrap; }
/* Labels + entries (ttk clam) */
#hud-content > #dt-aio-panel .dt-lbl { font-size: 12.5px; font-weight: 700; color: #c9d1d9; white-space: nowrap; }
#hud-content > #dt-aio-panel input.dt-entry, #hud-content > #dt-aio-panel select.dt-theme-select { background: #071824 !important; color: #c9d1d9 !important; border: 1px solid #2f4553 !important; border-radius: 3px !important; padding: 5px 8px !important; font-size: 12px !important; font-family: "Segoe UI", -apple-system, sans-serif !important; min-width: 0; width: 100%; text-align: left; box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4); }
#hud-content > #dt-aio-panel input.dt-entry:focus, #hud-content > #dt-aio-panel select.dt-theme-select:focus { outline: none !important; border-color: #c9d1d9 !important; box-shadow: 0 0 0 1px #c9d1d9 !important; }
#hud-content > #dt-aio-panel input.dt-entry::selection { background: #1f333e; color: #ffffff; }
#hud-content > #dt-aio-panel input.dt-out-val[readonly] { opacity: 1 !important; font-weight: 400 !important; }
/* Buttons (ttk clam) */
#hud-content > #dt-aio-panel .dt-btn { background: #071824 !important; border: 1px solid #2f4553 !important; color: #c9d1d9 !important; border-radius: 3px !important; font-size: 12px !important; font-weight: 600 !important; letter-spacing: 0; text-transform: none !important; padding: 6px 12px !important; min-height: 30px !important; font-family: "Segoe UI", -apple-system, sans-serif !important; box-shadow: none !important; }
#hud-content > #dt-aio-panel .dt-btn:hover { background: #1a2c38 !important; color: #ffffff !important; border-color: #3a5566 !important; }
#hud-content > #dt-aio-panel .dt-btn:active { background: #1f333e !important; transform: none !important; }
#hud-content > #dt-aio-panel .dt-btn:disabled { opacity: 0.45 !important; }
#hud-content > #dt-aio-panel .dt-btn-copy { padding: 4px 11px !important; min-height: 24px !important; font-size: 11.5px !important; }
#hud-content > #dt-aio-panel .dt-btn-block { width: 100%; margin-top: 13px !important; }
/* Calculator grid: Calculated Values | (Parameters + Simulation Controls) */
#hud-content > #dt-aio-panel .dt-calc-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: 14px; align-items: start; }
#hud-content > #dt-aio-panel .dt-calc-right { display: flex; flex-direction: column; gap: 17px; min-width: 0; }
#hud-content > #dt-aio-panel .dt-cv-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 9px; align-items: center; padding: 7px 0; }
/* Profit Stop stays in the DOM (calcValues + the Stats-tab mirror write/read
   #dt-out_profit) but is not displayed — the strategy's stop condition uses
   Balance Target, so that is the number shown and copied. */
#hud-content > #dt-aio-panel .dt-cv-row[hidden] { display: none !important; }
#hud-content > #dt-aio-panel .dt-pm-grid { display: grid; grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr); gap: 9px 10px; align-items: center; }
#hud-content > #dt-aio-panel .dt-pm-btns { display: flex; gap: 10px; margin-top: 13px; }
#hud-content > #dt-aio-panel .dt-pm-btns .dt-btn { flex: 1 1 0; }
#hud-content > #dt-aio-panel .dt-ctl-row { display: flex; align-items: center; gap: 10px; margin: 6px 0; }
#hud-content > #dt-aio-panel .dt-ctl-row .dt-btn { flex: 0 0 auto; min-width: 112px; }
#hud-content > #dt-aio-panel .dt-ctl-row input.dt-entry { width: 84px; flex: 0 0 auto; text-align: center; }
#hud-content > #dt-aio-panel .dt-ctl-row .dt-progress-wrap { flex: 1 1 auto; margin: 0 !important; }
/* Optimizer */
#hud-content > #dt-aio-panel .dt-opt-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 9px 12px; align-items: center; }
#hud-content > #dt-aio-panel .dt-opt-runrow { margin-top: 13px; }
#hud-content > #dt-aio-panel .dt-opt-foot, #hud-content > #dt-aio-panel .dt-res-foot { display: flex; justify-content: space-between; gap: 10px; }
/* Progress (chunky tk bar, #00ff80 on dark trough) + status */
#hud-content > #dt-aio-panel .dt-progress-wrap { background: #071824 !important; border: 1px solid #2f4553 !important; height: 14px !important; border-radius: 2px !important; margin: 0 !important; }
#hud-content > #dt-aio-panel .dt-progress-bar { background: #00ff80 !important; }
#hud-content > #dt-aio-panel .dt-status-line { font-size: 11.5px !important; color: #c9d1d9 !important; text-align: center; font-family: "Segoe UI", -apple-system, sans-serif !important; opacity: 1 !important; margin: 0 !important; }
/* Scroll regions */
#hud-content > #dt-aio-panel .dt-scroll { border: 1px solid #2f4553 !important; border-radius: 3px !important; background: #071824 !important; }
#hud-content > #dt-aio-panel .dt-res-scroll { flex: 1 1 auto; min-height: 220px; max-height: none !important; }
#hud-content > #dt-aio-panel #dt-panel-results.active { flex: 1 1 auto; min-height: 0; }
/* Simulation Results treeview (Statistic | Value) */
#hud-content > #dt-aio-panel table.dt-stats { font-size: 12px !important; }
#hud-content > #dt-aio-panel table.dt-stats th { position: sticky; top: 0; background: #071824; color: #c9d1d9; font-size: 12px; font-weight: 700; padding: 6px 11px; border-bottom: 1px solid #2f4553; text-align: left; }
#hud-content > #dt-aio-panel table.dt-stats th:last-child { text-align: center; }
#hud-content > #dt-aio-panel table.dt-stats td { padding: 5px 11px !important; border-bottom: 1px solid #14262f !important; font-size: 12px !important; }
#hud-content > #dt-aio-panel table.dt-stats td:first-child { color: #c9d1d9 !important; font-weight: 400 !important; width: 55%; }
#hud-content > #dt-aio-panel table.dt-stats td:last-child { color: #c9d1d9 !important; text-align: center !important; font-family: "Segoe UI", -apple-system, sans-serif !important; font-weight: 400 !important; }
#hud-content > #dt-aio-panel table.dt-stats td.dt-empty { text-align: center; color: #7d8a96; padding: 14px !important; }
/* Optimizer Results treeview: all columns, centered, gray striping like the app */
#hud-content > #dt-aio-panel table.dt-results { font-size: 11.5px !important; }
#hud-content > #dt-aio-panel table.dt-results th { position: sticky; top: 0; background: #071824 !important; color: #c9d1d9 !important; font-size: 11.5px !important; font-weight: 700 !important; letter-spacing: 0; text-transform: none !important; text-align: center !important; padding: 6px 9px !important; border-bottom: 1px solid #2f4553 !important; border-right: 1px solid #14262f; font-family: "Segoe UI", -apple-system, sans-serif !important; white-space: nowrap; }
#hud-content > #dt-aio-panel table.dt-results td { text-align: center !important; color: #c9d1d9 !important; padding: 4px 9px !important; border-bottom: none !important; font-family: "Segoe UI", -apple-system, sans-serif !important; white-space: nowrap; }
#hud-content > #dt-aio-panel table.dt-results tr:nth-child(odd) td { background: #2d2d2d !important; }
#hud-content > #dt-aio-panel table.dt-results tr:nth-child(even) td { background: #383838 !important; }
#hud-content > #dt-aio-panel table.dt-results tr:hover td { background: #454545 !important; }
#hud-content > #dt-aio-panel table.dt-results tr.selected td { background: #1f333e !important; color: #ffffff !important; font-weight: 400 !important; box-shadow: none !important; }
/* The app has no color-coded cells or risk bars — neutralize them */
#hud-content > #dt-aio-panel td.dt-cell-good, #hud-content > #dt-aio-panel td.dt-cell-mid, #hud-content > #dt-aio-panel td.dt-cell-bad { color: #c9d1d9 !important; }
#hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-good, #hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-mid, #hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-bad { color: #ffffff !important; }
#hud-content > #dt-aio-panel .dt-riskbar { display: none !important; }
#hud-content > #dt-aio-panel #dt-res_status { display: none !important; }
/* Settings: centered fixed-width column of LabelFrames */
#hud-content > #dt-aio-panel .dt-settings-center { width: 100%; max-width: 440px; margin: 14px auto 0; display: flex; flex-direction: column; gap: 24px; }
#hud-content > #dt-aio-panel .dt-set-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 9px 0; }
#hud-content > #dt-aio-panel .dt-sep { height: 1px; background: #2f4553; }
#hud-content > #dt-aio-panel .dt-set-desc { font-size: 11px; font-style: italic; color: #7d8a96; margin: 2px 0 8px; line-height: 1.4; }
#hud-content > #dt-aio-panel .dt-set-val { color: #7d8a96; font-size: 12px; }
/* The IOW HUD strips native checkbox chrome globally — restore it here,
   same as the bridge does for the Stats deck autostop checkbox. */
#hud-content > #dt-aio-panel .dt-chk { appearance: auto !important; -webkit-appearance: auto !important; width: 15px !important; height: 15px !important; margin: 0 !important; padding: 0 !important; position: static !important; opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; accent-color: #00ff80; cursor: pointer; flex: 0 0 auto !important; }
#hud-content > #dt-aio-panel select.dt-theme-select { width: auto !important; flex: 0 0 auto !important; }
#hud-content > #dt-aio-panel input.dt-num-input { width: 64px !important; flex: 0 0 auto !important; text-align: center !important; }
/* Terms: the app's plain glossary text area (no search box) */
#hud-content > #dt-aio-panel #dt-panel-terms.active { padding: 0 !important; }
#hud-content > #dt-aio-panel .dt-terms-search { display: none !important; }
#hud-content > #dt-aio-panel .dt-terms-scroll { background: #0f212e !important; border: 1px solid #2f4553 !important; border-radius: 4px !important; padding: 14px 18px !important; font-size: 12px !important; line-height: 1.5 !important; font-family: "Segoe UI", -apple-system, sans-serif !important; color: #c9d1d9 !important; }
#hud-content > #dt-aio-panel .dt-terms-heading { color: #c9d1d9 !important; font-size: 17px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none; border-bottom: none !important; padding-bottom: 0 !important; margin: 16px 0 6px !important; }
#hud-content > #dt-aio-panel .dt-terms-heading:first-child { margin-top: 0 !important; }
#hud-content > #dt-aio-panel .dt-terms-subheading { color: #c9d1d9 !important; font-size: 14px !important; font-weight: 700 !important; letter-spacing: 0; text-transform: none; margin: 10px 0 3px !important; }
#hud-content > #dt-aio-panel .dt-terms-label { color: #c9d1d9 !important; font-weight: 700 !important; }
#hud-content > #dt-aio-panel .dt-terms-dash { color: #7d8a96 !important; }
#hud-content > #dt-aio-panel .dt-terms-def, #hud-content > #dt-aio-panel .dt-terms-text { color: #c9d1d9 !important; }
#hud-content > #dt-aio-panel .dt-terms-empty { display: none !important; }
/* Leftover modern chrome that must never surface in the replica */
#hud-content > #dt-aio-panel .dt-help, #hud-content > #dt-aio-panel .dt-hint, #hud-content > #dt-aio-panel .dt-steps, #hud-content > #dt-aio-panel .dt-coach { display: none !important; }
`;
            /* =====================================================================
               SHUFFLE THEME — the DiceTool panel's internals.
               The skin above is the DiceTool.exe replica (ttk clam slate:
               #162a35 frames, 2px #c9d1d9 LabelFrames with Times New Roman
               titles, #071824 entries, #00ff80 accent) and is shared by Stake
               and Shuffle. On Shuffle the HUD around it is violet, so the panel
               read as a slate window pasted into a purple HUD.

               Every rule here is scoped through .shuffle-theme, the class
               buildHUD puts on the HUD root only on shuffle.us/.com — so this
               block cannot affect Stake no matter the source order, and the
               extra #id + .class also outranks the skin's two-#id selectors.
               Colours are taken from the HUD's OWN custom properties, so the
               panel tracks .shuffle-theme's palette automatically:
                 --hud-green #6c47ff, --hud-green-dark #4f35b3,
                 --hud-panel violet gradient, --hud-border rgba(108,71,255,.5).
               Colour and type only - nothing here moves a box.
               (No backticks in here - this block is a JS template literal.) */
            const SHUF = '#ratchet-master-container.shuffle-theme #hud-content > #dt-aio-panel';
            const DT_SHUFFLE_THEME_CSS = IS_SHUF_HOST ? `
${SHUF} { background: var(--hud-panel) !important; border: 1px solid var(--hud-border) !important; border-radius: 12px !important;
  color: #f5fbff !important; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; }
/* Tab strip = pills; the active pill takes the HUD's own violet gradient so it
   matches the Manual / IOW / Smart / Tools pills sitting right above it. */
${SHUF} .dt-tabs { background: transparent !important; border-bottom: 1px solid var(--hud-border-soft) !important; padding: 9px !important; gap: 6px !important; }
${SHUF} .dt-tab-btn { background: rgba(8, 6, 20, 0.72) !important; border: 1px solid rgba(108, 71, 255, 0.22) !important;
  border-radius: 9px !important; color: #a99ede !important; font-size: 10.5px !important; font-weight: 800 !important;
  letter-spacing: 0.06em !important; text-transform: uppercase !important; padding: 7px 12px !important;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease !important; }
${SHUF} .dt-tab-btn:hover { background: rgba(108, 71, 255, 0.14) !important; border-color: rgba(108, 71, 255, 0.5) !important; color: #f5fbff !important; }
${SHUF} .dt-tab-btn.active { background: linear-gradient(135deg, var(--hud-green), var(--hud-green-dark)) !important;
  border-color: rgba(157, 124, 255, 0.6) !important; color: #ffffff !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12) inset, 0 0 16px rgba(108, 71, 255, 0.45) !important; }
${SHUF} .dt-body { background: transparent !important; padding: 14px 12px 12px !important; }
${SHUF} .dt-body::-webkit-scrollbar-thumb, ${SHUF} .dt-scroll::-webkit-scrollbar-thumb, ${SHUF} .dt-terms-scroll::-webkit-scrollbar-thumb {
  background: rgba(108, 71, 255, 0.45) !important; border-radius: 999px !important; border: 2px solid transparent !important; background-clip: padding-box !important; }
/* LabelFrames become violet cards; the notched Times-italic title becomes a
   lettered caption over a hairline (padding drops to match). */
${SHUF} .dt-card { background: rgba(16, 11, 36, 0.72) !important; border: 1px solid var(--hud-border-soft) !important;
  border-radius: 12px !important; padding: 12px !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03) !important; }
${SHUF} .dt-card-title { position: static !important; top: auto !important; left: auto !important; display: block !important;
  background: none !important; padding: 0 0 7px !important; margin: 0 0 11px !important;
  font-family: "Segoe UI", -apple-system, sans-serif !important; font-style: normal !important; text-decoration: none !important;
  font-size: 10.5px !important; font-weight: 800 !important; letter-spacing: 0.1em !important; text-transform: uppercase !important;
  color: #9d7cff !important; border-bottom: 1px solid rgba(108, 71, 255, 0.3) !important; }
${SHUF} .dt-lbl { color: #a99ede !important; font-size: 11px !important; font-weight: 700 !important; }
${SHUF} input.dt-entry, ${SHUF} select.dt-theme-select { background: rgba(8, 6, 20, 0.85) !important; color: #f5fbff !important;
  border: 1px solid rgba(108, 71, 255, 0.22) !important; border-radius: 9px !important; padding: 6px 9px !important;
  font-weight: 700 !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03) !important; }
${SHUF} input.dt-entry:focus, ${SHUF} select.dt-theme-select:focus { border-color: var(--hud-green) !important;
  box-shadow: 0 0 0 2px rgba(108, 71, 255, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.03) !important; }
${SHUF} input.dt-entry::selection { background: rgba(108, 71, 255, 0.4); color: #fff; }
${SHUF} .dt-btn { background: linear-gradient(180deg, rgba(42, 30, 84, 0.9), rgba(18, 12, 40, 0.94)) !important;
  border: 1px solid rgba(108, 71, 255, 0.28) !important; color: #f5fbff !important; border-radius: 9px !important;
  font-size: 10.5px !important; font-weight: 800 !important; text-transform: uppercase !important; letter-spacing: 0.06em !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease !important; }
${SHUF} .dt-btn:hover { background: linear-gradient(180deg, rgba(56, 40, 108, 0.94), rgba(24, 16, 52, 0.96)) !important;
  border-color: rgba(157, 124, 255, 0.6) !important; color: #fff !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 0 14px rgba(108, 71, 255, 0.3) !important; }
/* Block buttons are each tab's primary action - give them the accent fill. */
${SHUF} .dt-btn-block { background: linear-gradient(135deg, var(--hud-green), var(--hud-green-dark)) !important;
  border-color: rgba(157, 124, 255, 0.6) !important; color: #ffffff !important;
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12) inset, 0 0 18px rgba(108, 71, 255, 0.42) !important; }
${SHUF} .dt-btn-block:hover { filter: brightness(1.12) !important;
  background: linear-gradient(135deg, var(--hud-green), var(--hud-green-dark)) !important; }
${SHUF} .dt-progress-wrap { background: rgba(8, 6, 20, 0.85) !important; border: 1px solid rgba(108, 71, 255, 0.22) !important;
  border-radius: 999px !important; height: 10px !important; overflow: hidden !important; }
${SHUF} .dt-progress-bar { background: linear-gradient(90deg, var(--hud-green), #9d7cff) !important; }
${SHUF} .dt-status-line { color: #a99ede !important; }
${SHUF} .dt-scroll { background: rgba(8, 6, 20, 0.72) !important; border: 1px solid var(--hud-border-soft) !important; border-radius: 12px !important; }
${SHUF} .dt-sep { background: var(--hud-border-soft) !important; }
${SHUF} .dt-set-desc, ${SHUF} .dt-set-val { color: #a99ede !important; }
${SHUF} .dt-chk { accent-color: var(--hud-green) !important; }
/* Tables: violet lettered headers, hairline rules. The replica's #2d2d2d /
   #383838 Tk striping reads as a gray hole punched in a violet panel. */
${SHUF} table.dt-stats th, ${SHUF} table.dt-results th { background: rgba(8, 6, 20, 0.94) !important; color: #9d7cff !important;
  font-size: 10px !important; font-weight: 800 !important; letter-spacing: 0.08em !important; text-transform: uppercase !important;
  border-bottom: 1px solid rgba(108, 71, 255, 0.35) !important; }
${SHUF} table.dt-stats td, ${SHUF} table.dt-results td { color: #f5fbff !important; border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important; }
${SHUF} table.dt-stats td:first-child { color: #a99ede !important; }
${SHUF} table.dt-stats td.dt-empty { color: #a99ede !important; }
${SHUF} table.dt-results tr:nth-child(odd) td { background: rgba(108, 71, 255, 0.06) !important; }
${SHUF} table.dt-results tr:nth-child(even) td { background: transparent !important; }
${SHUF} table.dt-results tr:hover td { background: rgba(108, 71, 255, 0.16) !important; }
${SHUF} table.dt-results tr.selected td { background: rgba(108, 71, 255, 0.34) !important; color: #fff !important; }
${SHUF} table.dt-results tr.selected td:first-child { box-shadow: inset 2px 0 0 #9d7cff !important; }
/* The replica neutralized the colour-coded cells to match DiceTool.exe. Give
   them back, using the same green/red the HUD uses for profit numbers — those
   stay semantic on Shuffle, they are not brand chrome.
   Must be qualified by the table class: the generic "table.dt-results td" rule
   above carries an extra element in its selector, so a bare "td.dt-cell-good"
   loses to it and the cells silently render as plain body text. */
${SHUF} table.dt-stats td.dt-cell-good, ${SHUF} table.dt-results td.dt-cell-good { color: #00ff9d !important; }
${SHUF} table.dt-stats td.dt-cell-mid, ${SHUF} table.dt-results td.dt-cell-mid { color: #ffd479 !important; }
${SHUF} table.dt-stats td.dt-cell-bad, ${SHUF} table.dt-results td.dt-cell-bad { color: #ff6b8a !important; }
${SHUF} table.dt-results tr.selected td.dt-cell-good, ${SHUF} table.dt-results tr.selected td.dt-cell-mid,
${SHUF} table.dt-results tr.selected td.dt-cell-bad { color: #fff !important; }
/* Terms glossary */
${SHUF} .dt-terms-scroll { background: rgba(8, 6, 20, 0.72) !important; border: 1px solid var(--hud-border-soft) !important;
  border-radius: 12px !important; color: #cfc4f0 !important; }
${SHUF} .dt-terms-heading { color: #9d7cff !important; font-size: 12px !important; font-weight: 800 !important;
  letter-spacing: 0.08em !important; text-transform: uppercase !important;
  border-bottom: 1px solid rgba(108, 71, 255, 0.3) !important; padding-bottom: 5px !important; }
${SHUF} .dt-terms-subheading { color: #b79dff !important; }
${SHUF} .dt-terms-label { color: #f5fbff !important; }
${SHUF} .dt-terms-dash { color: #a99ede !important; }
${SHUF} .dt-terms-def, ${SHUF} .dt-terms-text { color: #cfc4f0 !important; }` : '';
            const bridgeCss = document.createElement('style');
            bridgeCss.id = 'dt-iow-bridge-css';
            bridgeCss.textContent = [
                /* ---- Panel container while hosted inside the HUD ---- */
                '#hud-content > #dt-aio-panel {',
                '  position: static !important;',
                '  inset: auto !important;',
                '  top: auto !important; right: auto !important; bottom: auto !important; left: auto !important;',
                '  width: 100% !important; height: 100% !important;',
                '  max-width: none !important; max-height: none !important;',
                '  margin: 0 !important;',
                '  border: 1px solid rgba(255,255,255,0.08) !important;',
                '  border-radius: 10px !important;',
                '  box-shadow: none !important;',
                '  transform: none !important;',
                '  opacity: 1 !important;',
                '  pointer-events: auto !important;',
                '  visibility: visible !important;',
                '  z-index: auto !important;',
                '  display: flex !important;',
                '  flex-direction: column;',
                '}',
                '#hud-content > #dt-aio-panel .dt-head { display: none !important; }',
                '#hud-content > #dt-aio-panel .dt-tabs { flex: 0 0 auto !important; }',
                '#hud-content > #dt-aio-panel .dt-body { flex: 1 1 auto !important; min-height: 0 !important; overflow: auto !important; }',
                /* ---- Compact mode for the dice tool's other tabs
                       (Calculator / Optimizer / Results / Settings).
                       Scoped to #hud-content so the standalone dice tool on
                       primedice/shuffle keeps its original sizing. The Stats
                       tab uses .hud-* classes (not .dt-*), so these rules
                       don't touch it. */
                /* Shrink the panel base font — most dice-tool sizes are in em */
                '#hud-content > #dt-aio-panel { --dt-font-scale: 0.82 !important; line-height: 1.35 !important; }',
                /* Tab strip: smaller pills */
                '#hud-content > #dt-aio-panel .dt-tab-btn { padding: 6px 4px !important; font-size: 0.78em !important; }',
                '#hud-content > #dt-aio-panel .dt-tab-btn .dt-tab-icon { font-size: 0.95em !important; }',
                /* Cards: tighter padding, smaller margin */
                '#hud-content > #dt-aio-panel .dt-card { padding: 9px 9px 7px !important; margin-bottom: 6px !important; border-width: 1px !important; }',
                '#hud-content > #dt-aio-panel .dt-card-title { top: -9px !important; font-size: 0.82em !important; padding: 0 6px !important; }',
                /* Fields: tighter rows + smaller inputs */
                '#hud-content > #dt-aio-panel .dt-field { margin: 3px 0 !important; gap: 6px !important; }',
                '#hud-content > #dt-aio-panel .dt-field label, #hud-content > #dt-aio-panel .dt-field .dt-label { font-size: 0.85em !important; }',
                '#hud-content > #dt-aio-panel .dt-field input[type="text"], #hud-content > #dt-aio-panel .dt-field input[type="number"], #hud-content > #dt-aio-panel input.dt-text-input { padding: 5px 7px !important; min-width: 70px !important; width: 84px !important; font-size: 0.88em !important; border-radius: 5px !important; }',
                '#hud-content > #dt-aio-panel .dt-help { width: 16px !important; height: 16px !important; font-size: 10px !important; }',
                '#hud-content > #dt-aio-panel .dt-hint { font-size: 0.7em !important; margin: -1px 0 4px !important; }',
                /* Optimizer range groups: keep compact in the HUD; boxes/syntax stay full-width
                   (own classes, so the 84px .dt-field clamp above never touches them) */
                '#hud-content > #dt-aio-panel .dt-rng-row input.dt-mms { padding: 4px 3px !important; font-size: 0.78em !important; }',
                '#hud-content > #dt-aio-panel .dt-rng-adv-btn { width: 28px !important; }',
                '#hud-content > #dt-aio-panel .dt-row input.dt-in { font-size: 0.85em !important; }',
                '#hud-content > #dt-aio-panel .dt-est { padding: 6px !important; font-size: 0.8em !important; }',
                /* Buttons: smaller chrome */
                '#hud-content > #dt-aio-panel .dt-btn { padding: 6px 10px !important; min-height: 32px !important; font-size: 0.82em !important; border-radius: 5px !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-small { padding: 4px 8px !important; min-height: 26px !important; font-size: 0.75em !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-row { gap: 6px !important; margin-top: 6px !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-block { margin-top: 6px !important; }',
                /* Switches: smaller */
                '#hud-content > #dt-aio-panel .dt-switch { transform: scale(0.85); transform-origin: left center; }',
                /* Progress bars: thinner */
                '#hud-content > #dt-aio-panel .dt-progress-wrap { height: 8px !important; margin: 6px 0 3px !important; }',
                /* Hints / inline text: compact */
                '#hud-content > #dt-aio-panel h3, #hud-content > #dt-aio-panel h4 { margin: 6px 0 4px !important; font-size: 0.95em !important; }',
                /* Results table density */
                '#hud-content > #dt-aio-panel table { font-size: 0.82em !important; }',
                '#hud-content > #dt-aio-panel table td, #hud-content > #dt-aio-panel table th { padding: 4px 6px !important; }',
                /* Hidden / placeholder rules — dice tool floating chrome */
                '#dt-aio-panel.dt-bridge-hidden { display: none !important; }',
                '#dt-aio-button.dt-bridge-hidden, #dt-backdrop.dt-bridge-hidden { display: none !important; }',
                /* Hide the floating dice-tool streak counter HUD entirely —
                   the Stats deck section is its full replacement. The
                   underlying #dt-ctr_w / #dt-ctr_l / #dt-ctr_target /
                   #dt-counter_autostop elements stay in DOM (just hidden) so
                   the dice tool's onWinDetected/onLossDetected still update
                   them and the autostop logic keeps working. */
                '#dt-aio-counter.dt-bridge-hidden { display: none !important; }',
                /* Mode-wrap visual guard — IOW/Smart's syncModeButtons()
                   ticker (called from the 500ms buildHUD interval) toggles
                   .active based on its internal ACTIVE_MODE which only knows
                   manual/iow/smart. Without these locks: the prior mode keeps
                   blinking active, and the Tools button keeps blinking
                   inactive every 500ms. We force the right visual on both
                   sides while data-tools-active="1", independent of the
                   .active class state. */
                '#ratchet-master-container[data-tools-active="1"] #mode-manual,',
                '#ratchet-master-container[data-tools-active="1"] #mode-iow,',
                '#ratchet-master-container[data-tools-active="1"] #mode-smart {',
                '  background: #2f4553 !important;',
                '  color: #94a3b8 !important;',
                '  box-shadow: none !important;',
                '}',
                /* Lock Tools button to active look while data-tools-active=1.
                   This is independent of the .active class (which gets
                   stripped every 500ms by syncModeButtons), so no flicker. */
                '#ratchet-master-container[data-tools-active="1"] #mode-dice-tools {',
                '  background: ' + HUD_GREEN + ' !important;',
                '  color: ' + HUD_ON_ACCENT + ' !important;',
                '  box-shadow: 0 0 12px ' + HUD_GREEN + ' !important;',
                '}',
                /* ---- Stats tab — uses the IOW/Smart .hud-* class hierarchy
                       directly, so the existing HUD CSS in this script paints
                       it identically to the Manual/IOW/Smart mode panels.
                       These rules are just thin shims for the few bits that
                       don't have a 1:1 .hud-* equivalent (the deck-level
                       autostop checkbox cluster, W/L counter chip, the track
                       dropdown, and the Update button colorway). */
                /* Make the dice panel body a flex column so #dt-panel-stats
                   can fill its remaining height. Without this, .hud-shell
                   with flex:1 1 0 collapses to zero height because the
                   default .dt-body is display:block (no free space for
                   flex-grow to consume). Other dice panels are display:none
                   when inactive, so they're unaffected. */
                '#hud-content > #dt-aio-panel .dt-body { display: flex !important; flex-direction: column !important; }',
                '#dt-panel-stats { padding: 10px !important; flex-direction: column !important; gap: 8px !important; }',
                '#dt-panel-stats.active { display: flex !important; flex: 1 1 auto !important; min-height: 0 !important; }',
                '#dt-panel-stats * { box-sizing: border-box; }',
                /* The .hud-shell wrapper inside Stats also needs to grow */
                '#dt-panel-stats > .hud-shell { flex: 1 1 auto !important; min-height: 0 !important; height: 100% !important; }',
                /* Inside .hud-controls-deck inside the Stats tab, lay sections
                   out as a flex row so the deck reads left-to-right like the
                   Smart/IOW/Manual decks do. */
                '#dt-panel-stats .hud-controls-deck { flex-wrap: wrap; }',
                /* Bet Div / Profit Mult / Autostop inputs — shrink so the
                   deck stays single-row on a normal HUD width. */
                '#dt-panel-stats .hud-control-group input[type="number"] { width: 80px !important; }',
                /* W/L counter chip lives in the deck. .hud-meta-chip already
                   gives us the right look; just override the layout to a
                   2-column counter pair with big numbers.
                   The actual #dt-ctr_w / #dt-ctr_l elements (created and
                   updated by the dice tool) are physically moved into the
                   .hud-counter-slot containers at runtime, so we style them
                   here AND through their original .dt-ctr-w / .dt-ctr-l
                   classes — whichever path the dice tool happens to use. */
                '#dt-panel-stats .hud-counter-chip { flex-direction: column; gap: 2px; align-items: center; min-width: 80px; }',
                '#dt-panel-stats .hud-counter-row { display: flex; gap: 14px; }',
                '#dt-panel-stats .hud-counter-row span { font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; min-width: 22px; text-align: center; }',
                '#dt-panel-stats .hud-counter-vals { display: flex; gap: 14px; align-items: center; }',
                '#dt-panel-stats .hud-counter-slot { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; }',
                /* Direct child styling for the relocated dice counter divs */
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_w,',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l {',
                '  font-size: 18px !important; font-weight: 800 !important;',
                '  font-family: "Roboto Mono", monospace !important;',
                '  min-width: 22px !important; text-align: center !important;',
                '  background: transparent !important; padding: 0 !important;',
                '  border: none !important; box-shadow: none !important;',
                '  line-height: 1 !important;',
                '  transition: transform 0.18s ease, color 0.18s ease;',
                '}',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_w { color: ' + HUD_GREEN + ' !important; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l { color: #94a3b8 !important; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l.has-loss { color: ' + HUD_RED + ' !important; }',
                /* Autostop = checkbox + win-streak target inside a control-group */
                '#dt-panel-stats .hud-autostop-row { display: flex; align-items: center; gap: 6px; }',
                '#dt-panel-stats .hud-autostop-row input[type="checkbox"] {',
                '  appearance: auto !important; -webkit-appearance: auto !important;',
                '  width: 16px !important; height: 16px !important;',
                '  margin: 0 !important; padding: 0 !important;',
                '  position: static !important;',
                '  opacity: 1 !important; visibility: visible !important;',
                '  pointer-events: auto !important;',
                '  accent-color: ' + HUD_GREEN + ';',
                '  cursor: pointer; flex: 0 0 auto !important;',
                '}',
                '#dt-panel-stats .hud-autostop-row input[type="number"] { width: 50px !important; }',
                /* Stretch the deck "banner" — +40 px horizontal (20 each side)
                   and +20 px vertical (10 each side) over the default
                   .hud-controls-deck padding of 10 px. */
                '#dt-panel-stats .hud-controls-deck.hud-panel { padding: 20px 30px !important; }',
                /* Update Strategy button — green primary like an active mode.
                   Sizes itself to match .hud-rapid-btn / .hud-reset-btn from
                   the parent IOW/Smart HUD CSS, so the three buttons (Update
                   Strategy / RESET / START) line up at the same big size. */
                '#dt-panel-stats .hud-update-btn { min-height: 38px; border: none; padding: 8px 14px; border-radius: 9px; cursor: pointer; font-weight: 900; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; background: ' + HUD_GREEN + '; color: ' + HUD_BG + '; box-shadow: 0 0 12px ' + HUD_GREEN + '; transition: background 0.18s, transform 0.18s; line-height: 1.1; flex: 1 1 0; min-width: 108px; }',
                '#dt-panel-stats .hud-update-btn:hover { background: ' + HUD_GREEN_DK + '; transform: translateY(-1px); }',
                /* Switch Over/Under — neutral cyan button so it visually
                   distinguishes from the green Update/Start and red Reset. */
                '#dt-panel-stats .hud-switch-btn { min-height: 38px; border: 1px solid #06b6d4; padding: 8px 14px; border-radius: 9px; cursor: pointer; font-weight: 900; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; background: transparent; color: #06b6d4; transition: background 0.18s, color 0.18s, transform 0.18s; line-height: 1.1; flex: 1 1 0; min-width: 108px; }',
                '#dt-panel-stats .hud-switch-btn:hover { background: #06b6d4; color: ' + HUD_BG + '; transform: translateY(-1px); }',
                '#dt-panel-stats .hud-switch-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
                /* W/L counter chip — content-sized inside the deck */
                '#dt-panel-stats .hud-counter-chip { flex: 0 0 auto !important; flex-direction: column; gap: 2px; min-width: 80px; padding: 6px 10px !important; }',
                '#dt-panel-stats .hud-counter-row { display: flex; gap: 14px; }',
                '#dt-panel-stats .hud-counter-row span { font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; min-width: 22px; text-align: center; }',
                '#dt-panel-stats .hud-counter-vals { display: flex; gap: 14px; align-items: center; justify-content: space-around; }',
                '#dt-panel-stats .hud-counter-slot { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_w,',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l { font-size: 18px !important; font-weight: 800 !important; font-family: "Roboto Mono", monospace !important; min-width: 22px !important; text-align: center !important; background: transparent !important; padding: 0 !important; border: none !important; box-shadow: none !important; line-height: 1 !important; transition: transform 0.18s ease, color 0.18s ease; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_w { color: ' + HUD_GREEN + ' !important; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l { color: #94a3b8 !important; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l.has-loss { color: ' + HUD_RED + ' !important; }',
                /* Autostop row inside its control group */
                '#dt-panel-stats .hud-autostop-row { display: flex; flex-direction: row; align-items: center; gap: 6px; }',
                '#dt-panel-stats .hud-autostop-row input[type="checkbox"] { appearance: auto !important; -webkit-appearance: auto !important; width: 16px !important; height: 16px !important; margin: 0 !important; flex: 0 0 auto !important; accent-color: ' + HUD_GREEN + '; cursor: pointer; }',
                '#dt-panel-stats .hud-autostop-row input[type="number"] { width: 60px !important; flex: 0 0 60px !important; text-align: center; }',
                /* Volume slider in the deck */
                '#dt-panel-stats .hud-volume-group { min-width: 140px; max-width: 220px; }',
                '#dt-panel-stats .hud-volume-group label { display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 6px !important; }',
                '#dt-panel-stats .hud-volume-group label > span:last-child { color: ' + HUD_GREEN + '; font-family: "Roboto Mono", monospace; font-weight: 800; }',
                '#dt-panel-stats .hud-volume-group input[type="range"] { width: 100% !important; accent-color: ' + HUD_GREEN + '; cursor: pointer; }',
                /* The Stats tab has a calc-derived block sitting under the main
                   stats grid (Balance Target / Profit Stop / Streak / Mult Perf).
                   Use the same .stats-col-inner card look so it reads as part
                   of the Stats column. */
                '#dt-panel-stats .hud-streaks-row { gap: 8px; }',
                '#dt-panel-stats details.hud-streaks-toggle { flex: 1 1 0; }',
                '#dt-panel-stats details.hud-streaks-toggle summary { list-style: none; padding: 8px 12px; background: ' + HUD_PANEL_BG + '; border: 1px solid ' + HUD_BORDER_X + '; border-radius: 10px; cursor: pointer; font-size: 11px; font-weight: 800; color: #cbd5e1; text-transform: uppercase; letter-spacing: 0.4px; display: flex; justify-content: space-between; align-items: center; }',
                '#dt-panel-stats details.hud-streaks-toggle summary::-webkit-details-marker { display: none; }',
                '#dt-panel-stats details.hud-streaks-toggle summary:hover { background: ' + HUD_GREEN_SOFT + '; }',
                '#dt-panel-stats details.hud-streaks-toggle summary::after { content: "▼"; color: ' + HUD_GREEN + '; font-size: 10px; transition: transform 0.15s; }',
                '#dt-panel-stats details.hud-streaks-toggle[open] summary::after { transform: rotate(180deg); }',
                '#dt-panel-stats .hud-streaks-list { padding: 6px 12px; background: rgba(8,11,18,0.55); border: 1px solid ' + HUD_BORDER_X + '; border-top: none; border-radius: 0 0 10px 10px; font-family: "Roboto Mono", monospace; font-size: 11px; color: ' + HUD_FG + '; line-height: 1.6; }',
                /* ---- Terms tab — glossary panel. Mirrors the original
                       PySide terms_tab.py styling: teal headings (violet on
                       Shuffle, see HUD_TERMS_ACCENT),
                       white definitions, dark background, generous padding,
                       scrollable content area. */
                '#dt-panel-terms.active { display: flex !important; flex-direction: column; flex: 1 1 auto; min-height: 0; padding: 10px !important; }',
                '#dt-panel-terms .dt-terms-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 14px 18px; background: ' + HUD_PANEL_BG + '; border: 1px solid ' + HUD_BORDER_X + '; border-radius: 12px; color: ' + HUD_FG + '; font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.5; font-size: 12px; }',
                '#dt-panel-terms .dt-terms-scroll::-webkit-scrollbar { width: 8px; }',
                '#dt-panel-terms .dt-terms-scroll::-webkit-scrollbar-thumb { background: ' + HUD_BORDER + '; border-radius: 4px; }',
                '#dt-panel-terms .dt-terms-heading { color: ' + HUD_TERMS_ACCENT + '; font-size: 16px; font-weight: 800; letter-spacing: 0.5px; margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 1px solid ' + HUD_TERMS_RULE + '; }',
                '#dt-panel-terms .dt-terms-heading:first-child { margin-top: 0; }',
                '#dt-panel-terms .dt-terms-subheading { color: ' + HUD_TERMS_ACCENT + '; font-size: 13px; font-weight: 700; letter-spacing: 0.3px; margin: 10px 0 4px; }',
                '#dt-panel-terms .dt-terms-row { margin: 3px 0; padding: 0; }',
                '#dt-panel-terms .dt-terms-label { color: ' + HUD_TERMS_ACCENT + '; font-weight: 700; }',
                '#dt-panel-terms .dt-terms-dash { color: ' + HUD_LABEL + '; }',
                '#dt-panel-terms .dt-terms-def { color: ' + HUD_FG + '; }',
                '#dt-panel-terms .dt-terms-text { margin: 3px 0; color: ' + HUD_FG + '; }',
                '#dt-panel-terms .dt-terms-spacer { height: 6px; }'
            ].join('\n') + DT_STAKE_SKIN_CSS + DT_SHUFFLE_THEME_CSS;
            // Guard against re-stitch (SPA navigation rebuilt HUD). The
            // bridge CSS is process-wide so we only need it once.
            if (!document.getElementById('dt-iow-bridge-css')) {
                document.head.appendChild(bridgeCss);
            }

            diceBtn.classList.add('dt-bridge-hidden');
            if (backdrop) backdrop.classList.add('dt-bridge-hidden');
            dicePanel.classList.add('dt-bridge-hidden');
            // Floating streak counter — replaced by the Stats deck section.
            const floatingCounter = document.getElementById('dt-aio-counter');
            if (floatingCounter) floatingCounter.classList.add('dt-bridge-hidden');

            // Bridge CSS now hides the dice tool elements via the
            // dt-bridge-hidden class. Remove the pre-stitch hider so the
            // bridge CSS is the single source of truth — important because
            // the pre-stitch CSS uses #id selectors and would still hide
            // #dt-aio-panel even when the user clicks Advanced IOW (which
            // only removes the dt-bridge-hidden class).
            const preStitchEl = document.getElementById('dt-pre-stitch-css');
            if (preStitchEl) preStitchEl.remove();

            toolsBtn = document.createElement('button');
            toolsBtn.id = 'mode-dice-tools';
            toolsBtn.className = 'mode-btn';
            toolsBtn.textContent = 'Advanced IOW';
            toolsBtn.title = 'Advanced IOW (Calculator / Strategy Finder / Results / Settings)';
            modeWrap.appendChild(toolsBtn);

            toolsBtn.addEventListener('click', () => {
                if (toolsActive) {
                    const target = lastNonToolsMode || 'manual';
                    const targetBtn = document.getElementById('mode-' + target);
                    if (targetBtn) targetBtn.click();
                } else {
                    activateTools();
                }
            });

            // Click listeners on Manual/IOW/Smart buttons. Guarded so a
            // re-stitch after SPA navigation doesn't pile up duplicate
            // listeners (each would fire deactivateTools, etc.).
            if (!modeBtnListenersAttached) {
                ['mode-manual', 'mode-iow', 'mode-smart'].forEach(id => {
                    const b = document.getElementById(id);
                    if (!b) return;
                    b.addEventListener('click', () => {
                        lastNonToolsMode = id.replace(/^mode-/, '');
                        if (toolsActive) deactivateTools();
                    }, true);
                });
                modeBtnListenersAttached = true;
            }

            // Pin Tools button's active state and keep the other mode buttons
            // visually inactive while Tools is the active mode. IOW/Smart's
            // own syncModeButtons() runs every 500ms and re-derives .active
            // from its internal ACTIVE_MODE (which only knows manual/iow/
            // smart), so without this loop the prior mode would stay lit and
            // Tools would lose its highlight. We run faster than syncModeButtons
            // (200ms < 500ms) so the visual state always settles correctly.
            //
            // The natural #ratchet-master-container .mode-btn.active CSS rule
            // (background: #00ff9d, color: #0f212e, glow) then paints the Tools
            // button identically to Manual/IOW/Smart — no !important overrides
            // needed.
            // Active-state syncer for the toolsBtn. Guarded so a re-stitch
            // after SPA navigation doesn't spawn duplicate intervals.
            if (!toolsSyncerStarted) {
                setInterval(() => {
                    if (!toolsBtn) return;
                    if (toolsActive) {
                        if (!toolsBtn.classList.contains('active')) {
                            toolsBtn.classList.add('active');
                        }
                        ['mode-manual', 'mode-iow', 'mode-smart'].forEach(id => {
                            const b = document.getElementById(id);
                            if (b && b.classList.contains('active')) b.classList.remove('active');
                        });
                    } else {
                        if (toolsBtn.classList.contains('active')) {
                            toolsBtn.classList.remove('active');
                        }
                    }
                }, 200);
                toolsSyncerStarted = true;
            }

            // Insert the Stats tab into the dice tool's panel.
            trySetupStatsTab();
            // Insert the Terms tab as the last tab.
            trySetupTermsTab();

            console.log('%c[Dice/IOW Bridge] Advanced IOW tab integrated.', 'color:#10b981;font-weight:700;');
            return true;
        }

        /* ---- STATS + TERMS TAB SETUP ----
           These tabs are appended to the Dice Tool's tab strip, inserted
           into the dice tool's panel body, and styled by the bridge CSS to
           match the IOW/Smart HUD. */

        let statsSetup    = false;  // true once the Stats tab is in the DOM
        let termsSetup    = false;  // true once the Terms tab is in the DOM
        let statsSyncing  = false;  // re-entrancy guard for two-way input binding

        /** Build the Stats tab (first tab; default-active when Advanced IOW opens). */
        function trySetupStatsTab() {
            if (statsSetup) return true;
            const panel = document.getElementById('dt-aio-panel');
            if (!panel) return false;
            const tabsNav = panel.querySelector('.dt-tabs');
            const body = panel.querySelector('.dt-body');
            if (!tabsNav || !body) return false;
            if (panel.querySelector('#dt-panel-stats')) { statsSetup = true; return true; }

            // Tab button — insert as the FIRST tab so the order is
            // Stats, Calculator, Optimizer, Results, Settings.
            const statsBtn = document.createElement('button');
            statsBtn.className = 'dt-tab-btn';
            statsBtn.dataset.tab = 'stats';
            statsBtn.innerHTML = 'Play';
            // Sit ahead of Find New Strategy so Play is the first tab in the strip.
            const firstBtn = tabsNav.querySelector('[data-tab="easy"]');
            if (firstBtn) tabsNav.insertBefore(statsBtn, firstBtn);
            else tabsNav.insertBefore(statsBtn, tabsNav.firstChild);

            // Panel.
            const statsPanel = document.createElement('section');
            statsPanel.className = 'dt-panel';
            statsPanel.id = 'dt-panel-stats';
            statsPanel.innerHTML =
                /* The Stats tab body uses the IOW/Smart .hud-* class
                   hierarchy directly so the existing HUD CSS paints it
                   identically to the Manual / IOW / Smart panels. */
                '<div class="hud-shell">' +
                  /* ---- Controls deck — same flat layout the Smart/IOW
                       modes use, with a W/L counter chip and a Volume control
                       group dropped in. Big buttons (Update Strategy / Reset /
                       Start) on the right. ---- */
                  '<div class="hud-controls-deck hud-panel">' +
                    '<div class="hud-control-group">' +
                      '<label>Balance Divisor</label>' +
                      '<input id="dt-stats-bet-div" type="number" inputmode="decimal" step="any">' +
                    '</div>' +
                    '<div class="hud-control-group">' +
                      '<label>Profit Multiplier</label>' +
                      '<input id="dt-stats-profit-mult" type="number" inputmode="decimal" step="any">' +
                    '</div>' +
                    '<div class="hud-meta-chip hud-counter-chip">' +
                      '<div class="hud-counter-row"><span>Wins</span><span>Losses</span></div>' +
                      /* Slot containers — the dice tool's actual #dt-ctr_w
                         and #dt-ctr_l divs get moved here at runtime so
                         the dice tool's own update path writes directly to
                         what the user sees. No mirror, no lag. */
                      '<div class="hud-counter-vals">' +
                        '<span class="hud-counter-slot" data-counter-slot="w"></span>' +
                        '<span class="hud-counter-slot" data-counter-slot="l"></span>' +
                      '</div>' +
                    '</div>' +
                    '<div class="hud-control-group">' +
                      '<label>Autostop @ Win Streak</label>' +
                      '<div class="hud-autostop-row">' +
                        '<input type="checkbox" id="dt-stats-autostop">' +
                        '<input type="number" min="0" id="dt-stats-target" value="10">' +
                      '</div>' +
                    '</div>' +
                    '<div class="hud-control-group">' +
                      '<label>Stats Track Per</label>' +
                      '<select id="dt-stats-track-per">' +
                        '<option value="session" selected>Session</option>' +
                        '<option value="cycle">Cycle</option>' +
                      '</select>' +
                    '</div>' +
                    '<div class="hud-control-group hud-volume-group">' +
                      '<label><span>🔊 Volume</span><span id="dt-stats-volume-val">100</span></label>' +
                      '<input type="range" id="dt-stats-volume" min="0" max="100" value="100">' +
                    '</div>' +
                    '<div class="btn-group">' +
                      '<button class="hud-update-btn" id="dt-stats-update">Update Strategy</button>' +
                      '<button id="dt-stats-switch-ou" class="hud-switch-btn">Switch Over/Under</button>' +
                      '<button id="dt-stats-reset" class="hud-reset-btn">RESET</button>' +
                      '<button id="dt-stats-start" class="hud-rapid-btn start" data-running="false">START</button>' +
                    '</div>' +
                  '</div>' +
                  /* ---- Main body: graph + stats columns ---- */
                  '<div class="hud-body">' +
                    '<div class="graph-col">' +
                      '<div class="hud-graph-box">' +
                        '<canvas id="dt-stats-graph"></canvas>' +
                      '</div>' +
                    '</div>' +
                    '<div class="stats-col">' +
                      '<div class="hud-stats-grid">' +
                        '<div class="stats-col-inner">' +
                          '<div class="hud-row" data-stat="startingBalance"><span class="hud-label">Starting Balance</span><span class="hud-val">0.00</span></div>' +
                          '<div class="hud-row" data-stat="totalBets"><span class="hud-label">Total Bets</span><span class="hud-val">0</span></div>' +
                          '<div class="hud-row" data-stat="profit"><span class="hud-label">Profit/Loss</span><span class="hud-val">0.00</span></div>' +
                          '<div class="hud-row" data-stat="totalWagered"><span class="hud-label">Total Wagered</span><span class="hud-val">0.00</span></div>' +
                        '</div>' +
                        '<div class="stats-col-inner">' +
                          '<div class="hud-row" data-stat="sessionPeak"><span class="hud-label">Peak Balance</span><span class="hud-val" style="color:#00ff9d;">0.00</span></div>' +
                          '<div class="hud-row" data-stat="peakProfit"><span class="hud-label">Peak Profit</span><span class="hud-val" style="color:#00ff9d;">0.00</span></div>' +
                          '<div class="hud-row" data-stat="winsLosses"><span class="hud-label">Wins / Losses</span><span class="hud-val">0 / 0</span></div>' +
                          '<div class="hud-row" data-stat="rtp"><span class="hud-label">Session RTP</span><span class="hud-val">100.00%</span></div>' +
                        '</div>' +
                        '<div class="stats-col-inner">' +
                          '<div class="hud-row"><span class="hud-label">Balance Target</span><span class="hud-val" id="dt-stats-bal-target">0.00</span></div>' +
                          '<div class="hud-row"><span class="hud-label">Profit Stop</span><span class="hud-val" id="dt-stats-profit-stop">0.00</span></div>' +
                          '<div class="hud-row" data-stat="streaks"><span class="hud-label">Streak (W|L)</span><span class="hud-val">0/0 | 0/0</span></div>' +
                          '<div class="hud-row" data-stat="multPerf"><span class="hud-label">Multiplier Performance</span><span class="hud-val">1 in 0.00</span></div>' +
                        '</div>' +
                      '</div>' +
                      /* Best/Worst streaks — flat .hud-meta-chip rows that
                         match Smart mode's layout exactly. The inline values
                         get populated by updateStatsTab via the [data-stat]
                         hooks (same as before, just no <details> wrapper). */
                      '<div class="hud-meta-row">' +
                        '<div class="hud-meta-chip">' +
                          '<span class="hud-label">Best Streaks</span>' +
                          '<span class="hud-val" data-stat="bestStreaks" style="color:#00ff9d;">-</span>' +
                        '</div>' +
                        '<div class="hud-meta-chip">' +
                          '<span class="hud-label">Worst Streaks</span>' +
                          '<span class="hud-val" data-stat="worstStreaks" style="color:#f87171;">-</span>' +
                        '</div>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                '</div>';
            body.appendChild(statsPanel);

            wireStatsControls();

            // Make Stats the default active tab so that when the user enters
            // Advanced IOW mode they land on Stats instead of Calculator.
            tabsNav.querySelectorAll('.dt-tab-btn').forEach(b => {
                b.classList.toggle('active', b === statsBtn);
            });
            panel.querySelectorAll('.dt-panel').forEach(p => {
                p.classList.toggle('active', p.id === 'dt-panel-stats');
            });

            // Register a per-bet listener — IOW/Smart's processNewBet calls
            // updateUI() synchronously after each settled bet, which calls our
            // publish hook, which calls this callback. That gives the Stats
            // tab the same per-bet refresh cadence as the SMART/IOW/Manual
            // HUDs (which paint inside updateUI directly).
            window.__iow_smart_on_publish__ = updateStatsTab;

            // Move the dice tool's actual #dt-ctr_w / #dt-ctr_l elements
            // into the deck. The dice tool's onWinDetected/onLossDetected
            // path writes textContent directly into these elements via
            // document.getElementById, so the values you see in the deck
            // are always exactly what the dice tool just wrote — same
            // path, same instant as the standalone floating HUD. No mirror,
            // no MutationObserver, no lag. */
            relocateDiceCounter();

            // First render so values aren't blank before the first tick.
            updateStatsTab();

            statsSetup = true;
            return true;
        }

        /**
         * Build the Terms tab — glossary lifted verbatim from the original
         * Dice-Tool PySide terms_tab.py, plus a new STATS TAB section that
         * documents the Advanced IOW Stats panel (deck controls, live stats,
         * streak meta-rows).
         */
        function trySetupTermsTab() {
            // Disabled: the Advanced IOW panel exposes exactly two tabs
            // (Play, Find New Strategy). This used to append a third
            // "Terms" button. Latching termsSetup also stops the 500ms
            // self-heal tick from calling this again every pass. The
            // glossary build-out below is intact but unreachable — delete
            // these three lines to bring the tab back.
            termsSetup = true;
            return true;
        }
        function trySetupTermsTab_disabled() {
            if (termsSetup) return true;
            const panel = document.getElementById('dt-aio-panel');
            if (!panel) return false;
            const tabsNav = panel.querySelector('.dt-tabs');
            const body = panel.querySelector('.dt-body');
            if (!tabsNav || !body) return false;
            if (panel.querySelector('#dt-panel-terms')) { termsSetup = true; return true; }

            // Tab button — append last so the order is
            // Stats, Calculator, Optimizer, Results, Settings, Terms.
            const termsBtn = document.createElement('button');
            termsBtn.className = 'dt-tab-btn';
            termsBtn.dataset.tab = 'terms';
            termsBtn.innerHTML = 'Terms';
            tabsNav.appendChild(termsBtn);

            // Source content. Mirrors terms_tab.py's TERMS_TEXT layout:
            // SECTION HEADERS (uppercase ending in TAB) → big heading
            // sub-headers (PARAMETERS, BUTTONS, etc.)         → small heading
            // "Label – definition" lines                       → label/def pair
            // The new STATS TAB section is added at the top.
            const TERMS_TEXT =
                'PLAY TAB\n' +
                '\n' +
                'CONTROLS DECK\n' +
                'Balance Divisor – Two-way bound to the Calculator. Higher number = smaller starting bet.\n' +
                'Profit Multiplier – Two-way bound to the Calculator. Multiplier applied to the base bet to set the per-cycle profit goal.\n' +
                'Wins / Losses Counter – Live consecutive-streak counter. Wins increment on every win and reset Losses; Losses increment on every loss and reset on the next win.\n' +
                'Autostop @ Win Streak – When checked, auto-stops Stake\'s native auto-bet once the consecutive win count hits the configured target.\n' +
                'Stats Track Per – Switches the stats grid between two scopes: Session is lifetime since page load (Reset clears it). Cycle resets every Start click; useful for measuring per-run performance.\n' +
                'Update Strategy – Pushes the deck\'s Balance Divisor / Profit Multiplier into the Calculator and runs Export Balance & Update Strategy so Balance Target / Profit Stop reflect the new values.\n' +
                'Reset – Clears all session and cycle stats and the W/L counter.\n' +
                'Start – Single click on Stake\'s native Advanced "Start Autoplay" (Advanced IOW mode is intentionally hands-off after Start; the platform drives the auto-loop).\n' +
                '\n' +
                'LIVE STATS\n' +
                'Starting Balance – Balance recorded at session or cycle start, depending on Stats Track Per.\n' +
                'Total Bets – Number of bets settled in the current scope.\n' +
                'Profit/Loss – Current balance minus Starting Balance. Green if positive, red if negative.\n' +
                'Total Wagered – Sum of every bet amount placed.\n' +
                'Peak Balance – Highest balance reached so far.\n' +
                'Wins / Losses – Total wins and total losses in the current scope.\n' +
                'Peak Profit – Largest positive Profit/Loss value seen so far.\n' +
                'Session RTP – (Total Wagered + Profit) / Total Wagered × 100. 100% = breakeven.\n' +
                'Balance Target – Mirror of the Calculator\'s Balance Target output (target balance to end the cycle successfully).\n' +
                'Profit Stop – Mirror of the Calculator\'s Profit Stop output (the per-cycle profit goal in raw amount).\n' +
                'Streak (W|L) – Current and max consecutive win streak | current and max consecutive loss streak.\n' +
                'Multiplier Performance – Empirical 1-in-N success rate measured against the configured target multiplier. Green when meeting or beating the target, red when underperforming.\n' +
                'Best Streaks / Worst Streaks – Top 10 longest win / loss streaks recorded in the current scope (expand to see the full list).\n' +
                '\n' +
                '\n' +
                'CALCULATOR / SIMULATOR TAB\n' +
                '\n' +
                'PARAMETERS\n' +
                'Balance – Your total bankroll for each simulation or calculation.\n' +
                'Win Increase % – The percentage amount the bet increases after every win.\n' +
                'Loss Reset – The number of consecutive losses required before resetting the bet to its base size.\n' +
                'Balance Divisor – A number dividing the balance to determine the starting bet size. (Higher numbers create smaller bet sizes).\n' +
                'Profit Multiplier – The multiplier applied to the base bet that defines the profit stop.\n' +
                'Buffer % – An additional percentage added to the multiplier for extra margin or protection.\n' +
                '\n' +
                'CALCULATED VALUES\n' +
                'Multiplier – The payout odds or target multiplier determined by input parameters.\n' +
                'Bet Size – The first wager placed based on the current balance and balance divisor.\n' +
                'Profit Stop – The profit goal for the current cycle, derived from the bet and multiplier.\n' +
                'Balance Target – The balance amount where the simulation stops a successful cycle.\n' +
                '\n' +
                'SIMULATION CONTROLS\n' +
                'Trials – The number of simulated runs to execute. Higher values improve accuracy but take longer.\n' +
                'Run Simulation – Starts the simulation with the selected settings.\n' +
                'Stop – Cancels an ongoing simulation process.\n' +
                '\n' +
                'SIMULATION RESULTS\n' +
                'Cycle – A completed round reaching the profit target or failing (bust).\n' +
                'Average highest balance – The median of all highest balances reached across all trials.\n' +
                'Std dev (highest) – The standard deviation of highest balances, showing consistency or volatility.\n' +
                'Max highest balance – The single greatest balance achieved in all trials.\n' +
                'Average cycles – The average count of successful profit cycles per trial.\n' +
                'Average rounds – The average number of dice rolls per trial.\n' +
                'Cycle success rate – The percentage of total cycles that reached profit target before failure.\n' +
                'Bust rate – The percentage of trials that failed to meet the first profit stop.\n' +
                '\n' +
                '\n' +
                'FIND NEW STRATEGY TAB\n' +
                '\n' +
                'PARAMETERS\n' +
                'Multiplier – The payout multiplier you want to play at. Every whole-number Win Increase % from 1-500 is searched against it, and Loss Reset and Buffer % are worked out automatically: loss reset runs up to the multiplier value (max 100) and the buffer absorbs the decimals so your multiplier is matched exactly.\n' +
                'Win Chance – The dice win chance implied by the multiplier (99 / multiplier) when it is pinned.\n' +
                'Combos – How many parameter combinations are currently listed.\n' +
                '\n' +
                'RESULTS DEFINITIONS\n' +
                'Multiplier – The payout multiplier that combo produces (always your pinned value when Multiplier is set).\n' +
                'Win Increase % – The win increase percentage you would enter in the game.\n' +
                'Loss Reset – The number of losses before the bet resets to base.\n' +
                'Buffer % – The buffer for that combo, solved to 2 decimals so the multiplier you entered is matched exactly.\n' +
                'Reset Odds % – The chance that any given run of Loss Reset bets are all losses, triggering a bet reset.\n' +
                '\n' +
                'BUTTONS\n' +
                'Build Strategy – Builds the selected combo (Win Increase %, Loss Reset, Buffer %) into your strategy and takes you straight to the Play tab.\n' +
                '\n' +
                '\n' +
                'STRATEGY FINDER TAB\n' +
                '\n' +
                'PARAMETER RANGES\n' +
                'Combo – A single set of parameter values tested by the strategy finder.\n' +
                'Starting Balance – The initial balance applied to all combos during optimization.\n' +
                'Trials per Combo – The number of simulations run for each parameter combination.\n' +
                'Bet Divisor Range – Bet divisor values to test, entered as From - To fields.\n' +
                'Profit Multiplier Range – Profit multiplier values to test, entered as From - To fields.\n' +
                'Win Increase % Range – Win increase percentages to test, entered as From - To fields.\n' +
                'Loss Reset – Loss reset counts to test (integers), entered as From - To fields.\n' +
                'Buffer % Range – Buffer percentages to test, entered as From - To fields.\n' +
                'From / To – The lowest and highest value of a range. Leave To blank to test a single value, or leave the whole range blank and use only Values.\n' +
                'Step – The increment used to walk a range (e.g., 50 - 100 with step 5 tests 50, 55 ... 100). Leave blank for the default.\n' +
                'Values – Individual numbers to test, comma-separated (e.g., 25,30,40). These are combined with the range if both are filled.\n' +
                '\n' +
                'BUTTONS\n' +
                'Run Strategy Finder – Begins testing all combinations using the provided ranges.\n' +
                'Clear Results – Removes existing results from the results tab.\n' +
                'Stop – Terminates the search currently running. (Note: If you get the Large Search Warning popup, you won\'t be able to use Stop. Doing so may break the strategy finder and you\'ll need to reload the page.)\n' +
                '\n' +
                '\n' +
                'STRATEGY FINDER RESULTS TAB\n' +
                '\n' +
                'RESULTS DEFINITIONS\n' +
                'BetDiv – Bet divisor used in the tested combo.\n' +
                'ProfitMult – Profit multiplier applied to that combo.\n' +
                'W% – Win increase percentage value.\n' +
                'L – Number of losses before reset.\n' +
                'Buffer% – Additional buffer percentage applied to the multiplier.\n' +
                'AvgHigh – The average of highest balances across trials.\n' +
                'StdDev – The standard deviation of highest balances, measuring risk.\n' +
                'MaxHigh – The maximum balance achieved in any trial.\n' +
                'AvgCycles – Average successful profit cycles achieved per trial.\n' +
                'AvgRounds – Average number of rolls executed per trial.\n' +
                'CycleSuccess% – Percentage of cycles that reached profit targets successfully.\n' +
                'Bust% – Percentage of trials that ended with no successful cycles (busts).\n' +
                'Score – Performance metric calculated as (AvgHigh − Start) / StdDev.\n' +
                '\n' +
                'BUTTONS\n' +
                'Apply Selected to Calculator – Loads parameters from a selected result row into the Calculator tab for testing.\n' +
                'Save to CSV – Exports all result rows into a CSV file for later review.\n';

            // Subheaders (small heading style) — case-sensitive list lifted
            // from the original terms_tab.py plus the new Stats subheaders.
            const SUBHEADERS = new Set([
                'CONTROLS DECK',
                'LIVE STATS',
                'PARAMETERS',
                'CALCULATED VALUES',
                'SIMULATION CONTROLS',
                'SIMULATION RESULTS',
                'PARAMETER RANGES',
                'BUTTONS',
                'RESULTS DEFINITIONS'
            ]);

            // Build the panel HTML. Strings are escaped via a helper to
            // prevent any embedded angle brackets from breaking layout.
            function escapeHtml(s) {
                return String(s).replace(/[&<>"']/g, c => ({
                    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
                }[c]));
            }
            const lines = [];
            for (const raw of TERMS_TEXT.split('\n')) {
                const stripped = raw.trim();
                if (!stripped) { lines.push('<div class="dt-terms-spacer"></div>'); continue; }
                if (stripped === stripped.toUpperCase() && stripped.endsWith('TAB')) {
                    lines.push('<h3 class="dt-terms-heading">' + escapeHtml(stripped) + '</h3>');
                    continue;
                }
                if (SUBHEADERS.has(stripped)) {
                    lines.push('<h4 class="dt-terms-subheading">' + escapeHtml(stripped) + '</h4>');
                    continue;
                }
                let label = null, def = null;
                if (stripped.indexOf(' – ') !== -1) {
                    [label, def] = stripped.split(/ – (.+)/);
                } else if (stripped.indexOf(' - ') !== -1) {
                    [label, def] = stripped.split(/ - (.+)/);
                }
                if (label && def) {
                    lines.push('<p class="dt-terms-row"><span class="dt-terms-label">' + escapeHtml(label) + '</span><span class="dt-terms-dash"> – </span><span class="dt-terms-def">' + escapeHtml(def) + '</span></p>');
                } else {
                    lines.push('<p class="dt-terms-text">' + escapeHtml(stripped) + '</p>');
                }
            }

            const termsPanel = document.createElement('section');
            termsPanel.className = 'dt-panel';
            termsPanel.id = 'dt-panel-terms';
            termsPanel.innerHTML =
                '<input type="text" class="dt-terms-search" id="dt-terms_search" placeholder="🔍  Search terms…" aria-label="Search terms">' +
                '<div class="dt-terms-empty" id="dt-terms_empty" hidden>No terms match your search.</div>' +
                '<div class="dt-terms-scroll" id="dt-terms_scroll">' + lines.join('') + '</div>';
            body.appendChild(termsPanel);

            // Live filter: hide rows that don't match; hide section headers whose
            // whole section was filtered out. Pure presentation — no data changes.
            const searchEl = termsPanel.querySelector('#dt-terms_search');
            const scrollEl = termsPanel.querySelector('#dt-terms_scroll');
            const emptyEl = termsPanel.querySelector('#dt-terms_empty');
            if (searchEl && scrollEl) {
                searchEl.addEventListener('input', () => {
                    const q = searchEl.value.trim().toLowerCase();
                    const kids = Array.from(scrollEl.children);
                    let anyVisible = false;
                    if (!q) {
                        kids.forEach(el => { el.style.display = ''; });
                        emptyEl.hidden = true;
                        return;
                    }
                    // First pass: show/hide individual term rows + text by match.
                    kids.forEach(el => {
                        if (el.classList.contains('dt-terms-heading') || el.classList.contains('dt-terms-subheading') || el.classList.contains('dt-terms-spacer')) {
                            el.style.display = 'none';  // headers handled in 2nd pass
                            return;
                        }
                        const hit = el.textContent.toLowerCase().includes(q);
                        el.style.display = hit ? '' : 'none';
                        if (hit) anyVisible = true;
                    });
                    // Second pass: reveal a heading only if its section has any visible
                    // row; reveal a subheading only if ITS sub-section (up to the next
                    // heading OR subheading) has a visible row.
                    for (let i = 0; i < kids.length; i++) {
                        const el = kids[i];
                        const isHeading = el.classList.contains('dt-terms-heading');
                        const isSub = el.classList.contains('dt-terms-subheading');
                        if (isHeading || isSub) {
                            let show = false;
                            for (let j = i + 1; j < kids.length; j++) {
                                if (kids[j].classList.contains('dt-terms-heading')) break;
                                if (isSub && kids[j].classList.contains('dt-terms-subheading')) break;
                                if (kids[j].style.display !== 'none' && !kids[j].classList.contains('dt-terms-subheading') && !kids[j].classList.contains('dt-terms-spacer')) { show = true; break; }
                            }
                            el.style.display = show ? '' : 'none';
                        }
                    }
                    emptyEl.hidden = anyVisible;
                });
            }

            termsSetup = true;
            return true;
        }

        const STATS_TRACK_KEY = '__iow_stats_track_per__';  // localStorage: 'session' | 'cycle'

        /**
         * Move the dice tool's actual W/L counter <div>s out of the floating
         * counter HUD and into the deck slots. The dice tool's own update
         * path keeps working unchanged because it queries the elements by
         * ID — only the parent changes. Re-runnable: if the elements aren't
         * in the deck slots yet (e.g. dice tool mounted late), we try again
         * on the next stitch-tick.
         */
        function relocateDiceCounter() {
            const panel = document.getElementById('dt-panel-stats');
            if (!panel) return;
            const slotW = panel.querySelector('[data-counter-slot="w"]');
            const slotL = panel.querySelector('[data-counter-slot="l"]');
            const ctrW = document.getElementById('dt-ctr_w');
            const ctrL = document.getElementById('dt-ctr_l');
            if (slotW && ctrW && ctrW.parentElement !== slotW) {
                slotW.appendChild(ctrW);
            }
            if (slotL && ctrL && ctrL.parentElement !== slotL) {
                slotL.appendChild(ctrL);
            }
        }

        /**
         * Wire up every input/button in the Stats deck to its dice-tool
         * counterpart with two-way binding. Re-entrancy is guarded by
         * `statsSyncing` so HUD↔Calc updates don't infinite-loop.
         */
        function wireStatsControls() {
            const hudBetDiv = document.getElementById('dt-stats-bet-div');
            const hudProfMult = document.getElementById('dt-stats-profit-mult');
            const calcBetDiv = document.getElementById('dt-bet_div');
            const calcProfMult = document.getElementById('dt-profit_mult');

            // Two-way bind: HUD inputs <-> Calculator inputs.
            function pushFromHud(srcHud, dstCalc) {
                if (statsSyncing || !srcHud || !dstCalc) return;
                statsSyncing = true;
                try {
                    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                    setter.call(dstCalc, srcHud.value);
                    dstCalc.dispatchEvent(new Event('input', { bubbles: true }));
                    dstCalc.dispatchEvent(new Event('change', { bubbles: true }));
                } finally { statsSyncing = false; }
            }
            function pushFromCalc(srcCalc, dstHud) {
                if (statsSyncing || !srcCalc || !dstHud) return;
                statsSyncing = true;
                try { dstHud.value = srcCalc.value; } finally { statsSyncing = false; }
            }

            if (hudBetDiv && calcBetDiv) {
                pushFromCalc(calcBetDiv, hudBetDiv);
                hudBetDiv.addEventListener('input', () => pushFromHud(hudBetDiv, calcBetDiv));
                calcBetDiv.addEventListener('input', () => pushFromCalc(calcBetDiv, hudBetDiv));
            }
            if (hudProfMult && calcProfMult) {
                pushFromCalc(calcProfMult, hudProfMult);
                hudProfMult.addEventListener('input', () => pushFromHud(hudProfMult, calcProfMult));
                calcProfMult.addEventListener('input', () => pushFromCalc(calcProfMult, hudProfMult));
            }

            // Stats Track Per dropdown: persist selection. Session = lifetime
            // (resets only on page refresh or Reset). Cycle = since last Start
            // click (reset baseline each new cycle).
            const trackSel = document.getElementById('dt-stats-track-per');
            if (trackSel) {
                try {
                    const saved = localStorage.getItem(STATS_TRACK_KEY);
                    if (saved === 'session' || saved === 'cycle') trackSel.value = saved;
                } catch {}
                trackSel.addEventListener('change', () => {
                    try { localStorage.setItem(STATS_TRACK_KEY, trackSel.value); } catch {}
                    updateStatsTab();
                });
            }

            // Autostop checkbox + Win Streak target: mirror dice tool's own
            // counter controls (#dt-counter_autostop in Settings, #dt-ctr_target
            // in the floating counter HUD).
            const hudAutostop = document.getElementById('dt-stats-autostop');
            const hudTarget = document.getElementById('dt-stats-target');
            const calcAutostop = document.getElementById('dt-counter_autostop');
            const calcTarget = document.getElementById('dt-ctr_target');
            if (hudAutostop && calcAutostop) {
                hudAutostop.checked = calcAutostop.checked;
                hudAutostop.addEventListener('change', () => {
                    if (statsSyncing) return;
                    statsSyncing = true;
                    try { calcAutostop.checked = hudAutostop.checked; calcAutostop.dispatchEvent(new Event('change', { bubbles: true })); } finally { statsSyncing = false; }
                });
                calcAutostop.addEventListener('change', () => {
                    if (statsSyncing) return;
                    statsSyncing = true;
                    try { hudAutostop.checked = calcAutostop.checked; } finally { statsSyncing = false; }
                });
            }
            if (hudTarget && calcTarget) {
                hudTarget.value = calcTarget.value;
                hudTarget.addEventListener('change', () => {
                    if (statsSyncing) return;
                    statsSyncing = true;
                    try {
                        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                        setter.call(calcTarget, hudTarget.value);
                        calcTarget.dispatchEvent(new Event('change', { bubbles: true }));
                    } finally { statsSyncing = false; }
                });
                calcTarget.addEventListener('change', () => {
                    if (statsSyncing) return;
                    statsSyncing = true;
                    try { hudTarget.value = calcTarget.value; } finally { statsSyncing = false; }
                });
            }

            // Volume slider — two-way bind to the dice tool's #dt-ctr_vol
            // (which the dice tool's playBeep() reads as state.counter_volume
            // on every win). Updating either slider updates the other and
            // dispatches input/change events so playBeep gets the new gain.
            const hudVolume = document.getElementById('dt-stats-volume');
            const hudVolumeVal = document.getElementById('dt-stats-volume-val');
            const calcVolume = document.getElementById('dt-ctr_vol');
            function reflectVolume(v) {
                if (hudVolumeVal) hudVolumeVal.textContent = String(parseInt(v, 10) || 0);
            }
            if (hudVolume && calcVolume) {
                hudVolume.value = calcVolume.value;
                reflectVolume(hudVolume.value);
                hudVolume.addEventListener('input', () => {
                    if (statsSyncing) return;
                    reflectVolume(hudVolume.value);
                    statsSyncing = true;
                    try {
                        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                        setter.call(calcVolume, hudVolume.value);
                        calcVolume.dispatchEvent(new Event('input', { bubbles: true }));
                        calcVolume.dispatchEvent(new Event('change', { bubbles: true }));
                    } finally { statsSyncing = false; }
                });
                calcVolume.addEventListener('input', () => {
                    if (statsSyncing) return;
                    statsSyncing = true;
                    try { hudVolume.value = calcVolume.value; reflectVolume(hudVolume.value); } finally { statsSyncing = false; }
                });
            } else if (hudVolume) {
                // Calc slider isn't ready yet — try to bind on a delay so
                // the deck slider works even if the dice tool mounts late.
                reflectVolume(hudVolume.value);
                hudVolume.addEventListener('input', () => reflectVolume(hudVolume.value));
                let tries = 0;
                const bindLater = setInterval(() => {
                    const cv = document.getElementById('dt-ctr_vol');
                    if (cv) {
                        clearInterval(bindLater);
                        hudVolume.value = cv.value;
                        reflectVolume(hudVolume.value);
                        hudVolume.addEventListener('input', () => {
                            if (statsSyncing) return;
                            statsSyncing = true;
                            try {
                                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                                setter.call(cv, hudVolume.value);
                                cv.dispatchEvent(new Event('input', { bubbles: true }));
                                cv.dispatchEvent(new Event('change', { bubbles: true }));
                            } finally { statsSyncing = false; }
                        });
                    } else if (++tries > 40) {
                        clearInterval(bindLater);
                    }
                }, 250);
            }

            // Update Strategy button: invoke the dice tool's gameSync
            // ("Export Balance & Update Strategy") and then re-render Stats so
            // Balance Target / Profit Stop reflect the new calc outputs.
            const updateBtn = document.getElementById('dt-stats-update');
            if (updateBtn) {
                updateBtn.addEventListener('click', () => {
                    // Push HUD values into calc first.
                    if (hudBetDiv && calcBetDiv) pushFromHud(hudBetDiv, calcBetDiv);
                    if (hudProfMult && calcProfMult) pushFromHud(hudProfMult, calcProfMult);
                    // Click the dice tool's existing "Export Balance & Update Strategy" button.
                    const sync = document.getElementById('dt-game_sync');
                    if (sync) sync.click();
                    updateStatsTab();
                });
            }

            // Reset button: clear all IOW/Smart stats (session + per-run).
            const resetBtn = document.getElementById('dt-stats-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    try {
                        if (typeof window.__iow_smart_reset__ === 'function') window.__iow_smart_reset__();
                    } catch (e) { console.error('[Stats] reset failed:', e); }
                    if (window.__iow_smart_state__) {
                        window.__iow_smart_state__.runBaseline = null;
                        window.__iow_smart_state__.runStats = null;
                    }
                    // Also reset the dice tool's streak counter if available.
                    const ctrReset = document.getElementById('dt-ctr_reset');
                    if (ctrReset) ctrReset.click();
                    updateStatsTab();
                });
            }

            // Start/Stop button: two-way toggle.
            //   START  — clicks Stake's native Advanced "Start Autoplay"
            //            and baselines per-cycle stats.
            //   STOP   — clicks the native button while it's in stop state
            //            (Stake's same button toggles between start/stop).
            // The visual state is driven by syncStartBtn() which polls the
            // native button's data-autobet-status, so our button stays in
            // sync even if autoplay self-terminates (autostop, balance hit).
            const startBtn = document.getElementById('dt-stats-start');
            if (startBtn) {
                startBtn.addEventListener('click', () => {
                    try {
                        const running = startBtn.dataset.running === 'true';
                        if (running) {
                            const stopBtn = findNativeStopButton() || findNativeStartButton();
                            if (stopBtn) stopBtn.click();
                        } else {
                            const native = findNativeStartButton();
                            if (!native) {
                                console.warn('[Stats] native Start button not found');
                                return;
                            }
                            // Snapshot the wager value BEFORE clicking native
                            // Start. Switch Over/Under uses this to restore
                            // the bet after stopping autoplay mid-run.
                            const inp = getWagerInput();
                            if (inp && inp.value) baseBetAtStart = inp.value;
                            native.click();
                            if (typeof window.__iow_smart_baseline_now__ === 'function') {
                                window.__iow_smart_baseline_now__();
                            }
                        }
                        // Re-sync immediately so the visual flips on click.
                        // The 500 ms ticker will continue to authoritative-sync
                        // from the native state.
                        setTimeout(syncStartBtn, 60);
                    } catch (e) { console.error('[Stats] start failed:', e); }
                });
            }

            // ---- Switch Over/Under ----
            // While autoplay is NOT running: one-click toggles native Roll
            // Over/Under direction.
            // While autoplay IS running:
            //   1. Stop native autoplay
            //   2. Restore the wager input to baseBetAtStart (so progression
            //      doesn't keep escalating across the switch)
            //   3. Click the native Roll Over/Under swap
            //   4. Re-start native autoplay
            // baseBetAtStart is captured above when the user clicks START.
            const switchBtn = document.getElementById('dt-stats-switch-ou');
            if (switchBtn) {
                switchBtn.addEventListener('click', async () => {
                    if (switchBtn.disabled) return;
                    switchBtn.disabled = true;
                    try {
                        const stopBtn = findNativeStopButton();
                        const wasRunning = !!stopBtn;
                        const swap = getRollOverUnderSwap();
                        if (!swap) { console.warn('[Switch Over/Under] swap button not found'); return; }

                        if (!wasRunning) {
                            // Idle path: just toggle direction.
                            swap.click();
                            return;
                        }

                        // Running path: stop → restore bet → swap → start.
                        // NOTE: do NOT call __iow_smart_baseline_now__ here —
                        // per-cycle stats must persist across an Over/Under
                        // swap so users can see the full cycle's stats. Only
                        // the deck Start button resets the per-cycle baseline.
                        stopBtn.click();
                        await sleep(120);
                        if (baseBetAtStart != null) writeWagerValue(baseBetAtStart);
                        await sleep(60);
                        swap.click();
                        await sleep(120);
                        const startAgain = findNativeStartButton();
                        if (startAgain && !startAgain.disabled) {
                            startAgain.click();
                        }
                        setTimeout(syncStartBtn, 80);
                    } catch (e) {
                        console.error('[Switch Over/Under] failed:', e);
                    } finally {
                        // Re-arm a moment later so a rapid double-click can't
                        // overlap an in-flight sequence.
                        setTimeout(() => { switchBtn.disabled = false; }, 400);
                    }
                });
            }
        }

        /** Get the wager input — platform-aware. */
        function getWagerInput() {
            return document.querySelector('input[data-testid="bet-amount"]')           // Shuffle
                || document.querySelector('input[data-testid="input-game-amount"]');   // Stake
        }

        /** Get the native Roll Over/Under swap clickable — platform-aware. */
        function getRollOverUnderSwap() {
            return document.querySelector('button[class*="RollOverInput_inputContainer"]')  // Shuffle: whole "Roll Over" label is the toggle button
                || document.querySelector('input[data-testid="reverse-roll"]')              // Stake: reverse-roll input is click-styled as a toggle
                || document.querySelector('[data-testid="reverse-roll"]');                  // Fallback variant
        }

        /** Write a value into the wager input, React-friendly (uses the prototype setter). */
        function writeWagerValue(value) {
            const inp = getWagerInput();
            if (!inp) return false;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(inp, value);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        /** Local sleep helper — the dice tool's own sleep lives in a different scope. */
        function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        /**
         * Read the strategy editor's Condition 4 and, if it's configured as
         * "Stop autoplay" on "Balance ≥ X", return X. Returns null if Condition
         * 4 doesn't match that pattern, or the editor isn't currently visible.
         *
         * Used by the Stats tab to populate the Balance Target row directly
         * from the strategy the user has loaded — so the displayed target
         * tracks whatever the running strategy will actually stop on, not the
         * Calculator output (which may be a different value if the user
         * manually tweaked Condition 4 after import).
         *
         * Supports both Stake (testid-based DOM) and Shuffle (CSS-module DOM).
         */
        function readCondition4BalanceTarget() {
            // ---- Stake (stake.com / stake.us) ----
            // Strategy editor uses [data-testid="conditional-block-4"] for the
            // Condition 4 panel. When expanded, it contains 3 selects and the
            // amount input, all keyed by data-testid.
            const stakeBlock = document.querySelector('[data-testid="conditional-block-4"]');
            if (stakeBlock) {
                const profitType = stakeBlock.querySelector('select[data-testid="condition-profit-type"]');
                const termType   = stakeBlock.querySelector('select[data-testid="condition-profit-term-type-options"]');
                const action     = stakeBlock.querySelector('select[data-testid="condition-action-options"]');
                const amount     = stakeBlock.querySelector('input[data-testid="condition-profit-amount-input"]');
                if (profitType && termType && action && amount) {
                    const isBalance = profitType.value === 'balance';
                    const isGteOrGt = termType.value === 'greaterThanOrEqualTo' || termType.value === 'greaterThan';
                    // Stake has changed the "stop autoplay" select value over
                    // time — accept both old and new identifiers.
                    const isStop = action.value === 'stop' || action.value === 'stopAutobet' || action.value === 'stopAutoplay';
                    if (isBalance && isGteOrGt && isStop && amount.value) {
                        const n = parseFloat(amount.value);
                        if (!isNaN(n)) return n;
                    }
                }
            }
            // ---- Shuffle ----
            // Strategy editor uses .AdvancedDiceCondition_root__CaIQo for each
            // condition row. Index 3 is Condition 4. Inside: 3 selects + the
            // amount input, in document order.
            const shuffleConds = document.querySelectorAll('.AdvancedDiceCondition_root__CaIQo');
            if (shuffleConds.length >= 4) {
                const cond4 = shuffleConds[3];
                const selects = cond4.querySelectorAll('select');
                const amount  = cond4.querySelector('input[type="number"]');
                if (selects.length >= 3 && amount) {
                    const isBalance = selects[0].value === 'balance';
                    const isGteOrGt = selects[1].value === 'greaterThanOrEqualTo' || selects[1].value === 'greaterThan';
                    const isStop    = selects[2].value === 'stopAutobet' || selects[2].value === 'stop' || selects[2].value === 'stopAutoplay';
                    if (isBalance && isGteOrGt && isStop && amount.value) {
                        const n = parseFloat(amount.value);
                        if (!isNaN(n)) return n;
                    }
                }
            }
            return null;
        }

        /** Poll the strategy editor for Condition 4's Balance Target. Caches
         *  the last valid value so the stat persists when the modal is closed. */
        function refreshCond4BalanceTargetCache() {
            const v = readCondition4BalanceTarget();
            if (v != null) cond4BalanceTarget = v;
        }
        /** Find Stake's native auto-bet "Stop" button (only present while autoplay is running). */
        function findNativeStopButton() {
            // Stake's Advanced auto-bet button signals "running" with
            // data-autobet-status="stop" — clicking it stops autoplay.
            const stopByAttr = document.querySelector('button[data-testid="auto-bet-button"][data-autobet-status="stop"]') ||
                               document.querySelector('button[data-test="auto-bet-button"][data-autobet-status="stop"]') ||
                               document.querySelector('button[data-autobet-status="stop"]');
            if (stopByAttr && !stopByAttr.disabled) return stopByAttr;
            // Fallback: text match
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                const txt = (b.textContent || '').trim().toLowerCase();
                if ((txt === 'stop autoplay' || txt === 'stop auto' || txt === 'stop') && !b.disabled) {
                    return b;
                }
            }
            return null;
        }

        /** Find Stake's native bet/play button (doubles as "Start Autoplay" in Advanced mode). */
        function findNativeStartButton() {
            // Stake's bet button is different per mode:
            //   - Manual mode → button[data-testid="bet-button"]   ("Play")
            //   - Advanced mode → button[data-testid="auto-bet-button"] ("Start Autoplay")
            // Live DOM probe verified both. The Advanced one carries
            // data-autobet-status="start"/"stop" depending on run state —
            // findNativeStopButton uses the "stop" variant of that selector.
            const testIds = [
                'button[data-testid="auto-bet-button"][data-autobet-status="start"]',
                'button[data-testid="auto-bet-button"]',
                'button[data-testid="bet-button"]',
                'button[data-test="bet-button"]',
                '[data-testid="autoplay-button"]',
                '[data-testid="start-autoplay"]',
                '[data-testid="bet-btn"]'
            ];
            for (const sel of testIds) {
                const el = document.querySelector(sel);
                if (el && !isOurInternalEl(el) && !el.disabled) return el;
            }
            // Fallback: text match on buttons outside our injected UIs.
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                if (isOurInternalEl(b)) continue;
                const txt = (b.textContent || '').trim().toLowerCase();
                if (txt === 'start autoplay' || txt === 'start' || txt === 'start auto' || txt === 'play' || txt === 'bet') {
                    if (!b.disabled) return b;
                }
            }
            return null;
        }

        /* ---- STATS RENDERING HELPERS ---- */

        /** Format a number with `dp` decimals (default 2), or em-dash if not finite. */
        function fmt(n, dp) {
            if (typeof n !== 'number' || !isFinite(n)) return '—';
            return n.toFixed(dp == null ? 2 : dp);
        }
        /** Like fmt() but prefixes positive numbers with "+". */
        function fmtSigned(n, dp) {
            if (typeof n !== 'number' || !isFinite(n)) return '—';
            const s = n.toFixed(dp == null ? 2 : dp);
            return n > 0 ? '+' + s : s;
        }

        /**
         * Format a single stat for display.
         * @returns {{text: string, cls: 'pos'|'neg'|'peak'|''}}
         *          cls drives the color cue (green/red/peak-green/default).
         */
        function formatStat(stat, data) {
            if (!data) return { text: '—', cls: '' };
            switch (stat) {
                case 'startingBalance': return { text: fmt(data.startingBalance), cls: '' };
                case 'profit': {
                    const v = data.profit;
                    return { text: fmtSigned(v), cls: typeof v === 'number' ? (v > 0 ? 'pos' : v < 0 ? 'neg' : '') : '' };
                }
                case 'sessionPeak': return { text: fmt(data.sessionPeak), cls: 'peak' };
                case 'peakProfit': return { text: fmtSigned(data.peakProfit), cls: 'peak' };
                case 'totalBets': return { text: String(data.totalBets || 0), cls: '' };
                case 'totalWagered': return { text: fmt(data.totalWagered), cls: '' };
                case 'winsLosses': {
                    const w = data.totalWins || 0;
                    const l = data.totalLosses || 0;
                    return { text: w + ' / ' + l, cls: '' };
                }
                case 'rtp': {
                    const v = data.rtp;
                    return { text: fmt(v) + '%', cls: typeof v === 'number' ? (v >= 100 ? 'pos' : 'neg') : '' };
                }
                case 'streaks':
                    return { text: (data.curWinStreak || 0) + '/' + (data.maxWinStreak || 0) + ' | ' + (data.curLossStreak || 0) + '/' + (data.maxLossStreak || 0), cls: '' };
                case 'multPerf': {
                    const games = data.multGames || 0;
                    const wins = data.multWins || 0;
                    if (wins <= 0) return { text: '1 in 0.00', cls: '' };
                    const ratio = games / wins;
                    const target = data.trackedMultiplier || 0;
                    return { text: '1 in ' + ratio.toFixed(2), cls: target > 0 && ratio <= target ? 'pos' : 'neg' };
                }
            }
            return { text: '—', cls: '' };
        }

        /** Pick the active stats source based on the user's "Stats Track Per" choice. */
        function getActiveStatsSource() {
            const sel = document.getElementById('dt-stats-track-per');
            const mode = sel ? sel.value : 'session';
            const state = window.__iow_smart_state__ || {};
            return mode === 'cycle' ? state.runStats : state.sessionStats;
        }

        /** Refresh every stat row, the Best/Worst streaks, the calc-derived rows, the graph, and the start button. */
        function updateStatsTab() {
            const panel = document.getElementById('dt-panel-stats');
            if (!panel) return;

            // The W/L counters are the dice tool's actual #dt-ctr_w / #dt-ctr_l
            // elements physically relocated into the deck (see
            // relocateDiceCounter). The dice tool keeps writing to them
            // directly — no mirror needed here.

            // Skip heavy rendering when the tab isn't visible.
            const dicePanel = document.getElementById('dt-aio-panel');
            const visible = panel.classList.contains('active') &&
                dicePanel && !dicePanel.classList.contains('dt-bridge-hidden');
            if (!visible) {
                syncStartBtn();
                return;
            }

            const data = getActiveStatsSource();

            // Per-stat rows. The Stats tab uses the IOW/Smart .hud-row /
            // .hud-val class hierarchy directly, so we read .hud-val here.
            panel.querySelectorAll('.hud-row[data-stat]').forEach(row => {
                const stat = row.dataset.stat;
                const valEl = row.querySelector('.hud-val');
                if (!valEl) return;
                const res = formatStat(stat, data);
                valEl.textContent = res.text;
                // Match the Smart panel's color cues: green for pos,
                // soft red for neg, leave unset values default-colored. The
                // Peak Balance / Peak Profit rows already have an inline
                // green color in the markup and we don't override that.
                if (res.cls === 'pos') valEl.style.color = '#00ff9d';
                else if (res.cls === 'neg') valEl.style.color = '#f87171';
                else if (!valEl.style.color || valEl.style.color === 'rgb(0, 255, 157)' || valEl.style.color === 'rgb(248, 113, 113)') {
                    // Don't clobber the inline peak color; only reset if we
                    // were the ones who set it.
                    if (!row.matches('[data-stat="sessionPeak"]') && !row.matches('[data-stat="peakProfit"]')) {
                        valEl.style.color = '';
                    }
                }
            });

            // Best / Worst streaks. Now flat .hud-meta-chip values, no
            // dropdown — rendered as a comma-separated list inline.
            const bestList = panel.querySelector('[data-stat="bestStreaks"]');
            const worstList = panel.querySelector('[data-stat="worstStreaks"]');
            if (bestList) bestList.textContent = (data && data.topWinStreaks && data.topWinStreaks.length) ? data.topWinStreaks.join(', ') : '-';
            if (worstList) worstList.textContent = (data && data.topLossStreaks && data.topLossStreaks.length) ? data.topLossStreaks.join(', ') : '-';

            // Refresh the Condition 4 cache opportunistically — when the
            // Advanced Play modal is open with Condition 4 expanded, this
            // captures the current threshold. Otherwise the cached value
            // (from the last time it was visible) is used.
            refreshCond4BalanceTargetCache();

            // Balance Target — read from the loaded strategy's Condition 4
            // (when it's a "Stop autoplay" on "Balance ≥ X"), falling back to
            // blank if the user has never had a compatible Condition 4 visible
            // since page load. Decoupled from the Calculator output so the
            // displayed target tracks the strategy that will actually run,
            // not whatever value the Calculator most recently computed.
            const balTargetEl = panel.querySelector('#dt-stats-bal-target');
            const profStopEl = panel.querySelector('#dt-stats-profit-stop');
            const calcProfit = document.getElementById('dt-out_profit');
            if (balTargetEl) {
                balTargetEl.textContent = (cond4BalanceTarget != null)
                    ? cond4BalanceTarget.toFixed(2)
                    : '';
            }
            if (profStopEl) profStopEl.textContent = (calcProfit && calcProfit.value) ? calcProfit.value : '0.00';

            syncStartBtn();
            drawStatsGraph(panel, data ? data.profitHistory : []);
        }

        /** Sync the deck Start/Stop button visual state from the native auto-bet status. */
        function syncStartBtn() {
            const startBtn = document.getElementById('dt-stats-start');
            if (!startBtn) return;
            // Detect Stake's Advanced auto-bet running state. When running,
            // the same bet button carries data-autobet-status="stop" (the
            // click stops it). When idle, it doesn't. We mirror that into
            // our deck button so the visual stays in sync even if autoplay
            // self-terminates (autostop on balance, take-profit, etc.).
            const running = !!(
                document.querySelector('button[data-testid="auto-bet-button"][data-autobet-status="stop"]') ||
                document.querySelector('button[data-test="auto-bet-button"][data-autobet-status="stop"]') ||
                document.querySelector('button[data-autobet-status="stop"]')
            );
            startBtn.classList.add('hud-rapid-btn');
            if (running) {
                if (startBtn.dataset.running !== 'true') {
                    startBtn.dataset.running = 'true';
                    startBtn.textContent = 'STOP';
                }
                startBtn.classList.add('stop');
                startBtn.classList.remove('start');
            } else {
                if (startBtn.dataset.running !== 'false') {
                    startBtn.dataset.running = 'false';
                    startBtn.textContent = 'START';
                }
                startBtn.classList.add('start');
                startBtn.classList.remove('stop');
            }
        }

        /** Render the profit-history canvas with green-above / red-below-zero gradient fill. */
        function drawStatsGraph(panel, history) {
            const canvas = panel && panel.querySelector('#dt-stats-graph');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const w = canvas.width = canvas.offsetWidth;
            const h = canvas.height = canvas.offsetHeight;
            ctx.clearRect(0, 0, w, h);
            if (!history || history.length < 2) return;

            let maxVal = Math.max.apply(null, history.concat([0]));
            let minVal = Math.min.apply(null, history.concat([0]));
            const range = (maxVal - minVal) || 1;
            const pad = range * 0.15;
            maxVal += pad; minVal -= pad;
            const totalRange = maxVal - minVal;
            const zeroY = h - ((0 - minVal) / totalRange) * h;
            const zeroPct = Math.max(0, Math.min(1, zeroY / h));

            const lineGrad = ctx.createLinearGradient(0, 0, 0, h);
            lineGrad.addColorStop(0, '#10b981');
            lineGrad.addColorStop(zeroPct, '#10b981');
            lineGrad.addColorStop(zeroPct, '#ef4444');
            lineGrad.addColorStop(1, '#ef4444');

            const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
            fillGrad.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
            fillGrad.addColorStop(zeroPct, 'rgba(16, 185, 129, 0.22)');
            fillGrad.addColorStop(zeroPct, 'rgba(239, 68, 68, 0.22)');
            fillGrad.addColorStop(1, 'rgba(239, 68, 68, 0.22)');

            const stepX = w / (history.length - 1);
            ctx.beginPath();
            for (let i = 0; i < history.length; i++) {
                const x = i * stepX;
                const y = h - ((history[i] - minVal) / totalRange) * h;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = lineGrad;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.stroke();

            ctx.lineTo(w, zeroY); ctx.lineTo(0, zeroY); ctx.closePath();
            ctx.fillStyle = fillGrad;
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(0, zeroY);
            ctx.lineTo(w, zeroY);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        /* ---- ADVANCED IOW MODE TOGGLE ----
           Activating swaps the dice panel into #hud-content; deactivating
           returns it to its original parent and restores the previously
           active Manual / IOW / Smart mode. */

        /** Switch into "Advanced IOW" mode. */
        function activateTools() {
            const hudContent = document.getElementById('hud-content');
            if (!hudContent || !dicePanel) return;
            // Mode isolation: any IOW/Smart/Manual rapid-fire that was running
            // must stop before Advanced IOW takes over the page. The IOW/Smart
            // body exports stopRapidFire as window.__iow_smart_stop__.
            try { if (typeof window.__iow_smart_stop__ === 'function') window.__iow_smart_stop__(); } catch (e) {}
            const activeModeBtn = hud && hud.querySelector('.mode-wrap .mode-btn.active');
            if (activeModeBtn && activeModeBtn.id !== 'mode-dice-tools') {
                lastNonToolsMode = activeModeBtn.id.replace(/^mode-/, '');
            }
            hudContent.innerHTML = '';
            hudContent.appendChild(dicePanel);
            dicePanel.classList.remove('dt-bridge-hidden');
            dicePanel.classList.add('show');
            toolsActive = true;
            if (hud) hud.dataset.toolsActive = '1';
            if (toolsBtn) toolsBtn.classList.add('active');
            // Single, explicit native switch on transition. The ticker won't
            // spam clicks because of the new positive-detection guard.
            forceNativeMode('advanced');
        }

        /** Leave "Advanced IOW" mode — dice panel goes back to its original parent. */
        function deactivateTools() {
            if (!toolsActive) return;
            // Mode isolation: any native autoplay started under Advanced IOW
            // must stop before another mode takes over the page.
            try {
                const stopBtn = findNativeStopButton();
                if (stopBtn) stopBtn.click();
            } catch (e) {}
            if (dicePanel && originalParent) {
                originalParent.appendChild(dicePanel);
                dicePanel.classList.remove('show');
                dicePanel.classList.add('dt-bridge-hidden');
            }
            toolsActive = false;
            if (hud) delete hud.dataset.toolsActive;
            if (toolsBtn) toolsBtn.classList.remove('active');
            forceNativeMode('manual');
        }

        /* ---- MASTER TICKER ----
           Drives stitch attempts, native mode enforcement, Stats tab refresh,
           dice-counter relocation safety, and Terms tab self-heal. One
           interval, 500ms cadence. */

        let stitchAttempts = 0;
        let lastTickedUrl = location.href;
        const MAX_STITCH_ATTEMPTS = 60;  // ~30s at 500ms cadence
        setInterval(() => {
            // URL-change reset — when the user SPA-navs (e.g. limbo → dice),
            // give us a fresh stitch-attempt budget so we can wire up the
            // Advanced IOW button on the new page even if we'd exhausted
            // attempts on the previous one.
            if (location.href !== lastTickedUrl) {
                lastTickedUrl = location.href;
                stitchAttempts = 0;
            }
            // HUD-change detection: if the toolsBtn is missing but the HUD
            // exists (SPA navigation just rebuilt it), re-stitch from scratch
            // with a fresh attempt budget.
            const currentHud = document.getElementById('ratchet-master-container');
            const currentToolsBtn = document.getElementById('mode-dice-tools');
            if (stitched && currentHud && !currentToolsBtn) {
                stitched = false;
                stitchAttempts = 0;
                toolsBtn = null;
            }
            if (!stitched && stitchAttempts < MAX_STITCH_ATTEMPTS) {
                tryStitch();
                stitchAttempts++;
            }
            // Native mode enforcement runs whenever IOW/Smart HUD is present —
            // including limbo (where Dice Tool isn't loaded). Only does anything
            // when the HUD exists.
            enforceNativeMode();
            // Keep the Condition 4 Balance Target cache fresh even when the
            // Stats tab isn't visible — so when the user opens the Stats tab
            // after configuring a strategy, the target appears immediately
            // (vs waiting for the next stats-tab tick).
            try { refreshCond4BalanceTargetCache(); } catch (e) {}
            // Refresh Stats tab (no-ops if not stitched or tab not visible).
            if (statsSetup) updateStatsTab();
            // Safety: re-relocate the dice counter if Stake's React tree
            // re-mounted the floating counter, or if it wasn't ready when
            // the Stats tab first set up. Cheap (no-op when already in slot).
            if (statsSetup) relocateDiceCounter();
            // Self-heal Terms tab if it wasn't ready on first stitch.
            if (!termsSetup) trySetupTermsTab();
        }, 500);
    }

    console.log('%c[Shuffle Limbo — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
