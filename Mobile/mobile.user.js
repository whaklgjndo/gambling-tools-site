// ==UserScript==
// @name         Mobile 
// @namespace    https://whaklgjndo.github.io/gambling-tools/
// @version      5.4
// @description  .
// @author       .
// @match        https://stake.com/*
// @match        https://stake.us/*
// @match        https://stake.bet/*
// @match        https://stake.games/*
// @match        https://staketr.com/*
// @match        https://staketr2.com/*
// @match        https://staketr3.com/*
// @match        https://staketr4.com/*
// @match        https://stake.bz/*
// @match        https://stake.pet/*
// @match        https://shuffle.com/*
// @match        https://shuffle.us/*
// @match        https://nuts.gg/*
// @match        https://*.nuts.gg/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    try { console.log('[unified-mobile] boot v5.4 — blend redesign of dice/limbo calc/opt/results tabs (Coach + risk bars), taller stage on those tabs; native-overlay-safe element relocation; fresh import seeds Stats divisor/mult from Calculator'); } catch (e) {}

    /* ============================================================
       iOS USERSCRIPTS COMPATIBILITY
       ============================================================ */
    function addStyle(css) {
        const s = document.createElement('style');
        s.textContent = css;
        (document.head || document.documentElement).appendChild(s);
        return s;
    }

    /* ============================================================
       TOOL TOGGLES + REGISTRY — mirrors the desktop bundle exactly.
       Storage key '__stake_nuts_unified_tools_v1__' is shared with
       the desktop bundle, so toggles persist across installs.
       ============================================================ */
    const SETTINGS_KEY    = '__stake_nuts_unified_tools_v1__';
    const PANEL_POS_KEY   = '__stake_nuts_unified_panel_pos_v1__';
    const PANEL_OPEN_KEY  = '__stake_nuts_unified_panel_open_v1__';

    function loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch { return {}; }
    }
    function saveSettings(s) {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
    }
    let settings = loadSettings();

    function isEnabled(tool) {
        if (Object.prototype.hasOwnProperty.call(settings, tool.id)) return !!settings[tool.id];
        return tool.defaultEnabled !== false;
    }
    function isToolIdEnabled(toolId) {
        const tool = TOOLS.find(t => t.id === toolId);
        if (!tool) return true;
        return isEnabled(tool);
    }
    function setEnabled(toolId, enabled) {
        settings[toolId] = !!enabled;
        saveSettings(settings);
    }

    /* ---- URL matching (Tampermonkey-style wildcard `*`) ---- */
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
    function isToolOnThisSite(tool) {
        if (!tool._domainMatcher) {
            const domainPatterns = tool.matches.map(p => {
                const m = String(p).match(/^(https?:\/\/[^/]+)\//);
                return m ? m[1] + '/*' : p;
            });
            tool._domainMatcher = makePatternMatcher(domainPatterns);
        }
        return tool._domainMatcher('https://' + location.hostname + '/');
    }

    /* ---- Tool registry ---- */
    const TOOLS = [];
    function register(definition) {
        TOOLS.push(definition);
    }

    /** Mark a registered tool as having run (so the panel status flips to
     *  "Running"). Mobile's boot calls tools directly rather than via
     *  the desktop's safeRun() pipeline, so each tool function calls this
     *  at the end of its mount path. */
    function markToolRan(toolId) {
        const tool = TOOLS.find(t => t.id === toolId);
        if (tool) tool._ran = true;
    }

    /* ============================================================
       TOOL REGISTRATIONS — one definition per tool × platform.
       The mobile bundle's tool_keno/tool_mines/etc. are platform-aware
       (they branch on isShuffle/isNuts/isStake internally), but we
       register separately so the control panel groups by site and the
       quick-toggle chips can show the current game name.
       ============================================================ */
    // ---- Stake ----
    register({
        id: 'stake-autovault', name: 'Stake Auto-Vault', group: 'Stake',
        description: 'Auto-deposits profit into the Stake vault.',
        matches: ['https://stake.com/*', 'https://stake.us/*', 'https://stake.bet/*', 'https://stake.games/*',
                  'https://staketr.com/*', 'https://staketr2.com/*', 'https://staketr3.com/*', 'https://staketr4.com/*',
                  'https://stake.bz/*', 'https://stake.pet/*'],
        defaultEnabled: false
    });
    register({
        id: 'stake-dice', name: 'Stake Dice', group: 'Stake',
        description: 'Manual / IOW / Smart bet-progression HUD for dice.',
        matches: ['https://stake.com/casino/games/dice*',
                  'https://stake.us/casino/games/dice*',
                  'https://stake.bet/casino/games/dice*',
                  'https://stake.games/casino/games/dice*',
                  'https://staketr.com/casino/games/dice*',
                  'https://staketr2.com/casino/games/dice*',
                  'https://staketr3.com/casino/games/dice*',
                  'https://staketr4.com/casino/games/dice*',
                  'https://stake.bz/casino/games/dice*',
                  'https://stake.pet/casino/games/dice*'],
        defaultEnabled: true, hijacksPage: true
    });
    register({
        id: 'stake-limbo', name: 'Stake Limbo', group: 'Stake',
        description: 'Manual / IOW / Smart bet-progression HUD for limbo.',
        matches: ['https://stake.com/casino/games/limbo*',
                  'https://stake.us/casino/games/limbo*',
                  'https://stake.bet/casino/games/limbo*',
                  'https://stake.games/casino/games/limbo*',
                  'https://staketr.com/casino/games/limbo*',
                  'https://staketr2.com/casino/games/limbo*',
                  'https://staketr3.com/casino/games/limbo*',
                  'https://staketr4.com/casino/games/limbo*',
                  'https://stake.bz/casino/games/limbo*',
                  'https://stake.pet/casino/games/limbo*'],
        defaultEnabled: true, hijacksPage: true
    });
    register({
        id: 'stake-keno', name: 'Stake Keno', group: 'Stake',
        description: 'Save / load tile-and-risk presets on Stake Keno.',
        matches: ['https://stake.com/casino/games/keno*', 'https://stake.us/casino/games/keno*',
                  'https://stake.bet/casino/games/keno*', 'https://stake.games/casino/games/keno*',
                  'https://staketr.com/casino/games/keno*', 'https://staketr2.com/casino/games/keno*',
                  'https://staketr3.com/casino/games/keno*', 'https://staketr4.com/casino/games/keno*',
                  'https://stake.bz/casino/games/keno*', 'https://stake.pet/casino/games/keno*'],
        defaultEnabled: true
    });
    register({
        id: 'stake-mines', name: 'Stake Mines', group: 'Stake',
        description: 'Auto-play with Live Stats + Projected Range.',
        matches: ['https://stake.com/casino/games/mines*', 'https://stake.us/casino/games/mines*',
                  'https://stake.bet/casino/games/mines*', 'https://stake.games/casino/games/mines*',
                  'https://staketr.com/casino/games/mines*', 'https://staketr2.com/casino/games/mines*',
                  'https://staketr3.com/casino/games/mines*', 'https://staketr4.com/casino/games/mines*',
                  'https://stake.bz/casino/games/mines*', 'https://stake.pet/casino/games/mines*'],
        defaultEnabled: true
    });
    register({
        id: 'stake-7day-tracker', name: 'Stake 7-Day Wager Tracker', group: 'Stake',
        description: 'Rolling 7-day wager total, goal tracker, RTP split & fall-off chart.',
        matches: ['https://stake.com/*', 'https://stake.us/*', 'https://stake.bet/*', 'https://stake.games/*',
                  'https://staketr.com/*', 'https://staketr2.com/*', 'https://staketr3.com/*', 'https://staketr4.com/*',
                  'https://stake.bz/*', 'https://stake.pet/*'],
        defaultEnabled: true
    });
    // ---- Shuffle ----
    register({
        id: 'shuffle-autovault', name: 'Shuffle Auto-Vault', group: 'Shuffle',
        description: 'Auto-deposits profit into the Shuffle vault.',
        matches: ['https://shuffle.com/*', 'https://shuffle.us/*'],
        defaultEnabled: false
    });
    register({
        id: 'shuffle-dice', name: 'Shuffle Dice', group: 'Shuffle',
        description: 'Manual / IOW / Smart bet-progression HUD for dice',
        matches: ['https://shuffle.com/games/originals/dice*', 'https://shuffle.us/games/originals/dice*'],
        defaultEnabled: true, hijacksPage: true
    });
     register({
        id: 'shuffle-limbo', name: 'Shuffle Limbo', group: 'Shuffle',
        description: 'Manual / IOW / Smart bet-progression HUD for limbo.',
        matches: ['https://shuffle.us/games/originals/limbo*', 'https://shuffle.com/games/originals/limbo*',],
        defaultEnabled: true, hijacksPage: true
    });
    register({
        id: 'shuffle-keno', name: 'Shuffle Keno', group: 'Shuffle',
        description: 'Save / load tile-and-risk presets on Shuffle Keno.',
        matches: ['https://shuffle.com/games/originals/keno*', 'https://shuffle.us/games/originals/keno*'],
        defaultEnabled: true
    });
    register({
        id: 'shuffle-mines', name: 'Shuffle Mines', group: 'Shuffle',
        description: 'Auto-play with Live Stats + Projected Range.',
        matches: ['https://shuffle.com/games/originals/mines*', 'https://shuffle.us/games/originals/mines*'],
        defaultEnabled: true
    });
    // ---- Nuts ----
    register({
        id: 'nuts-autovault', name: 'Nuts Auto-Vault', group: 'Nuts',
        description: 'Auto-deposits profit into the Nuts vault (SOL).',
        matches: ['https://nuts.gg/*', 'https://*.nuts.gg/*'],
        defaultEnabled: false
    });
    register({
        id: 'nuts-dice', name: 'Nuts Dice', group: 'Nuts',
        description: 'Manual / IOW / Smart bet-progression HUD for dice.',
        matches: ['https://nuts.gg/dice*', 'https://*.nuts.gg/dice*'],
        defaultEnabled: true, hijacksPage: true
    });
    register({
        id: 'nuts-keno', name: 'Nuts Keno', group: 'Nuts',
        description: 'Save / load tile-and-risk presets on Nuts Keno.',
        matches: ['https://nuts.gg/keno*', 'https://*.nuts.gg/keno*'],
        defaultEnabled: true
    });
    register({
        id: 'nuts-mines', name: 'Nuts Mines', group: 'Nuts',
        description: 'Auto-play with Live Stats + Projected Range.',
        matches: ['https://nuts.gg/mines*', 'https://*.nuts.gg/mines*'],
        defaultEnabled: true
    });

    /** Returns the toolId for the current page's matching tool of the given
     *  type (keno/mines/autovault/iow-smart). Mobile boots tools generically;
     *  this maps to the correct per-platform registration id for the panel /
     *  quick-toggle / isToolIdEnabled checks. */
    function toolIdForCurrentSite(suffix) {
        const platform = isNuts() ? 'nuts' : isShuffle() ? 'shuffle' : 'stake';
        return `${platform}-${suffix}`;
    }

    /* ============================================================
       PRE-STITCH UI HIDER
       ============================================================ */
    (function injectPreStitchHider() {
        const url = location.href;
        const willStitch =
            /^https:\/\/stake\.(?:us|com)\/casino\/games\/dice(?!\w)/.test(url) ||
            /^https:\/\/shuffle\.(?:us|com)\/games\/originals\/dice(?!\w)/.test(url);
        if (!willStitch) return;
        const s = addStyle('#dt-aio-counter, #dt-aio-button, #dt-aio-panel, #dt-backdrop ' +
            '{ display: none !important; visibility: hidden !important; pointer-events: none !important; }');
        s.id = 'dt-pre-stitch-css';
        setTimeout(() => {
            const el = document.getElementById('dt-pre-stitch-css');
            if (el) el.remove();
        }, 10000);
    })();

    /* ============================================================
       IOW/SMART → STATS BRIDGE
       ============================================================ */
    window.__iow_smart_state__ = window.__iow_smart_state__ || {
        sessionStats: null, runBaseline: null, runStats: null
    };
    const __iowRunStreaks = {
        winStreaks: [], lossStreaks: [],
        curWin: 0, maxWin: 0, curLoss: 0, maxLoss: 0,
        peakBalance: 0, peakProfit: 0, lastResult: null
    };
    window.__iow_smart_snapshot_run__ = function (currentBalance, totalBets, totalWagered, totalWins, totalLosses, profitHistoryLen, sessionInitialBalance, multGames, multWins) {
        window.__iow_smart_state__.runBaseline = {
            startingBalance: currentBalance, sessionInitialBalance, totalBets, totalWagered,
            totalWins, totalLosses, profitHistoryLen,
            multGames: multGames || 0, multWins: multWins || 0, timestamp: Date.now()
        };
        Object.assign(__iowRunStreaks, {
            winStreaks: [], lossStreaks: [],
            curWin: 0, maxWin: 0, curLoss: 0, maxLoss: 0,
            peakBalance: currentBalance, peakProfit: 0, lastResult: null
        });
    };
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
    window.__iow_smart_on_publish__ = null;
    window.__iow_smart_publish__ = function (currentBalance, initialBalance, sessionPeak, highestProfit, totalWagered, totalWins, totalLosses, totalBets, curWinStreak, maxWinStreak, curLossStreak, maxLossStreak, topWinStreaks, topLossStreaks, profitHistory, isRapidFiring, multGames, multWins, trackedMultiplier) {
        const sessionProfit = currentBalance - initialBalance;
        window.__iow_smart_state__.sessionStats = {
            startingBalance: initialBalance, balance: currentBalance, profit: sessionProfit,
            sessionPeak, peakProfit: highestProfit, totalWagered, totalWins, totalLosses, totalBets,
            rtp: totalWagered > 0 ? ((totalWagered + sessionProfit) / totalWagered) * 100 : 100,
            curWinStreak, maxWinStreak, curLossStreak, maxLossStreak,
            topWinStreaks: topWinStreaks ? topWinStreaks.slice() : [],
            topLossStreaks: topLossStreaks ? topLossStreaks.slice() : [],
            profitHistory: profitHistory ? profitHistory.slice() : [],
            isRapidFiring, multGames: multGames || 0, multWins: multWins || 0,
            trackedMultiplier: trackedMultiplier || 0
        };
        const b = window.__iow_smart_state__.runBaseline;
        if (b) {
            const s = __iowRunStreaks;
            const runProfit = currentBalance - b.startingBalance;
            const runWagered = totalWagered - b.totalWagered;
            const offset = b.startingBalance - b.sessionInitialBalance;
            const ph = profitHistory && profitHistory.length > b.profitHistoryLen
                ? profitHistory.slice(b.profitHistoryLen).map(p => p - offset) : [];
            window.__iow_smart_state__.runStats = {
                startingBalance: b.startingBalance, balance: currentBalance, profit: runProfit,
                sessionPeak: s.peakBalance, peakProfit: s.peakProfit,
                totalBets: totalBets - b.totalBets, totalWagered: runWagered,
                totalWins: totalWins - b.totalWins, totalLosses: totalLosses - b.totalLosses,
                rtp: runWagered > 0 ? ((runWagered + runProfit) / runWagered) * 100 : 100,
                curWinStreak: s.curWin, maxWinStreak: s.maxWin,
                curLossStreak: s.curLoss, maxLossStreak: s.maxLoss,
                topWinStreaks: s.winStreaks.slice(), topLossStreaks: s.lossStreaks.slice(),
                profitHistory: ph,
                multGames: (multGames || 0) - (b.multGames || 0),
                multWins: (multWins || 0) - (b.multWins || 0),
                trackedMultiplier: trackedMultiplier || 0
            };
        } else {
            window.__iow_smart_state__.runStats = null;
        }
        if (typeof window.__iow_smart_on_publish__ === 'function') {
            try { window.__iow_smart_on_publish__(); } catch (e) {}
        }
    };

    /* ============================================================
       PLATFORM DETECTION
       ============================================================ */
    function isShuffle() { return /shuffle\./.test(location.hostname); }
    function isNuts() { return /(^|\.)nuts\.gg$/i.test(location.hostname); }
    function isOnSupportedGamePage() {
        const path = location.pathname || '';
        if (isShuffle()) return /\/games\/originals\/(dice|limbo)(?:\/|$|\?|#)/i.test(path);
        if (isNuts()) return /\/dice(?:\/|$|\?|#)/i.test(path);
        return /\/casino\/games\/(dice|limbo|primedice)(?:\/|$|\?|#)/i.test(path);
    }
    function isOnDicePage() {
        const path = location.pathname || '';
        if (isShuffle()) return /\/games\/originals\/dice(?:\/|$|\?|#)/i.test(path);
        if (isNuts()) return /\/dice(?:\/|$|\?|#)/i.test(path);
        return /\/casino\/games\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(path);
    }
    function getRollOverUnderSwap() {
        if (isNuts()) {
            // Nuts uses hashed CSS classes that change on every deploy. Walk up
            // from the "Roll Over"/"Roll Under" text label to the enclosing button.
            const label = Array.from(document.querySelectorAll('span'))
                .find(s => /^Roll\s+Over$|^Roll\s+Under$|^ROLL\s+OVER$|^ROLL\s+UNDER$/.test((s.textContent || '').trim()));
            return label ? label.closest('button') : null;
        }
        return document.querySelector('button[class*="RollOverInput_inputContainer"]')
            || document.querySelector('input[data-testid="reverse-roll"]')
            || document.querySelector('[data-testid="reverse-roll"]');
    }

    /* ============================================================
       NUTS SOL/USD HELPERS
       Nuts balances are denominated in SOL but the user can toggle the
       display between SOL (8 decimals) and USD (2 decimals). The wager
       input always shows the active display unit; we work internally in
       SOL and convert on read/write.
       ============================================================ */
    function findBalanceContainer() {
        const titled = document.querySelectorAll('div[title$=" SOL"]');
        for (const el of titled) {
            if (/^[\d.,]+\s+SOL$/.test((el.getAttribute('title') || '').trim())) return el;
        }
        return document.querySelector('.sc-cfbf8337-1.eaQLvl') || null;
    }
    function isUSDDisplayMode() {
        const bal = findBalanceContainer();
        if (!bal) return false;
        if (bal.querySelector('span[title*="$"]')) return true;
        const txt = (bal.textContent || '').trim();
        return txt.startsWith('$') || /\bUSD\b/i.test(txt);
    }
    function getSolToUsdRate() {
        const bal = findBalanceContainer();
        if (!bal) return null;
        const innerSpan = bal.querySelector('span[title*="$"][title*="SOL"]');
        const candidates = [
            innerSpan ? (innerSpan.getAttribute('title') || '') : '',
            bal.getAttribute('title') || '',
            bal.textContent || ''
        ];
        for (const t of candidates) {
            const m = t.match(/\$\s*([\d,]+\.?\d*)\s*\(([\d,]+\.?\d*)\s*SOL\)/);
            if (m) {
                const usd = parseFloat(m[1].replace(/,/g, ''));
                const sol = parseFloat(m[2].replace(/,/g, ''));
                if (sol > 0 && isFinite(usd) && isFinite(sol)) return usd / sol;
            }
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
    function formatBetForInput(solAmount) {
        if (!isUSDDisplayMode()) return solAmount.toFixed(8);
        const usd = solToDisplay(solAmount);
        const twoDp = usd.toFixed(2);
        return (parseFloat(twoDp) === 0 && solAmount > 0) ? usd.toFixed(8) : twoDp;
    }
    function formatCurrency(amount) {
        if (!isFinite(amount)) return isNuts() ? '0.00000000' : '0.00';
        if (isNuts()) {
            if (isUSDDisplayMode()) {
                const rate = getSolToUsdRate();
                if (rate && rate > 0) {
                    const usd = amount * rate;
                    const sign = usd < 0 ? '-$' : '$';
                    return `${sign}${Math.abs(usd).toFixed(2)}`;
                }
            }
            return amount.toFixed(8);
        }
        return amount.toFixed(2);
    }
    function parseCurrencyInput(value, fallback) {
        const raw = parseFloat(String(value || '').replace(/[^0-9.]/g, ''));
        if (!isFinite(raw)) return fallback;
        return isNuts() ? displayToSol(raw) : raw;
    }
    function formatCurrencyInput(amount) {
        if (!isFinite(amount)) return '';
        return isNuts() ? formatBetForInput(amount) : amount.toFixed(2);
    }
    function currencyInputStep() {
        return isNuts() && !isUSDDisplayMode() ? '0.00000001' : '0.01';
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

    /* ============================================================
       SHUFFLE TRANSPORT INTERCEPTORS
       ============================================================ */
    if (isShuffle()) {
        (function injectShuffleAudioMute() {
            try {
                const s = document.createElement('script');
                s.textContent = '(' + (function () {
                    let suppressUntil = 0;
                    document.addEventListener('click', function (e) {
                        if (!e.target) return;
                        const btn = e.target.closest && e.target.closest('button[data-testid="bet-button"]');
                        if (btn) suppressUntil = Date.now() + 60;
                    }, true);
                    function wrapBufferSource(node) {
                        const origStart = node.start;
                        if (!origStart || origStart.__shuffleMutePatched) return;
                        const wrapped = function () {
                            if (Date.now() < suppressUntil) return;
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
                    const origPlay = HTMLMediaElement.prototype.play;
                    if (origPlay && !origPlay.__shuffleMutePatched) {
                        const wrapped = function () {
                            if (Date.now() < suppressUntil) {
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
            } catch (e) {}
        })();

        function _tryParseBet(text) {
            try {
                const data = JSON.parse(text);
                const direct = data && data.data && data.data.dicePlay;
                if (direct) { onShuffleBetResult(direct); return; }
                const ws = data && data.payload && data.payload.data && data.payload.data.dicePlay;
                if (ws) { onShuffleBetResult(ws); return; }
                if (Array.isArray(data)) {
                    data.forEach(function (item) {
                        const b = item && item.payload && item.payload.data && item.payload.data.dicePlay;
                        if (b) onShuffleBetResult(b);
                    });
                }
            } catch (e) {}
        }
        const _origFetch = window.fetch;
        window.fetch = async function (...args) {
            // Capture Shuffle's outgoing Authorization header so AutoVault can
            // replay it on a VaultDeposit mutation. The token rotates server-side,
            // so we cache the latest one + its capture timestamp; AutoVault flags
            // anything older than 10 minutes as potentially stale.
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                if (url.includes('graphql') || url.includes('/main-api/')) {
                    let hdrs = null;
                    if (args[1] && args[1].headers) hdrs = args[1].headers;
                    else if (args[0] && args[0].headers) hdrs = args[0].headers;
                    if (hdrs) {
                        let auth = null;
                        if (typeof hdrs.get === 'function') auth = hdrs.get('authorization') || hdrs.get('Authorization');
                        else if (typeof hdrs === 'object') auth = hdrs.authorization || hdrs.Authorization;
                        if (auth && /^Bearer\s+/i.test(auth)) {
                            window.__shuffleAvLatestAuth = auth;
                            window.__shuffleAvLatestAuthAt = Date.now();
                        }
                    }
                }
            } catch (e) {}
            const response = await _origFetch.apply(this, args);
            try {
                const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
                if (url.includes('graphql') || url.includes('/main-api/')) {
                    response.clone().text().then(_tryParseBet).catch(() => {});
                }
            } catch (e) {}
            return response;
        };
        const _origOpen = XMLHttpRequest.prototype.open;
        const _origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
            this._shuffleURL = (typeof url === 'string') ? url : '';
            return _origOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
            if (this._shuffleURL && (this._shuffleURL.includes('graphql') || this._shuffleURL.includes('/main-api/'))) {
                this.addEventListener('load', function () { _tryParseBet(this.responseText); });
            }
            return _origSend.apply(this, arguments);
        };
        const _origWS = window.WebSocket;
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
        window.WebSocket = ShuffleWS;
    }

    /* ============================================================
       NUTS WEBSOCKET HOOK — captures the nuts.tools GraphQL socket so
       AutoVault can post depositToVault mutations through the same
       authenticated channel the page already uses. The socket auths
       itself via cookies on the upgrade; we only need to send valid
       GraphQL frames once it's open and we've seen an ack.
       ============================================================ */
    if (isNuts()) {
        const WS_URL_MATCH = 'nuts.tools/graphql';
        window.__nutsAvSocket = null;
        window.__nutsAvSocketAuthed = false;
        window.__nutsAvPendingMutations = window.__nutsAvPendingMutations || new Map();

        function _nutsAvOnIncoming(raw) {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'connection_ack' || msg.type === 'next' || msg.type === 'data') {
                    if (!window.__nutsAvSocketAuthed) window.__nutsAvSocketAuthed = true;
                }
                if (msg.type === 'next' && msg.payload && msg.payload.data) {
                    const d = msg.payload.data;
                    if ('balance' in d && d.balance && d.balance.after !== undefined) {
                        window.__nutsAvPlayBalance = Number(d.balance.after);
                    }
                    if ('vaultBalance' in d && d.vaultBalance && d.vaultBalance.after !== undefined) {
                        window.__nutsAvVaultBalance = Number(d.vaultBalance.after);
                    }
                    if (window.__nutsAvPendingMutations.has(msg.id)) {
                        const p = window.__nutsAvPendingMutations.get(msg.id);
                        window.__nutsAvPendingMutations.delete(msg.id);
                        try { p.resolve(msg); } catch (e) {}
                    }
                }
            } catch (e) {}
        }
        function _nutsAvAttach(ws) {
            if (!ws || ws.__nutsAvAttached) return;
            ws.__nutsAvAttached = true;
            window.__nutsAvSocket = ws;
            ws.addEventListener('message', (ev) => _nutsAvOnIncoming(ev.data));
            ws.addEventListener('close', () => {
                if (window.__nutsAvSocket === ws) {
                    window.__nutsAvSocket = null;
                    window.__nutsAvSocketAuthed = false;
                }
            });
        }
        try {
            const _OrigSend = WebSocket.prototype.send;
            WebSocket.prototype.send = function (data) {
                try {
                    if (this && typeof this.url === 'string' && this.url.includes(WS_URL_MATCH)) {
                        _nutsAvAttach(this);
                    }
                } catch (e) {}
                return _OrigSend.apply(this, arguments);
            };
        } catch (e) {}
        try {
            const _OrigWS = window.WebSocket;
            function NutsWS(url, protocols) {
                const ws = protocols !== undefined ? new _OrigWS(url, protocols) : new _OrigWS(url);
                try { if (String(url).includes(WS_URL_MATCH)) _nutsAvAttach(ws); } catch (e) {}
                return ws;
            }
            NutsWS.prototype = _OrigWS.prototype;
            NutsWS.CONNECTING = _OrigWS.CONNECTING;
            NutsWS.OPEN = _OrigWS.OPEN;
            NutsWS.CLOSING = _OrigWS.CLOSING;
            NutsWS.CLOSED = _OrigWS.CLOSED;
            window.WebSocket = NutsWS;
        } catch (e) {}
    }

    /* ============================================================
       STATE
       ============================================================ */
    let ACTIVE_MODE = 'smart';
    let baseBet = isNuts() ? 0.00000001 : 0.01;
    let manualBet = isNuts() ? 0.00000001 : 0.01;
    let winIncreasePercent = 125;
    let lossStreakReset = 3;
    let winsBeforeReset = 5;
    let autoStopBalance = null;
    let minBaseBet = isNuts() ? 0.00000001 : 0.01;
    let maxBaseBet = 99999999999999;
    let lastBetId = null;
    let lossStreak = 0;
    let counter = 0;
    let _shuffleLastBetMs = 0;
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
    const MAX_GRAPH_POINTS = 5000;
    const RAPID_BLOCKED_STOP_MS = 1500;
    const RAPID_STALL_STOP_MS = 4000;
    const RAPID_CLICK_INTERVAL_MS = 180;
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
    let clickInterval = null;
    let lockAggressionState = false;
    let lockedGearLevel = 1;

    /* ============================================================
       MOBILE-FIRST CSS — HUD
       ============================================================ */
    addStyle(`
        #ratchet-master-container,
        #ratchet-master-container * { box-sizing: border-box !important; }
        #ratchet-master-container {
            --hud-bg: rgba(15, 33, 46, 0.97);
            --hud-panel: linear-gradient(180deg, rgba(26, 44, 56, 0.98), rgba(15, 33, 46, 0.96));
            --hud-border: rgba(82, 109, 130, 0.55);
            --hud-border-soft: rgba(255, 255, 255, 0.06);
            --hud-line: rgba(255, 255, 255, 0.07);
            --hud-green: #00ff9d;
            --hud-green-dark: #00cc7a;
            --hud-red: #e11d48;
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: var(--hud-bg) !important;
            border: 1px solid var(--hud-border) !important;
            border-radius: 0 !important;
            padding: 5px !important;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7) !important;
            z-index: auto !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
            pointer-events: auto !important;
            overflow: hidden !important;
            backdrop-filter: blur(10px);
            line-height: 1.15;
            -webkit-user-select: none;
            user-select: none;
        }
        #ratchet-master-container.iow-win-reset-pulse { animation: iow-win-pulse 720ms ease-out 1; }
        @keyframes iow-win-pulse {
            0% { box-shadow: inset 0 0 0 0 rgba(74, 222, 128, 0); }
            50% { box-shadow: inset 0 0 0 2px rgba(74, 222, 128, 0.85), inset 0 0 24px rgba(74, 222, 128, 0.4); }
            100% { box-shadow: inset 0 0 0 0 rgba(74, 222, 128, 0); }
        }
        #ratchet-master-container .hud-frame {
            display: flex; flex-direction: column;
            flex: 1 1 0; min-height: 0; gap: 4px; overflow: hidden;
        }
        #ratchet-master-container .hud-workspace {
            display: flex; flex-direction: column;
            flex: 1 1 0; min-height: 0; gap: 6px;
            overflow-y: auto; overflow-x: hidden;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: thin;
        }
        #ratchet-master-container .hud-workspace::-webkit-scrollbar { width: 4px; }
        #ratchet-master-container .hud-workspace::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15); border-radius: 2px;
        }
        #ratchet-master-container .hud-native-sidebar-slot { display: none !important; }
        #ratchet-master-container .hud-native-past-bets-slot {
            display: flex; flex: 0 0 auto; min-height: 30px;
            overflow: hidden;
        }
        #ratchet-master-container .hud-native-past-bets-slot > .past-bets,
        #ratchet-master-container .hud-native-past-bets-slot > [class*="OriginalGameRecentResult_originalGameResultsWrapper"] {
            width: 100% !important;
            display: flex !important;
            gap: 4px !important;
            padding: 5px !important;
            background: var(--hud-panel) !important;
            border: 1px solid var(--hud-border-soft) !important;
            border-radius: 8px !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            -webkit-overflow-scrolling: touch;
            align-items: center !important;
        }
        #ratchet-master-container .hud-native-past-bets-slot > .past-bets > button,
        #ratchet-master-container .hud-native-past-bets-slot > [class*="OriginalGameRecentResult_originalGameResultsWrapper"] > * {
            flex: 0 0 auto !important;
        }
        #ratchet-master-container .mode-wrap {
            display: flex; flex: 0 0 auto; gap: 4px;
            background: #13232d; padding: 3px; border-radius: 10px;
        }
        #ratchet-master-container .mode-btn {
            flex: 1 1 0; min-width: 0; padding: 5px 4px;
            border: none; border-radius: 999px;
            font-size: 11px; font-weight: 900; cursor: pointer;
            text-transform: uppercase; letter-spacing: 0.3px;
            transition: filter 0.15s, background 0.15s, color 0.15s;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
        }
        #ratchet-master-container .mode-btn.active {
            background: #00ff9d; color: #0f212e;
            box-shadow: 0 0 10px #00ff9d;
        }
        #ratchet-master-container .mode-btn:not(.active) {
            background: #2f4553; color: #94a3b8;
        }
        #ratchet-master-container .mode-btn:active { filter: brightness(1.1); }
        #ratchet-master-container #hud-content {
            display: flex; flex-direction: column;
            flex: 1 1 auto; min-height: 100%;
            overflow: visible;
        }
        #ratchet-master-container .hud-shell {
            display: flex; flex-direction: column;
            flex: 0 0 auto; min-height: 0; gap: 5px;
        }
        #ratchet-master-container .hud-panel {
            background: var(--hud-panel);
            border: 1px solid var(--hud-border-soft);
            border-radius: 10px;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }
        #ratchet-master-container .hud-graph-box {
            flex: 0 0 auto;
            min-height: 130px;
            height: 130px;
            background: linear-gradient(180deg, rgba(11, 14, 23, 0.96), rgba(15, 33, 46, 0.98));
            border: 1px solid #2f4553;
            border-radius: 10px;
            overflow: hidden; position: relative; display: flex;
        }
        #ratchet-master-container .hud-graph-box canvas {
            width: 100%; height: 100%; display: block; flex: 1 1 auto;
        }
        #ratchet-master-container .hud-stats-grid {
            display: grid; grid-template-columns: 1fr 1fr;
            gap: 6px; flex: 0 0 auto;
        }
        #ratchet-master-container .hud-stat-card,
        #ratchet-master-container .stats-col-inner {
            background: var(--hud-panel);
            padding: 7px; border-radius: 10px;
            border: 1px solid var(--hud-border-soft);
            display: flex; flex-direction: column; gap: 4px;
            min-height: 0; min-width: 0; overflow: hidden;
        }
        #ratchet-master-container .hud-row {
            display: flex; justify-content: space-between; align-items: center;
            gap: 4px; padding: 4px 6px;
            background: rgba(255, 255, 255, 0.04);
            border-radius: 6px;
            font-size: 10px;
        }
        #ratchet-master-container .hud-label {
            color: #b1bad3; font-size: 9px; font-weight: 700;
            text-transform: uppercase; letter-spacing: 0.2px;
        }
        #ratchet-master-container .hud-val {
            color: #fff; font-size: 11px; font-weight: 800;
            font-family: "Roboto Mono", monospace;
            text-align: right;
        }
        #ratchet-master-container .hud-meta-row {
            display: flex; flex: 0 0 auto; gap: 6px;
        }
        #ratchet-master-container .hud-meta-chip {
            flex: 1 1 0; min-width: 0;
            display: flex; justify-content: space-between; align-items: center;
            gap: 6px; padding: 6px 8px;
            background: var(--hud-panel);
            border: 1px solid var(--hud-border-soft);
            border-radius: 8px;
            overflow: hidden;
        }
        #ratchet-master-container .status-bar {
            background: var(--hud-panel);
            padding: 6px 8px; border-radius: 8px;
            text-align: center; font-size: 11px; font-weight: 800;
            border: 1px solid var(--hud-border-soft);
            min-height: 32px;
            display: flex; align-items: center; justify-content: center;
            flex: 0 0 auto;
        }
        #ratchet-master-container .hud-target-text {
            color: #b1bad3; font-size: 11px;
            font-weight: 800; font-style: italic;
        }
        /* ============================================================
           DICE / LIMBO — DECLUTTERED STATS CONSOLE
           Collapses the old stack (filled pills inside bordered cards
           inside a grid, plus floating Best/Worst chips) into ONE calm
           panel: a single focal Profit/Loss readout, then hairline-
           separated secondary rows. Scoped to .hud-stats so the advanced
           dice-tools panel (#dt-panel-stats, which reuses .hud-row /
           .stats-col-inner) keeps its own layout untouched.
           ============================================================ */
        #ratchet-master-container .hud-stats {
            display: flex; flex-direction: column;
            padding: 6px 9px; gap: 0;
            flex: 0 0 auto;
        }
        #ratchet-master-container .hud-stats .hud-statusline {
            font-size: 10px; font-weight: 700; color: #cfd9e4;
            line-height: 1.2;
        }
        #ratchet-master-container .hud-stats .hud-statusline:not(:empty) {
            padding-bottom: 4px; margin-bottom: 4px;
            border-bottom: 1px solid var(--hud-line);
        }
        #ratchet-master-container .hud-stats .hud-hero {
            display: flex; align-items: baseline; flex-wrap: wrap;
            column-gap: 8px; row-gap: 0;
            padding-bottom: 4px; margin-bottom: 4px;
            border-bottom: 1px solid var(--hud-line);
        }
        #ratchet-master-container .hud-hero-label {
            flex: 0 0 auto;
            color: #8c9bb0; font-size: 9px; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.6px;
        }
        #ratchet-master-container .hud-hero-val {
            color: #fff;
            font-family: "Roboto Mono", monospace;
            font-size: 16px; font-weight: 700; line-height: 1;
            letter-spacing: -0.4px;
            font-variant-numeric: tabular-nums;
        }
        #ratchet-master-container .hud-hero-start {
            margin-left: auto;
            color: #7e8ea3; font-size: 10px; font-weight: 600;
            font-family: "Roboto Mono", monospace;
        }
        #ratchet-master-container .hud-hero-start b { color: #c6d2df; font-weight: 700; }
        #ratchet-master-container .hud-stats .hud-stats-grid {
            grid-template-columns: 1fr 1fr;
            gap: 0 16px; flex: 0 0 auto;
        }
        #ratchet-master-container .hud-stats .hud-stats-grid + .hud-stats-grid {
            margin-top: 4px; padding-top: 0;
            border-top: 1px solid var(--hud-line);
        }
        #ratchet-master-container .hud-stats .stats-col-inner {
            background: none; border: none; box-shadow: none;
            padding: 0; border-radius: 0; gap: 0;
        }
        #ratchet-master-container .hud-stats .hud-row {
            background: none; border-radius: 0;
            padding: 1px 0; gap: 8px;
            border-bottom: 1px solid var(--hud-line);
            font-size: 11px; line-height: 1.25; min-width: 0;
        }
        #ratchet-master-container .hud-stats .stats-col-inner > .hud-row:last-child { border-bottom: none; }
        #ratchet-master-container .hud-stats .hud-label {
            color: #8c9bb0; font-size: 10px; font-weight: 600;
            text-transform: none; letter-spacing: 0.1px;
            white-space: nowrap;
        }
        #ratchet-master-container .hud-stats .hud-val {
            color: #f4f7fb; font-size: 11px; font-weight: 700;
            font-variant-numeric: tabular-nums;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            min-width: 0; padding-left: 6px;
        }
        #ratchet-master-container .hud-stats .hud-meta-row {
            flex-direction: row; gap: 14px;
            margin-top: 4px; padding-top: 3px;
            border-top: 1px solid var(--hud-line);
        }
        #ratchet-master-container .hud-stats .hud-meta-chip {
            flex: 1 1 0; min-width: 0;
            background: none; border: none; border-radius: 0;
            padding: 1px 0; gap: 8px;
        }
        /* Compact controls deck (inputs only — action buttons live in the
           pinned bar below). Scoped to the direct-child shell so
           #dt-panel-stats is unaffected. */
        #ratchet-master-container #hud-content > .hud-shell .hud-controls-deck { padding: 6px; gap: 4px 8px; flex: 0 0 auto; }
        #ratchet-master-container #hud-content > .hud-shell .hud-control-group { gap: 1px; }
        #ratchet-master-container #hud-content > .hud-shell .hud-control-group label {
            color: #8c9bb0; font-size: 9px; font-weight: 600;
            text-transform: none; letter-spacing: 0.1px;
        }
        /* Simple (non-full) fields go label-beside-input to save a stacked
           line each; full-width groups (Base/Bet, Aggression) stay stacked. */
        #ratchet-master-container #hud-content > .hud-shell .hud-control-group:not(.full) {
            flex-direction: row; align-items: center; gap: 6px;
        }
        #ratchet-master-container #hud-content > .hud-shell .hud-control-group:not(.full) > label { flex: 0 0 auto; }
        #ratchet-master-container #hud-content > .hud-shell .hud-control-group:not(.full) > input[type="number"],
        #ratchet-master-container #hud-content > .hud-shell .hud-control-group:not(.full) > select {
            flex: 1 1 0; min-width: 0; width: auto;
        }
        #ratchet-master-container #hud-content > .hud-shell input[type="number"],
        #ratchet-master-container #hud-content > .hud-shell select {
            background: #0c1620;
            border: 1px solid rgba(255, 255, 255, 0.09);
            border-radius: 8px;
            min-height: 26px; padding: 3px 6px;
        }
        #ratchet-master-container #hud-content > .hud-shell input[type="number"]:focus { border-color: var(--hud-green); }
        #ratchet-master-container #hud-content > .hud-shell .quick-btn {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.09);
            border-radius: 8px; height: 26px; width: 30px;
        }
        #ratchet-master-container #hud-content > .hud-shell .quick-btn:active { background: rgba(255, 255, 255, 0.12); }

        /* --- No-scroll flex chain: the workspace fills the frame and the graph
           is the flex-absorber that soaks up leftover height, so stats +
           controls + graph fit one screen. Gated to the normal HUD (not the
           dt-aio tools panel, which keeps its own layout). --- */
        #ratchet-master-container #hud-content {
            flex: 1 1 0 !important; min-height: 0 !important;
            display: flex; flex-direction: column;
        }
        #ratchet-master-container:not([data-tools-active="1"]) #hud-content > .hud-shell {
            flex: 1 1 0; min-height: 0;
            display: flex; flex-direction: column; gap: 6px;
        }
        #ratchet-master-container #hud-content > .hud-shell > .hud-graph-box {
            flex: 1 1 0; min-height: 32px; height: auto;
            border-color: var(--hud-border-soft);
        }

        /* --- Pinned action bar: START/STOP · RESET · Switch always visible
           and thumb-reachable, never scrolled away. Hidden while the dt-aio
           tools panel owns the screen. --- */
        #ratchet-master-container .hud-action-bar {
            display: flex; gap: 6px; flex: 0 0 auto; align-items: stretch;
        }
        #ratchet-master-container .hud-action-bar:empty { display: none !important; }
        #ratchet-master-container[data-tools-active="1"] .hud-action-bar { display: none !important; }
        #ratchet-master-container .hud-action-bar .hud-reset-btn,
        #ratchet-master-container .hud-action-bar .hud-switch-ou-btn { flex: 1 1 0; margin: 0; }
        #ratchet-master-container .hud-action-bar .hud-rapid-btn { flex: 2 1 0; margin: 0; }
        #ratchet-master-container .hud-header {
            display: flex; padding: 0 2px;
            justify-content: space-between; align-items: center;
            flex: 0 0 auto;
        }
        #ratchet-master-container .hud-controls-deck {
            padding: 6px; border-radius: 10px;
            border: 1px solid var(--hud-border-soft);
            background: var(--hud-panel);
            display: grid; grid-template-columns: 1fr 1fr;
            gap: 5px;
            flex: 0 0 auto;
        }
        #ratchet-master-container .hud-control-group {
            display: flex; flex-direction: column; gap: 3px;
            min-width: 0;
        }
        #ratchet-master-container .hud-control-group.full {
            grid-column: 1 / -1;
        }
        #ratchet-master-container .hud-control-group label {
            color: #94a3b8; font-size: 9px; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.2px;
            white-space: nowrap; overflow: hidden;
            display: flex; justify-content: space-between; gap: 4px;
        }
        #ratchet-master-container .hud-control-group input[type="range"] {
            width: 100%; height: 8px; accent-color: #00ff9d;
            cursor: pointer; touch-action: manipulation;
        }
        #ratchet-master-container input[type="number"] {
            background: #0b0e17; border: 1px solid #2f4553;
            color: white; padding: 7px 6px; border-radius: 6px;
            width: 100%; font-size: 12px; font-weight: 700;
            text-align: center; outline: none;
            -webkit-appearance: none;
            min-height: 32px;
        }
        #ratchet-master-container input[type="number"]:focus {
            border-color: var(--hud-green);
            box-shadow: 0 0 0 2px rgba(0, 255, 157, 0.15);
        }
        #ratchet-master-container .input-group {
            display: flex; gap: 4px; align-items: center;
        }
        #ratchet-master-container .input-group input { flex: 1 1 0; }
        #ratchet-master-container .quick-btn {
            padding: 0; width: 34px; height: 32px;
            font-size: 11px; font-weight: 900;
            background: #1a2c38; border: 1px solid #2f4553;
            color: #fff; border-radius: 6px; cursor: pointer;
            flex: 0 0 auto;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
        }
        #ratchet-master-container .quick-btn:active { background: #2f4553; }
        #ratchet-master-container select {
            background: #0b0e17; border: 1px solid #2f4553;
            color: white; padding: 6px 4px; border-radius: 6px;
            font-size: 11px; font-weight: 700; width: 100%;
            outline: none; min-height: 32px;
            -webkit-appearance: none;
            appearance: none;
        }
        #ratchet-master-container select:disabled { opacity: 0.4; }
        #ratchet-master-container input[type="checkbox"] {
            accent-color: #00ff9d; cursor: pointer; margin: 0;
            width: 18px; height: 18px;
            touch-action: manipulation;
        }
        #ratchet-master-container .btn-group {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px;
            grid-column: 1 / -1;
        }
        #ratchet-master-container .hud-rapid-btn,
        #ratchet-master-container .hud-reset-btn,
        #ratchet-master-container .hud-switch-ou-btn {
            min-height: 38px;
            border-radius: 8px; cursor: pointer;
            font-size: 11px; font-weight: 900;
            padding: 8px 6px;
            letter-spacing: 0.3px; text-transform: uppercase;
            -webkit-tap-highlight-color: transparent;
            touch-action: manipulation;
        }
        #ratchet-master-container .hud-rapid-btn {
            border: none; color: #fff;
            grid-column: span 2;
        }
        #ratchet-master-container .hud-rapid-btn.start {
            background: var(--hud-green); color: #0f212e;
        }
        #ratchet-master-container .hud-rapid-btn.start:active { background: var(--hud-green-dark); }
        #ratchet-master-container .hud-rapid-btn.stop { background: var(--hud-red); }
        #ratchet-master-container .hud-rapid-btn.stop:active { background: #be123c; }
        #ratchet-master-container .hud-reset-btn {
            background: transparent;
            border: 1px solid var(--hud-red);
            color: var(--hud-red);
        }
        #ratchet-master-container .hud-reset-btn:active {
            background: var(--hud-red); color: #fff;
        }
        #ratchet-master-container .hud-switch-ou-btn {
            background: transparent;
            border: 1px solid #06b6d4;
            color: #06b6d4;
            line-height: 1.1;
        }
        #ratchet-master-container .hud-switch-ou-btn:active {
            background: #06b6d4; color: #0f212e;
        }
        #ratchet-master-container .hud-footer-slot {
            display: flex; flex: 0 0 auto; min-height: 0; overflow: hidden;
        }
        #ratchet-master-container .hud-footer-slot:empty { display: none !important; }
        #ratchet-master-container.stake-theme #hud-content {
            flex: 0 0 auto;
            min-height: 0;
        }
        #ratchet-master-container .hud-stake-native-controls-slot { display: none; }
        #ratchet-master-container.stake-theme .hud-footer-slot,
        #ratchet-master-container.stake-theme .hud-native-game-footer-slot { display: none !important; }
        #ratchet-master-container.stake-theme .hud-stake-native-controls-slot {
            display: flex; flex: 0 0 auto; width: 100%;
            min-height: 0; overflow: visible;
            position: relative; z-index: 1;
        }
        #ratchet-master-container.stake-theme .hud-stake-native-controls-slot:empty { display: none !important; }
        #ratchet-master-container.stake-theme .hud-stake-native-controls-slot > * {
            width: 100% !important;
            min-width: 0 !important;
        }
        /* Compact the relocated native control footer (Multiplier / Roll Over /
           Win Chance) so it doesn't eat the rest of the HUD's workspace. Stake
           ships it with 16px padding + tall stacked labels (~94px tall); trim
           the padding and shrink labels + inputs to ~50px total. Selectors are
           class-substring based so they survive Stake's per-deploy svelte hashes. */
        #ratchet-master-container.stake-theme .hud-stake-native-controls-slot [class*="footer"] {
            padding: 4px !important;
            gap: 6px !important;
        }
        #ratchet-master-container.stake-theme .hud-stake-native-controls-slot [class*="label-content"] {
            padding: 0 0 1px !important;
            font-size: 9px !important;
            line-height: 1.1 !important;
        }
        #ratchet-master-container.stake-theme .hud-stake-native-controls-slot input {
            min-height: 0 !important;
            height: 30px !important;
            padding: 4px 6px !important;
            font-size: 12px !important;
        }
        #ratchet-master-container.stake-theme .hud-stake-native-controls-stack {
            display: flex !important;
            flex-direction: column !important;
            gap: 6px !important;
            width: 100% !important;
            min-width: 0 !important;
        }
        #ratchet-master-container.stake-theme .hud-stake-native-controls-stack > * {
            width: 100% !important;
            min-width: 0 !important;
        }
        #ratchet-master-container .gear-text {
            font-style: italic; font-weight: 900; text-transform: uppercase;
        }
        #ratchet-master-container .gear-1-text { color: #94a3b8; }
        #ratchet-master-container .gear-2-text { color: #cbd5e1; }
        #ratchet-master-container .gear-3-text { color: #facc15; }
        #ratchet-master-container .gear-4-text { color: #fb923c; }
        #ratchet-master-container .gear-5-text { color: #f43f5e; text-shadow: 0 0 6px rgba(244, 63, 94, 0.4); }
        .result.svelte-1oweb16, .multiplier-result, .result-multiplier,
        .crash-result, .limbo-result, [class*="crash"],
        [class*="result"][class*="multiplier"], span.result { display: none !important; }
        #ratchet-master-container.shuffle-theme {
            --hud-green: #6c47ff;
            --hud-green-dark: #4f35b3;
            --hud-bg: rgba(10, 8, 24, 0.97);
            --hud-panel: linear-gradient(180deg, rgba(26, 18, 56, 0.98), rgba(10, 8, 24, 0.96));
            --hud-border: rgba(108, 71, 255, 0.5);
            --hud-border-soft: rgba(108, 71, 255, 0.18);
        }
        #ratchet-master-container.shuffle-theme .mode-btn.active {
            background: #6c47ff !important; color: #fff !important;
            box-shadow: 0 0 10px #6c47ff !important;
        }
        #ratchet-master-container.shuffle-theme .mode-btn:not(.active) {
            background: #2a1a52; color: #7c5cbf;
        }
        #ratchet-master-container.shuffle-theme .hud-rapid-btn.start {
            color: #fff;
        }
        /* Nuts.gg theme — cyan/purple/pink neon palette */
        #ratchet-master-container.nuts-theme {
            --hud-green: #19f3ff;
            --hud-green-dark: #8f63ff;
            --hud-bg: rgba(10, 12, 20, 0.97);
            --hud-panel: linear-gradient(160deg, rgba(36, 42, 56, 0.92), rgba(14, 18, 28, 0.95));
            --hud-border: rgba(128, 202, 255, 0.35);
            --hud-border-soft: rgba(143, 99, 255, 0.18);
            --hud-red: #ff4c94;
        }
        #ratchet-master-container.nuts-theme .mode-btn.active {
            background: #19f3ff !important; color: #0a0c14 !important;
            box-shadow: 0 0 10px #19f3ff !important;
        }
        #ratchet-master-container.nuts-theme .mode-btn:not(.active) {
            background: #1f1a3a; color: #8b95b8;
        }
        #ratchet-master-container.nuts-theme .hud-rapid-btn.start {
            color: #0a0c14;
        }
        .sc-1d9445d-12.dVJOJA,
        .sc-1d9445d-5.dWEMRV,
        .sc-1d9445d-13.ktRmlk { display: none !important; }
    `);

    /* ============================================================
       DOM HELPERS
       ============================================================ */
    /** Map the current URL to one of the registered split tool ids
     *  (stake/shuffle/nuts × dice/limbo). Returns null when no dice/limbo
     *  pattern matches — callers treat null as "not a gated game page". */
    function currentGameToolId() {
        const path = location.pathname || '';
        if (isNuts()) {
            if (/\/dice(?:\/|$|\?|#)/i.test(path)) return 'nuts-dice';
            return null;
        }
        if (isShuffle()) {
            if (/\/games\/originals\/dice(?:\/|$|\?|#)/i.test(path)) return 'shuffle-dice';
            if (/\/games\/originals\/limbo(?:\/|$|\?|#)/i.test(path)) return 'shuffle-limbo';
            return null;
        }
        if (/\/casino\/games\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(path)) return 'stake-dice';
        if (/\/casino\/games\/limbo(?:\/|$|\?|#)/i.test(path)) return 'stake-limbo';
        return null;
    }

    /** True when the IOW/Smart HUD's tool for the current dice/limbo page is
     *  enabled. Mobile registers dice and limbo as separate tools, so the
     *  panel/quick-toggle can disable one without the other. buildHUD/tryStitch
     *  call this to tear the HUD down when the user disabled the current game. */
    function isCurrentGameEnabled() {
        const toolId = currentGameToolId();
        if (!toolId) return true; // unknown URL — isOnSupportedGamePage handles it
        try { return isToolIdEnabled(toolId); }
        catch (e) { return true; }
    }

    function getStakeWagerField() {
        if (isShuffle() || isNuts()) return null;
        return document.getElementById('text-field-container')
            || document.querySelector('input[data-testid="input-game-amount"]')
            || document.querySelector('input[data-testid="bet-amount"]');
    }

    function findStakeGameSidebar() {
        if (isShuffle() || isNuts()) return null;
        const direct = document.querySelector('.game-sidebar')
            || document.querySelector('[class*="game-sidebar"]')
            || document.querySelector('[class*="GameSidebar"]')
            || document.querySelector('[data-testid="game-sidebar"]')
            || document.querySelector('[data-testid*="game-sidebar"]');
        if (direct && !direct.closest('#ratchet-master-container')) return direct;
        const wager = getStakeWagerField();
        if (!wager) return direct || null;
        let p = wager.parentElement;
        for (let i = 0; i < 12 && p && p !== document.body; i++, p = p.parentElement) {
            const r = p.getBoundingClientRect();
            const hasPlay = Array.from(p.querySelectorAll('button, [role="button"]')).some(btn => {
                const txt = (btn.textContent || '').trim().toLowerCase();
                const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
                return txt === 'play' || txt === 'bet' || testId.includes('play') || testId.includes('bet-button');
            });
            const hasMultiplier = p.querySelector('input[data-testid="payout"], input[min="1.0102"], input[data-testid="target-multiplier"], input[data-testid="reverse-roll"], [data-testid="reverse-roll"]')
                || /multiplier|roll over|roll under|chance/i.test(p.textContent || '');
            if (r.width >= 220 && r.height >= 120 && r.height <= 700 && hasPlay && hasMultiplier) return p;
        }
        return direct || null;
    }

    function isUsableStakeHudHost(el, minHeight = 180) {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.closest && el.closest('#ratchet-master-container')) return false;
        const sidebar = findStakeGameSidebar();
        const wager = getStakeWagerField();
        if ((sidebar && el.contains(sidebar)) || (wager && el.contains(wager))) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 220 && r.height >= minHeight;
    }

    function findStakeHudHost() {
        const existingHud = document.getElementById('ratchet-master-container');
        if (existingHud && existingHud.parentElement && document.contains(existingHud.parentElement) && isUsableStakeHudHost(existingHud.parentElement, 180)) {
            return existingHud.parentElement;
        }

        const selectors = [
            '[data-testid="game-view"]',
            '[data-testid="game-content"]',
            '.game-content',
            '[class*="game-content"]',
            '[class*="GameContent"]',
            '[class*="game-display"]',
            '[class*="GameDisplay"]'
        ];
        for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
                if (isUsableStakeHudHost(el, 180)) return el;
            }
        }
        const fallback = document.querySelector('.game-content')
            || document.querySelector('[data-testid="game-view"]');
        return isUsableStakeHudHost(fallback, 120) ? fallback : null;
    }

    function getLowestCommonAncestor(a, b) {
        if (!a || !b) return null;
        const ancestors = new Set();
        let node = a;
        while (node) { ancestors.add(node); node = node.parentElement; }
        node = b;
        while (node) { if (ancestors.has(node)) return node; node = node.parentElement; }
        return null;
    }
    function getHudHost() {
        if (isNuts()) {
            const nativeSidebar = document.querySelector('.sc-8d275cfe-1.eGfUZM') || document.querySelector('.sc-8d275cfe-1');
            const nativeStage = document.querySelector('.sc-8d275cfe-3.eertbI') || document.querySelector('.sc-8d275cfe-3');
            const sharedHost = getLowestCommonAncestor(nativeSidebar, nativeStage);
            if (sharedHost && sharedHost !== document.body && sharedHost !== document.documentElement) return sharedHost;
            return nativeStage
                || nativeSidebar
                || document.querySelector('.sc-1d9445d-0.cCJWrI')
                || document.querySelector('.sc-1d9445d-0')
                || null;
        }
        if (isShuffle()) {
            const gameContent = document.querySelector('[class*="GameLayout_gameContent"]');
            if (gameContent) {
                const r = gameContent.getBoundingClientRect();
                if (r.height >= 300 && r.width >= 300) return gameContent;
            }
            const rollingBar = document.querySelector('[class*="rollingWrapper"], [class*="DiceGameRollingBar"], [class*="RollingBar"]');
            if (rollingBar) {
                let p = rollingBar.parentElement;
                for (let i = 0; i < 6 && p; i++) {
                    const r = p.getBoundingClientRect();
                    if (r.height >= 300) return p;
                    p = p.parentElement;
                }
            }
            return document.querySelector('[class*="OriginalGameContentWrapper"]')
                || document.querySelector('[class*="DiceGameContent"]')
                || document.querySelector('[class*="LimboGameContent"]')
                || document.querySelector('[class*="GameContentWrapper"]')
                || document.querySelector('[data-testid="game-view"]')
                || document.querySelector('.game-content')
                || null;
        }
        return findStakeHudHost();
    }

    function findNativeElement(selector) {
        // Skip our own HUD and any native modal/chat overlay so opening chat/settings
        // can't pull their DOM into the HUD (mirrors the desktop fix).
        const inOverlay = el => el.closest('[role="dialog"], [aria-modal="true"], [data-testid*="chat" i], [data-test*="chat" i], [class*="chat" i]');
        const ok = el => !el.closest('#ratchet-master-container') && !inOverlay(el);
        const host = getHudHost();
        const scope = host || document;
        const scoped = Array.from(scope.querySelectorAll(selector)).filter(ok);
        if (scoped.length) return scoped[0];
        const fallback = Array.from(document.querySelectorAll(selector)).filter(ok);
        return fallback[0] || null;
    }

    function findShuffleFooter() {
        // Skip chat/modal overlays so we never grab their DOM (mirrors the desktop fix).
        const inOverlay = el => el.closest('[role="dialog"], [aria-modal="true"], [data-testid*="chat" i], [data-test*="chat" i], [class*="chat" i]');
        const byClass = document.querySelector(
            '[class*="footer"][class*="dice"], [class*="Dice"][class*="footer"], ' +
            '[class*="TBYuRq__footer"], [class*="gameFooter"], [class*="GameFooter"], ' +
            '[class*="betControls"], [class*="BetControls"], [class*="gameControls"], [class*="GameControls"]'
        );
        if (byClass && !inOverlay(byClass)) return byClass;
        for (const el of document.querySelectorAll('label, p, span, div')) {
            if ((el.textContent || '').trim() === 'Multiplier' && !inOverlay(el)) {
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

    function stakeBlockHasPlayAndWager(block, wager) {
        if (!block || !wager || !block.contains(wager)) return false;
        const buttons = Array.from(block.querySelectorAll('button, [role="button"]'));
        return buttons.some(btn => {
            if (btn.closest('#ratchet-master-container .mode-wrap')) return false;
            const txt = (btn.textContent || '').trim().toLowerCase();
            const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            return txt === 'play'
                || txt === 'bet'
                || testId.includes('bet-button')
                || testId.includes('play')
                || aria === 'play'
                || aria === 'bet';
        });
    }

    function stakeBlockHasMultiplierControls(block) {
        if (!block) return false;
        if (block.querySelector(
            'input[data-testid="payout"], input[min="1.0102"], input[data-testid="target-multiplier"], ' +
            'input[placeholder*="Multiplier"], input[data-testid="chance"], input[placeholder*="Chance"], ' +
            'input[data-testid="reverse-roll"], [data-testid="reverse-roll"], button[class*="RollOverInput_inputContainer"]'
        )) return true;
        const txt = (block.textContent || '').toLowerCase();
        return txt.includes('multiplier')
            || txt.includes('roll over')
            || txt.includes('roll under')
            || txt.includes('chance');
    }

    function stakeBlockHasFullNativeControls(block, wager) {
        return stakeBlockHasPlayAndWager(block, wager) && stakeBlockHasMultiplierControls(block);
    }

    function findStakePlayWagerBlock(wager) {
        if (!wager) return null;
        const activeHud = document.getElementById('ratchet-master-container');
        let p = wager.parentElement;
        for (let i = 0; i < 14 && p && p !== document.body; i++, p = p.parentElement) {
            if (p.closest('#ratchet-master-container')) continue;
            if (activeHud && p.contains(activeHud)) continue;
            const r = p.getBoundingClientRect();
            if (r.width >= 220 && r.height >= 64 && r.height <= 520 && stakeBlockHasPlayAndWager(p, wager)) return p;
        }
        return null;
    }

    function findStakeMultiplierBlock() {
        const activeHud = document.getElementById('ratchet-master-container');
        const outside = (el) => el && !el.closest('#ratchet-master-container');

        // Walk up from a native control input to the enclosing `.footer`-classed
        // row — the labeled "Multiplier / Roll Over / Win Chance" (dice) or
        // "Target Multiplier / Win Chance" (limbo) block that lives in the game
        // stage the HUD overlays. If there is no footer (e.g. the dice roll
        // slider sits in a plain wrap), fall back to the nearest short, wide
        // container holding the control so we still relocate something usable.
        const footerOf = (control) => {
            if (!outside(control)) return null;
            let p = control.parentElement;
            for (let i = 0; i < 9 && p && p !== document.body; i++, p = p.parentElement) {
                if (activeHud && p.contains(activeHud)) continue;
                if (Array.from(p.classList).some(c => /^footer/i.test(c))) return p;
            }
            p = control.parentElement;
            let best = control.parentElement;
            for (let i = 0; i < 5 && p && p !== document.body; i++, p = p.parentElement) {
                if (activeHud && p.contains(activeHud)) continue;
                const r = p.getBoundingClientRect();
                if (r.width >= 200 && r.height >= 40 && r.height <= 220) { best = p; break; }
            }
            return best;
        };

        // Game-gated so dice and limbo never grab each other's leftover controls
        // after in-app (SPA) navigation between the two. Dice uses `chance` /
        // `dice-slider`; limbo uses `win-chance`. Older skins use payout/etc.
        if (isOnDicePage()) {
            // Target the labeled fields footer — Multiplier (payout), Roll Over
            // (reverse-roll, a type=button that toggles over/under when clicked),
            // and Win Chance (chance). Deliberately NOT the roll slider: the user
            // wants the fields + switch, not the slider, and the slider stays
            // behind the (opaque) HUD overlay so it isn't visible.
            return footerOf(
                document.querySelector('input[data-testid="payout"]')
                || document.querySelector('input[data-testid="chance"]')
                || document.querySelector('input[data-testid="reverse-roll"], [data-testid="reverse-roll"]')
            );
        }
        return footerOf(
            document.querySelector('input[data-testid="win-chance"]')
            || document.querySelector('input[data-testid="target-multiplier"], input[data-testid="payout"], input[placeholder*="Multiplier"]')
        );
    }

    function makeStakeNativeControlsStack(multiplierBlock, playWagerBlock) {
        if (!multiplierBlock && !playWagerBlock) return null;
        if (multiplierBlock && playWagerBlock) {
            if (multiplierBlock.contains(playWagerBlock)) return multiplierBlock;
            if (playWagerBlock.contains(multiplierBlock)) return playWagerBlock;
        }
        const wrap = document.createElement('div');
        wrap.className = 'hud-stake-native-controls-stack';
        if (multiplierBlock) wrap.appendChild(multiplierBlock);
        if (playWagerBlock) wrap.appendChild(playWagerBlock);
        return wrap;
    }

    function findStakeFooter() {
        const stakeSlot = document.getElementById('hud-stake-native-controls-slot');
        const slot = document.getElementById('hud-footer-slot');
        const wager = getStakeWagerField();
        if (stakeSlot && wager && stakeSlot.contains(wager) && stakeSlot.firstElementChild && stakeBlockHasFullNativeControls(stakeSlot.firstElementChild, wager)) {
            return stakeSlot.firstElementChild;
        }
        if (slot && wager && slot.contains(wager) && slot.firstElementChild && stakeBlockHasFullNativeControls(slot.firstElementChild, wager)) {
            return slot.firstElementChild;
        }

        const selectors = [
            '.footer',
            '.game-footer',
            '[data-testid*="footer"]',
            '[data-testid*="Footer"]',
            '[class*="footer"]',
            '[class*="Footer"]',
            '[class*="gameFooter"]',
            '[class*="GameFooter"]',
            '[class*="betControls"]',
            '[class*="BetControls"]',
            '[class*="gameControls"]',
            '[class*="GameControls"]'
        ];
        if (wager) {
            const activeHud = document.getElementById('ratchet-master-container');
            let p = wager.parentElement;
            for (let i = 0; i < 14 && p && p !== document.body; i++, p = p.parentElement) {
                if (p.closest('#ratchet-master-container')) continue;
                if (activeHud && p.contains(activeHud)) continue;
                const r = p.getBoundingClientRect();
                if (r.width >= 220 && r.height >= 120 && r.height <= 620 && stakeBlockHasFullNativeControls(p, wager)) return p;
            }
            for (const sel of selectors) {
                const el = wager.closest(sel);
                if (el && !el.closest('#ratchet-master-container') && (!activeHud || !el.contains(activeHud)) && stakeBlockHasFullNativeControls(el, wager)) return el;
            }
        }
        for (const sel of selectors) {
            const el = findNativeElement(sel);
            if (el && (!wager || stakeBlockHasFullNativeControls(el, wager))) return el;
        }
        return makeStakeNativeControlsStack(findStakeMultiplierBlock(), findStakePlayWagerBlock(wager));
    }

    function detachStakeNativeControlsForRebuild() {
        if (isShuffle() || isNuts()) return null;
        const slot = document.getElementById('hud-stake-native-controls-slot');
        if (!slot || !slot.firstElementChild) return null;
        const el = slot.firstElementChild;
        slot.replaceChildren();
        return el;
    }

    function mountSingleElement(slot, element) {
        if (!slot || !element) return;
        if (slot.childElementCount === 1 && slot.firstElementChild === element) return;
        slot.replaceChildren(element);
    }

    function syncNativeHudElements() {
        if (isNuts()) {
            const recentBets = findNativeElement('.sc-9b1418e2-1') || findNativeElement('.sc-9b1418e2-0');
            mountSingleElement(document.getElementById('hud-native-past-bets-slot'), recentBets);
            mountSingleElement(
                document.getElementById('hud-footer-slot'),
                findNativeElement('.sc-1d9445d-1.hFwXoL') || findNativeElement('.sc-1d9445d-1')
            );
            return;
        }
        if (isShuffle()) {
            const footer = findShuffleFooter();
            const footerSlot = document.getElementById('hud-footer-slot');
            if (footer && footerSlot && footer.parentElement !== footerSlot) {
                footerSlot.appendChild(footer);
            }
            const feed = document.querySelector('[class*="OriginalGameRecentResult_originalGameResultsWrapper"]');
            const pastBetsSlot = document.getElementById('hud-native-past-bets-slot');
            if (feed && pastBetsSlot && feed.parentElement !== pastBetsSlot) {
                pastBetsSlot.appendChild(feed);
            }
            return;
        }
        mountSingleElement(document.getElementById('hud-native-past-bets-slot'), findNativeElement('.past-bets'));
        // Relocate the native Multiplier / Roll Over / Win Chance controls into
        // the HUD's controls slot. On mobile these sit in the game-stage area
        // that the HUD overlays with an opaque panel, so without moving them the
        // user can't see or edit the multiplier. findStakeMultiplierBlock only
        // returns blocks outside the HUD, so once moved it returns null and
        // mountSingleElement no-ops — this is idempotent across ticks.
        const stakeControlsSlot = document.getElementById('hud-stake-native-controls-slot');
        if (stakeControlsSlot) {
            const block = findStakeMultiplierBlock();
            if (block) mountSingleElement(stakeControlsSlot, block);
        }
        const footerSlot = document.getElementById('hud-footer-slot');
        if (footerSlot && footerSlot.childElementCount) footerSlot.replaceChildren();
        const gameFooterSlot = document.getElementById('hud-native-game-footer-slot');
        if (gameFooterSlot && gameFooterSlot.childElementCount) gameFooterSlot.replaceChildren();
    }

    function syncModeButtons() {
        document.querySelectorAll('#ratchet-master-container .mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.id === 'mode-' + ACTIVE_MODE);
        });
    }

    /* ============================================================
       BALANCE & BET HELPERS
       ============================================================ */
    function getCurrentBalance() {
        if (isNuts()) {
            // Always returns SOL. Outer title "X SOL" is invariant to display mode.
            const bal = findBalanceContainer();
            if (!bal) return lastKnownBalance || 0;
            const innerSpan = bal.querySelector('span[title*="SOL"]');
            const candidates = [
                bal.getAttribute('title') || '',
                innerSpan ? (innerSpan.getAttribute('title') || '') : '',
                bal.textContent || ''
            ];
            const source = candidates.find(t => /SOL/i.test(t)) || candidates[0];
            const match = source.match(/([\d,]+(?:\.\d+)?)\s*SOL/i) || source.match(/([\d,]+(?:\.\d+)?)/);
            if (match) {
                const val = parseFloat(match[1].replace(/,/g, ''));
                if (isFinite(val)) { lastKnownBalance = val; return val; }
            }
            return lastKnownBalance || 0;
        }
        if (isShuffle()) {
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

    function getCurrentBet() {
        if (isNuts()) {
            const wagerInp = document.querySelector('input[aria-label="wager"]');
            if (!wagerInp) return minBaseBet;
            const rawVal = parseFloat(wagerInp.value.replace(/[^0-9.]/g, ''));
            if (!isFinite(rawVal) || rawVal <= 0) return minBaseBet;
            return displayToSol(rawVal);
        }
        if (isShuffle()) {
            const input = document.querySelector('input[data-testid="bet-amount"], input[placeholder*="Amount"], input[placeholder*="Bet"], input[type="text"][inputmode="decimal"]');
            if (input) return parseFloat(input.value.replace(/[^0-9.]/g, '')) || minBaseBet;
            return minBaseBet;
        }
        const amountDiv = document.querySelector('#text-field-container #editing-view-port > div');
        if (amountDiv) return parseFloat(amountDiv.textContent.trim().replace(/[^0-9.]/g, '')) || minBaseBet;
        const oldInput = document.querySelector('input[data-testid="input-game-amount"]');
        return oldInput ? parseFloat(oldInput.value.replace(/,/g, '')) || minBaseBet : minBaseBet;
    }

    function setBet(amount) {
        if (ACTIVE_MODE !== 'iow' && ACTIVE_MODE !== 'manual') return false;
        if (!isFinite(amount) || amount < 0) return false;
        if (isNuts()) {
            const clamped = Math.min(Math.max(amount, minBaseBet), maxBaseBet);
            const inp = document.querySelector('input[aria-label="wager"]');
            if (!inp) return false;
            typeIntoInput(inp, formatBetForInput(clamped));
            return true;
        }
        const targetStr = Math.min(amount, maxBaseBet).toFixed(2);
        if (isShuffle()) {
            const input = document.querySelector('input[data-testid="bet-amount"], input[placeholder*="Amount"], input[placeholder*="Bet"], input[type="text"][inputmode="decimal"]');
            if (!input) return false;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, targetStr);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        const container = document.getElementById('text-field-container');
        if (container) {
            container.focus(); container.click();
            setTimeout(() => {
                const display = document.querySelector('#editing-view-port > div');
                if (display) {
                    display.focus();
                    try {
                        document.execCommand('selectAll', false, null);
                        document.execCommand('insertText', false, targetStr);
                    } catch (e) {}
                }
                ['input','change','blur','keydown','keyup','focus'].forEach(type => {
                    const e = new Event(type, { bubbles: true });
                    container.dispatchEvent(e);
                    if (display) display.dispatchEvent(e);
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
        if (isNuts()) {
            const btn = document.querySelector('.sc-fe9b8b64-1.fmKmkj button.sc-67df7f38-0.kkdRMi');
            if (btn) return btn;
            return Array.from(document.querySelectorAll('button')).find(b => {
                const t = (b.textContent || '').trim();
                return (t.includes('PLAY') || t.includes('ROLL')) && b.offsetParent !== null;
            });
        }
        if (isShuffle()) {
            return document.querySelector('button[data-testid="bet-button"]')
                || Array.from(document.querySelectorAll('button')).find(b =>
                    /^(Bet|Roll|Play)$/i.test((b.textContent || '').trim()) && b.offsetParent !== null);
        }
        let btn = document.querySelector('button[data-testid="bet-button"]');
        if (btn) return btn;
        const spans = document.querySelectorAll('span.ds-body-md-strong[data-ds-text="true"]');
        for (let span of spans) {
            if (span.textContent.trim() === 'Play') {
                const button = span.closest('button');
                if (button) return button;
            }
        }
        return Array.from(document.querySelectorAll('button')).find(b =>
            (b.textContent || '').includes('Play') && b.offsetParent !== null);
    }

    function findPastBetsContainer() {
        if (isNuts()) {
            return document.querySelector('.sc-9b1418e2-1') || document.querySelector('.sc-9b1418e2-0');
        }
        if (isShuffle()) {
            return document.querySelector('.past-bets, [class*="history"], [class*="bet-history"], [class*="pastBets"], section[class*="history"]')
                || document.querySelector('div[class*="bets"]');
        }
        return document.querySelector('div.past-bets');
    }

    function isWin(betDiv) {
        if (!betDiv) return false;
        if (isNuts()) {
            const style = window.getComputedStyle(betDiv);
            return style.backgroundColor.includes('40, 67, 50');
        }
        if (isShuffle()) {
            return betDiv.classList.contains('variant-positive')
                || betDiv.classList.contains('win')
                || betDiv.querySelector('.positive, .win, svg[class*="green"]') !== null
                || /win/i.test(betDiv.textContent || '');
        }
        return betDiv.classList.contains('variant-positive');
    }

    function getUserSetMultiplier() {
        const isDice = isOnDicePage();
        if (ACTIVE_MODE !== 'smart') return 2;
        if (isNuts()) {
            const inpTarget = document.querySelector('input[aria-label="payout selector"]');
            if (inpTarget) return parseFloat(inpTarget.value) || 2;
            const genericMult = Array.from(document.querySelectorAll('input')).find(inp => {
                const label = [
                    inp.getAttribute('aria-label'),
                    inp.getAttribute('placeholder'),
                    inp.getAttribute('name'),
                    inp.getAttribute('data-testid')
                ].join(' ');
                return /(payout|multiplier|target)/i.test(label) && isFinite(parseFloat(inp.value));
            });
            if (genericMult) return parseFloat(genericMult.value) || 2;
            const inpDice = document.querySelector('input.sc-941e0ad-0.eaPPXw');
            if (inpDice) return parseFloat(inpDice.value) || 1.98;
            return 2;
        }
        if (isShuffle()) {
            const containers = document.querySelectorAll('[class*="InfoBetInput_inputContainer"]');
            for (const c of containers) {
                const labelText = (c.querySelector('label, span, p')?.textContent || '').trim();
                if (labelText === 'Multiplier') {
                    const inp = c.querySelector('input');
                    if (inp && inp.value) return parseFloat(inp.value) || 2;
                }
            }
            const mI = document.querySelector('input[data-sharkid="__3"]')
                || document.querySelector('input[data-testid="target-multiplier"], input[placeholder*="Multiplier"]');
            return mI ? parseFloat(mI.value) || 2 : 2;
        }
        if (isDice) {
            let inp = document.querySelector('input[data-testid="payout"]');
            if (inp) return parseFloat(inp.value) || 1.01;
            inp = document.querySelector('input[min="1.0102"], input[data-testid="payout"]');
            if (inp) return parseFloat(inp.value) || 1.01;
            return 1.01;
        }
        const mI = document.querySelector('input[data-testid="target-multiplier"]');
        return mI ? parseFloat(mI.value) || 2 : 2;
    }

    function getLatestBetEntry(container = pastBetsContainer || findPastBetsContainer()) {
        if (!container) return null;
        if (isNuts()) {
            const elements = container.querySelectorAll('.styles-module___IID9a__game');
            if (elements.length === 0) return null;
            const latest = elements[0];
            const id = latest.getAttribute('data-bet-id')
                    || latest.getAttribute('data-game-id')
                    || latest.getAttribute('id')
                    || ('idx-' + elements.length);
            return { element: latest, id };
        }
        const element = container.querySelector('button[data-last-bet-index="0"]');
        if (!element) return null;
        const id = element.getAttribute('data-past-bet-id')
            || element.getAttribute('data-bet-id')
            || element.getAttribute('aria-label')
            || element.textContent.trim();
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

    /* ============================================================
       HUD CONSTRUCTION
       ============================================================ */
    function buildHUD() {
        if (!isOnSupportedGamePage() || !isCurrentGameEnabled()) {
            const existing = document.getElementById('ratchet-master-container');
            if (existing) existing.remove();
            return;
        }
        const gameDisplay = getHudHost();
        if (!gameDisplay) {
            const existing = document.getElementById('ratchet-master-container');
            if (existing) existing.remove();
            return;
        }
        let hud = document.getElementById('ratchet-master-container');
        if (window.getComputedStyle(gameDisplay).position === 'static') gameDisplay.style.position = 'relative';
        // Limbo's game stage is much shorter than dice's, so the HUD (which is
        // height:100% of this host) crams its controls into a tiny strip. Grow the
        // host's min-height so the HUD gets clean vertical room. The native bet
        // panel is a sibling BELOW the stage, so it just flows further down —
        // nothing is covered. (One knob to tune: the clamp() below.)
        // Extend further on the dice tool's content-heavy tabs (Calculator/Optimizer/
        // Results) so they reach downward with less scrolling. Scoped to when our dice
        // panel is actually mounted in the HUD, so IOW/Smart modes are unaffected.
        const dtP = document.querySelector('#ratchet-master-container #dt-aio-panel');
        const dtTab = dtP && dtP.getAttribute('data-active-tab');
        const dtTall = !!dtP && (dtTab === 'calc' || dtTab === 'opt' || dtTab === 'results');
        gameDisplay.style.minHeight = dtTall ? 'clamp(520px, 80dvh, 920px)' : 'clamp(420px, 54dvh, 640px)';
        if (hud && hud.parentElement !== gameDisplay) gameDisplay.appendChild(hud);
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'ratchet-master-container';
            // Layout: past-bets + mode-wrap pinned at top, footer (native bet
            // panel) pinned at bottom, mode-specific content scrolls between.
            // Previously everything lived inside .hud-workspace, so scrolling
            // to reach the bet panel pushed the mode tabs off the top.
            hud.innerHTML = `
                <div class="hud-frame">
                    <div id="hud-native-past-bets-slot" class="hud-native-past-bets-slot"></div>
                    <div class="mode-wrap">
                        <button id="mode-manual" class="mode-btn">Manual</button>
                        <button id="mode-iow" class="mode-btn">IOW</button>
                        <button id="mode-smart" class="mode-btn">Smart</button>
                    </div>
                    <div class="hud-workspace">
                        <div id="hud-content"></div>
                    </div>
                    <div id="hud-action-bar" class="hud-action-bar"></div>
                    <div id="hud-footer-slot" class="hud-footer-slot"></div>
                    <div id="hud-stake-native-controls-slot" class="hud-stake-native-controls-slot"></div>
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
        hud.classList.toggle('stake-theme', !isShuffle() && !isNuts());
        hud.classList.toggle('shuffle-theme', isShuffle());
        hud.classList.toggle('nuts-theme', isNuts());
        syncModeButtons();
        syncNativeHudElements();
        setTimeout(() => {
            syncNativeHudElements();
        }, 350);
        try { const tid = currentGameToolId(); if (tid) markToolRan(tid); } catch (e) {}
    }

    function buildHUDContent() {
        const content = document.getElementById('hud-content');
        const actionBar = document.getElementById('hud-action-bar');
        const hud = document.getElementById('ratchet-master-container');
        if (!content) return;
        if (hud) hud.dataset.mode = ACTIVE_MODE;
        syncModeButtons();
        content.innerHTML = '';
        let html = '';
        const moneyStep = currencyInputStep();
        const baseInputValue = formatCurrencyInput(baseBet);
        const manualInputValue = formatCurrencyInput(manualBet);
        const autostopInputValue = autoStopBalance !== null ? formatCurrencyInput(autoStopBalance) : '';
        const switchBtn = isOnDicePage() ? '<button id="h-switch-ou" class="hud-switch-ou-btn">Switch O/U</button>' : '';
        const actionHtml = `
            <button id="h-reset" class="hud-reset-btn">RESET</button>
            ${switchBtn}
            <button id="h-rapid-toggle" class="hud-rapid-btn start">START</button>
        `;
        const commonStatsHtml = `
            <div class="hud-hero">
                <span class="hud-hero-label">Profit / Loss</span>
                <span id="h-profit" class="hud-hero-val">0.00</span>
                <span class="hud-hero-start">from <b id="h-start-bal">0.00</b></span>
            </div>
            <div class="hud-stats-grid">
                <div class="stats-col-inner">
                    <div class="hud-row"><span class="hud-label">Peak Bal</span><span id="h-peak-bal" class="hud-val" style="color:#00ff9d;">0.00</span></div>
                    <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:#00ff9d;">0.00</span></div>
                    <div class="hud-row"><span class="hud-label">RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                </div>
                <div class="stats-col-inner">
                    <div class="hud-row"><span class="hud-label">Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                    <div class="hud-row"><span class="hud-label">Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>
                    <div class="hud-row"><span class="hud-label">W / L</span><span id="h-wl" class="hud-val">0 / 0</span></div>
                </div>
            </div>
        `;
        const metaRowHtml = `
            <div class="hud-meta-row">
                <div class="hud-meta-chip"><span class="hud-label">Best</span><span id="h-best-w" class="hud-val" style="color:#00ff9d;">-</span></div>
                <div class="hud-meta-chip"><span class="hud-label">Worst</span><span id="h-worst-l" class="hud-val" style="color:#f87171;">-</span></div>
            </div>
        `;
        if (ACTIVE_MODE === 'iow') {
            html = `
                <div class="hud-shell">
                    <div class="hud-stats hud-panel">
                        <div class="hud-statusline" id="h-target">base: 0.01 | W:0 | LS:0</div>
                        ${commonStatsHtml}
                        ${metaRowHtml}
                    </div>
                    <div class="hud-graph-box"><canvas id="h-custom-graph"></canvas></div>
                    <div class="hud-controls-deck hud-panel">
                        <div class="hud-control-group full">
                            <label>Base bet</label>
                            <div class="input-group">
                                <input id="h-base" type="number" step="${moneyStep}" value="${baseInputValue}">
                                <button id="h-double-base" class="quick-btn">2x</button>
                                <button id="h-half-base" class="quick-btn">½</button>
                            </div>
                        </div>
                        <div class="hud-control-group">
                            <label>Win inc %</label>
                            <input id="h-win-inc" type="number" min="0" value="${winIncreasePercent}">
                        </div>
                        <div class="hud-control-group">
                            <label>Loss reset</label>
                            <input id="h-loss-reset" type="number" min="1" value="${lossStreakReset}">
                        </div>
                        <div class="hud-control-group">
                            <label>Win reset</label>
                            <input id="h-wins-reset" type="number" min="1" value="${winsBeforeReset || ''}">
                        </div>
                        <div class="hud-control-group">
                            <label>Autostop bal</label>
                            <input id="h-autostop" type="number" step="${moneyStep}" value="${autostopInputValue}" placeholder="OFF">
                        </div>
                    </div>
                </div>
            `;
        } else if (ACTIVE_MODE === 'smart') {
            html = `
                <div class="hud-shell">
                    <div class="hud-stats hud-panel">
                        <div class="hud-statusline" id="h-target">Initializing...</div>
                        ${commonStatsHtml}
                        <div class="hud-stats-grid">
                            <div class="stats-col-inner">
                                <div class="hud-row"><span class="hud-label">Agg State</span><span id="h-state" class="hud-val gear-text gear-1-text">GEAR 1</span></div>
                                <div class="hud-row"><span class="hud-label">Momentum</span><span id="h-hot" class="hud-val">0/0</span></div>
                            </div>
                            <div class="stats-col-inner">
                                <div class="hud-row"><span class="hud-label">Streak W|L</span><span id="h-streaks" class="hud-val">0/0|0/0</span></div>
                                <div class="hud-row"><span class="hud-label">Mult Perf</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                            </div>
                        </div>
                        ${metaRowHtml}
                    </div>
                    <div class="hud-graph-box"><canvas id="h-custom-graph"></canvas></div>
                    <div class="hud-controls-deck hud-panel">
                        <div class="hud-control-group full">
                            <label>Aggression <span id="h-agg-val" style="color:#fff;">${aggressionLevel.toFixed(1)}x</span></label>
                            <input type="range" id="h-agg" min="0.5" max="3.0" step="0.1" value="${aggressionLevel.toFixed(1)}">
                        </div>
                        <div class="hud-control-group">
                            <label style="display:flex;align-items:center;gap:6px;color:#94a3b8;">
                                <input type="checkbox" id="h-lock-agg-chk" ${lockAggressionState ? 'checked' : ''}> Lock
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
                            <label>Autostop bal</label>
                            <input id="h-autostop" type="number" step="${moneyStep}" value="${autostopInputValue}" placeholder="OFF">
                        </div>
                        <div class="hud-control-group">
                            <label>Stop Loss %</label>
                            <input id="h-sl" type="number" min="0" max="50" value="0" step="0.5">
                        </div>
                        <div class="hud-control-group">
                            <label>Take Profit %</label>
                            <input id="h-tp" type="number" min="0" max="100" value="0" step="0.5">
                        </div>
                    </div>
                </div>
            `;
        } else {
            html = `
                <div class="hud-shell">
                    <div class="hud-stats hud-panel">
                        <div class="hud-statusline" id="h-target">Manual • Tap START</div>
                        ${commonStatsHtml}
                        <div class="hud-stats-grid">
                            <div class="stats-col-inner">
                                <div class="hud-row"><span class="hud-label">Streak W|L</span><span id="h-streaks" class="hud-val">0/0|0/0</span></div>
                                <div class="hud-row"><span class="hud-label">Momentum</span><span id="h-hot" class="hud-val">0/0</span></div>
                            </div>
                            <div class="stats-col-inner">
                                <div class="hud-row"><span class="hud-label">Mult Perf</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                            </div>
                        </div>
                        ${metaRowHtml}
                    </div>
                    <div class="hud-graph-box"><canvas id="h-custom-graph"></canvas></div>
                    <div class="hud-controls-deck hud-panel">
                        <div class="hud-control-group full">
                            <label>Bet</label>
                            <div class="input-group">
                                <input id="h-manual-bet" type="number" step="${moneyStep}" min="${moneyStep}" value="${manualInputValue}">
                                <button id="h-manual-double" class="quick-btn">2x</button>
                                <button id="h-manual-half" class="quick-btn">½</button>
                            </div>
                        </div>
                        <div class="hud-control-group">
                            <label>Autostop bal</label>
                            <input id="h-autostop" type="number" step="${moneyStep}" value="${autostopInputValue}" placeholder="OFF">
                        </div>
                        <div class="hud-control-group">
                            <label>Stop Loss %</label>
                            <input id="h-sl" type="number" min="0" max="50" value="0" step="0.5">
                        </div>
                        <div class="hud-control-group">
                            <label>Take Profit %</label>
                            <input id="h-tp" type="number" min="0" max="100" value="0" step="0.5">
                        </div>
                    </div>
                </div>
            `;
        }
        content.innerHTML = html;
        if (actionBar) actionBar.innerHTML = actionHtml;
        attachListeners();
    }

    function switchMode(newMode) {
        const content = document.getElementById('hud-content');
        const needsRebuild = !!content && content.children.length === 0;
        if (newMode === ACTIVE_MODE && !needsRebuild) return;
        ACTIVE_MODE = newMode;
        syncModeButtons();
        if (isRapidFiring) stopRapidFire();
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
        const autostopInp = document.getElementById('h-autostop');
        if (autostopInp) {
            autostopInp.addEventListener('input', () => { autoStopBalance = parseCurrencyInput(autostopInp.value, 0) || null; });
            autostopInp.addEventListener('blur', () => {
                let v = parseCurrencyInput(autostopInp.value, 0) || 0;
                autostopInp.value = v ? formatCurrencyInput(v) : '';
                autoStopBalance = v || null;
            });
        }
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
                } catch (e) {}
                setTimeout(() => { switchOuBtn.disabled = false; }, 250);
            });
        }
        if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base');
            if (baseInp) {
                baseInp.addEventListener('input', () => { baseBet = parseCurrencyInput(baseInp.value, minBaseBet); });
                baseInp.addEventListener('blur', () => {
                    let v = parseCurrencyInput(baseInp.value, minBaseBet);
                    baseInp.value = formatCurrencyInput(v);
                    baseBet = v;
                });
            }
            const doubleBtn = document.getElementById('h-double-base');
            if (doubleBtn) doubleBtn.addEventListener('click', () => {
                let val = parseCurrencyInput(document.getElementById('h-base').value, minBaseBet);
                val *= 2;
                document.getElementById('h-base').value = formatCurrencyInput(val);
                baseBet = val;
            });
            const halfBtn = document.getElementById('h-half-base');
            if (halfBtn) halfBtn.addEventListener('click', () => {
                let val = parseCurrencyInput(document.getElementById('h-base').value, minBaseBet);
                val *= 0.5;
                val = Math.max(minBaseBet, val);
                document.getElementById('h-base').value = formatCurrencyInput(val);
                baseBet = val;
            });
            const winInc = document.getElementById('h-win-inc');
            if (winInc) winInc.addEventListener('input', () => { winIncreasePercent = parseFloat(winInc.value) || 125; });
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
                const manualInp = document.getElementById('h-manual-bet');
                if (manualInp) {
                    manualInp.addEventListener('input', () => {
                        const v = parseCurrencyInput(manualInp.value, NaN);
                        if (isFinite(v) && v >= minBaseBet) {
                            manualBet = v;
                            if (isRapidFiring) setBet(v);
                        }
                    });
                    manualInp.addEventListener('blur', () => {
                        let v = parseCurrencyInput(manualInp.value, minBaseBet);
                        if (v < minBaseBet) v = minBaseBet;
                        manualInp.value = formatCurrencyInput(v);
                        manualBet = v;
                        if (isRapidFiring) setBet(v);
                    });
                }
                const manualDouble = document.getElementById('h-manual-double');
                if (manualDouble) manualDouble.addEventListener('click', () => {
                    const inp = document.getElementById('h-manual-bet');
                    let v = parseCurrencyInput(inp.value, minBaseBet);
                    v *= 2;
                    inp.value = formatCurrencyInput(v);
                    manualBet = v;
                    if (isRapidFiring) setBet(v);
                });
                const manualHalf = document.getElementById('h-manual-half');
                if (manualHalf) manualHalf.addEventListener('click', () => {
                    const inp = document.getElementById('h-manual-bet');
                    let v = parseCurrencyInput(inp.value, minBaseBet);
                    v = Math.max(minBaseBet, v * 0.5);
                    inp.value = formatCurrencyInput(v);
                    manualBet = v;
                    if (isRapidFiring) setBet(v);
                });
            }
            if (ACTIVE_MODE === 'smart') {
                const aggInp = document.getElementById('h-agg');
                if (aggInp) aggInp.addEventListener('input', e => {
                    aggressionLevel = parseFloat(e.target.value);
                    const valEl = document.getElementById('h-agg-val');
                    if (valEl) valEl.textContent = `${aggressionLevel.toFixed(1)}x`;
                });
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
        curLossStreak = 0; maxLossStreak = 0; curWinStreak = 0; maxWinStreak = 0;
        multGames = 0; multWins = 0; lastResult = null;
        autoPaused = false; stopLossPct = 0; takeProfitPct = 0;
        rapidBlockedSince = 0; rapidFireStartedAt = 0; lastObservedBetTime = 0;
        if (isRapidFiring) stopRapidFire();
        if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base');
            if (baseInp) baseInp.value = formatCurrencyInput(baseBet);
        } else if (ACTIVE_MODE === 'smart') {
            const aggInp = document.getElementById('h-agg');
            if (aggInp) aggInp.value = aggressionLevel.toFixed(1);
            const valEl = document.getElementById('h-agg-val');
            if (valEl) valEl.textContent = `${aggressionLevel.toFixed(1)}x`;
        }
        const sl = document.getElementById('h-sl'); if (sl) sl.value = '0';
        const tp = document.getElementById('h-tp'); if (tp) tp.value = '0';
        syncLastSeenBet();
        updateUI();
    }

    /* ============================================================
       BET TRACKING
       ============================================================ */
    // Tracks Nuts bet-tile DOM nodes we've already counted. WeakSet so we
    // don't pin nodes alive after Nuts GCs old bets out of the feed.
    const _nutsProcessedBetEls = new WeakSet();
    function startObserver() {
        if (isShuffle()) return;
        pastBetsContainer = findPastBetsContainer();
        if (!pastBetsContainer) { setTimeout(startObserver, 500); return; }
        if (observer) observer.disconnect();
        syncLastSeenBet(pastBetsContainer);
        if (isNuts()) {
            // Nuts emits TWO bet tiles per single roll — the same bet shown two
            // ways in the feed (different displayed multipliers, same win/loss
            // result). The old "read latest entry, dedup by id" path counted
            // both, doubling every stat. Fix mirrors the desktop Nuts tool:
            // seed already-present tiles, then count only the FIRST new tile per
            // mutation batch, with a WeakSet guarding the same node bubbling
            // through twice. Real back-to-back rolls land in separate mutation
            // batches, so rapid fire isn't undercounted.
            pastBetsContainer.querySelectorAll('.styles-module___IID9a__game')
                .forEach(el => _nutsProcessedBetEls.add(el));
            observer = new MutationObserver((mutations) => {
                let countedThisBatch = false;
                outer: for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (countedThisBatch) break outer;
                        if (node.nodeType !== 1) continue;
                        const tile = node.matches && node.matches('.styles-module___IID9a__game')
                            ? node
                            : (node.querySelector && node.querySelector('.styles-module___IID9a__game'));
                        if (!tile) continue;
                        if (_nutsProcessedBetEls.has(tile)) continue;
                        if (!(tile.textContent || '').trim()) continue; // skip placeholders
                        _nutsProcessedBetEls.add(tile);
                        countedThisBatch = true;
                        processNewBet(pastBetsContainer, tile);
                    }
                }
            });
            observer.observe(pastBetsContainer, { childList: true, subtree: true });
            return;
        }
        observer = new MutationObserver(() => processNewBet(pastBetsContainer));
        observer.observe(pastBetsContainer, { childList: true, subtree: true });
    }

    function onShuffleBetResult(bet) {
        const now = Date.now();
        if (now - _shuffleLastBetMs < 400) return;
        _shuffleLastBetMs = now;
        const payout = parseFloat(bet.payout) || 0;
        const won = payout > 0;
        const betAmt = parseFloat(bet.amount) || minBaseBet;
        const afterBal = parseFloat(bet.afterBalance);
        if (!isNaN(afterBal) && afterBal > 0 && initialBalance === 0) {
            const beforeBal = afterBal - payout + betAmt;
            initialBalance = beforeBal;
            sessionPeak = beforeBal;
            lastKnownBalance = afterBal;
        }
        if (!isNaN(afterBal) && afterBal > 0) _shuffleObsBalance = afterBal;
        lastObservedBetTime = now;
        rapidBlockedSince = 0;
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
            lastKnownBalance = seedBal;
            if (initialBalance === 0) { initialBalance = seedBal; sessionPeak = seedBal; }
        }
        _shuffleBalObsEl = el;
        const obs = new MutationObserver(function () {
            const newBal = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
            if (isNaN(newBal) || Math.abs(newBal - _shuffleObsBalance) < 0.0001) return;
            const now = Date.now();
            if (now - _shuffleLastBetMs < 400) { _shuffleObsBalance = newBal; return; }
            _shuffleLastBetMs = now;
            const betAmt = getCurrentBet() || minBaseBet;
            const isWinResult = newBal > _shuffleObsBalance;
            if (initialBalance === 0) {
                initialBalance = isWinResult ? _shuffleObsBalance : _shuffleObsBalance + betAmt;
                sessionPeak = initialBalance;
            }
            _shuffleObsBalance = newBal;
            lastObservedBetTime = now;
            rapidBlockedSince = 0;
            totalBets++;
            handleBetResult(isWinResult, betAmt);
            applyShuffleIOWLogic(isWinResult);
            updateUI();
        });
        obs.observe(el, { childList: true, subtree: true, characterData: true });
    }

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
                    if (!/BetResultContainer/i.test(cls)) continue;
                    const now = Date.now();
                    if (now - _shuffleLastBetMs < 80) return;
                    _shuffleLastBetMs = now;
                    const target = node.querySelector('button') || node;
                    const bg = (target.style.backgroundColor || '').trim();
                    const isWinResult = bg.includes('61, 209, 121') || bg.includes('rgb(61,209,121)');
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

    function processNewBet(container, specificTile) {
        // The Nuts observer passes the exact tile it counted; other callers
        // fall back to "latest entry" + id-based dedup (Stake path).
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
        updateUI();
    }

    function handleBetResult(isWinResult, betAmt) {
        try {
            if (typeof window.__iow_smart_handle_bet__ === 'function')
                window.__iow_smart_handle_bet__(isWinResult, getCurrentBalance());
        } catch (e) {}
        if (isWinResult) totalWins++; else totalLosses++;
        totalWagered += betAmt || minBaseBet;
        const currentProfit = getCurrentBalance() - initialBalance;
        if (currentProfit > highestProfit) highestProfit = currentProfit;
        profitHistory.push(currentProfit);
        if (profitHistory.length > MAX_GRAPH_POINTS) profitHistory.shift();
        if (isWinResult) {
            if (lastResult === false && curLossStreak > 0) {
                topLossStreaks.push(curLossStreak);
                topLossStreaks.sort((a, b) => b - a);
                if (topLossStreaks.length > 10) topLossStreaks.pop();
            }
            curWinStreak++;
            curLossStreak = 0;
            multWins++;
        } else {
            if (lastResult === true && curWinStreak > 0) {
                topWinStreaks.push(curWinStreak);
                topWinStreaks.sort((a, b) => b - a);
                if (topWinStreaks.length > 10) topWinStreaks.pop();
            }
            curLossStreak++;
            curWinStreak = 0;
        }
        lastResult = isWinResult;
        betHistory.push(isWinResult);
        recentWins.push(isWinResult);
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
        if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) stopRapidFire();
    }

    /* ============================================================
       RAPID FIRE — mobile click-loop for both Stake and Shuffle
       ============================================================ */
    function startRapidFire() {
        try {
            if (typeof window.__iow_smart_snapshot_run__ === 'function')
                window.__iow_smart_snapshot_run__(getCurrentBalance(), totalBets, totalWagered, totalWins, totalLosses, profitHistory.length, initialBalance, multGames, multWins);
        } catch (e) {}
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
        // Mobile has no spacebar. Poll the play button for both Stake and
        // Shuffle — the button disables itself while a bet is in flight, so
        // the poll naturally rate-limits to the round cadence.
        if (clickInterval) { clearInterval(clickInterval); clickInterval = null; }
        const tick = () => {
            if (!isRapidFiring) return;
            const btn = getPlayButton();
            if (btn && !btn.disabled) {
                try { btn.click(); } catch (e) {}
            }
        };
        clickInterval = setInterval(tick, RAPID_CLICK_INTERVAL_MS);
        tick();
    }

    function stopRapidFire() {
        isRapidFiring = false;
        rapidBlockedSince = 0;
        rapidFireStartedAt = 0;
        lastObservedBetTime = 0;
        if (clickInterval) { clearInterval(clickInterval); clickInterval = null; }
        updateUI();
    }

    function monitorRapidFireHealth() {
        if (!isRapidFiring) return;
        const now = Date.now();
        if (isShuffle()) {
            // Stall-only safety on Shuffle. Button-disabled is normal between
            // bets and can't be used as a freeze indicator on the click-poll.
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

    /* ============================================================
       GRAPH — retina-aware canvas painter
       ============================================================ */
    function drawGraph() {
        const canvas = document.getElementById('h-custom-graph');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.offsetWidth;
        const cssH = canvas.offsetHeight;
        if (cssW <= 0 || cssH <= 0) return;
        canvas.width = Math.max(1, Math.floor(cssW * dpr));
        canvas.height = Math.max(1, Math.floor(cssH * dpr));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);
        if (profitHistory.length < 2) return;
        let maxVal = Math.max(...profitHistory, 0);
        let minVal = Math.min(...profitHistory, 0);
        const range = (maxVal - minVal) || 1;
        const padding = range * 0.15;
        maxVal += padding;
        minVal -= padding;
        const totalRange = maxVal - minVal;
        const zeroY = cssH - ((0 - minVal) / totalRange) * cssH;
        const zeroPct = Math.max(0, Math.min(1, zeroY / cssH));
        const lineGrad = ctx.createLinearGradient(0, 0, 0, cssH);
        lineGrad.addColorStop(0, '#00ff9d');
        lineGrad.addColorStop(zeroPct, '#00ff9d');
        lineGrad.addColorStop(zeroPct, '#f87171');
        lineGrad.addColorStop(1, '#f87171');
        const fillGrad = ctx.createLinearGradient(0, 0, 0, cssH);
        fillGrad.addColorStop(0, 'rgba(0, 255, 157, 0.2)');
        fillGrad.addColorStop(zeroPct, 'rgba(0, 255, 157, 0.2)');
        fillGrad.addColorStop(zeroPct, 'rgba(248, 113, 113, 0.2)');
        fillGrad.addColorStop(1, 'rgba(248, 113, 113, 0.2)');
        const stepX = cssW / (profitHistory.length - 1);
        ctx.beginPath();
        profitHistory.forEach((val, i) => {
            const x = i * stepX;
            const y = cssH - ((val - minVal) / totalRange) * cssH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.stroke();
        ctx.lineTo(cssW, zeroY);
        ctx.lineTo(0, zeroY);
        ctx.closePath();
        ctx.fillStyle = fillGrad;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(cssW, zeroY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

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

    /* ============================================================
       UI UPDATER
       ============================================================ */
    function updateUI() {
        const balance = getCurrentBalance();
        const profit = balance - initialBalance;
        const startBalEl = document.getElementById('h-start-bal');
        if (startBalEl) startBalEl.textContent = formatCurrency(initialBalance);
        const profitEl = document.getElementById('h-profit');
        if (profitEl) {
            profitEl.textContent = formatCurrency(profit);
            profitEl.style.color = profit > 0 ? '#00ff9d' : (profit < 0 ? '#f87171' : '#fff');
        }
        const peakBalEl = document.getElementById('h-peak-bal');
        if (peakBalEl) peakBalEl.textContent = formatCurrency(sessionPeak);
        const highProfitEl = document.getElementById('h-high-profit');
        if (highProfitEl) highProfitEl.textContent = formatCurrency(highestProfit);
        const wageredEl = document.getElementById('h-wagered');
        if (wageredEl) wageredEl.textContent = formatCurrency(totalWagered);
        const rtp = totalWagered > 0 ? ((totalWagered + profit) / totalWagered) * 100 : 100;
        const rtpEl = document.getElementById('h-rtp');
        if (rtpEl) {
            rtpEl.textContent = rtp.toFixed(2) + '%';
            rtpEl.style.color = rtp >= 100 ? '#00ff9d' : '#f87171';
        }
        const totalBetsEl = document.getElementById('h-total-bets');
        if (totalBetsEl) totalBetsEl.textContent = totalBets;
        const wlEl = document.getElementById('h-wl');
        if (wlEl) wlEl.innerHTML = `<span style="color:#00ff9d;">${totalWins}</span> / <span style="color:#f87171;">${totalLosses}</span>`;
        const rapidBtn = document.getElementById('h-rapid-toggle');
        if (rapidBtn) {
            if (isRapidFiring) {
                rapidBtn.textContent = 'STOP';
                rapidBtn.className = 'hud-rapid-btn stop';
            } else {
                rapidBtn.textContent = 'START';
                rapidBtn.className = 'hud-rapid-btn start';
            }
        }
        if (ACTIVE_MODE === 'iow') {
            const targetEl = document.getElementById('h-target');
            if (targetEl) targetEl.innerHTML = `base bet: ${formatCurrency(baseBet)} | Wins: <span style="color:#00ff9d">${counter}</span> | LossStreak: <span style="color:#f87171">${lossStreak}</span>`;
            populateAdvancedStats();
        } else if (ACTIVE_MODE === 'smart') {
            const streaksEl = document.getElementById('h-streaks');
            if (streaksEl) streaksEl.innerHTML = `<span style="color:#00ff9d;">${curWinStreak}/${maxWinStreak}</span> | <span style="color:#f87171;">${curLossStreak}/${maxLossStreak}</span>`;
            const hotEl = document.getElementById('h-hot');
            if (hotEl) hotEl.textContent = `${betHistory.filter(Boolean).length}/${betHistory.length}`;
            const winsCount = betHistory.filter(Boolean).length;
            const progress = winsNeeded > 0 ? winsCount / winsNeeded : 0;
            let gear = 1;
            let label = 'Gear 1 (Cold)';
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
            if (stateEl) {
                stateEl.textContent = label;
                stateEl.className = `hud-val gear-text gear-${gear}-text`;
            }
            populateAdvancedStats();
            const targetEl = document.getElementById('h-target');
            const targetMult = getUserSetMultiplier();
            if (targetEl) {
                let txt = `Target: ${targetMult.toFixed(2)}x`;
                if (autoPaused) {
                    targetEl.style.color = '#f87171';
                    txt = 'PAUSED - THRESHOLD TRIGGERED';
                } else {
                    targetEl.style.color = '#b1bad3';
                }
                targetEl.innerHTML = txt;
            }
        } else if (ACTIVE_MODE === 'manual') {
            const streaksEl = document.getElementById('h-streaks');
            if (streaksEl) streaksEl.innerHTML = `<span style="color:#00ff9d;">${curWinStreak}/${maxWinStreak}</span> | <span style="color:#f87171;">${curLossStreak}/${maxLossStreak}</span>`;
            const hotEl = document.getElementById('h-hot');
            if (hotEl) hotEl.textContent = `${betHistory.filter(Boolean).length}/${betHistory.length}`;
            populateAdvancedStats();
            const targetEl = document.getElementById('h-target');
            if (targetEl) {
                targetEl.textContent = isRapidFiring ? '' : '';
                targetEl.style.color = isRapidFiring ? '#00ff9d' : '#b1bad3';
            }
        }
        drawGraph();
        try {
            if (typeof window.__iow_smart_publish__ === 'function')
                window.__iow_smart_publish__(getCurrentBalance(), initialBalance, sessionPeak, highestProfit, totalWagered, totalWins, totalLosses, totalBets, curWinStreak, maxWinStreak, curLossStreak, maxLossStreak, topWinStreaks, topLossStreaks, profitHistory, isRapidFiring, multGames, multWins, trackedMultiplier);
        } catch (e) {}
    }

    /* ============================================================
       SMART BET SIZING — gear/aggression machine, writes wager input
       ============================================================ */
    function updateBetAmount() {
        if (ACTIVE_MODE !== 'smart') return;
        // Only size the native bet input while the auto-bet loop is actually
        // running. Without this guard the 600ms HUD ticker rewrites the wager
        // during manual play, fighting the value the user typed (reported: bet
        // "adjusts itself ever so slightly" with the dice tool not running).
        if (!isRapidFiring) return;
        // Don't write the wager while Advanced IOW owns the bet field via the
        // dice tool's strategy editor. ACTIVE_MODE stays 'smart' because the
        // Advanced IOW button is injected and doesn't go through switchMode().
        const hudRoot = document.getElementById('ratchet-master-container');
        if (hudRoot && hudRoot.dataset.toolsActive === '1') return;
        const input = isNuts()
            ? document.querySelector('input[aria-label="wager"]')
            : isShuffle()
                ? document.querySelector('input[data-testid="bet-amount"], input[placeholder*="Amount"], input[placeholder*="Bet"], input[type="text"][inputmode="decimal"]')
                : document.querySelector('input[data-testid="input-game-amount"]');
        const balance = getCurrentBalance();
        if (!input || !balance) return;
        if (initialBalance === 0) initialBalance = balance;
        sessionPeak = Math.max(sessionPeak, balance);
        const currentMult = getUserSetMultiplier();
        if (currentMult !== trackedMultiplier) {
            trackedMultiplier = currentMult;
            multGames = 0;
            multWins = 0;
            recentWins = [];
        }
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
        const betStr = isNuts() ? formatBetForInput(targetBet) : targetBet.toFixed(2);
        if (betStr !== lastAmount) {
            lastAmount = betStr;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, betStr);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }

    function startObserverWrapper() {
        if (isShuffle()) {
            startShuffleObserver();
            startShuffleFeedObserver();
            return;
        }
        if (!pastBetsContainer || !pastBetsContainer.isConnected) {
            if (observer) observer.disconnect();
            startObserver();
        }
    }

    /* ============================================================
       IOW/SMART BRIDGE EXPORTS (cross-tool seams)
       ============================================================ */
    try {
        window.__iow_smart_start__ = startRapidFire;
        window.__iow_smart_stop__ = stopRapidFire;
        window.__iow_smart_reset__ = resetStats;
        window.__iow_smart_is_running__ = function () { return isRapidFiring; };
        window.__iow_smart_baseline_now__ = function () {
            try {
                if (typeof window.__iow_smart_snapshot_run__ === 'function')
                    window.__iow_smart_snapshot_run__(getCurrentBalance(), totalBets, totalWagered, totalWins, totalLosses, profitHistory.length, initialBalance, multGames, multWins);
            } catch (e) {}
        };
    } catch (e) {}

    /* ============================================================
       ===========================================================
       DICE TOOL (Advanced IOW source) — mobile, HUD-only
       Ported from desktop tool_dice_tool() with floating chrome
       (button, backdrop, draggable counter) removed. The panel
       gets re-parented into #hud-content by the integration layer.
       ===========================================================
       ============================================================ */

    const DT_STORE_KEY = 'dice_tool_aio_desktop_state_v1';
    const DT_RES_COLS = [
        'StartingBalance', 'Trials', 'BetDiv', 'ProfitMult', 'W%', 'L', 'Buffer%',
        'AvgHigh', 'StdDev', 'MaxHigh', 'AvgCycles', 'AvgRounds',
        'CycleSuccess%', 'Bust%', 'Score'
    ];
    // Friendly headers + the compact default column set (rest behind "All columns").
    const DT_RES_COL_LABELS = {
        StartingBalance: 'Start $', Trials: 'Trials', BetDiv: 'Bet Divisor', ProfitMult: 'Profit Mult',
        'W%': 'Win Inc %', L: 'Loss Reset', 'Buffer%': 'Buffer %', AvgHigh: 'Avg High $', StdDev: 'Std Dev',
        MaxHigh: 'Max High $', AvgCycles: 'Avg Cycles', AvgRounds: 'Avg Rounds',
        'CycleSuccess%': 'Win %', 'Bust%': 'Bust %', Score: 'Score'
    };
    const DT_RES_COLS_PRIMARY = ['BetDiv', 'ProfitMult', 'W%', 'CycleSuccess%', 'Bust%', 'Score'];
    const DT_SAFE_BUST_MAX = 10;
    let dt_safeOnly = false, dt_showAllCols = false;
    // Optimizer presets: fill the range fields, then the existing engine runs.
    const DT_OPT_PRESETS = {
        quick: { opt_betdiv: '256,500', opt_profit: '50,100', opt_w: '60-90;step=15', opt_l: '3-5;step=1', opt_buf: '25,40', opt_trials: '10' },
        balanced: { opt_betdiv: '256-512;step=128', opt_profit: '50-150;step=50', opt_w: '50-100;step=10', opt_l: '3-6;step=1', opt_buf: '20-40;step=10', opt_trials: '20' },
        thorough: { opt_betdiv: '256-512;step=64', opt_profit: '50-150;step=25', opt_w: '50-150;step=10', opt_l: '3-8;step=1', opt_buf: '20-40;step=5', opt_trials: '30' }
    };

    const dt_state = {
        balance: '20', win_inc: '78', loss_reset: '5',
        bet_div: '500', profit_mult: '100', buffer: '25', n_trials: '100',
        opt_balance: '20', opt_trials: '10',
        opt_betdiv: '256,500', opt_profit: '50,100',
        opt_w: '50-100;step=5', opt_l: '3-5;step=1', opt_buf: '25,30,40',
        theme: 'original', large_fonts: false, keep_prev: false,
        worker_count: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4))),
        panel_open: false,
        results: [],
        show_counter: true,
        counter_target: 10,
        counter_volume: 100,
        counter_autostop: true,
        counter_x: null, counter_y: null
    };

    let dt_simWorker = null, dt_simRunning = false;
    let dt_optWorkers = [], dt_optRunning = false, dt_optQueue = [], dt_optResults = [];
    let dt_optDone = 0, dt_optTotal = 0;
    let dt_selectedRowIdx = -1;
    let dt_resultsSortCol = 'Score';
    let dt_resultsSortAsc = false;

    function dt_saveState() {
        try {
            const snap = {};
            const ids = ['balance', 'win_inc', 'loss_reset', 'bet_div', 'profit_mult', 'buffer', 'n_trials',
                         'opt_balance', 'opt_trials', 'opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'];
            for (const k of ids) {
                const el = $dt(k);
                if (el) snap[k] = el.value;
            }
            const theme = $dt('theme_select');
            if (theme) snap.theme = theme.value;
            const lf = $dt('large_fonts'); if (lf) snap.large_fonts = lf.checked;
            const kp = $dt('keep_prev'); if (kp) snap.keep_prev = kp.checked;
            const wc = $dt('worker_count'); if (wc) snap.worker_count = parseInt(wc.value, 10) || 1;
            snap.counter_target = dt_state.counter_target;
            snap.counter_volume = dt_state.counter_volume;
            snap.counter_autostop = dt_state.counter_autostop;
            snap.panel_open = dt_state.panel_open;
            snap.results = dt_optResults.slice();
            Object.assign(dt_state, snap);
            localStorage.setItem(DT_STORE_KEY, JSON.stringify(dt_state));
        } catch (e) {}
    }

    function dt_loadState() {
        try {
            const raw = localStorage.getItem(DT_STORE_KEY);
            if (!raw) return;
            Object.assign(dt_state, JSON.parse(raw));
        } catch (e) {}
    }

    /* ---- DOM helpers, scoped to the dice tool panel ---- */
    const DT_PANEL_ID = 'dt-aio-panel';
    const $dt = (id) => document.getElementById('dt-' + id);
    const $$dt = (sel) => document.querySelectorAll('#' + DT_PANEL_ID + ' ' + sel);

    function dt_toast(msg, duration = 2000) {
        const t = $dt('toast');
        if (!t) return;
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(dt_toast._t);
        dt_toast._t = setTimeout(() => t.classList.remove('show'), duration);
    }

    /* ---- Shared game helpers ---- */
    const dt_sleep = ms => new Promise(res => setTimeout(res, ms));
    const dt_waitFor = async (selector, timeout = 15000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await dt_sleep(200);
        }
        throw new Error(`Timeout waiting for selector: ${selector}`);
    };
    const dt_waitForText = async (tag, text, timeout = 10000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const els = Array.from(document.querySelectorAll(tag));
            const found = els.find(el => el.textContent.trim().toLowerCase().includes(text.toLowerCase()));
            if (found) return found;
            await dt_sleep(200);
        }
        return null;
    };
    const dt_setNativeValue = (element, value) => {
        const valueSetter = Object.getOwnPropertyDescriptor(element, 'value').set;
        const proto = Object.getPrototypeOf(element);
        const protoValueSetter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (protoValueSetter && valueSetter !== protoValueSetter) protoValueSetter.call(element, value);
        else valueSetter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
    };
    const dt_setSelectValue = (sel, val) => {
        sel.value = val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const dt_trigger = el => {
        ['input', 'change', 'blur'].forEach(type => el.dispatchEvent(new Event(type, { bubbles: true })));
    };

    function dt_currentCalcValues() {
        return {
            bet_size: $dt('out_bet').value,
            profit_stop: $dt('out_profit').value,
            balance_target: $dt('out_target').value,
            multiplier: ($dt('out_mult').value || '').replace(/x$/, ''),
            win_increase: $dt('win_inc').value,
            loss_reset: $dt('loss_reset').value
        };
    }

    /* ============================================================
       WEB WORKER — Stake RNG + simulator + optimizer.
       Blob workers + SubtleCrypto are supported in iOS Userscripts.
       ============================================================ */
    const DT_WORKER_SOURCE = `
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

    function dt_makeWorker() {
        const blob = new Blob([DT_WORKER_SOURCE], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }

    /* ============================================================
       DICE TOOL CSS — injected on first init
       ============================================================ */
    const DT_CSS = `
#${DT_PANEL_ID} {
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
#${DT_PANEL_ID}[data-theme="stake"] {
  --dt-bg: #0b1a22; --dt-fg: #ffffff; --dt-label-fg: #17c7b8;
  --dt-field-bg: #030a0f; --dt-select-bg: #1f333e; --dt-select-fg: #ffffff;
  --dt-button-bg: #030a0f; --dt-border: #17c7b8; --dt-progress: #00ff80;
  --dt-row-even: #0f212e; --dt-row-odd: #162a35;
}
#${DT_PANEL_ID}[data-theme="shuffle"] {
  --dt-bg: #0c0c0c; --dt-fg: #ffffff; --dt-label-fg: #c084fc;
  --dt-field-bg: #050505; --dt-select-bg: #a855f7; --dt-select-fg: #ffffff;
  --dt-button-bg: #1a1a1a; --dt-border: #a855f7; --dt-progress: #c084fc;
  --dt-row-even: #171717; --dt-row-odd: #202020;
}
#${DT_PANEL_ID}[data-large-fonts="true"] { --dt-font-scale: 1.2; }

/* Standalone-mode positioning. The integration overrides this with
   #hud-content > #dt-aio-panel rules to mount the panel inside the HUD.
   On mobile we never show the panel standalone (no floating opener),
   so this just keeps the panel out of the way until it's adopted. */
#${DT_PANEL_ID} {
  position: fixed;
  top: 50%;
  right: 16px;
  transform: translate(120%, -50%);
  width: 96vw;
  max-width: 480px;
  height: 90vh;
  max-height: 900px;
  z-index: 2147483646;
  background: var(--dt-bg);
  color: var(--dt-fg);
  border: 2px solid var(--dt-border);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
  opacity: 0;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  font-size: calc(14px * var(--dt-font-scale));
  line-height: 1.5;
}
#${DT_PANEL_ID} * { box-sizing: border-box; }

/* Bare counter elements live in the panel as orphans until the
   integration relocates them into the Stats tab's slots. */
#${DT_PANEL_ID} > #dt-ctr_w,
#${DT_PANEL_ID} > #dt-ctr_l { display: none; }

#${DT_PANEL_ID} .dt-head {
  position: relative;
  padding: 10px 44px 10px 16px;
  text-align: center;
  flex-shrink: 0;
  border-bottom: 1px solid var(--dt-border);
  background: color-mix(in srgb, var(--dt-bg) 92%, black 8%);
  border-radius: 10px 10px 0 0;
}
#${DT_PANEL_ID} .dt-title {
  font-family: 'Times New Roman', Georgia, serif;
  font-style: italic;
  font-weight: bold;
  font-size: 1.2em;
  color: var(--dt-label-fg);
  text-decoration: underline;
  margin: 0;
}

#${DT_PANEL_ID} .dt-body {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px 12px 8px;
}
#${DT_PANEL_ID} .dt-panel { display: none; }
#${DT_PANEL_ID} .dt-panel.active { display: block; }

#${DT_PANEL_ID} .dt-card {
  background: color-mix(in srgb, var(--dt-bg) 78%, white 22%);
  border: 2px solid var(--dt-border);
  border-radius: 10px;
  padding: 14px 12px 12px;
  margin-bottom: 14px;
  position: relative;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}
#${DT_PANEL_ID} .dt-card-title {
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

#${DT_PANEL_ID} .dt-field {
  display: flex;
  align-items: center;
  margin: 6px 0;
  gap: 8px;
}
#${DT_PANEL_ID} .dt-field label,
#${DT_PANEL_ID} .dt-field .dt-label {
  flex: 1;
  color: var(--dt-label-fg);
  font-weight: 600;
  font-size: 0.95em;
  display: flex;
  align-items: center;
  gap: 6px;
}
#${DT_PANEL_ID} .dt-help {
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
#${DT_PANEL_ID} .dt-help:active { background: var(--dt-label-fg); color: var(--dt-bg); }
#${DT_PANEL_ID} .dt-field input[type="text"],
#${DT_PANEL_ID} .dt-field input[type="number"],
#${DT_PANEL_ID} input.dt-text-input {
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
#${DT_PANEL_ID} .dt-field input:focus { outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--dt-label-fg) 35%, transparent); }
#${DT_PANEL_ID} .dt-field input[readonly] { opacity: 0.95; font-weight: 600; color: var(--dt-label-fg); }
#${DT_PANEL_ID} .dt-field-wide { flex-direction: column; align-items: stretch; gap: 4px; }
#${DT_PANEL_ID} .dt-field-wide input { width: 100%; text-align: left; }
#${DT_PANEL_ID} .dt-hint { font-size: 0.78em; color: var(--dt-fg); opacity: 0.55; margin: -2px 0 6px; font-style: italic; }

#${DT_PANEL_ID} .dt-btn {
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
#${DT_PANEL_ID} .dt-btn:active { background: color-mix(in srgb, var(--dt-button-bg) 70%, white 30%); transform: scale(0.985); }
#${DT_PANEL_ID} .dt-btn:disabled { opacity: 0.45; }
#${DT_PANEL_ID} .dt-btn-primary { background: var(--dt-label-fg); color: var(--dt-bg); border-color: var(--dt-label-fg); }
#${DT_PANEL_ID} .dt-btn-danger { background: transparent; color: var(--dt-danger); border-color: var(--dt-danger); }
#${DT_PANEL_ID} .dt-btn-row { display: flex; gap: 8px; margin-top: 8px; }
#${DT_PANEL_ID} .dt-btn-row .dt-btn { flex: 1; }
#${DT_PANEL_ID} .dt-btn-block { display: block; width: 100%; margin-top: 8px; }
#${DT_PANEL_ID} .dt-btn-small { padding: 6px 10px; min-height: 34px; font-size: 0.85em; }

#${DT_PANEL_ID} .dt-progress-wrap {
  margin: 10px 0 4px;
  background: var(--dt-trough);
  border-radius: 6px;
  overflow: hidden;
  height: 10px;
  border: 1px solid var(--dt-border);
}
#${DT_PANEL_ID} .dt-progress-bar {
  height: 100%;
  width: 0%;
  background: var(--dt-progress);
  transition: width 0.2s ease;
}
#${DT_PANEL_ID} .dt-status-line {
  text-align: center;
  font-size: 0.85em;
  opacity: 0.8;
  margin: 4px 0 10px;
  min-height: 1.2em;
}

#${DT_PANEL_ID} .dt-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  background: var(--dt-field-bg);
  max-height: 45vh;
  overflow-y: auto;
}
#${DT_PANEL_ID} table.dt-results {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85em;
}
#${DT_PANEL_ID} table.dt-results th, #${DT_PANEL_ID} table.dt-results td {
  padding: 5px 6px;
  text-align: center;
  white-space: nowrap;
  border-bottom: 1px solid var(--dt-border);
}
#${DT_PANEL_ID} table.dt-results th {
  background: var(--dt-button-bg);
  color: var(--dt-label-fg);
  font-weight: 700;
  position: sticky;
  top: 0;
  cursor: pointer;
}
#${DT_PANEL_ID} table.dt-results tr:nth-child(even) td { background: var(--dt-row-even); }
#${DT_PANEL_ID} table.dt-results tr:nth-child(odd) td { background: var(--dt-row-odd); }
#${DT_PANEL_ID} table.dt-results tr.selected td { background: var(--dt-select-bg) !important; color: var(--dt-select-fg); font-weight: 600; }
#${DT_PANEL_ID} table.dt-stats { width: 100%; font-size: 0.92em; }
#${DT_PANEL_ID} table.dt-stats td { padding: 8px 10px; border-bottom: 1px solid var(--dt-border); }
#${DT_PANEL_ID} table.dt-stats tr:last-child td { border-bottom: none; }
#${DT_PANEL_ID} table.dt-stats td:first-child { color: var(--dt-label-fg); font-weight: 600; width: 55%; }
#${DT_PANEL_ID} table.dt-stats td:last-child { text-align: right; font-variant-numeric: tabular-nums; }

#${DT_PANEL_ID} .dt-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 30%, transparent);
  gap: 10px;
}
#${DT_PANEL_ID} .dt-setting-row:last-child { border-bottom: none; }
#${DT_PANEL_ID} .dt-setting-label { color: var(--dt-label-fg); font-weight: 600; }
#${DT_PANEL_ID} .dt-setting-desc { font-size: 0.8em; opacity: 0.65; margin-top: 2px; font-style: italic; }
#${DT_PANEL_ID} select.dt-theme-select, #${DT_PANEL_ID} input.dt-num-input {
  padding: 8px 10px;
  background: var(--dt-field-bg);
  color: var(--dt-fg);
  border: 1px solid var(--dt-border);
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.95em;
}
#${DT_PANEL_ID} input.dt-num-input { width: 64px; text-align: center; }
#${DT_PANEL_ID} .dt-switch { position: relative; width: 46px; height: 26px; flex-shrink: 0; }
#${DT_PANEL_ID} .dt-switch input { opacity: 0; width: 0; height: 0; }
#${DT_PANEL_ID} .dt-switch .dt-slider {
  position: absolute; inset: 0;
  background: var(--dt-trough);
  border-radius: 26px;
  transition: 0.2s;
  cursor: pointer;
}
#${DT_PANEL_ID} .dt-switch .dt-slider::before {
  content: '';
  position: absolute;
  height: 20px; width: 20px;
  left: 3px; top: 3px;
  background: white;
  border-radius: 50%;
  transition: 0.2s;
}
#${DT_PANEL_ID} .dt-switch input:checked + .dt-slider { background: var(--dt-label-fg); }
#${DT_PANEL_ID} .dt-switch input:checked + .dt-slider::before { transform: translateX(20px); }

/* Tabs — horizontally scrollable for mobile (6 tabs after Stats/Terms inject) */
#${DT_PANEL_ID} .dt-tabs {
  display: flex;
  background: var(--dt-button-bg);
  border-bottom: 1px solid var(--dt-border);
  flex-shrink: 0;
  overflow-x: auto;
  overflow-y: hidden;
  flex-wrap: nowrap;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
}
#${DT_PANEL_ID} .dt-tabs::-webkit-scrollbar { display: none; }
#${DT_PANEL_ID} .dt-tab-btn {
  flex: 0 0 auto;
  padding: 10px 12px;
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
  white-space: nowrap;
  -webkit-user-select: none; user-select: none;
  transition: background 0.12s, color 0.12s;
}
#${DT_PANEL_ID} .dt-tab-btn:active { background: var(--dt-field-bg); }
#${DT_PANEL_ID} .dt-tab-btn .dt-tab-icon { font-size: 1.1em; line-height: 1; }
#${DT_PANEL_ID} .dt-tab-btn.active {
  color: var(--dt-label-fg);
  background: var(--dt-bg);
  border-bottom-color: var(--dt-label-fg);
}

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
  max-width: 90vw;
  text-align: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s, transform 0.2s;
  z-index: 2147483647;
  box-shadow: 0 4px 14px rgba(0,0,0,0.4);
  font-family: -apple-system, 'Segoe UI', sans-serif;
}
#dt-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

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
`;

    const DT_GLOSSARY = {
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
        'Starting Balance': 'The initial balance applied to all combos during optimization.',
        'Trials per Combo': 'The number of simulations run for each parameter combination.',
        'Bet Divisor Range': 'Range or list of divisors to test. Syntax: 256-512;step=1 or 25,30,40',
        'Profit Multiplier Range': 'Range or list of profit multipliers to test. Syntax: 25-150;step=5',
        'Win Increase % Range': 'Range or list of win increases to test. Syntax: 50-150;step=5',
        'Loss Reset (whole)': 'Range or list of loss reset counts. Syntax: 3-8 (integers only)',
        'Buffer % Range': 'Range or list of buffer percentages. Syntax: 20-40;step=2'
    };

    /* ============================================================
       BLEND REDESIGN CSS (mobile) — beginner-first "Coach" layout +
       terminal risk bars for the calc/opt/results tabs. Injected after
       DT_CSS; scoped to #${DT_PANEL_ID}; built on existing theme vars.
       When stitched into the HUD, the bridge CSS (!important) wins on
       container/tab sizing — these rules style our new elements only.
       ============================================================ */
    const DT_BLEND_CSS = `
        #${DT_PANEL_ID} .dt-panel.active { display: flex; flex-direction: column; gap: 11px; }
        #${DT_PANEL_ID} .dt-card { background: color-mix(in srgb, var(--dt-bg) 82%, white 4%); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); border-radius: 12px; padding: 12px; }
        #${DT_PANEL_ID} .dt-card-title { font-weight: 800; letter-spacing: .02em; font-size: 13px; margin: 0; display: flex; align-items: center; gap: 7px; }
        #${DT_PANEL_ID} .dt-card-sub { font-size: 11px; color: color-mix(in srgb, var(--dt-fg) 55%, transparent); line-height: 1.4; margin: 3px 0 10px; }
        #${DT_PANEL_ID} .dt-opt-tag { font-size: 9px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 50%, transparent); border: 1px solid color-mix(in srgb, var(--dt-border) 24%, transparent); border-radius: 20px; padding: 2px 7px; }
        #${DT_PANEL_ID} .dt-steps { display: flex; align-items: center; margin: 0; }
        #${DT_PANEL_ID} .dt-step { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; background: none; border: none; color: var(--dt-fg); cursor: pointer; padding: 0; font-family: inherit; }
        #${DT_PANEL_ID} .dt-step + .dt-step { flex: 1; }
        #${DT_PANEL_ID} .dt-step::before { content: ""; flex: 1; height: 2px; background: color-mix(in srgb, var(--dt-border) 22%, transparent); border-radius: 2px; margin: 0 7px; }
        #${DT_PANEL_ID} .dt-step:first-child::before { display: none; }
        #${DT_PANEL_ID} .dt-step.done::before, #${DT_PANEL_ID} .dt-step.active::before { background: var(--dt-label-fg); }
        #${DT_PANEL_ID} .dt-step-dot { width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 10.5px; font-weight: 800; background: var(--dt-field-bg); border: 1.5px solid color-mix(in srgb, var(--dt-border) 30%, transparent); color: color-mix(in srgb, var(--dt-fg) 55%, transparent); }
        #${DT_PANEL_ID} .dt-step-name { font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 38%, transparent); }
        #${DT_PANEL_ID} .dt-step.done .dt-step-dot { background: color-mix(in srgb, var(--dt-label-fg) 22%, var(--dt-field-bg)); border-color: var(--dt-label-fg); color: var(--dt-label-fg); }
        #${DT_PANEL_ID} .dt-step.done .dt-step-name { color: color-mix(in srgb, var(--dt-fg) 60%, transparent); }
        #${DT_PANEL_ID} .dt-step.active .dt-step-dot { background: var(--dt-label-fg); border-color: var(--dt-label-fg); color: var(--dt-bg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dt-label-fg) 18%, transparent); }
        #${DT_PANEL_ID} .dt-step.active .dt-step-name { color: var(--dt-label-fg); }
        #${DT_PANEL_ID} .dt-coach { font-size: 11.5px; color: color-mix(in srgb, var(--dt-fg) 62%, transparent); line-height: 1.4; margin: -1px 1px 0; }
        #${DT_PANEL_ID} .dt-coach b { color: var(--dt-fg); font-weight: 700; }
        #${DT_PANEL_ID} .dt-heroes { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        #${DT_PANEL_ID} .dt-hero { position: relative; background: linear-gradient(160deg, color-mix(in srgb, var(--dt-label-fg) 14%, var(--dt-field-bg)), var(--dt-field-bg)); border: 1px solid color-mix(in srgb, var(--dt-label-fg) 32%, transparent); border-radius: 11px; padding: 11px 12px; }
        #${DT_PANEL_ID} .dt-hero-k { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--dt-label-fg); font-weight: 700; display: flex; align-items: center; gap: 4px; }
        #${DT_PANEL_ID} .dt-hero-row { display: flex; align-items: baseline; gap: 2px; margin-top: 4px; }
        #${DT_PANEL_ID} .dt-hero-cur { font-family: ui-monospace, Consolas, monospace; font-size: 15px; font-weight: 700; color: color-mix(in srgb, var(--dt-fg) 70%, transparent); }
        #${DT_PANEL_ID} .dt-hero .dt-out-val { font-family: ui-monospace, Consolas, monospace; font-size: 22px; font-weight: 700; color: var(--dt-fg); background: transparent; border: none; padding: 0; width: 100%; letter-spacing: -.02em; }
        #${DT_PANEL_ID} .dt-hero .dt-copy { position: absolute; top: 9px; right: 9px; }
        #${DT_PANEL_ID} .dt-subout { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
        #${DT_PANEL_ID} .dt-so { position: relative; background: var(--dt-field-bg); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); border-radius: 9px; padding: 8px 11px; }
        #${DT_PANEL_ID} .dt-so-k { font-size: 9px; letter-spacing: .06em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 52%, transparent); display: flex; align-items: center; gap: 4px; }
        #${DT_PANEL_ID} .dt-so .dt-out-val { font-family: ui-monospace, Consolas, monospace; font-size: 15px; font-weight: 700; color: var(--dt-fg); background: transparent; border: none; padding: 0; width: 100%; margin-top: 2px; }
        #${DT_PANEL_ID} .dt-so .dt-copy { position: absolute; top: 6px; right: 6px; }
        #${DT_PANEL_ID} .dt-out-val:focus { outline: none; }
        #${DT_PANEL_ID} .dt-copy { padding: 2px 7px; font-size: 10.5px; line-height: 1.4; min-height: 0; border-radius: 6px; background: color-mix(in srgb, var(--dt-bg) 60%, black 40%); border: 1px solid color-mix(in srgb, var(--dt-border) 28%, transparent); color: color-mix(in srgb, var(--dt-fg) 70%, transparent); cursor: pointer; }
        #${DT_PANEL_ID} .dt-copied { background: var(--dt-progress) !important; color: #03171a !important; border-color: var(--dt-progress) !important; }
        #${DT_PANEL_ID} .dt-go { width: 100%; font-weight: 800; }
        #${DT_PANEL_ID} .dt-go-big { padding: 13px; font-size: 14px; }
        #${DT_PANEL_ID} .dt-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 13%, transparent); }
        #${DT_PANEL_ID} .dt-row:last-child { border-bottom: none; }
        #${DT_PANEL_ID} .dt-row-label { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 600; color: color-mix(in srgb, var(--dt-fg) 92%, transparent); display: flex; flex-direction: column; gap: 1px; }
        #${DT_PANEL_ID} .dt-rl-nm { display: flex; align-items: center; gap: 5px; }
        #${DT_PANEL_ID} .dt-row-hint { font-size: 10px; font-weight: 500; color: color-mix(in srgb, var(--dt-fg) 38%, transparent); }
        #${DT_PANEL_ID} .dt-row-ctrl { flex: 0 0 auto; }
        #${DT_PANEL_ID} input.dt-in { width: 88px; text-align: right; background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid color-mix(in srgb, var(--dt-border) 26%, transparent); border-radius: 8px; padding: 8px 9px; font-family: ui-monospace, Consolas, monospace; font-size: 13px; }
        #${DT_PANEL_ID} input.dt-in:focus { outline: none; border-color: var(--dt-label-fg); box-shadow: 0 0 0 3px color-mix(in srgb, var(--dt-label-fg) 22%, transparent); }
        #${DT_PANEL_ID} input.dt-in.dt-invalid { border-color: var(--dt-danger) !important; }
        #${DT_PANEL_ID} .dt-preset-grid { display: flex; flex-direction: column; gap: 8px; margin: 2px 0 4px; }
        #${DT_PANEL_ID} .dt-preset { display: flex; align-items: center; gap: 11px; text-align: left; background: var(--dt-field-bg); border: 1px solid color-mix(in srgb, var(--dt-border) 20%, transparent); border-radius: 11px; padding: 10px 12px; cursor: pointer; position: relative; color: var(--dt-fg); font-family: inherit; }
        #${DT_PANEL_ID} .dt-preset-ic { font-size: 19px; flex: 0 0 auto; width: 24px; text-align: center; }
        #${DT_PANEL_ID} .dt-preset-name { font-size: 13px; font-weight: 800; display: block; }
        #${DT_PANEL_ID} .dt-preset-desc { font-size: 10.5px; color: color-mix(in srgb, var(--dt-fg) 52%, transparent); display: block; margin-top: 1px; }
        #${DT_PANEL_ID} .dt-preset.active { border-color: var(--dt-label-fg); background: color-mix(in srgb, var(--dt-label-fg) 12%, var(--dt-field-bg)); box-shadow: inset 0 0 0 1px var(--dt-label-fg); }
        #${DT_PANEL_ID} .dt-preset-rec { position: absolute; top: -8px; right: 12px; font-size: 8.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; background: var(--dt-label-fg); color: var(--dt-bg); padding: 1px 7px; border-radius: 20px; }
        #${DT_PANEL_ID} .dt-adv-ranges { margin-top: 5px; }
        #${DT_PANEL_ID} .dt-adv-ranges > summary { list-style: none; cursor: pointer; padding: 8px 2px; font-size: 11.5px; font-weight: 600; color: var(--dt-label-fg); display: flex; align-items: center; gap: 6px; }
        #${DT_PANEL_ID} .dt-adv-ranges > summary::-webkit-details-marker { display: none; }
        #${DT_PANEL_ID} .dt-adv-ranges > summary::before { content: '▸'; opacity: .7; }
        #${DT_PANEL_ID} .dt-adv-ranges[open] > summary::before { content: '▾'; }
        #${DT_PANEL_ID} .dt-adv-hint { margin-left: auto; opacity: .5; font-weight: 400; }
        #${DT_PANEL_ID} .dt-est { text-align: center; padding: 8px; border-radius: 8px; background: var(--dt-field-bg); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); font-size: 11px; font-family: ui-monospace, monospace; margin-bottom: 9px; }
        #${DT_PANEL_ID} .dt-est b { color: var(--dt-label-fg); }
        #${DT_PANEL_ID} .dt-est.warn { border-color: #e0a23b; } #${DT_PANEL_ID} .dt-est.bad { color: var(--dt-danger); border-color: var(--dt-danger); }
        #${DT_PANEL_ID} .dt-next { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 10px; padding: 11px; border-radius: 9px; cursor: pointer; font-weight: 800; font-size: 13px; background: var(--dt-label-fg); color: var(--dt-bg); border: none; font-family: inherit; }
        #${DT_PANEL_ID} .dt-next[disabled] { background: var(--dt-field-bg); color: color-mix(in srgb, var(--dt-fg) 55%, transparent); opacity: .6; border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); }
        #${DT_PANEL_ID} .dt-res-toolbar { display: flex; flex-wrap: wrap; gap: 12px; margin: 2px 0 9px; }
        #${DT_PANEL_ID} .dt-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: color-mix(in srgb, var(--dt-fg) 65%, transparent); }
        #${DT_PANEL_ID} .dt-toggle input { accent-color: var(--dt-label-fg); }
        #${DT_PANEL_ID} table.dt-results th { position: sticky; top: 0; background: color-mix(in srgb, var(--dt-bg) 92%, black 8%); font-size: 9px; letter-spacing: .03em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 55%, transparent); cursor: pointer; }
        #${DT_PANEL_ID} table.dt-results th, #${DT_PANEL_ID} table.dt-results td { text-align: right; white-space: nowrap; }
        #${DT_PANEL_ID} table.dt-results th:first-child, #${DT_PANEL_ID} table.dt-results td:first-child { text-align: left; }
        #${DT_PANEL_ID} table.dt-results tr.selected td { background: color-mix(in srgb, var(--dt-label-fg) 16%, transparent); box-shadow: inset 2px 0 0 var(--dt-label-fg); }
        #${DT_PANEL_ID} td.dt-cell-good { color: var(--dt-progress) !important; } #${DT_PANEL_ID} td.dt-cell-mid { color: #e6c850 !important; } #${DT_PANEL_ID} td.dt-cell-bad { color: var(--dt-danger) !important; }
        #${DT_PANEL_ID} .dt-riskbar { display: inline-block; height: 6px; border-radius: 2px; vertical-align: middle; margin-right: 5px; min-width: 3px; }
        #${DT_PANEL_ID} .dt-riskbar.good { background: var(--dt-progress); } #${DT_PANEL_ID} .dt-riskbar.mid { background: #e6c850; } #${DT_PANEL_ID} .dt-riskbar.bad { background: var(--dt-danger); }
        #${DT_PANEL_ID} .dt-res-best { background: linear-gradient(165deg, color-mix(in srgb, var(--dt-label-fg) 16%, var(--dt-bg)), var(--dt-bg)); border: 1px solid var(--dt-label-fg); border-radius: 13px; padding: 13px; }
        #${DT_PANEL_ID} .dt-rb-tag { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--dt-label-fg); display: flex; align-items: center; gap: 6px; }
        #${DT_PANEL_ID} .dt-rb-verdict { font-size: 12px; line-height: 1.45; color: color-mix(in srgb, var(--dt-fg) 92%, transparent); margin: 8px 0 11px; }
        #${DT_PANEL_ID} .dt-rb-verdict b { color: var(--dt-fg); }
        #${DT_PANEL_ID} .dt-rb-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 7px; margin-bottom: 11px; }
        #${DT_PANEL_ID} .dt-rb-stat { background: color-mix(in srgb, var(--dt-bg) 70%, black 30%); border: 1px solid color-mix(in srgb, var(--dt-border) 18%, transparent); border-radius: 8px; padding: 8px 3px; text-align: center; }
        #${DT_PANEL_ID} .dt-rb-stat b { display: block; font-family: ui-monospace, monospace; font-size: 15px; font-weight: 700; color: var(--dt-fg); }
        #${DT_PANEL_ID} .dt-rb-stat i { display: block; font-size: 8px; letter-spacing: .04em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 52%, transparent); font-style: normal; margin-top: 2px; }
        #${DT_PANEL_ID} .dt-rb-stat.good b { color: var(--dt-progress); } #${DT_PANEL_ID} .dt-rb-stat.bad b { color: var(--dt-danger); }
        #${DT_PANEL_ID} .dt-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid color-mix(in srgb, var(--dt-border) 13%, transparent); }
        #${DT_PANEL_ID} .dt-setting-row:last-child { border-bottom: none; }
        #${DT_PANEL_ID} .dt-setting-label { font-size: 12px; font-weight: 600; color: color-mix(in srgb, var(--dt-fg) 92%, transparent); }
        #${DT_PANEL_ID} .dt-setting-desc { font-size: 10px; color: color-mix(in srgb, var(--dt-fg) 42%, transparent); margin-top: 1px; line-height: 1.35; }
        #${DT_PANEL_ID} select.dt-theme-select, #${DT_PANEL_ID} input.dt-num-input { background: var(--dt-field-bg); color: var(--dt-fg); border: 1px solid color-mix(in srgb, var(--dt-border) 26%, transparent); border-radius: 8px; padding: 7px 9px; font-size: 12px; }
        #${DT_PANEL_ID} input.dt-num-input { width: 64px; text-align: right; font-family: ui-monospace, Consolas, monospace; }
    `;

    /* ============================================================
       DOM BUILDER — slim mobile injectUI (no FAB, no backdrop,
       no draggable counter widget; bare counter divs included so
       the integration can re-parent them into the Stats tab).
       ============================================================ */
    function dt_injectUI() {
        // Styles
        if (!document.getElementById('dt-aio-styles')) {
            const style = document.createElement('style');
            style.id = 'dt-aio-styles';
            style.textContent = DT_CSS + DT_BLEND_CSS;
            document.head.appendChild(style);
        }

        // Toast
        if (!document.getElementById('dt-toast')) {
            const toastEl = document.createElement('div');
            toastEl.id = 'dt-toast';
            document.body.appendChild(toastEl);
        }

        // Tooltip
        if (!document.getElementById('dt-tooltip')) {
            const tt = document.createElement('div');
            tt.id = 'dt-tooltip';
            document.body.appendChild(tt);
        }

        // Panel — header kept for parity but visually hidden inside the HUD by bridge CSS.
        if (!document.getElementById(DT_PANEL_ID)) {
            const panel = document.createElement('div');
            panel.id = DT_PANEL_ID;
            panel.setAttribute('data-active-tab', 'calc'); // initial tab; drives extend-downward sizing
            panel.innerHTML = `
                <div class="dt-head">
                  <h2 class="dt-title">Dice Tool</h2>
                </div>
                <nav class="dt-tabs" role="tablist">
                  <button class="dt-tab-btn active" data-tab="calc"><span class="dt-tab-icon">🎲</span>Calculator</button>
                  <button class="dt-tab-btn" data-tab="opt"><span class="dt-tab-icon">⚙️</span>Optimizer</button>
                  <button class="dt-tab-btn" data-tab="results"><span class="dt-tab-icon">📊</span>Results</button>
                  <button class="dt-tab-btn" data-tab="settings"><span class="dt-tab-icon">🛠</span>Settings</button>
                </nav>
                <div class="dt-body">
                  ${dt_buildCalcPanel()}
                  ${dt_buildOptPanel()}
                  ${dt_buildResultsPanel()}
                  ${dt_buildSettingsPanel()}
                </div>
                <div id="dt-ctr_w">0</div>
                <div id="dt-ctr_l">0</div>
            `;
            document.body.appendChild(panel);
        }
    }

    function dt_helpBtn(label) {
        const gl = DT_GLOSSARY[label];
        return gl ? `<button type="button" class="dt-help" data-tooltip="${label}" aria-label="Help about ${label}">?</button>` : '';
    }
    function dt_fieldHTML(label, id, value, type = 'text', inputmode = 'decimal') {
        return `
          <div class="dt-field">
            <span class="dt-label">${label}${dt_helpBtn(label)}</span>
            <input type="${type}" inputmode="${inputmode}" id="dt-${id}" value="${value}">
          </div>`;
    }
    function dt_fieldWideHTML(label, id, value, hint = '', term) {
        const hintHTML = hint ? `<div class="dt-hint">${hint}</div>` : '';
        return `
          <div class="dt-field dt-field-wide">
            <span class="dt-label">${label}${dt_helpBtn(term || label)}</span>
            <input type="text" id="dt-${id}" class="dt-text-input" value="${value}">
            ${hintHTML}
          </div>`;
    }
    /* === Blend helpers (mobile) — mirror the desktop builders === */
    function dt_rowInputHTML(label, term, id, value, inputmode, hint) {
        const hintHTML = hint ? `<span class="dt-row-hint">${hint}</span>` : '';
        return `
          <div class="dt-row">
            <span class="dt-row-label"><span class="dt-rl-nm">${label}${dt_helpBtn(term || label)}</span>${hintHTML}</span>
            <span class="dt-row-ctrl"><input type="text" inputmode="${inputmode || 'decimal'}" class="dt-in" id="dt-${id}" value="${value}"></span>
          </div>`;
    }
    function dt_heroOutHTML(label, term, outId, cur) {
        return `
          <div class="dt-hero">
            <button class="dt-copy" data-copy="${outId}" title="Copy ${label}">⧉</button>
            <span class="dt-hero-k">${label}${dt_helpBtn(term || label)}</span>
            <div class="dt-hero-row">${cur ? `<span class="dt-hero-cur">${cur}</span>` : ''}<input type="text" class="dt-out-val" id="dt-${outId}" readonly></div>
          </div>`;
    }
    function dt_subOutHTML(label, term, outId) {
        return `
          <div class="dt-so">
            <button class="dt-copy" data-copy="${outId}" title="Copy ${label}">⧉</button>
            <span class="dt-so-k">${label}${dt_helpBtn(term || label)}</span>
            <input type="text" class="dt-out-val" id="dt-${outId}" readonly>
          </div>`;
    }
    /* Guided rail: Find (Optimizer) -> Pick (Results) -> Use (Calculator). */
    const DT_STEP_TABS = { 1: 'opt', 2: 'results', 3: 'calc' };
    function dt_stepperHTML(active) {
        const steps = [[1, 'Find'], [2, 'Pick'], [3, 'Use']];
        return `<div class="dt-steps">` + steps.map(([n, name]) =>
            `<button type="button" class="dt-step${n === active ? ' active' : ''}" data-step="${n}"><span class="dt-step-dot">${n}</span><span class="dt-step-name">${name}</span></button>`).join('') + `</div>`;
    }

    function dt_buildCalcPanel() {
        return `
          <section class="dt-panel active" id="dt-panel-calc">
            ${dt_stepperHTML(3)}
            <div class="dt-coach"><b>Use your strategy.</b> Put these two numbers into the game, then hit Send.</div>
            <div class="dt-heroes">
              ${dt_heroOutHTML('Starting bet', 'Bet Size', 'out_bet', '$')}
              ${dt_heroOutHTML('Stop at profit', 'Profit Stop', 'out_profit', '$')}
            </div>
            <div class="dt-subout">
              ${dt_subOutHTML('Multiplier', 'Multiplier', 'out_mult')}
              ${dt_subOutHTML('Target balance', 'Balance Target', 'out_target')}
            </div>
            <button class="dt-btn dt-btn-primary dt-go dt-go-big" id="dt-game_sync">Send to game →</button>
            <button class="dt-btn dt-btn-block" id="dt-game_import">Create a fresh strategy</button>

            <div class="dt-card">
              <div class="dt-card-title">Your numbers</div>
              <div class="dt-card-sub">Edit anything — the bet &amp; profit above update instantly. Tap any ? for help.</div>
              ${dt_rowInputHTML('Bankroll', 'Balance', 'balance', '20', 'decimal', "Money you're playing with")}
              ${dt_rowInputHTML('Bet increase on win %', 'Win Increase %', 'win_inc', '78', 'decimal', 'Grows your bet after a win')}
              ${dt_rowInputHTML('Losses before reset', 'Loss Reset', 'loss_reset', '5', 'numeric', 'Back to base bet after N losses')}
              ${dt_rowInputHTML('Bet size control', 'Balance Divisor', 'bet_div', '500', 'decimal', 'Higher = smaller, safer bets')}
              ${dt_rowInputHTML('Profit target multiplier', 'Profit Multiplier', 'profit_mult', '100', 'decimal', 'Sets your profit stop')}
              ${dt_rowInputHTML('Safety margin %', 'Buffer %', 'buffer', '25', 'decimal', 'Extra cushion on the multiplier')}
            </div>

            <div class="dt-card">
              <div class="dt-card-title">Test it first <span class="dt-opt-tag">optional</span></div>
              <div class="dt-card-sub">See how this strategy performs before betting real money.</div>
              ${dt_rowInputHTML('Number of test runs', 'Trials', 'n_trials', '100', 'numeric')}
              <div class="dt-btn-row" style="margin-top:9px;">
                <button class="dt-btn dt-btn-primary" id="dt-sim_run">Run test</button>
                <button class="dt-btn dt-btn-danger" id="dt-sim_stop" disabled>Stop</button>
              </div>
              <div class="dt-progress-wrap"><div class="dt-progress-bar" id="dt-sim_progress"></div></div>
              <div class="dt-status-line" id="dt-sim_status">Idle</div>
              <div class="dt-scroll" style="margin-top:8px;">
                <table class="dt-stats" id="dt-sim_results">
                  <tbody>
                    <tr><td colspan="2" style="text-align:center; opacity:0.5; padding:16px;">Run a test to see how often this strategy wins.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        `;
    }

    function dt_buildOptPanel() {
        return `
          <section class="dt-panel" id="dt-panel-opt">
            ${dt_stepperHTML(1)}
            <div class="dt-coach"><b>Find a strategy.</b> The tool tests hundreds of setups and ranks the best for you.</div>
            <div class="dt-card">
              <div class="dt-card-title">How hard should it search?</div>
              <div class="dt-card-sub">Just pick one and press Find. Fine-tune the ranges below if you want.</div>
              <div class="dt-preset-grid">
                <button type="button" class="dt-preset" data-preset="quick"><span class="dt-preset-ic">⚡</span><span><span class="dt-preset-name">Quick</span><span class="dt-preset-desc">~70 setups · a few seconds</span></span></button>
                <button type="button" class="dt-preset" data-preset="balanced"><span class="dt-preset-rec">Recommended</span><span class="dt-preset-ic">⚖️</span><span><span class="dt-preset-name">Balanced</span><span class="dt-preset-desc">a few hundred · best for most</span></span></button>
                <button type="button" class="dt-preset" data-preset="thorough"><span class="dt-preset-ic">🔬</span><span><span class="dt-preset-name">Thorough</span><span class="dt-preset-desc">thousands · slower</span></span></button>
                <button type="button" class="dt-preset" data-preset="center"><span class="dt-preset-ic">🎯</span><span><span class="dt-preset-name">Around my setup</span><span class="dt-preset-desc">centers on your Calculator</span></span></button>
              </div>
              ${dt_rowInputHTML('Bankroll', 'Starting Balance', 'opt_balance', '20', 'decimal', "Money you're playing with")}
              <details class="dt-adv-ranges">
                <summary>Customize ranges<span class="dt-adv-hint">advanced</span></summary>
                ${dt_fieldWideHTML('Tests per setup', 'opt_trials', '10', 'More = more accurate, slower', 'Trials per Combo')}
                ${dt_fieldWideHTML('Bet size control', 'opt_betdiv', '256,500', 'e.g. 256-512;step=1 or 25,30,40', 'Bet Divisor Range')}
                ${dt_fieldWideHTML('Profit target multiplier', 'opt_profit', '50,100', 'e.g. 25-150;step=5', 'Profit Multiplier Range')}
                ${dt_fieldWideHTML('Bet increase on win %', 'opt_w', '50-100;step=5', 'e.g. 50-150;step=5', 'Win Increase % Range')}
                ${dt_fieldWideHTML('Losses before reset', 'opt_l', '3-5;step=1', 'e.g. 3-8 (whole numbers)', 'Loss Reset (whole)')}
                ${dt_fieldWideHTML('Safety margin %', 'opt_buf', '25,30,40', 'e.g. 20-40;step=2', 'Buffer % Range')}
              </details>
            </div>
            <div class="dt-card">
              <div class="dt-est" id="dt-opt_preview">&mdash;</div>
              <button class="dt-btn dt-btn-primary dt-go dt-go-big" id="dt-opt_run">⚙️ Find strategies</button>
              <div class="dt-progress-wrap"><div class="dt-progress-bar" id="dt-opt_progress"></div></div>
              <div class="dt-status-line" id="dt-opt_status">Ready when you are.</div>
              <div class="dt-btn-row" style="margin-top:9px;">
                <button class="dt-btn" id="dt-opt_clear">Clear results</button>
                <button class="dt-btn dt-btn-danger" id="dt-opt_stop" disabled>Stop</button>
              </div>
              <button type="button" class="dt-next" id="dt-next_opt" data-goto="results" disabled>Run a search to continue</button>
            </div>
          </section>
        `;
    }

    function dt_buildResultsPanel() {
        return `
          <section class="dt-panel" id="dt-panel-results">
            ${dt_stepperHTML(2)}
            <div class="dt-coach"><b>Pick a strategy.</b> We've highlighted the best one for you.</div>
            <div id="dt-res_best"></div>
            <div class="dt-card">
              <div class="dt-card-title">All results</div>
              <div class="dt-card-sub">Ranked best-first. Tap a row to select it, then "Use selected".</div>
              <div class="dt-res-toolbar">
                <label class="dt-toggle"><input type="checkbox" id="dt-res_safe"> Hide risky</label>
                <label class="dt-toggle"><input type="checkbox" id="dt-res_allcols"> All columns</label>
              </div>
              <div class="dt-status-line" id="dt-res_status">No results yet — run the Optimizer first.</div>
              <div class="dt-scroll">
                <table class="dt-results" id="dt-res_table">
                  <thead><tr id="dt-res_head"></tr></thead>
                  <tbody id="dt-res_body"></tbody>
                </table>
              </div>
              <div class="dt-btn-row">
                <button class="dt-btn dt-btn-primary" id="dt-res_apply">Use selected</button>
                <button class="dt-btn" id="dt-res_csv">Export CSV</button>
              </div>
            </div>
          </section>
        `;
    }

    function dt_buildSettingsPanel() {
        return `
          <section class="dt-panel" id="dt-panel-settings">
            <div class="dt-coach"><b>All optional</b> — the defaults work fine.</div>
            <div class="dt-card">
              <div class="dt-card-title">Optimizer</div>
              <div class="dt-setting-row">
                <div>
                  <div class="dt-setting-label">Append Results</div>
                  <div class="dt-setting-desc">If on, new Optimizer runs append to Results instead of replacing.</div>
                </div>
                <label class="dt-switch"><input type="checkbox" id="dt-keep_prev"><span class="dt-slider"></span></label>
              </div>
              <div class="dt-setting-row">
                <div>
                  <div class="dt-setting-label">Parallel Workers</div>
                  <div class="dt-setting-desc">Number of Web Workers used.</div>
                </div>
                <input type="number" min="1" max="8" class="dt-num-input" id="dt-worker_count">
              </div>
            </div>
            <div class="dt-card">
              <div class="dt-card-title">About</div>
              <div class="dt-setting-row">
                <div class="dt-setting-label">Version</div>
                <div style="opacity:0.7;">Dice &amp; Limbo Tools v5.4 (Mobile)</div>
              </div>
              <button class="dt-btn dt-btn-block dt-btn-small" id="dt-reset_state">Reset All Saved Data</button>
            </div>
          </section>
        `;
    }

    /* ============================================================
       CALCULATOR + SIMULATOR
       ============================================================ */
    function dt_calcValues() {
        try {
            const balance = parseFloat($dt('balance').value);
            const w = parseFloat($dt('win_inc').value) / 100;
            const l = parseInt($dt('loss_reset').value, 10);
            const bet_div = parseFloat($dt('bet_div').value);
            const profit_mult = parseFloat($dt('profit_mult').value);
            const buffer = 1 + parseFloat($dt('buffer').value) / 100;
            if (![balance, w, bet_div, profit_mult, buffer].every(isFinite) || !Number.isFinite(l)) throw 0;
            const m = ((1 + w) * l) * buffer;
            const bet_size = balance / bet_div;
            const profit_stop = bet_size * profit_mult;
            const target = balance + profit_stop;
            $dt('out_mult').value = m.toFixed(2) + 'x';
            $dt('out_bet').value = bet_size.toFixed(4);
            $dt('out_profit').value = profit_stop.toFixed(2);
            $dt('out_target').value = target.toFixed(2);
        } catch (e) {
            ['out_mult', 'out_bet', 'out_profit', 'out_target'].forEach(id => {
                const el = $dt(id);
                if (el) el.value = 'Invalid';
            });
        }
    }

    function dt_getSimParams() {
        const n = parseInt($dt('n_trials').value, 10);
        if (!Number.isFinite(n) || n < 1) throw new Error('Invalid trials count');
        const p = {
            starting_balance: parseFloat($dt('balance').value),
            bet_div: parseFloat($dt('bet_div').value),
            profit_mult: parseFloat($dt('profit_mult').value),
            w: parseFloat($dt('win_inc').value) / 100,
            l: parseInt($dt('loss_reset').value, 10),
            buffer: 1 + parseFloat($dt('buffer').value) / 100,
            n_trials: n
        };
        for (const [k, v] of Object.entries(p)) {
            if (!Number.isFinite(v)) throw new Error('Invalid value for ' + k);
        }
        return p;
    }

    function dt_startSimulation() {
        if (dt_simRunning) return;
        let params;
        try { params = dt_getSimParams(); } catch { dt_toast('Please enter valid positive numbers.'); return; }
        dt_simRunning = true;
        $dt('sim_run').disabled = true;
        $dt('sim_stop').disabled = false;
        $dt('sim_progress').style.width = '0%';
        $dt('sim_status').textContent = 'Running...';
        dt_simWorker = dt_makeWorker();
        dt_simWorker.onmessage = (e) => {
            const m = e.data;
            if (m.kind === 'sim_progress') {
                const pct = (m.done / m.total * 100).toFixed(1);
                $dt('sim_progress').style.width = pct + '%';
                $dt('sim_status').textContent = `Progress: ${pct}% (${m.done}/${m.total})`;
            } else if (m.kind === 'sim_done') {
                dt_renderSimStats(m.stats);
                dt_endSimulation('Done');
            } else if (m.kind === 'error') {
                dt_toast('Simulation error: ' + m.error);
                dt_endSimulation('Error');
            }
        };
        dt_simWorker.postMessage({ kind: 'run_sim', params });
    }
    function dt_stopSimulation() {
        if (!dt_simRunning || !dt_simWorker) return;
        dt_simWorker.postMessage({ kind: 'stop' });
        setTimeout(() => dt_endSimulation('Stopped'), 200);
    }
    function dt_endSimulation(status) {
        if (dt_simWorker) { try { dt_simWorker.terminate(); } catch (e) {} dt_simWorker = null; }
        dt_simRunning = false;
        $dt('sim_run').disabled = false;
        $dt('sim_stop').disabled = true;
        $dt('sim_status').textContent = status;
    }
    function dt_renderSimStats(s) {
        const rows = [
            ['Average highest balance', s.avg_high ? '$' + s.avg_high.toFixed(2) : 'N/A'],
            ['Std dev (highest)', s.std_high ? '$' + s.std_high.toFixed(2) : 'N/A'],
            ['Max highest balance', s.max_high ? '$' + s.max_high.toFixed(2) : 'N/A'],
            ['Average cycles', s.avg_cycles.toFixed(2)],
            ['Average rounds', s.avg_rounds.toFixed(2)],
            ['Cycle success rate', s.cycle_success.toFixed(2) + '%'],
            ['Bust rate', s.bust_rate.toFixed(2) + '%']
        ];
        const tbody = $dt('sim_results').querySelector('tbody');
        tbody.innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    }

    /* ============================================================
       OPTIMIZER
       ============================================================ */
    function dt_parseRange(text, integer = false) {
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

    function dt_getOptParams() {
        const opt = {
            starting_balance: parseFloat($dt('opt_balance').value),
            n_trials: parseInt($dt('opt_trials').value, 10),
            bet_div_range: dt_parseRange($dt('opt_betdiv').value),
            profit_mult_range: dt_parseRange($dt('opt_profit').value),
            w_range: dt_parseRange($dt('opt_w').value),
            l_range: dt_parseRange($dt('opt_l').value, true),
            buffer_range: dt_parseRange($dt('opt_buf').value)
        };
        if (!Number.isFinite(opt.starting_balance) || !Number.isFinite(opt.n_trials) || opt.n_trials < 1) throw new Error('Invalid balance or trials');
        if ([opt.bet_div_range, opt.profit_mult_range, opt.w_range, opt.l_range, opt.buffer_range].some(r => !r.length)) throw new Error('Empty range');
        return opt;
    }
    function dt_buildCombos(opt) {
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
    function dt_startOptimizer() {
        if (dt_optRunning) return;
        let opt;
        try { opt = dt_getOptParams(); } catch { dt_toast('Check your range syntax (e.g. 100-500 or 20,30,40).'); return; }
        const combos = dt_buildCombos(opt);
        if (!combos.length) { dt_toast('No combinations to run.'); return; }
        if (combos.length > 50000) {
            if (!confirm(`${combos.length} combinations may take a long time. Continue?`)) return;
        }
        if (!$dt('keep_prev').checked) { dt_optResults = []; dt_renderResults(); }
        dt_optQueue = combos.slice();
        dt_optTotal = combos.length;
        dt_optDone = 0;
        dt_optRunning = true;
        $dt('opt_run').disabled = true;
        $dt('opt_stop').disabled = false;
        $dt('opt_progress').style.width = '0%';
        $dt('opt_status').textContent = `Running 0 / ${dt_optTotal}...`;
        const poolSize = Math.min(parseInt($dt('worker_count').value, 10) || 1, combos.length);
        dt_optWorkers = [];
        for (let i = 0; i < poolSize; i++) {
            const w = dt_makeWorker();
            w.onmessage = (e) => dt_handleOptMsg(w, e.data);
            dt_optWorkers.push(w);
            dt_dispatchNext(w);
        }
    }
    function dt_handleOptMsg(worker, msg) {
        if (msg.kind === 'opt_row') dt_optResults.push(msg.row);
        else if (msg.kind === 'opt_combo_done') {
            dt_optDone++;
            const pct = (dt_optDone / dt_optTotal * 100);
            $dt('opt_progress').style.width = pct.toFixed(1) + '%';
            $dt('opt_status').textContent = `Running ${dt_optDone} / ${dt_optTotal} (${pct.toFixed(1)}%)`;
            if (dt_optDone >= dt_optTotal || !dt_optRunning) dt_finishOptimizer();
            else dt_dispatchNext(worker);
        }
    }
    function dt_dispatchNext(worker) {
        if (!dt_optRunning) return;
        const combo = dt_optQueue.shift();
        if (!combo) return;
        worker.postMessage({ kind: 'run_combo', combo });
    }
    function dt_stopOptimizer() {
        if (!dt_optRunning) return;
        dt_optRunning = false;
        dt_optQueue = [];
        for (const w of dt_optWorkers) { try { w.postMessage({ kind: 'stop' }); } catch (e) {} }
        setTimeout(dt_finishOptimizer, 250);
    }
    function dt_finishOptimizer() {
        if (!dt_optRunning && !dt_optWorkers.length) return;
        for (const w of dt_optWorkers) { try { w.terminate(); } catch (e) {} }
        dt_optWorkers = [];
        dt_optRunning = false;
        dt_optResults.sort((a, b) => b.Score - a.Score);
        dt_state.results = dt_optResults.slice();
        dt_saveState();
        dt_renderResults();
        $dt('opt_run').disabled = false;
        $dt('opt_stop').disabled = true;
        $dt('opt_status').textContent = `Done (${dt_optResults.length} results)`;
        dt_toast('Optimizer complete');
        dt_switchTab('results');
    }

    /* ============================================================
       RESULTS TABLE
       ============================================================ */
    function dt_renderResults() {
        const head = $dt('res_head');
        const body = $dt('res_body');
        const best = $dt('res_best');
        if (!head) return;
        const cols = dt_showAllCols ? DT_RES_COLS : DT_RES_COLS_PRIMARY;
        head.innerHTML = cols.map(c => {
            const arrow = c === dt_resultsSortCol ? (dt_resultsSortAsc ? ' ▲' : ' ▼') : '';
            return `<th data-col="${c}">${DT_RES_COL_LABELS[c] || c}${arrow}</th>`;
        }).join('');
        if (!dt_optResults.length) {
            body.innerHTML = '';
            if (best) best.innerHTML = '';
            $dt('res_status').textContent = 'No results yet — run the Optimizer first.';
            dt_updateStepper();
            return;
        }
        if (best) {
            best.innerHTML = dt_renderBestCard();
            const ab = $dt('res_best_apply');
            if (ab) ab.onclick = dt_applyBestPick;
        }
        let sorted = dt_optResults.slice().sort((a, b) => {
            const av = a[dt_resultsSortCol], bv = b[dt_resultsSortCol];
            if (av == null && bv == null) return 0;
            const cmp = (typeof av === 'number' && typeof bv === 'number') ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true });
            return dt_resultsSortAsc ? cmp : -cmp;
        });
        if (dt_safeOnly) sorted = sorted.filter(r => (typeof r['Bust%'] === 'number' ? r['Bust%'] : 100) <= DT_SAFE_BUST_MAX);
        $dt('res_status').textContent = dt_safeOnly
            ? `${sorted.length} of ${dt_optResults.length} (Bust% ≤ ${DT_SAFE_BUST_MAX})`
            : `${dt_optResults.length} result${dt_optResults.length === 1 ? '' : 's'}`;
        body.innerHTML = sorted.map(r => {
            const cells = cols.map(c => {
                const v = r[c];
                const cls = dt_resCellClass(c, v);
                let inner = typeof v === 'number' ? v.toFixed(2) : v;
                if (c === 'Bust%' && typeof v === 'number') {
                    const w = Math.max(3, Math.min(24, v * 1.4));
                    const bcls = v <= 5 ? 'good' : (v >= 20 ? 'bad' : 'mid');
                    inner = `<span class="dt-riskbar ${bcls}" style="width:${w}px"></span>${v.toFixed(1)}`;
                }
                return `<td class="${cls}">${inner}</td>`;
            }).join('');
            const origIdx = dt_optResults.indexOf(r);
            return `<tr data-idx="${origIdx}" class="${origIdx === dt_selectedRowIdx ? 'selected' : ''}">${cells}</tr>`;
        }).join('');
        dt_updateStepper();
    }
    function dt_resCellClass(col, v) {
        if (typeof v !== 'number') return '';
        if (col === 'Score') return v >= 1 ? 'dt-cell-good' : (v <= 0 ? 'dt-cell-bad' : 'dt-cell-mid');
        if (col === 'Bust%') return v <= 5 ? 'dt-cell-good' : (v >= 20 ? 'dt-cell-bad' : 'dt-cell-mid');
        if (col === 'CycleSuccess%') return v >= 60 ? 'dt-cell-good' : (v < 30 ? 'dt-cell-bad' : 'dt-cell-mid');
        return '';
    }
    function dt_bestResultIdx() {
        if (!dt_optResults.length) return -1;
        let bi = 0;
        for (let i = 1; i < dt_optResults.length; i++) {
            const s = dt_optResults[i].Score, sb = dt_optResults[bi].Score;
            if ((s == null ? -Infinity : s) > (sb == null ? -Infinity : sb)) bi = i;
        }
        return bi;
    }
    function dt_renderBestCard() {
        const bi = dt_bestResultIdx();
        if (bi < 0) return '';
        const r = dt_optResults[bi];
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
    function dt_applyBestPick() {
        const bi = dt_bestResultIdx();
        if (bi < 0) return;
        dt_selectedRowIdx = bi;
        dt_applySelectedToCalculator();
    }
    /* Guided rail done-state + Optimizer "next" button (mirrors desktop updateStepper). */
    function dt_updateStepper() {
        const panel = document.getElementById(DT_PANEL_ID);
        if (!panel) return;
        const hasResults = Array.isArray(dt_optResults) && dt_optResults.length > 0;
        const reviewed = hasResults && (dt_selectedRowIdx >= 0 || dt_bestResultIdx() >= 0);
        panel.querySelectorAll('.dt-step[data-step="1"]').forEach(s => s.classList.toggle('done', hasResults));
        panel.querySelectorAll('.dt-step[data-step="2"]').forEach(s => s.classList.toggle('done', reviewed));
        const next = $dt('next_opt');
        if (next) {
            next.disabled = !hasResults;
            next.textContent = hasResults ? 'See your results →' : 'Run a search to continue';
        }
    }
    /* Optimizer presets — fill the range fields, then the existing engine runs. */
    function dt_applyOptPreset(name) {
        if (name === 'center') { dt_centerOptOnCalc(); return; }
        const p = DT_OPT_PRESETS[name]; if (!p) return;
        for (const k in p) { const el = $dt(k); if (el) el.value = p[k]; }
        dt_updateOptPreview(); dt_saveState();
        dt_toast(name.charAt(0).toUpperCase() + name.slice(1) + ' preset loaded');
    }
    function dt_centerOptOnCalc() {
        const nv = id => { const el = $dt(id); const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : null; };
        const bal = nv('balance'), bd = nv('bet_div'), pm = nv('profit_mult'), wi = nv('win_inc'), bf = nv('buffer');
        const lrEl = $dt('loss_reset'); const lr = lrEl ? parseInt(lrEl.value, 10) : NaN;
        if ([bal, bd, pm, wi, bf].some(v => v == null) || !Number.isFinite(lr)) { dt_toast('Enter valid Calculator values first.'); return; }
        const set = (id, v) => { const el = $dt(id); if (el) el.value = v; };
        const r = Math.round;
        set('opt_balance', String(+bal.toFixed(2)));
        set('opt_betdiv', Math.max(1, r(bd / 2)) + ',' + r(bd) + ',' + r(bd * 2));
        set('opt_profit', Math.max(1, r(pm / 2)) + ',' + r(pm) + ',' + r(pm * 2));
        set('opt_w', Math.max(0, r(wi - 20)) + '-' + r(wi + 20) + ';step=10');
        set('opt_l', Math.max(1, lr - 1) + '-' + (lr + 1) + ';step=1');
        set('opt_buf', Math.max(0, r(bf - 10)) + ',' + r(bf) + ',' + r(bf + 10));
        dt_updateOptPreview(); dt_saveState();
        dt_toast('Ranges centered on your Calculator values');
    }
    function dt_updateOptPreview() {
        const est = $dt('opt_preview'); if (!est) return;
        const fields = [['opt_betdiv', false], ['opt_profit', false], ['opt_w', false], ['opt_l', true], ['opt_buf', false]];
        let combos = 1, anyBad = false;
        for (const [id, integer] of fields) {
            const el = $dt(id); if (!el) continue;
            const vals = dt_parseRange(el.value, integer);
            if (!vals.length) anyBad = true; else combos *= vals.length;
        }
        const trialsEl = $dt('opt_trials');
        const trials = parseInt(trialsEl ? trialsEl.value : '', 10);
        if (anyBad || !Number.isFinite(trials) || trials < 1) {
            est.textContent = 'Fix the ranges to size the run.';
            est.classList.add('bad'); est.classList.remove('warn');
            return;
        }
        const sims = combos * trials;
        est.innerHTML = '<b>' + combos.toLocaleString() + '</b> setup' + (combos === 1 ? '' : 's') + ' × <b>' + trials + '</b> test' + (trials === 1 ? '' : 's') + ' = <b>' + sims.toLocaleString() + '</b> sims';
        est.classList.remove('bad');
        est.classList.toggle('warn', combos > 50000);
    }
    function dt_onResTableClick(e) {
        const th = e.target.closest('th');
        if (th && th.dataset.col) {
            const col = th.dataset.col;
            if (dt_resultsSortCol === col) dt_resultsSortAsc = !dt_resultsSortAsc;
            else { dt_resultsSortCol = col; dt_resultsSortAsc = false; }
            dt_renderResults();
            return;
        }
        const tr = e.target.closest('tr[data-idx]');
        if (tr) {
            $$dt('#dt-res_body tr').forEach(r => r.classList.remove('selected'));
            tr.classList.add('selected');
            dt_selectedRowIdx = parseInt(tr.dataset.idx, 10);
            dt_updateStepper();
        }
    }
    function dt_applySelectedToCalculator() {
        if (dt_selectedRowIdx < 0 || !dt_optResults[dt_selectedRowIdx]) { dt_toast('Select a row first.'); return; }
        const r = dt_optResults[dt_selectedRowIdx];
        $dt('bet_div').value = r.BetDiv;
        $dt('profit_mult').value = r.ProfitMult;
        $dt('win_inc').value = r['W%'];
        $dt('loss_reset').value = r.L;
        $dt('buffer').value = r['Buffer%'];
        dt_calcValues();
        dt_saveState();
        dt_switchTab('calc');
        dt_toast('Parameters applied to Calculator');
    }
    function dt_clearResults() {
        if (!dt_optResults.length) return;
        if (!confirm('Clear all optimizer results?')) return;
        dt_optResults = [];
        dt_state.results = [];
        dt_selectedRowIdx = -1;
        dt_saveState();
        dt_renderResults();
    }
    function dt_exportResultsCSV() {
        if (!dt_optResults.length) { dt_toast('No results to save.'); return; }
        const sorted = dt_optResults.slice().sort((a, b) => {
            const cmp = a[dt_resultsSortCol] - b[dt_resultsSortCol];
            return dt_resultsSortAsc ? cmp : -cmp;
        });
        const lines = [DT_RES_COLS.join(',')];
        for (const r of sorted) {
            lines.push(DT_RES_COLS.map(c => {
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
        dt_toast('CSV downloaded');
    }

    /* ============================================================
       GAME INTEGRATION — site-aware (Stake + Shuffle)
       ============================================================ */
    async function dt_closeStrategyPopup_shuffle() {
        await dt_sleep(400);
        const btn = document.querySelector('button[aria-label*="close" i]');
        if (btn) { btn.click(); return true; }
        return false;
    }
    async function dt_closeStrategyPopup_stake() {
        await dt_sleep(400);
        const btn = document.querySelector('button[data-testid="game-modal-close"]');
        if (btn) { btn.click(); return true; }
        return false;
    }

    async function dt_shuffle_exportBalance() {
        const activeBtn = document.querySelector('button.TabView_active__G842W p');
        if (!activeBtn || !activeBtn.textContent.trim()) { dt_toast('Active balance element not found'); return; }
        const raw = activeBtn.textContent.trim();
        let cleaned = raw.replace(/,/g, '').replace(/[^0-9.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) cleaned = parts.shift() + '.' + parts.join('');
        if (!cleaned || isNaN(cleaned)) { dt_toast('Invalid balance: ' + raw); return; }
        const balance = Number(cleaned);
        $dt('balance').value = balance;
        dt_calcValues();
        dt_saveState();
        dt_toast(`Balance imported: ${balance}`);
    }
    async function dt_shuffle_updateExisting() {
        try {
            const v = dt_currentCalcValues();
            const betSize = v.bet_size;
            const balanceTarget = v.balance_target;
            if (!betSize || !balanceTarget || betSize === 'Invalid' || balanceTarget === 'Invalid') { dt_toast('Missing bet_size or balance_target.'); return; }
            const betInput = document.querySelector('input[data-testid="bet-amount"]');
            if (betInput) dt_setNativeValue(betInput, betSize);
            const editBtn = await dt_waitForText('button', 'Edit');
            if (!editBtn) { dt_toast('Edit button not found'); return; }
            editBtn.click();
            await dt_sleep(1000);
            const headers = document.querySelectorAll('.AdvancedDiceCondition_header__jDZzw');
            const cond4 = Array.from(headers).find(h => h.textContent.includes('Condition 4'));
            if (!cond4) { dt_toast('Condition 4 not found.'); return; }
            cond4.click();
            await dt_sleep(500);
            const conditionDiv = cond4.closest('.AdvancedDiceCondition_root__CaIQo');
            const inputs = conditionDiv ? conditionDiv.querySelectorAll('input[type="number"]') : [];
            if (inputs[0]) dt_setNativeValue(inputs[0], balanceTarget);
            const closed = await dt_closeStrategyPopup_shuffle();
            dt_toast(closed ? 'Strategy updated & saved.' : 'Strategy updated — close the popup manually.');
        } catch (err) { dt_toast('Update failed: ' + err); console.error(err); }
    }
    async function dt_shuffle_importNew() {
        try {
            const v = dt_currentCalcValues();
            const { bet_size, profit_stop, balance_target, multiplier, win_increase, loss_reset } = v;
            if (bet_size === 'Invalid' || profit_stop === 'Invalid' || balance_target === 'Invalid') { dt_toast('Calculator values invalid.'); return; }
            const advancedTab = document.getElementById('advanced-bet');
            if (advancedTab && !advancedTab.classList.contains('TabView_active__G842W')) {
                advancedTab.click();
                await dt_sleep(800);
            }
            const betInfoInputs = document.querySelectorAll('input#betInfo');
            if (betInfoInputs.length < 2) throw 'betInfo inputs not found';
            dt_setNativeValue(betInfoInputs[0], multiplier);
            await dt_sleep(600);
            const winChance = betInfoInputs[1].value;
            const betInput = document.querySelector('input[data-testid="bet-amount"]');
            if (betInput) dt_setNativeValue(betInput, bet_size);
            const createBtn = await dt_waitForText('button', 'Create strategy');
            if (!createBtn) throw 'Create strategy button not found';
            createBtn.click();
            await dt_sleep(800);
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
            dt_setNativeValue(nameInput, `${multiplier}x`);
            await dt_sleep(300);
            if (nameInput.value !== `${multiplier}x`) { dt_setNativeValue(nameInput, `${multiplier}x`); await dt_sleep(300); }
            const getStartedBtn = await dt_waitForText('button', 'Get Started');
            if (!getStartedBtn) throw 'Get Started button not found';
            getStartedBtn.click();
            const addBtn = await dt_waitForText('button', 'Add new condition block', 10000);
            if (!addBtn) throw 'Add condition block button not found';
            for (let i = 0; i < 4; i++) { addBtn.click(); await dt_sleep(500); }
            await dt_sleep(1000);
            const headers = document.querySelectorAll('.AdvancedDiceCondition_header__jDZzw');
            if (headers.length < 4) throw `Only ${headers.length} conditions created.`;
            for (let i = 0; i < 4; i++) {
                headers[i].click();
                await dt_sleep(500);
                const conditionDiv = headers[i].closest('.AdvancedDiceCondition_root__CaIQo');
                const radioLabels = conditionDiv.querySelectorAll('.AdvancedDiceCondition_customRadio__H__kC');
                const targetRadioIndex = (i === 0 || i === 3) ? 1 : 0;
                if (radioLabels[targetRadioIndex] && !radioLabels[targetRadioIndex].classList.contains('AdvancedDiceCondition_checked__Hivoo')) {
                    radioLabels[targetRadioIndex].click();
                    await dt_sleep(300);
                }
                const selects = conditionDiv.querySelectorAll('select');
                const inputs = conditionDiv.querySelectorAll('input[type="number"]');
                if (i === 0) {
                    dt_setSelectValue(selects[0], 'balance');
                    dt_setSelectValue(selects[1], 'greaterThanOrEqualTo');
                    dt_setNativeValue(inputs[0], '0.00');
                    dt_setSelectValue(selects[2], 'setWinChance');
                    await dt_sleep(300);
                    const refreshedInputs = conditionDiv.querySelectorAll('input[type="number"]');
                    const winChanceInput = refreshedInputs[1];
                    if (!winChanceInput) throw 'Win chance input not found after re-render';
                    dt_setNativeValue(winChanceInput, winChance);
                } else if (i === 1) {
                    dt_setSelectValue(selects[0], 'every');
                    dt_setNativeValue(inputs[0], '1');
                    dt_setSelectValue(selects[1], 'wins');
                    dt_setSelectValue(selects[2], 'increaseBetAmountPercentage');
                    await dt_sleep(300);
                    const refreshedInputs = conditionDiv.querySelectorAll('input[type="number"]');
                    const increaseInput = refreshedInputs[1];
                    if (!increaseInput) throw 'Increase % input not found after re-render';
                    dt_setNativeValue(increaseInput, win_increase);
                } else if (i === 2) {
                    dt_setSelectValue(selects[0], 'everyStreakOf');
                    dt_setNativeValue(inputs[0], loss_reset);
                    dt_setSelectValue(selects[1], 'losses');
                    dt_setSelectValue(selects[2], 'resetBetAmount');
                } else if (i === 3) {
                    dt_setSelectValue(selects[0], 'balance');
                    dt_setSelectValue(selects[1], 'greaterThanOrEqualTo');
                    dt_setNativeValue(inputs[0], balance_target);
                    dt_setSelectValue(selects[2], 'stopAutobet');
                }
                await dt_sleep(400);
            }
            try {
                await dt_sleep(400);
                const allConds = document.querySelectorAll('.AdvancedDiceCondition_root__CaIQo');
                const cond5 = allConds[4];
                if (cond5) {
                    const header5 = cond5.querySelector('.AdvancedDiceCondition_header__jDZzw');
                    if (header5) { header5.click(); await dt_sleep(400); }
                    const del = cond5.querySelector('button[aria-label*="delete" i]')
                             || cond5.querySelector('button[aria-label*="remove" i]')
                             || cond5.querySelector('button[title*="delete" i]')
                             || [...cond5.querySelectorAll('button')].find(b => /^(Delete|Remove|×)$/i.test((b.textContent||'').trim()))
                             || (cond5.querySelector('svg[class*="trash" i], svg[class*="delete" i], svg[class*="remove" i]')||{}).closest && cond5.querySelector('svg[class*="trash" i], svg[class*="delete" i], svg[class*="remove" i]').closest('button');
                    if (del) { del.click(); await dt_sleep(400); }
                }
            } catch (e) {}
            dt_seedStatsFromCalc();
            dt_toast(`"${multiplier}x" strategy created. Click "Save Strategy".`);
        } catch (err) { dt_toast('Import failed: ' + err); console.error(err); }
    }

    async function dt_stake_exportBalance() {
        const el = document.querySelector('span.ds-body-md-strong[data-ds-text="true"][style*="max-width: 16ch"]') ||
                   document.querySelector('span.ds-body-md-strong[data-ds-text="true"]');
        if (!el) { dt_toast('Balance element not found'); return; }
        const rawText = el.textContent.trim();
        let cleaned = rawText.replace(/,/g, '').replace(/[^\d.]/g, '');
        const parts = cleaned.split('.');
        if (parts.length > 2) cleaned = parts.shift() + '.' + parts.join('');
        const balance = parseFloat(cleaned);
        if (isNaN(balance)) { dt_toast('Invalid balance: ' + rawText); return; }
        $dt('balance').value = balance;
        dt_calcValues();
        dt_saveState();
        dt_toast(`Balance imported: ${balance}`);
    }
    async function dt_stake_updateExisting() {
        try {
            const v = dt_currentCalcValues();
            const betSize = v.bet_size;
            const balanceTarget = v.balance_target;
            if (!betSize || !balanceTarget || betSize === 'Invalid' || balanceTarget === 'Invalid') { dt_toast('Missing bet_size or balance_target.'); return; }
            const betInput = await dt_waitFor('input[data-testid="input-game-amount"]');
            betInput.value = betSize; dt_trigger(betInput);
            const cond4BlockBtn = await dt_waitFor('button[data-testid="block-condition-4"]');
            cond4BlockBtn.click();
            await dt_sleep(600);
            const editBtn = document.querySelector('button[data-testid="conditional-block-edit-condition-4"]');
            if (editBtn) { editBtn.click(); await dt_sleep(600); }
            const amountInput = await dt_waitFor('input[data-testid="condition-profit-amount-input"]');
            amountInput.value = balanceTarget; dt_trigger(amountInput);
            const closed = await dt_closeStrategyPopup_stake();
            dt_toast(closed ? 'Strategy updated & saved.' : 'Strategy updated — close the popup manually.');
        } catch (err) { dt_toast('Update failed: ' + err); console.error(err); }
    }
    async function dt_stake_importNew() {
        try {
            const v = dt_currentCalcValues();
            const { bet_size, profit_stop, balance_target, multiplier, win_increase, loss_reset } = v;
            if (bet_size === 'Invalid' || profit_stop === 'Invalid' || balance_target === 'Invalid') { dt_toast('Calculator values invalid.'); return; }
            const payoutInput = await dt_waitFor('input[data-testid="payout"]');
            payoutInput.value = multiplier; dt_trigger(payoutInput);
            await dt_sleep(600);
            const chanceEl = await dt_waitFor('input[data-testid="chance"]');
            const winChance = chanceEl.value;
            const betInput = document.querySelector('input[data-testid="input-game-amount"]');
            if (betInput) { betInput.value = bet_size; dt_trigger(betInput); }
            const advBtn = await dt_waitFor('svg[data-ds-icon="BetAdvanced"]');
            advBtn.closest('button').click();
            await dt_sleep(800);
            const createBtn = await dt_waitFor('button[data-testid="create-strategy-button"]');
            createBtn.click();
            await dt_sleep(800);
            const nameInput = await dt_waitFor('input[data-testid="strategy-name-input"]');
            nameInput.value = `${multiplier}x`; dt_trigger(nameInput);
            const getStartedBtn = Array.from(document.querySelectorAll('div, button')).find(el => el.textContent.trim() === 'Get Started' || el.textContent.trim() === 'Get started');
            if (!getStartedBtn) throw 'Get Started button not found';
            getStartedBtn.click();
            await dt_sleep(1500);
            const addBtn = await dt_waitFor('button[data-testid="conditional-block-add"]');
            for (let i = 0; i < 4; i++) { addBtn.click(); await dt_sleep(800); }
            await dt_sleep(1000);
            const editPencils = document.querySelectorAll('svg[data-ds-icon="Edit"]');
            if (editPencils.length < 4) throw `Only ${editPencils.length} conditions created`;
            editPencils[0].closest('button').click();
            await dt_sleep(600);
            const profitRadio1 = await dt_waitFor('label[data-testid="condition-type-radio-profit"]');
            profitRadio1.click(); await dt_sleep(300);
            let sel = await dt_waitFor('select[data-testid="condition-profit-type"]');
            sel.value = 'balance'; dt_trigger(sel);
            sel = await dt_waitFor('select[data-testid="condition-profit-term-type-options"]');
            sel.value = 'greaterThanOrEqualTo'; dt_trigger(sel);
            let inp = await dt_waitFor('input[data-testid="condition-profit-amount-input"]');
            inp.value = '0.00'; dt_trigger(inp);
            sel = await dt_waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'setWinChance'; dt_trigger(sel);
            inp = await dt_waitFor('input[data-testid="condition-action-percentage-input"]');
            inp.value = winChance; dt_trigger(inp);
            await dt_sleep(500);
            editPencils[1].closest('button').click(); await dt_sleep(600);
            sel = await dt_waitFor('select[data-testid="condition-term-options"]');
            sel.value = 'every'; dt_trigger(sel);
            inp = await dt_waitFor('input[data-testid="condition-count-input"]');
            inp.value = '1'; dt_trigger(inp);
            sel = await dt_waitFor('select[data-testid="condition-bet-type-options"]');
            sel.value = 'win'; dt_trigger(sel);
            sel = await dt_waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'increaseByPercentage'; dt_trigger(sel);
            inp = await dt_waitFor('input[data-testid="condition-action-percentage-input"]');
            inp.value = win_increase; dt_trigger(inp);
            await dt_sleep(500);
            editPencils[2].closest('button').click(); await dt_sleep(600);
            sel = await dt_waitFor('select[data-testid="condition-term-options"]');
            sel.value = 'everyStreakOf'; dt_trigger(sel);
            inp = await dt_waitFor('input[data-testid="condition-count-input"]');
            inp.value = loss_reset; dt_trigger(inp);
            sel = await dt_waitFor('select[data-testid="condition-bet-type-options"]');
            sel.value = 'lose'; dt_trigger(sel);
            sel = await dt_waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'resetAmount'; dt_trigger(sel);
            await dt_sleep(500);
            editPencils[3].closest('button').click(); await dt_sleep(600);
            const profitRadio4 = await dt_waitFor('label[data-testid="condition-type-radio-profit"]');
            profitRadio4.click(); await dt_sleep(300);
            sel = await dt_waitFor('select[data-testid="condition-profit-type"]');
            sel.value = 'balance'; dt_trigger(sel);
            sel = await dt_waitFor('select[data-testid="condition-profit-term-type-options"]');
            sel.value = 'greaterThanOrEqualTo'; dt_trigger(sel);
            inp = await dt_waitFor('input[data-testid="condition-profit-amount-input"]');
            inp.value = balance_target; dt_trigger(inp);
            sel = await dt_waitFor('select[data-testid="condition-action-options"]');
            sel.value = 'stop'; dt_trigger(sel);
            await dt_sleep(400);
            try {
                let del5 = document.querySelector('button[data-testid="conditional-block-delete-condition-5"]');
                if (!del5) {
                    const editBtn5 = document.querySelector('button[data-testid="conditional-block-edit-condition-5"]')
                                  || document.querySelector('button[data-testid="block-condition-5"]');
                    if (editBtn5) {
                        editBtn5.click();
                        await dt_sleep(500);
                        del5 = document.querySelector('button[data-testid="conditional-block-delete-condition-5"]');
                    }
                }
                if (del5) { del5.click(); await dt_sleep(400); }
            } catch (e) {}
            dt_seedStatsFromCalc();
            dt_toast(`"${multiplier}x" strategy created. Click "Save Strategy".`);
        } catch (err) { dt_toast('Import failed: ' + err); console.error(err); }
    }

    function dt_gameExport() {
        if (location.hostname.includes('shuffle.')) return dt_shuffle_exportBalance();
        return dt_stake_exportBalance();
    }
    function dt_gameUpdate() {
        if (location.hostname.includes('shuffle.')) return dt_shuffle_updateExisting();
        return dt_stake_updateExisting();
    }
    /* On a fresh-strategy import, seed the Stats-tab Balance Divisor / Profit
       Multiplier from the Calculator so they match the new strategy. Initial
       seed only — the user can change them afterward (Stats stays two-way bound).
       No-op when the Stats tab isn't present. */
    function dt_seedStatsFromCalc() {
        [['bet_div', 'dt-stats-bet-div'], ['profit_mult', 'dt-stats-profit-mult']].forEach(([calcId, statsId]) => {
            const src = $dt(calcId), dst = document.getElementById(statsId);
            if (src && dst && src.value !== '' && src.value !== 'Invalid') {
                dst.value = src.value;
                dst.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }
    function dt_gameImport() {
        if (location.hostname.includes('shuffle.')) return dt_shuffle_importNew();
        return dt_stake_importNew();
    }
    async function dt_gameSync() {
        await dt_gameExport();
        await dt_sleep(150);
        await dt_gameUpdate();
    }

    /* ============================================================
       STREAK COUNTER LOGIC — drives #dt-ctr_w / #dt-ctr_l which the
       integration relocates into the Stats tab. No floating widget.
       ============================================================ */
    let _dt_winStreak = 0, _dt_lossStreak = 0;
    let _dt_counterObservers = [];
    let _dt_counterInitPoll = null;

    function dt_updateCounterDisplay() {
        const w = document.getElementById('dt-ctr_w');
        const l = document.getElementById('dt-ctr_l');
        if (w) w.textContent = _dt_winStreak;
        if (l) { l.textContent = _dt_lossStreak; l.classList.toggle('has-loss', _dt_lossStreak > 0); }
    }
    function dt_animateSpan(el) {
        if (!el) return;
        el.style.transform = 'scale(1.25)';
        setTimeout(() => { el.style.transform = 'scale(1)'; }, 300);
    }
    function dt_playBeep() {
        // Win sound is scoped to Advanced IOW mode only. If the HUD exists but
        // toolsActive isn't set, silently skip — Manual/IOW/Smart shouldn't beep.
        const hud = document.getElementById('ratchet-master-container');
        if (hud && hud.dataset.toolsActive !== '1') return;
        const vol = dt_state.counter_volume / 100;
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
            setTimeout(() => { osc.stop(); try { ctx.close(); } catch (e) {} }, 200);
        } catch (e) {}
    }
    function dt_stopAutoplay_shuffle() {
        const stopText = document.querySelector('button[data-testid="bet-button"] span.ButtonVariants_buttonContent__mRPrs');
        if (stopText && stopText.innerText.includes('Stop Autoplay')) {
            const btn = stopText.closest('button');
            if (btn && !btn.disabled) btn.click();
        }
    }
    function dt_stopAutoplay_stake() {
        const btn = document.querySelector('button[data-testid="auto-bet-button"][data-autobet-status="stop"]');
        if (btn && !btn.disabled) btn.click();
    }
    function dt_stopAutoplayAction() {
        if (location.hostname.includes('shuffle.')) return dt_stopAutoplay_shuffle();
        return dt_stopAutoplay_stake();
    }
    function dt_onWinDetected() {
        _dt_winStreak++;
        _dt_lossStreak = 0;
        dt_updateCounterDisplay();
        dt_animateSpan(document.getElementById('dt-ctr_w'));
        dt_playBeep();
        if (dt_state.counter_autostop && _dt_winStreak >= (dt_state.counter_target || 0) && dt_state.counter_target > 0) {
            dt_stopAutoplayAction();
        }
    }
    function dt_onLossDetected() {
        _dt_lossStreak++;
        dt_updateCounterDisplay();
        dt_animateSpan(document.getElementById('dt-ctr_l'));
    }

    let _dt_sh_prev3Active = false, _dt_sh_lastSeenText = '';
    function dt_initCounter_shuffle() {
        const conditionContainer = document.querySelector('.AdvancedDiceBet_conditionContainer__6o_z9');
        const resultsWrapper = document.querySelector('.OriginalGameRecentResult_originalGameResultsWrapper__aCNPr');
        if (!conditionContainer || !resultsWrapper) return false;
        const initialNewest = resultsWrapper.children[0];
        if (initialNewest) {
            const initialButton = initialNewest.querySelector('button');
            if (initialButton) _dt_sh_lastSeenText = initialButton.innerText;
        }
        function checkCondition3() {
            const buttons = conditionContainer.querySelectorAll('button.AdvancedDiceConditionTag_condition__8L8IB');
            let cond3Btn = null;
            buttons.forEach(b => { if (b.innerText.trim() === '3') cond3Btn = b; });
            if (!cond3Btn) return;
            const tagDiv = cond3Btn.querySelector('div.AdvancedDiceConditionTag_tag__gdVMG');
            if (!tagDiv) return;
            const current3Active = tagDiv.classList.contains('AdvancedDiceConditionTag_active__7Rex1');
            if (current3Active && !_dt_sh_prev3Active) { _dt_winStreak = 0; dt_updateCounterDisplay(); }
            _dt_sh_prev3Active = current3Active;
        }
        const resultsObs = new MutationObserver(() => {
            const newest = resultsWrapper.children[0];
            if (!newest) return;
            const button = newest.querySelector('button');
            if (!button) return;
            const currentText = button.innerText;
            if (currentText === _dt_sh_lastSeenText) return;
            _dt_sh_lastSeenText = currentText;
            const isWin = button.style.backgroundColor === 'rgb(61, 209, 121)';
            if (isWin) dt_onWinDetected(); else dt_onLossDetected();
        });
        resultsObs.observe(resultsWrapper, { childList: true, subtree: true, attributes: true });
        const condObs = new MutationObserver(checkCondition3);
        condObs.observe(conditionContainer, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
        checkCondition3();
        _dt_counterObservers.push(resultsObs, condObs);
        return true;
    }

    let _dt_st_prev3Success = false, _dt_st_lastSeenBetId = null;
    function dt_initCounter_stake() {
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
            if (curr && !_dt_st_prev3Success) { _dt_winStreak = 0; dt_updateCounterDisplay(); }
            _dt_st_prev3Success = curr;
        }
        const betObs = new MutationObserver(() => {
            const newest = pastBets.querySelector('button[data-last-bet-index="0"]');
            if (!newest) return;
            const betId = newest.getAttribute('data-past-bet-id');
            if (betId === _dt_st_lastSeenBetId) return;
            _dt_st_lastSeenBetId = betId;
            const isWin = newest.classList.contains('variant-positive');
            if (isWin) dt_onWinDetected(); else dt_onLossDetected();
        });
        betObs.observe(pastBets, { childList: true, subtree: true });
        const condObs = new MutationObserver(checkButton3);
        condObs.observe(container, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
        checkButton3();
        _dt_counterObservers.push(betObs, condObs);
        return true;
    }

    function dt_initStreakCounter() {
        const initFn = location.hostname.includes('shuffle.') ? dt_initCounter_shuffle : dt_initCounter_stake;
        if (initFn()) return;
        _dt_counterInitPoll = setInterval(() => {
            if (initFn()) { clearInterval(_dt_counterInitPoll); _dt_counterInitPoll = null; }
        }, 500);
    }

    /* ============================================================
       TAB SWITCHING + TOOLTIPS + COPY + THEME
       ============================================================ */
    function dt_switchTab(name) {
        const panel = document.getElementById(DT_PANEL_ID);
        if (!panel) return;
        panel.setAttribute('data-active-tab', name); // drives extend-downward sizing
        panel.querySelectorAll('.dt-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
        panel.querySelectorAll('.dt-panel').forEach(p => p.classList.toggle('active', p.id === 'dt-panel-' + name));
        const body = panel.querySelector('.dt-body');
        if (body) body.scrollTop = 0;
        dt_updateStepper();
    }

    let _dt_ttCurrentTarget = null;
    function dt_showTooltip(target) {
        const term = target.dataset.tooltip;
        const def = DT_GLOSSARY[term];
        if (!def) return;
        const tt = document.getElementById('dt-tooltip');
        if (!tt) return;
        if (_dt_ttCurrentTarget === target && tt.classList.contains('show')) {
            dt_hideTooltip();
            return;
        }
        _dt_ttCurrentTarget = target;
        tt.innerHTML = `<div class="dt-tt-title">${term}</div>${def}`;
        tt.style.visibility = 'hidden';
        tt.style.top = '0px';
        tt.style.left = '0px';
        tt.classList.add('show');
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
    function dt_hideTooltip() {
        const tt = document.getElementById('dt-tooltip');
        if (tt) tt.classList.remove('show');
        _dt_ttCurrentTarget = null;
    }

    async function dt_copyById(id) {
        const val = $dt(id).value;
        if (!val || val === 'Invalid') { dt_toast('Nothing to copy.'); return; }
        try {
            await navigator.clipboard.writeText(val);
            dt_toast('Copied: ' + val);
        } catch (e) {
            const el = $dt(id);
            el.removeAttribute('readonly');
            el.select();
            try { document.execCommand('copy'); dt_toast('Copied: ' + val); }
            catch (e2) { dt_toast('Copy failed.'); }
            el.setAttribute('readonly', '');
            try { window.getSelection().removeAllRanges(); } catch (e3) {}
        }
    }

    function dt_applyTheme() {
        const t = dt_state.theme || 'original';
        const val = t === 'original' ? '' : t;
        document.getElementById(DT_PANEL_ID).setAttribute('data-theme', val);
        const tt = document.getElementById('dt-tooltip');
        if (tt) tt.setAttribute('data-theme', val);
    }
    function dt_applyFontScale() {
        document.getElementById(DT_PANEL_ID).setAttribute('data-large-fonts', dt_state.large_fonts ? 'true' : 'false');
    }

    function dt_applyStateToUI() {
        const ids = ['balance', 'win_inc', 'loss_reset', 'bet_div', 'profit_mult', 'buffer', 'n_trials',
                     'opt_balance', 'opt_trials', 'opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'];
        for (const k of ids) if ($dt(k) && dt_state[k] != null) $dt(k).value = dt_state[k];
        if ($dt('theme_select')) $dt('theme_select').value = dt_state.theme || 'original';
        if ($dt('large_fonts')) $dt('large_fonts').checked = !!dt_state.large_fonts;
        if ($dt('keep_prev')) $dt('keep_prev').checked = !!dt_state.keep_prev;
        if ($dt('worker_count')) $dt('worker_count').value = dt_state.worker_count || Math.max(1, Math.min(4, navigator.hardwareConcurrency || 4));
        dt_applyTheme();
        dt_applyFontScale();
        if (Array.isArray(dt_state.results) && dt_state.results.length) {
            dt_optResults = dt_state.results.slice();
            dt_renderResults();
        }
    }

    /* ============================================================
       INIT / EVENT WIRING (manual boot — called from main boot)
       ============================================================ */
    function dt_init() {
        if (document.getElementById(DT_PANEL_ID)) return; // idempotent
        dt_injectUI();
        dt_loadState();
        dt_applyStateToUI();
        dt_calcValues();

        ['balance', 'win_inc', 'loss_reset', 'bet_div', 'profit_mult', 'buffer'].forEach(id => {
            const el = $dt(id);
            if (el) el.addEventListener('input', () => { dt_calcValues(); dt_saveState(); });
        });
        ['n_trials', 'opt_balance', 'opt_trials', 'opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'].forEach(id => {
            const el = $dt(id);
            if (el) el.addEventListener('input', dt_saveState);
        });

        const panelEl = document.getElementById(DT_PANEL_ID);
        panelEl.querySelectorAll('[data-copy]').forEach(b => {
            b.addEventListener('click', () => dt_copyById(b.dataset.copy));
        });

        const tabsNav = panelEl.querySelector('.dt-tabs');
        tabsNav.addEventListener('click', (ev) => {
            const btn = ev.target.closest('.dt-tab-btn');
            if (!btn) return;
            ev.preventDefault();
            dt_switchTab(btn.dataset.tab);
        });

        // Guided rail (step pills) + Optimizer "next" button jump between tabs.
        panelEl.addEventListener('click', (ev) => {
            const step = ev.target.closest('.dt-step');
            if (step && step.dataset.step) { dt_switchTab(DT_STEP_TABS[step.dataset.step]); return; }
            const next = ev.target.closest('.dt-next');
            if (next && !next.disabled && next.dataset.goto) dt_switchTab(next.dataset.goto);
        });
        // Optimizer presets fill the ranges; range edits re-estimate the run size.
        panelEl.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
            panelEl.querySelectorAll('[data-preset]').forEach(x => x.classList.toggle('active', x === b));
            dt_applyOptPreset(b.dataset.preset);
        }));
        ['opt_trials', 'opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'].forEach(id => {
            const el = $dt(id); if (el) el.addEventListener('input', dt_updateOptPreview);
        });

        panelEl.querySelectorAll('.dt-help').forEach(btn => {
            const handle = (ev) => { ev.preventDefault(); ev.stopPropagation(); dt_showTooltip(btn); };
            btn.addEventListener('click', handle);
            btn.addEventListener('touchend', handle, { passive: false });
        });
        panelEl.addEventListener('click', (e) => {
            if (e.target.closest('.dt-help')) return;
            const tt = document.getElementById('dt-tooltip');
            if (tt && tt.classList.contains('show')) dt_hideTooltip();
        });
        const body = panelEl.querySelector('.dt-body');
        if (body) body.addEventListener('scroll', dt_hideTooltip, { passive: true });

        $dt('sim_run').addEventListener('click', dt_startSimulation);
        $dt('sim_stop').addEventListener('click', dt_stopSimulation);
        $dt('opt_run').addEventListener('click', dt_startOptimizer);
        $dt('opt_stop').addEventListener('click', dt_stopOptimizer);
        $dt('opt_clear').addEventListener('click', dt_clearResults);
        $dt('res_apply').addEventListener('click', dt_applySelectedToCalculator);
        $dt('res_csv').addEventListener('click', dt_exportResultsCSV);
        document.getElementById('dt-res_table').addEventListener('click', dt_onResTableClick);
        const _resSafe = $dt('res_safe'); if (_resSafe) _resSafe.addEventListener('change', () => { dt_safeOnly = _resSafe.checked; dt_renderResults(); });
        const _resCols = $dt('res_allcols'); if (_resCols) _resCols.addEventListener('change', () => { dt_showAllCols = _resCols.checked; dt_renderResults(); });

        $dt('keep_prev').addEventListener('change', dt_saveState);
        $dt('worker_count').addEventListener('change', dt_saveState);
        $dt('reset_state').addEventListener('click', () => {
            if (!confirm('Reset all saved data?')) return;
            localStorage.removeItem(DT_STORE_KEY);
            location.reload();
        });

        $dt('game_sync').addEventListener('click', dt_gameSync);
        $dt('game_import').addEventListener('click', dt_gameImport);

        dt_initStreakCounter();
        dt_renderResults();
        dt_updateOptPreview();
        dt_updateStepper();
    }

    /* ============================================================
       ============================================================
       INTEGRATION LAYER — IOW/Smart HUD <-> Dice Tool stitcher.
       Adds the "Advanced IOW" mode tab + Stats + Terms tabs +
       native bet-mode policing + Stats two-way binding.
       Mobile bridge CSS stacks the deck 1-column.
       ============================================================
       ============================================================ */

    function setupIowDiceIntegration() {
        let stitched = false;
        let toolsActive = false;
        let toolsBtn = null;
        let dicePanel = null;
        let hud = null;
        let originalParent = null;
        let lastNonToolsMode = null;
        let baseBetAtStart = null;
        let toolsSyncerStarted = false;
        let modeBtnListenersAttached = false;
        let cond4BalanceTarget = null;
        let statsSetup = false;
        let termsSetup = false;
        let statsSyncing = false;

        const STATS_TRACK_KEY = '__iow_stats_track_per__';

        function isOurInternalEl(el) {
            return !!(
                el.closest('#unified-tools-panel') ||
                el.closest('#unified-tools-toggle') ||
                el.closest('#dt-aio-panel') ||
                el.id === 'dt-aio-button' ||
                (el.id && el.id.startsWith && el.id.startsWith('mode-'))
            );
        }

        function findNativeStakeModeButtons() {
            const result = { manual: null, auto: null, advanced: null };
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

        function isLikelyActive(btn) {
            if (!btn) return false;
            const SEL = '.active, .selected, [aria-selected="true"], [aria-pressed="true"], [data-active="true"], [data-selected="true"], [data-prime-active="true"], [data-state="active"], [data-state="open"]';
            if (btn.matches && btn.matches(SEL)) return true;
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

        function clearAnyOldBlock(btn) {
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

        function enforceNativeMode() {
            const localHud = document.getElementById('ratchet-master-container');
            if (!localHud) return;
            const desired = toolsActive ? 'advanced' : 'manual';
            const wrong = ['manual', 'auto', 'advanced'].filter(m => m !== desired);
            const btns = findNativeStakeModeButtons();
            let wrongIsActive = false;
            for (const m of wrong) {
                if (btns[m] && isLikelyActive(btns[m])) { wrongIsActive = true; break; }
            }
            if (wrongIsActive && btns[desired]) {
                try { btns[desired].click(); } catch (e) {}
            }
            ['manual', 'auto', 'advanced'].forEach(m => clearAnyOldBlock(btns[m]));
        }

        function forceNativeMode(target) {
            const localHud = document.getElementById('ratchet-master-container');
            if (!localHud) return;
            const btns = findNativeStakeModeButtons();
            const btn = btns[target];
            if (!btn) return;
            if (isLikelyActive(btn)) return;
            try { btn.click(); } catch (e) {}
        }

        function isOnDiceUrl() {
            const path = location.pathname || '';
            return /\/(?:casino\/games|games\/originals)\/(?:dice|primedice)(?:\/|$|\?|#)/i.test(path);
        }

        function tryStitch() {
            if (!isOnDiceUrl() || !isCurrentGameEnabled()) {
                if (toolsActive) {
                    try { deactivateTools(); } catch (e) {}
                }
                const orphanBtn = document.getElementById('mode-dice-tools');
                if (orphanBtn) orphanBtn.remove();
                toolsBtn = null;
                stitched = false;
                return false;
            }
            const existingBtn = document.getElementById('mode-dice-tools');
            if (existingBtn) {
                stitched = true;
                if (!toolsBtn || !document.contains(toolsBtn)) toolsBtn = existingBtn;
                return true;
            }
            if (stitched) {
                stitched = false;
                toolsBtn = null;
            }
            hud = document.getElementById('ratchet-master-container');
            const modeWrap = hud && hud.querySelector('.mode-wrap');
            dicePanel = document.getElementById('dt-aio-panel');
            // On mobile we don't create dt-aio-button or dt-backdrop, so don't gate on them.
            if (!modeWrap || !dicePanel) return false;

            stitched = true;
            originalParent = dicePanel.parentNode || document.body;

            // Theme-aware tokens. The HUD's `.shuffle-theme` class overrides
            // --hud-bg, --hud-green, --hud-green-dark, --hud-panel, --hud-border,
            // --hud-border-soft on #ratchet-master-container. Because #dt-aio-panel
            // is a descendant when stitched into #hud-content, these variables
            // cascade in — so referencing them via var() makes the Advanced IOW
            // accents (tab pills, Update Strategy button, focus rings, W/L counter)
            // automatically swap to purple on Shuffle and stay green on Stake.
            const HUD_BG = 'var(--hud-bg, #0f212e)';
            const HUD_PANEL_GRADIENT = 'var(--hud-panel, linear-gradient(180deg, rgba(26, 44, 56, 0.98), rgba(15, 33, 46, 0.96)))';
            const HUD_GREEN = 'var(--hud-green, #00ff9d)';
            const HUD_GREEN_DK = 'var(--hud-green-dark, #00cc7a)';
            const HUD_BORDER_X = 'var(--hud-border-soft, rgba(255, 255, 255, 0.06))';
            // Always-literal tokens — these don't have theme variants in the HUD CSS.
            const HUD_FG = '#f5fbff';
            const HUD_LABEL = '#94a3b8';
            const HUD_RED = '#e11d48';
            const HUD_FIELD_BG = '#0b0e17';
            const HUD_FIELD_BORDER = '#2f4553';
            const HUD_TAB_WRAP_BG = '#13232d';

            // Mobile bridge CSS — re-skins every .dt-* element so the Dice Tool's
            // Calculator / Optimizer / Results / Settings / Terms tabs match the
            // Manual / IOW / Smart HUD aesthetic (navy + neon green + uppercase
            // sans + monospace values). The Stats tab uses .hud-* classes
            // directly, so it inherits the HUD CSS already loaded above.
            const bridgeCss = document.createElement('style');
            bridgeCss.id = 'dt-iow-bridge-css';
            bridgeCss.textContent = [
                /* ============================================================
                   PANEL CONTAINER — fill the HUD content slot, full reset
                   ============================================================ */
                '#hud-content > #dt-aio-panel {',
                '  position: static !important;',
                '  inset: auto !important;',
                '  top: auto !important; right: auto !important; bottom: auto !important; left: auto !important;',
                '  width: 100% !important; height: 100% !important;',
                '  max-width: none !important; max-height: none !important;',
                '  margin: 0 !important; padding: 0 !important;',
                '  border: none !important;',
                '  border-radius: 0 !important;',
                '  box-shadow: none !important;',
                '  transform: none !important;',
                '  opacity: 1 !important;',
                '  pointer-events: auto !important;',
                '  visibility: visible !important;',
                '  z-index: auto !important;',
                '  display: flex !important;',
                '  flex-direction: column;',
                '  gap: 6px;',
                '  background: transparent !important;',
                '  color: ' + HUD_FG + ' !important;',
                '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;',
                '  font-size: 12px !important;',
                '  line-height: 1.35 !important;',
                '  -webkit-user-select: none;',
                '  user-select: none;',
                '}',
                '#hud-content > #dt-aio-panel * { box-sizing: border-box !important; }',
                '#hud-content > #dt-aio-panel .dt-head { display: none !important; }',

                /* ============================================================
                   TAB STRIP — matches .mode-wrap (pill row with dark wrap)
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-tabs {',
                '  display: flex !important;',
                '  flex: 0 0 auto !important;',
                '  gap: 4px !important;',
                '  background: ' + HUD_TAB_WRAP_BG + ' !important;',
                '  padding: 4px !important;',
                '  border: none !important;',
                '  border-radius: 10px !important;',
                '  overflow-x: auto !important;',
                '  overflow-y: hidden !important;',
                '  flex-wrap: nowrap !important;',
                '  -webkit-overflow-scrolling: touch;',
                '  scrollbar-width: none;',
                '}',
                '#hud-content > #dt-aio-panel .dt-tabs::-webkit-scrollbar { display: none; }',
                '#hud-content > #dt-aio-panel .dt-tab-btn {',
                '  flex: 0 0 auto !important;',
                '  padding: 8px 12px !important;',
                '  background: #2f4553 !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  border: none !important;',
                '  border-bottom: none !important;',
                '  border-radius: 999px !important;',
                '  font-family: inherit !important;',
                '  font-size: 11px !important;',
                '  font-weight: 900 !important;',
                '  text-transform: uppercase !important;',
                '  letter-spacing: 0.3px !important;',
                '  white-space: nowrap !important;',
                '  display: flex !important;',
                '  align-items: center;',
                '  justify-content: center;',
                '  gap: 5px;',
                '  cursor: pointer;',
                '  transition: filter 0.15s, background 0.15s, color 0.15s;',
                '  -webkit-tap-highlight-color: transparent;',
                '  touch-action: manipulation;',
                '}',
                '#hud-content > #dt-aio-panel .dt-tab-btn .dt-tab-icon { font-size: 0.95em !important; line-height: 1; }',
                '#hud-content > #dt-aio-panel .dt-tab-btn.active {',
                '  background: ' + HUD_GREEN + ' !important;',
                '  color: ' + HUD_BG + ' !important;',
                '  box-shadow: 0 0 10px ' + HUD_GREEN + ' !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-tab-btn:active { filter: brightness(1.1); }',

                /* ============================================================
                   BODY — scrollable content host
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-body {',
                '  flex: 1 1 auto !important;',
                '  min-height: 0 !important;',
                '  display: flex !important;',
                '  flex-direction: column !important;',
                '  overflow-y: auto !important;',
                '  overflow-x: hidden !important;',
                '  -webkit-overflow-scrolling: touch;',
                '  padding: 0 !important;',
                '  scrollbar-width: thin;',
                '}',
                '#hud-content > #dt-aio-panel .dt-body::-webkit-scrollbar { width: 4px; }',
                '#hud-content > #dt-aio-panel .dt-body::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 2px; }',

                /* ============================================================
                   PANELS — Calculator / Optimizer / Results / Settings / Terms
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-panel {',
                '  padding: 6px !important;',
                '  display: none;',
                '  animation: none !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-panel.active {',
                '  display: flex !important;',
                '  flex-direction: column !important;',
                '  gap: 6px !important;',
                '}',

                /* ============================================================
                   CARDS — match .hud-panel (no notched floating title)
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-card {',
                '  background: ' + HUD_PANEL_GRADIENT + ' !important;',
                '  border: 1px solid ' + HUD_BORDER_X + ' !important;',
                '  border-radius: 10px !important;',
                '  padding: 8px !important;',
                '  margin: 0 !important;',
                '  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03) !important;',
                '  position: static !important;',
                '  display: flex;',
                '  flex-direction: column;',
                '  gap: 6px;',
                '}',
                '#hud-content > #dt-aio-panel .dt-card-title {',
                '  position: static !important;',
                '  top: auto !important; left: auto !important;',
                '  background: transparent !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  padding: 0 0 2px 2px !important;',
                '  font-family: inherit !important;',
                '  font-style: normal !important;',
                '  font-weight: 800 !important;',
                '  font-size: 10px !important;',
                '  text-decoration: none !important;',
                '  text-transform: uppercase !important;',
                '  letter-spacing: 0.4px !important;',
                '  margin: 0 !important;',
                '}',

                /* ============================================================
                   FIELDS — label/value rows in subtle "chip" containers
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-field {',
                '  display: flex !important;',
                '  align-items: center !important;',
                '  margin: 0 !important;',
                '  gap: 6px !important;',
                '  padding: 5px 6px !important;',
                '  background: rgba(255, 255, 255, 0.04) !important;',
                '  border-radius: 6px !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-field .dt-label,',
                '#hud-content > #dt-aio-panel .dt-field label {',
                '  flex: 1 !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  font-weight: 700 !important;',
                '  font-size: 10px !important;',
                '  text-transform: uppercase !important;',
                '  letter-spacing: 0.2px !important;',
                '  font-family: inherit !important;',
                '  display: flex !important;',
                '  align-items: center;',
                '  gap: 6px;',
                '}',
                '#hud-content > #dt-aio-panel .dt-field-wide {',
                '  flex-direction: column !important;',
                '  align-items: stretch !important;',
                '  gap: 4px !important;',
                '  padding: 6px !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-field-wide .dt-label,',
                '#hud-content > #dt-aio-panel .dt-field-wide label { flex: 0 0 auto !important; }',
                '#hud-content > #dt-aio-panel .dt-field-wide input { width: 100% !important; text-align: left !important; }',

                /* ============================================================
                   INPUTS — match HUD input style
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-field input[type="text"],',
                '#hud-content > #dt-aio-panel .dt-field input[type="number"],',
                '#hud-content > #dt-aio-panel input.dt-text-input,',
                '#hud-content > #dt-aio-panel input.dt-num-input {',
                '  background: ' + HUD_FIELD_BG + ' !important;',
                '  border: 1px solid ' + HUD_FIELD_BORDER + ' !important;',
                '  color: #fff !important;',
                '  padding: 6px 8px !important;',
                '  border-radius: 6px !important;',
                '  font-size: 11px !important;',
                '  font-weight: 700 !important;',
                '  font-family: "Roboto Mono", monospace !important;',
                '  text-align: right !important;',
                '  outline: none !important;',
                '  -webkit-appearance: none !important;',
                '  appearance: none !important;',
                '  min-height: 30px !important;',
                '  min-width: 80px !important;',
                '  width: 100px !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-field input:focus,',
                '#hud-content > #dt-aio-panel input.dt-text-input:focus,',
                '#hud-content > #dt-aio-panel input.dt-num-input:focus {',
                '  border-color: ' + HUD_GREEN + ' !important;',
                '  box-shadow: 0 0 0 2px color-mix(in srgb, ' + HUD_GREEN + ' 15%, transparent) !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-field input[readonly] {',
                '  opacity: 1 !important;',
                '  color: ' + HUD_GREEN + ' !important;',
                '  font-weight: 800 !important;',
                '}',
                '#hud-content > #dt-aio-panel input.dt-num-input { width: 64px !important; text-align: center !important; }',
                '#hud-content > #dt-aio-panel .dt-hint {',
                '  font-size: 10px !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  opacity: 0.7 !important;',
                '  font-style: normal !important;',
                '  margin: 0 0 0 2px !important;',
                '}',

                /* ============================================================
                   SELECTS — match HUD select
                   ============================================================ */
                '#hud-content > #dt-aio-panel select,',
                '#hud-content > #dt-aio-panel select.dt-theme-select {',
                '  background: ' + HUD_FIELD_BG + ' !important;',
                '  border: 1px solid ' + HUD_FIELD_BORDER + ' !important;',
                '  color: #fff !important;',
                '  padding: 6px 8px !important;',
                '  border-radius: 6px !important;',
                '  font-family: inherit !important;',
                '  font-size: 11px !important;',
                '  font-weight: 700 !important;',
                '  outline: none !important;',
                '  -webkit-appearance: none !important;',
                '  appearance: none !important;',
                '  min-height: 30px !important;',
                '}',

                /* ============================================================
                   HELP "?" — small green outline circle
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-help {',
                '  width: 16px !important;',
                '  height: 16px !important;',
                '  border: 1px solid ' + HUD_GREEN + ' !important;',
                '  border-radius: 50% !important;',
                '  font-size: 10px !important;',
                '  font-weight: 900 !important;',
                '  color: ' + HUD_GREEN + ' !important;',
                '  background: transparent !important;',
                '  display: inline-flex !important;',
                '  align-items: center;',
                '  justify-content: center;',
                '  padding: 0 !important;',
                '  line-height: 1 !important;',
                '  flex-shrink: 0;',
                '  -webkit-appearance: none;',
                '  appearance: none;',
                '  touch-action: manipulation;',
                '  cursor: help;',
                '}',
                '#hud-content > #dt-aio-panel .dt-help:active {',
                '  background: ' + HUD_GREEN + ' !important;',
                '  color: ' + HUD_BG + ' !important;',
                '}',

                /* ============================================================
                   BUTTONS — match HUD button language
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-btn {',
                '  padding: 8px 10px !important;',
                '  min-height: 36px !important;',
                '  background: #1a2c38 !important;',
                '  color: #fff !important;',
                '  border: 1px solid ' + HUD_FIELD_BORDER + ' !important;',
                '  border-radius: 6px !important;',
                '  font-size: 11px !important;',
                '  font-weight: 900 !important;',
                '  cursor: pointer;',
                '  font-family: inherit !important;',
                '  text-transform: uppercase !important;',
                '  letter-spacing: 0.3px !important;',
                '  -webkit-user-select: none;',
                '  user-select: none;',
                '  touch-action: manipulation;',
                '  -webkit-tap-highlight-color: transparent;',
                '  line-height: 1.1 !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-btn:active { background: #2f4553 !important; transform: scale(0.985); }',
                '#hud-content > #dt-aio-panel .dt-btn:disabled { opacity: 0.45 !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-primary {',
                '  background: ' + HUD_GREEN + ' !important;',
                '  color: ' + HUD_BG + ' !important;',
                '  border: none !important;',
                '  box-shadow: 0 0 10px color-mix(in srgb, ' + HUD_GREEN + ' 25%, transparent);',
                '}',
                '#hud-content > #dt-aio-panel .dt-btn-primary:active { background: ' + HUD_GREEN_DK + ' !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-danger {',
                '  background: transparent !important;',
                '  color: ' + HUD_RED + ' !important;',
                '  border: 1px solid ' + HUD_RED + ' !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-btn-danger:active { background: ' + HUD_RED + ' !important; color: #fff !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-row { display: flex !important; gap: 6px !important; margin-top: 4px !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-row .dt-btn { flex: 1 1 0; }',
                '#hud-content > #dt-aio-panel .dt-btn-block { display: block !important; width: 100% !important; margin-top: 4px !important; }',
                '#hud-content > #dt-aio-panel .dt-btn-small { padding: 4px 8px !important; min-height: 26px !important; font-size: 10px !important; min-width: 0 !important; }',

                /* ============================================================
                   PROGRESS BAR
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-progress-wrap {',
                '  margin: 4px 0 !important;',
                '  background: ' + HUD_FIELD_BG + ' !important;',
                '  border-radius: 6px !important;',
                '  overflow: hidden;',
                '  height: 8px !important;',
                '  border: 1px solid ' + HUD_FIELD_BORDER + ' !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-progress-bar {',
                '  height: 100%;',
                '  width: 0%;',
                '  background: ' + HUD_GREEN + ' !important;',
                '  box-shadow: 0 0 6px color-mix(in srgb, ' + HUD_GREEN + ' 60%, transparent);',
                '  transition: width 0.2s ease;',
                '}',
                '#hud-content > #dt-aio-panel .dt-status-line {',
                '  text-align: center !important;',
                '  font-size: 10px !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  margin: 4px 0 !important;',
                '  min-height: 1.2em;',
                '  font-family: "Roboto Mono", monospace !important;',
                '  opacity: 1 !important;',
                '}',

                /* ============================================================
                   TABLES — Optimizer results + Simulation stats
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-scroll {',
                '  overflow-x: auto !important;',
                '  overflow-y: auto !important;',
                '  -webkit-overflow-scrolling: touch;',
                '  border: 1px solid ' + HUD_BORDER_X + ' !important;',
                '  border-radius: 8px !important;',
                '  background: ' + HUD_FIELD_BG + ' !important;',
                '  max-height: 45vh !important;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-results,',
                '#hud-content > #dt-aio-panel table.dt-stats {',
                '  width: 100% !important;',
                '  border-collapse: collapse !important;',
                '  font-size: 10px !important;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-results th,',
                '#hud-content > #dt-aio-panel table.dt-results td {',
                '  padding: 5px 6px !important;',
                '  border-bottom: 1px solid ' + HUD_BORDER_X + ' !important;',
                '  white-space: nowrap;',
                '  text-align: center;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-results th {',
                '  background: ' + HUD_TAB_WRAP_BG + ' !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  font-weight: 800 !important;',
                '  text-transform: uppercase !important;',
                '  letter-spacing: 0.3px !important;',
                '  position: sticky;',
                '  top: 0;',
                '  cursor: pointer;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-results td {',
                '  color: #fff;',
                '  font-family: "Roboto Mono", monospace !important;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-results tr:nth-child(even) td { background: rgba(255, 255, 255, 0.02); }',
                '#hud-content > #dt-aio-panel table.dt-results tr:nth-child(odd) td { background: transparent; }',
                '#hud-content > #dt-aio-panel table.dt-results tr.selected td {',
                '  background: color-mix(in srgb, ' + HUD_GREEN + ' 15%, transparent) !important;',
                '  color: ' + HUD_GREEN + ' !important;',
                '  font-weight: 800;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-stats { width: 100%; }',
                '#hud-content > #dt-aio-panel table.dt-stats td {',
                '  padding: 7px 10px !important;',
                '  border-bottom: 1px solid ' + HUD_BORDER_X + ' !important;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-stats td:first-child {',
                '  color: ' + HUD_LABEL + ' !important;',
                '  font-weight: 700 !important;',
                '  width: 55%;',
                '  text-transform: uppercase;',
                '  letter-spacing: 0.3px;',
                '  font-size: 9px !important;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-stats td:last-child {',
                '  text-align: right !important;',
                '  color: #fff;',
                '  font-family: "Roboto Mono", monospace !important;',
                '  font-weight: 800 !important;',
                '  font-size: 11px !important;',
                '}',
                '#hud-content > #dt-aio-panel table.dt-stats tr:last-child td { border-bottom: none !important; }',

                /* ============================================================
                   SETTINGS ROWS
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-setting-row {',
                '  display: flex !important;',
                '  align-items: center !important;',
                '  justify-content: space-between !important;',
                '  padding: 8px 6px !important;',
                '  border-bottom: 1px solid ' + HUD_BORDER_X + ' !important;',
                '  gap: 10px !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-setting-row:last-child { border-bottom: none !important; }',
                '#hud-content > #dt-aio-panel .dt-setting-label {',
                '  color: ' + HUD_LABEL + ' !important;',
                '  font-weight: 700 !important;',
                '  text-transform: uppercase !important;',
                '  letter-spacing: 0.3px !important;',
                '  font-size: 10px !important;',
                '}',
                '#hud-content > #dt-aio-panel .dt-setting-desc {',
                '  font-size: 9px !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  opacity: 0.6 !important;',
                '  margin-top: 2px;',
                '  font-style: normal !important;',
                '  text-transform: none;',
                '  letter-spacing: 0;',
                '  line-height: 1.3;',
                '}',

                /* ============================================================
                   SWITCH — recolor accent to HUD green
                   ============================================================ */
                '#hud-content > #dt-aio-panel .dt-switch { transform: scale(0.85); transform-origin: right center; }',
                '#hud-content > #dt-aio-panel .dt-switch .dt-slider { background: #2f4553 !important; }',
                '#hud-content > #dt-aio-panel .dt-switch input:checked + .dt-slider {',
                '  background: ' + HUD_GREEN + ' !important;',
                '  box-shadow: 0 0 6px color-mix(in srgb, ' + HUD_GREEN + ' 50%, transparent);',
                '}',

                /* ============================================================
                   HIDE marker + mode-wrap visual lock
                   ============================================================ */
                '#dt-aio-panel.dt-bridge-hidden { display: none !important; }',
                '#ratchet-master-container[data-tools-active="1"] #mode-manual,',
                '#ratchet-master-container[data-tools-active="1"] #mode-iow,',
                '#ratchet-master-container[data-tools-active="1"] #mode-smart {',
                '  background: #2f4553 !important;',
                '  color: ' + HUD_LABEL + ' !important;',
                '  box-shadow: none !important;',
                '}',
                '#ratchet-master-container[data-tools-active="1"] #mode-dice-tools {',
                '  background: ' + HUD_GREEN + ' !important;',
                '  color: ' + HUD_BG + ' !important;',
                '  box-shadow: 0 0 10px ' + HUD_GREEN + ' !important;',
                '}',

                /* ============================================================
                   THEME-AWARE INK ON ACCENTS — Stake's --hud-bg is dark navy
                   (#0f212e) so text on green pills is readable by default.
                   Shuffle's --hud-bg is dark purple (rgba(10,8,24,0.97)),
                   which gives purple-on-purple. Flip to white, matching the
                   existing `.shuffle-theme .mode-btn.active` rule in the HUD.
                   ============================================================ */
                '#ratchet-master-container.shuffle-theme #hud-content > #dt-aio-panel .dt-tab-btn.active,',
                '#ratchet-master-container.shuffle-theme #hud-content > #dt-aio-panel .dt-btn-primary,',
                '#ratchet-master-container.shuffle-theme #hud-content > #dt-aio-panel .dt-help:active,',
                '#ratchet-master-container.shuffle-theme[data-tools-active="1"] #mode-dice-tools,',
                '#ratchet-master-container.shuffle-theme #dt-panel-stats .hud-update-btn,',
                '#ratchet-master-container.shuffle-theme #dt-panel-stats .hud-rapid-btn.start {',
                '  color: #fff !important;',
                '}',
                /* Stats tab — uses .hud-* classes which the mobile HUD CSS already styles. */
                '#hud-content > #dt-aio-panel .dt-body { display: flex !important; flex-direction: column !important; }',
                '#dt-panel-stats { padding: 8px !important; flex-direction: column !important; gap: 8px !important; }',
                '#dt-panel-stats.active { display: flex !important; flex: 1 1 auto !important; min-height: 0 !important; }',
                '#dt-panel-stats * { box-sizing: border-box; }',
                '#dt-panel-stats > .hud-shell { display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; min-height: 0 !important; height: auto !important; gap: 6px; }',
                /* Mobile: 1-column deck, compact to match the main HUD */
                '#dt-panel-stats .hud-controls-deck { grid-template-columns: 1fr !important; padding: 6px !important; gap: 4px !important; flex: 0 0 auto !important; }',
                '#dt-panel-stats .hud-control-group input[type="number"] { width: 100% !important; }',
                '#dt-panel-stats .hud-control-group { gap: 1px !important; }',
                '#dt-panel-stats .hud-control-group label { font-size: 9px !important; font-weight: 600 !important; text-transform: none !important; letter-spacing: 0.1px !important; color: #8c9bb0 !important; }',
                '#dt-panel-stats .hud-controls-deck input[type="number"], #dt-panel-stats .hud-controls-deck select { min-height: 26px !important; padding: 3px 6px !important; }',
                /* Simple fields go label-beside-input; volume keeps slider full width below its label */
                '#dt-panel-stats .hud-control-group:not(.hud-volume-group) { flex-direction: row !important; align-items: center !important; gap: 8px !important; }',
                '#dt-panel-stats .hud-control-group:not(.hud-volume-group) > label { flex: 0 0 auto !important; }',
                '#dt-panel-stats .hud-control-group:not(.hud-volume-group) > input[type="number"], #dt-panel-stats .hud-control-group:not(.hud-volume-group) > select { flex: 1 1 0 !important; width: auto !important; min-width: 0 !important; }',
                '#dt-panel-stats .hud-control-group:not(.hud-volume-group) > .hud-autostop-row { flex: 1 1 0 !important; justify-content: flex-end !important; }',
                /* W/L streak counter — compact header atop the stats panel.
                   flex:0 0 auto + overflow:visible override the .hud-stats
                   .hud-meta-chip rule (flex:1 1 0, overflow:hidden) which is
                   meant for the side-by-side Best/Worst chips and would
                   otherwise collapse this column-child to ~6px and clip it. */
                '#dt-panel-stats .hud-counter-chip { flex: 0 0 auto !important; overflow: visible !important; flex-direction: column !important; gap: 1px !important; align-items: center !important; padding: 0 0 5px !important; margin-bottom: 5px !important; background: none !important; border: none !important; border-bottom: 1px solid var(--hud-line) !important; border-radius: 0 !important; }',
                '#dt-panel-stats .hud-counter-row { display: flex !important; gap: 18px !important; justify-content: center !important; }',
                '#dt-panel-stats .hud-counter-row span { font-size: 9px !important; color: #94a3b8 !important; text-transform: uppercase !important; font-weight: 700 !important; min-width: 22px !important; text-align: center !important; }',
                '#dt-panel-stats .hud-counter-vals { display: flex !important; gap: 18px !important; align-items: center !important; justify-content: center !important; }',
                '#dt-panel-stats .hud-counter-slot { display: inline-flex !important; align-items: center !important; justify-content: center !important; min-width: 22px !important; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_w,',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l {',
                '  display: inline !important;',
                '  font-size: 18px !important; font-weight: 800 !important;',
                '  font-family: "Roboto Mono", monospace !important;',
                '  min-width: 26px !important; text-align: center !important;',
                '  background: transparent !important; padding: 0 !important;',
                '  border: none !important; box-shadow: none !important;',
                '  line-height: 1 !important;',
                '  transition: transform 0.18s ease, color 0.18s ease;',
                '}',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_w { color: ' + HUD_GREEN + ' !important; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l { color: #94a3b8 !important; }',
                '#dt-panel-stats .hud-counter-slot > #dt-ctr_l.has-loss { color: ' + HUD_RED + ' !important; }',
                /* Autostop row */
                '#dt-panel-stats .hud-autostop-row { display: flex !important; align-items: center !important; gap: 6px !important; }',
                '#dt-panel-stats .hud-autostop-row input[type="checkbox"] {',
                '  appearance: auto !important; -webkit-appearance: auto !important;',
                '  width: 18px !important; height: 18px !important;',
                '  margin: 0 !important; padding: 0 !important;',
                '  position: static !important;',
                '  opacity: 1 !important; visibility: visible !important;',
                '  pointer-events: auto !important;',
                '  accent-color: ' + HUD_GREEN + ';',
                '  cursor: pointer; flex: 0 0 auto !important;',
                '}',
                '#dt-panel-stats .hud-autostop-row input[type="number"] { width: 80px !important; flex: 0 0 80px !important; text-align: center; }',
                /* Volume slider — full width on mobile */
                '#dt-panel-stats .hud-volume-group label { display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 6px !important; }',
                '#dt-panel-stats .hud-volume-group label > span:last-child { color: ' + HUD_GREEN + '; font-family: "Roboto Mono", monospace; font-weight: 800; }',
                '#dt-panel-stats .hud-volume-group input[type="range"] { width: 100% !important; accent-color: ' + HUD_GREEN + '; cursor: pointer; }',
                /* Stats grid — two columns, airy column gap (dense hairline rows come from .hud-stats) */
                '#dt-panel-stats .hud-stats-grid { grid-template-columns: 1fr 1fr !important; gap: 0 14px !important; }',
                '#dt-panel-stats .hud-stats { flex: 0 0 auto !important; }',
                /* Action buttons — grid-template-columns 1fr 1fr like the existing mobile .btn-group */
                '#dt-panel-stats .btn-group { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 6px !important; grid-column: 1 / -1 !important; }',
                '#dt-panel-stats .hud-update-btn,',
                '#dt-panel-stats .hud-switch-btn,',
                '#dt-panel-stats .hud-reset-btn,',
                '#dt-panel-stats .hud-rapid-btn {',
                '  min-height: 40px; border-radius: 8px; cursor: pointer;',
                '  font-weight: 900; font-size: 11px; text-transform: uppercase;',
                '  letter-spacing: 0.3px; padding: 8px 6px; line-height: 1.1;',
                '  -webkit-tap-highlight-color: transparent;',
                '  touch-action: manipulation;',
                '}',
                '#dt-panel-stats .hud-update-btn { border: none; background: ' + HUD_GREEN + '; color: ' + HUD_BG + '; box-shadow: 0 0 10px ' + HUD_GREEN + '; }',
                '#dt-panel-stats .hud-update-btn:active { background: ' + HUD_GREEN_DK + '; }',
                '#dt-panel-stats .hud-switch-btn { background: transparent; border: 1px solid #06b6d4; color: #06b6d4; }',
                '#dt-panel-stats .hud-switch-btn:active { background: #06b6d4; color: ' + HUD_BG + '; }',
                '#dt-panel-stats .hud-switch-btn:disabled { opacity: 0.5; cursor: not-allowed; }',
                '#dt-panel-stats .hud-reset-btn { background: transparent; border: 1px solid ' + HUD_RED + '; color: ' + HUD_RED + '; }',
                '#dt-panel-stats .hud-reset-btn:active { background: ' + HUD_RED + '; color: #fff; }',
                '#dt-panel-stats .hud-rapid-btn { border: none; color: #fff; }',
                '#dt-panel-stats .hud-rapid-btn.start { background: ' + HUD_GREEN + '; color: ' + HUD_BG + '; }',
                '#dt-panel-stats .hud-rapid-btn.start:active { background: ' + HUD_GREEN_DK + '; }',
                '#dt-panel-stats .hud-rapid-btn.stop { background: ' + HUD_RED + '; }',
                '#dt-panel-stats .hud-rapid-btn.stop:active { background: #be123c; }',
                /* Graph box — flex-absorber that fills leftover height (matches main HUD) */
                '#dt-panel-stats > .hud-shell > .hud-graph-box { flex: 1 1 0 !important; min-height: 40px !important; height: auto !important; }',
                /* Pinned action bar — buttons stay reachable while the body scrolls */
                '#dt-panel-stats .dt-action-bar { position: sticky; bottom: 0; z-index: 3; display: flex; gap: 6px; flex: 0 0 auto; align-items: stretch; padding-top: 6px; margin-top: 1px; background: var(--hud-bg); }',
                '#dt-panel-stats .dt-action-bar .hud-update-btn { flex: 1.4 1 0; }',
                '#dt-panel-stats .dt-action-bar .hud-switch-btn, #dt-panel-stats .dt-action-bar .hud-reset-btn { flex: 1 1 0; }',
                '#dt-panel-stats .dt-action-bar .hud-rapid-btn { flex: 1.4 1 0; }',
                '#dt-panel-stats .dt-action-bar button { min-height: 36px !important; }',
                /* Terms tab */
                '#dt-panel-terms.active { display: flex !important; flex-direction: column; flex: 1 1 auto; min-height: 0; padding: 8px !important; }',
                '#dt-panel-terms .dt-terms-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px; background: ' + HUD_PANEL_GRADIENT + '; border: 1px solid ' + HUD_BORDER_X + '; border-radius: 10px; color: ' + HUD_FG + '; font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.5; font-size: 11px; -webkit-overflow-scrolling: touch; }',
                '#dt-panel-terms .dt-terms-heading { color: var(--hud-green); font-size: 13px; font-weight: 800; letter-spacing: 0.4px; margin: 10px 0 4px; padding-bottom: 4px; border-bottom: 1px solid var(--hud-line); }',
                '#dt-panel-terms .dt-terms-heading:first-child { margin-top: 0; }',
                '#dt-panel-terms .dt-terms-subheading { color: var(--hud-green); font-size: 11px; font-weight: 700; margin: 7px 0 3px; }',
                '#dt-panel-terms .dt-terms-row { margin: 3px 0; padding: 0; }',
                '#dt-panel-terms .dt-terms-label { color: var(--hud-green); font-weight: 700; }',
                '#dt-panel-terms .dt-terms-dash { color: ' + HUD_LABEL + '; }',
                '#dt-panel-terms .dt-terms-def { color: ' + HUD_FG + '; }',
                '#dt-panel-terms .dt-terms-text { margin: 3px 0; color: ' + HUD_FG + '; }',
                '#dt-panel-terms .dt-terms-spacer { height: 5px; }'
            ].join('\n');
            if (!document.getElementById('dt-iow-bridge-css')) {
                document.head.appendChild(bridgeCss);
            }

            dicePanel.classList.add('dt-bridge-hidden');

            // Drop the pre-stitch hider once the bridge CSS is in place.
            const preStitchEl = document.getElementById('dt-pre-stitch-css');
            if (preStitchEl) preStitchEl.remove();

            toolsBtn = document.createElement('button');
            toolsBtn.id = 'mode-dice-tools';
            toolsBtn.className = 'mode-btn';
            toolsBtn.textContent = 'Advanced IOW';
            toolsBtn.title = 'Advanced IOW (Calculator / Optimizer / Results / Settings)';
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

            if (!toolsSyncerStarted) {
                setInterval(() => {
                    if (!toolsBtn) return;
                    if (toolsActive) {
                        if (!toolsBtn.classList.contains('active')) toolsBtn.classList.add('active');
                        ['mode-manual', 'mode-iow', 'mode-smart'].forEach(id => {
                            const b = document.getElementById(id);
                            if (b && b.classList.contains('active')) b.classList.remove('active');
                        });
                    } else {
                        if (toolsBtn.classList.contains('active')) toolsBtn.classList.remove('active');
                    }
                }, 200);
                toolsSyncerStarted = true;
            }

            trySetupStatsTab();
            trySetupTermsTab();
            return true;
        }

        function trySetupStatsTab() {
            if (statsSetup) return true;
            const panel = document.getElementById('dt-aio-panel');
            if (!panel) return false;
            const tabsNav = panel.querySelector('.dt-tabs');
            const body = panel.querySelector('.dt-body');
            if (!tabsNav || !body) return false;
            if (panel.querySelector('#dt-panel-stats')) { statsSetup = true; return true; }

            const statsBtn = document.createElement('button');
            statsBtn.className = 'dt-tab-btn';
            statsBtn.dataset.tab = 'stats';
            statsBtn.innerHTML = '<span class="dt-tab-icon">📈</span>Stats';
            const calcBtn = tabsNav.querySelector('[data-tab="calc"]');
            if (calcBtn) tabsNav.insertBefore(statsBtn, calcBtn);
            else tabsNav.insertBefore(statsBtn, tabsNav.firstChild);

            const statsPanel = document.createElement('section');
            statsPanel.className = 'dt-panel';
            statsPanel.id = 'dt-panel-stats';
            statsPanel.innerHTML =
                '<div class="hud-shell">' +
                  '<div class="hud-stats hud-panel">' +
                    '<div class="hud-meta-chip hud-counter-chip">' +
                      '<div class="hud-counter-row"><span>Wins</span><span>Losses</span></div>' +
                      '<div class="hud-counter-vals">' +
                        '<span class="hud-counter-slot" data-counter-slot="w"></span>' +
                        '<span class="hud-counter-slot" data-counter-slot="l"></span>' +
                      '</div>' +
                    '</div>' +
                    '<div class="hud-stats-grid">' +
                      '<div class="stats-col-inner">' +
                        '<div class="hud-row" data-stat="startingBalance"><span class="hud-label">Start Bal</span><span class="hud-val">0.00</span></div>' +
                        '<div class="hud-row" data-stat="profit"><span class="hud-label">Profit/Loss</span><span class="hud-val">0.00</span></div>' +
                        '<div class="hud-row" data-stat="sessionPeak"><span class="hud-label">Peak Bal</span><span class="hud-val" style="color:#00ff9d;">0.00</span></div>' +
                        '<div class="hud-row" data-stat="peakProfit"><span class="hud-label">Peak Profit</span><span class="hud-val" style="color:#00ff9d;">0.00</span></div>' +
                        '<div class="hud-row" data-stat="totalBets"><span class="hud-label">Total Bets</span><span class="hud-val">0</span></div>' +
                        '<div class="hud-row" data-stat="totalWagered"><span class="hud-label">Wagered</span><span class="hud-val">0.00</span></div>' +
                      '</div>' +
                      '<div class="stats-col-inner">' +
                        '<div class="hud-row" data-stat="winsLosses"><span class="hud-label">Wins / Losses</span><span class="hud-val">0 / 0</span></div>' +
                        '<div class="hud-row" data-stat="rtp"><span class="hud-label">Session RTP</span><span class="hud-val">100.00%</span></div>' +
                        '<div class="hud-row" data-stat="streaks"><span class="hud-label">Streak (W|L)</span><span class="hud-val">0/0 | 0/0</span></div>' +
                        '<div class="hud-row" data-stat="multPerf"><span class="hud-label">Mult Perf</span><span class="hud-val">1 in 0.00</span></div>' +
                        '<div class="hud-row"><span class="hud-label">Balance Target</span><span class="hud-val" id="dt-stats-bal-target">0.00</span></div>' +
                        '<div class="hud-row"><span class="hud-label">Profit Stop</span><span class="hud-val" id="dt-stats-profit-stop">0.00</span></div>' +
                      '</div>' +
                    '</div>' +
                    '<div class="hud-meta-row">' +
                      '<div class="hud-meta-chip"><span class="hud-label">Best</span><span class="hud-val" data-stat="bestStreaks" style="color:#00ff9d;">-</span></div>' +
                      '<div class="hud-meta-chip"><span class="hud-label">Worst</span><span class="hud-val" data-stat="worstStreaks" style="color:#f87171;">-</span></div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="hud-graph-box"><canvas id="dt-stats-graph"></canvas></div>' +
                  '<div class="hud-controls-deck hud-panel">' +
                    '<div class="hud-control-group"><label>Balance Divisor</label><input id="dt-stats-bet-div" type="number" inputmode="decimal" step="any"></div>' +
                    '<div class="hud-control-group"><label>Profit Multiplier</label><input id="dt-stats-profit-mult" type="number" inputmode="decimal" step="any"></div>' +
                    '<div class="hud-control-group"><label>Autostop @ Win Streak</label><div class="hud-autostop-row"><input type="checkbox" id="dt-stats-autostop"><input type="number" min="0" id="dt-stats-target" value="10"></div></div>' +
                    '<div class="hud-control-group"><label>Stats Track Per</label><select id="dt-stats-track-per"><option value="session" selected>Session</option><option value="cycle">Cycle</option></select></div>' +
                    '<div class="hud-control-group hud-volume-group"><label><span>🔊 Volume</span><span id="dt-stats-volume-val">100</span></label><input type="range" id="dt-stats-volume" min="0" max="100" value="100"></div>' +
                  '</div>' +
                  '<div class="dt-action-bar">' +
                    '<button class="hud-update-btn" id="dt-stats-update">Update Strategy</button>' +
                    '<button id="dt-stats-switch-ou" class="hud-switch-btn">Switch O/U</button>' +
                    '<button id="dt-stats-reset" class="hud-reset-btn">RESET</button>' +
                    '<button id="dt-stats-start" class="hud-rapid-btn start" data-running="false">START</button>' +
                  '</div>' +
                '</div>';
            body.appendChild(statsPanel);

            wireStatsControls();

            // Make Stats the default-active tab when Advanced IOW opens.
            tabsNav.querySelectorAll('.dt-tab-btn').forEach(b => {
                b.classList.toggle('active', b === statsBtn);
            });
            panel.querySelectorAll('.dt-panel').forEach(p => {
                p.classList.toggle('active', p.id === 'dt-panel-stats');
            });

            window.__iow_smart_on_publish__ = updateStatsTab;
            relocateDiceCounter();
            updateStatsTab();
            statsSetup = true;
            return true;
        }

        function trySetupTermsTab() {
            if (termsSetup) return true;
            const panel = document.getElementById('dt-aio-panel');
            if (!panel) return false;
            const tabsNav = panel.querySelector('.dt-tabs');
            const body = panel.querySelector('.dt-body');
            if (!tabsNav || !body) return false;
            if (panel.querySelector('#dt-panel-terms')) { termsSetup = true; return true; }

            const termsBtn = document.createElement('button');
            termsBtn.className = 'dt-tab-btn';
            termsBtn.dataset.tab = 'terms';
            termsBtn.innerHTML = '<span class="dt-tab-icon">📖</span>Terms';
            tabsNav.appendChild(termsBtn);

            const TERMS_TEXT =
                'STATS TAB\n' +
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
                'Best Streaks / Worst Streaks – Top 10 longest win / loss streaks recorded in the current scope.\n' +
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
                'OPTIMIZER TAB\n' +
                '\n' +
                'PARAMETER RANGES\n' +
                'Combo – A single set of parameter values tested by the optimizer.\n' +
                'Starting Balance – The initial balance applied to all combos during optimization.\n' +
                'Trials per Combo – The number of simulations run for each parameter combination.\n' +
                'Bet Divisor Range – Range or list of values to test for bet divisors.\n' +
                'Profit Multiplier Range – Range or list of values to test for profit multipliers.\n' +
                'Win Increase % Range – Range or list of win increase percentages to test.\n' +
                'Loss Reset – Range or list of loss reset counts to test.\n' +
                'Buffer % Range – Range or list of buffer percentages to test.\n' +
                '\n' +
                'BUTTONS\n' +
                'Run Optimizer – Begins testing all combinations using the provided ranges.\n' +
                'Clear Results – Removes existing results from the results tab.\n' +
                'Stop – Terminates the optimization process currently running.\n' +
                '\n' +
                '\n' +
                'OPTIMIZER RESULTS TAB\n' +
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

            const SUBHEADERS = new Set([
                'CONTROLS DECK', 'LIVE STATS', 'PARAMETERS', 'CALCULATED VALUES',
                'SIMULATION CONTROLS', 'SIMULATION RESULTS', 'PARAMETER RANGES',
                'BUTTONS', 'RESULTS DEFINITIONS'
            ]);

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
            termsPanel.innerHTML = '<div class="dt-terms-scroll">' + lines.join('') + '</div>';
            body.appendChild(termsPanel);

            termsSetup = true;
            return true;
        }

        function relocateDiceCounter() {
            const panel = document.getElementById('dt-panel-stats');
            if (!panel) return;
            const slotW = panel.querySelector('[data-counter-slot="w"]');
            const slotL = panel.querySelector('[data-counter-slot="l"]');
            const ctrW = document.getElementById('dt-ctr_w');
            const ctrL = document.getElementById('dt-ctr_l');
            if (slotW && ctrW && ctrW.parentElement !== slotW) slotW.appendChild(ctrW);
            if (slotL && ctrL && ctrL.parentElement !== slotL) slotL.appendChild(ctrL);
        }

        function wireStatsControls() {
            const hudBetDiv = document.getElementById('dt-stats-bet-div');
            const hudProfMult = document.getElementById('dt-stats-profit-mult');
            const calcBetDiv = document.getElementById('dt-bet_div');
            const calcProfMult = document.getElementById('dt-profit_mult');

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

            const trackSel = document.getElementById('dt-stats-track-per');
            if (trackSel) {
                try {
                    const saved = localStorage.getItem(STATS_TRACK_KEY);
                    if (saved === 'session' || saved === 'cycle') trackSel.value = saved;
                } catch (e) {}
                trackSel.addEventListener('change', () => {
                    try { localStorage.setItem(STATS_TRACK_KEY, trackSel.value); } catch (e) {}
                    updateStatsTab();
                });
            }

            // Autostop checkbox + target — bound directly to dt_state since the
            // mobile build has no floating counter UI to mirror.
            const hudAutostop = document.getElementById('dt-stats-autostop');
            const hudTarget = document.getElementById('dt-stats-target');
            if (hudAutostop) {
                hudAutostop.checked = !!dt_state.counter_autostop;
                hudAutostop.addEventListener('change', () => {
                    dt_state.counter_autostop = hudAutostop.checked;
                    dt_saveState();
                });
            }
            if (hudTarget) {
                hudTarget.value = dt_state.counter_target || 10;
                hudTarget.addEventListener('change', () => {
                    dt_state.counter_target = Math.max(0, parseInt(hudTarget.value, 10) || 0);
                    dt_saveState();
                });
            }

            // Volume slider — drives dt_state.counter_volume, which dt_playBeep reads.
            const hudVolume = document.getElementById('dt-stats-volume');
            const hudVolumeVal = document.getElementById('dt-stats-volume-val');
            function reflectVolume(v) {
                if (hudVolumeVal) hudVolumeVal.textContent = String(parseInt(v, 10) || 0);
            }
            if (hudVolume) {
                hudVolume.value = dt_state.counter_volume != null ? dt_state.counter_volume : 100;
                reflectVolume(hudVolume.value);
                hudVolume.addEventListener('input', () => {
                    dt_state.counter_volume = parseInt(hudVolume.value, 10) || 0;
                    reflectVolume(hudVolume.value);
                    dt_saveState();
                });
            }

            const updateBtn = document.getElementById('dt-stats-update');
            if (updateBtn) {
                updateBtn.addEventListener('click', () => {
                    if (hudBetDiv && calcBetDiv) pushFromHud(hudBetDiv, calcBetDiv);
                    if (hudProfMult && calcProfMult) pushFromHud(hudProfMult, calcProfMult);
                    const sync = document.getElementById('dt-game_sync');
                    if (sync) sync.click();
                    updateStatsTab();
                });
            }

            const resetBtn = document.getElementById('dt-stats-reset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    try { if (typeof window.__iow_smart_reset__ === 'function') window.__iow_smart_reset__(); } catch (e) {}
                    if (window.__iow_smart_state__) {
                        window.__iow_smart_state__.runBaseline = null;
                        window.__iow_smart_state__.runStats = null;
                    }
                    // Also clear the dice-tool streak counter.
                    _dt_winStreak = 0;
                    _dt_lossStreak = 0;
                    dt_updateCounterDisplay();
                    updateStatsTab();
                });
            }

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
                            if (!native) return;
                            const inp = getWagerInput();
                            if (inp && inp.value) baseBetAtStart = inp.value;
                            native.click();
                            if (typeof window.__iow_smart_baseline_now__ === 'function') {
                                window.__iow_smart_baseline_now__();
                            }
                        }
                        setTimeout(syncStartBtn, 60);
                    } catch (e) {}
                });
            }

            const switchBtn = document.getElementById('dt-stats-switch-ou');
            if (switchBtn) {
                switchBtn.addEventListener('click', async () => {
                    if (switchBtn.disabled) return;
                    switchBtn.disabled = true;
                    try {
                        const stopBtn = findNativeStopButton();
                        const wasRunning = !!stopBtn;
                        const swap = getRollOverUnderSwap();
                        if (!swap) return;
                        if (!wasRunning) { swap.click(); return; }
                        stopBtn.click();
                        await int_sleep(120);
                        if (baseBetAtStart != null) writeWagerValue(baseBetAtStart);
                        await int_sleep(60);
                        swap.click();
                        await int_sleep(120);
                        const startAgain = findNativeStartButton();
                        if (startAgain && !startAgain.disabled) startAgain.click();
                        setTimeout(syncStartBtn, 80);
                    } catch (e) {} finally {
                        setTimeout(() => { switchBtn.disabled = false; }, 400);
                    }
                });
            }
        }

        function getWagerInput() {
            return document.querySelector('input[data-testid="bet-amount"]')
                || document.querySelector('input[data-testid="input-game-amount"]');
        }
        function writeWagerValue(value) {
            const inp = getWagerInput();
            if (!inp) return false;
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(inp, value);
            inp.dispatchEvent(new Event('input', { bubbles: true }));
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        function int_sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

        function readCondition4BalanceTarget() {
            const stakeBlock = document.querySelector('[data-testid="conditional-block-4"]');
            if (stakeBlock) {
                const profitType = stakeBlock.querySelector('select[data-testid="condition-profit-type"]');
                const termType = stakeBlock.querySelector('select[data-testid="condition-profit-term-type-options"]');
                const action = stakeBlock.querySelector('select[data-testid="condition-action-options"]');
                const amount = stakeBlock.querySelector('input[data-testid="condition-profit-amount-input"]');
                if (profitType && termType && action && amount) {
                    const isBalance = profitType.value === 'balance';
                    const isGteOrGt = termType.value === 'greaterThanOrEqualTo' || termType.value === 'greaterThan';
                    const isStop = action.value === 'stop' || action.value === 'stopAutobet' || action.value === 'stopAutoplay';
                    if (isBalance && isGteOrGt && isStop && amount.value) {
                        const n = parseFloat(amount.value);
                        if (!isNaN(n)) return n;
                    }
                }
            }
            const shuffleConds = document.querySelectorAll('.AdvancedDiceCondition_root__CaIQo');
            if (shuffleConds.length >= 4) {
                const cond4 = shuffleConds[3];
                const selects = cond4.querySelectorAll('select');
                const amount = cond4.querySelector('input[type="number"]');
                if (selects.length >= 3 && amount) {
                    const isBalance = selects[0].value === 'balance';
                    const isGteOrGt = selects[1].value === 'greaterThanOrEqualTo' || selects[1].value === 'greaterThan';
                    const isStop = selects[2].value === 'stopAutobet' || selects[2].value === 'stop' || selects[2].value === 'stopAutoplay';
                    if (isBalance && isGteOrGt && isStop && amount.value) {
                        const n = parseFloat(amount.value);
                        if (!isNaN(n)) return n;
                    }
                }
            }
            return null;
        }
        function refreshCond4BalanceTargetCache() {
            const v = readCondition4BalanceTarget();
            if (v != null) cond4BalanceTarget = v;
        }

        function findNativeStopButton() {
            const stopByAttr = document.querySelector('button[data-testid="auto-bet-button"][data-autobet-status="stop"]') ||
                               document.querySelector('button[data-test="auto-bet-button"][data-autobet-status="stop"]') ||
                               document.querySelector('button[data-autobet-status="stop"]');
            if (stopByAttr && !stopByAttr.disabled) return stopByAttr;
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                const txt = (b.textContent || '').trim().toLowerCase();
                if ((txt === 'stop autoplay' || txt === 'stop auto' || txt === 'stop') && !b.disabled) return b;
            }
            return null;
        }
        function findNativeStartButton() {
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

        function fmt(n, dp) {
            if (typeof n !== 'number' || !isFinite(n)) return '—';
            return n.toFixed(dp == null ? 2 : dp);
        }
        function fmtSigned(n, dp) {
            if (typeof n !== 'number' || !isFinite(n)) return '—';
            const s = n.toFixed(dp == null ? 2 : dp);
            return n > 0 ? '+' + s : s;
        }
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

        function getActiveStatsSource() {
            const sel = document.getElementById('dt-stats-track-per');
            const mode = sel ? sel.value : 'session';
            const s = window.__iow_smart_state__ || {};
            return mode === 'cycle' ? s.runStats : s.sessionStats;
        }

        function updateStatsTab() {
            const panel = document.getElementById('dt-panel-stats');
            if (!panel) return;
            const dicePanelEl = document.getElementById('dt-aio-panel');
            const visible = panel.classList.contains('active') &&
                dicePanelEl && !dicePanelEl.classList.contains('dt-bridge-hidden');
            if (!visible) {
                syncStartBtn();
                return;
            }
            const data = getActiveStatsSource();
            panel.querySelectorAll('.hud-row[data-stat]').forEach(row => {
                const stat = row.dataset.stat;
                const valEl = row.querySelector('.hud-val');
                if (!valEl) return;
                const res = formatStat(stat, data);
                valEl.textContent = res.text;
                if (res.cls === 'pos') valEl.style.color = '#00ff9d';
                else if (res.cls === 'neg') valEl.style.color = '#f87171';
                else if (!valEl.style.color || valEl.style.color === 'rgb(0, 255, 157)' || valEl.style.color === 'rgb(248, 113, 113)') {
                    if (!row.matches('[data-stat="sessionPeak"]') && !row.matches('[data-stat="peakProfit"]')) {
                        valEl.style.color = '';
                    }
                }
            });
            const bestList = panel.querySelector('[data-stat="bestStreaks"]');
            const worstList = panel.querySelector('[data-stat="worstStreaks"]');
            if (bestList) bestList.textContent = (data && data.topWinStreaks && data.topWinStreaks.length) ? data.topWinStreaks.join(', ') : '-';
            if (worstList) worstList.textContent = (data && data.topLossStreaks && data.topLossStreaks.length) ? data.topLossStreaks.join(', ') : '-';
            refreshCond4BalanceTargetCache();
            const balTargetEl = panel.querySelector('#dt-stats-bal-target');
            const profStopEl = panel.querySelector('#dt-stats-profit-stop');
            const calcProfit = document.getElementById('dt-out_profit');
            if (balTargetEl) {
                balTargetEl.textContent = (cond4BalanceTarget != null) ? cond4BalanceTarget.toFixed(2) : '';
            }
            if (profStopEl) profStopEl.textContent = (calcProfit && calcProfit.value) ? calcProfit.value : '0.00';
            syncStartBtn();
            drawStatsGraph(panel, data ? data.profitHistory : []);
        }

        function syncStartBtn() {
            const startBtn = document.getElementById('dt-stats-start');
            if (!startBtn) return;
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

        function drawStatsGraph(panel, history) {
            const canvas = panel && panel.querySelector('#dt-stats-graph');
            if (!canvas) return;
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const cssW = canvas.offsetWidth;
            const cssH = canvas.offsetHeight;
            if (cssW <= 0 || cssH <= 0) return;
            canvas.width = Math.max(1, Math.floor(cssW * dpr));
            canvas.height = Math.max(1, Math.floor(cssH * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, cssW, cssH);
            if (!history || history.length < 2) return;
            let maxVal = Math.max.apply(null, history.concat([0]));
            let minVal = Math.min.apply(null, history.concat([0]));
            const range = (maxVal - minVal) || 1;
            const pad = range * 0.15;
            maxVal += pad; minVal -= pad;
            const totalRange = maxVal - minVal;
            const zeroY = cssH - ((0 - minVal) / totalRange) * cssH;
            const zeroPct = Math.max(0, Math.min(1, zeroY / cssH));
            const lineGrad = ctx.createLinearGradient(0, 0, 0, cssH);
            lineGrad.addColorStop(0, '#10b981');
            lineGrad.addColorStop(zeroPct, '#10b981');
            lineGrad.addColorStop(zeroPct, '#ef4444');
            lineGrad.addColorStop(1, '#ef4444');
            const fillGrad = ctx.createLinearGradient(0, 0, 0, cssH);
            fillGrad.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
            fillGrad.addColorStop(zeroPct, 'rgba(16, 185, 129, 0.22)');
            fillGrad.addColorStop(zeroPct, 'rgba(239, 68, 68, 0.22)');
            fillGrad.addColorStop(1, 'rgba(239, 68, 68, 0.22)');
            const stepX = cssW / (history.length - 1);
            ctx.beginPath();
            for (let i = 0; i < history.length; i++) {
                const x = i * stepX;
                const y = cssH - ((history[i] - minVal) / totalRange) * cssH;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = lineGrad;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.stroke();
            ctx.lineTo(cssW, zeroY); ctx.lineTo(0, zeroY); ctx.closePath();
            ctx.fillStyle = fillGrad;
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, zeroY);
            ctx.lineTo(cssW, zeroY);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        function activateTools() {
            const hudContent = document.getElementById('hud-content');
            if (!hudContent || !dicePanel) return;
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
            forceNativeMode('advanced');
        }

        function deactivateTools() {
            if (!toolsActive) return;
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

        /* ---- MASTER INTEGRATION TICKER ---- */
        let stitchAttempts = 0;
        let lastTickedUrl = location.href;
        const MAX_STITCH_ATTEMPTS = 60;
        setInterval(() => {
            if (location.href !== lastTickedUrl) {
                lastTickedUrl = location.href;
                stitchAttempts = 0;
            }
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
            enforceNativeMode();
            try { refreshCond4BalanceTargetCache(); } catch (e) {}
            if (statsSetup) updateStatsTab();
            if (statsSetup) relocateDiceCounter();
            if (!termsSetup) trySetupTermsTab();
        }, 500);
    }

    /* ============================================================
       ===========================================================
       TOOL VISIBILITY (desktop-equivalent)
       Disabled tools aren't unloaded — a CSS rule hides their UI
       selectors when the html element carries the tool's disabled
       class. Re-enabling removes the class instantly. hijacksPage
       tools (IOW/Smart) gate at run time via isToolIdEnabled() in
       their own bodies because they re-parent native page DOM.
       ===========================================================
       ============================================================ */
    const VISIBILITY_STYLE_ID = 'unified-tools-visibility-css';

    function disabledClass(toolId) {
        return 'uts-disabled-' + toolId.replace(/[^a-z0-9_-]/gi, '-');
    }
    function urlMismatchClass(toolId) {
        return 'uts-url-mismatch-' + toolId.replace(/[^a-z0-9_-]/gi, '-');
    }

    // UI selectors per registered tool, used by the visibility CSS.
    // Mobile's per-platform tool functions all build the same gui id
    // (e.g. #keno-preset-gui on any platform), so we map by registration id.
    function uiSelectorsFor(toolId) {
        if (toolId === 'stake-7day-tracker') return ['#stk7w', '#stk7w-pill', '#stk7w-scrim', '#stk7w-sync', '#stk7w-gtip'];
        if (toolId.endsWith('-keno'))      return ['#keno-preset-gui'];
        if (toolId.endsWith('-mines'))     return ['#mines-auto-gui'];
        if (toolId.endsWith('-autovault')) return ['#autovault-floaty'];
        if (toolId.endsWith('-dice') || toolId.endsWith('-limbo')) return []; // hijacksPage — handled by gating
        return [];
    }

    function injectVisibilityCss() {
        if (document.getElementById(VISIBILITY_STYLE_ID)) return;
        if (!document.head && !document.documentElement) return;
        const HIDE_PROPS = ' { display: none !important; visibility: hidden !important; pointer-events: none !important; }';
        const css = TOOLS
            .map(t => {
                const sels = uiSelectorsFor(t.id);
                if (!sels.length) return '';
                const disSel = sels.map(s => 'html.' + disabledClass(t.id) + ' ' + s).join(',\n');
                const urlSel = sels.map(s => 'html.' + urlMismatchClass(t.id) + ' ' + s).join(',\n');
                return disSel + HIDE_PROPS + '\n' + urlSel + HIDE_PROPS;
            }).filter(Boolean).join('\n');
        const style = document.createElement('style');
        style.id = VISIBILITY_STYLE_ID;
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }
    function applyToolVisibility(tool) {
        if (!tool || !tool.id) return;
        if (tool.hijacksPage) return;
        const sels = uiSelectorsFor(tool.id);
        if (!sels.length) return;
        const disCls = disabledClass(tool.id);
        const urlCls = urlMismatchClass(tool.id);
        const root = document.documentElement;
        if (!root) return;
        const onSameSite = isToolOnThisSite(tool);
        const onMatchingUrl = urlMatches(tool, location.href);
        if (onMatchingUrl && !isEnabled(tool)) root.classList.add(disCls);
        else root.classList.remove(disCls);
        if (onSameSite && !onMatchingUrl) root.classList.add(urlCls);
        else root.classList.remove(urlCls);
    }
    function applyAllVisibility() {
        injectVisibilityCss();
        for (const t of TOOLS) applyToolVisibility(t);
    }

    /* ============================================================
       ===========================================================
       QUICK-TOGGLE CHIPS — small floating buttons pinned above
       the gear icon, one per matching tool on this URL. Autovault
       tools excluded (no game-specific anchor URL).
       ===========================================================
       ============================================================ */
    const QUICK_TOGGLE_STYLE_ID = 'unified-tools-quick-toggle-css';
    const AUTOVAULT_TOOL_IDS = new Set(['stake-autovault', 'shuffle-autovault', 'nuts-autovault', 'stake-7day-tracker']);

    function injectQuickToggleCss() {
        if (document.getElementById(QUICK_TOGGLE_STYLE_ID)) return;
        if (!document.head && !document.documentElement) return;
        const style = document.createElement('style');
        style.id = QUICK_TOGGLE_STYLE_ID;
        style.textContent = `
            .uts-quick-toggle {
                position: fixed;
                left: max(64px, calc(env(safe-area-inset-left) + 48px));
                z-index: 2147483645;
                padding: 7px 14px;
                border-radius: 18px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                border: 1px solid;
                transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
                user-select: none;
                -webkit-user-select: none;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                letter-spacing: 0.3px;
                white-space: nowrap;
                display: inline-flex;
                align-items: center;
                gap: 6px;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
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
            .uts-quick-toggle:active { transform: scale(0.96); }
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

    function currentGameQuickLabel() {
        const path = (location.pathname || '').toLowerCase();
        if (/(^|\/)(dice|primedice)(?:\/|$)/.test(path)) return 'Dice';
        if (/(^|\/)limbo(?:\/|$)/.test(path)) return 'Limbo';
        if (/(^|\/)target(?:\/|$)/.test(path)) return 'Target';
        if (/(^|\/)keno(?:\/|$)/.test(path)) return 'Keno';
        if (/(^|\/)mines(?:\/|$)/.test(path)) return 'Mines';
        return '';
    }

    function quickToggleLabel(tool) {
        const id = tool && tool.id ? tool.id : '';
        if (/-iow-smart$/i.test(id)) return currentGameQuickLabel() || 'Dice';
        if (/-keno$/i.test(id)) return 'Keno';
        if (/-mines$/i.test(id)) return 'Mines';
        return (tool.name || tool.id)
            .replace(/^Stake\/Shuffle\s+/i, '')
            .replace(/^Stake\.gg\s+/i, '')
            .replace(/^Stake\s+/i, '')
            .replace(/^Shuffle\s+/i, '')
            .replace(/^Nuts\.gg\s+/i, '')
            .replace(/^Nuts\s+/i, '')
            .replace(/\s+IOW\/Smart$/i, '')
            .replace(/\s*\(.*\)$/i, '');
    }

    function applyQuickToggles() {
        injectQuickToggleCss();
        if (!document.body) return;
        const matching = TOOLS.filter(t =>
            !AUTOVAULT_TOOL_IDS.has(t.id) && urlMatches(t, location.href)
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
                btn.addEventListener('click', () => quickToggleClick(tool));
                document.body.appendChild(btn);
            }
            // Stack above the gear button (bottom: 16px, ~38px tall).
            btn.style.bottom = `calc(${16 + 44 + idx * 36}px + env(safe-area-inset-bottom))`;
            const enabled = isEnabled(tool);
            btn.classList.toggle('on', enabled);
            btn.classList.toggle('off', !enabled);
            const label = btn.querySelector('.uts-qt-label');
            if (label) label.textContent = quickToggleLabel(tool);
            btn.title = (enabled ? 'Click to disable: ' : 'Click to enable: ') + (tool.name || tool.id);
        });
        document.querySelectorAll('.uts-quick-toggle').forEach(b => {
            if (!seen.has(b.id)) b.remove();
        });
    }

    function quickToggleClick(tool) {
        const newState = !isEnabled(tool);
        setEnabled(tool.id, newState);
        applyToolVisibility(tool);
        applyQuickToggles();
        document.querySelectorAll('[data-switch="' + tool.id + '"]').forEach(el => {
            el.classList.toggle('on', newState);
        });
        if (tool.hijacksPage && urlMatches(tool, location.href)) {
            location.reload();
            return;
        }
        if (newState && urlMatches(tool, location.href) && !tool._ran) {
            location.reload();
        }
    }

    /* ============================================================
       ===========================================================
       CONTROL PANEL — floating gear button (bottom-left) opens a
       draggable panel listing every registered tool grouped by
       site, each with a status line and on/off switch. Mirrors
       the desktop bundle's buildPanel() exactly (HTML + CSS), with
       drag handlers swapped to Pointer Events for touch support.
       ===========================================================
       ============================================================ */
    const PANEL_ID         = 'unified-tools-panel';
    const PANEL_TOGGLE_ID  = 'unified-tools-toggle';
    const PANEL_STYLE_ID   = 'unified-tools-style';

    const PANEL_CSS = `
    #${PANEL_TOGGLE_ID} {
        position: fixed; bottom: max(16px, env(safe-area-inset-bottom)); left: max(16px, env(safe-area-inset-left)); z-index: 2147483646;
        width: 38px; height: 38px; border-radius: 50%;
        background: linear-gradient(135deg, #1f2937, #0f172a);
        border: 1px solid rgba(148, 163, 184, 0.3);
        color: #e2e8f0; font-size: 18px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        box-shadow: 0 6px 18px rgba(0,0,0,0.45);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        user-select: none; -webkit-user-select: none;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        padding: 0;
    }
    #${PANEL_TOGGLE_ID}:active {
        transform: scale(0.94);
        box-shadow: 0 8px 22px rgba(0,0,0,0.55);
    }
    #${PANEL_TOGGLE_ID}.has-active::after {
        content: ''; position: absolute; top: 4px; right: 4px;
        width: 8px; height: 8px; border-radius: 50%;
        background: #10b981; box-shadow: 0 0 6px #10b981;
    }
    #${PANEL_ID} {
        position: fixed; bottom: calc(64px + env(safe-area-inset-bottom)); left: max(16px, env(safe-area-inset-left)); z-index: 2147483647;
        width: 320px; max-width: calc(100vw - 24px); max-height: 70vh;
        background: linear-gradient(180deg, #111827 0%, #0b1220 100%);
        color: #e2e8f0; border: 1px solid rgba(148, 163, 184, 0.25);
        border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.6);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; user-select: none; -webkit-user-select: none;
        display: flex; flex-direction: column; overflow: hidden;
    }
    #${PANEL_ID}.hidden { display: none; }
    #${PANEL_ID} .ut-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 12px;
        background: linear-gradient(135deg, #1f2937, #111827);
        border-bottom: 1px solid rgba(148, 163, 184, 0.2);
        cursor: grab;
        touch-action: none;
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
        padding: 4px 10px; border-radius: 4px; min-height: 32px;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
    }
    #${PANEL_ID} .ut-header-btn:active { color: #fff; background: rgba(148, 163, 184, 0.15); }
    #${PANEL_ID} .ut-body {
        flex: 1 1 auto; overflow-y: auto;
        padding: 8px 0;
        -webkit-overflow-scrolling: touch;
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
        padding: 10px 12px;
        transition: background 0.12s ease;
    }
    #${PANEL_ID} .ut-tool:active { background: rgba(148, 163, 184, 0.06); }
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
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
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
        padding: 8px 12px max(8px, env(safe-area-inset-bottom));
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
        padding: 8px 8px; border-radius: 6px;
        cursor: pointer; min-height: 36px;
        text-transform: uppercase; letter-spacing: 0.4px;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        font-family: inherit;
    }
    #${PANEL_ID} .ut-footer-btn:active { background: rgba(148, 163, 184, 0.18); color: #fff; }
    #${PANEL_ID} .ut-footer-btn.danger { color: #fca5a5; }
    #${PANEL_ID} .ut-footer-btn.danger:active { color: #fff; background: rgba(239, 68, 68, 0.2); }
    #${PANEL_ID} .ut-empty {
        padding: 20px 16px; text-align: center;
        color: #64748b; font-size: 11px; font-style: italic;
    }
    `;

    function injectPanelStyle() {
        if (document.getElementById(PANEL_STYLE_ID)) return;
        const s = document.createElement('style');
        s.id = PANEL_STYLE_ID;
        s.textContent = PANEL_CSS;
        document.head.appendChild(s);
    }

    function loadPanelPos() {
        try {
            const raw = localStorage.getItem(PANEL_POS_KEY);
            if (!raw) return null;
            const p = JSON.parse(raw);
            if (typeof p.left === 'number' && typeof p.top === 'number') return p;
        } catch {}
        return null;
    }
    function savePanelPos(left, top) {
        try { localStorage.setItem(PANEL_POS_KEY, JSON.stringify({ left, top })); } catch {}
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

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

        toggle.onclick = () => {
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
                if (tool.hijacksPage && urlMatches(tool, location.href)) {
                    location.reload();
                    return;
                }
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

        // Drag via Pointer Events (covers mouse + touch on mobile).
        const header = panel.querySelector('.ut-header');
        let dragging = false, dx = 0, dy = 0, pid = null;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            pid = e.pointerId;
            const r = panel.getBoundingClientRect();
            dx = e.clientX - r.left; dy = e.clientY - r.top;
            try { header.setPointerCapture(pid); } catch (err) {}
            e.preventDefault();
        });
        header.addEventListener('pointermove', (e) => {
            if (!dragging || e.pointerId !== pid) return;
            let nl = e.clientX - dx, nt = e.clientY - dy;
            nl = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, nl));
            nt = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, nt));
            panel.style.left = nl + 'px';
            panel.style.top = nt + 'px';
            panel.style.bottom = 'auto'; panel.style.right = 'auto';
            savePanelPos(nl, nt);
        });
        function endDrag() {
            if (!dragging) return;
            dragging = false;
            try { header.releasePointerCapture(pid); } catch (err) {}
            pid = null;
        }
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);

        refreshStatuses();
        updateToggleBadge();
    }

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

    function updateToggleBadge() {
        const toggle = document.getElementById(PANEL_TOGGLE_ID);
        if (!toggle) return;
        const anyActive = TOOLS.some(t => t._ran);
        toggle.classList.toggle('has-active', anyActive);
    }

    /* ============================================================
       ===========================================================
       TOOL: KENO PRESET MANAGER (Stake, Nuts, Shuffle)
       One floating panel per-page (URL-gated). Pointer Events drag
       for touch + mouse. Stake & Nuts share preset storage via
       'keno-presets'; Shuffle uses 'shuffle-keno-presets'.
       ===========================================================
       ============================================================ */
    function isOnKenoPage() {
        const path = location.pathname || '';
        if (isShuffle()) return /\/games\/originals\/keno(?:\/|$|\?|#)/i.test(path);
        if (isNuts()) return /\/keno(?:\/|$|\?|#)/i.test(path);
        return /\/casino\/games\/keno(?:\/|$|\?|#)/i.test(path);
    }

    function tool_keno() {
        if (document.getElementById('keno-preset-gui')) return; // idempotent

        const PRESETS_KEY = isShuffle() ? 'shuffle-keno-presets' : 'keno-presets';
        const RISK_VALUES = ['classic', 'low', 'medium', 'high'];
        const TITLE = isShuffle() ? 'Shuffle Keno' : isNuts() ? 'Nuts Keno' : 'Stake Keno';
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        function loadPresets() {
            try {
                const raw = localStorage.getItem(PRESETS_KEY);
                if (!raw) return [];
                const p = JSON.parse(raw);
                return Array.isArray(p) ? p : [];
            } catch { return []; }
        }
        function savePresets(list) { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); }

        /* ---- Per-platform tile + risk accessors ---- */
        function getTiles() {
            if (isNuts()) {
                // Content-based: button with 2 children where first span is 1-40
                const all = document.querySelectorAll('button');
                const byNum = new Map();
                for (const b of all) {
                    if (b.children.length !== 2) continue;
                    const span = b.querySelector('span');
                    if (!span) continue;
                    const n = parseInt((span.textContent || '').trim(), 10);
                    if (n >= 1 && n <= 40 && !byNum.has(n)) byNum.set(n, b);
                }
                if (byNum.size < 40) return [];
                const out = [];
                for (let i = 1; i <= 40; i++) out.push(byNum.get(i));
                return out;
            }
            if (isShuffle()) {
                return Array.from(document.querySelectorAll('button[data-testid^="keno-button-"]'));
            }
            return Array.from(document.querySelectorAll('button[data-testid^="game-tile-"]'));
        }

        function getTileNumber(btn) {
            if (isShuffle()) {
                const m = (btn.getAttribute('data-testid') || '').match(/keno-button-(\d+)/);
                return m ? parseInt(m[1], 10) : null;
            }
            // Stake exposes data-index (0-based); Nuts uses content order
            const idx = Number(btn.dataset.index);
            if (!isNaN(idx)) return idx + 1;
            return null;
        }

        function isTilePicked(btn) {
            if (isShuffle()) {
                // Shuffle marks tiles with hashed CSS-module classes:
                //   selectedButton = a pick that wasn't drawn (miss)
                //   buttonSuccess  = a pick that WAS drawn (a hit)
                //   buttonFailed   = a drawn number you did NOT pick (result — exclude)
                // Picks = selectedButton + buttonSuccess. (The old purple-bg
                // heuristic missed hits, which turn green rather than purple.)
                return /selectedButton|buttonSuccess/.test(btn.className || '');
            }
            if (isNuts()) {
                // Nuts uses styled-components hashes (no semantic attrs), but the
                // tile's cover (children[1]) carries the accent color: a picked
                // tile's cover is purple (~rgb(150,46,255)); unpicked is gray and
                // drawn results are green. A hit flashes green during the reveal
                // then reverts to purple, so this is accurate between rounds.
                const cover = btn.children[1];
                if (!cover) return false;
                const m = (getComputedStyle(cover).backgroundColor || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
                if (!m) return false;
                const r = +m[1], g = +m[2], b = +m[3];
                return (r + b) > 200 && g < 100; // purple cover = picked; green/gray excluded
            }
            // Stake: data-game-tile-status is authoritative.
            //   'selected' = a pick that wasn't drawn
            //   'match'    = a pick that WAS drawn (a hit). NB: data-selected
            //                flips to "false" here, so the old data-selected
            //                check missed hits — and during the result reveal
            //                that let drawn tiles bleed into the tracked picks.
            //   'revealed' = a drawn number you did NOT pick — exclude it
            //   'hidden'   = untouched — exclude it
            const st = btn.getAttribute('data-game-tile-status');
            return st === 'selected' || st === 'match';
        }

        // userPicks is authoritative — DOM-based detection gets confused once
        // a round resolves (hits look like picks). We track via click capture.
        const userPicks = new Set();

        function readPicksFromDOM() {
            const tiles = getTiles();
            if (!tiles.length) return [];
            if (isNuts()) {
                // Picked = purple cover (see isTilePicked). Number comes from the
                // tile's own label span — Nuts tiles are content-based with no
                // data-index, so getTileNumber can't be used here.
                const picks = [];
                for (const t of tiles) {
                    if (!isTilePicked(t)) continue;
                    const sp = t.querySelector('span');
                    const n = sp ? parseInt((sp.textContent || '').trim(), 10) : NaN;
                    if (n >= 1 && n <= 40) picks.push(n);
                }
                return picks;
            }
            return tiles.filter(isTilePicked).map(getTileNumber).filter(n => n != null);
        }
        function syncPicksFromDOM() {
            userPicks.clear();
            for (const n of readPicksFromDOM()) userPicks.add(n);
        }
        function getSelectedNumbers() {
            // All platforms: read picks LIVE from the board. Each platform's
            // isTilePicked reads the authoritative pick marker (Stake tile status
            // selected/match; Shuffle classes selectedButton/buttonSuccess; Nuts
            // purple cover colour) and excludes drawn results, so the panel can't
            // drift out of sync with the board and never counts results. This
            // replaces the click-tracked Set, which drifted badly (Stake board=2
            // vs panel=16; Shuffle board=1 vs panel=2). userPicks is now only a
            // fallback for when the board hasn't mounted yet.
            if (getTiles().length) {
                return readPicksFromDOM().sort((a, b) => a - b);
            }
            return Array.from(userPicks).sort((a, b) => a - b);
        }

        function getRisk() {
            if (isNuts()) {
                const slider = document.querySelector('[role="slider"][aria-valuemax="3"][aria-valuemin="0"]')
                    || document.querySelector('[role="slider"]');
                if (slider) {
                    const idx = Number(slider.getAttribute('aria-valuenow'));
                    if (!isNaN(idx) && RISK_VALUES[idx]) return RISK_VALUES[idx];
                }
                const spans = document.querySelectorAll('span');
                for (const sp of spans) {
                    const m = (sp.textContent || '').match(/\b(CLASSIC|LOW|MEDIUM|HIGH)\s*RISK\b/i);
                    if (m) return m[1].toLowerCase();
                }
                return null;
            }
            if (isShuffle()) {
                for (const r of RISK_VALUES) {
                    const cap = r.charAt(0).toUpperCase() + r.slice(1);
                    const btn = document.querySelector(`button[data-testid="keno-${cap}"]`);
                    if (!btn) continue;
                    const span = btn.querySelector('span');
                    if (span && /RiskSelectButtons_active/.test(span.className || '')) return r;
                }
                return null;
            }
            const el = document.querySelector('select[data-testid="game-difficulty"]');
            return el ? el.value : null;
        }

        async function setRisk(risk) {
            if (!RISK_VALUES.includes(risk)) return false;
            if (isNuts()) {
                const slider = document.querySelector('[role="slider"][aria-valuemax="3"][aria-valuemin="0"]')
                    || document.querySelector('[role="slider"]');
                if (!slider) return false;
                const targetIdx = RISK_VALUES.indexOf(risk);
                let currentIdx = Number(slider.getAttribute('aria-valuenow'));
                if (isNaN(currentIdx)) return false;
                if (currentIdx === targetIdx) return true;
                slider.focus();
                const diff = targetIdx - currentIdx;
                const key = diff > 0 ? 'ArrowRight' : 'ArrowLeft';
                const steps = Math.abs(diff);
                for (let i = 0; i < steps; i++) {
                    slider.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
                    slider.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true, cancelable: true }));
                    await sleep(100);
                }
                return Number(slider.getAttribute('aria-valuenow')) === targetIdx;
            }
            if (isShuffle()) {
                const cap = risk.charAt(0).toUpperCase() + risk.slice(1);
                const btn = document.querySelector(`button[data-testid="keno-${cap}"]`);
                if (!btn) return false;
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await sleep(120);
                return getRisk() === risk;
            }
            const el = document.querySelector('select[data-testid="game-difficulty"]');
            if (!el || el.value === risk) return !!el;
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
            setter.call(el, risk);
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }

        async function clickTile(number) {
            if (isNuts()) {
                const tiles = getTiles();
                const t = tiles[number - 1];
                if (!t) return false;
                t.click();
                return true;
            }
            if (isShuffle()) {
                const btn = document.querySelector(`button[data-testid="keno-button-${number}"]`);
                if (!btn) return false;
                btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
                await sleep(60);
                return true;
            }
            const tile = document.querySelector(`button[data-testid="game-tile-${number}"]`);
            if (!tile) return false;
            tile.click();
            return true;
        }

        async function applyPreset(preset) {
            if (!preset || !Array.isArray(preset.numbers)) return;
            if (preset.risk && RISK_VALUES.includes(preset.risk)) {
                await setRisk(preset.risk);
                await sleep(120);
            }
            if (isNuts()) {
                // After a round, the Nuts board is locked (tiles disabled) until
                // the table is cleared back to the betting phase — so loading a
                // different preset would silently do nothing. Click "Clear Table"
                // first to unlock it (this resets to 0 picks, all tiles enabled);
                // the diff below then selects the preset fresh.
                const clear = Array.from(document.querySelectorAll('button'))
                    .find(b => /clear\s*table/i.test(b.textContent || ''));
                if (clear && !clear.disabled) { clear.click(); await sleep(250); }
            }
            const current = new Set(getSelectedNumbers());
            const target = new Set(preset.numbers);
            for (const n of current) {
                if (!target.has(n)) { await clickTile(n); await sleep(50); }
            }
            for (const n of target) {
                if (!current.has(n)) { await clickTile(n); await sleep(50); }
            }
        }

        /* ---- UI ---- */
        addStyle(`
            #keno-preset-gui {
                position: fixed;
                bottom: max(20px, env(safe-area-inset-bottom));
                right: max(12px, env(safe-area-inset-right));
                z-index: 2147483646;
                width: 280px; max-width: calc(100vw - 24px);
                background: linear-gradient(180deg, rgba(26, 44, 56, 0.97), rgba(15, 33, 46, 0.97));
                color: #f5fbff;
                border: 1px solid var(--kp-border, rgba(82, 109, 130, 0.55));
                border-radius: 12px;
                box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 13px;
                -webkit-user-select: none; user-select: none;
                touch-action: none;
            }
            #keno-preset-gui.shuffle-theme {
                --kp-accent: #6c47ff;
                --kp-accent-dark: #4f35b3;
                --kp-border: rgba(108, 71, 255, 0.45);
                background: linear-gradient(180deg, rgba(26, 18, 56, 0.97), rgba(10, 8, 24, 0.97));
            }
            #keno-preset-gui.nuts-theme {
                --kp-accent: #19f3ff;
                --kp-accent-dark: #8f63ff;
                --kp-border: rgba(143, 99, 255, 0.45);
                background: linear-gradient(180deg, rgba(36, 42, 56, 0.95), rgba(14, 18, 28, 0.97));
            }
            #keno-preset-gui:not(.shuffle-theme):not(.nuts-theme) {
                --kp-accent: #00ff9d;
                --kp-accent-dark: #00cc7a;
            }
            #keno-preset-gui .kp-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px;
                background: rgba(255, 255, 255, 0.03);
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 12px 12px 0 0;
                cursor: grab;
            }
            #keno-preset-gui .kp-header:active { cursor: grabbing; }
            #keno-preset-gui .kp-title {
                font-weight: 800; font-size: 12px;
                text-transform: uppercase; letter-spacing: 0.5px;
                color: var(--kp-accent);
            }
            #keno-preset-gui .kp-close {
                background: none; border: none; color: #94a3b8;
                cursor: pointer; padding: 4px 10px; font-size: 20px;
                line-height: 1; border-radius: 6px; min-height: 32px;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
            }
            #keno-preset-gui .kp-close:active { color: #fff; background: rgba(255, 255, 255, 0.08); }
            #keno-preset-gui .kp-content {
                padding: 12px; display: flex; flex-direction: column; gap: 10px;
            }
            #keno-preset-gui .kp-current {
                padding: 8px 10px;
                background: rgba(0, 0, 0, 0.25);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                font-size: 11px; color: #94a3b8; line-height: 1.4;
                word-break: break-word;
            }
            #keno-preset-gui .kp-current b { color: var(--kp-accent); font-weight: 800; }
            #keno-preset-gui select {
                width: 100%;
                background: #0b0e17;
                color: #fff;
                border: 1px solid #2f4553;
                border-radius: 6px;
                padding: 8px 10px;
                font-size: 12px; font-weight: 700;
                font-family: inherit;
                outline: none;
                min-height: 36px;
                -webkit-appearance: none; appearance: none;
            }
            #keno-preset-gui select:focus { border-color: var(--kp-accent); }
            #keno-preset-gui .kp-btn-row { display: flex; gap: 6px; }
            #keno-preset-gui .kp-btn {
                flex: 1;
                background: #1a2c38; color: #fff;
                border: 1px solid #2f4553;
                border-radius: 6px;
                padding: 8px 6px;
                font-size: 10px; font-weight: 900;
                cursor: pointer;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                min-height: 36px;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
            }
            #keno-preset-gui .kp-btn:disabled { opacity: 0.4; }
            #keno-preset-gui .kp-btn:active { background: #2f4553; }
            #keno-preset-gui .kp-btn.primary {
                background: var(--kp-accent); color: #0f212e; border: none;
                box-shadow: 0 0 10px color-mix(in srgb, var(--kp-accent) 30%, transparent);
            }
            #keno-preset-gui .kp-btn.primary:active { background: var(--kp-accent-dark); }
            #keno-preset-gui.shuffle-theme .kp-btn.primary,
            #keno-preset-gui.nuts-theme .kp-btn.primary { color: #fff; }
            #keno-preset-gui .kp-btn.danger {
                background: transparent; color: #e11d48;
                border: 1px solid #e11d48;
            }
            #keno-preset-gui .kp-btn.danger:active { background: #e11d48; color: #fff; }
        `);

        const gui = document.createElement('div');
        gui.id = 'keno-preset-gui';
        if (isShuffle()) gui.classList.add('shuffle-theme');
        if (isNuts()) gui.classList.add('nuts-theme');
        gui.innerHTML = `
            <div class="kp-header">
                <span class="kp-title">${TITLE}</span>
                <button class="kp-close" id="kp-close" title="Close">×</button>
            </div>
            <div class="kp-content">
                <div class="kp-current" id="kp-current">Loading…</div>
                <select id="kp-select"></select>
                <div class="kp-btn-row">
                    <button class="kp-btn primary" id="kp-load">Load</button>
                    <button class="kp-btn" id="kp-save">Save</button>
                    <button class="kp-btn danger" id="kp-delete">Del</button>
                </div>
            </div>
        `;
        document.body.appendChild(gui);

        const selectEl = gui.querySelector('#kp-select');
        const currentEl = gui.querySelector('#kp-current');
        const loadBtn = gui.querySelector('#kp-load');
        const saveBtn = gui.querySelector('#kp-save');
        const deleteBtn = gui.querySelector('#kp-delete');
        const closeBtn = gui.querySelector('#kp-close');
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
                : `No picks · risk <b>${risk}</b>`;
        }

        saveBtn.addEventListener('click', () => {
            const nums = getSelectedNumbers();
            if (!nums.length) { alert('Select some numbers first, then save as a preset.'); return; }
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
        });

        loadBtn.addEventListener('click', async () => {
            const list = loadPresets();
            const p = list.find(x => x.name === selectEl.value);
            if (!p) return;
            loadBtn.disabled = true;
            await applyPreset(p);
            setTimeout(() => { loadBtn.disabled = false; renderCurrent(); }, 250);
        });

        deleteBtn.addEventListener('click', () => {
            const name = selectEl.value;
            if (!name) return;
            if (!confirm(`Delete preset "${name}"?`)) return;
            savePresets(loadPresets().filter(p => p.name !== name));
            renderPresets();
        });

        closeBtn.addEventListener('click', () => gui.remove());

        /* ---- Tile click capture — drives userPicks ---- */
        // Stake/Shuffle: tiles have stable testid we can map back. Nuts: index
        // by position in getTiles() snapshot at click time.
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            let n = null;
            if (isStakeKenoTile(btn)) {
                const idx = Number(btn.dataset.index);
                if (!isNaN(idx)) n = idx + 1;
            } else if (isShuffleKenoTile(btn)) {
                const m = (btn.getAttribute('data-testid') || '').match(/keno-button-(\d+)/);
                if (m) n = parseInt(m[1], 10);
            } else if (isNuts()) {
                const tiles = getTiles();
                const idx = tiles.indexOf(btn);
                if (idx !== -1) n = idx + 1;
            }
            if (n == null) return;
            if (userPicks.has(n)) userPicks.delete(n);
            else userPicks.add(n);
            setTimeout(renderCurrent, 0);
        }, true);

        function isStakeKenoTile(btn) {
            return !isShuffle() && !isNuts() && (btn.getAttribute('data-testid') || '').startsWith('game-tile-');
        }
        function isShuffleKenoTile(btn) {
            return isShuffle() && (btn.getAttribute('data-testid') || '').startsWith('keno-button-');
        }

        /* ---- Pointer Events drag (touch + mouse, single code path) ---- */
        let dragging = false, dx = 0, dy = 0, pointerId = null;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.kp-close')) return;
            dragging = true;
            pointerId = e.pointerId;
            const rect = gui.getBoundingClientRect();
            dx = e.clientX - rect.left;
            dy = e.clientY - rect.top;
            try { header.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        header.addEventListener('pointermove', (e) => {
            if (!dragging || e.pointerId !== pointerId) return;
            let nl = e.clientX - dx;
            let nt = e.clientY - dy;
            nl = Math.max(0, Math.min(window.innerWidth - gui.offsetWidth, nl));
            nt = Math.max(0, Math.min(window.innerHeight - gui.offsetHeight, nt));
            gui.style.left = nl + 'px';
            gui.style.top = nt + 'px';
            gui.style.right = 'auto';
            gui.style.bottom = 'auto';
        });
        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            try { header.releasePointerCapture(pointerId); } catch (err) {}
            pointerId = null;
        }
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);

        /* ---- Grid-remount watcher ----
           Seed userPicks from the board only ONCE — the first time the grid
           appears — to capture any selection the user made before the panel
           opened. After that, the click-capture listener above is the sole
           source of truth. Re-reading the DOM on every re-mount was the bug:
           once a round resolves, the drawn RESULT tiles look "picked" to
           readPicksFromDOM, so they got folded into userPicks alongside the
           user's real picks (wrong count + wrong saved presets). Picks persist
           across rounds in userPicks, which matches how Keno betting works. */
        let _observedGrid = null;
        let _seeded = false;
        function seedPicksOnce() {
            if (_seeded || !getTiles().length) return;
            syncPicksFromDOM();
            _seeded = true;
        }
        setInterval(() => {
            const tiles = getTiles();
            if (!tiles.length) return;
            const gridParent = tiles[0].parentElement;
            if (gridParent && gridParent !== _observedGrid) {
                _observedGrid = gridParent;
                seedPicksOnce();
                renderCurrent();
            }
        }, 500);
        setInterval(renderCurrent, 800);

        renderPresets();
        seedPicksOnce();
        renderCurrent();
    }

    /* ============================================================
       ===========================================================
       TOOL: MINES AUTO-PLAY (Stake, Nuts, Shuffle)
       Floating panel with min/max tile inputs + Start/Stop. Tiles
       are clicked then play, with auto-cashout after reveal. Each
       platform has different tile/play/cashout selectors.
       ===========================================================
       ============================================================ */
    function isOnMinesPage() {
        const path = location.pathname || '';
        if (isShuffle()) return /\/games\/originals\/mines(?:\/|$|\?|#)/i.test(path);
        if (isNuts()) return /\/mines(?:\/|$|\?|#)/i.test(path);
        return /\/casino\/games\/mines(?:\/|$|\?|#)/i.test(path);
    }

    function tool_mines() {
        if (document.getElementById('mines-auto-gui')) return; // idempotent

        const TITLE = isShuffle() ? 'Shuffle Mines' : isNuts() ? 'Nuts Mines' : 'Stake Mines';
        // Nuts uses 2% house edge (verified live: 3 mines/22 picks → 2254×).
        // Stake + Shuffle both use 1%.
        const HOUSE_EDGE_MULT = isNuts() ? 0.98 : 0.99;
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const POLL_INTERVAL_MS = 15;
        const POST_WIN_PAUSE_MS = 200;
        const PAYOUT_DP = isNuts() ? 8 : 2;
        let isRunning = false;
        let runUrl = null;
        let totalRounds = 0, totalWins = 0, totalLosses = 0;

        /* ---- Helpers (math + utilities) ---- */
        function binomCoeff(n, k) {
            if (k < 0 || k > n) return 0;
            if (k === 0 || k === n) return 1;
            if (k > n - k) k = n - k;
            let result = 1;
            for (let i = 0; i < k; i++) result = result * (n - i) / (i + 1);
            return result;
        }
        function computeMinesMultiplier(picks, mines) {
            if (!isFinite(picks) || !isFinite(mines)) return NaN;
            if (picks < 1 || mines < 1 || mines > 24) return NaN;
            const safeTiles = 25 - mines;
            if (picks > safeTiles) return NaN;
            const top = binomCoeff(25, picks);
            const bot = binomCoeff(safeTiles, picks);
            if (!bot) return NaN;
            return HOUSE_EDGE_MULT * top / bot;
        }
        function weightedRandom(min, max) {
            const base = 1.5;
            let weights = [], total = 0;
            for (let i = min; i <= max; i++) {
                const w = Math.pow(base, max - i);
                weights.push(w); total += w;
            }
            let r = Math.random() * total, sum = 0;
            for (let idx = 0; idx < weights.length; idx++) {
                sum += weights[idx];
                if (r < sum) return min + idx;
            }
            return max;
        }

        /* ---- Per-platform DOM accessors ---- */
        function isVisible(el) {
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        }
        function isUsableButton(el) {
            return !!(el && isVisible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
        }
        function findButtonByText(text, partial = false) {
            const target = text.toLowerCase();
            const candidates = document.querySelectorAll('button, div[role="button"]');
            for (const el of candidates) {
                if (!isVisible(el)) continue;
                const txt = (el.textContent || '').toLowerCase().trim();
                if (partial ? txt.includes(target) : txt === target) return el;
            }
            return null;
        }
        function getShuffleBetButton() {
            return document.querySelector('button[data-testid="bet-button"]');
        }

        function getAllTiles() {
            if (isNuts()) return Array.from(document.querySelectorAll('div[class*="gtVEXU"]'));
            if (isShuffle()) return Array.from(document.querySelectorAll('button[class*="MinesGameTileWrapper_root"]'));
            return Array.from(document.querySelectorAll('button[data-game-tile-status]'));
        }
        function getIdleTiles() {
            if (isNuts()) {
                return getAllTiles().filter(el =>
                    window.getComputedStyle(el).cursor === 'pointer' ||
                    (el.getAttribute('style') || '').includes('cursor: pointer'));
            }
            if (isShuffle()) {
                // Shuffle: inline-style bg = rgb(32, 35, 41) for idle tiles.
                const IDLE_BG = 'rgb(32, 35, 41)';
                return getAllTiles().filter(t => {
                    const attrs = [
                        t.getAttribute('data-state'),
                        t.getAttribute('data-status'),
                        t.getAttribute('aria-label'),
                        t.className
                    ].join(' ');
                    if (/(idle|closed|hidden|unopened|default)/i.test(attrs)) return true;
                    const bg = t.style.backgroundColor || window.getComputedStyle(t).backgroundColor;
                    return bg === IDLE_BG || String(bg).replace(/\s+/g, '') === 'rgb(32,35,41)';
                });
            }
            // Stake: data-game-tile-status="idle"
            return Array.from(document.querySelectorAll('button[data-game-tile-status="idle"]'));
        }

        function getMinesCount() {
            if (isNuts()) {
                // Read "N MINES" text label.
                const labels = Array.from(document.querySelectorAll('*'))
                    .filter(el => el.children.length === 0 && /^\d+\s*MINES?$/i.test((el.textContent || '').trim()));
                if (!labels.length) return NaN;
                const m = labels[0].textContent.match(/(\d+)/);
                return m ? parseInt(m[1], 10) : NaN;
            }
            if (isShuffle()) {
                // Walk from "Mines" label up to FormControlWrapper, find select.
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
                    const btn = wrap.querySelector('button[class*="Select_button"]');
                    if (btn) {
                        const v = parseInt((btn.textContent || '').trim(), 10);
                        if (!isNaN(v) && v >= 1 && v < 25) return v;
                    }
                }
                return NaN;
            }
            const sel = document.querySelector('select[data-testid="mines-count"]');
            if (!sel) return NaN;
            const v = parseInt(sel.value, 10);
            return isNaN(v) ? NaN : v;
        }

        function getBetAmount() {
            if (isNuts()) {
                const inp = document.querySelector('input[aria-label="wager"]');
                return inp ? parseFloat(inp.value) : NaN;
            }
            if (isShuffle()) {
                const inp = document.querySelector('input[data-testid="bet-amount"]');
                return inp ? parseFloat(inp.value) : NaN;
            }
            const inp = document.querySelector('input[data-testid="input-game-amount"]');
            return inp ? parseFloat(inp.value) : NaN;
        }

        function isPlayReady() {
            if (isNuts()) {
                return !!(findButtonByText('PLAY') || findButtonByText('play', true));
            }
            if (isShuffle()) {
                const el = getShuffleBetButton();
                if (!isUsableButton(el)) return false;
                return /^play$/i.test((el.textContent || '').trim());
            }
            const el = document.querySelector('button[data-testid="bet-button"]');
            return !!(el && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
        }
        function clickPlay() {
            if (isNuts()) {
                const btn = findButtonByText('PLAY') || findButtonByText('play', true);
                if (!btn) return false;
                btn.click();
                return true;
            }
            if (isShuffle()) {
                if (!isPlayReady()) return false;
                const btn = getShuffleBetButton();
                if (!btn) return false;
                btn.click();
                return true;
            }
            const el = document.querySelector('button[data-testid="bet-button"]');
            if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            el.click();
            return true;
        }

        function findCashoutBtn() {
            if (isNuts()) return findButtonByText('CASHOUT') || findButtonByText('cashout', true);
            if (isShuffle()) {
                // Shuffle's mid-round REDEEM button (no testid). Exclude "Redeem Code" menu item.
                const direct = document.querySelector('button[data-testid="cashout-button"], button[data-testid="redeem-button"], button[data-testid*="cashout"], button[data-testid*="redeem"]');
                if (isUsableButton(direct) && !/code/i.test(direct.textContent || '')) return direct;
                const btns = document.querySelectorAll('button');
                for (const b of btns) {
                    if (!isUsableButton(b)) continue;
                    const t = (b.textContent || '').trim();
                    if (/code/i.test(t)) continue;
                    if (/^(redeem|cash\s*out|cashout)\b/i.test(t)) return b;
                }
                return null;
            }
            return document.querySelector('button[data-testid="cashout-button"]');
        }
        function isCashoutReady() {
            const el = findCashoutBtn();
            return !!(el && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
        }
        function clickCashout() {
            const el = findCashoutBtn();
            if (!el) return false;
            el.click();
            return true;
        }
        function isShuffleRoundInProgress() {
            if (!isShuffle()) return false;
            if (isCashoutReady()) return true;
            const betBtn = getShuffleBetButton();
            const betText = (betBtn && betBtn.textContent || '').trim();
            if (/^play$/i.test(betText)) return false;
            const all = getAllTiles();
            const idle = getIdleTiles();
            return all.length > 0 && idle.length > 0;
        }
        async function settleCashout(statusText) {
            if (!isCashoutReady()) return false;
            if (!clickCashout()) return false;
            totalRounds++; totalWins++;
            setStatus(statusText || 'Cashed out', '#10b981');
            await sleep(POST_WIN_PAUSE_MS);
            updateStats();
            return true;
        }

        function countRevealedGems() {
            // Stake: tiles with status="gem". Nuts/Shuffle: total - idle, but only
            // when a round is in progress (CASHOUT visible OR play not ready).
            if (!isNuts() && !isShuffle()) {
                return document.querySelectorAll('button[data-game-tile-status="gem"]').length;
            }
            const all = getAllTiles();
            if (all.length === 0) return NaN;
            const inRound = isNuts()
                ? !!(findButtonByText('CASHOUT') || findButtonByText('cashout', true))
                : (getIdleTiles().length < all.length && !isPlayReady());
            if (!inRound) return NaN;
            return all.length - getIdleTiles().length;
        }

        function getCurrentMultiplier() {
            // Stake exposes the live mid-round multiplier directly. Nuts/Shuffle
            // require computing it from the revealed-gem count + mines count.
            if (!isNuts() && !isShuffle()) {
                const labels = document.querySelectorAll('span[slot="label"]');
                for (const label of labels) {
                    const text = label.textContent || '';
                    if (text.includes('×')) {
                        const m = text.match(/([\d.,]+)×/);
                        if (m) return parseFloat(m[1].replace(/,/g, ''));
                    }
                }
                return NaN;
            }
            const revealed = countRevealedGems();
            const mines = getMinesCount();
            if (isFinite(revealed) && revealed > 0 && !isNaN(mines)) {
                return computeMinesMultiplier(revealed, mines);
            }
            return NaN;
        }
        function getCurrentPayout() {
            if (!isNuts() && !isShuffle()) {
                const inp = document.querySelector('input[data-testid="profit-input"]');
                return inp ? parseFloat(inp.value) : NaN;
            }
            const mult = getCurrentMultiplier();
            const bet = getBetAmount();
            return (!isNaN(mult) && isFinite(bet) && bet > 0) ? bet * mult : NaN;
        }

        function getSafeTileCount() {
            const mines = getMinesCount();
            if (isNaN(mines)) return 24;
            return Math.max(1, 25 - mines);
        }

        /* ---- Live + state ---- */
        const urlChanged = () => runUrl !== null && !isOnMinesPage();
        const stillLive = () => isRunning && !urlChanged();

        async function waitFor(predicate, timeoutMs) {
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                if (!stillLive()) return false;
                try { if (predicate()) return true; } catch (e) {}
                await sleep(POLL_INTERVAL_MS);
            }
            return false;
        }

        /* ---- Bot loops (per platform) ---- */
        // Stake serializes tile clicks: click one, wait for its data-game-tile-status
        // to transition out of 'idle' (gem or mine), then decide. The serial path
        // gives 100%-accurate bust detection on Stake's React tree.
        async function clickRandomTileAndWaitStake() {
            const idle = getIdleTiles();
            if (idle.length === 0) return { ok: false, busted: false };
            const tile = idle[Math.floor(Math.random() * idle.length)];
            tile.click();
            await waitFor(() => tile.getAttribute('data-game-tile-status') !== 'idle', 600);
            const finalStatus = (tile.getAttribute('data-game-tile-status') || '').toLowerCase();
            return { ok: true, busted: finalStatus.indexOf('mine') >= 0 };
        }

        // Nuts + Shuffle: batch-pick (fire all N clicks synchronously), then poll
        // for round end. Verified ~10× faster than per-pick serial on Shuffle.
        async function batchPickTiles(want) {
            const idle = getIdleTiles();
            if (idle.length === 0) return { ok: false, busted: false, fired: 0 };
            const n = Math.min(want, idle.length);
            const total = getAllTiles().length;
            const revealedBefore = total - idle.length;
            // Partial Fisher-Yates to pick n distinct random tiles
            const arr = idle.slice();
            for (let i = arr.length - 1; i > arr.length - 1 - n; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            const picked = arr.slice(arr.length - n);
            for (const t of picked) {
                t.click();
                await sleep(30);
            }
            await waitFor(() => {
                const idleNow = getIdleTiles().length;
                if (idleNow === 0) return true; // bust — every tile reveals on Shuffle/Nuts loss
                return (total - idleNow) >= revealedBefore + n; // our picks landed
            }, 3000);
            const busted = getIdleTiles().length === 0;
            if (!busted) await waitFor(findCashoutBtn, 500);
            return { ok: true, busted, fired: n };
        }

        async function doOneRound() {
            if (!stillLive()) return;
            setStatus('Running');

            let resumedShuffleRound = false;
            if (isShuffle() && !isPlayReady()) {
                if (await settleCashout('Resynced cashout')) return;
                resumedShuffleRound = isShuffleRoundInProgress();
                if (resumedShuffleRound) setStatus('Resyncing round');
            }

            // Safety kill switch: 20s without a clickable Play button → assume
            // out-of-balance (or other terminal state) and stop. Without this
            // the bot silently spins forever waiting for funds.
            if (!resumedShuffleRound) {
                const playWaitStart = Date.now();
                const MAX_PLAY_WAIT_MS = 20000;
                if (!await waitFor(isPlayReady, MAX_PLAY_WAIT_MS)) {
                    if (isRunning && Date.now() - playWaitStart >= MAX_PLAY_WAIT_MS) {
                        setStatus('Stopped — out of balance', '#ef4444');
                        stopBot();
                    }
                    return;
                }
                if (!stillLive()) return;

                if (!clickPlay()) { await sleep(100); return; }

                // Wait for the round to actually start — idle tiles appear once
                // the bet is placed. <100ms typical.
                if (!await waitFor(() => getIdleTiles().length > 0, 2500)) return;
            }
            if (!stillLive()) return;

            const min = parseInt(minInp.value) || 1;
            const max = parseInt(maxInp.value) || Math.min(5, getSafeTileCount());
            const want = weightedRandom(min, max);
            setStatus(`Picking ${want} tiles`);

            let busted = false;
            if (!isNuts() && !isShuffle()) {
                // Stake serial path
                for (let i = 0; i < want; i++) {
                    if (!stillLive()) return;
                    const result = await clickRandomTileAndWaitStake();
                    if (!result.ok) break;
                    if (result.busted) { busted = true; setStatus('Busted', '#ef4444'); break; }
                }
            } else {
                // Nuts / Shuffle batch path
                const result = await batchPickTiles(want);
                if (!stillLive()) return;
                if (!result.ok) return;
                busted = result.busted;
                if (busted) setStatus('Busted', '#ef4444');
            }
            if (!stillLive()) return;

            if (busted) {
                totalRounds++; totalLosses++; updateStats();
                return;
            }

            // Win path: wait for cashout to settle then click it.
            if (!await waitFor(() => isCashoutReady() || isPlayReady(), 3000)) {
                if (isShuffle() && await settleCashout('Resynced cashout')) return;
                return; // weird state — next iteration recovers
            }
            if (!stillLive()) return;
            if (isCashoutReady()) await settleCashout('Cashed out');
        }

        async function botLoop() {
            while (stillLive()) {
                try { await doOneRound(); }
                catch (e) { console.error('[Mines] loop error:', e); await sleep(300); }
            }
            if (urlChanged()) { setStatus('Stopped — navigated away', '#ef4444'); stopBot(); }
        }

        /* ---- UI ---- */
        addStyle(`
            #mines-auto-gui {
                position: fixed;
                top: max(80px, env(safe-area-inset-top));
                right: max(12px, env(safe-area-inset-right));
                z-index: 2147483646;
                width: 240px; max-width: calc(100vw - 24px);
                background: linear-gradient(180deg, rgba(26, 44, 56, 0.97), rgba(15, 33, 46, 0.97));
                color: #f5fbff;
                border: 1px solid var(--mn-border, rgba(82, 109, 130, 0.55));
                border-radius: 12px;
                box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 12px;
                -webkit-user-select: none; user-select: none;
                touch-action: none;
            }
            #mines-auto-gui.shuffle-theme {
                --mn-accent: #6c47ff;
                --mn-border: rgba(108, 71, 255, 0.45);
                background: linear-gradient(180deg, rgba(26, 18, 56, 0.97), rgba(10, 8, 24, 0.97));
            }
            #mines-auto-gui.nuts-theme {
                --mn-accent: #19f3ff;
                --mn-border: rgba(143, 99, 255, 0.45);
                background: linear-gradient(180deg, rgba(36, 42, 56, 0.95), rgba(14, 18, 28, 0.97));
            }
            #mines-auto-gui:not(.shuffle-theme):not(.nuts-theme) { --mn-accent: #00ff9d; }
            #mines-auto-gui .mn-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px;
                background: rgba(255, 255, 255, 0.03);
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 12px 12px 0 0;
                cursor: grab;
            }
            #mines-auto-gui .mn-header:active { cursor: grabbing; }
            #mines-auto-gui .mn-title {
                font-weight: 800; font-size: 12px;
                text-transform: uppercase; letter-spacing: 0.5px;
                color: var(--mn-accent);
            }
            #mines-auto-gui .mn-close {
                background: none; border: none; color: #94a3b8;
                cursor: pointer; padding: 4px 10px; font-size: 20px;
                line-height: 1; border-radius: 6px; min-height: 32px;
                -webkit-tap-highlight-color: transparent; touch-action: manipulation;
            }
            #mines-auto-gui .mn-close:active { color: #fff; background: rgba(255, 255, 255, 0.08); }
            #mines-auto-gui .mn-content { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
            #mines-auto-gui .mn-row { display: flex; gap: 6px; align-items: center; }
            #mines-auto-gui label {
                flex: 1; color: #94a3b8;
                font-size: 10px; font-weight: 700;
                text-transform: uppercase; letter-spacing: 0.3px;
            }
            #mines-auto-gui input[type="number"] {
                width: 70px;
                background: #0b0e17; color: #fff;
                border: 1px solid #2f4553; border-radius: 6px;
                padding: 6px 8px; font-size: 12px; font-weight: 700;
                text-align: center; outline: none; min-height: 32px;
                -webkit-appearance: none; appearance: none;
                font-family: "Roboto Mono", monospace;
            }
            #mines-auto-gui input[type="number"]:focus { border-color: var(--mn-accent); }
            #mines-auto-gui .mn-btn {
                width: 100%; min-height: 40px;
                border-radius: 8px; cursor: pointer;
                font-weight: 900; font-size: 12px;
                text-transform: uppercase; letter-spacing: 0.5px;
                font-family: inherit;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
            }
            #mines-auto-gui .mn-btn.start {
                background: var(--mn-accent); color: #0f212e; border: none;
            }
            #mines-auto-gui.shuffle-theme .mn-btn.start,
            #mines-auto-gui.nuts-theme .mn-btn.start { color: #fff; }
            #mines-auto-gui .mn-btn.stop {
                background: #e11d48; color: #fff; border: none;
            }
            #mines-auto-gui .mn-status {
                font-size: 11px; color: #94a3b8;
                text-align: center; min-height: 14px;
                font-family: "Roboto Mono", monospace;
            }
            #mines-auto-gui .mn-section {
                padding: 8px 10px;
                background: rgba(0, 0, 0, 0.22);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                display: flex; flex-direction: column; gap: 4px;
            }
            #mines-auto-gui .mn-section-title {
                font-size: 9px; font-weight: 800;
                text-transform: uppercase; letter-spacing: 0.5px;
                color: var(--mn-accent);
                text-align: center; margin-bottom: 2px;
            }
            #mines-auto-gui .mn-stat-row {
                display: flex; justify-content: space-between; align-items: baseline;
                font-size: 11px;
            }
            #mines-auto-gui .mn-stat-row span:first-child {
                color: #94a3b8;
                font-size: 10px;
                text-transform: uppercase;
                letter-spacing: 0.3px;
            }
            #mines-auto-gui .mn-stat-row span:last-child {
                color: #fff; font-weight: 800;
                font-family: "Roboto Mono", monospace;
            }
            #mines-auto-gui .mn-section.projected .mn-stat-row span:last-child {
                color: var(--mn-accent);
            }
            #mines-auto-gui .mn-runs {
                padding: 6px 10px;
                background: rgba(0, 0, 0, 0.22);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 8px;
                font-size: 10px; color: #94a3b8;
                font-family: "Roboto Mono", monospace;
                text-align: center;
            }
            #mines-auto-gui .mn-runs b { color: var(--mn-accent); }
        `);

        const gui = document.createElement('div');
        gui.id = 'mines-auto-gui';
        if (isShuffle()) gui.classList.add('shuffle-theme');
        if (isNuts()) gui.classList.add('nuts-theme');
        gui.innerHTML = `
            <div class="mn-header">
                <span class="mn-title">${TITLE}</span>
                <button class="mn-close" id="mn-close" title="Close">×</button>
            </div>
            <div class="mn-content">
                <div class="mn-row">
                    <label>Min picks</label>
                    <input id="mn-min" type="number" min="1" max="24" value="3">
                </div>
                <div class="mn-row">
                    <label>Max picks</label>
                    <input id="mn-max" type="number" min="1" max="24" value="8">
                </div>
                <button class="mn-btn start" id="mn-toggle">START</button>
                <div class="mn-status" id="mn-status">Idle</div>
                <div class="mn-section live">
                    <div class="mn-section-title">Live Stats</div>
                    <div class="mn-stat-row"><span>Multiplier</span><span id="mn-mult">—</span></div>
                    <div class="mn-stat-row"><span>Payout</span><span id="mn-payout">—</span></div>
                    <div class="mn-stat-row"><span>Next Gem</span><span id="mn-chance">—</span></div>
                </div>
                <div class="mn-section projected">
                    <div class="mn-section-title">Projected Range</div>
                    <div class="mn-stat-row"><span>Min Mult</span><span id="mn-min-mult">—</span></div>
                    <div class="mn-stat-row"><span>Max Mult</span><span id="mn-max-mult">—</span></div>
                    <div class="mn-stat-row"><span>Min Payout</span><span id="mn-min-payout">—</span></div>
                    <div class="mn-stat-row"><span>Max Payout</span><span id="mn-max-payout">—</span></div>
                </div>
                <div class="mn-runs" id="mn-runs">Rounds: <b>0</b> · W: <b>0</b> · L: <b>0</b></div>
            </div>
        `;
        document.body.appendChild(gui);

        const header = gui.querySelector('.mn-header');
        const minInp = gui.querySelector('#mn-min');
        const maxInp = gui.querySelector('#mn-max');
        const toggleBtn = gui.querySelector('#mn-toggle');
        const statusEl = gui.querySelector('#mn-status');
        const runsEl = gui.querySelector('#mn-runs');
        const closeBtn = gui.querySelector('#mn-close');
        // Live stats refs
        const multEl = gui.querySelector('#mn-mult');
        const payoutEl = gui.querySelector('#mn-payout');
        const chanceEl = gui.querySelector('#mn-chance');
        // Projected range refs
        const minMultEl = gui.querySelector('#mn-min-mult');
        const maxMultEl = gui.querySelector('#mn-max-mult');
        const minPayoutEl = gui.querySelector('#mn-min-payout');
        const maxPayoutEl = gui.querySelector('#mn-max-payout');

        function setStatus(txt, color) {
            statusEl.textContent = txt || '';
            statusEl.style.color = color || '#94a3b8';
        }
        function updateStats() {
            runsEl.innerHTML = `Rounds: <b>${totalRounds}</b> · W: <b>${totalWins}</b> · L: <b>${totalLosses}</b>`;
        }

        /* ---- Pick clamping (max attribute + blur clamp) ---- */
        let _lastSafe = null;
        function syncCaps() {
            const safe = getSafeTileCount();
            minInp.max = String(safe);
            maxInp.max = String(safe);
            return safe;
        }
        function clampInputs() {
            const safe = getSafeTileCount();
            const minFocused = document.activeElement === minInp;
            const maxFocused = document.activeElement === maxInp;
            let mn = parseInt(minInp.value); if (isNaN(mn)) mn = 1;
            let mx = parseInt(maxInp.value); if (isNaN(mx)) mx = 1;
            mn = Math.max(1, Math.min(mn, safe));
            mx = Math.max(1, Math.min(mx, safe));
            if (mn > mx) mx = mn;
            if (!minFocused && minInp.value !== String(mn)) minInp.value = String(mn);
            if (!maxFocused && maxInp.value !== String(mx)) maxInp.value = String(mx);
        }

        /* ---- Live Stats + Projected Range updater ---- */
        function updateInfo() {
            const safe = syncCaps();
            if (_lastSafe !== null && _lastSafe !== safe) clampInputs();
            _lastSafe = safe;

            const mines = getMinesCount();
            const bet = getBetAmount();
            const minPicks = parseInt(minInp.value);
            const maxPicks = parseInt(maxInp.value);

            // ---- Live Stats ----
            const liveMult = getCurrentMultiplier();
            const livePayout = getCurrentPayout();
            let chanceText = '—';
            const revealed = countRevealedGems();
            if (isFinite(revealed) && revealed >= 0 && !isNaN(mines)) {
                const remaining = 25 - revealed;
                const safeRemaining = (25 - mines) - revealed;
                if (remaining > 0 && safeRemaining >= 0) {
                    chanceText = ((safeRemaining / remaining) * 100).toFixed(2) + '%';
                }
            }
            multEl.textContent = isNaN(liveMult) ? '—' : liveMult.toFixed(2) + '×';
            payoutEl.textContent = isNaN(livePayout) ? '—' : livePayout.toFixed(PAYOUT_DP);
            chanceEl.textContent = chanceText;

            // ---- Projected Range ----
            if (isNaN(minPicks) || isNaN(maxPicks) || isNaN(mines)) {
                minMultEl.textContent = '—';
                maxMultEl.textContent = '—';
                minPayoutEl.textContent = '—';
                maxPayoutEl.textContent = '—';
                return;
            }
            const cMin = Math.max(1, Math.min(minPicks, safe));
            const cMax = Math.max(cMin, Math.min(maxPicks, safe));
            const minMult = computeMinesMultiplier(cMin, mines);
            const maxMult = computeMinesMultiplier(cMax, mines);
            minMultEl.textContent = isNaN(minMult) ? '—' : minMult.toFixed(2) + '×';
            maxMultEl.textContent = isNaN(maxMult) ? '—' : maxMult.toFixed(2) + '×';
            if (isFinite(bet) && bet > 0) {
                minPayoutEl.textContent = isNaN(minMult) ? '—' : (bet * minMult).toFixed(PAYOUT_DP);
                maxPayoutEl.textContent = isNaN(maxMult) ? '—' : (bet * maxMult).toFixed(PAYOUT_DP);
            } else {
                minPayoutEl.textContent = '—';
                maxPayoutEl.textContent = '—';
            }
        }

        /* ---- Start / Stop ---- */
        function startBot() {
            if (isRunning) return;
            if (!isOnMinesPage()) { setStatus('Not on Mines page', '#ef4444'); return; }
            isRunning = true;
            runUrl = location.pathname;
            toggleBtn.textContent = 'STOP';
            toggleBtn.classList.remove('start');
            toggleBtn.classList.add('stop');
            setStatus('Running', '#10b981');
            botLoop();
        }
        function stopBot() {
            isRunning = false;
            runUrl = null;
            toggleBtn.textContent = 'START';
            toggleBtn.classList.remove('stop');
            toggleBtn.classList.add('start');
        }

        /* ---- Wire UI events ---- */
        toggleBtn.addEventListener('click', () => {
            if (isRunning) stopBot();
            else startBot();
        });
        closeBtn.addEventListener('click', () => {
            stopBot();
            gui.remove();
        });
        ['input'].forEach(ev => {
            minInp.addEventListener(ev, updateInfo);
            maxInp.addEventListener(ev, updateInfo);
        });
        minInp.addEventListener('blur', () => { clampInputs(); updateInfo(); });
        maxInp.addEventListener('blur', () => { clampInputs(); updateInfo(); });
        window.addEventListener('beforeunload', stopBot);

        // Live refresh — 1s cadence matches desktop. Re-syncs caps when the
        // user changes the in-game mines count, and updates Live Stats every tick.
        setInterval(updateInfo, 1000);
        clampInputs();
        updateInfo();
        updateStats();

        /* ---- Pointer Events drag ---- */
        let dragging = false, dx = 0, dy = 0, pointerId = null;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.mn-close')) return;
            dragging = true;
            pointerId = e.pointerId;
            const rect = gui.getBoundingClientRect();
            dx = e.clientX - rect.left;
            dy = e.clientY - rect.top;
            try { header.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        header.addEventListener('pointermove', (e) => {
            if (!dragging || e.pointerId !== pointerId) return;
            let nl = e.clientX - dx;
            let nt = e.clientY - dy;
            nl = Math.max(0, Math.min(window.innerWidth - gui.offsetWidth, nl));
            nt = Math.max(0, Math.min(window.innerHeight - gui.offsetHeight, nt));
            gui.style.left = nl + 'px';
            gui.style.top = nt + 'px';
            gui.style.right = 'auto';
            gui.style.bottom = 'auto';
        });
        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            try { header.releasePointerCapture(pointerId); } catch (err) {}
            pointerId = null;
        }
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);
    }

    /* ============================================================
       ===========================================================
       TOOL: AUTO-VAULT (Stake, Nuts, Shuffle)
       Watches balance; when it grows past a configured threshold,
       deposits the excess into the platform's vault. Uses each
       platform's native deposit flow (no fetch hooks where possible
       to stay iOS-friendly).
       ===========================================================
       ============================================================ */
/* === source: stake-7day-tracker (mobile) v2.20.2 — embedded as a bundle tool === */
function tool_stake_7day_tracker() {
    'use strict';
    if (window.__stk7wToolBooted) return;
    window.__stk7wToolBooted = true;

    /* =========================================================================
       Stake 7-Day Rolling Wager Tracker  (lifetime-counter model)
       -------------------------------------------------------------------------
       HOW IT WORKS  (v2.8: switched the TOTAL from the weekly raffle to Stake's
       authoritative lifetime wager counter)
       - TOTAL (authoritative): Stake's API exposes a lifetime, never-resetting
         "amount wagered" per currency+scope via user{statisticScoped{betAmount
         currency scope}}. On stake.us we read ONLY the SC row (currency "sweeps",
         scope "house" = all casino incl. slots); GC is irrelevant and ignored.
         On the crypto sites we sum betValue (USD-equiv) across currencies. We
         snapshot this counter over time into "ltAnchors" and compute:
            rolling 168h = lifetime(now) - lifetime(>=7d ago).
         Because the counter never resets and isn't ticket-quantised, this removes
         the old raffle model's two error sources (the weekly-reset carry-over and
         ticket rounding). It is exact except for a sub-poll-interval sliver at the
         7-day-ago edge.
       - WHY ltAnchors (not the old `anchors`): the lifetime counter is on a totally
         different scale than the old raffle everCum. We keep the new snapshots in a
         separate field so an OLD script version left running in another tab can't
         mix scales with us. On first run we BRIDGE the existing raffle anchors into
         ltAnchors (offset-aligned to the current lifetime value) so the headline is
         continuous and full-window immediately, then it heals to pinpoint as real
         lifetime snapshots replace the bridged ones over the following 7 days.
       - FALL-OFF CHART (v2.10): an interactive "conveyor" canvas chart. LIVE/now is the
         LEFT edge; bets drift RIGHT as they age and fall off the RIGHT edge at 168h. Red
         density bars (height = bet count per pixel-column) come from the bounded 1-min
         gbins; true per-bet ticks (this session, from sessionTicks) overlay at deep zoom.
         Stock-chart UX: scroll = zoom (5 min … 168h), drag = pan, ⟲ snaps back to live,
         adaptive time axis scales to the minute. Hover → crosshair + a tooltip with the
         exact date/time that wager falls off (= bet time + 168h). (The old v2.8 red "↓"
         readout was removed — the chart conveys fall-off precisely now.)
       - LIVE OVERLAY: per-bet motion captured from the feed (liveDelta) ticks the
         headline between counter polls; each poll the counter catches up and draws
         liveDelta down, so the number stays monotonic and converges to exact.
       - RTP buckets: still a LABELED "live sample" from feed-captured bets, bucketed
         by each game's API house edge, aggregated into bounded 10-min bins covering
         the full 168h at fixed tiny size. NOT your true total (the counter gives no
         RTP breakdown).
       - The raffle is still polled, but ONLY to show your Tickets count.

       MULTI-ACCOUNT: data is partitioned by the logged-in account (user id),
       auto-detected. Switching accounts switches the tracked data.

       MULTI-TAB: state shared via localStorage and merged (anchors by time, bins
       per-writer). The lifetime counter is a server-side value, so every tab reads
       the identical number -- the headline is robust to multiple tabs.

       MULTI-DEVICE: the lifetime counter includes play from ALL devices (mobile app,
       mobile web, desktop), so the "now" total is always complete the instant any tab
       polls. localStorage can't sync across devices, so only the 7-day-ago baseline
       is per-device; it stays accurate as long as that device snapshots near that
       time. The old reset-seam corruption (often triggered by device-swapping) is gone.

       PRIVACY: everything is stored locally in this browser. Nothing is sent out.
       ========================================================================= */

    var VERSION   = '2.20.2-m1';                       // bump on every change; surfaced in the HUD (data-ver) so the running build is verifiable
    var WINDOW_MS = 7 * 24 * 60 * 60 * 1000;       // rolling window: 7 days
    var KEEP_MS   = 8 * 24 * 60 * 60 * 1000;       // retain bets a little past the window
    var STORE_KEY = 'stk7w:v5';   // v5: data partitioned per account (userId)
    var GQL_RE    = /graphql/i;

    // --- v2.10: fall-off chart zoom bounds --------------------------------------
    // The chart's visible time span is continuously zoomable between these.
    var GSPAN_MIN  = 5 * 60 * 1000;                // max zoom-IN: 5 minutes visible (minute / per-bet detail)
    var GSPAN_MAX  = WINDOW_MS;                     // max zoom-OUT: the full 168h window
    var GTICK_SPAN = 60 * 60 * 1000;               // overlay true per-bet session ticks when the span is <= 1h

    // --- v2.7: bounded RTP buckets ---------------------------------------------
    var BIN_MS         = 10 * 60 * 1000;                    // RTP-bucket bin size (10 min)
    var GBIN_MS        = 1 * 60 * 1000;                     // v2.9 fall-off GRAPH bin size (1 min) — finer density, still bounded (~100KB)
    var GTICKS_CAP     = 12000;                             // v2.9 in-memory per-bet ticks for the graph overlay (this session only; NOT persisted)
    var BIN_KEEP_MS    = WINDOW_MS + 60 * 60 * 1000;        // keep bins ~1h past the window
    var BETS_CAP       = 200;                               // raw bets now only a debug ring; buckets read bins, not this
    var LIVEID_KEEP_MS = 10 * 60 * 1000;                    // de-dupe ids only need to outlive feed re-sends (sec–min), not 8 days
    var WRITER_ID = (function () {
        try {
            var w = sessionStorage.getItem('stk7w:writer');
            if (!w) { w = 'w' + Math.random().toString(36).slice(2, 9); sessionStorage.setItem('stk7w:writer', w); }
            return w;
        } catch (e) { return 'w' + Math.random().toString(36).slice(2, 9); }
    })();

    // Platform: stake.us is the social casino (SC/GC). Everything else (stake.com
    // and its mirrors) is the crypto site, where we track a single COMBINED USD total.
    var IS_SOCIAL = /(^|\.)stake\.us$/i.test(location.hostname);
    var TRACK_CCY = IS_SOCIAL ? ['SC'] : ['USD'];   // social: SC ONLY (GC is irrelevant). crypto: combined USD
    var rates = {};                                  // crypto: currency(lowercase) -> USD per unit
    var liveDelta = 0;
    var liveSince = Date.now();                      // ignore backfill (bets placed before tracking began)
    var sessionTicks = [];                           // v2.9: {t,amt} of bets captured THIS session, for the graph's per-bet overlay (memory only, never persisted)
    function getCookie(n) {
        var m = document.cookie.match('(^|;)\\s*' + n + '\\s*=\\s*([^;]+)');
        return m ? m.pop().replace(/"/g, '') : '';
    }

    /* ----------------------------- storage ------------------------------- */
    function blankCur() {
        return { bets: [], liveIds: {}, trackStart: 0, bins: {}, gbins: {} };   // bins: RTP (10-min){h,m,l,n}; gbins: graph density (1-min){n,w}; both bounded
    }
    function blankAccount() {
        // total wager comes from the lifetime counter: ltAnchors are its snapshots,
        // differenced for the rolling 168h. The old raffle fields (anchors/base/period)
        // are vestigial (kept so a bridge/rollback is possible); tickets still shown.
        return {
            name: null, target: 0, targetAt: 0,
            anchors: [], base: 0, periodStart: null, lastPeriodWager: 0, tickets: null,
            ltAnchors: [], ltSeeded: false, ltStart: 0,   // v2.8 lifetime-counter snapshots
            cur: {}, resetAt: {}
        };
    }
    var EMPTY_REC = blankCur();  // read-only stand-in returned before an account is detected
    var DEFAULTS = {
        v: 5,
        currency: 'SC',          // currency shown in the HUD
        gameEdge: {},            // normalised game key -> house edge % (shared across accounts)
        ui: { open: false, left: null, top: null, graphOpen: false, graphSpan: 604800000, graphLive: true },
        accounts: {},            // userId -> blankAccount()
        active: null,            // logged-in userId (auto-detected; switches with the account)
        debug: [],               // notes (ring buffer)
        diag: []                 // bet-owner samples (ring buffer)
    };
    var S = load();
    function load() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (raw) {
                var p = JSON.parse(raw);
                return Object.assign({}, DEFAULTS, p, { ui: Object.assign({}, DEFAULTS.ui, p.ui || {}) });
            }
        } catch (e) {}
        return JSON.parse(JSON.stringify(DEFAULTS));
    }
    // Don't display a currency we no longer track (e.g. a stale 'GC' selection).
    if (TRACK_CCY.indexOf(S.currency) < 0) S.currency = TRACK_CCY[0];

    // One-time migration from the pre-multi-account stores (v3/v4, single-account S.cur).
    var legacyMigrate = null;
    (function detectLegacy() {
        if (Object.keys(S.accounts || {}).length) return;   // already on the new model
        ['stk7w:v4', 'stk7w:v3'].forEach(function (key) {
            if (legacyMigrate) return;
            try {
                var p = JSON.parse(localStorage.getItem(key) || 'null');
                if (p && p.cur && Object.keys(p.cur).some(function (c) { return p.cur[c] && (p.cur[c].bets || []).length; })) {
                    legacyMigrate = { cur: p.cur, target: p.target || 0, resetAt: p.resetAt || {}, from: key };
                }
            } catch (e) {}
        });
    })();
    function curHasBets(a) { return !!(a && a.cur && Object.keys(a.cur).some(function (c) { return (a.cur[c].bets || []).length; })); }
    // --- multi-tab safe merge ----------------------------------------------
    function mergeCur(a, b) {
        a = a || blankCur(); b = b || blankCur();
        var byK = {}, order = [];
        function add(x) {
            var key = x.k || ('t' + x.t + '_' + x.amt + '_' + (x.game || ''));
            if (!(key in byK)) { byK[key] = x; order.push(key); }
        }
        (a.bets || []).forEach(add); (b.bets || []).forEach(add);
        var bets = order.map(function (k) { return byK[k]; }).sort(function (x, y) { return x.t - y.t; });
        if (bets.length > BETS_CAP) bets = bets.slice(bets.length - BETS_CAP);   // bets is now just a small debug ring
        var bins = {};
        [a.bins, b.bins].forEach(function (src) {
            if (!src) return;
            Object.keys(src).forEach(function (w) {
                var dw = bins[w] || (bins[w] = {});
                Object.keys(src[w]).forEach(function (bk) {
                    var s = src[w][bk] || {}, d = dw[bk] || (dw[bk] = { h: 0, m: 0, l: 0, n: 0 });
                    if ((s.h || 0) > d.h) d.h = s.h; if ((s.m || 0) > d.m) d.m = s.m;
                    if ((s.l || 0) > d.l) d.l = s.l; if ((s.n || 0) > d.n) d.n = s.n;
                });
            });
        });
        // v2.9 graph bins (1-min {n,w}): same per-(writer,bin) max merge as RTP bins.
        var gbins = {};
        [a.gbins, b.gbins].forEach(function (src) {
            if (!src) return;
            Object.keys(src).forEach(function (w) {
                var dw = gbins[w] || (gbins[w] = {});
                Object.keys(src[w]).forEach(function (bk) {
                    var s = src[w][bk] || {}, d = dw[bk] || (dw[bk] = { n: 0, w: 0 });
                    if ((s.n || 0) > d.n) d.n = s.n; if ((s.w || 0) > d.w) d.w = s.w;
                });
            });
        });
        var ts = [a.trackStart, b.trackStart].filter(function (t) { return t; });
        var liveIds = Object.assign({}, a.liveIds || {}, b.liveIds || {});
        var liveMinT = Date.now() - LIVEID_KEEP_MS;
        for (var lk in liveIds) { if (liveIds[lk] < liveMinT) delete liveIds[lk]; }
        return {
            bets: bets,
            liveIds: liveIds,
            trackStart: ts.length ? Math.min.apply(null, ts) : 0,
            bins: bins,
            gbins: gbins,
            _mig: a._mig || b._mig || 0,      // carry the one-time legacy-migration flag through merges
            _gseed: a._gseed || b._gseed || 0 // carry the one-time graph-bin seed flag through merges
        };
    }
    // Union an anchor-style array (by timestamp), sorted ascending.
    function unionAnchors(aArr, bArr) {
        var byT = {}, ord = [];
        function addP(p) { if (!p) return; var k = '' + p.t; if (!(k in byT)) { byT[k] = p; ord.push(k); } }
        (aArr || []).forEach(addP); (bArr || []).forEach(addP);
        return ord.map(function (k) { return byT[k]; }).sort(function (x, y) { return x.t - y.t; });
    }
    function mergeAccount(aa, bb) {
        aa = aa || blankAccount(); bb = bb || blankAccount();
        var cur = {}, ccys = {};
        Object.keys(aa.cur || {}).forEach(function (c) { ccys[c] = 1; });
        Object.keys(bb.cur || {}).forEach(function (c) { ccys[c] = 1; });
        Object.keys(ccys).forEach(function (c) { cur[c] = mergeCur((aa.cur || {})[c], (bb.cur || {})[c]); });
        var resetAt = {};
        [aa.resetAt, bb.resetAt].forEach(function (r) {
            if (r) Object.keys(r).forEach(function (c) { resetAt[c] = Math.max(resetAt[c] || 0, r[c] || 0); });
        });
        Object.keys(cur).forEach(function (c) {
            var ra = resetAt[c] || 0; if (!ra) return;
            var rec = cur[c];
            rec.bets = (rec.bets || []).filter(function (x) { return x.t >= ra; });
            rec.trackStart = rec.bets.length ? rec.bets[0].t : 0;
        });
        // everCum (legacy/raffle): keep base/period from whichever tab is fresher.
        var aEver = (aa.base || 0) + (aa.lastPeriodWager || 0);
        var bEver = (bb.base || 0) + (bb.lastPeriodWager || 0);
        var fresher = bEver >= aEver ? bb : aa;
        var anchors = unionAnchors(aa.anchors, bb.anchors);
        // v2.8 lifetime snapshots: union by timestamp; bridged flag ORs; ltStart = earliest truthy.
        var ltAnchors = unionAnchors(aa.ltAnchors, bb.ltAnchors);
        var ltStarts = [aa.ltStart, bb.ltStart].filter(function (t) { return t; });
        var tgtSide = (bb.targetAt || 0) >= (aa.targetAt || 0) ? bb : aa;
        return {
            name: bb.name || aa.name || null,
            target: tgtSide.target || 0,
            targetAt: Math.max(aa.targetAt || 0, bb.targetAt || 0),
            base: fresher.base || 0,
            periodStart: fresher.periodStart || null,
            lastPeriodWager: fresher.lastPeriodWager || 0,
            tickets: (fresher.tickets != null ? fresher.tickets : (bb.tickets != null ? bb.tickets : (aa.tickets != null ? aa.tickets : null))),
            anchors: anchors,
            ltAnchors: ltAnchors,
            ltSeeded: !!(aa.ltSeeded || bb.ltSeeded),
            ltStart: ltStarts.length ? Math.min.apply(null, ltStarts) : 0,
            cur: cur,
            resetAt: resetAt
        };
    }
    function mergeState(a, b) {
        a = (a && typeof a === 'object') ? a : {};
        b = (b && typeof b === 'object') ? b : {};
        var out = { v: 5, accounts: {} };
        var ids = {};
        Object.keys(a.accounts || {}).forEach(function (id) { ids[id] = 1; });
        Object.keys(b.accounts || {}).forEach(function (id) { ids[id] = 1; });
        Object.keys(ids).forEach(function (id) { out.accounts[id] = mergeAccount((a.accounts || {})[id], (b.accounts || {})[id]); });
        out.gameEdge = Object.assign({}, a.gameEdge || {}, b.gameEdge || {});
        out.active = b.active || a.active || null;
        out.currency = b.currency || a.currency || 'SC';
        out.ui = b.ui || a.ui || { open: true, left: null, top: null };
        out.debug = (b.debug && b.debug.length ? b.debug : (a.debug || []));
        out.diag = (b.diag && b.diag.length ? b.diag : (a.diag || []));
        return out;
    }
    function readStored() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { return {}; } }
    function writeMerged() {
        S = mergeState(readStored(), S);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) {}
    }
    var saveQueued = false;
    function save() {
        if (saveQueued) return;
        saveQueued = true;
        setTimeout(function () { saveQueued = false; writeMerged(); }, 250);
    }
    function flushSave() { writeMerged(); }
    try {
        window.addEventListener('pagehide', flushSave);
        document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushSave(); });
        window.addEventListener('storage', function (e) {
            if (e.key && e.key !== STORE_KEY) return;
            S = mergeState(S, readStored());
            if (hud.target && document.activeElement !== hud.target) hud.target.value = getTarget() || '';
            scheduleRender();
        });
    } catch (e) {}
    function acct(create) {
        if (!S.active) return null;
        if (!S.accounts[S.active]) { if (!create) return null; S.accounts[S.active] = blankAccount(); }
        return S.accounts[S.active];
    }
    function getTarget() { var a = acct(); return a ? (a.target || 0) : 0; }
    function clearGoal() { var a = acct(true); if (a) { a.target = 0; a.targetAt = Date.now(); } if (hud.target) hud.target.value = ''; save(); render(); }
    function curRec(c) {
        c = c || S.currency;
        var a = acct(true);
        if (!a) return EMPTY_REC;          // no account yet -> read-only empty
        if (!a.cur[c]) a.cur[c] = blankCur();
        var r = a.cur[c];
        if (!r.bets) r.bets = [];
        if (!r.liveIds) r.liveIds = {};
        if (!r.bins) r.bins = {};
        return r;
    }
    // Stake's bet API uses SWEEPS / GOLD; the UI uses SC / GC.
    function normalizeCurrency(c) {
        if (!c) return '';
        var u = String(c).toUpperCase();
        if (u === 'SWEEPS') return 'SC';
        if (u === 'GOLD') return 'GC';
        return u;
    }

    /* ----------------------- USD rates (crypto site) --------------------- */
    function applyRates(list) {
        if (!Array.isArray(list)) return;
        var changed = false;
        list.forEach(function (x) {
            if (x && x.currency && typeof x.baseRate === 'number') { rates[String(x.currency).toLowerCase()] = x.baseRate; changed = true; }
        });
        if (changed) reconvertUSD();
    }
    function fetchRates() {
        if (IS_SOCIAL) return;
        try {
            fetch(location.origin + '/_api/graphql', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json', 'x-access-token': getCookie('session'), 'x-language': 'en' },
                body: JSON.stringify({ query: 'query($isAcp:Boolean!){currencyConfiguration(isAcp:$isAcp){baseRates{currency baseRate}}}', variables: { isAcp: false } })
            }).then(function (r) { return r.json(); }).then(function (j) {
                applyRates(j && j.data && j.data.currencyConfiguration && j.data.currencyConfiguration.baseRates);
            }).catch(function () {});
        } catch (e) {}
    }
    function reconvertUSD() {
        if (IS_SOCIAL) return;
        var changed = false, accs = S.accounts || {};
        Object.keys(accs).forEach(function (id) {
            var rec = accs[id].cur && accs[id].cur.USD;
            if (!rec || !rec.bets) return;
            rec.bets.forEach(function (b) {
                if ((!b.amt || b.amt === 0) && b.raw && b.rc) {
                    var rate = rates[String(b.rc).toLowerCase()];
                    if (typeof rate === 'number' && rate > 0) { b.amt = b.raw * rate; changed = true; }
                }
            });
        });
        if (changed) { save(); scheduleRender(); }
    }

    /* --------------------------- RTP / edge ------------------------------ */
    var ORIGINALS_EDGE = {
        dice: 1, limbo: 1, mines: 1, hilo: 1, dragontower: 1, diamonds: 1,
        keno: 1, plinko: 1, wheel: 1, blackjack: 0.5, baccarat: 1.06,
        videopoker: 0.5, crash: 1, slide: 1, tower: 1, cricket: 1
    };
    function normGame(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
    function currentGameSlug() {
        var m = (location.pathname || '').match(/\/casino\/games\/([^/?#]+)/);
        return m ? m[1] : '';
    }
    function edgeForGame(game) {
        var k = normGame(game);
        if (!k) return null;
        if (S.gameEdge[k] != null) return S.gameEdge[k];
        if (ORIGINALS_EDGE[k] != null) return ORIGINALS_EDGE[k];
        return null;
    }
    function bucketOfEdge(edge) {
        if (edge == null) return 'low';
        var rtp = 100 - edge;
        if (rtp >= 99 - 1e-9) return 'high';
        if (rtp >= 98 - 1e-9) return 'mid';
        return 'low';
    }
    function currentEdge() {
        try {
            var meta = document.querySelector('.game-meta-tags');
            if (!meta) return null;
            var m = (meta.textContent || '').match(/Edge:\s*([\d.]+)\s*%/i);
            if (!m) return null;
            var e = parseFloat(m[1]);
            return isFinite(e) ? e : null;
        } catch (e) { return null; }
    }
    function captureGameEdge() {
        try {
            var meta = document.querySelector('.game-meta-tags');
            if (!meta) return;
            var m = (meta.textContent || '').match(/Edge:\s*([\d.]+)\s*%/i);
            if (!m) return;
            var edge = parseFloat(m[1]);
            if (!isFinite(edge)) return;
            var keys = [];
            var sm = location.pathname.match(/\/casino\/games\/([^/?#]+)/);
            if (sm) keys.push(normGame(sm[1]));
            var h1 = document.querySelector('h1[class*="ds-heading"]');
            if (h1) keys.push(normGame(h1.textContent || ''));
            var changed = false;
            keys.forEach(function (k) { if (k && S.gameEdge[k] !== edge) { S.gameEdge[k] = edge; changed = true; } });
            if (changed) { note('edge ' + (sm ? sm[1] : '') + ' = ' + edge + '%'); save(); scheduleRender(); }
        } catch (e) {}
    }

    /* --------------------------- number helpers -------------------------- */
    function parseNum(text) {
        if (text == null) return NaN;
        var raw = String(text).replace(/ /g, ' ').trim();
        if (!raw) return NaN;
        var m = raw.match(/-?\d[\d,.\s']*/);
        if (!m) return NaN;
        var t = m[0].replace(/[\s']/g, '');
        var hasDot = t.indexOf('.') >= 0, hasComma = t.indexOf(',') >= 0;
        if (hasDot && hasComma) {
            if (t.lastIndexOf('.') > t.lastIndexOf(',')) t = t.replace(/,/g, '');
            else t = t.replace(/\./g, '').replace(/,/g, '.');
        } else if (hasComma && !hasDot) {
            var parts = t.split(',');
            if (parts.length === 2 && parts[1].length <= 2) t = parts[0] + '.' + parts[1];
            else t = t.replace(/,/g, '');
        }
        var n = parseFloat(t);
        return isFinite(n) ? n : NaN;
    }
    function fmt(n) {
        if (!isFinite(n)) return '–';
        return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function shortDate(t) {
        if (!t) return '—';
        try { return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
                     new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); }
        catch (e) { return '—'; }
    }

    /* ------------------------ rolling computation ------------------------ */
    // TOTAL: rolling 168h = lifetime(now) - lifetime(>=7d ago), from ltAnchors.
    function rolling() {
        var a = acct();
        var now = Date.now(), cutoff = now - WINDOW_MS;
        var an = a && a.ltAnchors;
        if (!a || !an || !an.length) {
            return { ready: false, rolling: 0, full: false, realFull: false, coverMs: 0, realCoverMs: 0, since: 0, live: 0 };
        }
        var cur = an[an.length - 1].cum;
        // Baseline = the OLDEST snapshot at/after the 7-day cutoff, so the measured window
        // is always a SUBSET of the true trailing-168h window (a guaranteed lower bound).
        var baseline = null;
        for (var i = 0; i < an.length; i++) { if (an[i].t >= cutoff) { baseline = an[i]; break; } }
        if (!baseline) baseline = an[an.length - 1];
        // Exactness clock: time since the FIRST real (post-swap) lifetime snapshot. Bridged
        // (seed) snapshots carry the old raffle method's error, so the figure is only
        // guaranteed pinpoint once a genuine lifetime snapshot is the baseline (>=7d in).
        var ltCoverMs = a.ltStart ? (now - a.ltStart) : 0;
        return {
            ready: true,
            rolling: Math.max(0, cur - baseline.cum) + liveDelta,   // + real-time captured-bet overlay
            full: ltCoverMs >= WINDOW_MS - 1000,
            realFull: ltCoverMs >= WINDOW_MS - 1000,
            coverMs: Math.min(now - baseline.t, WINDOW_MS),
            realCoverMs: Math.min(ltCoverMs, WINDOW_MS),
            since: an[0].t,
            live: liveDelta
        };
    }
    // RTP buckets. PREFER the server-sourced split (from Stake's own bet ledger -> identical on every
    // device on the account); fall back to the local per-writer bins (the live WS sample) only until
    // the first ledger poll lands. This is what makes the slots/originals split match across devices.
    var BUCKET_CAP = 300, BUCKET_PAGE = 50, BUCKET_MS = 3 * 60 * 1000;   // recent-ledger sample size + poll cadence
    var serverBuckets = null;   // {high, mid, low, count, t} from houseBetList; null until first successful poll
    var bucketsBusy = false;
    function rollingBuckets() {
        if (serverBuckets && serverBuckets.count > 0) return serverBuckets;   // authoritative, cross-device-consistent
        var b = { high: 0, mid: 0, low: 0, count: 0 };
        var a = acct(); if (!a) return b;
        var rec = a.cur && a.cur[S.currency]; if (!rec || !rec.bins) return b;
        var minBin = Math.floor((Date.now() - WINDOW_MS) / BIN_MS);
        Object.keys(rec.bins).forEach(function (w) {
            var wb = rec.bins[w];
            Object.keys(wb).forEach(function (bk) {
                if (+bk < minBin) return;
                var c = wb[bk];
                b.high += c.h || 0; b.mid += c.m || 0; b.low += c.l || 0; b.count += c.n || 0;
            });
        });
        return b;
    }
    // v2.15: ms until the rolling-7d wager would fall below `req` if you stop wagering now
    // (i.e., when enough wager ages off the back of the 7d window). null if no usable history.
    function eligTimeLeftMs(req) {
        var a = acct(); if (!a || !a.ltAnchors || a.ltAnchors.length < 2) return null;
        var an = a.ltAnchors, now = Date.now(), cur = an[an.length - 1].cum, target = cur - req;
        if (target <= an[0].cum) return WINDOW_MS;                       // would take the full window (or more)
        var lo = 0, hi = an.length - 1;                                  // first index with cum >= target
        while (lo < hi) { var mid = (lo + hi) >> 1; if (an[mid].cum < target) lo = mid + 1; else hi = mid; }
        var p1 = an[lo], p0 = an[lo - 1] || an[lo];
        var tau = (p1.cum === p0.cum) ? p1.t : p0.t + (p1.t - p0.t) * ((target - p0.cum) / (p1.cum - p0.cum));
        return Math.max(0, Math.min(WINDOW_MS, tau - (now - WINDOW_MS)));
    }
    function eligHrs(ms) {
        if (ms >= WINDOW_MS - 60000) return '7d+';
        var h = ms / 3600000;
        if (h >= 48) return (h / 24).toFixed(1) + 'd';
        if (h >= 10) return Math.round(h) + 'h';
        return h.toFixed(1) + 'h';
    }
    // ---- v2.12 wager-activity chart: view-state (continuous zoom + pan, NOW on the RIGHT) ----
    // gView.end = newest time shown (the RIGHT edge). Live tracks now; panned pins it.
    // Persisted: S.ui.graphSpan (zoom) + S.ui.graphLive. hoverX/mx/my/drag* are interaction-only.
    var gView = { end: 0, hoverX: null, mx: 0, my: 0, dragX: null, dragEnd: 0 };
    function gSpan() { var s = S.ui && +S.ui.graphSpan; s = (s && isFinite(s)) ? s : GSPAN_MAX; return Math.max(GSPAN_MIN, Math.min(GSPAN_MAX, s)); }
    function gEnd() {
        var now = Date.now(), span = gSpan();
        if (S.ui.graphLive) return now;
        return Math.max(now - WINDOW_MS + span, Math.min(now, gView.end || now));   // no future, no panning past available data
    }
    function fmtShort(n) { if (!isFinite(n)) return '–'; var x = Math.abs(n); if (x >= 1e6) return (n / 1e6).toFixed(2) + 'M'; if (x >= 1e3) return (n / 1e3).toFixed(1) + 'k'; return Math.round(n) + ''; }
    function formatDur(ms) {
        if (ms <= 0) return '0m';
        var d = Math.floor(ms / 86400000); ms -= d * 86400000;
        var h = Math.floor(ms / 3600000); ms -= h * 3600000;
        var m = Math.floor(ms / 60000);
        return (d ? d + 'd ' : '') + ((d || h) ? h + 'h ' : '') + m + 'm';
    }
    // ---- v2.10 fall-off chart rendering ----------------------------------------
    var GAXIS_STEPS = [60000, 120000, 300000, 600000, 900000, 1800000, 3600000, 7200000, 10800000, 21600000, 43200000, 86400000];
    function gNiceStep(span) { for (var i = 0; i < GAXIS_STEPS.length; i++) if (span / GAXIS_STEPS[i] <= 6) return GAXIS_STEPS[i]; return GAXIS_STEPS[GAXIS_STEPS.length - 1]; }
    // 12-hour clock with am/pm (used across the chart axis + hover tooltip)
    function gTime12(d, withMin) {
        var h = d.getHours(), ap = h < 12 ? 'am' : 'pm', hh = (h % 12) || 12;
        return withMin ? (hh + ':' + ('0' + d.getMinutes()).slice(-2) + ap) : (hh + ap);
    }
    function gAxisLabel(t, step) {
        var d = new Date(t);
        if (step >= 86400000) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] + ' ' + d.getDate();
        if (step >= 3600000) return gTime12(d, false);
        return gTime12(d, true);
    }
    function gClock(t) { try { var d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + gTime12(d, true); } catch (e) { return '—'; } }
    function gClockSec(t) { try { var d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + gTime12(d, true).replace(/(am|pm)$/, ':' + ('0' + d.getSeconds()).slice(-2) + '$1'); } catch (e) { return '—'; } }
    var gQueued = false;
    function scheduleGraph() { if (gQueued) return; gQueued = true; requestAnimationFrame(function () { gQueued = false; drawGraph(); }); }
    function gHideTip() { if (hud.gtip) hud.gtip.style.display = 'none'; }
    function gTipAt() {
        if (!hud.gtip) return;
        var tw = hud.gtip.offsetWidth || 170, vx = gView.mx + 14, vy = gView.my + 14;
        if (vx + tw > window.innerWidth - 8) vx = gView.mx - tw - 14;
        if (vy + 72 > window.innerHeight - 8) vy = gView.my - 72;
        hud.gtip.style.left = vx + 'px'; hud.gtip.style.top = vy + 'px'; hud.gtip.style.display = 'block';
    }
    function gShowTipBar(tc, dtPerPx, w) {
        var single = dtPerPx <= 90000, C = ' ' + S.currency;
        var when = single ? gClock(tc) : (gClock(tc - dtPerPx / 2) + ' – ' + gClock(tc + dtPerPx / 2));
        hud.gtip.innerHTML = '<div class="gtl">wagered</div>'
            + '<div class="gtv">' + fmt(w) + C + '</div>'
            + '<div class="gtf">' + when + '</div>';
        gTipAt();
    }
    // v2.12 wager-activity chart (trading-terminal style): bars = wager per period over time,
    // NOW on the right; right SC axis; ticker (7d total + in-view total); crosshair readout.
    // Continuous zoom (scroll) + pan (drag) + ⟲ live + ⤢ fit-to-7d. No derived price line.
    function drawGraph() {
        if (!hud.gcanvas || !S.ui.open || !hud.w || hud.w.style.display === 'none') return;
        var cv = hud.gcanvas, ctx; try { ctx = cv.getContext('2d'); } catch (e) { return; }
        if (!ctx) return;
        var dpr = window.devicePixelRatio || 1;
        var W = cv.clientWidth || 300, H = cv.clientHeight || 150;
        if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);   // recessed well's dark bg shows through
        var span = gSpan(), end = gEnd(), now = Date.now(), t0 = end - span;
        var tkH = 2, axB = 15, axR = 30, padL = 2;
        var plotW = W - padL - axR, pTop = tkH, pBot = H - axB, plotH = pBot - pTop;
        function X(t) { return padL + (t - t0) / span * plotW; }
        function T(x) { return t0 + (x - padL) / plotW * span; }
        var a = acct(), rec = a && a.cur && a.cur[S.currency];

        // wager per pixel column; plus in-view total
        var colW = new Array(W), vmax = 0, sumW = 0;
        if (rec && rec.gbins) { Object.keys(rec.gbins).forEach(function (wk) { var wb = rec.gbins[wk];
            Object.keys(wb).forEach(function (bk) { var t = (+bk) * GBIN_MS; if (t < t0 || t > end) return;
                var xi = Math.floor(X(t)); if (xi < padL || xi >= padL + plotW) return;
                var w = wb[bk].w || 0;
                colW[xi] = (colW[xi] || 0) + w; sumW += w;
                if (colW[xi] > vmax) vmax = colW[xi]; }); }); }
        if (vmax <= 0) vmax = 1;
        function VY(v) { return pBot - (v / vmax) * (plotH - 2); }

        ctx.font = '9px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
        // value gridlines + right SC axis (wager per column)
        for (var g = 0; g <= 2; g++) { var gv = vmax * g / 2, gy = Math.round(VY(gv)) + 0.5;
            ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + plotW, gy); ctx.stroke();
            if (g > 0) { ctx.fillStyle = '#56707f'; ctx.textAlign = 'left'; ctx.fillText(fmtShort(gv), padL + plotW + 4, gy + 3); } }
        // time gridlines + labels (now on the right)
        var step = gNiceStep(span), gt = Math.ceil(t0 / step) * step; ctx.textAlign = 'center';
        for (; gt <= end; gt += step) { var gx = X(gt);
            ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.beginPath(); ctx.moveTo(gx + 0.5, pTop); ctx.lineTo(gx + 0.5, pBot); ctx.stroke();
            ctx.fillStyle = '#56707f'; ctx.fillText(gAxisLabel(gt, step), Math.max(13, Math.min(padL + plotW - 13, gx)), H - 3); }
        ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.moveTo(padL, pBot + 0.5); ctx.lineTo(padL + plotW, pBot + 0.5); ctx.stroke();

        // wager bars (cyan volume, soft glow) — data tone, distinct from the green status accent
        var grad = ctx.createLinearGradient(0, pTop, 0, pBot);
        grad.addColorStop(0, 'rgba(110,214,245,.98)'); grad.addColorStop(.65, 'rgba(79,184,214,.6)'); grad.addColorStop(1, 'rgba(79,184,214,.12)');
        var hxi = (gView.hoverX != null) ? Math.round(gView.hoverX) : -1;
        if (hxi >= 0) {   // mobile: snap the crosshair to the nearest wager bar within a fingertip radius
            var _snap = -1, _sd = 1e9, _R = 30;
            for (var _sx = Math.max(padL, hxi - _R); _sx <= Math.min(padL + plotW - 1, hxi + _R); _sx++) {
                if ((colW[_sx] || 0) > 0) { var _d = Math.abs(_sx - hxi); if (_d < _sd) { _sd = _d; _snap = _sx; } }
            }
            if (_snap >= 0) hxi = _snap;
        }
        ctx.save(); ctx.shadowColor = 'rgba(79,184,214,.5)'; ctx.shadowBlur = 4; ctx.fillStyle = grad;
        for (var x = padL; x < padL + plotW; x++) { var w = colW[x] || 0; if (!w) continue;
            var bh = Math.max(1.4, (plotH - 2) * (w / vmax));
            ctx.globalAlpha = (x === hxi) ? 1 : 0.92; ctx.fillRect(x, pBot - bh, 1, bh); }
        ctx.restore(); ctx.globalAlpha = 1;
        if (sumW <= 0) { ctx.fillStyle = '#56707f'; ctx.textAlign = 'center'; ctx.fillText('no wager in this range', padL + plotW / 2, pTop + plotH / 2); }

        // "now" marker (green dashed + node) when the present is in view
        if (now >= t0 && now <= end + 1) { var nx = X(now);
            ctx.strokeStyle = 'rgba(31,214,85,.55)'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(nx - 0.5, pTop); ctx.lineTo(nx - 0.5, pBot); ctx.stroke(); ctx.setLineDash([]);
            ctx.fillStyle = '#1fd655'; ctx.beginPath(); ctx.arc(nx - 0.5, pTop + 3, 2.2, 0, 7); ctx.fill(); }

        // in-view total (top-left); the hero number already carries the 7d total
        var C = ' ' + S.currency;
        ctx.textAlign = 'left'; ctx.font = '9px ui-monospace,Menlo,monospace'; ctx.fillStyle = '#6e8b9c';
        ctx.fillText('view  Σ ' + fmtShort(sumW) + C + (S.ui.graphLive ? '' : '  · paused'), padL + 2, 9);

        // crosshair + tooltip
        if (gView.hoverX != null && hxi >= padL && hxi <= padL + plotW) {
            ctx.strokeStyle = 'rgba(255,255,255,.30)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(hxi + 0.5, pTop); ctx.lineTo(hxi + 0.5, pBot); ctx.stroke(); ctx.setLineDash([]);
            var _cw = colW[hxi] || 0;
            if (_cw > 0) { var _ny = VY(_cw); ctx.fillStyle = '#eafaff'; ctx.strokeStyle = 'rgba(110,214,245,.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(hxi + 0.5, _ny, 3.4, 0, 7); ctx.fill(); ctx.stroke(); ctx.lineWidth = 1; }
            gShowTipBar(T(hxi), span / plotW, _cw);
        } else if (gView.hoverX != null) gHideTip();
    }

    /* --------------------- lifetime wager (the total) -------------------- */
    var KEEP_ANCHOR_MS = 9 * 24 * 60 * 60 * 1000;
    // Record a lifetime snapshot (monotonic; throttle unchanged; prune past the window+margin).
    function recordLt(a, cum) {
        if (!isFinite(cum) || cum < 0) return;
        if (!a.ltAnchors) a.ltAnchors = [];
        var now = Date.now(), last = a.ltAnchors[a.ltAnchors.length - 1];
        if (last) {
            if (cum < last.cum - 1e-6) return;                                            // lifetime can't drop
            if (Math.abs(cum - last.cum) < 1e-9 && (now - last.t) < 10 * 60 * 1000) return; // throttle unchanged
        }
        a.ltAnchors.push({ t: now, cum: cum });
        var cutoff = now - WINDOW_MS, minT = now - KEEP_ANCHOR_MS, keepIdx = -1;
        for (var i = 0; i < a.ltAnchors.length; i++) if (a.ltAnchors[i].t <= cutoff) keepIdx = i;
        a.ltAnchors = a.ltAnchors.filter(function (p, idx) { return p.t >= minT || idx === keepIdx; });
    }
    // Fold the latest lifetime reading into ltAnchors. On first run, BRIDGE the legacy
    // raffle anchors onto the lifetime scale (offset-aligned) so the headline is continuous
    // and full-window immediately, kept in ltAnchors so old script versions can't mix scales.
    function updateLifetime(L) {
        var a = acct(true);
        if (!a || !isFinite(L) || L < 0) return;
        if (!a.ltAnchors) a.ltAnchors = [];
        if (!a.ltSeeded) {
            if (!a.ltAnchors.length && a.anchors && a.anchors.length) {
                var last = a.anchors[a.anchors.length - 1];
                var delta = L - last.cum;   // shift newest old anchor up to the current lifetime value
                if (isFinite(delta)) {
                    a.ltAnchors = a.anchors.map(function (p) { return { t: p.t, cum: p.cum + delta, seed: true }; });
                }
            }
            a.ltSeeded = true;
            note('lifetime seed @ ' + L.toFixed(2) + ' (bridged ' + ((a.ltAnchors && a.ltAnchors.length) || 0) + ' anchors)');
        }
        if (!a.ltStart) a.ltStart = Date.now();   // exactness clock starts at the first real reading
        var prev = a.ltAnchors.length ? a.ltAnchors[a.ltAnchors.length - 1].cum : L;
        // The counter just caught up by (L - prev): draw the live overlay down by that much,
        // so the headline stays monotonic and never double-counts those bets.
        if (L > prev + 1e-9) liveDelta = Math.max(0, liveDelta - (L - prev));
        recordLt(a, L);
        save(); scheduleRender();
    }
    // Map the tracked HUD currency to Stake's API currency name.
    function apiCurrencyFor(c) {
        var u = String(c || '').toUpperCase();
        if (u === 'SC') return 'sweeps';
        if (u === 'GC') return 'gold';
        return u.toLowerCase();
    }
    // Reduce statisticScoped rows to the lifetime wager we track.
    // SOCIAL (stake.us): the SC row ONLY (currency "sweeps", scope "house"); GC is ignored.
    // CRYPTO: sum betValue (USD-equiv) across all currencies (scope "house").
    function lifetimeFromStats(list) {
        if (!Array.isArray(list)) return null;
        if (IS_SOCIAL) {
            var want = apiCurrencyFor(S.currency);   // 'sweeps'
            var sum = null;
            list.forEach(function (r) {
                if (r && r.scope === 'house' && String(r.currency).toLowerCase() === want && typeof r.betAmount === 'number') {
                    sum = (sum || 0) + r.betAmount;
                }
            });
            return sum;
        }
        var usd = null;
        list.forEach(function (r) {
            if (r && r.scope === 'house' && typeof r.betValue === 'number') usd = (usd || 0) + r.betValue;
        });
        return usd;
    }
    // Authoritative lifetime wager total (never resets; not ticket-quantised).
    function fetchLifetime() {
        try {
            fetch(location.origin + '/_api/graphql', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json', 'x-access-token': getCookie('session'), 'x-language': 'en' },
                body: JSON.stringify({ query: 'query{user{statisticScoped{betAmount betValue currency scope}}}', variables: {} })
            }).then(function (r) { return r.json(); }).then(function (j) {
                var list = j && j.data && j.data.user && j.data.user.statisticScoped;
                var L = lifetimeFromStats(list);
                if (L != null) updateLifetime(L);
            }).catch(function () {});
        } catch (e) {}
    }
    // Pick the weekly wager raffle from activeRaffles (kept only for the Tickets display).
    function pickRaffle(list) {
        if (!Array.isArray(list)) return null;
        var cand = list.filter(function (r) { return r && r.raffleUser && r.ticketValue > 0; });
        cand.sort(function (x, y) {
            function wk(r) { var d = (Date.parse(r.endTime) - Date.parse(r.startTime)) / 86400000; return (d >= 5 && d <= 9) ? 0 : 1; }
            if (wk(x) !== wk(y)) return wk(x) - wk(y);
            return String(x.id) < String(y.id) ? -1 : 1;
        });
        return cand[0] || null;
    }
    function fetchRaffle() {
        try {
            fetch(location.origin + '/_api/graphql', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json', 'x-access-token': getCookie('session'), 'x-language': 'en' },
                body: JSON.stringify({ query: 'query{activeRaffles{id name ticketValue startTime endTime raffleUser{progress ticketCount}}}', variables: {} })
            }).then(function (r) { return r.json(); }).then(function (j) {
                var rf = pickRaffle(j && j.data && j.data.activeRaffles);
                if (!rf || !rf.raffleUser) return;
                var a = acct(); if (a) { a.tickets = rf.raffleUser.ticketCount; scheduleRender(); }   // Tickets display only
            }).catch(function () {});
        } catch (e) {}
    }
    function syncGameEdges() {
        try {
            fetch(location.origin + '/_api/graphql', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json', 'x-access-token': getCookie('session'), 'x-language': 'en' },
                body: JSON.stringify({ query: 'query{user{houseBetList(limit:50){game{name slug edge}}}}', variables: {} })
            }).then(function (r) { return r.json(); }).then(function (j) {
                var list = j && j.data && j.data.user && j.data.user.houseBetList;
                if (!Array.isArray(list)) return;
                var n = 0;
                for (var i = 0; i < list.length; i++) { if (learnGameEdge(list[i] && list[i].game) != null) n++; }
                if (n) { save(); scheduleRender(); note('synced game edges: ' + Object.keys(S.gameEdge).length + ' known'); }
            }).catch(function () {});
        } catch (e) {}
    }
    // Recompute the RTP split from Stake's authoritative bet ledger so every device derives the SAME
    // slots/originals proportion. Amount-weighted, bucketed by each game's house edge. Paginated
    // (the API hard-caps offset at 1000); a fresh snapshot each poll. Degrades to the local sample on error.
    function bucketEdgePct(b) {
        if (b && b.game && typeof b.game.edge === 'number') return b.game.edge * 100;   // API edge is a fraction
        return edgeForGame(b && b.game && (b.game.slug || b.game.name));                 // cache fallback (null -> 'low')
    }
    function fetchBuckets() {
        if (bucketsBusy) return;
        bucketsBusy = true;
        var acc = { high: 0, mid: 0, low: 0, count: 0 }, offset = 0;
        function finish() {
            bucketsBusy = false;
            if (acc.count > 0) { serverBuckets = { high: acc.high, mid: acc.mid, low: acc.low, count: acc.count, t: Date.now() }; scheduleRender(); }
        }
        function add(b) {
            var ccy = normalizeCurrency(b.currency), amt;
            if (IS_SOCIAL) { if (TRACK_CCY.indexOf(ccy) < 0) return; amt = b.amount; }
            else { var rate = rates[String(ccy).toLowerCase()]; amt = (typeof rate === 'number' && rate > 0) ? b.amount * rate : 0; }
            if (!(amt > 0)) return;
            acc[bucketOfEdge(bucketEdgePct(b))] += amt; acc.count++;
        }
        function step() {
            if (offset >= BUCKET_CAP) return finish();
            try {
                fetch(location.origin + '/_api/graphql', {
                    method: 'POST', credentials: 'include',
                    headers: { 'content-type': 'application/json', 'x-access-token': getCookie('session'), 'x-language': 'en' },
                    body: JSON.stringify({ query: 'query($l:Int,$o:Int){user{houseBetList(limit:$l,offset:$o){amount currency game{slug name edge}}}}', variables: { l: BUCKET_PAGE, o: offset } })
                }).then(function (r) { return r.json(); }).then(function (j) {
                    var list = j && j.data && j.data.user && j.data.user.houseBetList;
                    if (!Array.isArray(list) || !list.length) return finish();
                    list.forEach(add);
                    offset += BUCKET_PAGE;
                    if (list.length < BUCKET_PAGE) return finish();
                    step();
                }).catch(function () { finish(); });
            } catch (e) { finish(); }
        }
        step();
    }
    function fetchSelf() {
        try {
            fetch(location.origin + '/_api/graphql', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json', 'x-access-token': getCookie('session'), 'x-language': 'en' },
                body: JSON.stringify({ query: 'query{user{id name}}', variables: {} })
            }).then(function (r) { return r.json(); }).then(function (j) {
                var u = j && j.data && j.data.user;
                if (!u || u.id == null) return;
                var id = String(u.id), isNew = (S.active !== id);
                S.active = id;
                if (!S.accounts[id]) S.accounts[id] = blankAccount();
                if (u.name && S.accounts[id].name !== String(u.name)) S.accounts[id].name = String(u.name);
                if (isNew) { liveDelta = 0; liveSince = Date.now(); note('account: ' + (u.name || id.slice(0, 8))); }
                save(); scheduleRender();
            }).catch(function () {});
        } catch (e) {}
    }

    /* ------------------------- live bet ingestion ------------------------ */
    function noteRing(arr, s, cap) { arr.push(Date.now() + ' ' + s); while (arr.length > (cap || 30)) arr.shift(); }
    function note(s) { noteRing(S.debug, s, 30); }
    function diag(s) { noteRing(S.diag, s, 24); save(); }

    function pruneBets(r, now) {
        var minT = now - KEEP_MS;
        if (r.bets.length > 60) r.bets = r.bets.filter(function (b) { return b.t >= minT; });
        if (r.bets.length > BETS_CAP) { r.bets.sort(function (a, b) { return a.t - b.t; }); r.bets = r.bets.slice(r.bets.length - BETS_CAP); }
        var idMinT = now - LIVEID_KEEP_MS;
        for (var k in r.liveIds) { if (r.liveIds[k] < idMinT) delete r.liveIds[k]; }
        if (r.bins) {
            var minBin = Math.floor((now - BIN_KEEP_MS) / BIN_MS);
            Object.keys(r.bins).forEach(function (w) {
                var wb = r.bins[w], any = false;
                Object.keys(wb).forEach(function (bk) { if (+bk < minBin) delete wb[bk]; else any = true; });
                if (!any) delete r.bins[w];
            });
        }
        if (r.gbins) {
            var minGBin = Math.floor((now - BIN_KEEP_MS) / GBIN_MS);
            Object.keys(r.gbins).forEach(function (w) {
                var wb = r.gbins[w], any = false;
                Object.keys(wb).forEach(function (bk) { if (+bk < minGBin) delete wb[bk]; else any = true; });
                if (!any) delete r.gbins[w];
            });
        }
    }
    function recordBet(bet) {
        if (!S.active) return;            // no account detected yet
        var rawCcy = normalizeCurrency(bet.currency);
        if (!rawCcy) return;
        var c, amt, rc, raw;
        if (IS_SOCIAL) {
            if (TRACK_CCY.indexOf(rawCcy) < 0) return;     // social: SC ONLY (GC ignored)
            c = rawCcy; amt = bet.amt;
        } else {
            c = 'USD';                                     // crypto: combine into USD
            rc = rawCcy; raw = bet.amt;
            var rate = rates[rawCcy.toLowerCase()];
            amt = (typeof rate === 'number' && rate > 0) ? bet.amt * rate : 0;  // 0 until rate loads; reconverted later
        }
        var r = curRec(c);
        var now = Date.now();
        var bt = (bet.t && isFinite(bet.t)) ? bet.t : now;   // real placement time
        var id = bet.id != null ? String(bet.id) : ('x' + bet.amt + ':' + (bet.tn || '') + ':' + Math.round(bt / 1000));
        if (r.liveIds[id]) return;            // de-dupe (the same bet re-appears in feed batches)
        r.liveIds[id] = now;
        if (!r.trackStart || bt < r.trackStart) r.trackStart = bt;   // earliest bet we've seen
        var game = bet.game || currentGameSlug() || '';
        var e = (bet.edge != null) ? bet.edge : edgeForGame(game);
        if (e == null) e = currentEdge();
        var rec = { k: id, t: bt, amt: amt, game: game, mult: bet.mult, tn: bet.tn || '', edge: (e != null ? e : undefined) };
        if (rc) { rec.rc = rc; rec.raw = raw; }   // keep crypto amount for reconversion
        r.bets.push(rec);
        // Fold into the bounded RTP bins (the long-term, full-168h bucket store).
        var bkt = bucketOfEdge(e), binKey = Math.floor(bt / BIN_MS);
        if (!r.bins) r.bins = {};
        var wbins = r.bins[WRITER_ID] || (r.bins[WRITER_ID] = {});
        var cell = wbins[binKey] || (wbins[binKey] = { h: 0, m: 0, l: 0, n: 0 });
        cell[bkt === 'high' ? 'h' : bkt === 'mid' ? 'm' : 'l'] += amt; cell.n += 1;
        // v2.9: also fold into the finer 1-min GRAPH bins (count + wager) for the fall-off graph.
        if (!r.gbins) r.gbins = {};
        var gb = r.gbins[WRITER_ID] || (r.gbins[WRITER_ID] = {});
        var gk = Math.floor(bt / GBIN_MS), gcell = gb[gk] || (gb[gk] = { n: 0, w: 0 });
        gcell.n += 1; gcell.w += amt;
        if (bt >= liveSince) {                    // this session's real bets -> true per-bet ticks at deep zoom (memory only)
            sessionTicks.push({ t: bt, amt: amt });
            if (sessionTicks.length > GTICKS_CAP) sessionTicks.shift();
        }
        if (bt >= liveSince) liveDelta += amt;   // live overlay: tick the headline per captured bet (reconciled by the counter)
        pruneBets(r, now);
        save();
        scheduleRender();
    }

    function captureSelf(obj, depth) {
        if (!obj || typeof obj !== 'object' || depth > 7) return false;
        if (Array.isArray(obj)) {
            for (var i = 0; i < obj.length; i++) { if (captureSelf(obj[i], depth + 1)) return true; }
            return false;
        }
        if (obj.id != null && (('balances' in obj) || ('vault' in obj) || ('email' in obj) || ('hasTwoFactor' in obj))) {
            var id = String(obj.id);
            var name = obj.name != null ? String(obj.name) : null;
            var isNew = (S.active !== id);
            S.active = id;
            if (!S.accounts[id]) S.accounts[id] = blankAccount();
            if (name && S.accounts[id].name !== name) S.accounts[id].name = name;
            if (legacyMigrate && !curHasBets(S.accounts[id])) {
                S.accounts[id].cur = legacyMigrate.cur;
                if (legacyMigrate.target) S.accounts[id].target = legacyMigrate.target;
                S.accounts[id].resetAt = legacyMigrate.resetAt || {};
                note('migrated wager from ' + legacyMigrate.from);
                legacyMigrate = null;
            }
            if (isNew) { liveDelta = 0; liveSince = Date.now(); note('account: ' + (name || id.slice(0, 8))); }
            save();
            return true;
        }
        for (var k in obj) { if (obj[k] && typeof obj[k] === 'object') { if (captureSelf(obj[k], depth + 1)) return true; } }
        return false;
    }
    function betIsMine(u) {
        if (!S.active || !u) return false;
        var uid = u.id != null ? String(u.id) : null;
        var un = u.name != null ? String(u.name) : null;
        var a = S.accounts[S.active];
        var an = a && a.name;
        return (uid && uid === S.active) || (un && an && un === an);
    }

    function collectBets(obj, depth, acc) {
        if (!obj || typeof obj !== 'object' || depth > 9) return;
        if (Array.isArray(obj)) {
            for (var i = 0; i < obj.length; i++) collectBets(obj[i], depth + 1, acc);
            return;
        }
        if (typeof obj.amount === 'number' && typeof obj.currency === 'string' && obj.amount > 0 &&
            (('payoutMultiplier' in obj) || ('payout' in obj) ||
             ('state' in obj && ('multiplier' in obj || 'payoutMultiplier' in obj)) ||
             (/Bet$/.test(obj.__typename || '')))) {
            acc.push(obj);
        }
        for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) {
                var v = obj[k];
                if (v && typeof v === 'object') collectBets(v, depth + 1, acc);
            }
        }
    }
    function gameNameOf(o) {
        var g = o.game;
        if (typeof g === 'string') return g;
        if (g && typeof g === 'object') return g.name || g.title || g.slug || g.gameName || '';
        return o.gameName || o.gameId || '';
    }
    function learnGameEdge(g) {
        if (!g || typeof g !== 'object' || typeof g.edge !== 'number' || !isFinite(g.edge)) return null;
        var pct = g.edge * 100;
        [g.slug, g.name, g.title].forEach(function (s) { var k = normGame(s); if (k) S.gameEdge[k] = pct; });
        return pct;
    }
    function betTime(o) {
        var t = o.createdAt != null ? o.createdAt : (o.updatedAt != null ? o.updatedAt : (o.time != null ? o.time : null));
        if (t != null) {
            var n = (typeof t === 'number') ? t : Date.parse(t);
            if (isFinite(n) && n > 0) { if (n < 1e12) n *= 1000; return n; }   // seconds -> ms
        }
        return Date.now();
    }

    var nameSamples = 0;
    function handlePayload(text) {
        if (!text || text.length > 1500000) return;
        if (!IS_SOCIAL && text.indexOf('baseRate') >= 0) {
            try { var d0 = JSON.parse(text); var cc = d0 && d0.data && d0.data.currencyConfiguration; if (cc && cc.baseRates) applyRates(cc.baseRates); } catch (e) {}
        }
        if (text.indexOf('amount') < 0) return;     // cheap pre-filter
        var data;
        try { data = JSON.parse(text); } catch (e) { return; }
        if (text.indexOf('balances') >= 0 || text.indexOf('"vault"') >= 0 || text.indexOf('"email"') >= 0 || text.indexOf('hasTwoFactor') >= 0) {
            try { captureSelf(data, 0); } catch (e) {}
        }
        var acc = [];
        try { collectBets(data, 0, acc); } catch (e) { return; }
        if (!acc.length) return;

        var uniq = [], seen = {};
        for (var i = 0; i < acc.length; i++) {
            var o = acc[i];
            var key = o.id != null ? ('id:' + o.id) : (o.iid != null ? ('iid:' + o.iid) : ('k:' + i));
            if (seen[key]) continue;
            seen[key] = 1; uniq.push(o);
        }

        for (var j = 0; j < uniq.length; j++) {
            var b = uniq[j], u = b.user;
            var mine = betIsMine(u);
            if (nameSamples < 14 && u && (u.id != null || u.name != null)) {
                nameSamples++;
                diag('owner ' + b.amount + normalizeCurrency(b.currency) + ' :: ' +
                     (u.name ? String(u.name).slice(0, 14) : 'id:' + String(u.id).slice(0, 6)) + (mine ? ' <SELF>' : ''));
            }
            if (mine) {
                recordBet({
                    id: b.id != null ? b.id : (b.iid != null ? b.iid : null),
                    amt: b.amount,
                    currency: b.currency,
                    game: gameNameOf(b),
                    mult: typeof b.payoutMultiplier === 'number' ? b.payoutMultiplier : undefined,
                    tn: b.__typename || '',
                    t: betTime(b),
                    edge: learnGameEdge(b.game)          // API house edge (%), also cached in S.gameEdge
                });
            }
        }
    }

    /* ----------------------------- net hooks ----------------------------- */
    (function installHooks(window) {   /* window = the REAL page window (unsafeWindow) so fetch/WS hooks reach the site */
        try {
            var of = window.fetch;
            if (of) {
                window.fetch = function () {
                    var args = arguments;
                    var isGql = false;
                    try {
                        var u = args[0] && args[0].url ? args[0].url : args[0];
                        isGql = (typeof u === 'string' && GQL_RE.test(u));
                    } catch (e) {}
                    var p = of.apply(this, args);
                    if (isGql) {
                        p.then(function (res) {
                            try { res.clone().text().then(handlePayload).catch(function () {}); } catch (e) {}
                        }).catch(function () {});
                    }
                    return p;
                };
            }
        } catch (e) {}

        try {
            var oOpen = window.XMLHttpRequest.prototype.open;
            var oSend = window.XMLHttpRequest.prototype.send;
            window.XMLHttpRequest.prototype.open = function (m, u) { this.__stk_url = u; return oOpen.apply(this, arguments); };
            window.XMLHttpRequest.prototype.send = function () {
                try {
                    if (GQL_RE.test(this.__stk_url || '')) {
                        var self = this;
                        this.addEventListener('load', function () {
                            try { handlePayload(self.responseText); } catch (e) {}
                        });
                    }
                } catch (e) {}
                return oSend.apply(this, arguments);
            };
        } catch (e) {}

        try {
            var OWS = window.WebSocket;
            if (OWS) {
                var WS = function (url, protos) {
                    var s = protos !== undefined ? new OWS(url, protos) : new OWS(url);
                    try {
                        s.addEventListener('message', function (ev) {
                            if (typeof ev.data === 'string' && ev.data.indexOf('amount') >= 0) handlePayload(ev.data);
                        });
                    } catch (e) {}
                    return s;
                };
                WS.prototype = OWS.prototype;
                WS.CONNECTING = OWS.CONNECTING; WS.OPEN = OWS.OPEN; WS.CLOSING = OWS.CLOSING; WS.CLOSED = OWS.CLOSED;
                window.WebSocket = WS;
            }
        } catch (e) {}
    })(typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window);

    /* ------------------- cross-device baseline sync ---------------------- */
    // rolling = lifetime(now) - lifetime(7d ago). lifetime(now) is a server value
    // (already identical on every device); only the 7d-ago baseline is local. This
    // exports/imports a small downsampled set of the lifetime snapshots (ltAnchors)
    // as a copy-paste code, so a second device on the SAME account is pinpoint
    // immediately instead of after a 7-day warm-up. Nothing is sent anywhere: data
    // only moves when YOU copy a code and paste it on your other device.
    var SYNC_PREFIX = 'STK7W-B1.';
    function b64enc(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return btoa(s); } }
    function b64dec(s) { try { return decodeURIComponent(escape(atob(s))); } catch (e) { return atob(s); } }
    // downsample ltAnchors over the trailing window (denser near the 7d-ago edge)
    function baselineAnchors(an, now) {
        var out = [], lastT = -Infinity, minT = now - (WINDOW_MS + 18 * 3600 * 1000), edge = now - WINDOW_MS;
        for (var i = 0; i < an.length; i++) {
            var p = an[i]; if (!p || p.t < minT) continue;
            var gap = (Math.abs(p.t - edge) <= 12 * 3600 * 1000) ? (30 * 60 * 1000) : (60 * 60 * 1000);
            if (p.t - lastT >= gap) { out.push(p); lastT = p.t; }
        }
        if (an.length) { var L = an[an.length - 1]; if (!out.length || out[out.length - 1].t !== L.t) out.push(L); }
        return out;
    }
    function exportBaselineCode() {
        var a = acct(); if (!a || !a.ltAnchors || !a.ltAnchors.length) return null;
        var now = Date.now(), pts = baselineAnchors(a.ltAnchors, now);
        if (!pts.length) return null;
        var d = [], pt = 0, pc = 0;   // delta-encoded [t0sec,cum0],[dt,dcum],...
        for (var i = 0; i < pts.length; i++) {
            var ts = Math.round(pts[i].t / 1000), cu = Math.round(pts[i].cum);
            d.push(i === 0 ? [ts, cu] : [ts - pt, cu - pc]); pt = ts; pc = cu;
        }
        var payload = { v: 1, u: String(S.active || ''), n: (a.name || ''), c: S.currency, g: Math.round(now / 1000), d: d };
        return SYNC_PREFIX + b64enc(JSON.stringify(payload));
    }
    function importBaselineCode(str) {
        if (!str) return { ok: false, msg: 'Paste a code first.' };
        str = String(str).trim(); var i = str.indexOf(SYNC_PREFIX);
        if (i < 0) return { ok: false, msg: 'That does not look like a sync code.' };
        var json; try { json = JSON.parse(b64dec(str.slice(i + SYNC_PREFIX.length))); } catch (e) { return { ok: false, msg: 'Code is corrupted or incomplete.' }; }
        if (!json || json.v !== 1 || !Array.isArray(json.d) || !json.d.length) return { ok: false, msg: 'Unrecognised code.' };
        var anchors = [], pt = 0, pc = 0;
        for (var k = 0; k < json.d.length; k++) {
            var e = json.d[k]; if (!e || e.length < 2) continue;
            if (k === 0) { pt = e[0]; pc = e[1]; } else { pt += e[0]; pc += e[1]; }
            anchors.push({ t: pt * 1000, cum: pc });
        }
        if (!anchors.length) return { ok: false, msg: 'No snapshots in code.' };
        var id = json.u || S.active;
        if (!id) return { ok: false, msg: 'No account detected yet — open Stake first.' };
        if (S.active && json.u && String(json.u) !== String(S.active)) return { ok: false, msg: 'That code is from a different Stake account.' };
        if (!S.accounts[id]) S.accounts[id] = blankAccount();
        var a = S.accounts[id], before = (a.ltAnchors || []).length;
        a.ltAnchors = unionAnchors(a.ltAnchors, anchors);
        a.ltSeeded = true;
        var oldest = a.ltAnchors.length ? a.ltAnchors[0].t : Date.now();
        a.ltStart = a.ltStart ? Math.min(a.ltStart, oldest) : oldest;   // claim coverage back to the imported history -> pinpoint now
        if (json.n && !a.name) a.name = String(json.n);
        flushSave(); scheduleRender();
        var added = a.ltAnchors.length - before;
        return { ok: true, msg: 'Imported ' + anchors.length + ' snapshots (' + (added > 0 ? ('+' + added + ' new') : 'already current') + '). Baseline updated.' };
    }
    // self-contained sync dialog (shared by desktop + mobile; inline-styled, no CSS deps)
    function openSyncDialog() {
        if (document.getElementById('stk7w-sync')) return;
        var code = null; try { code = exportBaselineCode(); } catch (e) {}
        var ov = document.createElement('div'); ov.id = 'stk7w-sync';
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background:rgba(3,8,12,.62);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);padding:14px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
        var btn = 'border:0;border-radius:9px;padding:11px 15px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;-webkit-appearance:none;';
        var ta = 'width:100%;box-sizing:border-box;background:#06121b;border:1px solid #2f4553;color:#cfe0ec;border-radius:9px;padding:10px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;line-height:1.4;resize:none;-webkit-user-select:text;user-select:text;';
        var lbl = 'font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#65808f;font-weight:700;margin:0 0 6px;';
        var card = document.createElement('div');
        card.style.cssText = 'width:min(460px,94vw);max-height:90vh;overflow:auto;background:linear-gradient(180deg,#102433,#0a1620);border:1px solid #26404e;border-radius:16px;box-shadow:0 30px 70px -18px rgba(0,0,0,.82);color:#e8f0f5;padding:18px;';
        card.innerHTML =
            '<div style="font-size:15px;font-weight:800;margin-bottom:4px;">Cross-device sync</div>'
          + '<div style="font-size:12px;color:#9fb4c1;line-height:1.5;margin-bottom:15px;">Same Stake account on another device? Copy this code there and tap <b>Apply</b> to calibrate its 7-day total right away — no week-long warm-up.</div>'
          + '<div style="' + lbl + '">This device&rsquo;s code</div>'
          + '<textarea id="stk7w-sc-out" readonly rows="3" style="' + ta + '"></textarea>'
          + '<button id="stk7w-sc-copy" style="' + btn + 'background:#1fd655;color:#062c14;margin-top:8px;">Copy code</button>'
          + '<div style="height:1px;background:rgba(255,255,255,.08);margin:16px 0;"></div>'
          + '<div style="' + lbl + '">Paste a code from your other device</div>'
          + '<textarea id="stk7w-sc-in" rows="3" placeholder="Paste STK7W-B1… code here" style="' + ta + '"></textarea>'
          + '<div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap;">'
          + '<button id="stk7w-sc-apply" style="' + btn + 'background:#2a4d63;color:#fff;">Apply</button>'
          + '<button id="stk7w-sc-close" style="' + btn + 'background:transparent;color:#9fb4c1;border:1px solid #2f4553;">Close</button>'
          + '<span id="stk7w-sc-msg" style="font-size:11.5px;color:#9fb4c1;"></span>'
          + '</div>';
        ov.appendChild(card); document.body.appendChild(ov);
        function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
        ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
        var out = card.querySelector('#stk7w-sc-out'), msg = card.querySelector('#stk7w-sc-msg'), copyBtn = card.querySelector('#stk7w-sc-copy');
        if (code) { out.value = code; }
        else { out.value = ''; out.placeholder = 'No baseline yet — let the tracker run a little, then come back.'; copyBtn.disabled = true; copyBtn.style.opacity = '.5'; copyBtn.style.cursor = 'default'; }
        copyBtn.addEventListener('click', function () {
            if (!code) return;
            out.focus(); out.select();
            var done = function () { msg.textContent = 'Copied!'; msg.style.color = '#1fd655'; };
            try { navigator.clipboard.writeText(out.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) { msg.textContent = 'Select all, then copy'; msg.style.color = '#ffb020'; } }); }
            catch (e) { try { document.execCommand('copy'); done(); } catch (e2) { msg.textContent = 'Select all, then copy'; msg.style.color = '#ffb020'; } }
        });
        card.querySelector('#stk7w-sc-apply').addEventListener('click', function () {
            var r = importBaselineCode(card.querySelector('#stk7w-sc-in').value);
            msg.textContent = r.msg; msg.style.color = r.ok ? '#1fd655' : '#ff6b76';
            if (r.ok) { try { render(); } catch (e) {} setTimeout(close, 1500); }
        });
        card.querySelector('#stk7w-sc-close').addEventListener('click', close);
    }

    /* ------------------------------- HUD --------------------------------- */
    var hud = {};
    var renderQueued = false;
    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(function () { renderQueued = false; render(); });
    }

    function injectStyle() {
        var css = `
        /* ===== collapsed readout pill (top-right, draggable) ===== */
        #stk7w-pill{position:fixed;z-index:2147483600;top:calc(env(safe-area-inset-top, 0px) + 60px);right:12px;
          display:inline-flex;align-items:center;gap:8px;padding:8px 12px;touch-action:none;cursor:pointer;
          background:linear-gradient(180deg,#11283a,#0a1722);border:1px solid rgba(31,214,85,.5);border-radius:13px;
          box-shadow:0 10px 26px -10px rgba(0,0,0,.72),0 0 0 1px rgba(255,255,255,.03) inset;
          color:#e8f0f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
          opacity:1;transition:opacity .2s ease,transform .2s ease;}
        #stk7w-pill.hide{opacity:0;transform:scale(.9);pointer-events:none;}
        #stk7w-pill .dl{width:8px;height:8px;border-radius:50%;background:#1fd655;box-shadow:0 0 9px #1fd655;flex:none;animation:stk7wpulse 1.9s infinite ease-in-out;}
        #stk7w-pill .pv{font-size:14px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;}
        #stk7w-pill .pv i{font-style:normal;color:#8aa0b0;font-weight:600;font-size:10px;margin-left:3px;}
        #stk7w-pill .cv{color:#5f7585;font-size:10px;}

        /* ===== scrim ===== */
        #stk7w-scrim{position:fixed;inset:0;z-index:2147483599;background:rgba(3,8,12,.55);
          opacity:0;pointer-events:none;transition:opacity .25s ease;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);touch-action:none;}
        #stk7w-scrim.show{opacity:1;pointer-events:auto;}

        /* ===== expanded bottom sheet ===== */
        #stk7w{position:fixed;z-index:2147483601;left:0;right:0;bottom:0;max-height:93vh;display:flex;flex-direction:column;
          color:#e8f0f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;
          background:
            radial-gradient(140% 90% at 12% -6%,rgba(31,214,85,.09),transparent 42%),
            radial-gradient(130% 100% at 100% 0%,rgba(79,184,214,.07),transparent 48%),
            linear-gradient(180deg,#102433,#0a1620);
          border:1px solid #26404e;border-bottom:none;border-radius:22px 22px 0 0;
          box-shadow:0 -24px 60px -12px rgba(0,0,0,.8);
          transform:translateY(102%);transition:transform .3s cubic-bezier(.22,1,.36,1);overflow:hidden;overscroll-behavior:none;}
        #stk7w.show{transform:translateY(0);}
        #stk7w *{box-sizing:border-box;}
        #stk7w .mono{font-family:ui-monospace,SFMono-Regular,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums;}
        @keyframes stk7wpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}

        #stk7w .grab{padding:9px 0 3px;display:flex;justify-content:center;flex:none;touch-action:none;}
        #stk7w .grab i{width:38px;height:4px;border-radius:3px;background:rgba(255,255,255,.22);}
        #stk7w .hd{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:5px 16px 12px;
          border-bottom:1px solid rgba(255,255,255,.06);flex:none;touch-action:none;}
        #stk7w .who{display:flex;align-items:center;gap:9px;min-width:0;}
        #stk7w .live{display:inline-flex;align-items:center;gap:6px;font-size:9px;letter-spacing:.14em;color:#1fd655;text-transform:uppercase;font-weight:700;flex:none;}
        #stk7w .live i{width:7px;height:7px;border-radius:50%;background:#1fd655;box-shadow:0 0 9px #1fd655;animation:stk7wpulse 1.9s infinite ease-in-out;}
        #stk7w .acct{font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        #stk7w .tix{font-size:11.5px;color:#8aa0b0;white-space:nowrap;flex:none;}
        #stk7w .rt{display:flex;align-items:center;gap:9px;flex:none;}
        #stk7w .badge{font-size:10px;font-weight:800;letter-spacing:.06em;color:#1fd655;background:rgba(31,214,85,.13);border:1px solid rgba(31,214,85,.27);padding:4px 9px;border-radius:7px;}
        #stk7w .x{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.05);color:#8aa0b0;font-size:18px;cursor:pointer;}
        #stk7w .x:active{background:rgba(255,255,255,.1);color:#fff;}

        #stk7w .bd{overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:14px 16px calc(20px + env(safe-area-inset-bottom, 0px));}
        #stk7w .bd::-webkit-scrollbar{width:0;height:0;}

        #stk7w .lbl{font-size:9.5px;letter-spacing:.18em;color:#6a8493;text-transform:uppercase;font-weight:700;}
        #stk7w .herowrap{text-align:left;}
        #stk7w .hero{display:flex;align-items:baseline;gap:8px;margin-top:8px;}
        #stk7w .hnum{font-size:44px;font-weight:800;line-height:.9;letter-spacing:-2px;color:#fff;text-shadow:0 0 34px rgba(31,214,85,.3);}
        #stk7w .hu{font-size:16px;color:#8aa0b0;font-weight:600;}
        #stk7w .pin{margin-top:10px;font-size:11.5px;color:#1fd655;font-family:ui-monospace,Menlo,monospace;}
        #stk7w .pin.wait{color:#ffb020;}
        #stk7w .pin b{font-weight:800;}

        #stk7w .card{margin-top:14px;background:#0a1822;border:1px solid rgba(255,255,255,.05);border-radius:15px;padding:14px;box-shadow:inset 0 2px 12px rgba(0,0,0,.4);}
        #stk7w .card .ct{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;}
        #stk7w .card .ct .lbl{margin:0;}

        #stk7w .gbar{height:9px;border-radius:6px;background:#06121b;box-shadow:inset 0 1px 3px rgba(0,0,0,.6);overflow:hidden;}
        #stk7w .gbar>i{display:block;height:100%;border-radius:6px;width:0;background:linear-gradient(90deg,#00a838,#1fd655);box-shadow:0 0 12px rgba(31,214,85,.6);transition:width .3s;}
        #stk7w .gmeta{display:flex;justify-content:space-between;margin-top:10px;font-size:12px;color:#9fb4c1;cursor:pointer;}
        #stk7w .gmeta .pc{color:#1fd655;font-weight:700;}
        #stk7w .gmeta .rem-ok{color:#1fd655;font-weight:700;}
        #stk7w .gedit{display:none;width:100%;margin-top:10px;background:#06121b;border:1px solid #2f4553;color:#fff;border-radius:8px;padding:9px 11px;font-size:15px;font-family:ui-monospace,Menlo,monospace;}

        #stk7w .ctrls{display:flex;gap:6px;}
        #stk7w .ctrls button{min-width:36px;height:32px;padding:0 9px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#9fb4c1;border-radius:8px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;-webkit-appearance:none;}
        #stk7w .ctrls button:active{background:rgba(255,255,255,.1);color:#fff;}
        #stk7w .ctrls button.on{color:#1fd655;border-color:rgba(31,214,85,.5);background:rgba(31,214,85,.1);}
        #stk7w .well{background:#07121a;border:1px solid rgba(255,255,255,.045);border-radius:11px;box-shadow:inset 0 2px 10px rgba(0,0,0,.55);padding:9px 8px 4px;}
        #stk7w #stk7w-gcanvas{width:100%;height:160px;display:block;touch-action:none;}

        #stk7w .meter{display:flex;height:11px;border-radius:7px;overflow:hidden;background:#06121b;box-shadow:inset 0 1px 3px rgba(0,0,0,.6);}
        #stk7w .meter>i{height:100%;width:0;transition:width .3s;}
        #stk7w .rline{display:flex;justify-content:space-between;align-items:center;margin-top:11px;font-size:12px;}
        #stk7w .rline .rk{display:flex;align-items:center;gap:8px;color:#aebecb;min-width:0;}
        #stk7w .rline .rk i{width:9px;height:9px;border-radius:3px;flex:none;}
        #stk7w .rline .rval{font-weight:700;color:#eef4f8;margin-left:10px;white-space:nowrap;}

        #stk7w .egp{display:flex;justify-content:space-between;align-items:center;margin:2px 0 4px;}
        #stk7w .egp:not(:first-child){margin-top:16px;}
        #stk7w .egn{font-size:12.5px;font-weight:800;color:#dce6ec;}
        #stk7w .egn span{color:#65808f;font-weight:600;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;margin-left:6px;}
        #stk7w .egc{font-size:10px;font-weight:800;padding:3px 10px;border-radius:20px;}
        #stk7w .egc.ok{background:rgba(31,214,85,.15);color:#1fd655;}
        #stk7w .egc.no{background:rgba(255,91,104,.14);color:#ff6b76;}
        #stk7w .egc.part{background:rgba(255,176,32,.15);color:#ffb020;}
        #stk7w .et{display:flex;align-items:center;gap:11px;padding:9px 0;border-top:1px solid rgba(255,255,255,.045);}
        #stk7w .ep{width:11px;height:11px;border-radius:50%;flex:none;}
        #stk7w .ep.ok{background:#1fd655;box-shadow:0 0 9px rgba(31,214,85,.7);}
        #stk7w .ep.no{background:transparent;border:1.5px solid #ff5b68;}
        #stk7w .etn{font-size:13px;color:#cdd9e2;}
        #stk7w .etn b{color:#fff;font-weight:700;}
        #stk7w .etn .rq{color:#5f7585;font-size:11px;margin-left:6px;}
        #stk7w .es{margin-left:auto;font-size:12.5px;font-weight:700;text-align:right;}
        #stk7w .es .q{color:#65808f;font-size:10px;font-weight:600;margin-left:3px;}

        /* ===== chart hover/scrub tooltip ===== */
        #stk7w-gtip{position:fixed;z-index:2147483647;pointer-events:none;display:none;background:#0a1822;border:1px solid rgba(79,184,214,.4);border-radius:8px;padding:7px 10px;box-shadow:0 8px 24px rgba(0,0,0,.6);}
        #stk7w-gtip .gtl{color:#65808f;font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-family:ui-monospace,Menlo,monospace;}
        #stk7w-gtip .gtv{color:#fff;font-size:12.5px;font-weight:700;margin-top:2px;font-family:ui-monospace,Menlo,monospace;}
        #stk7w-gtip .gtf{color:#9fd0e0;font-size:10px;margin-top:3px;font-family:ui-monospace,Menlo,monospace;}
        `;
        var st = document.createElement('style');
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    // compact (no-decimal) value for the glanceable pill
    function fmtPill(n) { return isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '–'; }

    // keep the draggable pill inside the viewport (after rotation / resize)
    function clampPill() {
        var p = hud.pill; if (!p) return;
        if (S.ui.left == null || S.ui.top == null) return;   // still default-anchored (top-right)
        var w = p.offsetWidth || 120, h = p.offsetHeight || 40;
        var nl = Math.max(6, Math.min(window.innerWidth - w - 6, S.ui.left));
        var nt = Math.max(6, Math.min(window.innerHeight - h - 6, S.ui.top));
        p.style.left = nl + 'px'; p.style.top = nt + 'px'; p.style.right = 'auto';
    }
    function positionPill() {
        var p = hud.pill; if (!p) return;
        if (S.ui.left != null && S.ui.top != null) clampPill();   // restore saved spot
        // else: CSS default (top-right) applies
    }

    function buildHud() {
        if (document.getElementById('stk7w')) return;
        injectStyle();

        // ---- collapsed readout pill ----
        var pill = document.createElement('div');
        pill.id = 'stk7w-pill';
        pill.innerHTML = '<span class="dl"></span><span class="pv mono" id="stk7w-pv">–</span><span class="cv">▾</span>';
        document.body.appendChild(pill);
        hud.pill = pill;
        hud.pv = pill.querySelector('#stk7w-pv');

        // ---- scrim ----
        var scrim = document.createElement('div');
        scrim.id = 'stk7w-scrim';
        document.body.appendChild(scrim);
        hud.scrim = scrim;

        // ---- sheet ----
        var w = document.createElement('div');
        w.id = 'stk7w';
        w.setAttribute('data-ver', VERSION);
        w.innerHTML =
            '<div class="grab" id="stk7w-grab"><i></i></div>'
          + '<div class="hd" id="stk7w-hd">'
          + '  <div class="who"><span class="live"><i></i>Live</span><span class="acct" id="stk7w-acct">—</span><span class="tix" id="stk7w-tix">· — tickets</span></div>'
          + '  <div class="rt"><span class="x" id="stk7w-sync-btn" title="cross-device sync" style="font-size:17px;">⇄</span><span class="badge" id="stk7w-cur">' + S.currency + '</span><span class="x" id="stk7w-x">✕</span></div>'
          + '</div>'
          + '<div class="bd" id="stk7w-bd">'
          + '  <div class="herowrap">'
          + '    <div class="lbl">Rolling 7-Day Wager</div>'
          + '    <div class="hero"><span class="hnum mono" id="stk7w-roll">–</span><span class="hu" id="stk7w-hu">' + S.currency + '</span></div>'
          + '    <div class="pin" id="stk7w-cover">—</div>'
          + '  </div>'
          + '  <div class="card">'
          + '    <div class="ct"><div class="lbl">Goal</div><div class="lbl" id="stk7w-gpct" style="color:#1fd655"></div></div>'
          + '    <div class="gbar"><i id="stk7w-fill"></i></div>'
          + '    <div class="gmeta" id="stk7w-gmeta"><span id="stk7w-gleft">No goal set</span><span class="mono" id="stk7w-gright">tap to set →</span></div>'
          + '    <input class="gedit mono" id="stk7w-target" type="number" inputmode="decimal" min="0" step="any" placeholder="goal (' + S.currency + ')">'
          + '  </div>'
          + '  <div class="card">'
          + '    <div class="ct"><div class="lbl">Wager Activity · 7d</div>'
          + '      <div class="ctrls"><button class="on" id="stk7w-glive" title="snap to live">⟲</button><button id="stk7w-gout" title="zoom out">−</button><button id="stk7w-gin" title="zoom in">+</button><button id="stk7w-gfit" title="fit 7 days">⛶</button></div>'
          + '    </div>'
          + '    <div class="well"><canvas id="stk7w-gcanvas"></canvas></div>'
          + '  </div>'
          + '  <div class="card">'
          + '    <div class="ct"><div class="lbl">RTP Distribution</div></div>'
          + '    <div class="meter"><i id="stk7w-mhi" style="background:linear-gradient(90deg,#16b045,#1fd655)"></i><i id="stk7w-mmid" style="background:#ffb020"></i><i id="stk7w-mlow" style="background:linear-gradient(90deg,#ff5b68,#c43d48)"></i></div>'
          + '    <div class="rline"><span class="rk"><i style="background:#1fd655"></i>Originals (99%&lt;)</span><span class="rval mono" id="stk7w-bhi">—</span></div>'
          + '    <div class="rline"><span class="rk"><i style="background:#ffb020"></i>Originals / Table (98–99%)</span><span class="rval mono" id="stk7w-bmid">—</span></div>'
          + '    <div class="rline"><span class="rk"><i style="background:#ff5b68"></i>Slots (98%&gt;)</span><span class="rval mono" id="stk7w-blow">—</span></div>'
          + '  </div>'
          + '  <div class="card">'
          + '    <div class="ct" style="margin-bottom:4px"><div class="lbl">Code Eligibility</div></div>'
          + '    <div id="stk7w-elig"></div>'
          + '  </div>'
          + '</div>';
        document.body.appendChild(w);
        hud.w = w;
        hud.acct = w.querySelector('#stk7w-acct');
        hud.tix = w.querySelector('#stk7w-tix');
        hud.cur = w.querySelector('#stk7w-cur');
        hud.roll = w.querySelector('#stk7w-roll');
        hud.hu = w.querySelector('#stk7w-hu');
        hud.cover = w.querySelector('#stk7w-cover');
        hud.fill = w.querySelector('#stk7w-fill');
        hud.gpct = w.querySelector('#stk7w-gpct');
        hud.gmeta = w.querySelector('#stk7w-gmeta');
        hud.gleft = w.querySelector('#stk7w-gleft');
        hud.gright = w.querySelector('#stk7w-gright');
        hud.target = w.querySelector('#stk7w-target');
        hud.mhi = w.querySelector('#stk7w-mhi');
        hud.mmid = w.querySelector('#stk7w-mmid');
        hud.mlow = w.querySelector('#stk7w-mlow');
        hud.bhi = w.querySelector('#stk7w-bhi');
        hud.bmid = w.querySelector('#stk7w-bmid');
        hud.blow = w.querySelector('#stk7w-blow');
        hud.bd = w.querySelector('#stk7w-bd');

        // ---- chart tooltip ----
        hud.gtip = document.createElement('div'); hud.gtip.id = 'stk7w-gtip'; document.body.appendChild(hud.gtip);
        hud.gcanvas = w.querySelector('#stk7w-gcanvas');
        hud.glive = w.querySelector('#stk7w-glive');
        if (S.ui.graphLive == null) S.ui.graphLive = true;
        gView.end = Date.now();

        // ---- chart zoom / live helpers (shared with touch + buttons) ----
        function setLiveBtn() { if (hud.glive) hud.glive.classList.toggle('on', !!S.ui.graphLive); }
        function applyZoom(ns, ne) {
            var now = Date.now();
            S.ui.graphSpan = Math.max(GSPAN_MIN, Math.min(GSPAN_MAX, ns));
            if (ne >= now - 500) { S.ui.graphLive = true; gView.end = now; }
            else { S.ui.graphLive = false; gView.end = ne; }
            setLiveBtn(); scheduleGraph();
        }
        function zoomBy(factor, atX) {
            var W = hud.gcanvas.clientWidth || 300, span = gSpan(), end = gEnd();
            var cx = (atX == null) ? W / 2 : atX, tc = (end - span) + (cx / W) * span;
            var ns = span * factor;
            applyZoom(ns, tc + ns * (1 - cx / W)); save();
        }
        hud.glive.addEventListener('click', function () { S.ui.graphLive = true; gView.end = Date.now(); save(); setLiveBtn(); scheduleGraph(); });
        w.querySelector('#stk7w-gout').addEventListener('click', function () { zoomBy(1 / 0.7); });
        w.querySelector('#stk7w-gin').addEventListener('click', function () { zoomBy(0.7); });
        w.querySelector('#stk7w-gfit').addEventListener('click', function () { S.ui.graphSpan = GSPAN_MAX; S.ui.graphLive = true; gView.end = Date.now(); save(); setLiveBtn(); scheduleGraph(); });
        setLiveBtn();

        // ---- chart touch: 1 finger = pan / scrub (axis-decided), 2 fingers = pinch-zoom ----
        var ct = { mode: null, moved: false, sx0: 0, sy0: 0, sx: 0, end0: 0, span0: 0, cx0: 0, pinch0: 0, hideT: 0 };
        function tdist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
        function tmid(t) { return (t[0].clientX + t[1].clientX) / 2; }
        function clearScrub() { if (ct.hideT) { clearTimeout(ct.hideT); ct.hideT = 0; } gView.hoverX = null; gHideTip(); }
        function scrubAt(clientX, clientY) {
            var rect = hud.gcanvas.getBoundingClientRect();
            gView.hoverX = clientX - rect.left; gView.mx = clientX; gView.my = clientY - 54; scheduleGraph();   // lift tooltip above the fingertip
        }
        var cv = hud.gcanvas;
        cv.addEventListener('touchstart', function (e) {
            if (ct.hideT) { clearTimeout(ct.hideT); ct.hideT = 0; }
            if (e.touches.length >= 2) {
                ct.mode = 'pinch'; ct.pinch0 = tdist(e.touches); ct.span0 = gSpan(); ct.end0 = gEnd();
                ct.cx0 = tmid(e.touches) - cv.getBoundingClientRect().left; gView.hoverX = null; gHideTip();
            } else {
                ct.mode = 'maybe'; ct.moved = false;
                ct.sx0 = e.touches[0].clientX; ct.sy0 = e.touches[0].clientY; ct.sx = ct.sx0; ct.end0 = gEnd();
            }
            e.preventDefault();
        }, { passive: false });
        cv.addEventListener('touchmove', function (e) {
            var W = cv.clientWidth || 300, now = Date.now();
            if (ct.mode === 'pinch' && e.touches.length >= 2) {
                var d = tdist(e.touches);
                if (ct.pinch0 > 0 && d > 0) {
                    var ns = ct.span0 * (ct.pinch0 / d), tc = (ct.end0 - ct.span0) + (ct.cx0 / W) * ct.span0;
                    applyZoom(ns, tc + ns * (1 - ct.cx0 / W));
                }
            } else if (e.touches.length === 1) {
                var t = e.touches[0], dx = t.clientX - ct.sx0, dy = t.clientY - ct.sy0;
                if (ct.mode === 'maybe' && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
                    ct.mode = (Math.abs(dx) >= Math.abs(dy)) ? 'pan' : 'scrub'; ct.moved = true;
                    if (ct.mode === 'pan') { ct.end0 = gEnd(); ct.sx = t.clientX; clearScrub(); }
                }
                if (ct.mode === 'pan') {
                    var span = gSpan(), ne = ct.end0 - ((t.clientX - ct.sx) / W) * span;
                    ne = Math.max(now - WINDOW_MS + span, Math.min(now, ne));
                    S.ui.graphLive = (ne >= now - 500); gView.end = ne; setLiveBtn(); scheduleGraph();
                } else if (ct.mode === 'scrub') {
                    scrubAt(t.clientX, t.clientY);
                }
            }
            e.preventDefault();
        }, { passive: false });
        cv.addEventListener('touchend', function (e) {
            if (ct.mode === 'pan' || ct.mode === 'pinch') save();
            if (ct.mode === 'maybe' && !ct.moved) scrubAt(ct.sx0, ct.sy0);   // a tap → read that point
            if (ct.mode === 'scrub' || (ct.mode === 'maybe' && !ct.moved)) {
                ct.hideT = setTimeout(clearScrub, 2600);                      // linger, then clear
            }
            if (!e.touches.length) ct.mode = null;
        });

        // ---- pill: tap to open, drag to reposition ----
        var pd = { on: false, moved: false, sx: 0, sy: 0, ox: 0, oy: 0 };
        pill.addEventListener('touchstart', function (e) {
            var t = e.touches[0]; pd.on = true; pd.moved = false; pd.sx = t.clientX; pd.sy = t.clientY;
            var r = pill.getBoundingClientRect(); pd.ox = r.left; pd.oy = r.top;
        }, { passive: true });
        pill.addEventListener('touchmove', function (e) {
            if (!pd.on) return;
            var t = e.touches[0], dx = t.clientX - pd.sx, dy = t.clientY - pd.sy;
            if (Math.abs(dx) + Math.abs(dy) > 6) pd.moved = true;
            if (pd.moved) {
                e.preventDefault();
                var nl = Math.max(6, Math.min(window.innerWidth - pill.offsetWidth - 6, pd.ox + dx));
                var nt = Math.max(6, Math.min(window.innerHeight - pill.offsetHeight - 6, pd.oy + dy));
                pill.style.left = nl + 'px'; pill.style.top = nt + 'px'; pill.style.right = 'auto';
            }
        }, { passive: false });
        pill.addEventListener('touchend', function () {
            if (!pd.on) return; pd.on = false;
            if (pd.moved) { var r = pill.getBoundingClientRect(); S.ui.left = Math.round(r.left); S.ui.top = Math.round(r.top); save(); }
        });
        pill.addEventListener('click', function () {
            if (pd.moved) { pd.moved = false; return; }   // a drag, not a tap
            S.ui.open = true; save(); applyOpen();
        });

        // ---- close: scrim tap, ✕, swipe the grab/header down ----
        scrim.addEventListener('click', function () { S.ui.open = false; save(); applyOpen(); });
        w.querySelector('#stk7w-x').addEventListener('click', function () { S.ui.open = false; save(); applyOpen(); });
        w.querySelector('#stk7w-sync-btn').addEventListener('click', openSyncDialog);
        // swipe-down to close: works from the grabber/header anywhere, OR from the body once it's
        // scrolled to the top. Overscroll is contained + the page is locked while open, so a swipe
        // can never fall through to the browser's pull-to-refresh. Chart/controls are excluded.
        var grabEl = w.querySelector('#stk7w-grab'), hdEl = w.querySelector('#stk7w-hd');
        var sd = { armed: false, active: false, fromHandle: false, startY: 0, dy: 0 };
        function inNode(t, el) { return el && (t === el || el.contains(t)); }
        function sheetStart(e) {
            if (e.touches.length !== 1) { sd.armed = false; return; }
            var t = e.touches[0], tg = e.target;
            if (inNode(tg, hud.gcanvas) || (tg.closest && tg.closest('.ctrls, input, textarea, button'))) { sd.armed = false; return; }
            sd.fromHandle = inNode(tg, grabEl) || inNode(tg, hdEl);
            sd.armed = sd.fromHandle || (hud.bd.scrollTop <= 0);
            sd.active = false; sd.startY = t.clientY; sd.dy = 0;
        }
        function sheetMove(e) {
            if (!sd.armed || e.touches.length !== 1) return;
            var dy = e.touches[0].clientY - sd.startY;
            if (!sd.active) {
                if (dy > 7 && (sd.fromHandle || hud.bd.scrollTop <= 0)) { sd.active = true; w.style.transition = 'none'; }
                else return;   // not a downward-from-top gesture -> let the body scroll normally
            }
            if (dy < 0) dy = 0;
            sd.dy = dy; w.style.transform = 'translateY(' + dy + 'px)';
            e.preventDefault();   // we own this gesture now: no body scroll, no pull-to-refresh
        }
        function sheetEnd() {
            if (!sd.active) { sd.armed = false; return; }
            sd.active = false; sd.armed = false; w.style.transition = ''; w.style.transform = '';
            if (sd.dy > 90) { S.ui.open = false; save(); applyOpen(); }
        }
        w.addEventListener('touchstart', sheetStart, { passive: true });
        w.addEventListener('touchmove', sheetMove, { passive: false });
        w.addEventListener('touchend', sheetEnd);
        w.addEventListener('touchcancel', sheetEnd);

        // ---- goal: tap the meta line to edit inline ----
        var editing = false;
        function showEdit() { editing = true; hud.target.value = getTarget() || ''; hud.gmeta.style.display = 'none'; hud.target.style.display = 'block'; hud.target.focus(); }
        function hideEdit() { if (!editing) return; editing = false; hud.target.style.display = 'none'; hud.gmeta.style.display = 'flex'; render(); }
        hud.gmeta.addEventListener('click', showEdit);
        hud.target.addEventListener('input', function () { var a = acct(true); if (a) { a.target = parseFloat(hud.target.value) || 0; a.targetAt = Date.now(); save(); } });
        hud.target.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') { hud.target.blur(); } });
        hud.target.addEventListener('blur', hideEdit);

        // ---- currency badge (crypto sites cycle; social is SC-only) ----
        if (TRACK_CCY.length > 1) hud.cur.addEventListener('click', cycleCurrency);
        else hud.cur.style.cursor = 'default';

        // ---- Code Eligibility ladder ----
        var DROPS = [
            { name: 'Daily', tiers: [{ v: '$1', req: 4000 }, { v: '$2', req: 8000 }, { v: '$3', req: 12000 }] },
            { name: 'High Roller', tiers: [{ v: '$12.50', req: 50000 }, { v: '$25', req: 100000 }, { v: '$50', req: 200000 }] }
        ];
        hud.elig = w.querySelector('#stk7w-elig');
        hud.drops = [];
        DROPS.forEach(function (grp) {
            var head = document.createElement('div'); head.className = 'egp';
            var nm = document.createElement('div'); nm.className = 'egn'; nm.innerHTML = grp.name + '<span>Drops</span>';
            var cnt = document.createElement('div'); cnt.className = 'egc'; cnt.textContent = '0/' + grp.tiers.length;
            head.appendChild(nm); head.appendChild(cnt); hud.elig.appendChild(head);
            var tiers = [];
            grp.tiers.forEach(function (ti) {
                var row = document.createElement('div'); row.className = 'et';
                var pip = document.createElement('span'); pip.className = 'ep no';
                var name = document.createElement('span'); name.className = 'etn mono';
                name.innerHTML = '<b>' + ti.v + '</b><span class="rq">' + fmtShort(ti.req) + '</span>';
                var es = document.createElement('span'); es.className = 'es mono'; es.textContent = '—';
                row.appendChild(pip); row.appendChild(name); row.appendChild(es); hud.elig.appendChild(row);
                tiers.push({ pip: pip, es: es, req: ti.req });
            });
            hud.drops.push({ cnt: cnt, tiers: tiers, total: grp.tiers.length });
        });

        window.addEventListener('resize', function () { clampPill(); scheduleRender(); });
        if (S.ui.open == null) S.ui.open = false;
        positionPill();
        applyOpen();
        render();
    }

    function applyOpen() {
        if (!hud.w) return;
        if (S.ui.open) {
            hud.w.classList.add('show'); hud.scrim.classList.add('show'); hud.pill.classList.add('hide');
            document.documentElement.style.overscrollBehaviorY = 'none';   // block page pull-to-refresh while open
        } else {
            hud.w.classList.remove('show'); hud.scrim.classList.remove('show'); hud.pill.classList.remove('hide');
            document.documentElement.style.overscrollBehaviorY = '';
            if (hud.gtip) { gView.hoverX = null; hud.gtip.style.display = 'none'; }
        }
        render();
    }

    function cycleCurrency() {
        var idx = TRACK_CCY.indexOf(S.currency);
        S.currency = TRACK_CCY[(idx + 1) % TRACK_CCY.length];
        save(); render();
    }

    function render() {
        if (!hud.w) return;
        var C = ' ' + S.currency;
        if (hud.cur) hud.cur.textContent = S.currency;
        if (hud.hu) hud.hu.textContent = S.currency;

        var a = acct();
        hud.acct.textContent = a ? (a.name || (S.active || '').slice(0, 12) + '…') : 'detecting…';
        hud.tix.textContent = '· ' + ((a && a.tickets != null) ? a.tickets : '—') + ' tickets';

        var info = rolling();
        var rollStr = info.ready ? fmt(info.rolling) : '–';
        hud.roll.textContent = rollStr;
        if (hud.pv) hud.pv.innerHTML = (info.ready ? fmtPill(info.rolling) : '–') + '<i>' + S.currency + '</i>';

        // header: pinpoint / coverage status
        if (!a) { hud.cover.textContent = 'detecting account…'; hud.cover.className = 'pin wait'; }
        else if (!info.ready) { hud.cover.textContent = 'reading lifetime…'; hud.cover.className = 'pin wait'; }
        else if (info.realFull) { hud.cover.innerHTML = '✓ <b>calibrated</b>'; hud.cover.className = 'pin'; }
        else {
            var bridged = !!(a.ltAnchors && a.ltAnchors.some(function (p) { return p.seed; }));
            hud.cover.innerHTML = '◷ ' + (bridged ? 'calibrated in ' : 'full window in ') + '<b>' + formatDur(WINDOW_MS - info.realCoverMs) + '</b>';
            hud.cover.className = 'pin wait';
        }

        // RTP distribution (sample proportions scaled to the authoritative rolling total)
        var bk = rollingBuckets(), bst = bk.high + bk.mid + bk.low;
        if (bst > 0 && info.ready) {
            var roll = info.rolling || 0, vh = roll * bk.high / bst, vm = roll * bk.mid / bst, vl = roll * bk.low / bst, tot = (vh + vm + vl) || 1;
            hud.bhi.textContent = fmtShort(vh); hud.bmid.textContent = fmtShort(vm); hud.blow.textContent = fmtShort(vl);
            hud.mhi.style.width = (vh / tot * 100) + '%'; hud.mmid.style.width = (vm / tot * 100) + '%'; hud.mlow.style.width = (vl / tot * 100) + '%';
        } else {
            hud.bhi.textContent = hud.bmid.textContent = hud.blow.textContent = '—';
            hud.mhi.style.width = hud.mmid.style.width = hud.mlow.style.width = '0%';
        }

        // goal progress
        var tgt = getTarget();
        if (tgt > 0 && info.ready) {
            var pct = Math.max(0, Math.min(1, info.rolling / tgt)), rem = tgt - info.rolling;
            hud.fill.style.width = (pct * 100) + '%';
            hud.gpct.textContent = Math.round(pct * 100) + '%';
            if (rem <= 0) { hud.gleft.innerHTML = '<span class="rem-ok">✓ goal complete</span>'; hud.gright.textContent = fmtShort(tgt) + C; }
            else { hud.gleft.innerHTML = '<span class="pc">' + Math.round(pct * 100) + '%</span> of ' + fmtShort(tgt) + ' goal'; hud.gright.textContent = fmtShort(rem) + ' to go'; }
        } else {
            hud.fill.style.width = '0%'; hud.gpct.textContent = '';
            hud.gleft.textContent = 'No goal set'; hud.gright.textContent = 'tap to set →';
        }

        // Code Eligibility
        if (hud.drops) {
            hud.drops.forEach(function (g) {
                var n = 0;
                g.tiers.forEach(function (t) {
                    if (!a || !info.ready) { t.es.textContent = '—'; t.es.style.color = '#65808f'; t.pip.className = 'ep no'; return; }
                    if (info.rolling >= t.req) {
                        n++;
                        var ems = eligTimeLeftMs(t.req);
                        t.es.innerHTML = '<b>' + (ems == null ? '—' : eligHrs(ems)) + '</b><span class="q">left</span>';
                        t.es.style.color = '#1fd655'; t.pip.className = 'ep ok';
                    } else {
                        t.es.innerHTML = '<b>+' + fmtShort(t.req - info.rolling) + '</b>';
                        t.es.style.color = '#ff6b76'; t.pip.className = 'ep no';
                    }
                });
                g.cnt.textContent = n + '/' + g.total;
                g.cnt.className = 'egc ' + ((!a || !info.ready) ? '' : (n === 0 ? 'no' : (n === g.total ? 'ok' : 'part')));
            });
        }

        if (S.ui.open) drawGraph();
    }

    /* ------------------------------ startup ------------------------------ */
    function cleanupOversizedStore() {
        try {
            var stored = readStored();
            if (!stored || !stored.accounts) return;
            var now = Date.now(), idMinT = now - LIVEID_KEEP_MS;
            var minBin = Math.floor((now - BIN_KEEP_MS) / BIN_MS), winMinT = now - WINDOW_MS, changed = false;
            Object.keys(stored.accounts).forEach(function (id) {
                var acc = stored.accounts[id]; if (!acc || !acc.cur) return;
                Object.keys(acc.cur).forEach(function (c) {
                    var rec = acc.cur[c]; if (!rec) return;
                    if (!rec.bins) rec.bins = {};
                    if (!rec._mig && rec.bets && rec.bets.length) {
                        var mw = rec.bins['migrated'] || (rec.bins['migrated'] = {});
                        rec.bets.forEach(function (bt0) {
                            if (!bt0 || bt0.t < winMinT) return;
                            var e = (bt0.edge != null) ? bt0.edge : edgeForGame(bt0.game);
                            var bk = bucketOfEdge(e), key = Math.floor(bt0.t / BIN_MS);
                            var cell = mw[key] || (mw[key] = { h: 0, m: 0, l: 0, n: 0 });
                            cell[bk === 'high' ? 'h' : bk === 'mid' ? 'm' : 'l'] += (bt0.amt || 0); cell.n += 1;
                        });
                        rec._mig = 1; changed = true;
                    }
                    if (rec.bets && rec.bets.length > BETS_CAP) { rec.bets = rec.bets.slice(rec.bets.length - BETS_CAP); changed = true; }
                    if (rec.liveIds) {
                        var kept = {}, before = 0, after = 0;
                        for (var k in rec.liveIds) { before++; if (rec.liveIds[k] >= idMinT) { kept[k] = rec.liveIds[k]; after++; } }
                        if (after !== before) { rec.liveIds = kept; changed = true; }
                    }
                    Object.keys(rec.bins).forEach(function (w) {
                        var wb = rec.bins[w], any = false;
                        Object.keys(wb).forEach(function (bk2) { if (+bk2 < minBin) { delete wb[bk2]; changed = true; } else any = true; });
                        if (!any) { delete rec.bins[w]; changed = true; }
                    });
                    // v2.9: one-time SEED of the 1-min graph bins from the existing 10-min RTP bins
                    // (remap each 10-min bin to its first 1-min slot) so the graph shows history
                    // immediately — blocky for the pre-upgrade week, sharp going forward.
                    if (!rec.gbins) rec.gbins = {};
                    if (!rec._gseed) {
                        var gseed = rec.gbins['seed'] || (rec.gbins['seed'] = {});
                        Object.keys(rec.bins).forEach(function (w) {
                            var wb = rec.bins[w];
                            Object.keys(wb).forEach(function (bk2) {
                                var c = wb[bk2], gk = (+bk2) * (BIN_MS / GBIN_MS);   // 10-min slot -> first 1-min slot
                                var d = gseed[gk] || (gseed[gk] = { n: 0, w: 0 });
                                d.n += (c.n || 0); d.w += (c.h || 0) + (c.m || 0) + (c.l || 0);
                            });
                        });
                        rec._gseed = 1; changed = true;
                    }
                    var minGBin2 = Math.floor((now - BIN_KEEP_MS) / GBIN_MS);
                    Object.keys(rec.gbins).forEach(function (w) {
                        var wb = rec.gbins[w], any = false;
                        Object.keys(wb).forEach(function (bk2) { if (+bk2 < minGBin2) { delete wb[bk2]; changed = true; } else any = true; });
                        if (!any) { delete rec.gbins[w]; changed = true; }
                    });
                });
                // v2.19: prune dead raffle-era fields once the lifetime counter is seeded (frees ~35% of the blob)
                if (acc.ltSeeded && ((acc.anchors && acc.anchors.length) || acc.base || acc.lastPeriodWager || acc.periodStart != null)) {
                    acc.anchors = []; acc.base = 0; acc.periodStart = null; acc.lastPeriodWager = 0; changed = true;
                }
            });
            if (!changed) return;
            try { localStorage.setItem(STORE_KEY, JSON.stringify(stored)); } catch (e) {}
            S = mergeState(stored, S);
            note('cleanup: migrated bets->bins, trimmed log, freed localStorage');
        } catch (e) {}
    }

    function start() {
        if (!document.body) { setTimeout(start, 80); return; }
        cleanupOversizedStore();      // self-heal a bloated bet log so it can't keep the origin's localStorage maxed out
        S.diag = []; save();          // fresh diagnostics each load
        buildHud();
        fetchSelf();                           // resolve account id -> username for the HUD label
        setInterval(fetchSelf, 2 * 60 * 1000);
        syncGameEdges();                       // authoritative per-game house edge from the API (RTP buckets)
        setInterval(syncGameEdges, 3 * 60 * 1000);
        captureGameEdge();
        setInterval(captureGameEdge, 2500);   // legacy DOM Edge tag (fallback only; usually absent now)
        if (!IS_SOCIAL) { fetchRates(); setInterval(fetchRates, 4 * 60 * 1000); }  // crypto USD rates (live sample)
        fetchLifetime();                       // authoritative wager total (lifetime counter snapshot)
        setInterval(fetchLifetime, 30 * 1000); // refresh ~every 30s (reconciles the live overlay sooner)
        fetchRaffle();                         // Tickets display only
        setInterval(fetchRaffle, 60 * 1000);
        fetchBuckets();                        // server-sourced RTP split (consistent across devices)
        setInterval(fetchBuckets, BUCKET_MS);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) { fetchLifetime(); fetchRaffle(); fetchBuckets(); } });
        setInterval(render, 1000);             // keep the rolling window + fall-off current
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}

    function isOnAnyCasinoPage() {
        // AutoVault doesn't need a specific game page — works site-wide
        return isShuffle() || isNuts() || /stake\./.test(location.hostname);
    }

    function tool_autovault() {
        if (document.getElementById('autovault-floaty')) return; // idempotent

        const PLATFORM = isShuffle() ? 'shuffle' : isNuts() ? 'nuts' : 'stake';
        const TITLE = isShuffle() ? 'Shuffle Auto-Vault' : isNuts() ? 'Nuts Auto-Vault' : 'Stake Auto-Vault';
        const CONFIG_KEY = `autovault-config-${PLATFORM}`;
        const SESSION_VAULTED_KEY = `autovault-vaulted-session:${PLATFORM}`;
        const RATELIMIT_KEY = `autovault-ratelimit-${PLATFORM}`;
        const RATE_LIMIT_MAX = 50;
        const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

        const DEFAULTS = {
            isRunning: false,
            saveAmount: 0.2,        // fraction of profit to vault
            bigWinThreshold: 1.5,   // newBal > oldBal * (1 + this/100)? actually multiplier
            bigWinMultiplier: 2,    // when big-win, multiply the save fraction by this
            checkInterval: 30000
        };

        let cfg = Object.assign({}, DEFAULTS);
        try {
            const raw = localStorage.getItem(CONFIG_KEY);
            if (raw) Object.assign(cfg, JSON.parse(raw));
        } catch (e) {}
        function saveCfg() {
            try { localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg)); } catch (e) {}
        }

        /* ---- Rate limit (50 deposits / hour) ---- */
        function loadRateLimit() {
            try {
                const saved = sessionStorage.getItem(RATELIMIT_KEY);
                if (!saved) return [];
                const data = JSON.parse(saved);
                return data.filter(ts => Date.now() - ts < RATE_LIMIT_WINDOW);
            } catch (e) { return []; }
        }
        function saveRateLimit(timestamps) {
            try { sessionStorage.setItem(RATELIMIT_KEY, JSON.stringify(timestamps)); } catch (e) {}
        }
        let vaultTimestamps = loadRateLimit();
        function canVaultNow() {
            const now = Date.now();
            vaultTimestamps = vaultTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
            saveRateLimit(vaultTimestamps);
            return vaultTimestamps.length < RATE_LIMIT_MAX;
        }
        function recordVault() {
            vaultTimestamps.push(Date.now());
            saveRateLimit(vaultTimestamps);
        }
        function getVaultCountLastHour() {
            const now = Date.now();
            vaultTimestamps = vaultTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
            return vaultTimestamps.length;
        }

        /* ---- Activity log ---- */
        const activityLog = [];
        const MAX_LOG = 50;
        let onLogUpdate = null;
        function logActivity(message, type = 'info') {
            const entry = { time: new Date(), message, type };
            activityLog.unshift(entry);
            if (activityLog.length > MAX_LOG) activityLog.pop();
            console.log('[AutoVault]', message);
            if (onLogUpdate) onLogUpdate(entry);
        }

        /* ---- Session-vaulted tracking ---- */
        function getSessionVaulted() {
            try { const v = parseFloat(sessionStorage.getItem(SESSION_VAULTED_KEY)); return isNaN(v) ? 0 : v; } catch { return 0; }
        }
        function addSessionVaulted(amount) {
            const v = getSessionVaulted() + amount;
            try { sessionStorage.setItem(SESSION_VAULTED_KEY, String(v)); } catch {}
            return v;
        }
        function resetSessionVaulted() {
            try { sessionStorage.setItem(SESSION_VAULTED_KEY, '0'); } catch {}
        }

        /* ---- Balance read (reuses HUD's per-platform helper) ---- */
        function readBalance() {
            try { return getCurrentBalance(); } catch (e) { return 0; }
        }
        function formatVaultAmount(amount) {
            if (PLATFORM === 'nuts') {
                const formatted = formatCurrency(amount);
                return isUSDDisplayMode() ? formatted : `${formatted} SOL`;
            }
            return amount.toFixed(PLATFORM === 'shuffle' ? 2 : 4);
        }

        /* ---- Per-platform deposit ---- */
        // Stake: GraphQL CreateVaultDeposit via fetch + x-access-token cookie.
        function getCookie(name) {
            const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
            return m ? m.pop().replace(/"/g, '') : '';
        }
        function detectStakeCurrency() {
            const el = document.querySelector('[data-active-currency]');
            if (el) {
                const c = el.getAttribute('data-active-currency');
                if (c) return c.toLowerCase();
            }
            const toggle = document.querySelector('[data-testid="coin-toggle"]') || document.querySelector('[data-testid="balance-toggle"]');
            if (toggle) {
                const txt = (toggle.textContent || '').trim();
                const m = txt.match(/\b[A-Z]{2,5}\b/);
                if (m) return m[0].toLowerCase();
            }
            return /stake\.(us|games)/.test(location.hostname) ? 'sc' : 'btc';
        }
        async function stakeDeposit(amount) {
            const currency = detectStakeCurrency();
            const token = getCookie('session');
            if (!token) return { ok: false, reason: 'no-session-cookie' };
            const body = {
                query: `mutation CreateVaultDeposit($currency: CurrencyEnum!, $amount: Float!) {\n  createVaultDeposit(currency: $currency, amount: $amount) {\n    id amount currency\n  }\n}`,
                variables: { currency, amount }
            };
            try {
                const res = await fetch(window.location.origin + '/_api/graphql', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'content-type': 'application/json',
                        'x-access-token': token,
                        'x-language': 'en',
                        'x-operation-name': 'CreateVaultDeposit'
                    },
                    body: JSON.stringify(body),
                    mode: 'cors',
                    cache: 'no-cache'
                });
                if (!res.ok) return { ok: false, reason: `http-${res.status}` };
                const data = await res.json();
                if (data && data.data && data.data.createVaultDeposit) {
                    return { ok: true, currency, amount };
                }
                const errMsg = data && data.errors && data.errors[0] && data.errors[0].message;
                return { ok: false, reason: errMsg || 'no-deposit-in-response' };
            } catch (e) {
                return { ok: false, reason: 'fetch-error: ' + e.message };
            }
        }

        // Shuffle: GraphQL VaultDeposit via fetch + Bearer token captured from page.
        function getShuffleAuth() { return window.__shuffleAvLatestAuth || null; }
        function detectShuffleCurrency() {
            // The active currency is the icon on the header balance button:
            //   <button> … <img alt="ETH"> … <span data-testid="balance">…</span>
            // (verified live on shuffle.com). The old aria-selected[data-testid]
            // selector matched the "Manual" bet-mode tab and always fell through
            // to 'GC', which isn't a valid currency on shuffle.com.
            const balEl = document.querySelector('[data-testid="balance"]');
            const btn = balEl && balEl.closest('button');
            if (btn) {
                const icon = Array.from(btn.querySelectorAll('img[alt]'))
                    .map(im => (im.getAttribute('alt') || '').trim())
                    .find(a => /^[A-Za-z]{2,6}$/.test(a) && !/^(arrow|wallet|chevron|menu|icon|token|search)$/i.test(a));
                if (icon) return icon.toUpperCase();
            }
            // Legacy fallback: shuffle.us sweeps tabs (balance-gc / balance-sc).
            const usTab = document.querySelector('button[aria-selected="true"][data-testid*="balance"]');
            if (usTab) { const m = (usTab.getAttribute('data-testid') || '').match(/balance-([a-z]+)/i); if (m) return m[1].toUpperCase(); }
            return 'GC';
        }
        async function shuffleDeposit(amount) {
            const auth = getShuffleAuth();
            if (!auth) return { ok: false, reason: 'awaiting-auth-capture' };
            const currency = detectShuffleCurrency();
            const amountStr = amount.toFixed(2);
            const query = `mutation VaultDeposit($data: VaultDepositInput!) {\n  vaultDeposit(data: $data) {\n    id amount currency\n  }\n}`;
            const body = {
                operationName: 'VaultDeposit',
                variables: { data: { currency, amount: amountStr } },
                extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' } },
                query
            };
            try {
                // Path is stable across shuffle.com / .us; only the origin differs.
                const endpoint = location.origin + '/main-api/graphql/api/graphql';
                const res = await fetch(endpoint, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'accept': 'application/graphql-response+json,application/json;q=0.9',
                        'content-type': 'application/json',
                        'authorization': auth,
                        'x-correlation-id': (crypto && crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2)))
                    },
                    body: JSON.stringify(body),
                    mode: 'cors',
                    cache: 'no-cache'
                });
                if (!res.ok) return { ok: false, reason: `http-${res.status}` };
                const data = await res.json();
                const dep = data && data.data && data.data.vaultDeposit;
                if (dep && dep.id) return { ok: true, currency, amount: parseFloat(dep.amount) || amount };
                const errMsg = data && data.errors && data.errors[0] && data.errors[0].message;
                return { ok: false, reason: errMsg || 'no-deposit-in-response' };
            } catch (e) {
                return { ok: false, reason: 'fetch-error: ' + e.message };
            }
        }

        // Nuts: depositToVault mutation via the captured GraphQL WebSocket.
        // amount is in lamports (1 SOL = 1e9). The capture hook lives in the
        // transport interceptors block at script boot.
        function nutsUuid() {
            try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
            });
        }
        function nutsDeposit(amountSol) {
            return new Promise((resolve) => {
                const ws = window.__nutsAvSocket;
                if (!ws || ws.readyState !== 1 || !window.__nutsAvSocketAuthed) {
                    return resolve({ ok: false, reason: 'socket-not-ready' });
                }
                const id = nutsUuid();
                const amountUnits = Math.floor(amountSol * 1_000_000_000);
                const payload = {
                    id, type: 'subscribe',
                    payload: {
                        query: 'mutation depositToVault($amount: Float!) {\n  depositToVault(amount: $amount)\n}',
                        operationName: 'depositToVault',
                        variables: { amount: amountUnits }
                    }
                };
                const timeout = setTimeout(() => {
                    if (window.__nutsAvPendingMutations && window.__nutsAvPendingMutations.has(id)) {
                        window.__nutsAvPendingMutations.delete(id);
                    }
                    resolve({ ok: false, reason: 'timeout' });
                }, 15000);
                window.__nutsAvPendingMutations.set(id, {
                    resolve: (msg) => {
                        clearTimeout(timeout);
                        const errs = msg && msg.payload && msg.payload.errors;
                        if (errs && errs.length) resolve({ ok: false, reason: errs[0].message });
                        else resolve({ ok: true, currency: 'SOL', amount: amountSol });
                    }
                });
                try { ws.send(JSON.stringify(payload)); }
                catch (e) { clearTimeout(timeout); resolve({ ok: false, reason: 'send-error: ' + e.message }); }
            });
        }

        async function dispatchDeposit(amount) {
            if (PLATFORM === 'stake') return stakeDeposit(amount);
            if (PLATFORM === 'shuffle') return shuffleDeposit(amount);
            if (PLATFORM === 'nuts') return nutsDeposit(amount);
            return { ok: false, reason: 'unknown-platform' };
        }

        /* ---- Monitor loop ---- */
        let baseline = null;        // balance we measure profit against
        let lastBalance = null;
        let isProcessing = false;
        let monitorTimer = null;
        let lastProfit = 0;

        async function processDeposit(amount, isBigWin) {
            if (amount <= 0 || isProcessing) return;
            if (!canVaultNow()) {
                logActivity('Rate limit reached — vaulting paused', 'warning');
                return;
            }
            isProcessing = true;
            const flavor = isBigWin ? 'Big win — vaulting' : 'Profit detected — vaulting';
            logActivity(`${flavor} ${formatVaultAmount(amount)}`, isBigWin ? 'bigwin' : 'profit');
            const result = await dispatchDeposit(amount);
            isProcessing = false;
            if (result && result.ok) {
                recordVault();
                addSessionVaulted(amount);
                baseline = readBalance(); // re-baseline post-deposit to avoid drift
                const suffix = PLATFORM === 'nuts' ? '' : (result.currency || '');
                logActivity(`Vaulted ${formatVaultAmount(amount)} ${suffix}`.trim(), 'success');
            } else {
                logActivity('Vault failed: ' + (result && result.reason || 'unknown'), 'error');
            }
            if (uiWidget) uiWidget.render();
        }

        async function tick() {
            if (!cfg.isRunning) return;
            const cur = readBalance();
            if (!cur || cur <= 0) return;
            if (baseline === null) { baseline = cur; lastBalance = cur; return; }
            if (cur > baseline) {
                const profit = cur - baseline;
                lastProfit = profit;
                // Big-win detection: post-bet balance is at least bigWinThreshold× the pre-bet balance.
                // bigWinThreshold is a multiplier (e.g. 1.5 means 50% gain or more on the round).
                const isBig = baseline > 0 && (cur / baseline) >= cfg.bigWinThreshold;
                const fraction = cfg.saveAmount * (isBig ? cfg.bigWinMultiplier : 1);
                const depAmount = Math.max(0, profit * fraction);
                if (depAmount > 0) {
                    await processDeposit(depAmount, isBig);
                }
            } else if (cur < baseline) {
                // Loss — re-baseline so the next profit measurement is against the
                // post-loss balance, not the pre-loss one.
                baseline = cur;
                lastProfit = 0;
            }
            lastBalance = cur;
            if (uiWidget) uiWidget.render();
        }

        function startMonitor() {
            if (cfg.isRunning) return;
            cfg.isRunning = true;
            saveCfg();
            baseline = readBalance();
            lastBalance = baseline;
            logActivity('AutoVault started — watching ' + PLATFORM.toUpperCase(), 'success');
            if (monitorTimer) clearInterval(monitorTimer);
            monitorTimer = setInterval(tick, cfg.checkInterval);
            if (uiWidget) uiWidget.render();
        }
        function stopMonitor() {
            cfg.isRunning = false;
            saveCfg();
            if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
            logActivity('AutoVault stopped', 'info');
            if (uiWidget) uiWidget.render();
        }
        function resetAll() {
            stopMonitor();
            resetSessionVaulted();
            baseline = null;
            lastBalance = null;
            lastProfit = 0;
            activityLog.length = 0;
            logActivity('Reset', 'info');
            if (uiWidget) uiWidget.render();
        }

        /* ---- UI ---- */
        addStyle(`
            #autovault-floaty {
                position: fixed;
                bottom: max(20px, env(safe-area-inset-bottom));
                left: max(12px, env(safe-area-inset-left));
                z-index: 2147483645;
                width: 280px; max-width: calc(100vw - 24px);
                background: linear-gradient(180deg, rgba(26, 44, 56, 0.97), rgba(15, 33, 46, 0.97));
                color: #f5fbff;
                border: 1px solid var(--av-border, rgba(82, 109, 130, 0.55));
                border-radius: 12px;
                box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 12px;
                -webkit-user-select: none; user-select: none;
                touch-action: none;
            }
            #autovault-floaty.shuffle-theme {
                --av-accent: #6c47ff;
                --av-border: rgba(108, 71, 255, 0.45);
                background: linear-gradient(180deg, rgba(26, 18, 56, 0.97), rgba(10, 8, 24, 0.97));
            }
            #autovault-floaty.nuts-theme {
                --av-accent: #19f3ff;
                --av-border: rgba(143, 99, 255, 0.45);
                background: linear-gradient(180deg, rgba(36, 42, 56, 0.95), rgba(14, 18, 28, 0.97));
            }
            #autovault-floaty:not(.shuffle-theme):not(.nuts-theme) { --av-accent: #00ff9d; }
            #autovault-floaty.mini { width: auto; min-width: 0; }
            #autovault-floaty.mini .av-body { display: none; }
            #autovault-floaty .av-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px;
                background: rgba(255, 255, 255, 0.03);
                border-bottom: 1px solid rgba(255, 255, 255, 0.06);
                border-radius: 12px 12px 0 0;
                cursor: grab;
            }
            #autovault-floaty.mini .av-header { border-bottom: none; border-radius: 12px; }
            #autovault-floaty .av-header:active { cursor: grabbing; }
            #autovault-floaty .av-title-row {
                display: flex; align-items: center; gap: 8px;
            }
            #autovault-floaty .av-title {
                font-weight: 800; font-size: 12px;
                text-transform: uppercase; letter-spacing: 0.5px;
                color: var(--av-accent);
            }
            #autovault-floaty .av-status-pill {
                font-size: 9px; padding: 2px 8px; border-radius: 10px;
                background: rgba(148, 163, 184, 0.2); color: #94a3b8;
                font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px;
            }
            #autovault-floaty .av-status-pill.on {
                background: color-mix(in srgb, var(--av-accent) 25%, transparent);
                color: var(--av-accent);
            }
            #autovault-floaty .av-head-btns { display: flex; gap: 4px; }
            #autovault-floaty .av-mini-btn {
                background: none; border: none; color: #94a3b8;
                cursor: pointer; padding: 4px 10px; font-size: 16px;
                line-height: 1; border-radius: 6px; min-height: 32px;
                -webkit-tap-highlight-color: transparent; touch-action: manipulation;
            }
            #autovault-floaty .av-mini-btn:active { color: #fff; background: rgba(255, 255, 255, 0.08); }
            #autovault-floaty .av-body {
                padding: 10px 12px 12px;
                display: flex; flex-direction: column; gap: 8px;
            }
            #autovault-floaty .av-stat-row {
                display: flex; justify-content: space-between; align-items: baseline;
                font-size: 11px;
            }
            #autovault-floaty .av-stat-row span:first-child {
                color: #94a3b8;
                font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px;
            }
            #autovault-floaty .av-stat-row span:last-child {
                color: #fff; font-weight: 800;
                font-family: "Roboto Mono", monospace;
            }
            #autovault-floaty .av-stat-row .pos { color: var(--av-accent); }
            #autovault-floaty .av-stat-row .neg { color: #f87171; }
            #autovault-floaty .av-section-title {
                font-size: 9px; color: var(--av-accent);
                text-transform: uppercase; letter-spacing: 0.5px;
                font-weight: 800; margin: 4px 0 2px;
            }
            #autovault-floaty .av-config {
                display: grid; grid-template-columns: 1fr 80px;
                gap: 6px 8px; align-items: center;
            }
            #autovault-floaty .av-config label {
                font-size: 10px; color: #94a3b8;
                text-transform: uppercase; letter-spacing: 0.3px; font-weight: 700;
            }
            #autovault-floaty .av-config input {
                width: 100%;
                background: #0b0e17; color: #fff;
                border: 1px solid #2f4553; border-radius: 6px;
                padding: 6px 8px; font-size: 12px; font-weight: 700;
                text-align: right; outline: none;
                font-family: "Roboto Mono", monospace;
                min-height: 32px;
                -webkit-appearance: none; appearance: none;
            }
            #autovault-floaty .av-config input:focus { border-color: var(--av-accent); }
            #autovault-floaty .av-btn-row { display: flex; gap: 6px; }
            #autovault-floaty .av-btn {
                flex: 1;
                background: #1a2c38; color: #fff;
                border: 1px solid #2f4553;
                border-radius: 6px;
                padding: 8px 6px;
                font-size: 11px; font-weight: 900;
                cursor: pointer;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                min-height: 36px;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
                font-family: inherit;
            }
            #autovault-floaty .av-btn:active { background: #2f4553; }
            #autovault-floaty .av-btn.primary {
                background: var(--av-accent); color: #0f212e; border: none;
            }
            #autovault-floaty.shuffle-theme .av-btn.primary,
            #autovault-floaty.nuts-theme .av-btn.primary { color: #fff; }
            #autovault-floaty .av-btn.danger { background: transparent; color: #e11d48; border-color: #e11d48; }
            #autovault-floaty .av-log {
                max-height: 110px; overflow-y: auto;
                background: rgba(0, 0, 0, 0.25);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-radius: 6px;
                padding: 6px 8px;
                font-family: "Roboto Mono", monospace;
                font-size: 10px; line-height: 1.4;
                -webkit-overflow-scrolling: touch;
            }
            #autovault-floaty .av-log::-webkit-scrollbar { width: 3px; }
            #autovault-floaty .av-log::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2); border-radius: 2px; }
            #autovault-floaty .av-log-row { color: #94a3b8; display: flex; gap: 6px; padding: 1px 0; }
            #autovault-floaty .av-log-row .av-log-time { color: var(--av-accent); flex-shrink: 0; opacity: 0.7; }
            #autovault-floaty .av-log-row.success { color: var(--av-accent); }
            #autovault-floaty .av-log-row.bigwin { color: #fbbf24; }
            #autovault-floaty .av-log-row.warning { color: #f59e0b; }
            #autovault-floaty .av-log-row.error { color: #f87171; }
            #autovault-floaty .av-log-empty {
                color: #6b7280; font-style: italic;
                text-align: center; padding: 4px;
            }
        `);

        const gui = document.createElement('div');
        gui.id = 'autovault-floaty';
        if (isShuffle()) gui.classList.add('shuffle-theme');
        if (isNuts()) gui.classList.add('nuts-theme');
        gui.innerHTML = `
            <div class="av-header">
                <div class="av-title-row">
                    <span class="av-title">${TITLE}</span>
                    <span class="av-status-pill" id="av-status">OFF</span>
                </div>
                <div class="av-head-btns">
                    <button class="av-mini-btn" id="av-mini" title="Collapse">−</button>
                    <button class="av-mini-btn" id="av-close" title="Close">×</button>
                </div>
            </div>
            <div class="av-body">
                <div class="av-stat-row"><span>Balance</span><span id="av-bal">—</span></div>
                <div class="av-stat-row"><span>Vaulted (session)</span><span id="av-vaulted" class="pos">0.00</span></div>
                <div class="av-stat-row"><span>Last profit</span><span id="av-profit">—</span></div>
                <div class="av-stat-row"><span>Deposits this hour</span><span id="av-rate">0 / 50</span></div>
                <div class="av-section-title">Settings</div>
                <div class="av-config">
                    <label>Save % of profit</label>
                    <input type="number" id="av-save" min="0.01" max="1" step="0.05">
                    <label>Big-win threshold (×)</label>
                    <input type="number" id="av-bwt" min="1" step="0.1">
                    <label>Big-win multiplier</label>
                    <input type="number" id="av-bwm" min="1" step="0.5">
                    <label>Check interval (sec)</label>
                    <input type="number" id="av-int" min="5" step="5">
                </div>
                <div class="av-btn-row">
                    <button class="av-btn primary" id="av-toggle">Start</button>
                    <button class="av-btn danger" id="av-reset">Reset</button>
                </div>
                <div class="av-section-title">Activity</div>
                <div class="av-log" id="av-log"></div>
            </div>
        `;
        document.body.appendChild(gui);

        const header = gui.querySelector('.av-header');
        const statusPill = gui.querySelector('#av-status');
        const balEl = gui.querySelector('#av-bal');
        const vaultedEl = gui.querySelector('#av-vaulted');
        const profitEl = gui.querySelector('#av-profit');
        const rateEl = gui.querySelector('#av-rate');
        const saveInp = gui.querySelector('#av-save');
        const bwtInp = gui.querySelector('#av-bwt');
        const bwmInp = gui.querySelector('#av-bwm');
        const intInp = gui.querySelector('#av-int');
        const toggleBtn = gui.querySelector('#av-toggle');
        const resetBtn = gui.querySelector('#av-reset');
        const logEl = gui.querySelector('#av-log');
        const miniBtn = gui.querySelector('#av-mini');
        const closeBtn = gui.querySelector('#av-close');

        saveInp.value = cfg.saveAmount;
        bwtInp.value = cfg.bigWinThreshold;
        bwmInp.value = cfg.bigWinMultiplier;
        intInp.value = Math.round(cfg.checkInterval / 1000);

        const uiWidget = {
            render() {
                const bal = readBalance();
                balEl.textContent = bal ? formatVaultAmount(bal) : '—';
                vaultedEl.textContent = formatVaultAmount(getSessionVaulted());
                if (lastProfit > 0) {
                    profitEl.textContent = '+' + formatVaultAmount(lastProfit);
                    profitEl.className = 'pos';
                } else {
                    profitEl.textContent = '—';
                    profitEl.className = '';
                }
                rateEl.textContent = `${getVaultCountLastHour()} / ${RATE_LIMIT_MAX}`;
                if (cfg.isRunning) {
                    statusPill.textContent = 'ON';
                    statusPill.classList.add('on');
                    toggleBtn.textContent = 'Stop';
                } else {
                    statusPill.textContent = 'OFF';
                    statusPill.classList.remove('on');
                    toggleBtn.textContent = 'Start';
                }
            }
        };

        function renderLog() {
            if (!activityLog.length) {
                logEl.innerHTML = '<div class="av-log-empty">No activity yet</div>';
                return;
            }
            logEl.innerHTML = activityLog.slice(0, 25).map(e => {
                const hh = String(e.time.getHours()).padStart(2, '0');
                const mm = String(e.time.getMinutes()).padStart(2, '0');
                const ss = String(e.time.getSeconds()).padStart(2, '0');
                return `<div class="av-log-row ${e.type}"><span class="av-log-time">${hh}:${mm}:${ss}</span><span>${e.message}</span></div>`;
            }).join('');
        }
        onLogUpdate = renderLog;
        renderLog();

        /* ---- UI events ---- */
        saveInp.addEventListener('input', () => { cfg.saveAmount = parseFloat(saveInp.value) || DEFAULTS.saveAmount; saveCfg(); });
        bwtInp.addEventListener('input', () => { cfg.bigWinThreshold = parseFloat(bwtInp.value) || DEFAULTS.bigWinThreshold; saveCfg(); });
        bwmInp.addEventListener('input', () => { cfg.bigWinMultiplier = parseFloat(bwmInp.value) || DEFAULTS.bigWinMultiplier; saveCfg(); });
        intInp.addEventListener('input', () => {
            const v = parseInt(intInp.value, 10);
            if (v >= 5) {
                cfg.checkInterval = v * 1000;
                saveCfg();
                if (cfg.isRunning) {
                    if (monitorTimer) clearInterval(monitorTimer);
                    monitorTimer = setInterval(tick, cfg.checkInterval);
                }
            }
        });
        toggleBtn.addEventListener('click', () => {
            if (cfg.isRunning) stopMonitor();
            else startMonitor();
        });
        resetBtn.addEventListener('click', () => {
            if (confirm('Reset session-vaulted total + activity log?')) resetAll();
        });
        miniBtn.addEventListener('click', () => {
            gui.classList.toggle('mini');
            miniBtn.textContent = gui.classList.contains('mini') ? '+' : '−';
        });
        closeBtn.addEventListener('click', () => {
            stopMonitor();
            gui.remove();
        });

        /* ---- Pointer Events drag ---- */
        let dragging = false, dx = 0, dy = 0, pointerId = null;
        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.av-mini-btn')) return;
            dragging = true;
            pointerId = e.pointerId;
            const rect = gui.getBoundingClientRect();
            dx = e.clientX - rect.left;
            dy = e.clientY - rect.top;
            try { header.setPointerCapture(e.pointerId); } catch (err) {}
            e.preventDefault();
        });
        header.addEventListener('pointermove', (e) => {
            if (!dragging || e.pointerId !== pointerId) return;
            let nl = e.clientX - dx;
            let nt = e.clientY - dy;
            nl = Math.max(0, Math.min(window.innerWidth - gui.offsetWidth, nl));
            nt = Math.max(0, Math.min(window.innerHeight - gui.offsetHeight, nt));
            gui.style.left = nl + 'px';
            gui.style.top = nt + 'px';
            gui.style.right = 'auto';
            gui.style.bottom = 'auto';
        });
        function endDrag(e) {
            if (!dragging) return;
            dragging = false;
            try { header.releasePointerCapture(pointerId); } catch (err) {}
            pointerId = null;
        }
        header.addEventListener('pointerup', endDrag);
        header.addEventListener('pointercancel', endDrag);

        /* ---- Auto-resume if previously running ---- */
        // Refresh UI every 2s even when not running, so balance display updates.
        setInterval(() => uiWidget.render(), 2000);
        uiWidget.render();
        if (cfg.isRunning) {
            // User had it running before page reload; resume.
            cfg.isRunning = false; // toggle back off so startMonitor() re-arms cleanly
            startMonitor();
        }
    }

    /* ============================================================
       ============================================================
       MAIN BOOT — wires IOW/Smart HUD ticker, Dice Tool init,
       integration ticker, and SPA navigation watcher.
       ============================================================
       ============================================================ */
    function boot() {
        // Per-bet observer for Stake; transport interceptors already run
        // top-of-script for Shuffle (fetch/XHR/WebSocket patched at boot).
        if (isShuffle()) {
            // Mutation observers attach when their target elements appear —
            // we re-call them every tick below to handle late mounts.
            startShuffleObserver();
            startShuffleFeedObserver();
        } else {
            startObserver();
        }

        // Dice Tool + Advanced IOW integration only on Stake / Shuffle.
        // Nuts has no native Advanced bet-mode tab and no strategy editor,
        // so Advanced IOW can't function there — skip both bodies to keep
        // the Manual / IOW / Smart mode row clean (3 pills, not 4).
        if (!isNuts()) {
            try { dt_init(); } catch (e) { console.error('[unified-mobile] dt_init failed:', e); }
            try { setupIowDiceIntegration(); } catch (e) { console.error('[unified-mobile] integration failed:', e); }
        }

        // Inject the tool-visibility CSS ASAP, then build the control panel
        // and quick-toggle chips after the page settles (1.5s — matches
        // desktop). All three are unconditional so the user always has access
        // to enable/disable any tool. The IOW/Smart HUD has `hijacksPage`,
        // so it re-checks its toggle on every ticker iteration via buildHUD.
        try { applyAllVisibility(); } catch (e) {}
        setTimeout(() => {
            try { buildPanel(); } catch (e) { console.error('[unified-mobile] buildPanel failed:', e); }
            try { applyQuickToggles(); } catch (e) {}
            try { applyAllVisibility(); } catch (e) {}
        }, 1500);

        /* ---- Per-page tool dispatch ---- */
        // Each tool waits for its game container to mount (React/Svelte SPA
        // can take a second or two on mobile), then injects its widget.
        // Re-checked every 600ms inside the main ticker below so SPA nav
        // (e.g., dice → keno) picks up the new tool without a reload.
        function maybeBootPerPageTools() {
            if (isOnKenoPage() && isToolIdEnabled(toolIdForCurrentSite('keno'))) {
                try { tool_keno(); markToolRan(toolIdForCurrentSite('keno')); } catch (e) { console.error('[unified-mobile] tool_keno failed:', e); }
            } else {
                const k = document.getElementById('keno-preset-gui');
                if (k) k.remove();
            }
            if (isOnMinesPage() && isToolIdEnabled(toolIdForCurrentSite('mines'))) {
                try { tool_mines(); markToolRan(toolIdForCurrentSite('mines')); } catch (e) { console.error('[unified-mobile] tool_mines failed:', e); }
            } else {
                const m = document.getElementById('mines-auto-gui');
                if (m) m.remove();
            }
            // Auto-Vault works site-wide (not URL-gated), but we only inject
            // its widget after a short delay so it doesn't clash with the
            // initial game container mount.
            if (isOnAnyCasinoPage() && isToolIdEnabled(toolIdForCurrentSite('autovault'))) {
                try { tool_autovault(); markToolRan(toolIdForCurrentSite('autovault')); } catch (e) { console.error('[unified-mobile] tool_autovault failed:', e); }
            } else if (!isToolIdEnabled(toolIdForCurrentSite('autovault'))) {
                const av = document.getElementById('autovault-floaty');
                if (av) av.remove();
            }
            // 7-day wager tracker — account-wide on Stake; boots once (self-guards re-boot), CSS-hidden when off.
            const _trk = TOOLS.find(t => t.id === 'stake-7day-tracker');
            if (_trk && urlMatches(_trk, location.href) && isToolIdEnabled('stake-7day-tracker')) {
                try { tool_stake_7day_tracker(); markToolRan('stake-7day-tracker'); }
                catch (e) { console.error('[unified-mobile] tool_stake_7day_tracker failed:', e); }
            }
        }
        setTimeout(maybeBootPerPageTools, 1200);
        // SPA nav watcher — re-dispatch tools, refresh visibility, refresh
        // quick-toggle chips, and refresh control-panel statuses on URL change.
        let _lastToolsUrl = location.href;
        setInterval(() => {
            if (location.href !== _lastToolsUrl) {
                _lastToolsUrl = location.href;
                setTimeout(() => {
                    maybeBootPerPageTools();
                    try { applyAllVisibility(); } catch (e) {}
                    try { applyQuickToggles(); } catch (e) {}
                    try { refreshStatuses(); } catch (e) {}
                    try { updateToggleBadge(); } catch (e) {}
                }, 600);
            }
        }, 700);

        // Main HUD ticker — 600ms cadence (mobile-friendly battery).
        // Rebuilds HUD on SPA nav, re-attaches Stake/Shuffle observers,
        // syncs native bet panel + game footer slots, paints stats + graph,
        // monitors rapid-fire health, runs Smart bet sizing.
        setInterval(() => {
            if (!isOnSupportedGamePage()) {
                const existing = document.getElementById('ratchet-master-container');
                if (existing) existing.remove();
                try { if (typeof isRapidFiring !== 'undefined' && isRapidFiring) stopRapidFire(); } catch (e) {}
                return;
            }
            buildHUD();
            syncNativeHudElements();
            const bal = getCurrentBalance();
            if (bal > minBaseBet) {
                if (initialBalance === 0) initialBalance = bal;
                sessionPeak = Math.max(sessionPeak, bal);
                lastKnownBalance = bal;
            }
            // Autostop on Balance — read every tick across all modes.
            {
                const autostopEl = document.getElementById('h-autostop');
                if (autostopEl) {
                    const v = parseCurrencyInput(autostopEl.value, NaN);
                    autoStopBalance = !isNaN(v) && v > 0 ? v : null;
                }
            }
            if (isRapidFiring && autoStopBalance && getCurrentBalance() >= autoStopBalance) {
                stopRapidFire();
            }
            if (ACTIVE_MODE === 'iow') {
                const baseInp = document.getElementById('h-base'); if (baseInp) baseBet = parseCurrencyInput(baseInp.value, minBaseBet);
                const winIncEl = document.getElementById('h-win-inc'); if (winIncEl) winIncreasePercent = parseFloat(winIncEl.value) || 125;
                const lossResetEl = document.getElementById('h-loss-reset'); if (lossResetEl) lossStreakReset = parseInt(lossResetEl.value, 10) || 3;
                const winsResetEl = document.getElementById('h-wins-reset'); if (winsResetEl) winsBeforeReset = parseInt(winsResetEl.value, 10) || null;
            }
            if (ACTIVE_MODE === 'manual') {
                const manualInp = document.getElementById('h-manual-bet');
                if (manualInp) {
                    const v = parseCurrencyInput(manualInp.value, NaN);
                    if (isFinite(v) && v >= minBaseBet) manualBet = v;
                }
            }
            updateUI();
            startObserverWrapper();
            monitorRapidFireHealth();
            if (ACTIVE_MODE === 'smart') updateBetAmount();
        }, 600);

        // Initial HUD build attempt after a short delay so React/Svelte
        // has time to mount the game container.
        setTimeout(() => {
            buildHUD();
            if (isShuffle()) {
                startShuffleObserver();
                startShuffleFeedObserver();
            } else {
                startObserver();
            }
        }, 800);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
        boot();
    }

})();
