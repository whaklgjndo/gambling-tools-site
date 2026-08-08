// ==UserScript==
// @name         Stake Moles — Mobile
// @namespace    http://tampermonkey.net/
// @version      6.11
// @description  Standalone single-tool mobile build, extracted from the unified mobile bundle.
// @author       Zerocu
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
// @grant        none
// @run-at       document-start
// @noframes
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Mobile/Stake/Moles.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Mobile/Stake/Moles.user.js
// ==/UserScript==

(function () {
    'use strict';

    try { console.log('[Stake Moles — Mobile] standalone build v6.11'); } catch (e) {}


    try { console.log('[unified-mobile] boot v5.64 — DiceTool.exe replica UI for the dice tool (Calculator / Easy Mode / Strategy Finder / Results / Settings)'); } catch (e) {}

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
    // Where the user dragged the floating cluster (gear + quick-toggle chips).
    // Declared up here with the other keys, not down beside the drag code, so
    // nothing can read it before it exists.
    const FLOAT_POS_KEY   = '__stake_nuts_unified_float_pos_v1__';

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

    // ---- Moles (Stake Original; no Shuffle/Nuts equivalent) ----
    register({
        id: 'stake-moles', name: 'Stake Moles', group: 'Stake',
        description: 'Autoplays Moles via DOM clicks or direct API calls, with a live board overlay.',
        matches: ['https://stake.com/casino/games/moles*', 'https://stake.us/casino/games/moles*',
                  'https://stake.bet/casino/games/moles*', 'https://stake.games/casino/games/moles*',
                  'https://staketr.com/casino/games/moles*', 'https://staketr2.com/casino/games/moles*',
                  'https://staketr3.com/casino/games/moles*', 'https://staketr4.com/casino/games/moles*',
                  'https://stake.bz/casino/games/moles*', 'https://stake.pet/casino/games/moles*', 'https://stake.jp/casino/games/moles*'],
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
        return false; // standalone build: no dice/limbo HUD in this tool
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
    /* Which unit the balance is DISPLAYED in.
       Decided from the visible text, and never from a title attribute: nuts.gg
       puts the USD equivalent inside the SOL span's own title
       (title="0.00000408 SOL ($0.00)") while the text reads "0.00000000 SOL",
       so the old `span[title*="$"]` test matched in BOTH modes and could never
       return false. That silently forced USD mode on a SOL site, which set every
       money input's step to 0.01 and ran amounts through the SOL→USD conversion
       — so an 8dp base bet displayed and stepped as 0.00. Verified against the
       live DOM 2026-07-25.
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
    /* How many decimals THIS site accepts on a bet, read from the bet field's
       own `step` rather than assumed from the hostname.

       The Stake path was a flat 2dp because it was written for stake.us, where
       SC really is 2dp. On stake.com the same field is SOL at 8dp, so every bet
       was rounded up to 0.01 SOL (~74c) or down to 0.00. Reported 2026-08-03:
       "your bet field only goes to 0.00", "it tries to bet .01 solana".

       Reading the site's own step covers any coin Stake adds later, and it is
       right in fiat display mode too — the field still takes the COIN amount
       whatever the header happens to be showing. */
    function betDp() {
        try {
            const inp = document.querySelector('input[data-testid="input-game-amount"]') ||
                        document.querySelector('input[data-testid="bet-amount"]');
            const step = inp && inp.getAttribute('step');
            /* MEASURED ON stake.com, 2026-08-07: the field reports

                   step="1e-8"

               and NOT "0.00000001", which is what this function was written to
               expect. The first cut matched the step as a STRING against
               /^0\.(0*)1$/, so exponent notation missed every branch and fell
               through to the 2dp fallback — meaning the fix for "it tries to bet
               .01 solana" did not actually change anything on .com. Verified by
               running this function's own shipped source against the real value.

               Parse the number and ask how many places it needs instead, which
               is notation-agnostic and also right for a step like 0.05. */
            const n = (step === null || step === '') ? NaN : parseFloat(step);
            if (isFinite(n) && n > 0) {
                for (let d = 0; d <= 12; d++) {
                    const scaled = n * Math.pow(10, d);
                    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
                }
                return 12;
            }
        } catch (e) {}
        return isNuts() ? 8 : 2;
    }
    /** A step attribute string for `dp` places — never "1e-8", which is invalid. */
    function stepStrFor(dp) { return dp <= 0 ? '1' : '0.' + '0'.repeat(dp - 1) + '1'; }
    function formatCurrencyInput(amount) {
        if (!isFinite(amount)) return '';
        // Nuts keeps its own path: it also converts SOL <-> the fiat display.
        return isNuts() ? formatBetForInput(amount) : amount.toFixed(betDp());
    }
    function currencyInputStep() {
        if (isNuts()) return isUSDDisplayMode() ? '0.01' : '0.00000001';
        return stepStrFor(betDp());
    }
    /** The smallest bet this site allows, i.e. one unit in its last place. */
    function siteMinBet() { return Math.pow(10, -betDp()); }
    function typeIntoInput(inp, value) {
        /* Focus is unavoidable: execCommand('insertText') only produces the real
           input events a React-controlled field needs if the field is focused.
           But focusing the NATIVE wager input makes the browser scroll it into
           view, and on a phone that native column sits below the HUD overlay — so
           every setBet() threw the page to the bottom of the screen. setBet() runs
           on START and again after every single bet, so a run yanked the scroll
           continuously and the HUD was unusable.
           preventScroll covers the focus itself; the explicit restore covers
           select()/blur() and any engine that ignores the option. */
        const sx = window.scrollX, sy = window.scrollY;
        try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
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
        if (window.scrollX !== sx || window.scrollY !== sy) window.scrollTo(sx, sy);
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
                        /* Bet signal. Nuts does not render the rolling bet feed on
                           mobile at all, so the DOM observer has nothing to watch
                           and the conditions engine never advanced. This socket is
                           the authoritative stream. Guarded by typeof because
                           AutoVault-only builds do not include the HUD symbols. */
                        try { if (typeof onNutsSocketBalance === 'function') onNutsSocketBalance(Number(d.balance.after)); } catch (e) {}
                    }
                    /* THE authoritative per-bet signal. Captured from the live
                       logged-in socket 2026-07-26:
                         {"myGames":[{"__typename":"SinglePlayerGameBet",
                           "id":"1651571395","profit":-80,"isWin":false,"wager":80,
                           "multiplier":4,"details":{"targetMultiplier":4,
                           "result":1.02,"__typename":"TargetGameDetails"},...}]}
                       An exact id (so dedup is perfect) and an explicit isWin (so
                       the outcome is never inferred from the sign of a balance
                       delta). One balance frame follows each of these ~1ms later,
                       1:1, which also proves nuts.gg does NOT debit the stake and
                       credit the payout separately. */
                    if ('myGames' in d && Array.isArray(d.myGames)) {
                        for (const b of d.myGames) {
                            try { if (typeof onNutsGameBet === 'function') onNutsGameBet(b); } catch (e) {}
                        }
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
                /* none, not manipulation: the chip is a drag handle, and with
                   manipulation a touch drag scrolls the page instead of
                   delivering pointermove to us. (No backticks in here — this
                   block is inside a template literal.) */
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

    /* ---- Draggable floating cluster (gear + quick-toggle chips) -------------
       Both were pinned to the bottom-left corner with no way to move them, and
       on mobile that corner is where the dice tool's own controls sit — the
       chips landed on top of Build Strategy with nothing the user could do
       about it ("the dice floating icon at bottom i cant like hold and drag
       around / and it obfuscates the Build Strategy button").

       Hold and drag any member now and the WHOLE cluster moves together, so the
       chips keep their relation to the gear; the position is clamped to the
       viewport and remembered across loads. A tap is still a tap: a press only
       becomes a drag once the pointer has travelled DRAG_SLOP px, and the click
       the browser fires at the end of a drag is swallowed for a moment — without
       that, dragging the Dice chip out of the way would toggle the tool off.
       Until the cluster is dragged for the first time nothing is written inline,
       so the CSS defaults (including the safe-area insets) still apply. */
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
     *  cluster has actually been dragged, so the default CSS keeps its
     *  safe-area-aware corner placement. */
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
        // A rotate or a keyboard opening can leave a dragged cluster off screen.
        window.addEventListener('resize', applyFloatPos);
        window.addEventListener('orientationchange', applyFloatPos);
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
                btn.addEventListener('click', () => {
                    if (swallowedByDrag()) return;   // this "click" ended a drag
                    quickToggleClick(tool);
                });
                makeClusterDraggable(btn);
                document.body.appendChild(btn);
            }
            // Stack above the gear button (bottom: 16px, ~38px tall). applyFloatPos()
            // overrides both edges in px once the cluster has been dragged.
            btn.dataset.qtIndex = String(idx);
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
        // Re-seat the cluster: the chip count just changed, which changes both
        // the stack height the clamp works from and every chip's offset.
        applyFloatPos();
        bindClusterReflow();
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
        touch-action: none;      /* drag handle — see .uts-quick-toggle */
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


    function isOnMolesPage() {
        // Moles is a Stake Original; the other two platforms do not ship it.
        if (isShuffle() || isNuts()) return false;
        return /casino\/games\/moles(?:\/|$|\?|#)/i.test(location.pathname || '');
    }

    /* === source: moles.user.js — "Holy Moley" by Zerocu, v0.9.5 === */
    function tool_moles() {
    'use strict';

    // The dispatcher re-runs this on every SPA navigation back to /moles. The
    // body installs timers, a MutationObserver and a <style>, and it re-mounts
    // its own HUD, so it must only ever execute once per page.
    if (tool_moles._booted) return;
    tool_moles._booted = true;

    /* =========================================================
    STYLES — mirrors the TypicalPrag HUD visual language:
    dark teal gradient panels, neon-green accents, uppercase
    micro-labels, blurred backdrops, 12px radii.
    ========================================================= */
    addStyle(`
        #moles-master-container,
        #moles-master-container *,
        #moles-board-lock,
        #moles-board-lock * { box-sizing: border-box; }

        #moles-master-container {
            /* Cyber-blue palette per user spec.
               Primary  : #1A7CFF  (electric blue, main highlight)
               Midnight : #0A1A2F  (deep background)
               Steel    : #144A7A  (gradient transition / dark accent)
               Cyan     : #4CCBFF  (soft edge highlights)
               Gray     : #A8A8A8  (neutral text) */
            --hud-bg: rgba(10, 26, 47, 0.97);
            --hud-panel: linear-gradient(180deg, rgba(20, 74, 122, 0.32), rgba(10, 26, 47, 0.92));
            --hud-border: rgba(76, 203, 255, 0.30);
            --hud-border-soft: rgba(76, 203, 255, 0.10);
            --hud-green: #1A7CFF;        /* keep name for code compat; semantics = brand primary */
            --hud-green-dark: #144A7A;
            --hud-red: #e11d48;
            --hud-muted: #A8A8A8;
            --hud-text: #ffffff;
            --hud-input: #06101F;
            --hud-input-border: #144A7A;
            --hud-cyan: #4CCBFF;
            --hud-steel: #144A7A;
            --hud-midnight: #0A1A2F;

            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 300px !important;
            height: 700px !important;
            z-index: 2147483647;
            overflow-y: auto;
            background: var(--hud-bg);
            border: 1px solid var(--hud-border);
            border-radius: 20px;
            padding: 8px;
            box-shadow: 0 18px 50px rgba(0, 0, 0, 0.82);
            display: flex;
            flex-direction: column;
            gap: 5px;
            font-family: "Proxima Nova", "Segoe UI", sans-serif;
            font-size: 12px;
            color: var(--hud-text);
            backdrop-filter: blur(10px);
            line-height: 1.15;
            user-select: none;
        }
        #moles-master-container.collapsed { width: auto; padding: 8px 10px; }
        #moles-master-container.collapsed .hud-body { display: none; }

        #moles-master-container .hud-header {
            display: flex; justify-content: space-between; align-items: center;
            gap: 8px; padding: 0 2px; cursor: default;
        }
        #moles-master-container .hud-header h2 {
            margin: 0; font-size: 13px; font-weight: 900;
            letter-spacing: 0.8px; text-transform: uppercase;
        }
        #moles-master-container .hud-header .hud-target-text {
            color: #b1bad3; font-size: 11px; font-weight: 800;
            font-style: italic; letter-spacing: 0.2px;
        }
        #moles-master-container .hud-collapse {
            background: transparent; border: 1px solid var(--hud-border-soft);
            color: var(--hud-muted); width: 22px; height: 22px;
            border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 900;
            padding: 0; line-height: 1;
        }
        #moles-master-container .hud-collapse:hover { color: var(--hud-text); border-color: var(--hud-muted); }

        #moles-master-container .hud-body { display: flex; flex-direction: column; gap: 9px; }

        #moles-master-container .mode-wrap {
            display: flex; flex: 0 0 auto; flex-wrap: nowrap; gap: 4px;
            background: rgba(10, 26, 47, 0.8); padding: 4px; border-radius: 10px;
        }
        #moles-master-container .mode-btn {
            flex: 1 1 0; min-width: 0; padding: 5px 10px;
            border: none; border-radius: 999px; font-size: 11px; font-weight: 900;
            cursor: pointer; transition: transform .18s, filter .18s, background .18s, color .18s;
            text-transform: uppercase; letter-spacing: 0.4px;
            background: rgba(20, 74, 122, 0.6); color: var(--hud-muted);
        }
        #moles-master-container .mode-btn.active { background: var(--hud-green); color: #0A1A2F; box-shadow: 0 0 12px var(--hud-green); }
        #moles-master-container .mode-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }

        #moles-master-container .hud-panel {
            background: var(--hud-panel);
            border: 1px solid var(--hud-border-soft);
            border-radius: 14px;
            padding: 11px 11px;
            display: flex; flex-direction: column; gap: 8px;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }
        #moles-master-container .hud-panel.hud-panel-primary {
            border-color: rgba(76, 203, 255, 0.45);
            background: linear-gradient(180deg,
                rgba(26, 124, 255, 0.18),
                rgba(20, 74, 122, 0.32) 50%,
                rgba(10, 26, 47, 0.92)) !important;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06),
                        0 0 0 1px rgba(76, 203, 255, 0.15),
                        0 4px 12px rgba(0, 0, 0, 0.4);
        }
        #moles-master-container .hud-input-prominent {
            font-size: 14px !important;
            font-weight: 900 !important;
            padding: 6px 6px !important;
            text-align: center;
            background: rgba(6, 16, 31, 0.85) !important;
            border: 1px solid rgba(76, 203, 255, 0.4) !important;
            color: var(--hud-cyan, #4CCBFF) !important;
            text-shadow: 0 0 6px rgba(76, 203, 255, 0.4);
        }
        #moles-master-container .hud-input-prominent:focus {
            border-color: var(--hud-cyan, #4CCBFF) !important;
            box-shadow: 0 0 0 2px rgba(76, 203, 255, 0.25),
                        inset 0 0 12px rgba(76, 203, 255, 0.12);
        }
        #moles-master-container .hud-currency-hint {
            color: var(--hud-cyan, #4CCBFF);
            font-weight: 900;
            opacity: 0.8;
            text-transform: uppercase;
            font-size: 9px;
            letter-spacing: 1px;
        }
        #moles-master-container .hud-bet-quick {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 3px;
            margin-top: 1px;
        }
        #moles-master-container .bet-quick-btn {
            background: rgba(10, 26, 47, 0.7);
            color: var(--hud-cyan, #4CCBFF);
            border: 1px solid rgba(76, 203, 255, 0.30);
            border-radius: 5px;
            padding: 4px 0;
            font-family: "Courier New", monospace;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 1px;
            cursor: pointer;
            transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        #moles-master-container .bet-quick-btn:hover {
            background: rgba(26, 124, 255, 0.18);
            border-color: var(--hud-cyan, #4CCBFF);
            color: #fff;
        }
        #moles-master-container .bet-quick-btn:active { transform: scale(0.97); }

        #moles-master-container .hud-control-group {
            display: flex; flex-direction: column; gap: 2px; min-width: 0;
        }
        #moles-master-container .hud-control-group label {
            color: var(--hud-muted); font-size: 9px; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.02em;
            white-space: nowrap; display: flex; justify-content: space-between; gap: 4px;
        }
        #moles-master-container .hud-grid-2 {
            display: grid; grid-template-columns: 1fr 1fr; gap: 5px;
        }
        #moles-master-container input[type="number"],
        #moles-master-container select {
            background: var(--hud-input); border: 1px solid var(--hud-input-border);
            color: var(--hud-text); padding: 3px 5px; border-radius: 6px;
            font-size: 11px; font-weight: 700; text-align: center; outline: none;
            width: 100%;
        }
        #moles-master-container input[type="number"]:focus,
        #moles-master-container select:focus {
            border-color: var(--hud-green);
            box-shadow: 0 0 0 2px rgba(26, 124, 255, 0.12);
        }
        #moles-master-container select { text-align: left; appearance: auto; }
        #moles-master-container .hud-check-row {
            display: flex; align-items: center; justify-content: space-between; gap: 6px;
            padding: 2px 2px;
        }
        #moles-master-container .hud-check-row label {
            color: var(--hud-muted); font-size: 9px; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.3px;
        }
        #moles-master-container input[type="checkbox"] {
            accent-color: var(--hud-green); cursor: pointer; margin: 0;
            width: 14px; height: 14px;
        }
        #moles-master-container .hud-toggle {
            position: relative; display: inline-flex; align-items: center;
            cursor: pointer; flex-shrink: 0;
        }
        #moles-master-container .hud-toggle input[type="checkbox"] {
            position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none;
        }
        #moles-master-container .hud-toggle-track {
            width: 30px; height: 16px; border-radius: 999px;
            background: rgba(255,255,255,0.12);
            border: 1px solid var(--hud-border-soft);
            transition: background 150ms, border-color 150ms;
            display: flex; align-items: center; padding: 0 2px;
        }
        #moles-master-container .hud-toggle-thumb {
            width: 10px; height: 10px; border-radius: 50%;
            background: var(--hud-muted);
            transition: transform 150ms, background 150ms;
        }
        #moles-master-container .hud-toggle input:checked + .hud-toggle-track {
            background: rgba(26,124,255,0.35);
            border-color: var(--hud-green);
        }
        #moles-master-container .hud-toggle input:checked + .hud-toggle-track .hud-toggle-thumb {
            transform: translateX(14px);
            background: var(--hud-green);
        }
        #moles-master-container [data-tip] {
            position: relative;
        }
        #moles-master-container [data-tip]::after {
            content: attr(data-tip);
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            right: 0;
            margin: 0 auto;
            background: #0d1b2e;
            color: #c8d8f0;
            border: 1px solid rgba(76, 203, 255, 0.35);
            border-radius: 7px;
            padding: 6px 9px;
            font-size: 10px;
            font-weight: 600;
            line-height: 1.4;
            white-space: pre-wrap;
            width: 200px;
            text-align: left;
            text-transform: none;
            letter-spacing: 0;
            pointer-events: none;
            z-index: 9999;
            box-shadow: 0 4px 16px rgba(0,0,0,0.6);
            opacity: 0;
            transition: opacity 120ms ease;
        }
        #moles-master-container [data-tip]:hover::after {
            opacity: 1;
        }
        #moles-master-container .hud-api-status {
            font-family: "Courier New", monospace;
            font-size: 9px; font-weight: 700;
            padding: 3px 5px; border-radius: 5px;
            border: 1px solid var(--hud-border-soft);
            background: rgba(11, 14, 23, 0.55);
            color: var(--hud-muted);
            white-space: normal; line-height: 1.3;
            margin-top: 2px;
        }
        #moles-master-container .hud-api-status[data-state="ok"]   { color: var(--hud-green); border-color: rgba(26, 124, 255, 0.45); }
        #moles-master-container .hud-api-status[data-state="wait"] { color: #ffd84a;          border-color: rgba(255,216,74,0.45); }

        #moles-master-container .status-bar {
            background: var(--hud-panel); padding: 5px 8px; border-radius: 8px;
            text-align: center; font-size: 11px; font-weight: 900;
            letter-spacing: 0.2px; border: 1px solid var(--hud-border-soft);
            min-height: 28px; display: flex; align-items: center; justify-content: center;
            color: var(--hud-cyan);
        }
        #moles-master-container.is-running .status-bar { color: var(--hud-green); }

        #moles-master-container .btn-group {
            display: flex; gap: 6px; flex-wrap: nowrap; align-items: stretch;
        }
        #moles-master-container .hud-rapid-btn {
            border: none; color: #fff; font-size: 12px; font-weight: 900;
            padding: 7px 12px; border-radius: 8px; cursor: pointer;
            min-height: 32px; letter-spacing: 0.5px; text-transform: uppercase; flex: 1 1 0;
        }
        #moles-master-container .hud-rapid-btn.start { background: var(--hud-green); color: #0A1A2F; }
        #moles-master-container .hud-rapid-btn.start:hover { background: var(--hud-green-dark); }
        #moles-master-container .hud-rapid-btn.stop { background: var(--hud-red); color: #fff; }
        #moles-master-container .hud-rapid-btn.stop:hover { background: #be123c; }
        #moles-master-container .hud-reset-btn {
            background: transparent; border: 1px solid var(--hud-red); color: var(--hud-red);
            font-size: 11px; font-weight: 900; padding: 6px 10px; border-radius: 8px;
            cursor: pointer; flex: 0 0 auto; min-height: 32px;
            text-transform: uppercase; letter-spacing: 0.4px;
        }
        #moles-master-container .hud-reset-btn:hover { background: var(--hud-red); color: #fff; }

        /* Scoped to the moles page: this bundle is a document-start script that
           survives SPA navigation, so unscoped .game-sidebar/.game-content rules
           would keep squashing every other game's layout after you leave moles. */
        html[data-moles-active] [data-testid="game-moles"] {
            min-height: 380px !important;
            max-height: 650px !important;
            height: 650px !important;
        }
        html[data-moles-active] .game-content.svelte-xd3lbs {
            min-height: 380px !important;
            max-height: 650px !important;
            height: 650px !important;
        }
        html[data-moles-active] .game-sidebar {
            min-height: 380px !important;
            max-height: 650px !important;
            height: 650px !important;
        }
        #moles-board-lock {
            position: absolute !important;
            inset: 0 !important;
            z-index: 2147483645 !important;
            pointer-events: auto;
            border-radius: 20px;
            overflow: hidden;
            cursor: default;
            font-family: "Proxima Nova", "Segoe UI", sans-serif;
            display: grid !important;
            grid-template-rows: 44px 1fr;
            grid-template-columns: 1fr 280px;
            grid-template-areas:
                "topbar topbar"
                "stage  side";
            padding: 0 0 16px !important;
            background:
                repeating-linear-gradient(0deg,
                    rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px,
                    transparent 1px, transparent 4px),
                radial-gradient(circle 70px at 78% 52%,
                    #ffff00 0%, #ffe000 30%, #ffcc00 55%, transparent 72%),
                linear-gradient(180deg,
                    transparent 0%, transparent 62%,
                    #1a8c00 62%, #1a8c00 68%,
                    #22a800 68%, #22a800 74%,
                    #18a000 74%, #18a000 80%,
                    #20b800 80%, #20b800 86%,
                    #16a800 86%, #16a800 92%,
                    #1ec800 92%, #1ec800 100%),
                linear-gradient(180deg,
                    #6644cc 0%,
                    #7744cc 8%,
                    #cc44cc 22%,
                    #ff44cc 32%,
                    #ff66aa 40%,
                    #ff88aa 48%,
                    #ffaa66 54%,
                    #ffcc44 60%,
                    #44cc00 60%) !important;
            background-size: auto, auto, auto, auto;
            image-rendering: pixelated;
            box-shadow: inset 0 0 0 2px rgba(255, 200, 0, 0.4),
                        inset 0 0 60px rgba(255, 150, 0, 0.10);
            animation: none;
            transition: box-shadow 200ms ease;
        }
        #moles-board-lock.idle { animation: none; box-shadow: inset 0 0 0 1px rgba(168, 168, 168, 0.25); }

        #moles-board-lock .lock-topbar {
            grid-area: topbar;
            display: flex; align-items: center; justify-content: space-between;
            padding: 0 14px;
            background: rgba(6, 16, 31, 0.75);
            border-bottom: 1px solid rgba(76, 203, 255, 0.30);
            font-family: "Courier New", monospace;
            z-index: 5;
        }
        #moles-board-lock .lock-topbar .lock-badge {
            margin: 0; padding: 4px 10px; font-size: 10px;
            color: var(--hud-green, #1A7CFF);
            background: rgba(26, 124, 255, 0.10);
            border: 1px solid rgba(26, 124, 255, 0.30);
            border-radius: 4px;
            letter-spacing: 1px;
        }
        #moles-board-lock .lock-topstats {
            display: flex; gap: 16px; align-items: center;
            font-size: 11px;
        }
        #moles-board-lock .ts-cell { display: inline-flex; gap: 6px; align-items: baseline; }
        #moles-board-lock .ts-k {
            color: var(--hud-muted, #A8A8A8);
            font-size: 9px; text-transform: uppercase; letter-spacing: 1px;
        }
        #moles-board-lock .ts-v {
            color: #fff; font-weight: 900;
            text-shadow: 1px 1px 0 #000;
        }
        #moles-board-lock .ts-v[data-sign="pos"] { color: var(--hud-green, #1A7CFF); }
        #moles-board-lock .ts-v[data-sign="neg"] { color: var(--hud-red, #e11d48); }

        #moles-board-lock .lock-stage {
            grid-area: stage;
            position: relative;
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            gap: 12px;
            padding: 22px 16px;
            margin: 12px 0 0 12px;
            min-width: 0; min-height: 0;
            border-radius: 16px;
            background: rgba(0,0,0,0.18);
        }
        #moles-board-lock .lock-next-mult {
            font-family: "Press Start 2P", "Courier New", monospace;
            font-size: 18px; font-weight: 900;
            color: var(--hud-cyan, #4CCBFF);
            text-shadow: 2px 2px 0 #000,
                         0 0 12px rgba(76, 203, 255, 0.6);
            letter-spacing: 2px;
            padding: 6px 14px;
            background: rgba(10, 26, 47, 0.8);
            border: 2px solid rgba(76, 203, 255, 0.45);
            border-radius: 6px;
            image-rendering: pixelated;
        }
        #moles-board-lock .lock-next-mult.win  { color: var(--hud-green, #1A7CFF); border-color: var(--hud-green); }
        #moles-board-lock .lock-next-mult.bust { color: var(--hud-red, #e11d48);  border-color: var(--hud-red); }
        #moles-board-lock.idle {
            pointer-events: none;
            cursor: default;
            animation: none;
            box-shadow: inset 0 0 0 1px rgba(168, 168, 168, 0.25);
        }
        #moles-board-lock.idle .lock-side { pointer-events: auto; }

        #moles-board-lock .lock-holes {
            position: relative;
            width: min(60%, 420px);
            aspect-ratio: 1 / 0.85;
            max-height: 80%;
            pointer-events: none;
        }
        #moles-board-lock.idle .lock-card {
            pointer-events: auto;
            opacity: 0.92;
            border-color: rgba(255, 255, 255, 0.18);
        }
        #moles-board-lock.idle .lock-badge::before {
            animation: none;
            background: #ffd84a;
            box-shadow: 0 0 6px #ffd84a;
        }
        #moles-board-lock.idle .lock-badge { color: #ffd84a; }
        #moles-board-lock.idle .lock-title::after {
            content: ' · IDLE';
            color: #ffd84a;
            opacity: 0.8;
        }
        @keyframes moles-lock-pulse {
            0%, 100% { box-shadow: inset 0 0 0 1px rgba(26, 124, 255, 0.20), inset 0 0 60px rgba(26, 124, 255, 0.08); }
            50%      { box-shadow: inset 0 0 0 2px rgba(26, 124, 255, 0.55), inset 0 0 110px rgba(26, 124, 255, 0.22); }
        }
        #moles-board-lock .lock-side {
            grid-area: side;
            position: relative !important;
            width: auto !important;
            max-height: none !important;
            overflow-y: auto;
            overflow-x: hidden;
            background: rgba(10, 26, 47, 0.85) !important;
            border: 1px solid rgba(76, 203, 255, 0.20) !important;
            border-radius: 16px !important;
            margin: 12px 12px 0 8px !important;
            padding: 14px 10px !important;
            text-align: left;
            box-shadow: -8px 0 18px rgba(0, 0, 0, 0.4) !important;
            backdrop-filter: blur(8px);
            font-family: "Proxima Nova", "Segoe UI", sans-serif;
            pointer-events: auto !important;
            display: flex; flex-direction: column; gap: 5px;
            font-size: 11px;
        }
        #moles-board-lock .lock-side .lock-stats {
            display: grid !important;
            grid-template-columns: 1fr 1fr !important;
            gap: 2px 6px !important;
            padding: 4px 6px !important;
            font-size: 10px !important;
        }
        #moles-board-lock .lock-side .stat-row {
            padding: 1px 0 !important;
            display: flex; justify-content: space-between; align-items: baseline;
        }
        #moles-board-lock .lock-side .stat-k { font-size: 8px !important; }
        #moles-board-lock .lock-side .stat-v { font-size: 9px !important; }
        #moles-board-lock .lock-side .lock-actions {
            display: flex; gap: 4px; flex-wrap: wrap;
        }
        #moles-board-lock .lock-side .lock-actions button {
            flex: 1 1 auto; padding: 6px 8px; font-size: 10px;
        }
        #moles-board-lock .lock-side .lock-history {
            overflow: visible;
        }
        #moles-board-lock.idle .lock-side {
            opacity: 0.95;
            border-color: rgba(76, 203, 255, 0.30);
            box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7),
                        inset 0 1px 0 rgba(255, 255, 255, 0.06),
                        0 0 0 1px rgba(76, 203, 255, 0.15);
        }
        #moles-board-lock .lock-title {
            font-family: "Press Start 2P", "Courier New", monospace;
            letter-spacing: 1.5px;
            text-shadow: 2px 2px 0 #000;
        }
        #moles-board-lock .lock-badge {
            display: inline-flex; align-items: center; gap: 8px;
            font-size: 11px; font-weight: 900; letter-spacing: 1.5px;
            text-transform: uppercase; color: var(--hud-green, #1A7CFF);
            margin-bottom: 12px;
            padding: 6px 14px;
            background: rgba(26, 124, 255, 0.12);
            border: 1px solid rgba(26, 124, 255, 0.30);
            border-radius: 999px;
        }
        #moles-board-lock .lock-badge::before {
            content: ''; width: 8px; height: 8px; border-radius: 50%;
            background: #1A7CFF; box-shadow: 0 0 8px #1A7CFF;
            animation: moles-dot-blink 1s ease-in-out infinite;
        }
        @keyframes moles-dot-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        #moles-board-lock .lock-title {
            color: #fff; font-size: 20px; font-weight: 900;
            letter-spacing: 0.8px; text-transform: uppercase;
            margin-bottom: 6px;
            text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
        }
        #moles-board-lock .lock-sub {
            color: var(--hud-cyan); font-size: 13px; font-weight: 700;
            font-family: "Roboto Mono", monospace;
            margin-bottom: 14px;
            letter-spacing: 0.3px;
        }
        #moles-board-lock .lock-hole {
            position: absolute !important;
            width: 21.8% !important;
            aspect-ratio: 1 / 1 !important;
            display: flex; align-items: center; justify-content: center;
            background: #0b0e17 !important;
            border: 3px solid #3a2818 !important;
            border-radius: 50% !important;
            box-shadow: inset 0 10px 20px rgba(0,0,0,0.7) !important;
            image-rendering: pixelated;
            transition: all 120ms ease !important;
            z-index: 2;
            opacity: 1 !important;
            visibility: visible !important;
        }
        #moles-board-lock .lock-hole .px-sprite {
            position: absolute; inset: 0;
            width: 100%; height: 100%;
            display: block;
        }
        #moles-board-lock .lock-hole .px-sprite svg {
            width: 100%; height: 100%; display: block;
            image-rendering: pixelated;
            image-rendering: -moz-crisp-edges;
            image-rendering: crisp-edges;
        }
        #moles-board-lock .lock-hole .px-mole { opacity: 0; transition: opacity 80ms; }
        #moles-board-lock .lock-hole .px-dirt { opacity: 1; transition: opacity 80ms; }
        #moles-board-lock .lock-hole.revealed-mole .px-mole { opacity: 1; }
        #moles-board-lock .lock-hole.revealed-mole .px-dirt { opacity: 0; }
        #moles-board-lock .lock-hole.picked,
        #moles-board-lock .lock-hole.revealed-mole {
            border-color: #1A7CFF !important;
            box-shadow: 0 0 0 4px rgba(26, 124, 255, 0.6),
                        inset 0 10px 20px rgba(0,0,0,0.7) !important;
            z-index: 3;
        }
        #moles-board-lock .lock-hole.picked {
            transform: scale(1.06);
        }
        #moles-board-lock .lock-hole.pick-hit {
            border-color: #1A7CFF;
            box-shadow: 0 0 0 2px #1A7CFF, 0 0 16px rgba(26,124,255,0.55);
        }
        #moles-board-lock .lock-hole.pick-bust {
            border-color: #e11d48;
            box-shadow: 0 0 0 2px #e11d48, 0 0 16px rgba(225,29,72,0.55);
        }

        #moles-board-lock .lock-pip {
            position: absolute;
            transform: translate(-50%, 0);
            display: inline-flex; align-items: center; gap: 4px;
            padding: 3px 6px;
            background: #0b0e17;
            border: 2px solid #3a2818;
            border-radius: 999px;
            font-family: "Courier New", monospace;
            font-size: 10px; font-weight: 900;
            line-height: 1;
            letter-spacing: 0.5px;
            color: #fff;
            opacity: 0;
            pointer-events: none;
            image-rendering: pixelated;
            box-shadow: 0 2px 0 rgba(0,0,0,0.6);
            transition: opacity 120ms ease, transform 180ms ease;
            white-space: nowrap;
        }
        #moles-board-lock .lock-pip.show { opacity: 1; }
        #moles-board-lock .lock-pip .pip-icon {
            display: inline-block;
            width: 12px; height: 12px;
            text-align: center;
            font-size: 11px;
            line-height: 12px;
            font-weight: 900;
            font-family: "Courier New", monospace;
            border-radius: 2px;       /* boxy 8-bit icon */
            text-shadow: 1px 1px 0 #000;
        }
        #moles-board-lock .lock-pip.win {
            border-color: #1A7CFF;
            box-shadow: 0 0 0 1px #1A7CFF, 0 2px 0 rgba(0,0,0,0.6),
                        0 0 10px rgba(26,124,255,0.45);
        }
        #moles-board-lock .lock-pip.win .pip-icon { color: #1A7CFF; background: rgba(26,124,255,0.18); }
        #moles-board-lock .lock-pip.win .pip-text { color: #1A7CFF; }
        #moles-board-lock .lock-pip.bust {
            border-color: #e11d48;
            box-shadow: 0 0 0 1px #e11d48, 0 2px 0 rgba(0,0,0,0.6),
                        0 0 10px rgba(225,29,72,0.45);
        }
        #moles-board-lock .lock-pip.bust .pip-icon { color: #e11d48; background: rgba(225,29,72,0.18); }
        #moles-board-lock .lock-pip.bust .pip-text { color: #e11d48; }
        @keyframes pip-flash {
            0%   { transform: translate(-50%, -4px) scale(0.6); opacity: 0; }
            40%  { transform: translate(-50%, 0)     scale(1.15); opacity: 1; }
            100% { transform: translate(-50%, 0)     scale(1);    opacity: 1; }
        }
        #moles-board-lock .lock-pip.flash { animation: pip-flash 240ms ease-out 1; }

        #moles-board-lock .lock-mult {
            font-family: "Press Start 2P", "Courier New", monospace;
            font-size: 32px; font-weight: 900;
            letter-spacing: 1.2px;
            color: #fff;
            text-shadow: 2px 2px 0 #000, 0 0 20px rgba(26, 124, 255, 0.5);
            margin: 12px 0 16px;
        }
        #moles-board-lock .lock-mult.win  { color: #1A7CFF; text-shadow: 2px 2px 0 #0A1A2F; }
        #moles-board-lock .lock-mult.bust { color: #e11d48; text-shadow: 2px 2px 0 #3e0a18; }
        #moles-board-lock .lock-mult.live { color: #ffd84a; text-shadow: 2px 2px 0 #3e3008; }

        #moles-board-lock .lock-history {
            display: flex; gap: 4px; flex-wrap: wrap; justify-content: center;
            margin: 8px 0 12px; min-height: 20px;
        }
        #moles-board-lock .hist-chip {
            font-family: "Courier New", monospace;
            font-size: 10px; font-weight: 900;
            padding: 3px 6px;
            border: 1px solid;
            min-width: 28px; text-align: center;
            image-rendering: pixelated;
            letter-spacing: 0.5px;
            border-radius: 4px;
        }
        #moles-board-lock .hist-chip.win  { color: #1A7CFF; border-color: #1A7CFF; background: rgba(26,124,255,0.10); }
        #moles-board-lock .hist-chip.bust { color: #e11d48; border-color: #e11d48; background: rgba(225,29,72,0.10); }

        #moles-board-lock .lock-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 16px;
            margin: 12px 0;
            padding: 14px 16px;
            background: rgba(6, 16, 31, 0.65);
            border: 1px solid rgba(76, 203, 255, 0.15);
            border-radius: 12px;
            font-family: "Courier New", monospace;
            text-align: left;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.3);
        }
        #moles-board-lock .lock-stats .stat-row {
            display: flex; justify-content: space-between; align-items: baseline;
            gap: 8px; min-width: 0;
        }
        #moles-board-lock .lock-stats .stat-k {
            color: var(--hud-muted); font-size: 10px; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.5px;
            white-space: nowrap;
        }
        #moles-board-lock .lock-stats .stat-v {
            color: #fff; font-size: 13px; font-weight: 900;
            text-shadow: 1px 1px 0 #000;
            white-space: nowrap;
        }
        #moles-board-lock .lock-stats .stat-v[data-sign="pos"]  { color: #1A7CFF; }
        #moles-board-lock .lock-stats .stat-v[data-sign="neg"]  { color: #e11d48; }
        #moles-board-lock .lock-stats .stat-v[data-sign="zero"] { color: #b1bad3; }

        #moles-board-lock .lock-tally {
            color: var(--hud-muted); font-size: 12px; font-weight: 800;
            letter-spacing: 0.5px; text-transform: uppercase;
            font-family: "Courier New", monospace;
            margin: 12px 0 8px;
            padding: 10px 14px;
            background: rgba(6, 16, 31, 0.45);
            border-radius: 10px;
            border: 1px solid rgba(76, 203, 255, 0.10);
        }
        #moles-board-lock .lock-tally [data-tally-w]    { color: var(--hud-green, #1A7CFF); }
        #moles-board-lock .lock-tally [data-tally-l]    { color: var(--hud-red, #e11d48); }
        #moles-board-lock .lock-tally [data-tally-best] { color: #ffd84a; }

        #moles-board-lock .lock-spark {
            display: block; width: 100%; height: 240px;
            background: rgba(6, 16, 31, 0.65);
            border: 1px solid rgba(76, 203, 255, 0.15);
            border-radius: 12px;
            margin: 8px 0 12px;
            image-rendering: pixelated;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.4);
        }
        #moles-board-lock .lock-actions {
            display: flex; gap: 10px; justify-content: center; margin: 16px 0 0;
        }
        #moles-board-lock .lock-btn {
            background: rgba(20, 74, 122, 0.6);
            color: var(--hud-cyan);
            border: 1px solid rgba(76, 203, 255, 0.30);
            padding: 8px 16px;
            border-radius: 8px;
            font-family: "Courier New", monospace;
            font-size: 11px; font-weight: 800;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        #moles-board-lock .lock-btn:hover {
            background: rgba(26, 124, 255, 0.25);
            color: #fff;
            border-color: rgba(76, 203, 255, 0.50);
            box-shadow: 0 0 12px rgba(26, 124, 255, 0.3);
        }
        #moles-board-lock .lock-btn[data-on="0"] { opacity: 0.45; }

        #moles-board-lock .lock-settings {
            margin-top: 16px;
            padding: 16px;
            background: rgba(6, 16, 31, 0.75);
            border: 1px solid rgba(76, 203, 255, 0.20);
            border-radius: 12px;
            box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.4);
        }
        #moles-board-lock .lock-settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid rgba(76, 203, 255, 0.15);
        }
        #moles-board-lock .lock-settings-title {
            color: var(--hud-cyan);
            font-size: 12px;
            font-weight: 900;
            letter-spacing: 0.8px;
            text-transform: uppercase;
        }
        #moles-board-lock .lock-settings-close {
            background: transparent;
            border: none;
            color: var(--hud-muted);
            font-size: 18px;
            font-weight: 900;
            cursor: pointer;
            padding: 0;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 4px;
            transition: all 0.2s ease;
        }
        #moles-board-lock .lock-settings-close:hover {
            color: #fff;
            background: rgba(225, 29, 72, 0.25);
        }
        #moles-board-lock .lock-settings-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px 12px;
        }
        #moles-board-lock .lock-setting-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        #moles-board-lock .lock-setting-row label {
            color: var(--hud-muted);
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        #moles-board-lock .lock-setting-row input {
            background: rgba(10, 26, 47, 0.8);
            border: 1px solid rgba(76, 203, 255, 0.25);
            color: #fff;
            padding: 6px 8px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 700;
            text-align: center;
            outline: none;
            width: 100%;
            transition: border-color 0.2s ease, box-shadow 0.2s ease;
        }
        html[data-moles-active] .game-sidebar {
            position: relative !important;
            z-index: 300 !important;
            min-width: 300px !important;
            width: 300px !important;
            flex-shrink: 0 !important;
            min-height: 380px !important;
            max-height: 520px !important;
            height: 520px !important;
            overflow: hidden !important;
        }
        #moles-board-lock .lock-setting-row input:focus {
            border-color: var(--hud-green);
            box-shadow: 0 0 0 2px rgba(26, 124, 255, 0.15);
        }
        #moles-board-lock .hud-volume-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px 12px;
            background: rgba(6, 16, 31, 0.65);
            border-radius: 10px;
            border: 1px solid rgba(76, 203, 255, 0.15);
        }
        #moles-board-lock .hud-volume-group label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: var(--hud-muted);
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        #moles-board-lock .hud-volume-group label span:last-child {
            color: #1A7CFF;
            font-family: "Roboto Mono", monospace;
            font-weight: 700;
        }
        #moles-board-lock .hud-volume-group input[type="range"] {
            accent-color: #1A7CFF;
            cursor: pointer;
            width: 100%;
        }

        /* Phone layout: the HUD and the board overlay are both designed around
           a 300px desktop game-sidebar. The lock keeps only the topbar and the
           replica stage on the board; the 280px stats column is moved into the
           autoplay panel by relocateLockSide() instead of squeezing in here. */
        @media (max-width: 820px) {
            #moles-master-container {
                position: static !important;
                width: 100% !important;
                height: auto !important;
                max-height: 72vh;
                margin-top: 8px;
                border-radius: 14px;
            }
            html[data-moles-active] .game-sidebar {
                width: 100% !important;
                min-width: 0 !important;
                height: auto !important;
                min-height: 0 !important;
                max-height: none !important;
                overflow: visible !important;
            }
            html[data-moles-active] [data-testid="game-moles"],
            html[data-moles-active] .game-content.svelte-xd3lbs {
                height: auto !important;
                max-height: none !important;
                min-height: 320px !important;
            }
            #moles-board-lock {
                grid-template-columns: 1fr !important;
                grid-template-rows: auto 1fr !important;
                grid-template-areas: "topbar" "stage" !important;
            }
            #moles-board-lock .lock-topbar {
                flex-wrap: wrap;
                row-gap: 2px;
                padding: 4px 10px;
                min-height: 36px;
            }
            #moles-board-lock .lock-topbar .lock-badge {
                margin: 0; padding: 3px 8px; font-size: 9px;
                white-space: nowrap;
            }
            #moles-board-lock .lock-topstats {
                flex-wrap: wrap;
                justify-content: flex-end;
                gap: 4px 10px;
                font-size: 10px;
                min-width: 0;
            }
            /* Fallback only — with no "side" grid area the column auto-flows
               into an implicit full-width row under the stage if the panel is
               ever missing and relocateLockSide() has nowhere to put it. */
            #moles-board-lock .lock-side {
                grid-area: auto;
                margin: 8px !important;
                max-height: none !important;
            }
            #moles-board-lock .lock-spark { height: 140px; }
            #moles-board-lock .lock-holes { width: min(86%, 320px); }
            #moles-board-lock .lock-next-mult { font-size: 14px; }
            #moles-board-lock .lock-stage { margin: 8px !important; }
        }

        /* Phone dock: relocateLockSide() re-parents the board lock's stats
           column into the autoplay panel while the viewport is ≤820px, so it
           stops covering the felt. Scoped copies of the .lock-side internals
           (the #moles-board-lock rules no longer reach it there). */
        #moles-stats-dock { display: none; }
        #moles-stats-dock.active { display: block; }
        #moles-stats-dock .lock-side {
            background: rgba(10, 26, 47, 0.85);
            border: 1px solid rgba(76, 203, 255, 0.20);
            border-radius: 12px;
            padding: 12px 10px;
            display: flex; flex-direction: column; gap: 5px;
            font-size: 11px;
            font-family: "Proxima Nova", "Segoe UI", sans-serif;
            text-align: left;
        }
        #moles-stats-dock .lock-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 4px 14px;
            margin: 0 0 4px;
            padding: 10px 12px;
            background: rgba(6, 16, 31, 0.65);
            border: 1px solid rgba(76, 203, 255, 0.15);
            border-radius: 10px;
            font-family: "Courier New", monospace;
        }
        #moles-stats-dock .stat-row {
            display: flex; justify-content: space-between; align-items: baseline;
            gap: 8px; min-width: 0;
        }
        #moles-stats-dock .stat-k {
            color: var(--hud-muted, #A8A8A8); font-size: 9px; font-weight: 800;
            text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap;
        }
        #moles-stats-dock .stat-v {
            color: #fff; font-size: 11px; font-weight: 900;
            text-shadow: 1px 1px 0 #000; white-space: nowrap;
        }
        #moles-stats-dock .stat-v[data-sign="pos"]  { color: #1A7CFF; }
        #moles-stats-dock .stat-v[data-sign="neg"]  { color: #e11d48; }
        #moles-stats-dock .stat-v[data-sign="zero"] { color: #b1bad3; }
        #moles-stats-dock .lock-spark {
            display: block; width: 100%; height: 120px;
            background: rgba(6, 16, 31, 0.65);
            border: 1px solid rgba(76, 203, 255, 0.15);
            border-radius: 10px;
            margin: 4px 0;
            image-rendering: pixelated;
        }
        #moles-stats-dock .lock-history {
            display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-start;
            margin: 4px 0; min-height: 20px;
        }
        #moles-stats-dock .hist-chip {
            font-family: "Courier New", monospace;
            font-size: 10px; font-weight: 900;
            padding: 3px 6px;
            border: 1px solid;
            min-width: 28px; text-align: center;
            letter-spacing: 0.5px;
            border-radius: 4px;
        }
        #moles-stats-dock .hist-chip.win  { color: #1A7CFF; border-color: #1A7CFF; background: rgba(26,124,255,0.10); }
        #moles-stats-dock .hist-chip.bust { color: #e11d48; border-color: #e11d48; background: rgba(225,29,72,0.10); }
        #moles-stats-dock .lock-actions { display: flex; gap: 6px; }
        #moles-stats-dock .lock-btn {
            flex: 1 1 auto;
            background: rgba(20, 74, 122, 0.6);
            color: var(--hud-cyan, #4CCBFF);
            border: 1px solid rgba(76, 203, 255, 0.30);
            padding: 7px 10px;
            border-radius: 8px;
            font-family: "Courier New", monospace;
            font-size: 10px; font-weight: 800;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            cursor: pointer;
        }
        #moles-stats-dock .lock-btn[data-on="0"] { opacity: 0.45; }
        #moles-stats-dock .hud-volume-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
            padding: 8px 12px;
            background: rgba(6, 16, 31, 0.65);
            border-radius: 10px;
            border: 1px solid rgba(76, 203, 255, 0.15);
        }
        #moles-stats-dock .hud-volume-group label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: var(--hud-muted, #A8A8A8);
            font-size: 10px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 0.4px;
        }
        #moles-stats-dock .hud-volume-group label span:last-child {
            color: #1A7CFF;
            font-family: "Roboto Mono", monospace;
            font-weight: 700;
        }
        #moles-stats-dock .hud-volume-group input[type="range"] {
            accent-color: #1A7CFF;
            cursor: pointer;
            width: 100%;
        }
    `);

    console.log('%c[Moles]', 'color:#1A7CFF;font-weight:700', 'userscript loaded v0.5 on', location.href);

    /* =========================================================
    Config (persisted)
    ========================================================= */
    const LS_KEY = 'moles_autoplay_cfg_v4';
    const defaults = {
        mode: 'dom',
        rounds: 0,
        picksPerRound: 1,
        minDelayMs: 600,
        maxDelayMs: 1200,
        currency: 'sweeps',
        amount: 0.02,
        molesCount: 3,
        apiDelayMs: 0,
        concurrency: 1,
        stopWin: 0,
        stopLoss: 0,
        onWinPct: 0,
        onLossPct: 0,
        resetOnWin: false,
        resetOnLoss: false,
        audio: true,
        turbo: false,
    };
    const cfg = Object.assign({}, defaults, JSON.parse(localStorage.getItem(LS_KEY) || '{}'));
    const saveCfg = () => localStorage.setItem(LS_KEY, JSON.stringify(cfg));

    let molesVolume = parseInt(localStorage.getItem('moles_volume') || '80', 10);
    if (isNaN(molesVolume) || molesVolume < 0) molesVolume = 80;

    /* =========================================================
    Helpers
    ========================================================= */
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const jitter = () => cfg.minDelayMs + Math.random() * (cfg.maxDelayMs - cfg.minDelayMs);
    const $ = (sel, root = document) => root.querySelector(sel);
    const log = (...a) => console.log('%c[Moles]', 'color:#1A7CFF;font-weight:700', ...a);

    async function waitFor(sel, predicate = () => true, timeoutMs = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const el = $(sel);
            if (el && predicate(el)) return el;
            if (!state.running) throw new Error('stopped');
            await sleep(120);
        }
        throw new Error('waitFor timeout: ' + sel);
    }

    function realClick(el) {
        // Tampermonkey wraps `window` in a Proxy in some browsers, which
        // PointerEvent/MouseEvent reject when passed as `view`. Use
        // unsafeWindow if available, otherwise omit `view` entirely —
        // it's optional and the dispatched events still trigger handlers.
        const win = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : null;
        const base = { bubbles: true, cancelable: true, composed: true, button: 0 };
        const opts = win ? Object.assign({}, base, { view: win }) : base;
        // pointer/mouse events: wrap in try so one bad event type doesn't
        // kill the whole click sequence.
        const fire = (Ctor, type) => {
            try { el.dispatchEvent(new Ctor(type, opts)); }
            catch (e) { try { el.dispatchEvent(new Ctor(type, base)); } catch (e2) {} }
        };
        fire(PointerEvent, 'pointerdown');
        fire(MouseEvent,   'mousedown');
        fire(PointerEvent, 'pointerup');
        fire(MouseEvent,   'mouseup');
        fire(MouseEvent,   'click');
    }

    const isEnabled = (el) => el && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
    const isOnMolesPage = () => /\/casino\/games\/moles(?:\/|$|\?|#)/i.test(location.pathname);

    /* =========================================================
    Board lock overlay
    ========================================================= */
    function lockGameSidebar() {
        const sidebar = document.querySelector('.game-sidebar');
        if (!sidebar) return;
        sidebar.style.position = 'relative';
        sidebar.style.zIndex = '300';
        sidebar.style.minWidth = '300px';
        sidebar.style.width = '300px';
        sidebar.style.flexShrink = '0';
        sidebar.style.minHeight = 'calc(100vh - 60px)';
        sidebar.style.overflow = 'hidden';
    }

    const HOLE_POSITIONS = [
        { left: 19.8, top: 8.5 },
        { left: 58.2, top: 8.5 },
        { left: 3.5,  top: 37.5 },
        { left: 39.0, top: 37.5 },
        { left: 74.5, top: 37.5 },
        { left: 19.8, top: 67.0 },
        { left: 58.2, top: 67.0 },
    ];

    function setupResizeObserver() {
        if (resizeObserver) return;
        const gameContainer = document.querySelector('[data-testid="game-moles"]');
        if (!gameContainer) return;
        resizeObserver = new ResizeObserver(() => {
            if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
            resizeDebounceTimer = setTimeout(() => {
                const lock = document.getElementById('moles-board-lock');
                if (!lock) return;
                lock.querySelectorAll('.lock-hole').forEach((hole, i) => {
                    if (HOLE_POSITIONS[i]) {
                        hole.style.left = HOLE_POSITIONS[i].left + '%';
                        hole.style.top  = HOLE_POSITIONS[i].top  + '%';
                    }
                });
                if (state.running && typeof updateLockVisuals === 'function') {
                    updateLockVisuals();
                }
            }, 100);
        });
        resizeObserver.observe(gameContainer);
    }

    function updateLockVisuals() {
        const lock = document.getElementById('moles-board-lock');
        if (!lock) return;
    }

    function lockBoard(active = true) {
        let lock = document.getElementById('moles-board-lock');
        const gameContainer = document.querySelector('[data-testid="game-moles"]');

        if (!gameContainer) {
            console.warn('[Moles] Could not find game-moles container for overlay');
            return;
        }
        if (getComputedStyle(gameContainer).position === 'static') {
            gameContainer.style.position = 'relative';
        }

        if (!lock) {
            lock = document.createElement('div');
            lock.id = 'moles-board-lock';
            gameContainer.appendChild(lock);
        }

        lock.classList.remove('idle');
        lock.style.background = '';
        lock.style.backdropFilter = '';
        lock.style.opacity = '1';
        lock.style.pointerEvents = 'none';

        if (!lock.querySelector('.lock-holes')) {
            let rowHtml = '';
            for (let i = 0; i < HOLE_POSITIONS.length; i++) {
                const p = HOLE_POSITIONS[i];
                rowHtml += `<div class="lock-hole" data-hole="${i}" style="left:${p.left}%;top:${p.top}%;">${moleSprite()}${dirtSprite()}</div>`;
            }
            rowHtml += `<div class="lock-pip" data-lock-pip><span class="pip-icon"></span><span class="pip-text"></span></div>`;

            const statsHtml = `
                <div class="lock-stats" data-lock-stats>
                    <div class="stat-row"><span class="stat-k">Wagered</span><span class="stat-v" data-st-wager>0.00</span></div>
                    <div class="stat-row"><span class="stat-k">P/L</span><span class="stat-v" data-st-pnl>0.00</span></div>
                    <div class="stat-row"><span class="stat-k">Win rate</span><span class="stat-v" data-st-wr>—</span></div>
                    <div class="stat-row"><span class="stat-k">Avg mult</span><span class="stat-v" data-st-avg>—</span></div>
                    <div class="stat-row"><span class="stat-k">Biggest hit</span><span class="stat-v" data-st-big>0.00</span></div>
                    <div class="stat-row" style="grid-column:1/-1"><span class="stat-k">Balance Δ</span><span class="stat-v" data-st-bal>—</span></div>
                </div>
            `;
            lock.innerHTML = `
                <div class="lock-topbar">
                    <div class="lock-badge">Autoplay <span data-lock-sub>idle</span></div>
                    <div class="lock-topstats">
                        <span class="ts-cell"><span class="ts-k">W</span><span class="ts-v" data-tally-w>0</span></span>
                        <span class="ts-cell"><span class="ts-k">L</span><span class="ts-v" data-tally-l>0</span></span>
                        <span class="ts-cell"><span class="ts-k">Best</span><span class="ts-v" data-tally-best>0.00×</span></span>
                        <span class="ts-cell"><span class="ts-k">P/L</span><span class="ts-v" data-st-pnl-top>0.00</span></span>
                        <span class="ts-cell"><span class="ts-k">RTP</span><span class="ts-v" data-st-rtp-top>—</span></span>
                    </div>
                </div>
                <div class="lock-stage">
                    <div class="lock-holes" data-lock-row>${rowHtml}</div>
                    <div class="lock-next-mult" data-lock-mult>0.00×</div>
                </div>
                <div class="lock-side">
                    ${statsHtml}
                    <canvas class="lock-spark" data-lock-spark width="280" height="240"></canvas>
                    <div class="lock-history" data-lock-history></div>
                    <div class="lock-actions">
                        <button class="lock-btn" data-act="export-csv" type="button">Export CSV</button>
                        <button class="lock-btn" data-act="toggle-audio" type="button" data-on="1">🔊 Audio</button>
                    </div>
                </div>
            `;
            ['click', 'pointerdown', 'mousedown', 'mouseup'].forEach(ev =>
                lock.addEventListener(ev, e => {
                    if (e.target.closest('.lock-side')) return;
                    e.stopPropagation();
                    e.preventDefault();
                })
            );
        }

        setupResizeObserver();
        addVolumeControlToPanel();
        if (active && !gridRafId) startGridRenderer();
        relocateLockSide();
    }

    /* Phones: the lock's 280px stats column has nowhere to live on a narrow
       board — stacked into the overlay it floats over the felt and clips
       (seen on stake.us iOS). While the viewport is ≤820px it is re-parented
       into the autoplay panel instead; the grid renderer paints the same
       elements wherever they are parented. Re-run from the 500ms reconcile
       loop so rotation and site re-renders swap the layout both ways. */
    function relocateLockSide() {
        const lock = document.getElementById('moles-board-lock');
        const hudBody = document.querySelector('#moles-master-container .hud-body');
        const narrow = (window.innerWidth || 0) <= 820;
        // The column can be inside the lock, inside the dock, or (after the
        // site nuked the panel) detached but still referenced by the renderer.
        const side = (lock && lock.querySelector('.lock-side')) ||
                     document.querySelector('#moles-stats-dock .lock-side') ||
                     (historyEl && historyEl.closest ? historyEl.closest('.lock-side') : null);
        if (!side) return;
        if (narrow && hudBody) {
            let dock = document.getElementById('moles-stats-dock');
            if (!dock) {
                dock = document.createElement('div');
                dock.id = 'moles-stats-dock';
                hudBody.appendChild(dock);
            } else if (dock.parentElement !== hudBody) {
                hudBody.appendChild(dock);   // panel was rebuilt; re-adopt the dock
            }
            if (side.parentElement !== dock) {
                dock.textContent = '';       // drop a stale column from a previous lock
                dock.appendChild(side);
            }
            dock.classList.add('active');
        } else if (!narrow && lock && side.parentElement !== lock) {
            lock.appendChild(side);
            const dock = document.getElementById('moles-stats-dock');
            if (dock) dock.remove();
        }
    }

    function pixelSvg(grid, palette) {
        let rects = '';
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                const c = grid[y * 8 + x];
                if (c === ' ' || c === '.') continue;
                const fill = palette[c];
                if (!fill) continue;
                rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
            }
        }
        return `<svg viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">${rects}</svg>`;
    }
    function moleSprite() {
        const grid =
            '..BBBB..' +
            '.BBBBBB.' +
            'BWBBBBWB' +
            'BBKBBKBB' +
            'BBBPPBBB' +
            'BBBPPBBB' +
            '.BBBBBB.' +
            '..BBBB..';
        const palette = { B: '#c08850', W: '#ffffff', K: '#0b0e17', P: '#ff8aa8' };
        return `<span class="px-sprite px-mole">${pixelSvg(grid, palette)}</span>`;
    }
    function dirtSprite() {
        // 8x8 dirt hole: dark ellipse with rim.
        const grid =
            '..DDDD..' +
            '.DKKKKD.' +
            'DKKKKKKD' +
            'DKKKKKKD' +
            'DKKKKKKD' +
            'DKKKKKKD' +
            '.DKKKKD.' +
            '..DDDD..';
        const palette = { D: '#4a3018', K: '#0b0e17' };
        return `<span class="px-sprite px-dirt">${pixelSvg(grid, palette)}</span>`;
    }
    function unlockBoard() {
        const lock = document.getElementById('moles-board-lock');
        if (lock) lock.classList.add('idle');
    }
    function updateLockSub(text) {
        const sub = document.querySelector('#moles-board-lock [data-lock-sub]');
        if (sub) sub.textContent = text;
    }

    /* =========================================================
    Grid renderer — rAF-driven, repaints only on round change.
    This decouples paint cost from API throughput: at 25 rounds/s
    we still only repaint at most ~60Hz, and most of those ticks
    are a no-op cmp.
    ========================================================= */
    let gridRafId = 0;
    let resizeObserver = null;
    let resizeDebounceTimer = null;
    let renderedGameId = -1;
    let holeEls = null;
    let historyEl = null;
    let multEl = null;
    let subEl = null;
    let wEl = null, lEl = null, bestEl = null;
    let statsEls = null;
    let balanceStartedAt = null;

    function readPageBalance() {
        /* MEASURED LIVE 2026-08-03 on stake.us/casino/games/moles: ALL FOUR of
           the original candidates below returned nothing. Stake's new design
           system dropped `header-balance`, `header-balance-button`,
           `wallet-amount` and `data-test="balance"` entirely.

           With no balance, checkStopConditions() cannot evaluate stop-loss or
           take-profit, so a run had nothing left to stop it. The coin-toggle
           chain is verified live and reads the ACTIVE currency's balance; the
           old ids are kept as fallbacks. */
        const candidates = [
            '[data-testid="coin-toggle"] .content span[data-ds-text="true"]',
            '[data-testid="balance-toggle"] .content span[data-ds-text="true"]',
            '[data-testid="coin-toggle"] .content span',
            '[data-testid="balance-toggle"] span.content span',
            '[data-testid="header-balance-button"] [data-testid="header-balance"]',
            '[data-testid="header-balance"]',
            '[data-testid="wallet-amount"]',
            'header [data-test="balance"]',
        ];
        for (const sel of candidates) {
            const el = document.querySelector(sel);
            if (el) {
                const num = parseFloat((el.textContent || '').replace(/[^0-9.\-]/g, ''));
                if (!Number.isNaN(num)) return num;
            }
        }
        const header = document.querySelector('header') || document.body;
        const re = /(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/g;
        let best = null;
        for (const m of (header.textContent || '').matchAll(re)) {
            const n = parseFloat(m[1]);
            if (best == null || n > best) best = n;
        }
        return best;
    }

    let sparkCanvas = null, sparkCtx = null;
    function startGridRenderer() {
        renderedGameId = -1;
        const root = document.getElementById('moles-board-lock');
        // The stats column may have been re-parented into the autoplay panel
        // by relocateLockSide(); look there for its elements as well.
        const sideDock = document.getElementById('moles-stats-dock');
        const q = (sel) => root.querySelector(sel) || (sideDock ? sideDock.querySelector(sel) : null);
        sparkCanvas = q('[data-lock-spark]');
        sparkCtx = sparkCanvas ? sparkCanvas.getContext('2d') : null;
        const exportBtn = q('[data-act="export-csv"]');
        if (exportBtn) exportBtn.addEventListener('click', exportCsv);
        const audioBtn = q('[data-act="toggle-audio"]');
        if (audioBtn) {
            audioBtn.dataset.on = cfg.audio === false ? '0' : '1';
            audioBtn.textContent = cfg.audio === false ? '🔇 Audio' : '🔊 Audio';
            audioBtn.addEventListener('click', () => {
                cfg.audio = cfg.audio === false;
                saveCfg();
                audioBtn.dataset.on = cfg.audio === false ? '0' : '1';
                audioBtn.textContent = cfg.audio === false ? '🔇 Audio' : '🔊 Audio';
            });
        }
        holeEls = Array.from(root.querySelectorAll('.lock-hole'));
        historyEl = q('[data-lock-history]');
        multEl = root.querySelector('[data-lock-mult]');
        subEl = root.querySelector('[data-lock-sub]');
        wEl = root.querySelector('[data-tally-w]');
        lEl = root.querySelector('[data-tally-l]');
        bestEl = root.querySelector('[data-tally-best]');
        statsEls = {
            wager: q('[data-st-wager]'),
            ret: q('[data-st-return]'),
            pnl: q('[data-st-pnl]'),
            rtp: q('[data-st-rtp]'),
            wr: q('[data-st-wr]'),
            avg: q('[data-st-avg]'),
            big: q('[data-st-big]'),
            bal: q('[data-st-bal]'),
            next: q('[data-st-next]'),
            pnlTop: root.querySelector('[data-st-pnl-top]'),
            rtpTop: root.querySelector('[data-st-rtp-top]'),
        };
        const tick = () => {
            if (reveal.gameId !== renderedGameId) {
                renderedGameId = reveal.gameId;
                paintRow(reveal.rounds, reveal.outcome);
                paintHistory();
                paintStats();
                paintSparkline();
                if (multEl) multEl.textContent = (reveal.mult || 0).toFixed(2) + '×';
                if (multEl) multEl.className = 'lock-mult ' + (reveal.outcome === 'bust' ? 'bust' : reveal.outcome === 'win' ? 'win' : 'live');
                if (subEl) subEl.textContent = subText();
                if (wEl) wEl.textContent = reveal.wins;
                if (lEl) lEl.textContent = reveal.losses;
                if (bestEl) bestEl.textContent = reveal.bestMult.toFixed(2) + '×';
            }
            gridRafId = requestAnimationFrame(tick);
        };
        gridRafId = requestAnimationFrame(tick);
    }

    function fmtMoney(n) {
        if (!Number.isFinite(n)) return '—';
        const abs = Math.abs(n);
        if (abs >= 1000) return n.toFixed(0);
        if (abs >= 1) return n.toFixed(2);
        return n.toFixed(4);
    }
    function paintStats() {
        if (!statsEls) return;
        const r = reveal;
        const pnl = r.returned - r.wagered;
        const games = r.wins + r.losses;
        const rtp = r.wagered > 0 ? (r.returned / r.wagered) * 100 : null;
        const wr = games > 0 ? (r.wins / games) * 100 : null;
        const avg = r.wins > 0 ? (r.multSum / r.wins) : null;

        if (statsEls.wager) statsEls.wager.textContent = fmtMoney(r.wagered);
        if (statsEls.ret) statsEls.ret.textContent = fmtMoney(r.returned);
        if (statsEls.pnl) {
            statsEls.pnl.textContent = (pnl >= 0 ? '+' : '') + fmtMoney(pnl);
            statsEls.pnl.dataset.sign = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
        }
        if (statsEls.pnlTop) {
            statsEls.pnlTop.textContent = (pnl >= 0 ? '+' : '') + fmtMoney(pnl);
            statsEls.pnlTop.dataset.sign = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'zero';
        }
        if (statsEls.rtpTop) statsEls.rtpTop.textContent = rtp == null ? '—' : rtp.toFixed(1) + '%';
        if (statsEls.rtp) statsEls.rtp.textContent = rtp == null ? '—' : rtp.toFixed(1) + '%';
        if (statsEls.wr) statsEls.wr.textContent = wr == null ? '—' : wr.toFixed(1) + '%';
        if (statsEls.avg) statsEls.avg.textContent = avg == null ? '—' : avg.toFixed(2) + '×';
        if (statsEls.big) statsEls.big.textContent = fmtMoney(r.biggestPayout);
        if (statsEls.next) {
            const nb = state.currentBet || state.baseBet || cfg.amount;
            statsEls.next.textContent = fmtMoney(nb);
            statsEls.next.dataset.sign = nb > state.baseBet ? 'neg' : nb < state.baseBet ? 'pos' : 'zero';
        }

        if (statsEls.bal) {
            const now = readPageBalance();
            if (balanceStartedAt != null && now != null) {
                const d = now - balanceStartedAt;
                statsEls.bal.textContent = (d >= 0 ? '+' : '') + fmtMoney(d);
                statsEls.bal.dataset.sign = d > 0 ? 'pos' : d < 0 ? 'neg' : 'zero';
            } else {
                statsEls.bal.textContent = '—';
            }
        }
    }
    function stopGridRenderer() {
        if (gridRafId) cancelAnimationFrame(gridRafId);
        gridRafId = 0; holeEls = null;
        sparkCanvas = null; sparkCtx = null;
    }

    function paintSparkline() {
        if (!sparkCtx || !sparkCanvas) return;
        const w = sparkCanvas.width, h = sparkCanvas.height;
        sparkCtx.clearRect(0, 0, w, h);
        const data = runLog;
        if (!data.length) return;
        const pad = 2;
        const n = Math.min(data.length, 200);
        const slice = data.slice(-n);
        let lo = 0, hi = 0;
        for (const r of slice) { if (r.pnl < lo) lo = r.pnl; if (r.pnl > hi) hi = r.pnl; }
        if (hi === lo) { hi = lo + 1e-9; }
        const xs = (i) => pad + (i * (w - 2*pad) / Math.max(1, n - 1));
        const ys = (v) => h - pad - ((v - lo) / (hi - lo)) * (h - 2*pad);
        if (lo < 0 && hi > 0) {
            const zy = ys(0);
            sparkCtx.strokeStyle = 'rgba(255,255,255,0.12)';
            sparkCtx.setLineDash([3, 3]);
            sparkCtx.beginPath(); sparkCtx.moveTo(0, zy); sparkCtx.lineTo(w, zy); sparkCtx.stroke();
            sparkCtx.setLineDash([]);
        }
        sparkCtx.beginPath();
        sparkCtx.moveTo(xs(0), ys(slice[0].pnl));
        for (let i = 1; i < slice.length; i++) sparkCtx.lineTo(xs(i), ys(slice[i].pnl));
        const endPnl = slice[slice.length - 1].pnl;
        const color = endPnl >= 0 ? '#1A7CFF' : '#e11d48';
        sparkCtx.strokeStyle = color;
        sparkCtx.lineWidth = 1.5;
        sparkCtx.stroke();
        sparkCtx.lineTo(xs(slice.length - 1), h - pad);
        sparkCtx.lineTo(xs(0), h - pad);
        sparkCtx.closePath();
        sparkCtx.fillStyle = endPnl >= 0 ? 'rgba(26,124,255,0.12)' : 'rgba(225,29,72,0.12)';
        sparkCtx.fill();
    }
    function subText() {
        const r = reveal.rounds.length;
        const tag = reveal.outcome === 'win' ? 'CASHED' :
                    reveal.outcome === 'bust' ? 'BUSTED' :
                    reveal.outcome === 'live' ? 'LIVE' : reveal.outcome.toUpperCase();
        return `row ${r} · ${tag}`;
    }

    const HOLE_POSITIONS_REF = [
        { left: 19.45, top: 0 },
        { left: 58.36, top: 0 },
        { left: 0, top: 31.32 },
        { left: 38.91, top: 31.32 },
        { left: 77.81, top: 31.32 },
        { left: 19.45, top: 62.63 },
        { left: 58.36, top: 62.63 },
    ];
    const HOLE_W = 22.19;
    function paintRow(rounds, outcome) {
        if (!holeEls) return;
        for (const h of holeEls) {
            h.className = 'lock-hole';
            const idx = parseInt(h.dataset.hole, 10);
            const p = HOLE_POSITIONS_REF[idx];
            if (p) { h.style.left = p.left + '%'; h.style.top = p.top + '%'; }
        }
        const pip = document.querySelector('#moles-board-lock [data-lock-pip]');
        if (!pip) return;
        if (!rounds.length) {
            pip.classList.remove('show', 'win', 'bust');
            return;
        }
        const last = rounds[rounds.length - 1];
        const moles = new Set(last.molePositions || []);
        for (let i = 0; i < holeEls.length; i++) {
            const el = holeEls[i];
            if (moles.has(i)) el.classList.add('revealed-mole');
            if (i === last.pick) {
                el.classList.add('picked');
                el.classList.add(last.hit ? 'pick-hit' : 'pick-bust');
            }
        }
        const p = HOLE_POSITIONS_REF[last.pick];
        if (p) {
            const centerX = p.left + HOLE_W / 2;
            pip.style.left = centerX + '%';
            pip.style.top = `calc(${p.top + HOLE_W}% + 20px)`;
            pip.classList.remove('win', 'bust');
            pip.classList.add(last.hit ? 'win' : 'bust');
            const icon = pip.querySelector('.pip-icon');
            const text = pip.querySelector('.pip-text');
            if (last.hit) {
                icon.textContent = '✓'; // ✓
                text.textContent = (last.multiplier || 0).toFixed(2) + '×';
            } else {
                icon.textContent = '✕'; // ✕
                text.textContent = 'BUST';
            }
            pip.classList.add('show');
            pip.classList.remove('flash');
            void pip.offsetWidth;
            pip.classList.add('flash');
        }
    }

    const HISTORY_MAX = 14;
    const history = [];
    let lastHistoryGameId = -1;
    function paintHistory() {
        if (!historyEl) return;
        if (renderedGameId !== lastHistoryGameId &&
            (reveal.outcome === 'win' || reveal.outcome === 'bust' || reveal.outcome === 'error')) {
            history.push({ outcome: reveal.outcome, mult: reveal.mult, rows: reveal.rounds.length });
            if (history.length > HISTORY_MAX) history.shift();
            lastHistoryGameId = renderedGameId;
        }
        historyEl.innerHTML = history.map(h => {
            const cls = h.outcome === 'win' ? 'win' : 'bust';
            const label = h.outcome === 'win' ? h.mult.toFixed(2) + '×' : 'X';
            return `<span class="hist-chip ${cls}">${label}</span>`;
        }).join('');
    }

    /* =========================================================
    DOM strategy
    ========================================================= */
    const SEL = {
        bet: '[data-testid="bet-button"]',
        cashout: '[data-testid="cashout-button"]',
        random: '[data-testid="game-random-pick"]',
    };

    function findBetButton() {
        return document.querySelector(SEL.bet)
            || document.querySelector(SEL.cashout)
            || null;
    }

    async function waitForBet(predicate, timeoutMs = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const el = findBetButton();
            if (el && predicate(el)) return el;
            if (!state.running) throw new Error('stopped');
            await sleep(120);
        }
        throw new Error('waitFor timeout: bet-button');
    }

    /* ---- DOM-mode helpers so the martingale + stop conditions work the same
       as they do in API mode: the game's bet field is driven from
       state.currentBet, and each round's outcome is fed back through
       publishReveal / applyOutcomeToBet / checkStopConditions. ---- */
    function molesGameAmtInput() {
        return document.querySelector('[data-testid="input-game-amount"]') ||
               document.querySelector('[data-testid="game-amount"]');
    }
    function setMolesGameAmount(val) {
        const el = molesGameAmtInput();
        if (!el || !isFiniteNum(val)) return;
        const proto = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                       Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        const str = String(Number(Number(val).toPrecision(8)));
        if (setter) setter.call(el, str); else el.value = str;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }
    /** The current payout multiplier, from the profit field or cashout label.
     *  `btn` is the resolved cashout element (its label may hold the "N×"), but
     *  the "Cashout" control is sometimes the bet-button itself, so we also fall
     *  back to the profit field and a scan of both known buttons. */
    function readMolesMult(btn) {
        const p = document.querySelector('[data-testid="profit-input"]');
        if (p && p.value) { const n = parseFloat(p.value); if (Number.isFinite(n) && n > 0) return n; }
        const readX = (el) => { const m = el && (el.textContent || '').match(/([\d.]+)\s*[×xX]/); return m ? parseFloat(m[1]) : 0; };
        return readX(btn) || readX(document.querySelector(SEL.cashout)) || readX(document.querySelector(SEL.bet)) || 0;
    }

    /** Play one round via the page UI. Returns 'win' | 'bust' | null (aborted),
     *  and reports the money so the strategy + stops react like API mode. */
    async function domRound() {
        // Drive the bet from the tool's running bet so martingale takes effect;
        // fall back to the tool's base bet if nothing is set yet.
        const wager = state.currentBet || cfg.amount || 0;
        if (wager > 0) setMolesGameAmount(wager);

        // Wait until the bet button is enabled AND shows "Play" — the
        // label flips between "Play" (no active round) and "Cashout"
        // (active round, click to bail). If we just check `isEnabled`
        // we'd happily click a leftover Cashout, which actually starts
        // a new round in some states. Reading the label fixes that.
        const bet = await waitForBet((el) =>
            isEnabled(el) && /play/i.test(el.textContent || ''), 15000);
        log('Play');
        realClick(bet);

        for (let i = 0; i < cfg.picksPerRound; i++) {
            // After the first pick a mole can end the round at any moment,
            // permanently disabling Random Pick — blind-waiting on it froze the
            // loop for the full 30s timeout and the bust was never recorded:
            // the round didn't count, martingale didn't step, stop-loss never
            // checked, and the next lap just bet again. So from pick 2 on,
            // watch for the round ending (bet button back to an enabled
            // "Play") as well as the next pick arming, and score the bust the
            // moment it shows. Pick 1 can't be preceded by a bust, and right
            // after our own Play click the button can still briefly read
            // "Play", so the round-over check is skipped there.
            let rand = null;
            const waitStart = Date.now();
            while (Date.now() - waitStart < 30000) {
                const r = document.querySelector(SEL.random);
                if (r && isEnabled(r)) { rand = r; break; }
                if (i > 0) {
                    const over = findBetButton();
                    if (over && isEnabled(over) && /play/i.test(over.textContent || '')) {
                        log('Bust — mole hit on pick', i);
                        publishReveal(lastDomRound ? [lastDomRound] : [], 'bust', 0, { wager, payout: 0, currency: cfg.currency });
                        return 'bust';
                    }
                }
                if (!state.running) return null;
                await sleep(120);
            }
            if (!rand) throw new Error('waitFor timeout: ' + SEL.random);
            await sleep(jitter());
            if (!state.running) return null;
            updateLockSub(`round ${state.count + 1} · pick ${i + 1}/${cfg.picksPerRound}`);
            log('Random Pick', i + 1);
            realClick(rand);
        }

        await sleep(jitter());
        const end = await waitForBet((el) => {
            if (!isEnabled(el)) return false;
            const txt = (el.textContent || '').toLowerCase();
            return /cashout|play/.test(txt);
        }, 15000).catch(() => null);

        if (!end) {
            log('Round end timeout — assuming bust');
            publishReveal(lastDomRound ? [lastDomRound] : [], 'bust', 0, { wager, payout: 0, currency: cfg.currency });
            return 'bust';
        }
        const label = (end.textContent || '').toLowerCase();
        if (/cashout/.test(label)) {
            const mult = readMolesMult(end);            // read BEFORE clicking; the label clears after
            log('Cashout', mult);
            realClick(end);
            publishReveal(lastDomRound ? [lastDomRound] : [], 'win', mult, { wager, payout: wager * (mult || 0), currency: cfg.currency });
            return 'win';
        }
        // Label is "Play" — the round busted. Don't click; otherwise we'd fire
        // a brand-new bet inside this round and double-up next iteration.
        log('Bust — round over');
        publishReveal(lastDomRound ? [lastDomRound] : [], 'bust', 0, { wager, payout: 0, currency: cfg.currency });
        return 'bust';
    }

    /* =========================================================
    API strategy — reuses page cookies; sniffs rotating tokens
    from real requests the page makes.
    ========================================================= */
    let sniffedLockdown = null;
    let sniffedAccess = null;

    function readSessionCookie() {
        const m = document.cookie.match(/(?:^|;\s*)session=([^;]+)/);
        return m ? decodeURIComponent(m[1]) : null;
    }
    let _cachedHdrs = null;
    function buildHeaders() {
        if (!_cachedHdrs || _cachedHdrs['x-access-token'] !== sniffedAccess ||
            _cachedHdrs['x-lockdown-token'] !== (sniffedLockdown || undefined)) {
            _cachedHdrs = {
                'content-type': 'application/json',
                'x-access-token': sniffedAccess,
                'x-language': 'en',
            };
            if (sniffedLockdown) _cachedHdrs['x-lockdown-token'] = sniffedLockdown;
        }
        return _cachedHdrs;
    }
    function refreshAccessFromCookie() {
        const s = readSessionCookie();
        if (s && s !== sniffedAccess) { sniffedAccess = s; _cachedHdrs = null; }
    }
    refreshAccessFromCookie();
    setInterval(refreshAccessFromCookie, 3000);

    function installFetchSniffer(target, label) {
        if (!target || !target.fetch || target.__moles_fetch_patched) return;
        const orig = target.fetch;
        target.fetch = function (input, init) {
            try {
                const headers = (init && init.headers) || {};
                const get = (k) => (headers instanceof Headers
                    ? headers.get(k)
                    : headers[k] || headers[k.toLowerCase()]);
                const ld = get('x-lockdown-token'); if (ld) sniffedLockdown = ld;
                const at = get('x-access-token');   if (at) sniffedAccess   = at;
            } catch (e) {}
            return orig.apply(this, arguments);
        };
        target.__moles_fetch_patched = true;
        console.log('%c[Moles]', 'color:#1A7CFF;font-weight:700', 'fetch sniffer installed on', label);
    }
    installFetchSniffer(window, 'window');
    if (typeof unsafeWindow !== 'undefined' && unsafeWindow !== window) {
        installFetchSniffer(unsafeWindow, 'unsafeWindow');
    }

    (function installXhrSniffer() {
        const targets = [window.XMLHttpRequest && window.XMLHttpRequest.prototype];
        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.XMLHttpRequest &&
            unsafeWindow.XMLHttpRequest.prototype !== window.XMLHttpRequest?.prototype) {
            targets.push(unsafeWindow.XMLHttpRequest.prototype);
        }
        targets.filter(Boolean).forEach((proto) => {
            if (proto.__moles_xhr_patched) return;
            const origSet = proto.setRequestHeader;
            proto.setRequestHeader = function (name, value) {
                try {
                    const lc = String(name).toLowerCase();
                    if (lc === 'x-lockdown-token' && value) sniffedLockdown = value;
                    if (lc === 'x-access-token'   && value) sniffedAccess   = value;
                } catch (e) {}
                return origSet.apply(this, arguments);
            };
            proto.__moles_xhr_patched = true;
        });
    })();

    function nanoid(n = 21) {
        const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
        let s = ''; for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
        return s;
    }

    function detectCurrency() {
        const m = document.cookie.match(/(?:^|;\s*)currency_currency=([^;]+)/);
        if (m) return decodeURIComponent(m[1]);
        const sel = document.querySelector('[data-testid*="currency" i], [data-test*="currency" i]');
        if (sel) {
            const txt = (sel.textContent || '').trim().toLowerCase();
            if (txt && txt.length <= 8) return txt;
        }
        return null;
    }
    function syncCurrency() {
        const c = detectCurrency();
        if (c && c !== cfg.currency) {
            cfg.currency = c;
            saveCfg();
            const inp = document.querySelector('#moles-master-container [data-k="currency"]');
            if (inp && document.activeElement !== inp) inp.value = c;
        }
    }

    async function prewarmConnection() {
        try {
            await fetch(location.origin + '/_api/casino/moles/bet', {
                method: 'OPTIONS',
                credentials: 'include',
                keepalive: true,
            });
        } catch (e) { /* expected; we don't care about the response */ }
    }

    let lastFetchObserved = performance.now();

    const rateLimiter = {
        recent429: [],
        backoffUntil: 0,
        scale: 1.0,
        note429() {
            const now = performance.now();
            this.recent429.push(now);
            while (this.recent429.length && this.recent429[0] < now - 5000) this.recent429.shift();
            if (this.recent429.length >= 2) {
                this.scale = Math.max(0.25, this.scale * 0.5);
                this.backoffUntil = now + 10000;
            }
        },
        adaptiveSleep() {
            const now = performance.now();
            if (now < this.backoffUntil) return 250 + Math.random() * 250;
            if (this.scale < 1) this.scale = Math.min(1, this.scale + 0.05);
            return 0;
        },
        effectiveConcurrency(target) {
            return Math.max(1, target);
        },
    };

    function beep(pattern = 'win') {
        try {
            const AC = window.AudioContext || window.webkitAudioContext;
            const ctx = new AC();
            const now = ctx.currentTime;
            const baseGain = molesVolume / 100;
            const notes = pattern === 'win' ? [880, 1320, 1760]
                    : pattern === 'bust' ? [440, 220]
                    : pattern === 'hit' ? [523.25, 659.25, 783.99]
                    : [660];
            notes.forEach((freq, i) => {
                const o = ctx.createOscillator();
                const g = ctx.createGain();
                o.type = 'square';
                o.frequency.value = freq;
                g.gain.setValueAtTime(0.0001 * baseGain, now + i * 0.12);
                g.gain.exponentialRampToValueAtTime(0.18 * baseGain, now + i * 0.12 + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001 * baseGain, now + i * 0.12 + 0.10);
                o.connect(g); g.connect(ctx.destination);
                o.start(now + i * 0.12); o.stop(now + i * 0.12 + 0.12);
            });
            setTimeout(() => ctx.close(), notes.length * 130 + 200);
        } catch (e) {}
    }

    function addVolumeControlToPanel() {
        const lockSide = document.querySelector('#moles-board-lock .lock-side, #moles-stats-dock .lock-side');
        if (!lockSide || lockSide.querySelector('.hud-volume-group')) return;
        const volHTML = `
            <div class="hud-volume-group">
                <label>
                    <span>🔊 VOLUME</span>
                    <span id="moles-vol-val">${molesVolume}</span>
                </label>
                <input type="range" id="moles-vol-slider" min="0" max="100" value="${molesVolume}">
            </div>
        `;
        const statsSection = lockSide.querySelector('.lock-stats') || lockSide;
        statsSection.insertAdjacentHTML('afterend', volHTML);
        const slider = document.getElementById('moles-vol-slider');
        const valDisplay = document.getElementById('moles-vol-val');
        if (slider) {
            slider.addEventListener('input', () => {
                molesVolume = parseInt(slider.value, 10);
                if (valDisplay) valDisplay.textContent = molesVolume;
                localStorage.setItem('moles_volume', molesVolume);
            });
        }
    }

    function exportCsv() {
        if (!runLog.length) { log('runLog empty'); return; }
        const head = 'iso,wager,payout,multiplier,outcome,pnl,rows';
        const rows = runLog.map(r =>
            new Date(r.t).toISOString() + ',' +
            r.wager + ',' + r.payout + ',' + r.mult + ',' +
            r.outcome + ',' + r.pnl + ',' + r.rows
        );
        const blob = new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `moles-autoplay-${location.host}-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    async function apiCall(op, body) {
        if (!sniffedAccess) {
            throw new Error('No session cookie found — are you logged in?');
        }
        const r = await fetch(location.origin + '/_api/casino/moles/' + op, {
            method: 'POST',
            credentials: 'include',
            keepalive: true,
            headers: buildHeaders(),
            body: JSON.stringify(body),
        });
        lastFetchObserved = performance.now();
        if (r.status === 429) {
            rateLimiter.note429();
            throw new Error(op + ' 429');
        }
        if (!r.ok) throw new Error(op + ' ' + r.status);
        return r.json();
    }

    function apiIsReady() {
        return !!sniffedAccess;
    }
    function apiReadyLabel() {
        if (!apiIsReady()) {
            return 'REST · no session cookie — log in on ' + location.host;
        }
        const idleMs = performance.now() - lastFetchObserved;
        if (state.running && idleMs > 90000) {
            return 'REST · STALE? no traffic in ' + Math.round(idleMs / 1000) + 's — click anywhere';
        }
        let bits = 'REST · ready · ' + location.host + ' · ' + (cfg.currency || '?');
        if (rateLimiter.scale < 1) bits += ' · 429-backoff x' + rateLimiter.scale.toFixed(2);
        return bits;
    }

    async function apiRound() {
        const HOLES_PER_ROW = 7;
        const t0 = performance.now();
        const identifier = nanoid();

        const stakeAmount = state.currentBet || cfg.amount;
        const betRes = await apiCall('bet', {
            currency: cfg.currency,
            amount: stakeAmount,
            molesCount: cfg.molesCount,
            identifier,
        });

        const wagerAmt = betRes?.molesBet?.amount ?? stakeAmount;
        const wagerCcy = betRes?.molesBet?.currency ?? cfg.currency;
        let rounds = betRes?.molesBet?.state?.rounds || [];
        // The wager is counted once, at win/bust below. Counting it here too
        // (non-turbo only) doubled reveal.wagered — understating P/L by a bet
        // per round and tripping the stop conditions at the wrong thresholds.
        if (!cfg.turbo) publishReveal(rounds, 'pending', 0, { currency: wagerCcy });

        for (let i = 0; i < cfg.picksPerRound; i++) {
            if (!state.running) { if (!cfg.turbo) publishReveal(rounds, 'stopped', 0); return performance.now() - t0; }

            const pick = Math.floor(Math.random() * HOLES_PER_ROW);
            const res = await apiCall('next', { pick })
                .catch(e => { log('pick err', e.message); return null; });
            if (!res) {
                if (!cfg.turbo) publishReveal(rounds, 'error', 0);
                return performance.now() - t0;
            }
            rounds = res.molesNext?.state?.rounds || rounds;
            const last = rounds[rounds.length - 1];
            const active = res.molesNext?.active;
            const mult = res.molesNext?.payoutMultiplier || last?.multiplier || 0;
            if (active === false) {
                publishReveal(rounds, 'bust', mult, { payout: 0, wager: wagerAmt });
                beep('bust');
                applyOutcomeToBet('bust');
                checkStopConditions();
                return performance.now() - t0;
            }
            if (!cfg.turbo) {
                publishReveal(rounds, 'live', mult);
                beep('hit');
            }
        }

        const cashRes = await apiCall('cashout', { identifier }).catch(e => { log('cashout err', e.message); return null; });
        const co = cashRes?.molesCashout;
        const finalMult = co?.payoutMultiplier ?? cashRes?.payoutMultiplier ?? 0;
        const finalPayout = co?.payout ?? cashRes?.payout ?? (wagerAmt * finalMult);
        publishReveal(co?.state?.rounds || rounds, 'win', finalMult, { payout: finalPayout, wager: wagerAmt });
        beep('win');
        applyOutcomeToBet('win');
        checkStopConditions();
        return performance.now() - t0;
    }

    const reveal = {
        rounds: [],
        outcome: 'idle',
        mult: 0,
        gameId: 0,
        wins: 0, losses: 0,
        bestMult: 0,
        currency: '',
        wagered: 0,
        returned: 0,
        biggestPayout: 0,
        multSum: 0,
    };
    /* Latest round as read off the real board by the tile observer. DOM-mode
       autoplay publishes with this so the lock overlay animates the actual
       game (mole positions, pick, multiplier) instead of an empty board. */
    let lastDomRound = null;

    function publishReveal(rounds, outcome, mult, money) {
        reveal.rounds = rounds;
        reveal.outcome = outcome;
        reveal.mult = mult;
        reveal.gameId++;
        if (outcome === 'win') { reveal.wins++; reveal.multSum += mult; if (mult > reveal.bestMult) reveal.bestMult = mult; }
        if (outcome === 'bust') { reveal.losses++; }
        if (money) {
            if (typeof money.wager === 'number') reveal.wagered += money.wager;
            if (typeof money.payout === 'number') reveal.returned += money.payout;
            if (typeof money.payout === 'number' && money.payout > reveal.biggestPayout)
                reveal.biggestPayout = money.payout;
            if (money.currency) reveal.currency = money.currency;
        }
        if (outcome === 'win' || outcome === 'bust') {
            runLog.push({
                t: Date.now(),
                wager: money?.wager ?? lastWagerAccrued,
                payout: outcome === 'win' ? (money?.payout ?? 0) : 0,
                mult,
                outcome,
                pnl: reveal.returned - reveal.wagered,
                rows: rounds.length,
            });
            if (runLog.length > RUNLOG_MAX) runLog.shift();
        }
        if (money?.wager) lastWagerAccrued = money.wager;
    }

    const RUNLOG_MAX = 5000;
    const runLog = [];
    let lastWagerAccrued = 0;

    const tps = {
        timestamps: [],
        lastLatency: 0,
        push(latency) {
            const now = performance.now();
            this.lastLatency = latency;
            this.timestamps.push(now);
            const cutoff = now - 5000;
            while (this.timestamps.length && this.timestamps[0] < cutoff) this.timestamps.shift();
        },
        rps() {
            const now = performance.now();
            const cutoff = now - 5000;
            while (this.timestamps.length && this.timestamps[0] < cutoff) this.timestamps.shift();
            const span = Math.min(5000, now - (this.timestamps[0] || now));
            return span > 0 ? (this.timestamps.length / span) * 1000 : 0;
        },
    };

    const state = {
        running: false,
        count: 0,
        baseBet: 0,
        currentBet: 0,
        stopReason: '',
        errCount: 0,
        lastErr: '',
    };

    function applyOutcomeToBet(outcome) {
        if (outcome === 'win') {
            if (cfg.resetOnWin || cfg.onWinPct === 0) state.currentBet = state.baseBet;
            else state.currentBet = state.currentBet * (1 + cfg.onWinPct / 100);
        } else if (outcome === 'bust') {
            if (cfg.resetOnLoss || cfg.onLossPct === 0) state.currentBet = state.baseBet;
            else state.currentBet = state.currentBet * (1 + cfg.onLossPct / 100);
        }
        const floor = Math.max(1e-8, state.baseBet * 1e-4);
        const ceil = Math.max(state.baseBet * 1e6, 1e9);
        if (!Number.isFinite(state.currentBet) || state.currentBet < floor) state.currentBet = floor;
        if (state.currentBet > ceil) state.currentBet = ceil;
        const betInput = document.querySelector('#moles-master-container input[data-k="amount"]');
        if (betInput) betInput.value = Number(state.currentBet.toPrecision(8));
    }

    function checkStopConditions() {
        const pnl = reveal.returned - reveal.wagered;
        if (cfg.stopWin > 0 && pnl >= cfg.stopWin) { state.running = false; state.stopReason = 'stop-win'; return true; }
        if (cfg.stopLoss > 0 && pnl <= -cfg.stopLoss) { state.running = false; state.stopReason = 'stop-loss'; return true; }
        return false;
    }

    const martingaleActive = () => !!(cfg.onWinPct || cfg.onLossPct || cfg.resetOnWin || cfg.resetOnLoss);

    let lastUiPaint = 0;
    function paintStatus() {
        const now = performance.now();
        if (now - lastUiPaint < 100) return;
        lastUiPaint = now;
        const target = cfg.rounds ? `/${cfg.rounds}` : '';
        if (cfg.mode === 'api') {
            const rps = tps.rps();
            ui.status.textContent =
                `RUNNING · ${state.count}${target} · ${rps.toFixed(1)}/s · ${tps.lastLatency | 0}ms`;
            updateLockSub(`round ${state.count}${target} · ${rps.toFixed(1)}/s`);
        } else {
            ui.status.textContent = `RUNNING · ${state.count}${target}`;
            updateLockSub(`round ${state.count}${target}`);
        }
    }

    async function domLoop() {
        while (state.running && (cfg.rounds === 0 || state.count < cfg.rounds)) {
            try {
                const outcome = await domRound();
                state.count++;
                // Feed the outcome into the bet strategy + stop conditions, the
                // same as API mode — DOM mode used to ignore both.
                if (outcome === 'win' || outcome === 'bust') {
                    applyOutcomeToBet(outcome);
                    if (checkStopConditions()) break;
                }
                paintStatus();
                await sleep(jitter());
            } catch (e) {
                if (e.message === 'stopped') break;
                log('round err', e);
                await sleep(1500);
            }
        }
    }

    async function apiTurboLoop() {
        const userConc = martingaleActive() ? 1 : Math.max(1, cfg.concurrency | 0);
        const startConc = rateLimiter.effectiveConcurrency(userConc);
        const workers = [];
        for (let w = 0; w < startConc; w++) {
            workers.push((async () => {
                while (state.running && (cfg.rounds === 0 || state.count < cfg.rounds)) {
                    try {
                        const latency = await apiRound();
                        state.count++;
                        tps.push(latency);
                        paintStatus();
                        const adaptive = rateLimiter.adaptiveSleep();
                        const sleepMs = Math.max(cfg.apiDelayMs || 0, adaptive);
                        if (sleepMs > 0) await sleep(sleepMs);
                    } catch (e) {
                        if (e.message === 'stopped') break;
                        state.errCount++;
                        state.lastErr = e.message || String(e);
                        log('round err', state.lastErr);
                        if (state.errCount >= 20) {
                            state.running = false;
                            state.stopReason = 'errors: ' + state.lastErr;
                            break;
                        }
                        const isRate = /429/.test(state.lastErr);
                        await sleep(isRate ? 600 : 150);
                    }
                }
            })());
        }
        await Promise.all(workers);
    }

    async function loop() {
        ui.root.classList.add('is-running');
        if (!cfg.turbo) lockBoard(true);
        tps.timestamps.length = 0; tps.lastLatency = 0;
        reveal.rounds = []; reveal.outcome = 'idle'; reveal.mult = 0;
        reveal.gameId = 0; reveal.wins = 0; reveal.losses = 0; reveal.bestMult = 0;
        reveal.wagered = 0; reveal.returned = 0; reveal.biggestPayout = 0; reveal.multSum = 0;
        reveal.currency = '';
        state.baseBet = cfg.amount;
        state.currentBet = cfg.amount;
        state.stopReason = '';
        balanceStartedAt = readPageBalance();
        history.length = 0; lastHistoryGameId = -1;
        runLog.length = 0;
        lastWagerAccrued = 0;
        rateLimiter.recent429.length = 0; rateLimiter.scale = 1.0; rateLimiter.backoffUntil = 0;
        lastFetchObserved = performance.now();

        syncCurrency();

        if (cfg.mode === 'api' && !apiIsReady()) {
            state.running = false;
            ui.status.textContent = 'NEEDS TOKENS · click Play once manually on the live game';
            ui.btn.textContent = 'Start';
            ui.btn.classList.remove('stop'); ui.btn.classList.add('start');
            ui.root.classList.remove('is-running');
            unlockBoard();
            return;
        }

        if (cfg.mode === 'api') await prewarmConnection();

        if (cfg.mode === 'manual') { state.running = false; return; }
        if (cfg.mode === 'api') await apiTurboLoop();
        else await domLoop();
        state.running = false;
        ui.btn.textContent = 'Start';
        ui.btn.classList.remove('stop'); ui.btn.classList.add('start');
        const reason = state.stopReason
            ? state.stopReason === 'stop-win' ? ' · STOP-WIN HIT'
                : state.stopReason === 'stop-loss' ? ' · STOP-LOSS HIT'
                    : ' · ' + state.stopReason.toUpperCase()
            : '';
        ui.status.textContent = `STOPPED · ${state.count} rounds${reason}`;
        ui.root.classList.remove('is-running');
        unlockBoard();
        // (9) Audible cue on terminal stop reasons.
        if (cfg.audio !== false) {
            if (state.stopReason === 'stop-win') beep('win');
            else if (state.stopReason === 'stop-loss') beep('bust');
        }
    }

    /* =========================================================
    UI build
    ========================================================= */
    const ui = {};
    function buildUI() {
        if (document.getElementById('moles-master-container')) return;

        const root = document.createElement('div');
        root.id = 'moles-master-container';
        root.innerHTML = `
            <div class="hud-header" data-drag>
                <div>
                    <h2>Moles Autoplay</h2>
                    <div class="hud-target-text">${location.host}</div>
                </div>
                <button class="hud-collapse" data-act="collapse" title="Collapse">–</button>
            </div>
            <div class="hud-body">
                <div class="mode-wrap" role="tablist">
                    <button class="mode-btn" data-mode="manual">Manual</button>
                    <button class="mode-btn" data-mode="dom">DOM</button>
                    <button class="mode-btn" data-mode="api">API</button>
                </div>

                <!-- Primary bet controls — surfaced at the top so the user
                     never has to scroll or switch tabs to change their bet. -->
                <div class="hud-panel hud-panel-primary">
                    <div class="hud-grid-2">
                        <div class="hud-control-group" data-tip="Your wager per round. Martingale adjustments multiply from this base.">
                            <label>Bet amount <span class="hud-currency-hint" data-currency-hint>${cfg.currency || ''}</span></label>
                            <input data-k="amount" type="number" step="0.01" min="0" class="hud-input-prominent">
                        </div>
                        <div class="hud-control-group" data-tip="Number of moles to reveal per row. More moles = higher multiplier but higher bust risk.">
                            <label>Moles <span style="opacity:.6">1-6</span></label>
                            <input data-k="molesCount" type="number" min="1" max="6" class="hud-input-prominent">
                        </div>
                    </div>
                    <div class="hud-bet-quick">
                        <button type="button" class="bet-quick-btn" data-bet-mult="0.5">½</button>
                        <button type="button" class="bet-quick-btn" data-bet-mult="2">2×</button>
                        <button type="button" class="bet-quick-btn" data-bet-reset>RESET</button>
                    </div>
                </div>

                <!-- Run controls shared by DOM + API modes. These used to be
                     duplicated in each mode's panel, so a value set in one mode
                     did not show when you switched to the other while cfg kept
                     the old number. One shared control keeps display and cfg
                     in sync. -->
                <div class="hud-panel" data-run-only>
                    <div class="hud-grid-2">
                        <div class="hud-control-group" data-tip="Total rounds to play. Set to 0 for infinite — stops only on stop-win/loss.">
                            <label>Rounds <span style="opacity:.6">0=∞</span></label>
                            <input data-k="rounds" type="number" min="0">
                        </div>
                        <div class="hud-control-group" data-tip="How many rows to clear before cashing out each round.">
                            <label>Picks / round</label>
                            <input data-k="picksPerRound" type="number" min="1" max="24">
                        </div>
                    </div>
                </div>

                <div class="hud-panel" data-dom-only>
                    <div class="hud-grid-2">
                        <div class="hud-control-group" data-tip="Minimum random delay between rounds in DOM mode (milliseconds).">
                            <label>Min delay <span style="opacity:.6">ms</span></label>
                            <input data-k="minDelayMs" type="number" min="0">
                        </div>
                        <div class="hud-control-group" data-tip="Maximum random delay between rounds in DOM mode (milliseconds).">
                            <label>Max delay <span style="opacity:.6">ms</span></label>
                            <input data-k="maxDelayMs" type="number" min="0">
                        </div>
                    </div>
                </div>

                <div class="hud-panel" data-strategy-panel>
                    <div class="hud-control-group">
                        <label>Strategy <span style="opacity:.6">0 = off</span></label>
                    </div>
                    <div class="hud-grid-2">
                        <div class="hud-control-group" data-tip="Stop and lock in profit when total P/L reaches this amount. Set 0 to disable.">
                            <label>Stop win <span style="opacity:.6">+P/L</span></label>
                            <input data-k="stopWin" type="number" step="0.01" min="0">
                        </div>
                        <div class="hud-control-group" data-tip="Stop and cut losses when total P/L drops by this amount. Set 0 to disable.">
                            <label>Stop loss <span style="opacity:.6">−P/L</span></label>
                            <input data-k="stopLoss" type="number" step="0.01" min="0">
                        </div>
                        <div class="hud-control-group" data-tip="Multiply bet by (100+n)% after a win. 0 resets to base bet. E.g. 50 = +50%.">
                            <label>On win <span style="opacity:.6">%</span></label>
                            <input data-k="onWinPct" type="number" step="1">
                        </div>
                        <div class="hud-control-group" data-tip="Multiply bet by (100+n)% after a loss (Martingale). 0 resets to base bet. E.g. 100 = double.">
                            <label>On loss <span style="opacity:.6">%</span></label>
                            <input data-k="onLossPct" type="number" step="1">
                        </div>
                    </div>
                    <div class="hud-check-row" data-tip="After a win, snap the bet back to your original base bet amount.">
                        <label for="moles-reset-on-win">Reset bet on win</label>
                        <label class="hud-toggle">
                            <input id="moles-reset-on-win" data-k="resetOnWin" type="checkbox">
                            <span class="hud-toggle-track"><span class="hud-toggle-thumb"></span></span>
                        </label>
                    </div>
                    <div class="hud-check-row" data-tip="After a loss, snap the bet back to your original base bet amount.">
                        <label for="moles-reset-on-loss">Reset bet on loss</label>
                        <label class="hud-toggle">
                            <input id="moles-reset-on-loss" data-k="resetOnLoss" type="checkbox">
                            <span class="hud-toggle-track"><span class="hud-toggle-thumb"></span></span>
                        </label>
                    </div>
                </div>

                <div class="hud-panel" data-api-only>
                    <div class="hud-control-group" data-tip="Bypasses the game UI and calls Stake's API directly. Fastest possible autoplay — no click delays.">
                        <label>API status <span style="opacity:.6">network-bound</span></label>
                        <div class="hud-api-status" data-api-status>checking…</div>
                    </div>
                    <div class="hud-grid-2">
                        <div class="hud-control-group" data-tip="How many bets to fire simultaneously. Higher = faster rounds/sec but may trigger rate limits.">
                            <label>Multi bet</label>
                            <input data-k="concurrency" type="number" min="1" max="16">
                        </div>
                        <div class="hud-control-group" data-tip="Minimum pause between API bets in milliseconds. Use to avoid rate limits. 0 = as fast as possible.">
                            <label>Delay / bet <span style="opacity:.6">ms</span></label>
                            <input data-k="apiDelayMs" type="number" min="0">
                        </div>
                        <div class="hud-control-group" data-tip="Token used for betting, e.g. sweeps or gold. Must match your account's active currency.">
                            <label>Currency</label>
                            <input data-k="currency" type="text" style="background:var(--hud-input);border:1px solid var(--hud-input-border);color:var(--hud-text);padding:5px 6px;border-radius:7px;font-size:12px;font-weight:700;text-align:center;outline:none;width:100%">
                        </div>
                        <div class="hud-control-group" data-tip="Skip hit animations and intermediate updates — only show final results for maximum speed.">
                            <label>Turbo mode</label>
                            <label class="hud-toggle">
                                <input id="moles-turbo" data-k="turbo" type="checkbox">
                                <span class="hud-toggle-track"><span class="hud-toggle-thumb"></span></span>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="hud-panel" data-manual-only>
                    <div class="hud-control-group">
                        <label>Amount</label>
                        <div style="display:flex;gap:4px;align-items:center">
                            <input data-manual-amount type="number" step="0.01" min="0" class="hud-input-prominent" style="flex:1">
                            <button type="button" class="bet-quick-btn" data-manual-halve>½</button>
                            <button type="button" class="bet-quick-btn" data-manual-double>2×</button>
                        </div>
                    </div>
                    <div class="hud-control-group">
                        <label>Moles</label>
                        <select data-manual-moles style="background:var(--hud-input);border:1px solid var(--hud-input-border);color:var(--hud-text);padding:5px 6px;border-radius:7px;font-size:12px;width:100%;outline:none">
                            <option>1</option><option>2</option><option>3</option>
                            <option>4</option><option>5</option><option>6</option>
                        </select>
                    </div>
                    <div class="btn-group" style="margin-top:6px">
                        <button type="button" class="hud-rapid-btn start" data-manual-play style="font-size:14px;padding:10px 0">Play</button>
                        <button type="button" class="hud-rapid-btn stop" data-manual-cashout style="display:none;font-size:14px;padding:10px 0">Cashout</button>
                    </div>
                    <div class="btn-group" style="margin-top:5px">
                        <button type="button" class="hud-reset-btn" data-manual-random style="font-size:13px;padding:9px 0;width:100%">Random Pick</button>
                    </div>
                    <div class="hud-control-group" style="margin-top:4px">
                        <label style="opacity:.6;font-size:10px" data-manual-profit></label>
                    </div>
                </div>

                <div class="status-bar" data-status>IDLE</div>

                <div class="btn-group" data-autoplay-btns>
                    <button class="hud-rapid-btn start" data-act="toggle">Start</button>
                    <button class="hud-reset-btn" data-act="reset" title="Reset round counter">Reset</button>
                </div>
            </div>
        `;

        // Some mobile layouts drop .game-sidebar entirely; fall back to a
        // floating panel rather than silently building no HUD at all.
        const sidebar = document.querySelector('.game-sidebar');
        if (sidebar) {
            if (getComputedStyle(sidebar).position === 'static') sidebar.style.position = 'relative';
            sidebar.appendChild(root);
        } else {
            root.style.position = 'fixed';
            root.style.top = '12px';
            root.style.right = '12px';
            root.style.width = 'min(300px, 92vw)';
            root.style.maxHeight = '72vh';
            document.body.appendChild(root);
        }
        ui.root = root;
        ui.btn = root.querySelector('[data-act="toggle"]');
        ui.status = root.querySelector('[data-status]');

        root.querySelectorAll('[data-k]').forEach(inp => {
            const k = inp.dataset.k;
            if (inp.type === 'checkbox') inp.checked = !!cfg[k];
            else inp.value = cfg[k];
            inp.addEventListener('change', () => {
                const v = inp.type === 'checkbox' ? inp.checked
                        : inp.type === 'number' ? Number(inp.value)
                            : inp.value;
                cfg[k] = v; saveCfg();
            });
            if (inp.type === 'number' || inp.type === 'text') {
                inp.addEventListener('input', () => {
                    const v = inp.type === 'number' ? Number(inp.value) : inp.value;
                    cfg[k] = v;
                });
            }
        });

        const apiPanel = root.querySelector('[data-api-only]');
        const apiStatusEl = root.querySelector('[data-api-status]');
        const manualPanel = root.querySelector('[data-manual-only]');
        const autoplayBtns = root.querySelector('[data-autoplay-btns]');
        const primaryPanel = root.querySelector('.hud-panel-primary');
        const refreshMode = () => {
            root.querySelectorAll('.mode-btn').forEach(b =>
                b.classList.toggle('active', b.dataset.mode === cfg.mode));
            const isManual = cfg.mode === 'manual';
            apiPanel.style.display = cfg.mode === 'api' ? '' : 'none';
            root.querySelectorAll('[data-dom-only]').forEach(el => {
                el.style.display = cfg.mode === 'dom' ? '' : 'none';
            });
            // Shared run controls (rounds + picks) show for both auto modes.
            root.querySelectorAll('[data-run-only]').forEach(el => {
                el.style.display = isManual ? 'none' : '';
            });
            manualPanel.style.display = isManual ? '' : 'none';
            autoplayBtns.style.display = isManual ? 'none' : '';
            if (primaryPanel) primaryPanel.style.display = isManual ? 'none' : '';
            const stratPanel = root.querySelector('[data-strategy-panel]');
            if (stratPanel) stratPanel.style.display = isManual ? 'none' : '';
        };
        function paintApiStatus() {
            if (!apiStatusEl) return;
            const ready = apiIsReady();
            const label = apiReadyLabel();
            apiStatusEl.textContent = label;
            apiStatusEl.dataset.state = ready ? 'ok' : 'wait';
        }
        setInterval(paintApiStatus, 1000);
        paintApiStatus();
        root.querySelectorAll('.mode-btn').forEach(b => {
            b.addEventListener('click', () => { cfg.mode = b.dataset.mode; saveCfg(); refreshMode(); });
        });
        refreshMode();
        const betInput = root.querySelector('input[data-k="amount"]');
        const setBet = (v) => {
            if (!betInput || !Number.isFinite(v) || v < 0) return;
            betInput.value = Number(v.toPrecision(8));
            cfg.amount = Number(betInput.value);
            saveCfg();
        };
        root.querySelectorAll('.bet-quick-btn[data-bet-mult]').forEach(b => {
            b.addEventListener('click', () => {
                const m = parseFloat(b.dataset.betMult);
                const cur = parseFloat(betInput.value) || cfg.amount || 0;
                setBet(cur * m);
            });
        });
        const resetBtn = root.querySelector('.bet-quick-btn[data-bet-reset]');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => setBet(defaults.amount));
        }
        setInterval(() => {
            const hint = root.querySelector('[data-currency-hint]');
            if (hint && hint.textContent !== (cfg.currency || '')) {
                hint.textContent = cfg.currency || '';
            }
        }, 1500);

        ui.btn.addEventListener('click', () => {
            state.running = !state.running;
            if (state.running) {
                state.count = 0;
                ui.btn.textContent = 'Stop';
                ui.btn.classList.remove('start'); ui.btn.classList.add('stop');
                ui.status.textContent = 'RUNNING…';
                loop();
            } else {
                ui.btn.textContent = 'Start';
                ui.btn.classList.remove('stop'); ui.btn.classList.add('start');
                ui.status.textContent = 'STOPPING…';
            }
        });

        root.querySelector('[data-act="reset"]').addEventListener('click', () => {
            state.count = 0;
            if (!state.running) ui.status.textContent = 'IDLE';
        });

        let lastClickedHole = -1;
        document.addEventListener('click', e => {
            const tile = e.target.closest('[data-testid^="game-tile-"]');
            if (tile) lastClickedHole = parseInt(tile.dataset.hole, 10);
        }, true);

        (function wireManualPanel() {
            const amtIn  = root.querySelector('[data-manual-amount]');
            const molSel = root.querySelector('[data-manual-moles]');
            const playBtn    = root.querySelector('[data-manual-play]');
            const cashoutBtn = root.querySelector('[data-manual-cashout]');
            const randomBtn  = root.querySelector('[data-manual-random]');
            const profitLbl  = root.querySelector('[data-manual-profit]');

            const gameAmt  = () => document.querySelector('[data-testid="input-game-amount"]');
            const gameMols = () => document.querySelector('[data-testid="game-moles-count"]');
            const gameBet  = () => document.querySelector(SEL.bet);
            const gameCash = () => document.querySelector(SEL.cashout);
            const gameRand = () => document.querySelector(SEL.random);
            const gameProfit = () => document.querySelector('[data-testid="profit-input"]');

            function syncFromGame() {
                const a = gameAmt(); if (a && document.activeElement !== amtIn) amtIn.value = a.value;
                const m = gameMols(); if (m) molSel.value = m.value;
                const p = gameProfit(); if (p && profitLbl) profitLbl.textContent = p.value ? 'Net: ' + p.value : '';
                const hasCashout = !!gameCash();
                playBtn.style.display   = hasCashout ? 'none' : '';
                cashoutBtn.style.display = hasCashout ? '' : 'none';
                randomBtn.disabled = !isEnabled(gameRand());
            }
            setInterval(() => { if (cfg.mode === 'manual') syncFromGame(); }, 300);

            function injectValue(el, val) {
                if (!el) return;
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
                    || Object.getOwnPropertyDescriptor((typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).HTMLInputElement.prototype, 'value')?.set;
                if (nativeInputValueSetter) nativeInputValueSetter.call(el, val);
                else el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }

            amtIn.addEventListener('change', () => { const a = gameAmt(); if (a) injectValue(a, amtIn.value); });
            amtIn.addEventListener('input',  () => { const a = gameAmt(); if (a) injectValue(a, amtIn.value); });

            root.querySelector('[data-manual-halve]').addEventListener('click', () => {
                const a = gameAmt(); if (!a) return;
                realClick(document.querySelector('[data-testid="amount-halve"]') || a);
            });
            root.querySelector('[data-manual-double]').addEventListener('click', () => {
                const a = gameAmt(); if (!a) return;
                realClick(document.querySelector('[data-testid="amount-double"]') || a);
            });

            molSel.addEventListener('change', () => {
                const m = gameMols();
                if (!m) return;
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
                if (nativeSetter) nativeSetter.call(m, molSel.value);
                else m.value = molSel.value;
                m.dispatchEvent(new Event('change', { bubbles: true }));
            });

            playBtn.addEventListener('click', () => { lastClickedHole = -1; const b = gameBet(); if (b) realClick(b); });
            cashoutBtn.addEventListener('click', () => { const b = gameCash(); if (b) realClick(b); });
            randomBtn.addEventListener('click', () => { const b = gameRand(); if (b && isEnabled(b)) realClick(b); });
        })();

        (function manualBoardMirror() {
            let lastSnapshot = '';

            function readMult() {
                const p = document.querySelector('[data-testid="profit-input"]');
                if (p && p.value) {
                    const n = parseFloat(p.value);
                    if (Number.isFinite(n) && n > 0) return n;
                }
                const cb = document.querySelector(SEL.cashout);
                if (cb) {
                    const m = cb.textContent.match(/([\d.]+)\s*×/);
                    if (m) return parseFloat(m[1]);
                }
                return 0;
            }

            setInterval(() => {
                // Manual mode owns the whole pipeline here (outcomes included).
                // DOM autoplay only borrows the board MIRROR — rounds, mole
                // positions, multiplier — so the lock overlay animates the real
                // game; its win/bust accounting lives in domRound, and
                // publishing outcomes from here too would double-count them.
                const domMirror = cfg.mode === 'dom';
                if (cfg.mode !== 'manual' && !domMirror) return;
                const tiles = [...document.querySelectorAll('[data-testid^="game-tile-"]')];
                if (!tiles.length) return;

                const snap = tiles.map(t => t.dataset.gameTileStatus + t.dataset.hole).join('|');
                if (snap === lastSnapshot) return;
                lastSnapshot = snap;

                const statuses = tiles.map(t => ({
                    hole: parseInt(t.dataset.hole, 10),
                    status: t.dataset.gameTileStatus || 'idle',
                }));

                const allIdle = statuses.every(s => s.status === 'idle');
                if (allIdle) {
                    // Autoplay resets the board between rounds; keep the settle
                    // frame domRound published instead of blanking it.
                    if (domMirror) { lastDomRound = null; return; }
                    reveal.rounds = [];
                    reveal.outcome = 'idle';
                    reveal.mult = 0;
                    reveal.gameId++;
                    return;
                }

                const hasCashout = !!document.querySelector(SEL.cashout);
                const hasBust = statuses.some(s => s.status === 'mole' || s.status === 'bust');
                const outcome = hasBust ? 'bust' : hasCashout ? 'live' : 'win';

                const molePositions = statuses.filter(s => s.status === 'mole').map(s => s.hole);
                const pick = lastClickedHole >= 0 ? lastClickedHole
                    : (statuses.find(s => s.status === 'selected')?.hole ?? -1);
                const hit = !molePositions.includes(pick);
                const mult = readMult();

                const round = { molePositions, pick, hit, multiplier: mult };

                if (domMirror) {
                    lastDomRound = round;
                    if (outcome === 'live') {
                        reveal.rounds = [round];
                        reveal.outcome = 'live';
                        reveal.mult = mult;
                        reveal.gameId++;
                    }
                    return;
                }

                const prevOutcome = reveal.outcome;
                if (outcome === 'live') {
                    reveal.rounds = [round];
                    reveal.outcome = 'live';
                    reveal.mult = mult;
                    reveal.gameId++;
                } else if (outcome === 'bust' && prevOutcome !== 'bust') {
                    publishReveal([round], 'bust', mult);
                } else if (outcome === 'win' && prevOutcome !== 'win') {
                    publishReveal([round], 'win', mult);
                } else {
                    reveal.rounds = [round];
                    reveal.gameId++;
                }
            }, 200);
        })();

        root.querySelector('[data-act="collapse"]').addEventListener('click', (e) => {
            e.stopPropagation();
            root.classList.toggle('collapsed');
            e.currentTarget.textContent = root.classList.contains('collapsed') ? '+' : '–';
        });

    }

    function makeDraggable(panel, handle) {
        let dragging = false, dx = 0, dy = 0;
        handle.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button, input, select')) return;
            dragging = true;
            const r = panel.getBoundingClientRect();
            dx = e.clientX - r.left; dy = e.clientY - r.top;
            handle.setPointerCapture(e.pointerId);
        });
        handle.addEventListener('pointermove', (e) => {
            if (!dragging) return;
            const x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - dx));
            const y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - dy));
            panel.style.left = x + 'px';
            panel.style.top = y + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        });
        handle.addEventListener('pointerup', () => dragging = false);
        handle.addEventListener('pointercancel', () => dragging = false);
    }

    /* =========================================================
    Boot — wait for the board to exist (SPA navigation safe)
    ========================================================= */
    function boot() {
        try {
            setMolesPageFlag(isOnMolesPage());
            console.log('%c[Moles]', 'color:#1A7CFF;font-weight:700', 'boot() reached, document.readyState =', document.readyState);
            buildUI();
            ensureOverlayMounted();
            console.log('%c[Moles]', 'color:#1A7CFF;font-weight:700', 'HUD mounted:', !!document.getElementById('moles-master-container'));
        } catch (e) {
            console.error('[Moles] boot error:', e);
        }
    }

    function ensureOverlayMounted() {
        if (document.getElementById('moles-board-lock')) return;
        const gameBoard = document.querySelector('[data-testid="game-moles"]');
        if (gameBoard) {
            const container = gameBoard.closest('.game-content.svelte-xd3lbs') ||
                             gameBoard.parentElement;
            if (container) {
                lockBoard(false);
                startGridRenderer();
                return;
            }
        }
        ensureOverlayMounted._t = (ensureOverlayMounted._t || 0) + 1;
        if (ensureOverlayMounted._t < 50) setTimeout(ensureOverlayMounted, 200);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    /* This tool re-mounts its own HUD on a timer, so unlike the other mobile
       tools it cannot be switched off by deleting the element — the dispatcher
       would lose the race and the HUD would come straight back. It has to read
       the toggle itself. */
    function molesEnabled() {
        try { return isToolIdEnabled('stake-moles'); } catch (e) { return true; }
    }

    new MutationObserver(() => {
        if (!isOnMolesPage() || !molesEnabled()) return;
        if (!document.getElementById('moles-master-container')) buildUI();
        if (!document.getElementById('moles-board-lock') &&
            document.querySelector('[data-testid="game-moles"]')) {
            lockBoard(state.running);
            if (!gridRafId) startGridRenderer();
        }
    }).observe(document.documentElement, { childList: true, subtree: true });

    function reattachHudToSidebar() {
        const hud = document.getElementById('moles-master-container');
        if (!hud) return;
        const sidebar = document.querySelector('.game-sidebar');
        if (!sidebar) return;
        // Inline styles outrank the phone media query, so only pin the desktop
        // geometry when there is actually a desktop-width sidebar to pin.
        if (window.innerWidth > 820) {
            sidebar.style.setProperty('min-height', '380px', 'important');
            sidebar.style.setProperty('max-height', '650px', 'important');
            sidebar.style.setProperty('height', '650px', 'important');
            sidebar.style.setProperty('--draggable-max-height', '650px');
            sidebar.style.setProperty('--game-content-height', '750px');
            const scrollable = sidebar.querySelector('.scrollable-content') || sidebar;
            if (scrollable) scrollable.style.setProperty('--max-scroll-height', '600px');
            const gameContent = document.querySelector('.game-content.svelte-xd3lbs');
            if (gameContent) {
                gameContent.style.setProperty('min-height', '650px', 'important');
                gameContent.style.setProperty('max-height', '650px', 'important');
                gameContent.style.setProperty('height', '650px', 'important');
            }
        }
        if (hud.parentElement === sidebar) return;
        if (getComputedStyle(sidebar).position === 'static') sidebar.style.position = 'relative';
        sidebar.appendChild(hud);
    }

    /* The bundle keeps this tool loaded across SPA navigation, so leaving the
       moles page has to undo everything we did to the shared game chrome:
       drop the CSS flag, clear the inline styles reattachHudToSidebar wrote,
       and take the HUD + overlay down. */
    function setMolesPageFlag(on) {
        const root = document.documentElement;
        if (on) root.setAttribute('data-moles-active', '1');
        else root.removeAttribute('data-moles-active');
    }

    function clearMolesLayout() {
        const sb = document.querySelector('.game-sidebar');
        if (sb) {
            ['position', 'zIndex', 'minWidth', 'width', 'flexShrink',
             'minHeight', 'maxHeight', 'height', 'overflow'].forEach(p => { sb.style[p] = ''; });
            sb.style.removeProperty('--draggable-max-height');
            sb.style.removeProperty('--game-content-height');
        }
        const gc = document.querySelector('.game-content.svelte-xd3lbs');
        if (gc) ['minHeight', 'maxHeight', 'height'].forEach(p => { gc.style[p] = ''; });
        const hud = document.getElementById('moles-master-container');
        if (hud) hud.remove();
        const lock = document.getElementById('moles-board-lock');
        if (lock) lock.remove();
        if (gridRafId) stopGridRenderer();
    }

    setInterval(() => {
        if (!isOnMolesPage() || !molesEnabled()) {
            if (document.documentElement.hasAttribute('data-moles-active')) {
                state.running = false;      // never keep autoplaying off-page
                setMolesPageFlag(false);
                clearMolesLayout();
            }
            return;
        }
        setMolesPageFlag(true);
        if (!document.getElementById('moles-master-container')) buildUI();
        reattachHudToSidebar();
        ensureOverlayMounted();
        relocateLockSide();
        if (!resizeObserver) setupResizeObserver();
    }, 500);

    window.addEventListener('unload', () => {
        if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
        if (resizeObserver) resizeObserver.disconnect();
    });
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

        // Stake / Shuffle: the DiceTool panel stitches in via the native-mode
        // integration. Nuts has no native Advanced bet mode or strategy editor,
        // so we build the same DiceTool panel and mount it into the Advanced IOW
        // (cond) tab ourselves (initNutsDiceBridge), driven by the condition
        // engine instead of the native editor.
        if (!isNuts()) {
            try { dt_init(); } catch (e) { console.error('[unified-mobile] dt_init failed:', e); }
            try { setupIowDiceIntegration(); } catch (e) { console.error('[unified-mobile] integration failed:', e); }
        } else {
            try { initNutsDiceBridge(); } catch (e) { console.error('[unified-mobile] nuts dice bridge failed:', e); }
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
            if (isOnSnakesPage() && isToolIdEnabled(toolIdForCurrentSite('snakes'))) {
                try { tool_snakes(); } catch (e) { console.error('[unified-mobile] tool_snakes failed:', e); }
            } else {
                const sk = document.getElementById('snakes-auto-gui');
                if (sk) sk.remove();
            }
            if (isOnMinesPage() && isToolIdEnabled(toolIdForCurrentSite('mines'))) {
                try { tool_mines(); markToolRan(toolIdForCurrentSite('mines')); } catch (e) { console.error('[unified-mobile] tool_mines failed:', e); }
            } else {
                const m = document.getElementById('mines-auto-gui');
                if (m) m.remove();
            }
            // Blackjack docks into the betting panel, which the site re-renders,
            // so it re-mounts itself on a timer and unmounts when its toggle is
            // off. Deleting the node here would just start a tug-of-war with it.
            if (isOnBlackjackPage() && isToolIdEnabled(toolIdForCurrentSite('blackjack'))) {
                try { tool_blackjack(); markToolRan(toolIdForCurrentSite('blackjack')); } catch (e) { console.error('[unified-mobile] tool_blackjack failed:', e); }
            }
            // Moles keeps its own timers and tears itself down; only boot it here.
            if (isOnMolesPage() && isToolIdEnabled('stake-moles')) {
                try { tool_moles(); markToolRan('stake-moles'); } catch (e) { console.error('[unified-mobile] tool_moles failed:', e); }
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
            /* Before the supported-page bail-out: this is what switches the
               Nuts dice speed-up back off when you navigate to another game. */
            try { refreshGameSpeed(); } catch (e) {}
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
            if (ACTIVE_MODE === 'cond') {
                /* The HUD no longer carries its own base-bet field, so the SITE's
                   wager box is the source of truth. Only adopt it while a run is
                   NOT in progress: during rapid fire the engine is itself writing
                   that box on every bet, and reading it back would feed the
                   escalated stake in as a new base and compound it away from the
                   strategy. The `condInp` branch remains for any build that still
                   renders the field. */
                const condInp = document.getElementById('h-cond-base');
                if (condInp) condBaseBet = parseCurrencyInput(condInp.value, minBaseBet);
                else if (!isRapidFiring) {
                    const nativeBet = getCurrentBet();
                    if (isFinite(nativeBet) && nativeBet >= minBaseBet) condBaseBet = nativeBet;
                }
                // The DiceTool panel builds asynchronously (document-ready), so
                // it may not have existed when the tab was first opened. Once it
                // shows up, mount it, build the Stats tab, and wire its controls.
                const dp = document.getElementById('dt-aio-panel');
                const hc = document.getElementById('hud-content');
                /* Sentinel for "the Stats tab is already built". It used to be
                   #h-cond-base — which was DELETED when the bet field was removed,
                   so this test became permanently true and the tab was rebuilt on
                   every 600ms tick, appending another command bar each time and
                   stacking five-plus copies of START / Conditions / O/U / RESET
                   down the panel. Key it on the command bar itself: it is the thing
                   ensureNutsStatsTab() lifts into the panel, so its presence is
                   exactly the condition being asked about. */
                if (dp && hc && (dp.parentElement !== hc || !dp.querySelector('.hud-cmd-bar'))) {
                    mountDicePanel();
                    if (ensureNutsStatsTab()) attachListeners();
                }
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
            startNutsBalanceWatcher();
            try { nutsBalanceBetCheck(); } catch (e) {}
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

    /* ---- Standalone stubs: loader hooks for tools not bundled in this build ---- */
    function isOnKenoPage() { return false; }
    function isOnMinesPage() { return false; }
    function isOnBlackjackPage() { return false; }
    function isOnSnakesPage() { return false; }
    function tool_snakes() {}
    function isOnAnyCasinoPage() { return false; }
    function tool_keno() {}
    function tool_mines() {}
    function tool_blackjack() {}
    function tool_autovault() {}
    function tool_stake_7day_tracker() {}
    function startShuffleObserver() {}
    function startShuffleFeedObserver() {}
    function startObserver() {}
    function dt_init() {}
    function initNutsDiceBridge() {}
    function refreshGameSpeed() {}
    function setupIowDiceIntegration() {}
    function buildHUD() {}
    function syncNativeHudElements() {}
    function updateUI() {}
    function startObserverWrapper() {}
    function monitorRapidFireHealth() {}
    function updateBetAmount() {}
    function stopRapidFire() {}
    function getCurrentBalance() { return 0; }
    function onShuffleBetResult() {}

})();
