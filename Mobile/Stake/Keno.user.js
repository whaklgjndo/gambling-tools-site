// ==UserScript==
// @name         Stake Keno — Mobile
// @namespace    http://tampermonkey.net/
// @version      6.02
// @description  Standalone single-tool mobile build, extracted from the unified mobile bundle.
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
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    try { console.log('[Stake Keno — Mobile] standalone build v6.02'); } catch (e) {}


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
        id: 'stake-keno', name: 'Stake Keno', group: 'Stake',
        description: 'Save / load tile-and-risk presets on Stake Keno.',
        matches: ['https://stake.com/casino/games/keno*', 'https://stake.us/casino/games/keno*',
                  'https://stake.bet/casino/games/keno*', 'https://stake.games/casino/games/keno*',
                  'https://staketr.com/casino/games/keno*', 'https://staketr2.com/casino/games/keno*',
                  'https://staketr3.com/casino/games/keno*', 'https://staketr4.com/casino/games/keno*',
                  'https://stake.bz/casino/games/keno*', 'https://stake.pet/casino/games/keno*'],
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
    function formatCurrencyInput(amount) {
        if (!isFinite(amount)) return '';
        return isNuts() ? formatBetForInput(amount) : amount.toFixed(2);
    }
    function currencyInputStep() {
        return isNuts() && !isUSDDisplayMode() ? '0.00000001' : '0.01';
    }
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
                // nuts.gg redesigned the tile from 2 children (span + cover) to 3
                // (span + cover div + hidden haptic input); match on the numbered
                // first <span> rather than a fixed child count. children[1] stays
                // the purple/gray cover for readPicksFromDOM.
                const byNum = new Map();
                for (const b of document.querySelectorAll('button')) {
                    const span = b.querySelector('span');
                    if (!span) continue;
                    const txt = (span.textContent || '').trim();
                    const n = parseInt(txt, 10);
                    if (n >= 1 && n <= 40 && txt === String(n) && !byNum.has(n)) byNum.set(n, b);
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
    function isOnMinesPage() { return false; }
    function isOnBlackjackPage() { return false; }
    function isOnMolesPage() { return false; }
    function isOnAnyCasinoPage() { return false; }
    function tool_mines() {}
    function tool_blackjack() {}
    function tool_moles() {}
    function tool_autovault() {}
    function tool_stake_7day_tracker() {}
    function startShuffleObserver() {}
    function startShuffleFeedObserver() {}
    function startObserver() {}
    function dt_init() {}
    function initNutsDiceBridge() {}
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
