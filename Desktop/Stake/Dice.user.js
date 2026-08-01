// ==UserScript==
// @name         Stake Dice — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.37
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
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/Dice.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/Dice.user.js
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cStake Dice — Desktop — standalone build v3.37', 'color:#17c7b8;font-weight:800;font-size:13px');

    /* =========================================================
       PRE-STITCH UI HIDER
       --------------------------------------------------------
       On URLs where we will stitch the Dice Tool into the IOW/Smart
       HUD (Stake/Shuffle dice pages), the dice tool's draggable
       floating chrome (#dt-aio-counter, #dt-aio-button, #dt-aio-panel,
       #dt-backdrop) would otherwise flash on screen for a moment
       before tryStitch runs and applies the bridge CSS. We inject
       a tiny stylesheet at document-start to hide them upfront.

       Removed by tryStitch once the bridge CSS is in place; also
       auto-removed after 10s as a safety net so the dice tool's UI
       still shows if stitching never completes.
       ========================================================= */
    (function injectPreStitchHider() {
        const url = location.href;
        const willStitch =
            /^https:\/\/stake\.(?:us|com)\/casino\/games\/dice(?!\w)/.test(url) ||
            /^https:\/\/shuffle\.(?:us|com)\/games\/originals\/dice(?!\w)/.test(url);
        if (!willStitch) return;
        const style = document.createElement('style');
        style.id = 'dt-pre-stitch-css';
        style.textContent =
            '#dt-aio-counter, #dt-aio-button, #dt-aio-panel, #dt-backdrop ' +
            '{ display: none !important; visibility: hidden !important; pointer-events: none !important; }';
        (document.head || document.documentElement).appendChild(style);
        setTimeout(() => {
            const el = document.getElementById('dt-pre-stitch-css');
            if (el) el.remove();
        }, 10000);
    })();

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
            return /\/games\/originals\/(dice)(?:\/|$|\?|#)/i.test(path);
        }
        // Stake (stake.com / stake.us)
        return /\/casino\/games\/(dice|primedice)(?:\/|$|\?|#)/i.test(path);
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
        const isDiceLimbo = /\/(?:casino\/games|games\/originals)\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(url);
        const isDicePrime = /\/(?:casino\/games|games\/originals)\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(url);
        if (isDiceLimbo && !_iowDiceInit.iowSmart) {
            try { tool_stake_iow_smart(); _iowDiceInit.iowSmart = true; }
            catch (e) { console.error('[UnifiedTools] iow-smart init error:', e); }
        }
        if (isDicePrime && !_iowDiceInit.diceTool) {
            try { tool_dice_tool(); _iowDiceInit.diceTool = true; }
            catch (e) { console.error('[UnifiedTools] dice-tool init error:', e); }
        }
    }

    register({
        id: 'stake-dice',
        name: 'Stake Dice',
        description: 'Manual / IOW / Smart bet-sizing modes plus the Advanced IOW (Calculator / Strategy Finder / Results) tab on Stake Dice.',
        matches: [
            'https://stake.com/casino/games/dice*',
            'https://stake.us/casino/games/dice*',
            'https://stake.bet/casino/games/dice*',
            'https://stake.games/casino/games/dice*',
            'https://staketr.com/casino/games/dice*',
            'https://staketr2.com/casino/games/dice*',
            'https://staketr3.com/casino/games/dice*',
            'https://staketr4.com/casino/games/dice*',
            'https://stake.bz/casino/games/dice*',
            'https://stake.pet/casino/games/dice*', 'https://stake.jp/casino/games/dice*',
            'https://stake.com/casino/games/primedice*',
            'https://stake.us/casino/games/primedice*',
            'https://stake.bet/casino/games/primedice*',
            'https://stake.games/casino/games/primedice*',
            'https://staketr.com/casino/games/primedice*',
            'https://staketr2.com/casino/games/primedice*',
            'https://staketr3.com/casino/games/primedice*',
            'https://staketr4.com/casino/games/primedice*',
            'https://stake.bz/casino/games/primedice*',
            'https://stake.pet/casino/games/primedice*', 'https://stake.jp/casino/games/primedice*'
        ],
        runAt: 'document-start',
        defaultEnabled: true,
        group: 'Stake',
        // hijacksPage: re-parents Stake's native bet panel into the HUD.
        // Toggle reloads the page and the body skips when disabled.
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

    console.log('%c[Stake Dice — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
