// ==UserScript==
// @name         Nuts Blackjack — Mobile
// @namespace    http://tampermonkey.net/
// @version      6.06
// @description  Standalone single-tool mobile build, extracted from the unified mobile bundle.
// @author       .
// @match        https://nuts.gg/*
// @match        https://*.nuts.gg/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    try { console.log('[Nuts Blackjack — Mobile] standalone build v6.06'); } catch (e) {}


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

    register({
        id: 'nuts-blackjack', name: 'Nuts Blackjack', group: 'Nuts',
        description: 'Basic-strategy advisor with optional auto-play.',
        matches: ['https://nuts.gg/blackjack*', 'https://*.nuts.gg/blackjack*'],
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


    function isOnBlackjackPage() {
        const path = location.pathname || '';
        if (isShuffle()) return /games\/originals\/blackjack(?:\/|$|\?|#)/i.test(path);
        if (isNuts()) return /^\/blackjack(?:\/|$|\?|#)/i.test(path);
        return /casino\/games\/blackjack(?:\/|$|\?|#)/i.test(path);
    }

    /**
     * Perfect Blackjack — basic-strategy advisor + optional auto-player.
     *
     * The panel docks into the game's betting column, the same place the Moles
     * HUD lives, rather than floating over the table.
     *
     * Cards come from the site's own network payloads (authoritative: every
     * bet/hit/stand response carries the whole hand) and fall back to reading
     * the rendered board when no payload has arrived yet. The dealer's hole
     * card is never read — sites only send it once the hand is over, which is
     * also when we stop advising.
     *
     * Turn detection is button-driven: if HIT is enabled, it is the player's
     * turn. That one signal is stable across all three sites and saves us
     * modelling each site's per-hand `actions` list.
     *
     * Auto-play only ever presses buttons the site has already enabled, and
     * only once per distinct game state (see stateHash). Auto-deal is a
     * separate opt-in because it is the only path that wagers on its own.
     */
    function tool_blackjack() {
        'use strict';
        // The panel lives inside a container the site owns and re-renders, so
        // the ticker below must survive being detached. That makes it immortal,
        // which in turn means a second call would leave two tickers racing to
        // press the same button. Boot exactly once per page.
        if (tool_blackjack._booted) return;
        tool_blackjack._booted = true;

        // Shown in the panel title so the running build is verifiable at a
        // glance. Bump this whenever the tool body changes.
        var BJ_VERSION = '2.90';

        var PAGE_WIN = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;

        var isShuf = /shuffle\./i.test(location.hostname);
        var isNut  = /(^|\.)nuts\.gg$/i.test(location.hostname);
        var SITE    = isShuf ? 'Shuffle' : isNut ? 'Nuts' : 'Stake';
        var TOOL_ID = (isShuf ? 'shuffle' : isNut ? 'nuts' : 'stake') + '-blackjack';

        function isOnBjPage() {
            var p = location.pathname || '';
            if (isShuf) return /games\/originals\/blackjack(?:\/|$|\?|#)/i.test(p);
            if (isNut)  return /^\/blackjack(?:\/|$|\?|#)/i.test(p);
            return /casino\/games\/blackjack(?:\/|$|\?|#)/i.test(p);
        }

        /** The control panel's switch. Unknown ids read as enabled. */
        function bjEnabled() {
            try { return isToolIdEnabled(TOOL_ID); } catch (e) { return true; }
        }

        /* ---------------------------------------------------------------
           TABLE RULES — fixed per site, applied automatically.
           These are house rules, not user preferences, so the tool sets them
           from the site rather than asking. Sourced from each site's own
           published blackjack rules:
             Stake   — 8 decks,  dealer STANDS on soft 17, double after split,
                       one split (no re-split), no surrender.
             Shuffle — infinite decks, same rule set (help.shuffle.com).
             Nuts    — no public rule sheet found; defaults to the same and is
                       corrected here if its in-game rules differ.
           strafe/blackjackreview confirm Stake S17; Shuffle help centre
           confirms "Dealer always stands on 17", "Double any first 2", "Can
           double after split", "No re-splitting".
           --------------------------------------------------------------- */
        var SITE_RULES = {
            Stake:   { h17: false, das: true, resplit: false, decks: '8 decks',       verified: true },
            Shuffle: { h17: false, das: true, resplit: false, decks: 'infinite decks', verified: true },
            Nuts:    { h17: false, das: true, resplit: false, decks: '',               verified: false }
        };
        var RULES = SITE_RULES[SITE] || SITE_RULES.Stake;

        var CFG_KEY = 'bj-perfect-cfg-' + SITE.toLowerCase();
        var DEFAULTS = {
            delayMs: 700,
            collapsed: false,
            overlay: true
        };
        var cfg = DEFAULTS;
        try { cfg = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); }
        catch (e) { cfg = Object.assign({}, DEFAULTS); }
        // Rules always come from the site, never from stored config — they are
        // facts about the table, and letting a stale saved value override them
        // was how the advisor ended up reading the wrong strategy chart.
        cfg.h17 = RULES.h17; cfg.das = RULES.das; cfg.resplit = RULES.resplit;
        cfg.overlay = true;   // on-felt stats are always shown; no toggle for it
        function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) {} }

        /* ---------------------------------------------------------------
           STRATEGY ENGINE
           Cells transcribed from Blackjack Apprenticeship's S17 and H17
           basic-strategy charts:
             https://www.blackjackapprenticeship.com/blackjack-strategy-charts/
           Stake is an 8-deck shoe and Shuffle deals from an infinite shoe; for
           4+ decks the chart is identical, so one table set serves all three
           sites. The tables below hold the S17 chart, and the three cells H17
           changes (11 vs A, soft 18 vs 2, soft 19 vs 6) are patched inline.

           BJA's late-surrender rows are deliberately absent: none of the three
           sites offer surrender, so there is no button to press.

           Actions: H hit · S stand · D double-else-hit · Ds double-else-stand
                    P split · Ph split-if-DAS-else-hit
           Dealer upcard 2..10,A maps to index 0..9.
           --------------------------------------------------------------- */
        var HARD = {
            9:  ['H','D','D','D','D','H','H','H','H','H'],
            10: ['D','D','D','D','D','D','D','D','H','H'],
            11: ['D','D','D','D','D','D','D','D','D','H'],
            12: ['H','H','S','S','S','H','H','H','H','H'],
            13: ['S','S','S','S','S','H','H','H','H','H'],
            14: ['S','S','S','S','S','H','H','H','H','H'],
            15: ['S','S','S','S','S','H','H','H','H','H'],
            16: ['S','S','S','S','S','H','H','H','H','H']
        };
        var SOFT = {
            13: ['H','H','H','D','D','H','H','H','H','H'],
            14: ['H','H','H','D','D','H','H','H','H','H'],
            15: ['H','H','D','D','D','H','H','H','H','H'],
            16: ['H','H','D','D','D','H','H','H','H','H'],
            17: ['H','D','D','D','D','H','H','H','H','H'],
            18: ['S','Ds','Ds','Ds','Ds','S','S','H','H','H'],   // vs 2 stands under S17; H17 flips it to Ds
            19: ['S','S','S','S','S','S','S','S','S','S'],
            20: ['S','S','S','S','S','S','S','S','S','S']
        };
        var PAIRS = {
            2:  ['Ph','Ph','P','P','P','P','H','H','H','H'],
            3:  ['Ph','Ph','P','P','P','P','H','H','H','H'],
            4:  ['H','H','H','Ph','Ph','H','H','H','H','H'],
            6:  ['Ph','P','P','P','P','H','H','H','H','H'],
            7:  ['P','P','P','P','P','P','H','H','H','H'],
            8:  ['P','P','P','P','P','P','P','P','P','P'],
            9:  ['P','P','P','P','P','S','P','P','S','S'],
            10: ['S','S','S','S','S','S','S','S','S','S'],
            11: ['P','P','P','P','P','P','P','P','P','P']
        };

        function cardValue(rank) {
            if (rank == null) return 0;
            var r = String(rank).toUpperCase().trim();
            if (r === 'A' || r === 'ACE' || r === '1' || r === '11') return 11;
            if (r === 'K' || r === 'Q' || r === 'J' || r === 'T' ||
                r === 'KING' || r === 'QUEEN' || r === 'JACK') return 10;
            var n = parseInt(r, 10);
            return (n >= 2 && n <= 10) ? n : 0;
        }

        function handInfo(ranks) {
            var total = 0, aces = 0, i;
            for (i = 0; i < ranks.length; i++) {
                var v = cardValue(ranks[i]);
                total += v;
                if (v === 11) aces++;
            }
            while (total > 21 && aces > 0) { total -= 10; aces--; }
            var pair = ranks.length === 2 && cardValue(ranks[0]) === cardValue(ranks[1]);
            return {
                total: total,
                soft: aces > 0,
                // How many aces are still worth 11. The equity engine needs the
                // COUNT, not just "is it soft": a hand can hold two aces at
                // once (A,3,A = 11+3+1 = 15, still soft), and a boolean loses
                // that the second ace can absorb a later bust.
                aces: aces,
                pair: pair,
                pairRank: pair ? cardValue(ranks[0]) : 0,   // 11 for A,A
                busted: total > 21
            };
        }

        function dealerIdx(upRank) {
            var v = cardValue(upRank);
            return v === 11 ? 9 : v - 2;
        }

        function resolve(code, canDouble) {
            if (code === 'D')  return canDouble ? { action: 'DOUBLE', why: 'double, else hit' }
                                                : { action: 'HIT',    why: 'double unavailable' };
            if (code === 'Ds') return canDouble ? { action: 'DOUBLE', why: 'double, else stand' }
                                                : { action: 'STAND',  why: 'double unavailable' };
            if (code === 'S')  return { action: 'STAND', why: 'basic strategy' };
            return { action: 'HIT', why: 'basic strategy' };
        }

        function decide(ranks, up, canDouble, canSplit) {
            var h = handInfo(ranks);
            var di = dealerIdx(up);
            if (di < 0 || di > 9) return { action: '—', why: 'no dealer upcard' };
            if (h.busted)      return { action: 'STAND', why: 'busted' };
            if (h.total >= 21) return { action: 'STAND', why: h.total === 21 ? '21' : 'busted' };

            var code;
            // 5,5 is never split — it falls through and plays as a hard 10.
            if (h.pair && h.pairRank !== 5 && canSplit) {
                code = PAIRS[h.pairRank][di];
                if (code === 'P') return { action: 'SPLIT', why: 'pair chart' };
                if (code === 'Ph') {
                    if (cfg.das) return { action: 'SPLIT', why: 'pair chart (DAS)' };
                    code = 'H';
                }
                if (code === 'S') return { action: 'STAND', why: 'pair chart' };
                if (code === 'H') return { action: 'HIT',   why: 'pair chart' };
            }

            // Soft 12 (A,A that could not be split) can never bust on a hit,
            // so it is never a stand — the SOFT table only starts at 13.
            if (h.soft && h.total <= 12) return { action: 'HIT', why: 'soft ' + h.total };

            if (h.soft && h.total >= 13 && h.total <= 20) {
                code = SOFT[h.total][di];
                if (cfg.h17) {
                    if (h.total === 18 && di === 0) code = 'Ds';   // soft 18 vs 2
                    if (h.total === 19 && di === 4) code = 'Ds';   // soft 19 vs 6
                }
                return resolve(code, canDouble);
            }

            var t = h.total;
            if (t <= 8)  return { action: 'HIT',   why: 'hard ' + t };
            if (t >= 17) return { action: 'STAND', why: 'hard ' + t };
            code = HARD[t][di];
            if (cfg.h17 && t === 11 && di === 9) code = 'D';       // 11 vs A
            return resolve(code, canDouble);
        }

        /* ---------------------------------------------------------------
           WIN-PROBABILITY ENGINE
           Exact infinite-deck equity (Stake is 8-deck, Shuffle infinite; the
           difference is negligible for a live read-out). Models the dealer
           drawing to completion and the player following optimal hit/stand,
           then reports P(win) / P(push) / P(lose) for the hand as it stands.
           Peek-conditioned: once a hand proceeds past a dealer ace or ten, the
           hole card is known not to be a natural, so those are excluded.
           --------------------------------------------------------------- */
        var DRAWS = (function () {
            var d = [], v;
            for (v = 2; v <= 9; v++) d.push({ add: v, soft: false, p: 1 / 13 });
            d.push({ add: 10, soft: false, p: 4 / 13 });   // 10 / J / Q / K
            d.push({ add: 11, soft: true,  p: 1 / 13 });   // ace
            return d;
        })();

        /* A dealer hand is (total, aces) — the number of aces still worth 11 —
           NOT a soft/hard boolean. With a boolean, A,A collapses to a "hard" 12
           and the second ace can never absorb a later bust, so multi-ace dealer
           hands were counted as busts that do not happen: with an ACE UP the
           dealer's bust chance came out 13.83% against a true 11.53%, and the
           win probability shown next to a dealer ace was inflated by that whole
           2.3-point gap. (Verified against the published infinite-deck table:
           2 .3536, 3 .3739, 4 .3945, 5 .4164, 6 .4232, 7 .2623, 8 .2447,
           9 .2284, 10 .2121, A .1153.) Reduce at the top of rec() so the memo
           key is always the reduced hand. */
        function dealerDist(upRank, h17) {
            var memo = {};
            function rec(total, aces) {
                while (total > 21 && aces > 0) { total -= 10; aces--; }
                if (total > 21) return { bust: 1 };
                var soft17 = total === 17 && aces > 0;
                if (total >= 17 && !(soft17 && h17)) { var s = {}; s[total] = 1; return s; }
                var key = total + '|' + aces;
                if (memo[key]) return memo[key];
                var dist = {}, i;
                for (i = 0; i < DRAWS.length; i++) {
                    var dr = DRAWS[i];
                    var sub = rec(total + dr.add, aces + (dr.soft ? 1 : 0));
                    for (var k in sub) dist[k] = (dist[k] || 0) + dr.p * sub[k];
                }
                memo[key] = dist;
                return dist;
            }
            var up = cardValue(upRank), aces0 = up === 11 ? 1 : 0;
            var excl = up === 11 ? 10 : (up === 10 ? 11 : null);   // the blackjack hole
            var norm = excl == null ? 1 : 1 - (excl === 10 ? 4 / 13 : 1 / 13);
            var dist = {}, i;
            for (i = 0; i < DRAWS.length; i++) {
                var dr = DRAWS[i];
                if (excl != null && dr.add === excl) continue;
                var sub = rec(up + dr.add, aces0 + (dr.soft ? 1 : 0));
                for (var k in sub) dist[k] = (dist[k] || 0) + (dr.p / norm) * sub[k];
            }
            return dist;
        }

        function standEquity(playerTotal, dealerUp, h17) {
            var dd = dealerDist(dealerUp, h17), win = 0, push = 0, lose = 0;
            for (var k in dd) {
                var p = dd[k];
                if (k === 'bust') { win += p; continue; }
                var dt = +k;
                if (dt < playerTotal) win += p; else if (dt === playerTotal) push += p; else lose += p;
            }
            return { win: win, push: push, lose: lose };
        }

        var eqMemo = {};
        /* Ace-counted like dealerDist above, and for the same reason: the player
           can hold two aces at once too (A,3,A is a soft 15), and a boolean threw
           the spare ace away — understating every multi-ace continuation. */
        function bestEquity(total, aces, dealerUp, h17) {
            while (total > 21 && aces > 0) { total -= 10; aces--; }
            if (total > 21) return { win: 0, push: 0, lose: 1 };
            var st = standEquity(total, dealerUp, h17);
            if (total >= 21) return st;
            var key = total + '|' + aces + '|' + dealerUp + '|' + (h17 ? 1 : 0);
            if (eqMemo[key]) return eqMemo[key];
            eqMemo[key] = st;                     // break any recursion cycle
            var hw = 0, hp = 0, hl = 0, i;
            for (i = 0; i < DRAWS.length; i++) {
                var dr = DRAWS[i];
                var eq = bestEquity(total + dr.add, aces + (dr.soft ? 1 : 0), dealerUp, h17);
                hw += dr.p * eq.win; hp += dr.p * eq.push; hl += dr.p * eq.lose;
            }
            var hit = { win: hw, push: hp, lose: hl };
            var chosen = (hit.win - hit.lose) > (st.win - st.lose) ? hit : st;
            eqMemo[key] = chosen;
            return chosen;
        }

        /** P(win/push/lose) for the player's hand against the dealer's upcard,
         *  under optimal hit/stand. Recomputed as each card is dealt. */
        function handEquity(playerCards, dealerUp, h17) {
            var info = handInfo(playerCards);
            if (info.busted) return { win: 0, push: 0, lose: 1 };
            var di = dealerIdx(dealerUp);
            if (di < 0 || di > 9) return null;
            eqMemo = {};
            return bestEquity(info.total, info.aces, dealerUp, h17);
        }

        /* ---------------------------------------------------------------
           CARD EXTRACTION — network (authoritative)
           Every site returns the whole hand on each action, so instead of
           binding to one schema we search the response for any node holding
           both `player` and `dealer` whose shapes look like cards. Mirrors
           the 7-day tracker's approach of walking the payload generically.
           --------------------------------------------------------------- */
        var RANK_RE = /^(10|[23456789]|[AJQKT])$/i;

        function rankOfCard(c) {
            if (c == null) return null;
            if (typeof c === 'string') {
                // Strip suit glyphs so suit-first strings parse too: Nuts sends
                // suit-then-rank ("<spade>7", "<diamond>10", "<club>J"); Shuffle
                // sends rank-first ("10DIAMONDS"). Both leave the rank at the
                // front after the glyphs are removed. Escapes = spade/club/heart/diamond.
                var s = c.trim().toUpperCase().replace(/[♠♣♥♦]/g, '');
                var m = s.match(/^(10|[23456789AJQKT])/);
                return m ? (m[1] === 'T' ? '10' : m[1]) : null;
            }
            if (typeof c === 'object') {
                // A HAND is not a card. Stake sends both sides as
                // [{value, actions, cards:[...]}], where `value` is the hand
                // TOTAL — and a total of 2..10 reads as a perfectly valid rank
                // string, so `c.value` below silently turned a whole hand into
                // one phantom card of that rank. A two-card hard 10 became a
                // single "10": cards.length stopped being 2, canDouble went
                // false, and EVERY hard 9 and hard 10 hit instead of doubling
                // (10 vs 9, 10 vs 5, 5,5 …). It also swallowed low pairs
                // (2,2 / 3,3 / 4,4 never split) and collapsed a split's two
                // hands into one bogus hand, because the same coincidence fires
                // per hand object. Refuse anything that owns a card list or an
                // action list: only a real card reaches the rank probe.
                if (Array.isArray(c.cards) || Array.isArray(c.actions)) return null;
                var cand = c.rank != null ? c.rank
                         : c.card != null ? c.card
                         : c.name != null ? c.name
                         : c.value;
                if (cand == null || typeof cand === 'object') return null;
                var r = String(cand).trim().toUpperCase();
                if (RANK_RE.test(r)) return r === 'T' ? '10' : r;
                return null;
            }
            return null;
        }

        function cardsOf(node) {
            if (!node) return null;
            var arr = Array.isArray(node) ? node
                    : Array.isArray(node.cards) ? node.cards
                    : null;
            if (!arr) return null;
            var out = [], i;
            for (i = 0; i < arr.length; i++) {
                var r = rankOfCard(arr[i]);
                if (r) out.push(r);
            }
            return out.length ? out : null;
        }

        /** Player side may be one hand or a list of hands (post-split). */
        function handsOf(node) {
            if (!node) return null;
            var direct = cardsOf(node);
            if (direct) return [{ cards: direct, raw: node }];
            if (Array.isArray(node)) {
                var hands = [], i;
                for (i = 0; i < node.length; i++) {
                    var c = cardsOf(node[i]);
                    if (c) hands.push({ cards: c, raw: node[i] });
                }
                return hands.length ? hands : null;
            }
            return null;
        }

        function normalizeState(node) {
            // The dealer, like the player, can arrive as a single hand-object
            // OR as an array wrapping one hand-object (Stake: dealer:[{value,
            // actions, cards:[...]}]) — never as a bare array of raw cards.
            // Reading it with plain cardsOf() only "succeeds" by coincidence,
            // when the dealer shows exactly one card whose numeric value
            // happens to also read as a valid rank string (2-10); the moment
            // the dealer reveals its hole card or draws further, .value becomes
            // a multi-card total (17, 22, ...) that never matches a rank, so
            // parsing silently failed and the tool fell back to comparing the
            // player's FINAL hand against the dealer's frozen up-card alone —
            // which looks like a win almost every time. handsOf() already has
            // the correct array-of-hand-objects unwrap (used for the player
            // side); reuse it here and take the dealer's one hand from it.
            var dealerHands = handsOf(node.dealer);
            var dealer = dealerHands && dealerHands.length ? dealerHands[0].cards : null;
            var hands  = handsOf(node.player);
            if (!dealer || !dealer.length || !hands || !hands.length) return null;
            return { dealer: dealer, hands: hands, source: 'net', at: Date.now() };
        }

        /* The wager and payout do not live on the state node — they sit on the
           object that OWNS it (Stake: { id, active, amount, payout,
           payoutMultiplier, state: { player, dealer } }). So the walk carries
           the parent down and reads the money off whichever of the two has it. */
        var MONEY_KEYS = ['amount', 'payout', 'payoutMultiplier', 'currency',
                          'active', 'id', 'iid', 'profit'];

        function moneyOf(node) {
            if (!node || typeof node !== 'object') return null;
            var out = null, i, k;
            for (i = 0; i < MONEY_KEYS.length; i++) {
                k = MONEY_KEYS[i];
                if (Object.prototype.hasOwnProperty.call(node, k) && typeof node[k] !== 'object') {
                    out = out || {};
                    out[k] = node[k];
                }
            }
            if (!out) return null;
            var useful = ('amount' in out) || ('payout' in out) ||
                         ('payoutMultiplier' in out) || ('active' in out);
            return useful ? out : null;
        }

        /** Does the acting player hand expose available moves? Only the live
         *  game does; a settled bet from the feed has none. */
        function handHasActions(node) {
            var p = Array.isArray(node.player) ? node.player[0] : node.player;
            return !!(p && typeof p === 'object' && Array.isArray(p.actions) && p.actions.length);
        }

        /* Collect EVERY blackjack state in the payload, not just the first.
           Stake's bet feeds (AllHouseBets / MyBetList) carry many, and each is
           a real player+dealer node — indistinguishable from the game to a
           first-match walker, which is why the tracker was counting strangers'
           hands and your own history. */
        function collectBjStates(o, depth, owner, acc, feed) {
            if (!o || typeof o !== 'object' || depth > 8) return;
            if (Object.prototype.hasOwnProperty.call(o, 'player') &&
                Object.prototype.hasOwnProperty.call(o, 'dealer')) {
                var st = normalizeState(o);
                if (st) {
                    st.bet = moneyOf(owner) || moneyOf(o) || null;

                    // --- Nuts (nuts.gg) schema bridge --------------------------
                    // Nuts is graphql-ws and describes a bet differently from
                    // Stake: the money is wager/multiplier, and the lifecycle is
                    // the __typename (SinglePlayerGameBetInProgress while playing,
                    // SinglePlayerGameBet once settled) rather than amount/payout/
                    // active. Map those onto the canonical fields the resolver
                    // already understands so the rest of the pipeline is unchanged.
                    var owns = owner || o;
                    if (owns && /SinglePlayerGameBet/i.test(String(owns.__typename))) {
                        st.bet = st.bet || {};
                        if (owns.wager != null)      st.bet.amount = num(owns.wager);
                        if (owns.multiplier != null) st.bet.payoutMultiplier = num(owns.multiplier);
                        st.bet.active = /InProgress/i.test(String(owns.__typename));
                        st.bet._nuts = true;
                    }

                    // "Live" = a hand in progress, on any schema:
                    //   - the site exposes available moves (actions), or
                    //   - the bet is flagged active, or
                    //   - it's an opening deal (you hold two cards, the dealer
                    //     shows one). A settled feed bet never looks like that:
                    //     a bust has 3+ player cards, a played-out hand shows
                    //     2+ dealer cards.
                    var openingDeal = st.dealer.length === 1 &&
                                      st.hands.length === 1 && st.hands[0].cards.length === 2;
                    // An explicitly-settled bet is never live — Nuts keeps the
                    // played-out action list on a finished hand, which would
                    // otherwise read as "moves still available" and let stale
                    // feed hands (myGames) masquerade as the game in play. The
                    // one exception is an instant natural: a two-card 21 settles
                    // immediately and still needs to be picked up and scored.
                    var pInfo = st.hands.length === 1 ? handInfo(st.hands[0].cards) : null;
                    var instantNatural = openingDeal && pInfo && pInfo.total === 21;
                    st.live = instantNatural ? true :
                              (st.bet && st.bet.active === false) ? false :
                              (handHasActions(o) || (st.bet && st.bet.active === true) || openingDeal);
                    st.id = st.bet && st.bet.id != null ? String(st.bet.id) : null;
                    // Nuts issues a DIFFERENT bet id for the in-progress hand
                    // (_id) than for its settlement (id), so an id can't tie a
                    // hand to its own updates. Key it by dealer up-card + the
                    // player's FIRST card. Both stay constant from the deal
                    // through every hit AND through a split (the first hand keeps
                    // its original first card), so one hand maps to one round for
                    // its whole life. Using the first TWO cards broke on a split,
                    // where the second card is replaced by the drawn card and the
                    // key changed mid-hand, spawning phantom rounds.
                    if (st.bet && st.bet._nuts) {
                        st.id = st.dealer[0] + '|' + st.hands[0].cards[0];
                    }
                    // Mark states that came from a feed (any array of bets — Nuts myGames,
                    // Stake AllHouseBets/MyBetList, etc.). The orphan-blackjack rescue in
                    // ingest must never pull a hand from a feed (that would count strangers'
                    // hands or double-count our own history), only from the single live game op.
                    st.feed = !!feed;
                    acc.push(st);
                    return;             // a matched node is a leaf for our purposes
                }
            }
            for (var k in o) {
                if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
                var v = o[k];
                if (v && typeof v === 'object') collectBjStates(v, depth + 1, o, acc, feed || Array.isArray(o));
            }
        }

        /* ---- Shuffle (shuffle.us) schema ---------------------------------
           Shuffle's graphql doesn't use player/dealer keys at all, so the walk
           above never matched it and the tool silently fell back to a DOM
           reader that CANNOT tell a split's two hands apart — which is exactly
           what broke splits. The real state is a Bet whose `shuffleOriginalActions`
           is a list of snapshots (newest last); the current one lives at
           `action.blackjack`, cards are integer deck indices (rank = floor(n/4)
           over 2..A), and the two player hands are SEPARATE arrays
           (mainPlayerHand / splitPlayerHand). The Bet id is stable for the whole
           hand, so it also keys the round with no synthetic id needed. */
        var SHUF_RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
        function shufRank(n) {
            return (typeof n === 'number' && n >= 0 && n < 52) ? SHUF_RANKS[Math.floor(n / 4)] : null;
        }
        function shufCards(arr) {
            if (!Array.isArray(arr)) return null;
            var out = [], i, r;
            for (i = 0; i < arr.length; i++) { r = shufRank(arr[i]); if (r) out.push(r); }
            return out.length ? out : null;
        }
        function collectShuffleStates(o, depth, acc) {
            if (!o || typeof o !== 'object' || depth > 8) return;
            if (Array.isArray(o.shuffleOriginalActions) && ('id' in o)) {
                var acts = o.shuffleOriginalActions, bj = null, i;
                for (i = acts.length - 1; i >= 0; i--) {
                    var a = acts[i] && acts[i].action && acts[i].action.blackjack;
                    if (a && (a.mainPlayerHand || a.dealerHand)) { bj = a; break; }
                }
                if (bj) {
                    var dealer = shufCards(bj.dealerHand), hands = [];
                    var mh = shufCards(bj.mainPlayerHand);
                    if (mh) hands.push({ cards: mh, raw: bj });
                    var sh = shufCards(bj.splitPlayerHand);
                    if (sh) hands.push({ cards: sh, raw: bj });
                    if (dealer && dealer.length && hands.length) {
                        var settled = o.completedAt != null;
                        var opening = dealer.length === 1 && hands.length === 1 &&
                                      hands[0].cards.length === 2;
                        var pInfo = handInfo(hands[0].cards);
                        var st = { dealer: dealer, hands: hands, source: 'net', at: Date.now() };
                        st.bet = {
                            id: o.id != null ? String(o.id) : null,
                            amount: num(o.amount),
                            payout: num(o.payout),
                            payoutMultiplier: o.multiplier != null ? num(o.multiplier) : null,
                            active: !settled
                        };
                        st.live = (opening && pInfo.total === 21) ? true :
                                  settled ? false :
                                  (bj.mainHandOutcome === 'PENDING' || opening);
                        st.id = st.bet.id;
                        acc.push(st);
                        return;                 // this bet is a leaf
                    }
                }
            }
            for (var key in o) {
                if (!Object.prototype.hasOwnProperty.call(o, key)) continue;
                var v = o[key];
                if (v && typeof v === 'object') collectShuffleStates(v, depth + 1, acc);
            }
        }

        /* The transport hooks install once per page; park the parsed state and
           the id of the hand we're following on the page window so the hook and
           this instance always agree. */
        function publishNetState(st) {
            try {
                PAGE_WIN.__bjNetState = st;
                if (st.live && st.id) PAGE_WIN.__bjLiveId = st.id;
            } catch (e) {}
        }
        function netState() { try { return PAGE_WIN.__bjNetState || null; } catch (e) { return null; } }
        function liveId()   { try { return PAGE_WIN.__bjLiveId || null; } catch (e) { return null; } }

        /* Accept a state only if it's OUR game:
             - a live state (moves available / active) — the hand being played, or
             - the settlement of the hand whose id we've been following.
           A stray settled bet from the feed carries an id we've never seen, so
           it is rejected. This is what keeps other players' hands and the bet
           history out of your session stats. */
        function ingest(text) {
            if (!text || text.length > 1500000) return;
            if (text.indexOf('dealer') < 0) return;      // cheap pre-filter
            var data;
            try { data = JSON.parse(text); } catch (e) { return; }

            var acc = [];
            collectBjStates(data, 0, null, acc);
            if (isShuf) collectShuffleStates(data, 0, acc);   // Shuffle's own schema
            if (!acc.length) return;

            var i, live = [];
            for (i = 0; i < acc.length; i++) if (acc[i].live) live.push(acc[i]);

            var chosen = null;
            if (live.length === 1) {
                chosen = live[0];                        // the game in play
            } else if (live.length === 0) {
                // No live state — could be the settlement of our hand, or feed
                // bets. Accept a single node only if it is the hand we've been
                // following (id match) or it carries no id at all (a schema
                // without bet ids, where the feed can't masquerade by id).
                // A Stake feed push has an id we've never seen, so it is dropped.
                var known = liveId(), mine = [];
                for (i = 0; i < acc.length; i++) {
                    if ((known && acc[i].id === known) || acc[i].id === null) mine.push(acc[i]);
                }
                if (mine.length === 1) chosen = mine[0];
                else if (mine.length === 0) {
                    // Rescue an instant-settled blackjack (a player natural or a dealer
                    // blackjack) that never had a live/opening frame. Nuts delivers these
                    // as ONE already-settled playBlackjack frame with the dealer already
                    // showing two cards — so it isn't opening-shaped (the instantNatural
                    // rescue misses it) and its synthetic id (dealer-up + first card)
                    // matches no tracked round, so the id-guard above dropped it and both
                    // blackjack counters stayed at zero. Accept it only from the live game
                    // op (feed states excluded), and only when it is unambiguous.
                    var orphans = [];
                    for (i = 0; i < acc.length; i++) {
                        var a = acc[i];
                        if (a.feed) continue;
                        if (!(a.bet && a.bet.active === false)) continue;
                        if (a.hands.length !== 1 || a.hands[0].cards.length !== 2) continue;
                        var pBjOrphan = handInfo(a.hands[0].cards).total === 21;
                        var dBjOrphan = a.dealer.length === 2 && handInfo(a.dealer).total === 21;
                        if (pBjOrphan || dBjOrphan) orphans.push(a);
                    }
                    if (orphans.length === 1) chosen = orphans[0];
                }
            }
            // live.length > 1 means several games in one payload — a feed. Skip.
            if (chosen) {
                publishNetState(chosen);
                // Resolve SYNCHRONOUSLY, right here, off the wire — not on the
                // next 350ms poll. Resolution used to wait for a polling tick to
                // read the single "latest state" slot this function writes to;
                // under fast auto-play the NEXT payload (e.g. the next deal's
                // opening state) could overwrite that slot before the poll ever
                // consumed the settle, silently dropping the hand's result. A
                // captured live run showed exactly that: the tool recorded 3 of
                // 21 real hands. Feeding every payload straight into trackState
                // the instant it arrives means a settle can never be skipped.
                try { trackState(chosen); } catch (e) {}
            }
        }

        /* ---- transport hooks (fetch / XHR / WebSocket on the page window) ---- */
        (function installNetHooks() {
            if (PAGE_WIN.__bjNetHookInstalled) return;
            PAGE_WIN.__bjNetHookInstalled = true;
            var URL_RE = /graphql|\/main-api\/|\/_api\//i;

            try {
                var origFetch = PAGE_WIN.fetch;
                if (origFetch) {
                    PAGE_WIN.fetch = function (input, init) {
                        var url = '';
                        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
                        var p = origFetch.apply(this, arguments);
                        if (URL_RE.test(url)) {
                            try {
                                p.then(function (res) {
                                    try { res.clone().text().then(ingest, function () {}); } catch (e) {}
                                    return res;
                                }, function () {});
                            } catch (e) {}
                        }
                        return p;
                    };
                }
            } catch (e) {}

            try {
                var oOpen = PAGE_WIN.XMLHttpRequest.prototype.open;
                var oSend = PAGE_WIN.XMLHttpRequest.prototype.send;
                PAGE_WIN.XMLHttpRequest.prototype.open = function (m, u) {
                    this.__bjUrl = (typeof u === 'string') ? u : '';
                    return oOpen.apply(this, arguments);
                };
                PAGE_WIN.XMLHttpRequest.prototype.send = function () {
                    var self = this;
                    if (URL_RE.test(self.__bjUrl || '')) {
                        self.addEventListener('load', function () {
                            try { ingest(self.responseText); } catch (e) {}
                        });
                    }
                    return oSend.apply(this, arguments);
                };
            } catch (e) {}

            // Shuffle pushes results over a socket; Nuts uses graphql-ws.
            try {
                var OrigWS = PAGE_WIN.WebSocket;
                if (OrigWS) {
                    var WrappedWS = function (url, protocols) {
                        var ws = protocols === undefined ? new OrigWS(url) : new OrigWS(url, protocols);
                        try {
                            ws.addEventListener('message', function (ev) {
                                if (typeof ev.data === 'string') ingest(ev.data);
                            });
                        } catch (e) {}
                        return ws;
                    };
                    WrappedWS.prototype = OrigWS.prototype;
                    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) {
                        try { WrappedWS[k] = OrigWS[k]; } catch (e) {}
                    });
                    PAGE_WIN.WebSocket = WrappedWS;
                }
            } catch (e) {}

            // Nuts (graphql-ws) opens its game socket during app boot, before
            // this hook installs — so wrapping WebSocket alone never sees a
            // single Nuts frame. Intercept MessageEvent's `data` getter instead:
            // it fires for every socket message the page itself reads, including
            // sockets that were already open when we arrived. Idempotent with the
            // WebSocket wrap above (re-ingesting a frame is a no-op — each hand
            // latches once), and it returns the original value untouched.
            try {
                var ME = PAGE_WIN.MessageEvent;
                var dataDesc = ME && ME.prototype &&
                               Object.getOwnPropertyDescriptor(ME.prototype, 'data');
                if (dataDesc && dataDesc.get && !PAGE_WIN.__bjMsgHook) {
                    PAGE_WIN.__bjMsgHook = true;
                    var seenMsg = (typeof WeakSet !== 'undefined') ? new WeakSet() : null;
                    Object.defineProperty(ME.prototype, 'data', {
                        configurable: true,
                        get: function () {
                            var v = dataDesc.get.call(this);
                            try {
                                if (typeof v === 'string' && v.length < 1500000 &&
                                    v.indexOf('dealer') >= 0) {
                                    if (!seenMsg || !seenMsg.has(this)) {
                                        if (seenMsg) seenMsg.add(this);
                                        ingest(v);
                                    }
                                }
                            } catch (e) {}
                            return v;
                        }
                    });
                }
            } catch (e) {}
        })();

        /* ---------------------------------------------------------------
           CARD EXTRACTION — DOM fallback
           Used until the first payload lands. Blackjack layouts always stack
           the dealer above the player, so cluster rendered ranks by their
           vertical midpoint rather than guessing per-site selectors. Split
           hands are not resolved here; the payload covers those.
           --------------------------------------------------------------- */
        function rankFromEl(el) {
            var probe = el.getAttribute('data-rank') || el.getAttribute('aria-label') ||
                        el.getAttribute('alt') || el.textContent || '';
            // Shuffle concatenates the rank straight into the suit name with no
            // separator (e.g. "10DIAMONDS", "5SPADES") — digit-to-letter isn't a
            // \b word boundary, so a trailing \b silently rejected every card
            // whose rank text ran into a spelled-out suit. A negative lookahead
            // for another digit is enough to still refuse a false partial match
            // (e.g. never read "1" out of "100") while accepting any letter,
            // symbol, or end-of-string right after the rank.
            var m = String(probe).trim().toUpperCase().match(/^(10|[23456789AJQKT])(?!\d)/);
            return m ? (m[1] === 'T' ? '10' : m[1]) : null;
        }

        function domReadState() {
            var nodes = document.querySelectorAll(
                '[data-testid*="card" i], [class*="card" i], [data-rank]');
            var hits = [], i;
            for (i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                if (hud && hud.contains(el)) continue;      // never read our own panel
                var r = rankFromEl(el);
                if (!r) continue;
                var rect = el.getBoundingClientRect();
                if (rect.width < 8 || rect.height < 8) continue;
                hits.push({ el: el, rank: r, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }
            // A card face and its wrapper both match; keep only the innermost.
            var kept = hits.filter(function (h) {
                return !hits.some(function (o) { return o !== h && h.el.contains(o.el); });
            });
            if (kept.length < 2) return null;

            var ys = kept.map(function (h) { return h.y; });
            var mid = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
            var byX = function (a, b) { return a.x - b.x; };
            var dealer = kept.filter(function (h) { return h.y <  mid; }).sort(byX).map(function (h) { return h.rank; });
            var player = kept.filter(function (h) { return h.y >= mid; }).sort(byX).map(function (h) { return h.rank; });
            if (!dealer.length || !player.length) return null;
            return { dealer: dealer, hands: [{ cards: player, raw: null }], source: 'dom', at: Date.now() };
        }

        /* ---------------------------------------------------------------
           BUTTONS
           Observed on the live sites:
             Stake   — all four actions share data-testid="action"; text is
                       "Hit" / "Stand" / "Split" / "Double". Bet adjusters are
                       [data-testid="amount-halve"] ("½") and "amount-double" ("2×").
             Shuffle — only "stand-button" and "bet-button" carry testids; the
                       rest are text-only. Its bet adjuster is labelled "2x".
             Nuts    — no testids at all; button text is lowercase.

           "2x" must NOT be treated as Double: on Shuffle that button doubles
           the WAGER, it is enabled while the real Double is disabled, and a
           text scan would reach it first. Doubling the bet instead of the hand
           is a money bug, so bet adjusters are excluded outright and Double is
           matched only on its own word.
           --------------------------------------------------------------- */
        var TEXT_RE = {
            hit:    /^hit$/i,
            stand:  /^(stand|stay)$/i,
            double: /^(double|double down)$/i,
            split:  /^split$/i,
            deal:   /^(bet|deal|play)$/i
        };
        var BET_ADJUSTER_TEXT = /^(2x|2×|½|1\/2|x2|max|min)$/i;

        function clickable(el) {
            return !!el && !el.disabled &&
                   el.getAttribute('aria-disabled') !== 'true' &&
                   el.offsetParent !== null;
        }

        /** Not our own control, and not a bet-amount adjuster. */
        function candidate(el) {
            if (!el) return false;
            if (hud && hud.contains(el)) return false;
            var tid = el.getAttribute && el.getAttribute('data-testid');
            if (tid && /^amount-/i.test(tid)) return false;          // Stake ½ / 2×
            if (BET_ADJUSTER_TEXT.test((el.textContent || '').trim())) return false;  // Shuffle 2x
            return true;
        }

        function findBtn(kind) {
            var i, el;
            var ids = [
                '[data-testid="' + kind + '-button"]',
                '[data-testid="' + kind + '"]',
                '[data-test="' + kind + '-button"]'
            ];
            if (kind === 'deal') ids.unshift('[data-testid="bet-button"]');
            for (i = 0; i < ids.length; i++) {
                el = document.querySelector(ids[i]);
                if (candidate(el)) return el;
            }
            var re = TEXT_RE[kind];
            if (!re) return null;

            // Stake groups the four actions under one shared testid. Search
            // that group before scanning every button on the page.
            var scoped = document.querySelectorAll('[data-testid="action"]');
            for (i = 0; i < scoped.length; i++) {
                if (candidate(scoped[i]) && re.test((scoped[i].textContent || '').trim())) return scoped[i];
            }
            var cands = document.querySelectorAll('button, [role="button"]');
            for (i = 0; i < cands.length; i++) {
                el = cands[i];
                if (!candidate(el)) continue;
                var txt = (el.textContent || '').trim();
                if (txt && re.test(txt)) return el;
            }
            return null;
        }

        /** Last line of defence: never press a button whose label disagrees
         *  with the move we decided on. Only enforced for the four actions —
         *  a Deal button may legitimately read "Bet $1.00". */
        function labelAgrees(el, kind) {
            if (kind === 'deal') return true;
            return !!el && TEXT_RE[kind].test((el.textContent || '').trim());
        }

        /**
         * One logical click, expressed as the full pointer/mouse sequence.
         * Shuffle's controls drop a bare .click(); Stake and Nuts accept
         * either. Passing `view` breaks when Tampermonkey proxies window, so
         * it is only included when the real page window is reachable.
         */
        function realClick(el) {
            var base = { bubbles: true, cancelable: true, composed: true, button: 0 };
            var opts = PAGE_WIN ? Object.assign({}, base, { view: PAGE_WIN }) : base;
            var fire = function (Ctor, type) {
                try { el.dispatchEvent(new Ctor(type, opts)); }
                catch (e) { try { el.dispatchEvent(new Ctor(type, base)); } catch (e2) {} }
            };
            fire(PointerEvent, 'pointerdown');
            fire(MouseEvent,   'mousedown');
            fire(PointerEvent, 'pointerup');
            fire(MouseEvent,   'mouseup');
            fire(MouseEvent,   'click');
        }

        /* ---------------------------------------------------------------
           ADVICE
           --------------------------------------------------------------- */
        function currentState() {
            // A payload older than the last DOM change can be stale across a
            // fresh deal, so prefer the net state only while it is recent.
            var ns = netState();
            if (ns && Date.now() - ns.at < 60000) return ns;
            return domReadState();
        }

        /** The hand the site is currently asking about. */
        var BJ_TERMINAL_ACTION = /^(stand|bust|blackjack|double|surrender|push|lose|win)$/i;
        function activeHand(st) {
            var i, info;
            // 1. Explicit active flag, when a site exposes one (Stake/Shuffle).
            for (i = 0; i < st.hands.length; i++) {
                var raw = st.hands[i].raw;
                if (raw && (raw.active === true || raw.isActive === true)) return st.hands[i];
            }
            // 2. Nuts (and any schema where each hand carries an action HISTORY) has no
            //    active flag, so pick the leftmost hand that has NOT yet finished — i.e.
            //    whose action list holds no round-ending action (Stand/Bust/Blackjack/
            //    Double/…). Without this, the fallback below always returns hand[0], so
            //    after you stand hand 1 of a split the advice stayed stuck on hand 1
            //    instead of moving to the hand you're actually playing. ("Split" and
            //    "Deal" appear on BOTH split hands as history and are NOT terminal.)
            var hasActionHistory = st.hands.some(function (h) { return h.raw && Array.isArray(h.raw.actions); });
            if (hasActionHistory) {
                for (i = 0; i < st.hands.length; i++) {
                    var acts = (st.hands[i].raw && st.hands[i].raw.actions) || [];
                    var finished = acts.some(function (x) { return BJ_TERMINAL_ACTION.test(String(x)); });
                    info = handInfo(st.hands[i].cards);
                    if (!finished && !info.busted && info.total < 21) return st.hands[i];
                }
            }
            // 3. Fallback: first non-busted hand under 21.
            for (i = 0; i < st.hands.length; i++) {
                info = handInfo(st.hands[i].cards);
                if (!info.busted && info.total < 21) return st.hands[i];
            }
            return st.hands[st.hands.length - 1];
        }

        function advise() {
            var st = currentState();
            if (!st) return { st: null };
            var hand = activeHand(st);
            var up = st.dealer[0];
            var maxHands = cfg.resplit ? 4 : 2;
            var info = handInfo(hand.cards);
            var canDouble = hand.cards.length === 2 && (cfg.das || st.hands.length === 1);
            var canSplit  = info.pair && st.hands.length < maxHands;
            var d = decide(hand.cards, up, canDouble, canSplit);
            var eq = null;
            try { eq = handEquity(hand.cards, up, cfg.h17); } catch (e) {}
            return { st: st, hand: hand, info: info, up: up, dec: d, eq: eq };
        }

        /* Identifies "the decision we last acted on", so autoplay presses once
           per state rather than once per tick.

           The cards alone are not enough. Split a pair and the two hands can end
           up IDENTICAL — 9,A and 9,A against the same upcard — at which point
           hand 2 hashed exactly like hand 1, the gate in autoTick read it as a
           state already handled, and autoplay stopped dead on the second hand.
           Reported from stake.us with precisely that pair.

           So the hash also carries WHICH hand is being asked about, and how many
           actions each hand has taken: standing on hand 1 advances its action
           list, which makes the whole state provably different even where every
           card matches. */
        function stateHash(st, hand) {
            var idx = st.hands.indexOf(hand);
            return st.dealer.join(',') + '|' +
                   st.hands.map(function (h) {
                       var acts = (h.raw && h.raw.actions) ? h.raw.actions.length : 0;
                       return h.cards.join('') + ':' + acts;
                   }).join('/') + '|' +
                   idx + '|' +
                   hand.cards.join('');
        }

        /* ---------------------------------------------------------------
           SESSION STATISTICS
           Hand outcomes, money and strategy adherence. Money needs the
           payload's wager/payout; hands and adherence are derived from the
           cards alone, so they still work if a site's schema drifts.
           --------------------------------------------------------------- */
        var STATS_KEY = 'bj-perfect-stats-' + SITE.toLowerCase();
        var LOG_MAX = 2000, MISTAKE_MAX = 60;
        var BLANK_STATS = {
            hands: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, busts: 0,
            dealerBlackjacks: 0,
            doubles: 0, doublesWon: 0, doublesLost: 0,
            splits: 0, splitHands: 0, splitsWon: 0, splitsLost: 0, splitsPushed: 0,
            wagered: 0, returned: 0, biggest: 0,
            streak: 0, bestStreak: 0, worstStreak: 0,
            decisions: 0, correct: 0,
            startedAt: 0, mistakes: [], log: []
        };
        var stats;
        try { stats = Object.assign({}, BLANK_STATS, JSON.parse(localStorage.getItem(STATS_KEY) || '{}')); }
        catch (e) { stats = Object.assign({}, BLANK_STATS); }
        if (!stats.startedAt) stats.startedAt = Date.now();
        if (!Array.isArray(stats.log)) stats.log = [];
        if (!Array.isArray(stats.mistakes)) stats.mistakes = [];

        var statsDirty = false;
        function saveStats() { statsDirty = true; }
        setInterval(function () {        // batch writes; the ticker touches these often
            if (!statsDirty) return;
            statsDirty = false;
            try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
        }, 1000);

        function resetStats() {
            stats = Object.assign({}, BLANK_STATS, { startedAt: Date.now(), mistakes: [], log: [] });
            saveStats();
        }

        function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
        function pnl() { return stats.returned - stats.wagered; }
        function rtp() { return stats.wagered > 0 ? (stats.returned / stats.wagered) * 100 : null; }
        function winRate() {
            var decided = stats.wins + stats.losses;
            return decided > 0 ? (stats.wins / decided) * 100 : null;
        }
        function adherence() {
            return stats.decisions > 0 ? (stats.correct / stats.decisions) * 100 : null;
        }

        /* ---- hand lifecycle ---------------------------------------------
           A hand is identified by the bet id when the payload gives us one;
           otherwise by the opening deal (dealer upcard + two player cards).
           It resolves when the payload says the bet is no longer active. */
        var round = null;
        var lastOpenKey = '';
        var lastWager = 0;   // last positive stake seen; recovers the wager on
                             // instant settles that report amount:0 (blackjack).

        function openKey(st) {
            return st.dealer[0] + '|' + st.hands[0].cards.slice(0, 2).join('');
        }

        /** The bet amount from the site's own input — used when the network
         *  feed isn't delivering a bet object (DOM-only reads). */
        function readWagerFromDom() {
            var el = document.querySelector('[data-testid="input-game-amount"]') ||
                     document.querySelector('[data-testid="bet-amount"]') ||
                     document.querySelector('[data-testid="amount-input"]');
            if (!el) return 0;
            var n = parseFloat(String(el.value || (el.getAttribute && el.getAttribute('value')) || '')
                        .replace(/[^0-9.]/g, ''));
            return isFinite(n) ? n : 0;
        }

        /** Can the player still act on the current hand? */
        function playerCanAct() {
            return clickable(findBtn('hit')) || clickable(findBtn('stand')) ||
                   clickable(findBtn('double')) || clickable(findBtn('split'));
        }

        /** The dealer can no longer draw: busted, 18+, or a 17 it must stand on
         *  (S17 stands on every 17; H17 hits soft 17). "Hole card is showing"
         *  (>= 2 cards) is NOT enough — a 2-card 14 must still draw. */
        function dealerFinished(dealerCards) {
            if (!dealerCards || dealerCards.length < 2) return false;
            var di = handInfo(dealerCards);
            return di.busted || di.total >= 18 ||
                   (di.total === 17 && !(cfg.h17 && di.soft));
        }
        function trackState(st) {
            if (!st || !st.hands.length) return;
            var bet = st.bet;
            var key = bet && bet.id != null ? 'id:' + bet.id : null;

            var isNew;
            if (key) {
                isNew = !round || round.key !== key;
                // A hand's key can repeat (Nuts keys by dealer-up + first card,
                // and holds it constant across a split). Once the current round
                // has resolved, a fresh two-card opening carrying that same key
                // is a genuinely new hand, not a stray update to the old one.
                if (!isNew && round && round.resolved &&
                    st.dealer.length === 1 && st.hands.length === 1 &&
                    st.hands[0].cards.length === 2 &&
                    !(st.bet && st.bet.active === false)) {
                    isNew = true;
                }
            } else {
                // No id (DOM read): a fresh two-card hand whose opening differs
                // from the last one we opened counts as a new hand.
                var ok = openKey(st);
                isNew = st.hands.length === 1 && st.hands[0].cards.length === 2 &&
                        st.dealer.length === 1 && ok !== lastOpenKey;
                if (isNew) lastOpenKey = ok;
            }

            // A new deal starting is itself proof the previous hand is over —
            // blackjack cannot deal hand #2 while hand #1 is unresolved. So this
            // fallback must be UNCONDITIONAL: gating it on isTerminalView() sounds
            // safe but isn't — it silently DROPPED whole hands whenever the last
            // card view we happened to capture looked mid-draw (a stale snapshot),
            // even though the hand had genuinely ended, undercounting stats against
            // the real balance. resolveRound() still prefers the authoritative
            // settled payout on round.lastBet when we have one; card comparison is
            // only the last-resort fallback, same as always.
            if (isNew && round && !round.resolved && round.last) {
                resolveRound(round.last, round.lastBet);
            }

            if (isNew) {
                round = {
                    key: key || 'k' + Date.now(),
                    wager: (bet && bet.amount) ? num(bet.amount) : readWagerFromDom(),
                    dealerUp: st.dealer[0],
                    doubled: false, split: false, resolved: false,
                    last: null, lastBet: null, at: Date.now()
                };
            }
            if (!round) return;
            if (st.hands.length > 1) round.split = true;

            // Latch the wager the first moment it's readable, from either source.
            if (!round.wager) round.wager = (bet && bet.amount) ? num(bet.amount) : (readWagerFromDom() || round.wager);
            if (round.wager > 0) lastWager = round.wager;
            // Keep the latest fully-dealt view so the hand can be scored even if
            // the final frame vanishes before we notice it ended.
            if (st.hands[0].cards.length >= 2) { round.last = st; round.lastBet = bet || null; }

            // The hand is over when the network settles the bet (authoritative),
            // OR the cards themselves show it ended: the dealer finished drawing,
            // every player hand busted, or the player has a natural. Merely
            // "the hole card is showing" is NOT enough — a 2-card 14 must still
            // draw, and scoring against it booked almost every hand as a win.
            var netDone = bet && Object.prototype.hasOwnProperty.call(bet, 'active') && bet.active === false;
            var playerBusted = st.hands.every(function (h) { return handInfo(h.cards).busted; });
            var playerNatural = st.hands.length === 1 && st.hands[0].cards.length === 2 &&
                                handInfo(st.hands[0].cards).total === 21;
            var cardsDone = !playerCanAct() && (dealerFinished(st.dealer) || playerBusted || playerNatural);

            if (!round.resolved && (netDone || cardsDone)) resolveRound(st, bet);
        }

        function resolveRound(st, bet) {
            if (!round || round.resolved) return;
            round.resolved = true;
            recordResult(st, bet || null);
        }

        /** Result of one player hand vs the dealer's final hand, from cards.
         *  `playerBj` = this hand is a two-card 21; `dealerBj` = dealer natural.
         *  A player blackjack beats any non-blackjack (incl. a drawn 21) and
         *  pushes only against a dealer natural. */
        function handVsDealer(hInfo, dInfo, playerBj, dealerBj) {
            if (hInfo.busted) return 'loss';
            if (playerBj) return dealerBj ? 'push' : 'win';
            if (dealerBj) return 'loss';
            if (dInfo.busted) return 'win';
            if (hInfo.total > dInfo.total) return 'win';
            if (hInfo.total < dInfo.total) return 'loss';
            return 'push';
        }

        function recordResult(st, bet) {
            bet = bet || {};
            var wager = round.wager || num(bet.amount) || readWagerFromDom() || lastWager;
            if (wager > 0) lastWager = wager;

            var dInfo = handInfo(st.dealer);
            var dealerBj = st.dealer.length === 2 && dInfo.total === 21;
            // A blackjack is a two-card 21 on an unsplit hand.
            var natural = st.hands.length === 1 && st.hands[0].cards.length === 2 &&
                          handInfo(st.hands[0].cards).total === 21;

            // Score every hand from the cards. This is the source of truth for
            // win/loss/push; the network payout only refines the money figures.
            var best = null, bustHigh = null, net = 0, i, perHand = [];
            for (i = 0; i < st.hands.length; i++) {
                var hi = handInfo(st.hands[i].cards);
                if (!hi.busted && (best == null || hi.total > best)) best = hi.total;
                // Track the busted total too, so a busted hand still logs its
                // number (e.g. 24) instead of null when every hand busts.
                if (hi.busted && (bustHigh == null || hi.total > bustHigh)) bustHigh = hi.total;
                var handBj = st.hands.length === 1 && st.hands[i].cards.length === 2 && hi.total === 21;
                var r = handVsDealer(hi, dInfo, handBj, dealerBj);
                perHand.push(r);
                net += (r === 'win' ? 1 : r === 'loss' ? -1 : 0);
            }
            var busted = best == null;                       // every hand busted
            var outcome = net > 0 ? 'win' : net < 0 ? 'loss' : 'push';

            // Money + outcome. A SETTLED bet (active === false) carries the final
            // payout, and it is authoritative — INCLUDING a payout of 0, which is a
            // real loss, not missing data. This is the fix for the core bug: the
            // card comparison above races the dealer's on-screen draw (the socket
            // settles before the DOM finishes animating the dealer's hits, so
            // st.dealer is often still mid-draw here — e.g. 4,7=14 when the dealer
            // actually made 20), which mis-scored almost every hand as a win. The
            // payout can't race. Only fall back to a card-estimated payout when the
            // bet isn't settled (pure DOM, no network).
            var unit = wager * (round.doubled ? 2 : 1);
            var staked = unit * (st.hands.length || 1);
            var settled = bet.active === false && (bet.payout != null || bet.payoutMultiplier != null);
            // payoutMultiplier is the reliable settle signal: on an instant
            // blackjack Stake sends amount:0 / payout:0 but payoutMultiplier:2.5,
            // so trusting the raw payout alone booked every natural 21 as a
            // zero-stake loss. Prefer a positive paid amount; otherwise derive
            // the return from the multiplier against the stake.
            var payMult = bet.payoutMultiplier != null ? num(bet.payoutMultiplier) : null;
            var payout;
            if (settled) {
                if (bet.payout != null && num(bet.payout) > 0) payout = num(bet.payout);
                else if (payMult != null && payMult > 0) payout = staked * payMult;
                else payout = 0;
            } else if (bet.payout != null && num(bet.payout) > 0) {
                payout = num(bet.payout);
            } else if (bet.payoutMultiplier != null && num(bet.payoutMultiplier) > 0) {
                payout = wager * num(bet.payoutMultiplier);
            } else {
                payout = 0;
                for (i = 0; i < perHand.length; i++) {
                    if (perHand[i] === 'win') payout += unit * (natural && st.hands.length === 1 ? 2.5 : 2);
                    else if (perHand[i] === 'push') payout += unit;
                }
            }

            // When the bet is settled, take win/loss/push from the settle
            // multiplier when the casino gives one (0 = loss, 1 = push, >1 =
            // win) — it stays correct even on an instant blackjack whose
            // amount/payout arrive as 0. Fall back to comparing the paid amount
            // against the stake only when no multiplier is present.
            if (settled) {
                if (payMult != null) {
                    outcome = payMult <= 1e-9 ? 'loss'
                            : (Math.abs(payMult - 1) <= 1e-6 ? 'push' : 'win');
                } else {
                    var epsM = Math.max(1e-6, staked * 1e-4);
                    outcome = payout <= epsM ? 'loss'
                            : (Math.abs(payout - staked) <= epsM ? 'push' : 'win');
                }
            }

            stats.hands++;
            stats.wagered += staked;
            stats.returned += payout;
            if (payout > stats.biggest) stats.biggest = payout;
            if (busted) stats.busts++;
            if (dealerBj) stats.dealerBlackjacks++;

            if (round.doubled) {
                stats.doubles++;
                if (outcome === 'win') stats.doublesWon++;
                else if (outcome === 'loss') stats.doublesLost++;
            }
            if (round.split) {
                stats.splits++;
                for (i = 0; i < perHand.length; i++) {
                    stats.splitHands++;
                    if (perHand[i] === 'win') stats.splitsWon++;
                    else if (perHand[i] === 'loss') stats.splitsLost++;
                    else stats.splitsPushed++;
                }
            }

            if (outcome === 'win') {
                stats.wins++;
                if (natural && st.hands.length === 1) stats.blackjacks++;
                stats.streak = stats.streak >= 0 ? stats.streak + 1 : 1;
                if (stats.streak > stats.bestStreak) stats.bestStreak = stats.streak;
            } else if (outcome === 'loss') {
                stats.losses++;
                stats.streak = stats.streak <= 0 ? stats.streak - 1 : -1;
                if (stats.streak < stats.worstStreak) stats.worstStreak = stats.streak;
            } else {
                stats.pushes++;
            }

            stats.log.push({
                t: Date.now(), wager: staked, payout: payout,
                mult: staked > 0 ? payout / staked : null, outcome: outcome,
                total: best != null ? best : bustHigh, up: round.dealerUp,
                doubled: round.doubled, split: round.split,
                pnl: stats.returned - stats.wagered
            });
            if (stats.log.length > LOG_MAX) stats.log.shift();
            saveStats();
        }

        /* ---- strategy adherence -----------------------------------------
           Watches which action YOU press against what the chart said. Our own
           auto-play clicks are excluded — they always agree, so counting them
           would just inflate the number. */
        var lastAdvice = null;
        var suppressAdherenceUntil = 0;

        function kindOfButton(el) {
            var tid = (el.getAttribute && el.getAttribute('data-testid')) || '';
            if (/^amount-/i.test(tid)) return null;
            var txt = (el.textContent || '').trim();
            if (BET_ADJUSTER_TEXT.test(txt)) return null;
            for (var k in TEXT_RE) {
                if (TEXT_RE[k].test(txt)) return k;
                if (tid === k + '-button' || tid === k) return k;
            }
            return null;
        }

        document.addEventListener('click', function (e) {
            try {
                var el = e.target && e.target.closest && e.target.closest('button, [role="button"]');
                if (!el || (hud && hud.contains(el)) || (overlay && overlay.contains(el))) return;
                var kind = kindOfButton(el);
                if (kind === 'deal') {
                    // Capture the stake the instant Deal is pressed — the bet
                    // input is cleared once the hand starts, and an instant
                    // blackjack never reports a usable amount on the wire.
                    var dw = readWagerFromDom();
                    if (dw > 0) lastWager = dw;
                    return;
                }
                if (!kind) return;

                if (kind === 'double' && round) round.doubled = true;
                if (kind === 'split'  && round) round.split = true;

                if (Date.now() < suppressAdherenceUntil) return;   // our own click
                var a = lastAdvice;
                if (!a || !a.st || !a.dec || a.dec.action === '—') return;

                stats.decisions++;
                if (a.dec.action === kind.toUpperCase()) {
                    stats.correct++;
                } else {
                    stats.mistakes.push({
                        t: Date.now(), hand: a.hand.cards.join(' '), up: a.up,
                        should: a.dec.action, did: kind.toUpperCase()
                    });
                    if (stats.mistakes.length > MISTAKE_MAX) stats.mistakes.shift();
                }
                saveStats();
            } catch (err) { /* never break the page's own click handling */ }
        }, true);

        function exportCsv() {
            if (!stats.log.length) return;
            var head = 'iso,wager,payout,multiplier,outcome,player_total,dealer_up,doubled,split,running_pnl';
            var rows = stats.log.map(function (r) {
                return [new Date(r.t).toISOString(), r.wager, r.payout,
                        r.mult == null ? '' : r.mult, r.outcome, r.total == null ? '' : r.total,
                        r.up, r.doubled ? 1 : 0, r.split ? 1 : 0, r.pnl.toFixed(8)].join(',');
            });
            var blob = new Blob([head + '\n' + rows.join('\n')], { type: 'text/csv' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'blackjack-' + SITE.toLowerCase() + '-' +
                         new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        }

        /* ---------------------------------------------------------------
           AUTO-PLAY
           Acts once per distinct state, only on buttons the site has already
           enabled, and never starts a new hand unless auto-deal is on.
           --------------------------------------------------------------- */
        var lastActedHash = '';
        var pendingUntil = 0;
        // Single master switch for autoplay, like the Dice/Limbo Start button.
        // NOT persisted — it always starts OFF on load so the tool never wagers
        // on its own until you press Start. While running it both deals and plays.
        var running = false;
        var BTN_FOR = { HIT: 'hit', STAND: 'stand', DOUBLE: 'double', SPLIT: 'split' };

        /* When the dealer shows an ace, Stake replaces Hit/Stand/Split/Double
           with an insurance prompt in the same slot: two buttons, both
           data-testid="action", reading "Accept insurance" and "No insurance".
           While it is up, the normal actions are gone, so auto-play would sit
           frozen — and any split on that hand is stuck behind it. Basic
           strategy always declines, so we press "No insurance". We match the
           decline text exactly and never touch "Accept insurance". */
        function insuranceDeclineBtn() {
            var i, el, txt, cands = document.querySelectorAll('button, [role="button"]');
            // Explicit decline labels (Stake: "No insurance" / "Decline").
            for (i = 0; i < cands.length; i++) {
                el = cands[i];
                if (hud && hud.contains(el)) continue;
                txt = (el.textContent || '').trim();
                if (/accept/i.test(txt)) continue;                 // never take it
                if (/^no\s*insurance$/i.test(txt) || /^decline$/i.test(txt) ||
                    /^no\s*thanks$/i.test(txt)) return el;
            }
            // Nuts: the prompt is an "insurance?" heading with bare "No" / "Yes"
            // buttons and no testid. Only treat a plain "No" as the decline when
            // a nearby ancestor actually mentions insurance AND offers a "Yes"
            // beside it — so a stray "No" elsewhere on the page is never pressed.
            for (i = 0; i < cands.length; i++) {
                el = cands[i];
                if (hud && hud.contains(el)) continue;
                if (!/^no$/i.test((el.textContent || '').trim())) continue;
                for (var p = el.parentElement, hops = 0; p && hops < 4; p = p.parentElement, hops++) {
                    var t = p.textContent || '';
                    if (t.length > 80 || !/insurance/i.test(t)) continue;
                    var hasYes = Array.prototype.some.call(
                        p.querySelectorAll('button, [role="button"]'),
                        function (b) { return /^yes$/i.test((b.textContent || '').trim()); });
                    if (hasYes) return el;
                }
            }
            return null;
        }

        function autoTick() {
            if (!running) return;
            if (Date.now() < pendingUntil) return;

            // Clear the insurance prompt first — nothing else can happen until
            // it is answered, and the answer is always "no".
            var decline = insuranceDeclineBtn();
            if (clickable(decline)) {
                pendingUntil = Date.now() + cfg.delayMs + 400;
                suppressAdherenceUntil = Date.now() + 250;   // our click, not a decision
                setStatus('declining insurance');
                setTimeout(function () {
                    var live = insuranceDeclineBtn();
                    if (running && clickable(live)) realClick(live);
                }, Math.min(cfg.delayMs, 400));
                return;
            }

            var myTurn = clickable(findBtn('hit'));

            if (!myTurn) {
                // Running means deal the next hand too — one button drives the
                // whole loop, so there is no separate auto-deal switch to forget.
                var deal = findBtn('deal');
                if (clickable(deal)) {
                    lastActedHash = '';
                    pendingUntil = Date.now() + Math.max(400, cfg.delayMs);
                    suppressAdherenceUntil = Date.now() + 250;
                    realClick(deal);
                    setStatus('dealing next hand');
                }
                return;
            }

            var a = advise();
            if (!a.st) { setStatus('waiting for cards'); return; }

            var hash = stateHash(a.st, a.hand);
            if (hash === lastActedHash) return;

            var action = a.dec.action;
            if (!BTN_FOR[action]) return;

            // Downgrade to a legal move if the site has not enabled the ideal
            // one (e.g. double after the first hit, or a split slot used up).
            if (!clickable(findBtn(BTN_FOR[action])) && (action === 'DOUBLE' || action === 'SPLIT')) {
                action = decide(a.hand.cards, a.up, false, false).action;
            }
            if (!clickable(findBtn(BTN_FOR[action]))) { setStatus('cannot press ' + action); return; }

            // Claim the state now so the next tick can't queue a second click,
            // and hold the gate past the click itself.
            lastActedHash = hash;
            pendingUntil = Date.now() + cfg.delayMs + 400;
            setTimeout(function () {
                // Re-resolve: the site may have re-rendered the button between
                // scheduling and firing, leaving the old node detached.
                var live = findBtn(BTN_FOR[action]);
                if (!running || !clickable(live)) {
                    lastActedHash = '';      // let the next tick retry this hand
                    return;
                }
                if (!labelAgrees(live, BTN_FOR[action])) {
                    // Whatever we resolved is not the button we meant. Pressing
                    // it could stake money (a bet adjuster, a re-bet). Stop.
                    lastActedHash = '';
                    setStatus('refused: "' + (live.textContent || '').trim().slice(0, 12) +
                              '" is not ' + action);
                    return;
                }
                // Flag it so the adherence counter ignores our own click.
                suppressAdherenceUntil = Date.now() + 250;
                realClick(live);
                setStatus('auto: ' + action);
            }, cfg.delayMs);
        }

        /* ---------------------------------------------------------------
           DOCKING
           The panel sits in the game's betting panel, under the native
           controls, the same way the Moles HUD sits in .game-sidebar.

           Only Stake has a selector worth hard-coding: .game-sidebar is its
           betting column, and both Moles and the dice tool already rely on it.
           Shuffle ships no sidebar at all (its controls are a footer beneath
           the table) and Nuts names things with styled-components hashes that
           change between deploys. So for those two we anchor on a control that
           must exist inside the betting panel — the bet-amount input, or
           failing that an action button — and climb to the first ancestor big
           enough to be the panel itself.
           --------------------------------------------------------------- */
        /* Verified against the live blackjack pages of all three sites. Nuts'
           class is a styled-components hash and will churn between deploys, so
           the anchored walk-up below stays as its safety net. */
        var DIRECT_DOCKS = {
            stake:   ['.game-sidebar'],
            shuffle: ['[class*="CasinoOriginalGameControlLayout_root"]'],
            nuts:    ['.sc-8d275cfe-1.eGfUZM', '.sc-8d275cfe-1']
        };
        var BET_ANCHORS = [
            '[class*="InfoBetInput_inputContainer"]',   // Shuffle
            '[data-testid="input-game-amount"]',        // Stake
            '[data-testid="bet-amount"]',               // Shuffle (alt)
            '[data-testid="amount-input"]'
        ];

        /* Board container for the stats overlay. Measured on the live pages:
             Stake   [data-testid="game-blackjack"]          868 x 781
             Shuffle .BlackjackContent_contentContainer__…   902 x 795
             Nuts    .sc-8d275cfe-3                          800 x 763
           Shuffle's blackjack page has no GameLayout_gameContent — that class
           belongs to the dice/limbo runtime — so it needs its own selector. */
        var BOARD_SELECTORS = {
            stake:   ['[data-testid="game-blackjack"]', '[data-testid="game-frame"]'],
            shuffle: ['[class*="BlackjackContent_contentContainer"]',
                      '[class*="OriginalGameRuntime_gameContent"]',
                      '[class*="GameLayout_gameContent"]'],
            nuts:    ['.sc-8d275cfe-3.eertbI', '.sc-8d275cfe-3']
        };

        function bigEnough(el) {
            if (!el || !el.isConnected) return false;
            var r = el.getBoundingClientRect();
            return r.width >= 300 && r.height >= 200;
        }

        function findBoard() {
            var sels = BOARD_SELECTORS[isShuf ? 'shuffle' : isNut ? 'nuts' : 'stake'] || [];
            var i, el;
            for (i = 0; i < sels.length; i++) {
                el = document.querySelector(sels[i]);
                if (bigEnough(el)) return el;
            }
            // Last resort: climb from the dealer's area to the first ancestor
            // big enough to be the table. Keeps the overlay alive through a
            // class rename instead of silently never mounting.
            var anchor = document.querySelector('[data-testid="dealer-container"], [data-testid="dealer"]');
            for (el = anchor; el && el !== document.body; el = el.parentElement) {
                if (bigEnough(el) && !(hud && el.contains(hud))) return el;
            }
            return null;
        }

        var dockMissTicks = 0;
        var floatFallback = false;

        /* ---------------------------------------------------------------
           THEME
           Each casino restyles constantly and stake.com / stake.us do not even
           share an accent colour, so the panel's chrome is sampled from the
           page rather than hard-coded: the surface comes from the first opaque
           ancestor of the dock, the font and text colour from the dock itself,
           and the accent from the Bet button (its background, or the first
           colour of its gradient).

           The four action colours are deliberately NOT sampled. Green, red,
           amber and blue mean Hit, Stand, Double and Split — they carry the
           information, so they stay put on every site.
           --------------------------------------------------------------- */
        function firstOpaqueBg(el) {
            for (var e = el, i = 0; e && i < 6; e = e.parentElement, i++) {
                var bg = getComputedStyle(e).backgroundColor;
                if (bg && bg !== 'transparent' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg)) return bg;
            }
            return null;
        }

        function sampleAccent() {
            var el = document.querySelector('[data-testid="bet-button"]');
            if (!el) {
                el = Array.prototype.find.call(document.querySelectorAll('button'), function (b) {
                    return /^(bet|play|deal)$/i.test((b.textContent || '').trim());
                });
            }
            if (!el) return null;
            var cs = getComputedStyle(el);
            if (cs.backgroundColor && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(cs.backgroundColor)) return cs.backgroundColor;
            var m = (cs.backgroundImage || '').match(/rgba?\([^)]+\)|#[0-9a-f]{3,8}/i);   // gradient (Nuts)
            return m ? m[0] : null;
        }

        function applyTheme(el, dock) {
            try {
                var cs = getComputedStyle(dock);
                var radius = parseInt(cs.borderRadius, 10);
                el.style.setProperty('--bj-surface', firstOpaqueBg(dock) || '#0f212e');
                el.style.setProperty('--bj-text',    cs.color || '#b1bad3');
                el.style.setProperty('--bj-font',    cs.fontFamily || 'inherit');
                el.style.setProperty('--bj-radius',  (radius > 0 && radius <= 16 ? radius : 8) + 'px');
                el.style.setProperty('--bj-accent',  sampleAccent() || '#1fff20');
            } catch (e) { /* fall back to the defaults baked into the CSS */ }
        }

        /** The betting panel, or null while the game is still rendering. */
        function findDock() {
            var key = isShuf ? 'shuffle' : isNut ? 'nuts' : 'stake';
            var sels = DIRECT_DOCKS[key], i, el;
            for (i = 0; i < sels.length; i++) {
                el = document.querySelector(sels[i]);
                if (el && el.isConnected) return el;
            }

            var anchor = null;
            for (i = 0; i < BET_ANCHORS.length && !anchor; i++) {
                anchor = document.querySelector(BET_ANCHORS[i]);
            }
            anchor = anchor || findBtn('deal') || findBtn('hit') || findBtn('stand');
            if (!anchor || (hud && hud.contains(anchor))) return null;

            // Climb until the ancestor looks like a panel rather than a button
            // wrapper, and stop before we swallow the whole page.
            var node = anchor.parentElement, hops = 0;
            var maxW = Math.max(320, window.innerWidth * 0.75);
            while (node && node !== document.body && hops++ < 8) {
                var r = node.getBoundingClientRect();
                if (r.width >= 200 && r.height >= 120 && r.width <= maxW) return node;
                node = node.parentElement;
            }
            return null;
        }

        /* ---------------------------------------------------------------
           HUD + OVERLAY STYLES
           Chrome is driven by the --bj-* custom properties applyTheme() sets
           from the live page. The action colours are fixed on purpose.

           The toggles are drawn by us rather than being native checkboxes:
           Stake sets `appearance: none` on inputs site-wide, which turned a
           bare checkbox into a 14x14 fully transparent box — present and
           clickable, but invisible. Hence !important on the switch geometry.
           --------------------------------------------------------------- */
        var CSS = '' +
            '#bj-perfect-hud{--bj-surface:#0f212e;--bj-text:#b1bad3;--bj-accent:#1fff20;' +
            '--bj-radius:8px;--bj-font:inherit;--bj-line:rgba(255,255,255,.12);' +
            '--bj-sunk:rgba(0,0,0,.22);--bj-head:#fff;' +
            'box-sizing:border-box;width:100%;flex:0 0 auto;margin:10px 0 0;' +
            'background:var(--bj-surface,#0f212e);color:var(--bj-text,#b1bad3);border:1px solid var(--bj-line,rgba(255,255,255,.12));' +
            'border-radius:var(--bj-radius);font-family:var(--bj-font);font-size:12px;' +
            'overflow:hidden;user-select:none}' +
            '#bj-perfect-hud *{box-sizing:border-box}' +
            '#bj-perfect-hud.bj-float{position:fixed;top:20px;right:20px;width:246px;z-index:999999;' +
            'box-shadow:0 4px 20px rgba(0,0,0,.4)}' +
            '#bj-perfect-hud.bj-collapsed .bj-body{display:none}' +
            '#bj-perfect-hud .bj-advice{padding:10px 11px 0}' +
            /* Nothing follows the advice when collapsed, so it pays for its
               own bottom padding in that state. */
            '#bj-perfect-hud.bj-collapsed .bj-advice{padding-bottom:10px}' +
            '#bj-perfect-hud .bj-head{display:flex;align-items:center;justify-content:space-between;' +
            'padding:9px 11px;border-bottom:1px solid var(--bj-line,rgba(255,255,255,.12))}' +
            '#bj-perfect-hud .bj-title{font-weight:700;color:var(--bj-head,#fff);font-size:11px;' +
            'letter-spacing:.4px;text-transform:uppercase}' +
            '#bj-perfect-hud .bj-min{background:transparent;border:1px solid var(--bj-line,rgba(255,255,255,.12));' +
            'color:var(--bj-text,#b1bad3);width:20px;height:20px;border-radius:5px;cursor:pointer;' +
            'font-weight:800;line-height:1;padding:0}' +
            '#bj-perfect-hud .bj-min:hover{color:var(--bj-head,#fff)}' +
            '#bj-perfect-hud .bj-body{padding:10px 11px 11px}' +

            /* action tile — colours are semantic, never themed */
            '#bj-perfect-hud .bj-act{text-align:center;font-size:22px;font-weight:900;letter-spacing:1px;' +
            'padding:9px 0;border-radius:calc(var(--bj-radius) - 2px);background:var(--bj-sunk);' +
            'color:var(--bj-head,#fff);margin-bottom:7px}' +
            '#bj-perfect-hud .bj-act[data-a="HIT"]{background:#1fff20;color:#08130c}' +
            '#bj-perfect-hud .bj-act[data-a="STAND"]{background:#ef4444;color:#fff}' +
            '#bj-perfect-hud .bj-act[data-a="DOUBLE"]{background:#f59e0b;color:#1b1200}' +
            '#bj-perfect-hud .bj-act[data-a="SPLIT"]{background:#3b82f6;color:#fff}' +
            '#bj-perfect-hud .bj-why{text-align:center;font-size:10px;opacity:.72;margin:-3px 0 7px}' +
            '#bj-perfect-hud .bj-row{display:flex;justify-content:space-between;margin:4px 0;font-size:12px}' +
            '#bj-perfect-hud .bj-row span:last-child{color:var(--bj-head,#fff);font-weight:700}' +
            '#bj-perfect-hud .bj-ins{background:#7f1d1d;color:#fff;text-align:center;font-weight:800;' +
            'padding:5px;border-radius:5px;margin:6px 0;font-size:11px;display:none}' +
            '#bj-perfect-hud .bj-eq{margin:2px 0 8px}' +
            '#bj-perfect-hud .bj-eq-bar{display:flex;height:8px;border-radius:4px;overflow:hidden;' +
            'background:rgba(255,255,255,.08)}' +
            '#bj-perfect-hud .bj-eq-win{background:#1fff20}' +
            '#bj-perfect-hud .bj-eq-push{background:#94a3b8}' +
            '#bj-perfect-hud .bj-eq-lose{background:#ef4444}' +
            '#bj-perfect-hud .bj-eq-nums{display:flex;justify-content:space-between;gap:6px;' +
            'font-size:9px;font-weight:700;margin-top:3px;font-variant-numeric:tabular-nums}' +
            '#bj-perfect-hud .bj-eq-nums span:first-child{color:#1fff20}' +
            '#bj-perfect-hud .bj-eq-nums span:last-child{color:#ef4444}' +
            '#bj-perfect-hud .bj-sec{border-top:1px solid var(--bj-line,rgba(255,255,255,.12));margin-top:9px;padding-top:8px}' +
            '#bj-perfect-hud .bj-sec-t{color:var(--bj-accent,#1fff20);font-size:10px;font-weight:700;' +
            'text-transform:uppercase;letter-spacing:.6px;text-align:center;margin-bottom:6px}' +
            '#bj-perfect-hud .bj-chk{display:flex;align-items:center;justify-content:space-between;' +
            'margin:6px 0;font-size:11px;cursor:pointer;gap:8px}' +
            '#bj-perfect-hud .bj-warn{color:#f59e0b;font-size:10px;line-height:1.35;margin-top:4px}' +
            /* one-button Start/Stop, same idea as the Dice/Limbo rapid button */
            '#bj-perfect-hud .bj-run{width:100%;border:none;border-radius:8px;height:38px;cursor:pointer;' +
            'font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.5px;' +
            'background:var(--bj-accent,#1fff20);color:#0b1013;transition:background .15s,filter .15s}' +
            '#bj-perfect-hud .bj-run:hover{filter:brightness(1.08)}' +
            '#bj-perfect-hud .bj-run.bj-run-on{background:#ef4444;color:#fff}' +
            '#bj-perfect-hud .bj-rules{display:flex;flex-direction:column;gap:3px}' +
            '#bj-perfect-hud .bj-rule{font-size:10px;opacity:.82;padding-left:12px;position:relative}' +
            '#bj-perfect-hud .bj-rule:before{content:"·";position:absolute;left:3px;opacity:.6}' +
            '#bj-perfect-hud .bj-rule-note{color:#f59e0b;opacity:.9;padding-left:12px;line-height:1.35;margin-top:2px}' +
            '#bj-perfect-hud .bj-rule-note:before{content:"⚠";left:0;font-size:9px}' +
            '#bj-perfect-hud .bj-status{font-size:10px;opacity:.72;text-align:center;min-height:1.2em;margin-top:8px}' +
            '#bj-perfect-hud .bj-src{font-size:9px;opacity:.5;text-align:center;margin-top:2px}' +

            /* drawn switch — immune to the sites' input resets */
            '.bj-sw{position:relative!important;display:inline-block!important;width:34px!important;' +
            'height:18px!important;flex:0 0 34px!important}' +
            '.bj-sw input{position:absolute!important;inset:0!important;width:100%!important;' +
            'height:100%!important;margin:0!important;opacity:0!important;cursor:pointer;z-index:2}' +
            '.bj-sw .bj-tr{position:absolute;inset:0;border-radius:999px;background:rgba(255,255,255,.16);' +
            'border:1px solid var(--bj-line,rgba(255,255,255,.12));transition:background .15s}' +
            '.bj-sw .bj-th{position:absolute;top:3px;left:3px;width:12px;height:12px;border-radius:50%;' +
            'background:#9aa4b2;transition:transform .15s,background .15s}' +
            '.bj-sw input:checked ~ .bj-tr{background:var(--bj-accent,#1fff20);opacity:.9}' +
            '.bj-sw input:checked ~ .bj-tr .bj-th{transform:translateX(16px);background:#fff}' +
            '#bj-perfect-hud input[type=range]{width:92px;accent-color:var(--bj-accent,#1fff20);cursor:pointer;flex:none}' +

            /* small buttons */
            '#bj-perfect-hud .bj-btns{display:flex;gap:6px;margin-top:8px}' +
            '#bj-perfect-hud .bj-btn{flex:1;background:transparent;border:1px solid var(--bj-line,rgba(255,255,255,.12));' +
            'color:var(--bj-text,#b1bad3);border-radius:6px;padding:6px 4px;font-size:10px;font-weight:700;' +
            'text-transform:uppercase;letter-spacing:.4px;cursor:pointer;font-family:inherit}' +
            '#bj-perfect-hud .bj-btn:hover{color:var(--bj-head,#fff);border-color:var(--bj-accent,#1fff20)}' +

            /* ---------------- board overlay ---------------- */
            '#bj-board-overlay{--bj-surface:#0f212e;--bj-text:#b1bad3;--bj-accent:#1fff20;' +
            '--bj-line:rgba(255,255,255,.12);--bj-head:#fff;--bj-font:inherit;' +
            'position:absolute;inset:0;z-index:60;pointer-events:none;font-family:var(--bj-font);' +
            'color:var(--bj-text,#b1bad3);font-size:12px}' +
            '#bj-board-overlay *{box-sizing:border-box}' +
            /* Two columns pinned to the felt's edges. The middle — where the
               cards are dealt — is left empty and click-through on purpose.
               Nothing goes along the bottom: on Stake the player's cards reach
               to within 11px of the board's bottom edge. */
            '#bj-board-overlay .bj-ov-col{position:absolute;top:10px;bottom:10px;width:min(168px,21%);' +
            'display:flex;flex-direction:column;gap:3px;overflow:hidden}' +
            '#bj-board-overlay .bj-ov-l{left:10px}' +
            '#bj-board-overlay .bj-ov-r{right:10px}' +
            '#bj-board-overlay .bj-ov-t{font-size:9px;font-weight:800;letter-spacing:.8px;' +
            'text-transform:uppercase;color:var(--bj-accent,#1fff20);margin-bottom:3px;' +
            'text-shadow:0 1px 3px rgba(0,0,0,.9)}' +
            '#bj-board-overlay .bj-ov-t2{margin-top:9px}' +
            '#bj-board-overlay .bj-st{display:flex;justify-content:space-between;align-items:baseline;gap:6px;' +
            'padding:3px 7px;border-radius:5px;background:rgba(6,10,16,.62)}' +
            '#bj-board-overlay .bj-k{font-size:9px;text-transform:uppercase;letter-spacing:.4px;opacity:.7;' +
            'white-space:nowrap}' +
            '#bj-board-overlay .bj-v{font-size:11px;font-weight:800;color:var(--bj-head,#fff);' +
            'font-variant-numeric:tabular-nums;white-space:nowrap}' +
            '#bj-board-overlay .bj-v[data-sign="pos"]{color:#1fff20}' +
            '#bj-board-overlay .bj-v[data-sign="neg"]{color:#ef4444}' +
            '#bj-board-overlay .bj-spark{display:block;width:100%;height:60px;margin:6px 0 5px;' +
            'background:rgba(6,10,16,.62);border-radius:6px}' +
            '#bj-board-overlay .bj-hist{display:flex;gap:3px;flex-wrap:nowrap;justify-content:flex-end;' +
            'padding:4px 6px;border-radius:6px;background:rgba(6,10,16,.62);' +
            'margin-bottom:5px;overflow:hidden}' +
            '#bj-board-overlay .bj-hist:empty{display:none}' +
            '#bj-board-overlay .bj-chip{font-size:9px;font-weight:800;padding:2px 4px;border-radius:3px;' +
            'border:1px solid;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}' +
            '#bj-board-overlay .bj-chip.win{color:#1fff20;border-color:#1fff20;background:rgba(31,255,32,.10)}' +
            '#bj-board-overlay .bj-chip.loss{color:#ef4444;border-color:#ef4444;background:rgba(239,68,68,.10)}' +
            '#bj-board-overlay .bj-chip.push{color:#94a3b8;border-color:#94a3b8;background:rgba(148,163,184,.10)}' +
            '#bj-board-overlay .bj-ov-btns{display:flex;gap:5px;pointer-events:auto}' +
            '#bj-board-overlay .bj-btn{flex:1;background:rgba(6,10,16,.72);' +
            'border:1px solid rgba(255,255,255,.12);' +
            'color:var(--bj-text,#b1bad3);border-radius:5px;padding:5px 4px;font-size:9px;font-weight:700;' +
            'text-transform:uppercase;letter-spacing:.4px;cursor:pointer;font-family:inherit}' +
            '#bj-board-overlay .bj-btn:hover{color:var(--bj-head,#fff);border-color:var(--bj-accent,#1fff20)}' +
            /* Narrow boards (mobile) cannot spare two 168px gutters. These
               rules are only a fallback: relocateStatsCols() normally moves
               both columns out of the overlay and into the panel instead. */
            '@media (max-width:700px){' +
            '#bj-board-overlay .bj-ov-col{top:auto;bottom:6px;max-height:42%;width:calc(50% - 9px);overflow-y:auto;' +
            'padding:8px 9px;border-radius:11px;background:rgba(8,17,25,.94);border:1px solid rgba(255,255,255,.09);' +
            'box-shadow:0 10px 30px -14px rgba(0,0,0,.85)}' +
            '#bj-board-overlay .bj-ov-l{left:6px;right:auto}' +
            '#bj-board-overlay .bj-ov-r{right:6px;left:auto}' +
            '#bj-board-overlay .bj-ov-t{font-size:8px}' +
            '#bj-board-overlay .bj-spark{display:none}}' +

            /* Phone layout: the stat columns live at the bottom of the panel
               (see relocateStatsCols), restyled as stacked flow content. */
            '#bj-perfect-hud .bj-stats-dock{display:flex;flex-wrap:wrap;gap:10px 8px}' +
            '#bj-perfect-hud .bj-stats-dock .bj-sec-t{flex:1 1 100%;margin-bottom:0}' +
            '#bj-perfect-hud .bj-ov-col{flex:1 1 46%;min-width:132px;display:flex;flex-direction:column;gap:3px}' +
            '#bj-perfect-hud .bj-ov-t{font-size:9px;font-weight:800;letter-spacing:.8px;' +
            'text-transform:uppercase;color:var(--bj-accent,#1fff20);margin-bottom:3px}' +
            '#bj-perfect-hud .bj-ov-t2{margin-top:9px}' +
            '#bj-perfect-hud .bj-st{display:flex;justify-content:space-between;align-items:baseline;gap:6px;' +
            'padding:3px 7px;border-radius:5px;background:var(--bj-sunk,rgba(0,0,0,.22))}' +
            '#bj-perfect-hud .bj-k{font-size:9px;text-transform:uppercase;letter-spacing:.4px;opacity:.7;' +
            'white-space:nowrap}' +
            '#bj-perfect-hud .bj-v{font-size:11px;font-weight:800;color:var(--bj-head,#fff);' +
            'font-variant-numeric:tabular-nums;white-space:nowrap}' +
            '#bj-perfect-hud .bj-v[data-sign="pos"]{color:#1fff20}' +
            '#bj-perfect-hud .bj-v[data-sign="neg"]{color:#ef4444}' +
            '#bj-perfect-hud .bj-spark{display:block;width:100%;height:56px;margin:6px 0 5px;' +
            'background:var(--bj-sunk,rgba(0,0,0,.22));border-radius:6px}' +
            '#bj-perfect-hud .bj-hist{display:flex;gap:3px;flex-wrap:nowrap;justify-content:flex-end;' +
            'padding:4px 6px;border-radius:6px;background:var(--bj-sunk,rgba(0,0,0,.22));' +
            'margin-bottom:5px;overflow:hidden}' +
            '#bj-perfect-hud .bj-hist:empty{display:none}' +
            '#bj-perfect-hud .bj-chip{font-size:9px;font-weight:800;padding:2px 4px;border-radius:3px;' +
            'border:1px solid;min-width:18px;text-align:center;font-variant-numeric:tabular-nums}' +
            '#bj-perfect-hud .bj-chip.win{color:#1fff20;border-color:#1fff20;background:rgba(31,255,32,.10)}' +
            '#bj-perfect-hud .bj-chip.loss{color:#ef4444;border-color:#ef4444;background:rgba(239,68,68,.10)}' +
            '#bj-perfect-hud .bj-chip.push{color:#94a3b8;border-color:#94a3b8;background:rgba(148,163,184,.10)}' +
            '#bj-perfect-hud .bj-ov-btns{display:flex;gap:5px}' +

            /* full takeover, only while auto-play is driving */
            '#bj-board-overlay .bj-ov-stage{position:absolute;inset:0;display:none;align-items:center;' +
            'justify-content:center;flex-direction:column;gap:14px;' +
            'background:rgba(4,8,12,.90);pointer-events:auto}' +
            '#bj-board-overlay.bj-ov-live .bj-ov-stage{display:flex}' +
            '#bj-board-overlay .bj-ov-badge{font-size:10px;font-weight:800;letter-spacing:1.4px;' +
            'text-transform:uppercase;color:var(--bj-accent,#1fff20);border:1px solid var(--bj-accent,#1fff20);' +
            'border-radius:999px;padding:4px 12px}' +
            '#bj-board-overlay .bj-ov-cards{display:flex;gap:22px;align-items:center;' +
            'max-width:90vw;overflow:hidden}' +
            '#bj-board-overlay .bj-cards{flex-wrap:wrap;justify-content:center;max-width:44vw;overflow:hidden}' +
            '#bj-board-overlay .bj-ov-stage{overflow:hidden}' +
            '#bj-board-overlay .bj-side{text-align:center}' +
            '#bj-board-overlay .bj-side-k{font-size:9px;text-transform:uppercase;letter-spacing:1px;' +
            'opacity:.6;margin-bottom:5px}' +
            '#bj-board-overlay .bj-cards{display:flex;gap:5px;justify-content:center}' +
            '#bj-board-overlay .bj-card{width:38px;height:54px;border-radius:5px;background:#f8fafc;' +
            'color:#0b0e17;font-weight:900;font-size:17px;display:flex;align-items:center;' +
            'justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,.5)}' +
            '#bj-board-overlay .bj-side-tot{margin-top:6px;font-size:12px;font-weight:800;color:var(--bj-head,#fff)}' +
            '#bj-board-overlay .bj-ov-act{font-size:34px;font-weight:900;letter-spacing:2px;padding:8px 26px;' +
            'border-radius:10px;background:rgba(255,255,255,.08);color:var(--bj-head,#fff)}' +
            '#bj-board-overlay .bj-ov-act[data-a="HIT"]{background:#1fff20;color:#08130c}' +
            '#bj-board-overlay .bj-ov-act[data-a="STAND"]{background:#ef4444;color:#fff}' +
            '#bj-board-overlay .bj-ov-act[data-a="DOUBLE"]{background:#f59e0b;color:#1b1200}' +
            '#bj-board-overlay .bj-ov-act[data-a="SPLIT"]{background:#3b82f6;color:#fff}';

        (function addStyleOnce() {
            if (document.getElementById('bj-perfect-css')) return;
            var viaGM = false;
            // GM_addStyle is granted in the desktop bundle; the mobile bundle
            // runs under @grant none, where the identifier does not exist.
            try { if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); viaGM = true; } } catch (e) {}
            var marker = document.createElement(viaGM ? 'meta' : 'style');
            marker.id = 'bj-perfect-css';
            if (!viaGM) marker.textContent = CSS;
            (document.head || document.documentElement).appendChild(marker);
        })();

        var hud = null, overlay = null;
        var elAct, elWhy, elIns, elStat, elSrc, elWarn;
        var elEq, elEqWin, elEqPush, elEqLose, elEqWt, elEqPt, elEqLt;
        /* What we last read off the table. Not rendered — the board already
           shows it — but exposed for debugging and for the test harness. */
        var lastRead = null;

        function setStatus(t) { if (elStat) elStat.textContent = t || ''; }

        /** A switch we draw ourselves — see the CSS note about appearance:none. */
        function sw(key, label) {
            return '<label class="bj-chk"><span>' + label + '</span>' +
                   '<span class="bj-sw"><input type="checkbox" data-bj-k="' + key + '">' +
                   '<span class="bj-tr"><span class="bj-th"></span></span></span></label>';
        }

        function paintRunBtn(btn) {
            btn = btn || (hud && hud.querySelector('[data-bj-run]'));
            if (!btn) return;
            btn.textContent = running ? 'Stop' : 'Start autoplay';
            btn.classList.toggle('bj-run-on', running);
        }

        function buildHud() {
            var h = document.createElement('div');
            h.id = 'bj-perfect-hud';
            if (cfg.collapsed) h.className = 'bj-collapsed';
            h.innerHTML =
                '<div class="bj-head">' +
                  '<div class="bj-title">Perfect Blackjack <span style="opacity:.55;font-weight:600">v' + BJ_VERSION + '</span></div>' +
                  '<button class="bj-min" type="button">' + (cfg.collapsed ? '+' : '–') + '</button>' +
                '</div>' +
                /* Only what the game does not already tell you. The board
                   renders both hands and their totals itself, so repeating
                   them here would just be noise. The statistics live on the
                   felt; this panel is the advice plus the controls. */
                /* The call sits OUTSIDE .bj-body: collapsing the panel must
                   still leave the advice on screen, because playing the hand
                   manually is exactly when you want it and the collapsed
                   panel is what keeps the felt visible on a phone. */
                '<div class="bj-advice">' +
                  '<div class="bj-act" data-a="">—</div>' +
                  '<div class="bj-why"></div>' +
                  '<div class="bj-ins">NEVER TAKE INSURANCE</div>' +
                '</div>' +
                '<div class="bj-body">' +
                  '<div class="bj-eq" data-bj-eq style="display:none">' +
                    '<div class="bj-eq-bar"><span class="bj-eq-win" data-bj-eq-win></span>' +
                      '<span class="bj-eq-push" data-bj-eq-push></span>' +
                      '<span class="bj-eq-lose" data-bj-eq-lose></span></div>' +
                    '<div class="bj-eq-nums"><span data-bj-eq-wt>—</span>' +
                      '<span data-bj-eq-pt></span><span data-bj-eq-lt></span></div>' +
                  '</div>' +
                  '<div class="bj-sec">' +
                    '<div class="bj-sec-t">Automation</div>' +
                    '<button type="button" class="bj-run" data-bj-run>Start autoplay</button>' +
                    '<div class="bj-warn" data-bj-warn>Autoplay deals and plays basic strategy on its own — ' +
                      'it wagers every hand until you press Stop.</div>' +
                  '</div>' +
                  '<div class="bj-status"></div>' +
                  '<div class="bj-src"></div>' +
                '</div>';

            elAct   = h.querySelector('.bj-act');
            elWhy   = h.querySelector('.bj-why');
            elIns   = h.querySelector('.bj-ins');
            elStat  = h.querySelector('.bj-status');
            elSrc   = h.querySelector('.bj-src');
            elWarn  = h.querySelector('[data-bj-warn]');
            elEq    = h.querySelector('[data-bj-eq]');
            elEqWin = h.querySelector('[data-bj-eq-win]');
            elEqPush= h.querySelector('[data-bj-eq-push]');
            elEqLose= h.querySelector('[data-bj-eq-lose]');
            elEqWt  = h.querySelector('[data-bj-eq-wt]');
            elEqPt  = h.querySelector('[data-bj-eq-pt]');
            elEqLt  = h.querySelector('[data-bj-eq-lt]');

            h.querySelectorAll('[data-bj-k]').forEach(function (inp) {
                var k = inp.getAttribute('data-bj-k');
                if (inp.type === 'checkbox') inp.checked = !!cfg[k];
                else inp.value = cfg[k];
                inp.addEventListener('input', function () {
                    cfg[k] = inp.type === 'checkbox' ? inp.checked : Number(inp.value);
                    saveCfg();
                });
            });

            // One Start/Stop button drives the whole autoplay loop.
            var runBtn = h.querySelector('[data-bj-run]');
            if (runBtn) {
                paintRunBtn(runBtn);
                runBtn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    running = !running;
                    if (!running) lastActedHash = '';
                    paintRunBtn(runBtn);
                    setStatus(running ? 'autoplay running' : 'stopped');
                });
            }

            h.querySelector('.bj-min').addEventListener('click', function (e) {
                e.stopPropagation();
                cfg.collapsed = !cfg.collapsed;
                h.classList.toggle('bj-collapsed', cfg.collapsed);
                e.currentTarget.textContent = cfg.collapsed ? '+' : '–';
                saveCfg();
            });

            // The betting column stops clicks from bubbling in places; keep our
            // own controls from reaching the game's handlers either way.
            h.addEventListener('click', function (e) { e.stopPropagation(); });
            return h;
        }

        /** Describe a container well enough to debug a bad dock from a report. */
        function describe(el) {
            if (!el) return '?';
            var cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/)[0];
            return (el.tagName || '').toLowerCase() + (cls ? '.' + cls : '') +
                   (el.getAttribute && el.getAttribute('data-testid')
                        ? '[' + el.getAttribute('data-testid') + ']' : '');
        }

        /** Re-dock if the site re-rendered our container out from under us. */
        function ensureMounted() {
            var dock = findDock();

            if (!dock) {
                // Give the game a few seconds to render before giving up: a
                // panel nobody can see is worse than one in the wrong place.
                if (!floatFallback) {
                    if (++dockMissTicks < 30) return;
                    floatFallback = true;
                }
                if (!hud) hud = buildHud();
                hud.classList.add('bj-float');
                if (hud.parentElement !== document.body) {
                    document.body.appendChild(hud);
                    setStatus('betting panel not found — floating');
                }
                return;
            }

            if (!hud) hud = buildHud();
            dockMissTicks = 0;
            if (hud.parentElement === dock) return;      // hot path: already docked

            // Re-dock even if we had already fallen back to floating — the
            // panel may simply have taken longer than 10s to render.
            floatFallback = false;
            hud.classList.remove('bj-float');
            // Moles does the same before appending: the panel is a normal block
            // child, but the column is often a positioning context for overlays.
            if (getComputedStyle(dock).position === 'static') dock.style.position = 'relative';
            applyTheme(hud, dock);          // inherit the site's surface + accent
            dock.appendChild(hud);
            setStatus('docked: ' + describe(dock));
        }

        function unmount() {
            if (hud && hud.parentElement) hud.parentElement.removeChild(hud);
            if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
            dockMissTicks = 0;
        }

        /* ---------------------------------------------------------------
           BOARD OVERLAY
           A stats surface over the felt, in the spirit of the Moles board
           lock. Idle it is a click-through card in the corner, so it never
           swallows a click meant for a card. While auto-play is driving it
           takes the whole board and renders the hand large — you are not
           reading the table at that point anyway.
           --------------------------------------------------------------- */
        var ovEls = null, spark = null, sparkCtx = null;

        function stat(key, label) {
            return '<div class="bj-st"><span class="bj-k">' + label + '</span>' +
                   '<span class="bj-v" data-s="' + key + '">—</span></div>';
        }

        function buildOverlay() {
            var o = document.createElement('div');
            o.id = 'bj-board-overlay';
            o.innerHTML =
                /* Full takeover, only while auto-play is driving the hand. */
                '<div class="bj-ov-stage">' +
                  '<div class="bj-ov-badge">Auto-play</div>' +
                  '<div class="bj-ov-cards">' +
                    '<div class="bj-side"><div class="bj-side-k">Dealer</div>' +
                      '<div class="bj-cards" data-ov-dealer></div>' +
                      '<div class="bj-side-tot" data-ov-dealer-tot></div></div>' +
                    '<div class="bj-side"><div class="bj-side-k">You</div>' +
                      '<div class="bj-cards" data-ov-player></div>' +
                      '<div class="bj-side-tot" data-ov-player-tot></div></div>' +
                  '</div>' +
                  '<div class="bj-ov-act" data-ov-act>—</div>' +
                '</div>' +

                /* Stats hug the edges of the felt; the middle stays clear so
                   the real cards are never covered. */
                '<div class="bj-ov-col bj-ov-l">' +
                  '<div class="bj-ov-t">Session</div>' +
                  stat('hands', 'Hands') +
                  stat('wlp', 'W / L / P') +
                  stat('wr', 'Win rate') +
                  stat('streak', 'Streak') +
                  stat('streakrec', 'Best / worst') +
                  stat('bj', 'Your blackjacks') +
                  stat('dbj', 'Dealer blackjacks') +
                  stat('busts', 'Busts') +
                  '<div class="bj-ov-t bj-ov-t2">Doubles &amp; splits</div>' +
                  stat('dbl', 'Doubles W / L') +
                  stat('spl', 'Split W/L/P') +
                  '<div class="bj-ov-t bj-ov-t2">Strategy</div>' +
                  stat('adh', 'Correct plays') +
                '</div>' +

                '<div class="bj-ov-col bj-ov-r">' +
                  '<div class="bj-ov-t">Money</div>' +
                  stat('wagered', 'Wagered') +
                  stat('returned', 'Returned') +
                  stat('pnl', 'Net') +
                  stat('rtp', 'RTP') +
                  stat('biggest', 'Biggest win') +
                  '<canvas class="bj-spark" width="300" height="120"></canvas>' +
                  '<div class="bj-hist" data-ov-hist></div>' +
                  '<div class="bj-ov-btns">' +
                    '<button class="bj-btn" data-ov="csv" type="button">CSV</button>' +
                    '<button class="bj-btn" data-ov="reset" type="button">Reset</button>' +
                  '</div>' +
                '</div>';

            ovEls = {
                stage: o.querySelector('.bj-ov-stage'),
                act: o.querySelector('[data-ov-act]'),
                dealer: o.querySelector('[data-ov-dealer]'),
                dealerTot: o.querySelector('[data-ov-dealer-tot]'),
                player: o.querySelector('[data-ov-player]'),
                playerTot: o.querySelector('[data-ov-player-tot]'),
                hist: o.querySelector('[data-ov-hist]'),
                // Kept by reference: relocateStatsCols() re-parents these on
                // phones, after which o.querySelector can't find them.
                colL: o.querySelector('.bj-ov-l'),
                colR: o.querySelector('.bj-ov-r'),
                s: {}
            };
            o.querySelectorAll('[data-s]').forEach(function (e) { ovEls.s[e.getAttribute('data-s')] = e; });
            spark = o.querySelector('.bj-spark');
            sparkCtx = spark && spark.getContext ? spark.getContext('2d') : null;

            o.querySelector('[data-ov="csv"]').addEventListener('click', function (e) {
                e.stopPropagation(); exportCsv();
            });
            o.querySelector('[data-ov="reset"]').addEventListener('click', function (e) {
                e.stopPropagation();
                var b = e.currentTarget;
                if (b.dataset.armed) {
                    resetStats(); lastStatsHash = ''; lastLogLen = -1;
                    delete b.dataset.armed; b.textContent = 'Reset';
                    return;
                }
                b.dataset.armed = '1';                 // two-step: stats are not recoverable
                b.textContent = 'Sure?';
                setTimeout(function () {
                    if (!o.isConnected) return;
                    var again = o.querySelector('[data-ov="reset"]');
                    if (again && again.dataset.armed) { delete again.dataset.armed; again.textContent = 'Reset'; }
                }, 3000);
            });
            return o;
        }

        /* Phones cannot spare the felt: the two stat columns cover the cards
           and clip against the board's edge (the mobile board is barely
           taller than they are — seen on stake.us iOS). Below 700px they move
           out of the overlay and dock at the bottom of the panel instead.
           Same elements, so paintOverlay keeps writing to them; the auto-play
           stage stays with the overlay on the board. Checked every tick so a
           rotation or split-screen resize swaps the layout both ways. */
        function relocateStatsCols() {
            if (!ovEls || !ovEls.colL || !ovEls.colR) return;
            var narrow = (window.innerWidth || 0) <= 700;
            var body = hud && hud.isConnected ? hud.querySelector('.bj-body') : null;
            if (narrow && body) {
                var dk = body.querySelector('.bj-stats-dock');
                if (!dk) {
                    dk = document.createElement('div');
                    dk.className = 'bj-sec bj-stats-dock';
                    dk.innerHTML = '<div class="bj-sec-t">Session stats</div>';
                    body.appendChild(dk);
                }
                dk.style.display = '';
                if (ovEls.colL.parentElement !== dk) {
                    dk.appendChild(ovEls.colL);
                    dk.appendChild(ovEls.colR);
                }
            } else if (overlay && ovEls.colL.parentElement !== overlay) {
                overlay.appendChild(ovEls.colL);
                overlay.appendChild(ovEls.colR);
                var old = hud && hud.querySelector('.bj-stats-dock');
                if (old && old.parentElement) old.parentElement.removeChild(old);
            }
        }

        function ensureOverlay() {
            if (!cfg.overlay) {
                if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
                var dk = hud && hud.querySelector('.bj-stats-dock');
                if (dk) dk.style.display = 'none';
                return;
            }
            // Build even before the board is found: on phones the stat columns
            // dock into the panel, which can be ready before board detection.
            if (!overlay) overlay = buildOverlay();
            var board = findBoard();
            if (board && overlay.parentElement !== board) {
                if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
                applyTheme(overlay, board);
                board.appendChild(overlay);
            }
            relocateStatsCols();
        }

        /* Nuts lays the felt and this betting column out as equal-height flex
           siblings, so docking a panel taller than the felt stretches the board
           to match and shoves the player's cards off the bottom of the screen.
           Opt the board out of that stretch so it keeps its natural height.
           Re-applied every tick because a fresh deal can re-render the board and
           drop the inline style. Stake/Shuffle don't lay out this way, so this is
           scoped to Nuts to avoid touching a layout that already works. */
        function pinNutsBoard() {
            if (!isNut) return;
            try {
                var bd = findBoard();
                if (bd && bd.style.alignSelf !== 'flex-start') bd.style.alignSelf = 'flex-start';
            } catch (e) {}
        }

        function fmtMoney(n) {
            if (!isFinite(n)) return '—';
            var a = Math.abs(n);
            if (a >= 1000) return n.toFixed(0);
            if (a >= 1) return n.toFixed(2);
            return n.toFixed(4);
        }
        function signed(n) { return (n >= 0 ? '+' : '') + fmtMoney(n); }
        function signOf(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : ''; }

        function paintSpark() {
            if (!sparkCtx || !spark) return;
            var w = spark.width, h = spark.height, pad = 3;
            sparkCtx.clearRect(0, 0, w, h);
            var data = stats.log.slice(-160);
            if (data.length < 2) return;
            var lo = 0, hi = 0;
            data.forEach(function (r) { if (r.pnl < lo) lo = r.pnl; if (r.pnl > hi) hi = r.pnl; });
            if (hi === lo) hi = lo + 1e-9;
            var xs = function (i) { return pad + i * (w - 2 * pad) / (data.length - 1); };
            var ys = function (v) { return h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad); };

            if (lo < 0 && hi > 0) {                       // zero line
                sparkCtx.strokeStyle = 'rgba(255,255,255,.14)';
                sparkCtx.setLineDash([3, 3]);
                sparkCtx.beginPath(); sparkCtx.moveTo(0, ys(0)); sparkCtx.lineTo(w, ys(0)); sparkCtx.stroke();
                sparkCtx.setLineDash([]);
            }
            var end = data[data.length - 1].pnl;
            var col = end >= 0 ? '#1fff20' : '#ef4444';
            sparkCtx.beginPath();
            sparkCtx.moveTo(xs(0), ys(data[0].pnl));
            for (var i = 1; i < data.length; i++) sparkCtx.lineTo(xs(i), ys(data[i].pnl));
            sparkCtx.strokeStyle = col; sparkCtx.lineWidth = 1.5; sparkCtx.stroke();
            sparkCtx.lineTo(xs(data.length - 1), h - pad); sparkCtx.lineTo(xs(0), h - pad);
            sparkCtx.closePath();
            sparkCtx.fillStyle = end >= 0 ? 'rgba(31,255,32,.12)' : 'rgba(239,68,68,.12)';
            sparkCtx.fill();
        }

        var lastLogLen = -1, lastStatsHash = '';
        function paintOverlay(a) {
            if (!overlay || !ovEls) return;

            // The full-board takeover (a dimming backdrop with the cards and the
            // action redrawn large) is deliberately disabled during autoplay:
            // you are watching the real table, so darkening it and repeating the
            // cards you can already see just gets in the way. Only the corner
            // stat columns stay up.
            overlay.classList.remove('bj-ov-live');

            var hash = stats.hands + '|' + stats.decisions + '|' + stats.log.length + '|' + pnl().toFixed(6);
            if (hash === lastStatsHash) return;           // stats only change on resolution
            lastStatsHash = hash;

            var s = ovEls.s, p = pnl(), r = rtp(), wr = winRate(), ad = adherence();
            s.hands.textContent = stats.hands;
            s.wlp.textContent = stats.wins + ' / ' + stats.losses + ' / ' + stats.pushes;
            s.wr.textContent = wr == null ? '—' : wr.toFixed(1) + '%';
            s.streak.textContent = (stats.streak > 0 ? 'W' + stats.streak
                                  : stats.streak < 0 ? 'L' + (-stats.streak) : '—');
            s.streak.setAttribute('data-sign', signOf(stats.streak));
            s.streakrec.textContent = 'W' + (stats.bestStreak || 0) + ' / L' + (-(stats.worstStreak || 0));
            s.bj.textContent = stats.blackjacks;
            s.dbj.textContent = stats.dealerBlackjacks;
            s.busts.textContent = stats.busts;
            s.dbl.textContent = stats.doublesWon + ' / ' + stats.doublesLost +
                                (stats.doubles ? '  (' + stats.doubles + ')' : '');
            s.spl.textContent = stats.splitsWon + ' / ' + stats.splitsLost + ' / ' + stats.splitsPushed;

            s.wagered.textContent = stats.hands ? fmtMoney(stats.wagered) : '—';
            s.returned.textContent = stats.hands ? fmtMoney(stats.returned) : '—';
            s.pnl.textContent = stats.hands ? signed(p) : '—';
            s.pnl.setAttribute('data-sign', signOf(p));
            s.rtp.textContent = r == null ? '—' : r.toFixed(1) + '%';
            s.biggest.textContent = stats.hands ? fmtMoney(stats.biggest) : '—';

            s.adh.textContent = ad == null ? '—'
                : ad.toFixed(0) + '%  (' + stats.correct + '/' + stats.decisions + ')';
            s.adh.setAttribute('data-sign', ad == null ? '' : ad >= 99 ? 'pos' : ad < 90 ? 'neg' : '');

            if (stats.log.length !== lastLogLen) {
                lastLogLen = stats.log.length;
                ovEls.hist.innerHTML = stats.log.slice(-22).map(function (r2) {
                    var cls = r2.outcome === 'win' ? 'win' : r2.outcome === 'push' ? 'push' : 'loss';
                    var lbl = r2.outcome === 'win' ? (r2.mult ? r2.mult + '×' : 'W')
                            : r2.outcome === 'push' ? 'P' : 'L';
                    return '<span class="bj-chip ' + cls + '">' + lbl + '</span>';
                }).join('');
                paintSpark();
            }
        }

        function paint() {
            var insBtn = findBtn('insurance') ||
                         Array.prototype.find.call(
                             document.querySelectorAll('button, [role="button"]'),
                             function (b) { return !hud.contains(b) && /insurance/i.test(b.textContent || ''); });
            elIns.style.display = clickable(insBtn) ? 'block' : 'none';

            var a = advise();
            lastAdvice = a.st ? a : null;       // the adherence listener reads this
            // Guard the bookkeeping/overlay calls: a throw in either (e.g. while a split
            // is mid-transition) must NOT abort paint before it refreshes the advice +
            // lastRead below, or the panel freezes on its last text ("no hand detected").
            try { if (a.st) trackState(a.st); } catch (e) {}
            try { paintOverlay(a); } catch (e) {}

            if (!a.st) {
                lastRead = null;
                elAct.textContent = '—'; elAct.setAttribute('data-a', '');
                elWhy.textContent = '';
                elEq.style.display = 'none';
                elSrc.textContent = 'no hand detected';
                return;
            }

            // Live win chance for the acting hand, updated each card.
            if (a.eq) {
                var wp = Math.round(a.eq.win * 100), pp = Math.round(a.eq.push * 100),
                    lp = Math.max(0, 100 - wp - pp);
                elEqWin.style.width = wp + '%';
                elEqPush.style.width = pp + '%';
                elEqLose.style.width = lp + '%';
                elEqWt.textContent = 'Win ' + wp + '%';
                elEqPt.textContent = pp > 0 ? 'Push ' + pp + '%' : '';
                elEqLt.textContent = 'Lose ' + lp + '%';
                elEq.style.display = '';
            } else {
                elEq.style.display = 'none';
            }

            var turn = clickable(findBtn('hit'));
            elAct.textContent = turn ? a.dec.action : '—';
            elAct.setAttribute('data-a', turn ? a.dec.action : '');
            // On a split the board does not say which box we are advising on,
            // so that — and only that — is worth spelling out.
            elWhy.textContent = !turn ? 'not your turn'
                : a.st.hands.length > 1
                    ? a.dec.why + '  ·  hand ' + (a.st.hands.indexOf(a.hand) + 1) + '/' + a.st.hands.length
                    : a.dec.why;
            elSrc.textContent = a.st.source === 'net'
                ? (a.st.bet ? 'reading game data' : 'reading game data (no wager info)')
                : 'reading board (fallback)';

            lastRead = {
                hand: a.hand.cards.join(' '), total: a.info.total, soft: a.info.soft,
                up: a.up, source: a.st.source, action: turn ? a.dec.action : '—',
                why: a.dec.why, hands: a.st.hands.length,
                handIndex: a.st.hands.indexOf(a.hand) + 1
            };
        }

        /* Reconcile every tick rather than self-destructing on detach: our
           container belongs to the site and can be re-rendered at any time. */
        setInterval(function () {
            try {
                if (!isOnBjPage() || !bjEnabled()) { unmount(); return; }
                ensureMounted();
                if (!hud || !hud.isConnected) return;
                pinNutsBoard();
                ensureOverlay();
                paint();
                autoTick();
            } catch (e) { /* never let one bad tick kill the loop */ }
        }, 350);

        // Exposed so the strategy tables can be checked against the published
        // charts without re-implementing decide() in the test, and so the hand
        // we are reading can be inspected even though the panel no longer
        // repeats what the board already shows.
        try {
            PAGE_WIN.__bjInternals = {
                decide: decide, handInfo: handInfo, cfg: cfg, stats: function () { return stats; },
                read: function () { return lastRead; },
                handEquity: handEquity, dealerDist: dealerDist,
                isRunning: function () { return running; },
                setRunning: function (v) { running = !!v; if (!running) lastActedHash = ''; paintRunBtn(); }
            };
        } catch (e) {}
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
    function isOnMolesPage() { return false; }
    function isOnAnyCasinoPage() { return false; }
    function tool_keno() {}
    function tool_mines() {}
    function tool_moles() {}
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
