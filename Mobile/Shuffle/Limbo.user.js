// ==UserScript==
// @name         Shuffle Limbo — Mobile
// @namespace    http://tampermonkey.net/
// @version      6.09
// @description  Standalone single-tool mobile build, extracted from the unified mobile bundle.
// @author       .
// @match        https://shuffle.com/*
// @match        https://shuffle.us/*
// @grant        none
// @run-at       document-start
// @noframes
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Mobile/Shuffle/Limbo.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Mobile/Shuffle/Limbo.user.js
// ==/UserScript==

(function () {
    'use strict';

    try { console.log('[Shuffle Limbo — Mobile] standalone build v6.09'); } catch (e) {}


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
        id: 'shuffle-limbo', name: 'Shuffle Limbo', group: 'Shuffle',
        description: 'Manual / IOW / Smart bet-progression HUD for limbo.',
        matches: ['https://shuffle.us/games/originals/limbo*', 'https://shuffle.com/games/originals/limbo*',],
        defaultEnabled: true, hijacksPage: true
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
        if (isShuffle()) return /\/games\/originals\/(limbo)(?:\/|$|\?|#)/i.test(path);
        if (isNuts()) return /\/dice(?:\/|$|\?|#)/i.test(path);
        return /\/casino\/games\/(limbo)(?:\/|$|\?|#)/i.test(path);
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
    /* Nuts needs a longer stall window than Stake/Shuffle. It is the one site
       with no bet feed on mobile, so a bet is only "seen" via the socket frame
       or a balance move; over cellular, with the roll animation in front of it,
       4s is routinely just a slow round rather than a freeze. The guard is a
       safety net for a genuinely dead loop, not a pace-keeper. */
    const RAPID_STALL_STOP_MS_NUTS = 12000;
    function stallStopMs() { return isNuts() ? RAPID_STALL_STOP_MS_NUTS : RAPID_STALL_STOP_MS; }
    /* When the page last became visible again — see monitorRapidFireHealth. */
    let rapidVisibleAgainAt = 0;
    const RAPID_CLICK_INTERVAL_MS = 180;

    /* ============================================================
       GAME SPEED (Nuts dice)
       ------------------------------------------------------------
       What actually paces autoplay is not our click loop — that already
       fires the instant the site re-enables PLAY — it is the site's own roll
       animation and settle delay, which run off setTimeout / setInterval /
       requestAnimationFrame. Dividing those delays shortens the round.
       This changes NOTHING about the wager, the odds or the result: the
       outcome is decided server-side and merely displayed faster.

       Two things make this safe to embed rather than run as a separate script:

       1. The natives are captured HERE, at module scope, before any patch can
          exist — and our own loops use the captured ones. Otherwise the patch
          would also divide our click poll (180ms -> 18ms at 10x) and the HUD
          ticker, burning phone battery for no gain and changing timing the
          watchdogs were tuned against.
       2. The wrapper is installed ONCE and reads the multiplier through a
          variable, so changing speed never re-wraps an already-wrapped
          function (which is how these hooks usually end up nested).
       ============================================================ */
    const NATIVE_SET_INTERVAL   = window.setInterval.bind(window);
    const NATIVE_CLEAR_INTERVAL = window.clearInterval.bind(window);
    const GAME_SPEED = 10;            // fixed; no setting, by design
    let speedNatives = null;          // the originals, once the hook is installed
    let speedActive = false;          // true ONLY while on Nuts dice

    /** Nuts dice and nothing else. */
    function speedSupported() { return isNuts() && isOnDicePage(); }

    function installSpeedHook() {
        if (speedNatives) return;
        speedNatives = {
            setTimeout: window.setTimeout,
            setInterval: window.setInterval,
            requestAnimationFrame: window.requestAnimationFrame
        };
        /* The divisor is read through speedActive on every call rather than
           baked in. A hook can be installed but never safely REMOVED — the page
           has already handed our wrapper to its own code — so "dice only" has to
           mean "divides only while on dice". Navigating to another Nuts game
           leaves the wrapper in place but back at 1:1. */
        const div = () => (speedActive ? GAME_SPEED : 1);
        window.setTimeout = function (fn, delay) {
            const rest = Array.prototype.slice.call(arguments, 2);
            return speedNatives.setTimeout.apply(window, [fn, (delay || 0) / div()].concat(rest));
        };
        window.setInterval = function (fn, delay) {
            const rest = Array.prototype.slice.call(arguments, 2);
            return speedNatives.setInterval.apply(window, [fn, (delay || 0) / div()].concat(rest));
        };
        /* Timestamp-driven animations advance by the clock they are handed, so
           scaling the timestamp speeds those up the same way the delay divisor
           speeds up timer-driven ones. */
        window.requestAnimationFrame = function (cb) {
            return speedNatives.requestAnimationFrame.call(window, function (ts) { cb(ts * div()); });
        };
    }
    /** Called from the 600ms ticker, which runs on every page — buildHUD() does
     *  not, so it cannot be the thing that turns the speed-up back off when you
     *  navigate from dice to another Nuts game. */
    function refreshGameSpeed() {
        speedActive = speedSupported();
        if (speedActive) installSpeedHook();
    }
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
    /* Set ONLY when a bet is counted from a past-bets TILE. The balance
       watcher defers to this so it never double counts on layouts where the
       feed works — it must NOT use lastObservedBetTime, which the watcher
       itself updates: that made every bet inside 1.2s of the previous one
       get discarded, so back-to-back rolls were dropped AND their win/loss
       was lost (a swallowed win reads as a loss to the engine). */
    let lastTileBetTime = 0;
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
            top: 0 !important; left: 0 !important; right: 0 !important;
            /* Height is auto (content-driven), not a forced 100% fill — see the
               [data-tools-active] override below and the buildHUD() comment for why. */
            height: auto !important;
            width: 100% !important;
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
        /* Advanced IOW (data-tools-active="1", set by the cross-tool integration)
           keeps the old pinned/filled layout: its own Optimizer/Results tables can
           get long and manage their own internal scrolling (.dt-body{overflow:auto}
           below), so the outer HUD should stay a fixed, filled box rather than
           growing to fit an arbitrarily long table. Manual/IOW/Smart (the default,
           below) instead sizes to its own natural content height — see buildHUD(). */
        #ratchet-master-container[data-tools-active="1"] {
            bottom: 0 !important;
            height: 100% !important;
        }
        #ratchet-master-container .hud-frame {
            display: flex; flex-direction: column;
            flex: 0 0 auto; gap: 4px; overflow: hidden;
        }
        #ratchet-master-container[data-tools-active="1"] .hud-frame {
            flex: 1 1 0; min-height: 0;
        }
        #ratchet-master-container .hud-workspace {
            display: flex; flex-direction: column;
            flex: 0 0 auto; gap: 4px;
            /* No internal scroll — the host's height is measured & set (in JS, see
               buildHUD()) to match this area's natural content exactly, so nothing
               ever needs to scroll to be reached. The interactive controls each own
               their touch gesture regardless (slider touch-action:none, buttons
               manipulation), so this is also safe if scrolling is ever restored. */
            overflow: visible;
        }
        #ratchet-master-container[data-tools-active="1"] .hud-workspace {
            flex: 1 1 0; min-height: 0;
            overflow-y: auto; overflow-x: hidden;
            -webkit-overflow-scrolling: touch; scrollbar-width: thin;
        }
        #ratchet-master-container[data-tools-active="1"] .hud-workspace::-webkit-scrollbar { width: 4px; }
        #ratchet-master-container[data-tools-active="1"] .hud-workspace::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15); border-radius: 2px;
        }
        #ratchet-master-container .hud-native-sidebar-slot { display: none !important; }
        #ratchet-master-container .hud-native-past-bets-slot {
            display: flex; flex: 0 0 auto; min-height: 38px;
            overflow: hidden;
        }
        #ratchet-master-container .hud-native-past-bets-slot:empty { display: none; }
        /* Nuts's feed (.sc-9b1418e2-1) is re-parented into this slot by
           syncNativeHudElements(), but these two rules only ever named Stake's
           .past-bets and Shuffle's wrapper — so on Nuts the strip landed inside
           the HUD with no width, padding or background, in a 30px
           overflow:hidden box. The bets were there, just invisible: "there is,
           you just have it covered". */
        #ratchet-master-container .hud-native-past-bets-slot > .past-bets,
        #ratchet-master-container .hud-native-past-bets-slot > .sc-9b1418e2-1,
        #ratchet-master-container .hud-native-past-bets-slot > .sc-9b1418e2-0,
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
        #ratchet-master-container .hud-native-past-bets-slot > .sc-9b1418e2-1 > *,
        #ratchet-master-container .hud-native-past-bets-slot > .sc-9b1418e2-0 > *,
        #ratchet-master-container .hud-native-past-bets-slot > [class*="OriginalGameRecentResult_originalGameResultsWrapper"] > * {
            flex: 0 0 auto !important;
        }
        /* Our OWN results strip, for Nuts only.
           Verified against the live logged-in page 2026-07-26: .sc-9b1418e2-1 does
           not exist at all and .sc-9b1418e2-0 is an empty 320x38 shell with zero
           children — nuts.gg renders no bet history whatsoever, on any width. So
           there is nothing to re-parent and the styling above can never help; the
           slot was simply 38px of nothing. The socket's myGames frames carry the
           settled result, so the strip is built from those instead. */
        #ratchet-master-container .hud-own-bet-feed {
            width: 100%;
            display: flex;
            gap: 4px;
            padding: 5px;
            background: var(--hud-panel);
            border: 1px solid var(--hud-border-soft);
            border-radius: 8px;
            overflow-x: auto;
            overflow-y: hidden;
            -webkit-overflow-scrolling: touch;
            align-items: center;
            flex-direction: row-reverse;
            justify-content: flex-end;
        }
        #ratchet-master-container .hud-own-bet-feed:empty::after {
            content: 'no bets yet';
            font-size: 10px;
            opacity: 0.45;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }
        #ratchet-master-container .hud-own-bet-tile {
            flex: 0 0 auto;
            min-width: 44px;
            padding: 3px 6px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 800;
            font-variant-numeric: tabular-nums;
            text-align: center;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid transparent;
        }
        #ratchet-master-container .hud-own-bet-tile.win {
            color: var(--hud-green);
            border-color: color-mix(in srgb, var(--hud-green) 45%, transparent);
            background: color-mix(in srgb, var(--hud-green) 12%, transparent);
        }
        #ratchet-master-container .hud-own-bet-tile.loss {
            color: #ff6b81;
            border-color: rgba(225, 29, 72, 0.45);
            background: rgba(225, 29, 72, 0.12);
        }
        #ratchet-master-container .hud-own-bet-tile.fresh { animation: hudTilePop 220ms ease-out; }
        @keyframes hudTilePop {
            from { transform: scale(0.82); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
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
        /* Manual/IOW/Smart (no scroll model): drop the flex-grow + percentage
           min-height above. Safari/WebKit is known to mis-resolve a percentage
           height against an indefinite-height ancestor (.hud-workspace is now
           auto-height) inside flexbox, which was inflating this element hugely
           on iPhone even though Chromium handled the same markup correctly. */
        #ratchet-master-container:not([data-tools-active="1"]) #hud-content {
            flex: 0 0 auto; min-height: 0;
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
        /* Nothing to report = no strip at all. In cond mode this line now carries
           warnings only, so it is empty almost all the time. */
        #ratchet-master-container .hud-stats .hud-statusline:empty { display: none; }
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

        /* Advanced IOW ONLY: #hud-content grows to fill the pinned/fixed-height
           HUD so #dt-aio-panel gets a definite height for its own internal
           scrolling (.dt-body{overflow:auto}). This !important rule used to be
           UNSCOPED (applied to Manual/IOW/Smart too), which silently overrode
           the measured-content fix above (flex:0 0 auto for :not([data-tools-
           active="1"])) since !important always wins regardless of source order
           — Safari then inflated #hud-content into a big empty gap between the
           controls and the action bar with nothing left to legitimately grow
           into. Scoping this strictly to Advanced IOW removes the conflict. */
        #ratchet-master-container[data-tools-active="1"] #hud-content {
            flex: 1 1 0 !important; min-height: 0 !important;
            display: flex; flex-direction: column;
        }
        /* Was flex:1 1 0 (grow-to-fill) — a leftover from the old guessed-height
           model. With #hud-content no longer flex-growing (see above), this had
           nothing to fill, and Safari inflated it hugely (the empty box users
           saw between the stats grid and the controls). Auto-size like the base
           .hud-shell rule instead. */
        #ratchet-master-container:not([data-tools-active="1"]) #hud-content > .hud-shell {
            flex: 0 0 auto; min-height: 0;
            display: flex; flex-direction: column; gap: 6px;
        }
        #ratchet-master-container #hud-content > .hud-shell > .hud-graph-box {
            /* Static size — the graph no longer flex-grows/shrinks with available
               space (it used to visibly resize as the panel scrolled). */
            flex: 0 0 auto; height: 140px;
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
            /* touch-action:none so a touch-drag on the slider always moves the thumb
               (full 0.5x–3x travel) instead of scrolling/panning the panel. */
            cursor: pointer; touch-action: none;
        }
        /* The Lock checkbox sits directly under the Aggression slider, so a fast
           back-and-forth drag could overshoot onto it and toggle Lock. Give the
           slider breathing room below it — all sites (Stake/Shuffle/Nuts), since
           the SMART layout is the same everywhere. */
        #ratchet-master-container #h-agg { margin-bottom: 14px; }
        /* The mode/action buttons and the Lock checkbox own their touch gesture so a
           tap isn't cancelled by a scroll (reported "stuck" Lock/Start on mobile). */
        #ratchet-master-container .mode-btn,
        #ratchet-master-container .hud-rapid-btn,
        #ratchet-master-container .hud-reset-btn,
        #ratchet-master-container .hud-switch-ou-btn,
        #ratchet-master-container .quick-btn,
        #ratchet-master-container #h-lock-agg-chk,
        #ratchet-master-container .hud-control-group label { touch-action: manipulation; }
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
        /* Shuffle native footer relocated into the HUD slot — un-absolute-position
           the current module footers (MultiplierWinChanceFooter=Limbo,
           DiceGameFooter=Dice) plus the legacy hash so the Multiplier / Chance
           row fills the slot instead of floating at the bottom of the game. */
        #ratchet-master-container .hud-footer-slot [class*="MultiplierWinChanceFooter"],
        #ratchet-master-container .hud-footer-slot [class*="DiceGameFooter"],
        #ratchet-master-container .hud-footer-slot [class*="TBYuRq__footer"] {
            width: 100% !important; position: relative !important;
            left: auto !important; right: auto !important; bottom: auto !important;
            border-radius: 10px !important; overflow: hidden !important; flex: 1 1 auto !important;
        }
        #ratchet-master-container .hud-footer-slot [class*="DimOverlay"],
        #ratchet-master-container .hud-footer-slot [class*="DimmedWrapper"] { opacity: 1 !important; pointer-events: auto !important; }
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
        const mwc = document.querySelector('[class*="MultiplierWinChanceFooter"]');
        if (mwc && !inOverlay(mwc)) return mwc;
        const wrap = document.querySelector('[class*="InfoBetInput_inputContainer"]');
        if (wrap && !inOverlay(wrap)) {
            let p = wrap.parentElement;
            for (let i = 0; i < 6 && p && p !== document.body; i++, p = p.parentElement) {
                if (inOverlay(p)) break;
                if (p.querySelectorAll('input').length >= 2) return p;
            }
        }
        const byClass = document.querySelector(
            '[class*="footer"][class*="dice"], [class*="Dice"][class*="footer"], ' +
            '[class*="TBYuRq__footer"], [class*="betControls"], [class*="BetControls"], ' +
            '[class*="gameControls"], [class*="GameControls"]'
        );
        if (byClass && !inOverlay(byClass)) return byClass;
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
        const outside = (el) => el && !isOverlayNode(el); // also excludes chat/modal DOM

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

    /* Native chrome that outranks the HUD in paint order.
       The HUD root is `z-index: auto` (deliberately — a numeric value would make it
       a stacking context), while nuts.gg gives the PLAY button's wrapper
       `z-index: 3` from its own stylesheet. Both sit in the same stacking context,
       so the native button legitimately paints ON TOP of the HUD. At phone width
       the native column stacks clear of the HUD and nothing shows; at desktop width
       — the mobile bundle with Chrome's device toolbar off — PLAY lands squarely
       over the mode bar. Measured in a real browser: PLAY at (390,120) 340x60 vs
       the mode bar at (366,138) 1188x29.

       Clamp the offender's z-index rather than hiding it. clickPlay() resolves the
       Nuts PLAY button through findButtonByText(), which filters on isVisible(),
       and isVisible() rejects `visibility: hidden` — so hiding the bleed-through
       would stop the engine placing any bet at all.

       Bounded by geometry and by the HUD's own host, never by class name: the Nuts
       class hashes change on every deploy. Self-healing too — once a node's
       computed z-index is 0 it no longer matches, and if React re-renders and
       restores the original value the next tick demotes it again. */
    function demoteNativeStackingAboveHud() {
        const hud = document.getElementById('ratchet-master-container');
        const host = hud && hud.parentElement;
        if (!host) return;
        const hb = hud.getBoundingClientRect();
        if (hb.width <= 0 || hb.height <= 0) return;
        host.querySelectorAll('*').forEach(el => {
            if (el === hud || hud.contains(el)) return;
            const s = window.getComputedStyle(el);
            if (s.position === 'static') return;
            const z = parseInt(s.zIndex, 10);
            if (!isFinite(z) || z <= 0) return;
            const r = el.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0) return;
            if (r.right <= hb.left || hb.right <= r.left || r.bottom <= hb.top || hb.bottom <= r.top) return;
            el.style.setProperty('z-index', '0', 'important');
        });
    }

    /* Our own results strip, for Nuts.
       Verified on the live logged-in page 2026-07-26: `.sc-9b1418e2-1` does not
       exist and `.sc-9b1418e2-0` is an empty 320x38 shell with zero children, at
       every width. nuts.gg ships no bet history at all, so there has never been
       anything to re-parent — the slot was 38px of nothing and no styling or
       selector fix could change that. The socket's myGames frames carry each
       settled result, so the strip gets built from those.
       The container is row-reverse, so appending puts the newest tile on the left
       and firstElementChild is the oldest. */
    const NUTS_OWN_FEED_MAX = 24;
    function ensureNutsOwnFeed() {
        const slot = document.getElementById('hud-native-past-bets-slot');
        if (!slot) return null;
        let feed = slot.querySelector('.hud-own-bet-feed');
        if (!feed) {
            feed = document.createElement('div');
            feed.className = 'hud-own-bet-feed';
            slot.replaceChildren(feed);
        }
        return feed;
    }
    function nutsOwnFeedAdd(won, label) {
        if (!isNuts()) return;
        const feed = ensureNutsOwnFeed();
        if (!feed) return;
        const tile = document.createElement('div');
        tile.className = 'hud-own-bet-tile fresh ' + (won ? 'win' : 'loss');
        const hasLabel = label !== undefined && label !== null && String(label) !== '';
        tile.textContent = hasLabel ? String(label) : (won ? 'WIN' : 'LOSS');
        feed.appendChild(tile);
        while (feed.childElementCount > NUTS_OWN_FEED_MAX) feed.removeChild(feed.firstElementChild);
        setTimeout(() => { try { tile.classList.remove('fresh'); } catch (e) {} }, 260);
    }

    function syncNativeHudElements() {
        if (isNuts()) {
            const recentBets = findNativeElement('.sc-9b1418e2-1') || findNativeElement('.sc-9b1418e2-0');
            // Prefer a real native feed if nuts.gg ever ships one with content in
            // it; otherwise our own strip owns the slot.
            if (recentBets && recentBets.childElementCount > 0) {
                mountSingleElement(document.getElementById('hud-native-past-bets-slot'), recentBets);
            } else {
                ensureNutsOwnFeed();
            }
            mountSingleElement(
                document.getElementById('hud-footer-slot'),
                findNativeElement('.sc-1d9445d-1.hFwXoL') || findNativeElement('.sc-1d9445d-1')
            );
            // The native dice roll-over slider (input[type=range], min 0 / max 100)
            // stays in the game stage behind the HUD, and its thumb (a blue square)
            // renders above the overlay and bleeds through. Roll Over is in the
            // relocated footer, so hide the native slider. Skip our own Aggression
            // slider (min=0.5) and anything already inside the HUD.
            document.querySelectorAll('input[type="range"][min="0"][max="100"]').forEach(sl => {
                if (!sl.closest('#ratchet-master-container')) sl.style.visibility = 'hidden';
            });
            demoteNativeStackingAboveHud();
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
            // Always returns SOL. The outer title reads "X SOL" and is invariant to
            // display mode — but nuts.gg writes that attribute ONCE, at page load,
            // and never updates it, so it is also invariant to the BALANCE.
            // Measured on the live logged-in page 2026-07-26: title stuck at
            // 0.00006839 while the visible text moved 0.00003647 -> 0.00004719.
            // Reading the title first made every balance delta exactly zero, so no
            // bet was ever detected and Bets/Wagered/W-L sat at 0 forever. The
            // visible text is the only live source; the two title attributes are
            // last-resort fallbacks for the skeleton state before the pill renders.
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
                // Strip USD sub-labels ("$0.00", "($0.01)") first so the fiat figure
                // can never be parsed as the SOL amount — the narrow phone header
                // renders "0.00004719$0.00" with no "SOL" word anywhere in the text.
                const src = raw.replace(/\(\s*\$[\d.,]+\s*\)/g, ' ').replace(/\$\s*[\d.,]+/g, ' ');
                const match = src.match(/([\d,]+(?:\.\d+)?)\s*SOL/i) || src.match(/([\d,]+(?:\.\d+)?)/);
                if (!match) continue;
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
        if (ACTIVE_MODE !== 'iow' && ACTIVE_MODE !== 'manual' && ACTIVE_MODE !== 'cond') return false;
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
        // Limbo's game stage is much shorter than dice's, so the HUD (which fills
        // this host) crams its controls into a tiny strip. Grow the host so the
        // HUD gets clean vertical room. The native bet panel is a sibling BELOW
        // the stage, so it just flows further down — nothing is covered.
        const toolsActive = !!hud && hud.dataset.toolsActive === '1';
        if (toolsActive) {
            // Advanced IOW keeps the previous guessed-vh sizing: its own
            // Optimizer/Results tables can get long and manage their own internal
            // scrolling (.dt-body{overflow:auto}), so we don't want to measure and
            // fit content here — that could grow the page to fit an arbitrarily
            // long results table. Extend further on the heavier tabs (Calculator/
            // Optimizer/Results) so they reach downward with less internal scroll.
            // Use svh (small viewport height), NOT dvh — dvh recalculates
            // continuously as iOS Safari's address bar/toolbar collapses and
            // expands while scrolling, resizing this host mid-scroll.
            const dtP = document.querySelector('#ratchet-master-container #dt-aio-panel');
            const dtTab = dtP && dtP.getAttribute('data-active-tab');
            const dtTall = dtTab === 'calc' || dtTab === 'easy' || dtTab === 'opt' || dtTab === 'results';
            /* Reach further down the screen. 74svh/720px left the Stats tab
               scrolling for almost everything below the graph; at 92svh the deck
               and the run controls fit on one screen on a normal phone. Still
               svh (not dvh) so iOS Safari's collapsing toolbar cannot resize the
               host mid-scroll, and still clamped so a short viewport keeps a
               sane floor and a tall one does not run away. */
            gameDisplay.style.minHeight = dtTall ? 'clamp(560px, 94svh, 1200px)' : 'clamp(560px, 92svh, 1100px)';
        } else if (!gameDisplay.style.minHeight) {
            // Small floor so there's no flash of near-zero height before the HUD's
            // real content height is measured below (e.g. right after SPA nav).
            gameDisplay.style.minHeight = '380px';
        }
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
                        ${isNuts() ? '<button id="mode-cond" class="mode-btn">Advanced IOW</button>' : ''}
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
            const condModeBtn = document.getElementById('mode-cond');
            if (condModeBtn) condModeBtn.onclick = () => switchMode('cond');
            buildHUDContent();
        }
        hud.dataset.mode = ACTIVE_MODE;
        hud.classList.toggle('stake-theme', !isShuffle() && !isNuts());
        hud.classList.toggle('shuffle-theme', isShuffle());
        hud.classList.toggle('nuts-theme', isNuts());
        syncModeButtons();
        syncNativeHudElements();
        if (!toolsActive) {
            // Manual/IOW/Smart: size the host to the HUD's OWN natural content
            // height (measured, not guessed) so hud-workspace never needs to
            // scroll internally — the game stage, and the native bet panel below
            // it, grow to match exactly ("extend the footer downward" rather than
            // clip). Runs every buildHUD() tick (600ms), so it self-corrects after
            // mode switches or any content that grows/shrinks.
            const measuredHeight = Math.ceil(hud.getBoundingClientRect().height);
            if (measuredHeight > 0) gameDisplay.style.minHeight = Math.max(measuredHeight, 380) + 'px';
        }
        setTimeout(() => {
            syncNativeHudElements();
            // Re-measure after the native footer (e.g. Target Multiplier) may have
            // mounted late — it can land just after this delay on a fresh page load.
            if (!toolsActive && hud.dataset.toolsActive !== '1') {
                const h2 = Math.ceil(hud.getBoundingClientRect().height);
                if (h2 > 0) gameDisplay.style.minHeight = Math.max(h2, 380) + 'px';
            }
        }, 350);
        try { const tid = currentGameToolId(); if (tid) markToolRan(tid); } catch (e) {}
    }

    function buildHUDContent() {
        const content = document.getElementById('hud-content');
        const actionBar = document.getElementById('hud-action-bar');
        const hud = document.getElementById('ratchet-master-container');
        if (!content) return;
        if (hud) hud.dataset.mode = ACTIVE_MODE;
        // Advanced IOW hosts the DiceTool panel, so reuse the same host sizing +
        // scrollable workspace the Stake stitch uses (see the [data-tools-active]
        // rules); buildHUD reads this flag on the next tick.
        if (hud) {
            if (ACTIVE_MODE === 'cond') hud.dataset.toolsActive = '1';
            else delete hud.dataset.toolsActive;
        }
        syncModeButtons();
        // Park the DiceTool panel out of #hud-content before wiping it (Advanced
        // IOW mounts it); reset the column layout the cond branch applies.
        unmountDicePanel();
        // The conditions popup is a HUD child, not a #hud-content child, so
        // wiping content does not take it with us — drop it explicitly or its
        // ids linger into Manual/IOW/Smart.
        if (ACTIVE_MODE !== 'cond') clearCondModal();
        content.style.removeProperty('flex-direction');
        content.style.removeProperty('gap');
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
        if (ACTIVE_MODE === 'cond') {
            // Advanced IOW mirrors Stake exactly: the DiceTool panel is the ONLY
            // child of #hud-content and every control lives inside its "Stats"
            // tab (built by ensureNutsStatsTab from attachListeners), so nothing
            // can overflow the game area and get clipped by the bet panel below.
            html = '';
        } else if (ACTIVE_MODE === 'iow') {
            html = `
                <div class="hud-shell">
                    <div class="hud-stats hud-panel">
                        <div class="hud-statusline" id="h-target">base: 0.01 | W:0 | LS:0</div>
                        ${commonStatsHtml}
                        <!-- Same three stats the Manual tab carries. IOW had no
                             Mult Perf row at all, so the one stat this tool is
                             most often judged on was invisible on mobile in the
                             mode people actually run. Streaks and Momentum are
                             tracked for every mode in handleBetResult(), so they
                             are just as live here as they are under Manual. -->
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
                            <label>Base bet</label>
                            <div class="input-group">
                                <button id="h-half-base" class="quick-btn">½</button>
                                <input id="h-base" type="number" step="${moneyStep}" value="${baseInputValue}">
                                <button id="h-double-base" class="quick-btn">2x</button>
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
                                <button id="h-manual-half" class="quick-btn">½</button>
                                <input id="h-manual-bet" type="number" step="${moneyStep}" min="${moneyStep}" value="${manualInputValue}">
                                <button id="h-manual-double" class="quick-btn">2x</button>
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
        // Advanced IOW: mount the DiceTool panel and build its Stats tab BEFORE
        // any wiring below, because the base-bet / autostop / strategy controls
        // now live inside that tab.
        if (ACTIVE_MODE === 'cond') {
            mountDicePanel();
            ensureNutsStatsTab();
            ensureCondModal();
        }
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
        } else if (ACTIVE_MODE === 'cond') {
            const condInp = document.getElementById('h-cond-base');
            if (condInp) {
                condInp.addEventListener('input', () => { condBaseBet = parseCurrencyInput(condInp.value, minBaseBet); saveCondState(); });
                condInp.addEventListener('blur', () => {
                    let v = parseCurrencyInput(condInp.value, minBaseBet);
                    condInp.value = formatCurrencyInput(v);
                    condBaseBet = v;
                    saveCondState();
                });
            }
            const condDouble = document.getElementById('h-cond-double');
            if (condDouble) condDouble.addEventListener('click', () => {
                let val = parseCurrencyInput(document.getElementById('h-cond-base').value, minBaseBet);
                val *= 2;
                document.getElementById('h-cond-base').value = formatCurrencyInput(val);
                condBaseBet = val;
                saveCondState();
            });
            const condHalf = document.getElementById('h-cond-half');
            if (condHalf) condHalf.addEventListener('click', () => {
                let val = parseCurrencyInput(document.getElementById('h-cond-base').value, minBaseBet);
                val = Math.max(minBaseBet, val * 0.5);
                document.getElementById('h-cond-base').value = formatCurrencyInput(val);
                condBaseBet = val;
                saveCondState();
            });
            refreshCondOpenBtn();
            const condOpen = document.getElementById('h-cond-open');
            if (condOpen) condOpen.addEventListener('click', openCondModal);
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
                if (e.key === 'Enter') { e.preventDefault(); stratName.blur(); condSaveStrategy(stratName.value); }
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
               leaving the Stats tab — two-way bound, exactly as desktop and
               Stake's deck do it. The native value setter + synthetic events are
               needed because the calculator listens for React-style input events. */
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
            // Update Strategy = the dice tool's own "Send To Game" path (read
            // balance → recompute → retune the loaded strategy), so there is one
            // code path rather than a second copy of the maths.
            const updBtn = document.getElementById('h-stats-update');
            if (updBtn) updBtn.addEventListener('click', () => {
                const sync = document.getElementById('dt-game_sync');
                if (sync) sync.click();
                else { condNotice = { text: 'Calculator not ready yet.', until: Date.now() + 3000 }; updateUI(); }
            });
            const wsChk = document.getElementById('h-stats-ws-chk');
            if (wsChk) wsChk.addEventListener('change', () => { condWsStopOn = wsChk.checked; saveCondState(); });
            const wsTar = document.getElementById('h-stats-ws-target');
            if (wsTar) wsTar.addEventListener('input', () => {
                const n = parseInt(wsTar.value, 10);
                if (Number.isFinite(n) && n > 0) { condWsTarget = n; saveCondState(); }
            });
            const trackSel = document.getElementById('h-stats-track');
            if (trackSel) trackSel.addEventListener('change', () => {
                condTrackPer = trackSel.value === 'cycle' ? 'cycle' : 'session';
                saveCondState();
                updateUI();
            });
            const volInp = document.getElementById('h-stats-vol');
            if (volInp) volInp.addEventListener('input', () => {
                condVolume = Math.max(0, Math.min(100, parseInt(volInp.value, 10) || 0));
                const lbl = document.getElementById('h-stats-vol-val');
                if (lbl) lbl.textContent = condVolume;
                saveCondState();
            });
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
        lastBalanceChangeAt = 0; lastHeartbeatBalance = null;
        condCurBet = condBaseBet;
        resetCondRuntime();
        if (isRapidFiring) stopRapidFire();
        if (ACTIVE_MODE === 'iow') {
            const baseInp = document.getElementById('h-base');
            if (baseInp) baseInp.value = formatCurrencyInput(baseBet);
        } else if (ACTIVE_MODE === 'cond') {
            const condInp = document.getElementById('h-cond-base');
            if (condInp) condInp.value = formatCurrencyInput(condBaseBet);
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
            // Seed by class AND by child position, matching the widened tile test
            // below — otherwise a re-render that re-adds existing children would
            // be counted as fresh bets on layouts where the class does not match.
            pastBetsContainer.querySelectorAll('.styles-module___IID9a__game')
                .forEach(el => _nutsProcessedBetEls.add(el));
            Array.from(pastBetsContainer.children).forEach(el => _nutsProcessedBetEls.add(el));
            observer = new MutationObserver((mutations) => {
                let countedThisBatch = false;
                outer: for (const m of mutations) {
                    for (const node of m.addedNodes) {
                        if (countedThisBatch) break outer;
                        if (node.nodeType !== 1) continue;
                        /* Prefer the known tile class, but fall back to "a direct
                           element child of the feed with text". `_IID9a` is a
                           BUILD HASH of one CSS module: verified present on the
                           desktop layout (27 tiles) and absent at phone width,
                           which left mobile counting zero bets — Bets 0 /
                           Wagered 0 while money moved, the run stopped by the
                           stall guard, and the conditions engine never advancing
                           because runConditionEngine() only fires from here.
                           The feed's children ARE the bet tiles, so structure is
                           a sounder signal than the hash. The empty-text guard
                           below still skips placeholders, the WeakSet still stops
                           double-counting, and one-per-batch still absorbs the
                           two tiles Nuts emits per roll. */
                        const tile = (node.matches && node.matches('.styles-module___IID9a__game'))
                            ? node
                            : ((node.querySelector && node.querySelector('.styles-module___IID9a__game'))
                               || (node.parentElement === pastBetsContainer ? node : null));
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

    /* Nuts bet results from the GraphQL socket, not the DOM.
     *
     * The mobile layout has no rolling bet feed, so `.sc-9b1418e2-1` stays empty
     * forever: Bets 0 / Wagered 0 while money moved, and runConditionEngine()
     * never fired because it only runs from processNewBet().
     *
     * The socket's `myGames` frames are the authoritative source — each one is a
     * settled bet with an exact id and an explicit isWin, so nothing has to be
     * inferred from the sign of a balance delta. Captured live 2026-07-26:
     *   {"myGames":[{"__typename":"SinglePlayerGameBet","id":"1651571395",
     *     "profit":-80,"isWin":false,"wager":80,"multiplier":4,
     *     "details":{"targetMultiplier":4,"result":1.02,
     *                "__typename":"TargetGameDetails"},...}]}
     *
     * The amount deliberately still comes from getCurrentBet(), NOT from the
     * frame's `wager`. The socket's numbers are in some internal unit, not SOL:
     * a balance of 74128.498 units sat alongside a pill reading 0.00000021 SOL,
     * which is ~350x off any clean power of ten, so the scale is not established.
     * id and isWin are unit-free, and those are the two things that were wrong. */
    let _nutsSockBal = null;
    let lastSocketBetTime = 0;
    const _nutsSeenGameIds = [];
    /* A myGames frame reports whatever game the account is playing, which is not
       necessarily the page this HUD is on — a second session betting Target while
       the dice HUD is open would otherwise inflate the dice counters. Skip a frame
       only when its typename names a game that clearly ISN'T the current page; an
       unrecognised typename is assumed to be the current game, so a naming change
       degrades to "counted" rather than "silently ignored". Only TargetGameDetails
       is confirmed from live capture — the rest are best-effort. */
    const NUTS_GAME_TYPENAME_PATHS = [
        [/target/i, /\/target(?:\/|$|\?|#)/i],
        [/dice/i, /\/dice(?:\/|$|\?|#)/i],
        [/limbo/i, /\/limbo(?:\/|$|\?|#)/i],
        [/mines/i, /\/mines(?:\/|$|\?|#)/i],
        [/keno/i, /\/keno(?:\/|$|\?|#)/i],
        [/plinko/i, /\/plinko(?:\/|$|\?|#)/i],
    ];
    function onNutsGameBet(bet) {
        if (!isNuts() || !bet || typeof bet.isWin !== 'boolean') return;
        const id = String(bet.id == null ? '' : bet.id);
        if (!id || _nutsSeenGameIds.indexOf(id) !== -1) return;
        const typename = (bet.details && bet.details.__typename) || bet.__typename || '';
        const path = location.pathname || '';
        for (const [nameRe, pathRe] of NUTS_GAME_TYPENAME_PATHS) {
            if (nameRe.test(typename)) {
                if (!pathRe.test(path)) return;
                break;
            }
        }
        _nutsSeenGameIds.push(id);
        if (_nutsSeenGameIds.length > 400) _nutsSeenGameIds.splice(0, 200);
        lastSocketBetTime = Date.now();
        try { noteBalanceHeartbeat(); } catch (e) {}
        // Same downstream path as a DOM-observed bet: counters, handleBetResult,
        // the IOW/cond engines and the autostops all live in processNewBet().
        processNewBet(null, null, bet.isWin);
        // The frame carries the actual roll, so the strip can show it rather than
        // just W/L. `result` is the dice/target roll; fall back to the multiplier.
        try {
            const d = bet.details || {};
            const label = d.result !== undefined && d.result !== null ? d.result
                : (bet.multiplier ? bet.multiplier + 'x' : '');
            nutsOwnFeedAdd(bet.isWin, label);
        } catch (e) {}
    }
    /* Balance frames are a liveness heartbeat only. They were previously used for
       bet detection via the delta's sign, but that could never fire: the guard
       compared a socket-unit delta (e.g. 240) against `betAmt * 500` in SOL
       (5e-6), so every real bet was discarded by magnitude. myGames carries the
       result properly, and the DOM balance still backs it up. */
    function onNutsSocketBalance(after) {
        if (!isNuts() || !isFinite(after)) return;
        if (_nutsSockBal === null) { _nutsSockBal = after; return; }
        if (Math.abs(after - _nutsSockBal) < 1e-12) return;
        _nutsSockBal = after;
        try { noteBalanceHeartbeat(); } catch (e) {}
    }
    /* Bet detection from the BALANCE, for Nuts.
     *
     * Nuts renders no past-bets strip on a phone — the slot stays empty in every
     * mode, so the tile observer has nothing to watch and Bets/Wagered sat at 0
     * while the dice cube animated and money moved. The socket hook only attaches
     * to a URL containing nuts.tools/graphql, which is not guaranteed to be the
     * socket this page uses. The balance element, by contrast, is provably read
     * correctly — PROFIT/LOSS tracks it live on the user's device.
     *
     * So: every balance change is a resolved bet. Win/loss is the SIGN of the
     * delta (a dice loss is exactly -stake, a win is +stake*(mult-1)). Result is
     * handed to processNewBet(), which owns the per-mode logic, so IOW, Smart and
     * Advanced IOW all count again — not just cond.
     *
     * Driven by a MutationObserver on the balance node so back-to-back rolls are
     * not coalesced by a poll interval, with the ticker as a fallback. */
    let _nutsBalSeen = null;
    let _nutsBalObs = null;
    let _nutsBalNode = null;
    function nutsBalanceBetCheck() {
        if (!isNuts()) return;
        const bal = getCurrentBalance();
        if (!isFinite(bal) || bal <= 0) return;
        if (_nutsBalSeen === null) { _nutsBalSeen = bal; return; }
        const delta = bal - _nutsBalSeen;
        if (Math.abs(delta) < 1e-12) return;
        _nutsBalSeen = bal;
        // Defer only if a TILE was just counted (that path has the real result).
        if (Date.now() - lastTileBetTime < 1200) return;
        /* Defer to the socket too. myGames gives an exact id and isWin, so while
           those frames are arriving this inferred-from-the-sign path must stay out
           of the way or every bet is counted twice. The window is generous because
           the balance write lands ~1ms after the myGames frame but the DOM pill can
           lag it, and it re-arms on every socket bet — so this only takes over once
           the socket has genuinely gone quiet. */
        if (Date.now() - lastSocketBetTime < 4000) return;
        const betAmt = getCurrentBet() || minBaseBet;
        if (!isFinite(betAmt) || betAmt <= 0) return;
        // One dice round cannot move the balance by more than a large multiple of
        // the stake; bigger jumps are deposits, faucet claims or race payouts.
        if (Math.abs(delta) > betAmt * 500) return;
        processNewBet(null, null, delta > 0);
        // No roll value on this path — the tile shows the outcome only.
        try { nutsOwnFeedAdd(delta > 0, ''); } catch (e) {}
    }
    function startNutsBalanceWatcher() {
        if (!isNuts()) return;
        const bal = findBalanceContainer();
        if (!bal) return;
        /* RE-ATTACH when the node changes. Measured on the real page: while the
           balance is still loading the pill's title reads "Loading..." and the
           primary `div[title$=" SOL"]` selector misses, so this can bind to a
           skeleton node that React later replaces — after which the observer is
           watching a detached element and never fires again. Compare the node we
           are on, not just whether an observer exists.
           _nutsBalSeen is deliberately NOT reset here: the balance value is the
           same across a re-render, and clearing the baseline would silently drop
           the next bet. */
        if (_nutsBalObs && _nutsBalNode === bal && bal.isConnected) return;
        if (_nutsBalObs) { try { _nutsBalObs.disconnect(); } catch (e) {} }
        _nutsBalNode = bal;
        _nutsBalObs = new MutationObserver(() => { try { nutsBalanceBetCheck(); } catch (e) {} });
        _nutsBalObs.observe(bal, { childList: true, subtree: true, characterData: true,
                                   attributes: true, attributeFilter: ['title'] });
        nutsBalanceBetCheck();
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

    /* `forcedWon` lets a caller that already knows the result (the Nuts balance
       watcher below, which has no tile to read) reuse this function's per-mode
       logic instead of duplicating the iow / cond / smart branches. */
    function processNewBet(container, specificTile, forcedWon) {
        const haveForced = (forcedWon === true || forcedWon === false);
        // The Nuts observer passes the exact tile it counted; other callers
        // fall back to "latest entry" + id-based dedup (Stake path).
        const latestBet = haveForced ? null
            : (specificTile ? { element: specificTile, id: specificTile } : getLatestBetEntry(container));
        if (!haveForced && (!latestBet || (!specificTile && latestBet.id === lastBetId))) return;
        if (latestBet) lastBetId = latestBet.id;
        if (!haveForced) lastTileBetTime = Date.now();
        lastObservedBetTime = Date.now();
        rapidBlockedSince = 0;
        totalBets++;
        const betAmt = getCurrentBet();
        const won = haveForced ? forcedWon : isWin(latestBet.element);
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
       CONDITIONS MODE (Nuts) — userscript-side condition engine.
       Nuts has no native Advanced bet mode or strategy editor, so these
       blocks are the substrate a future "Advanced IOW" import can write
       into (semantics mirror Stake's native Advanced autobet conditions).
       ============================================================ */
    const COND_STORE_KEY = 'nuts-dice-conditions-v1';
    const COND_STRAT_KEY = 'nuts-dice-strategies-v1';
    let condBaseBet = minBaseBet;
    // Calculator params — same fields and defaults as the DiceTool.exe
    // replica calculator on Stake/Shuffle (m = (1 + w) * l * buffer).
    // Amounts here are in the ACTIVE DISPLAY UNIT (SOL or USD), like every
    // other HUD money input on mobile.
    let condCalc = { balance: '', div: '500', winInc: '78', lossReset: '5', profitMult: '100', buffer: '25' };
    /* Stats-deck parity with Stake/Shuffle, ported from desktop: autostop after
       a win streak, Session|Cycle stats scope, and the win beep. A "cycle" is
       one START→stop run, so the deck can show just this run instead of the
       whole session. Persisted under prefs in COND_STORE_KEY.

       Declared BEFORE loadCondState() below, which restores them: `let` bindings
       are in the temporal dead zone until their declaration runs, and because
       loadCondState() wraps everything in try/catch, an assignment from up there
       throws a ReferenceError that gets swallowed — dropping the user's saved
       conditions and returning the first-run demo blocks instead. That is
       exactly the bug this ordering fixes on desktop. Keep these above the call. */
    let condWsStopOn = false;
    let condWsTarget = 10;
    let condTrackPer = 'session';
    let condVolume = 100;
    let condCycle = null;
    let condBlocks = loadCondState();   // also restores condBaseBet + condCalc + prefs
    let condRuntime = condBlocks.map(condDefaultRuntime);
    let condCurBet = condBaseBet;
    let condResumePending = false;
    let condNotice = null;
    let condStrategies = loadCondStrategies();
    let condSyncing = false;   // re-entry guard for the deck ↔ calculator binding
    let condAudioCtx = null;
    function condPlayWinSound() {
        /* ACTIVE_MODE is not persisted, but nuts.gg is an SPA: navigating from
           dice to another game keeps the same JS context, so the mode stayed
           'cond' and every win in the NEXT game beeped with the dice tool's
           sound. Bind the beep to actually being on the dice page. */
        if (ACTIVE_MODE !== 'cond' || !isOnDicePage()) return;
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
    function condStartCycle() {
        const bal = getCurrentBalance();
        condCycle = {
            balance: bal, peakBalance: bal, peakProfit: 0,
            totalBets: totalBets, totalWagered: totalWagered,
            totalWins: totalWins, totalLosses: totalLosses
        };
    }
    function condTrackCycle() {
        if (!condCycle) return;
        const bal = getCurrentBalance();
        if (bal > condCycle.peakBalance) condCycle.peakBalance = bal;
        const profit = bal - condCycle.balance;
        if (profit > condCycle.peakProfit) condCycle.peakProfit = profit;
    }
    /* The numbers the deck shows: the whole session, or only the current cycle.
       Falls back to session when no cycle has been started yet. */
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
    addStyle(`
        /* Chrome around the mounted DiceTool panel. Palette and typography
           mirror the DiceTool.exe replica skin the panel uses (#162a35 frames,
           2px #c9d1d9 sunken LabelFrames with Times New Roman italic underlined
           titles, #071824 clam entries/buttons, #00ff80 accent) so the action
           bar and strategy frame read as part of the panel, not the neon HUD. */
        /* The panel is the only child of #hud-content and fills it; everything
           lives inside its Stats tab, which scrolls with .dt-body. */
        #ratchet-master-container[data-mode="cond"] #hud-content { display: flex; flex-direction: column; }
        /* Stats tab shell. Scoped through #hud-content so it outranks the
           replica skin's .dt-panel.active rules that follow in the sheet.
           (No backticks in here — this block is a JS template literal.) */
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats { padding: 9px !important; flex-direction: column !important; gap: 8px !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats.active { display: flex !important; flex: 1 1 auto !important; min-height: 0 !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats * { box-sizing: border-box; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats > .hud-shell { display: flex !important; flex-direction: column !important; gap: 8px !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-graph-box { min-height: 150px !important; flex: 0 0 auto !important; }
        /* Let the stat cards size to their content (the HUD grid otherwise
           divides a fixed height into equal rows and clips them). */
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-stats-grid { flex: 0 0 auto !important; grid-auto-rows: auto !important; overflow: visible !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .stats-col-inner,
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-stats { overflow: visible !important; }
        #ratchet-master-container #hud-content > #dt-aio-panel #dt-panel-stats .hud-row { flex: 0 0 auto !important; min-height: 21px !important; }
        /* ---- Action bar ---- */
        #ratchet-master-container .cond-actionbar { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; flex-wrap: wrap; padding: 9px 10px;
            background: #162a35 !important; border: 1px solid #2f4553 !important; border-radius: 8px !important;
            box-shadow: none !important; backdrop-filter: none !important; font-family: "Segoe UI", -apple-system, sans-serif; }
        #ratchet-master-container .cond-actionbar label { color: #c9d1d9 !important; font-size: 11.5px !important; font-weight: 700 !important; text-transform: none !important; letter-spacing: 0 !important; }
        #ratchet-master-container .cond-actionbar .input-group { flex: 1 1 140px; gap: 6px; }
        #ratchet-master-container .cond-actionbar .input-group input { flex: 1 1 0; min-width: 0; background: #071824; border: 1px solid #2f4553; border-radius: 3px; color: #c9d1d9;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 400; padding: 6px 8px; box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4); }
        #ratchet-master-container .cond-actionbar .input-group input:focus { border-color: #c9d1d9; box-shadow: 0 0 0 1px #c9d1d9; }
        /* ---- Advanced IOW controls deck + action bar ----
           .hud-controls-deck / .hud-control-group already have global HUD CSS, so
           they paint exactly like Stake/Shuffle's mobile deck. These are the three
           classes that only had rules inside the Stake/Shuffle bridge CSS (which
           never loads on Nuts), plus the Base Bet row. Button colours come from the
           HUD's own .hud-rapid-btn / .hud-reset-btn / .hud-update-btn rules, which
           read var(--hud-green) and so follow .nuts-theme / .shuffle-theme with no
           per-site rules needed here. */
        #ratchet-master-container #dt-panel-stats .hud-controls-deck { grid-template-columns: 1fr; }
        /* Label left, control right on ONE line — the same shape Stake's mobile
           deck uses. Full-width inputs under a full-width label looked stretched
           and cost twice the vertical space; this fits the whole deck plus the
           run controls on a phone screen without scrolling. */
        #ratchet-master-container #dt-panel-stats .hud-control-group:not(.hud-volume-group) {
            flex-direction: row !important; align-items: center !important; gap: 10px !important; }
        #ratchet-master-container #dt-panel-stats .hud-control-group:not(.hud-volume-group) > label {
            flex: 0 0 auto !important; margin: 0 !important; }
        #ratchet-master-container #dt-panel-stats .hud-control-group:not(.hud-volume-group) > input[type="number"],
        #ratchet-master-container #dt-panel-stats .hud-control-group:not(.hud-volume-group) > select,
        #ratchet-master-container #dt-panel-stats .hud-control-group:not(.hud-volume-group) > .hud-autostop-row,
        #ratchet-master-container #dt-panel-stats .hud-control-group:not(.hud-volume-group) > .hud-base-row {
            /* 200px, not less: a SOL amount is 10 characters (0.00000012) and the
               Base Bet row spends ~60px of its width on the 1/2 and 2x buttons.
               At 158px the value rendered as "0.000000" — clipped, which is the
               precise complaint this whole area exists to avoid. One width for
               every row also keeps the right edge aligned. */
            flex: 0 1 200px !important; min-width: 0 !important; margin-left: auto !important; }
        #ratchet-master-container #dt-panel-stats .hud-base-row { display: flex; align-items: center; gap: 5px; }
        #ratchet-master-container #dt-panel-stats .hud-base-row input { flex: 1 1 0; min-width: 0; }
        #ratchet-master-container #dt-panel-stats .hud-base-row .quick-btn { flex: 0 0 auto; }
        #ratchet-master-container #dt-panel-stats .hud-autostop-row { display: flex; align-items: center; gap: 7px; }
        #ratchet-master-container #dt-panel-stats .hud-autostop-row input[type="checkbox"] { appearance: auto; -webkit-appearance: auto;
            width: 16px; height: 16px; margin: 0; flex: 0 0 auto; accent-color: var(--hud-green); }
        #ratchet-master-container #dt-panel-stats .hud-autostop-row input[type="number"] { flex: 1 1 0; min-width: 0; }
        #ratchet-master-container #dt-panel-stats .hud-volume-group label { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
        #ratchet-master-container #dt-panel-stats .hud-volume-group input[type="range"] { width: 100%; accent-color: var(--hud-green); }
        /* Four buttons: one row when there is space, 2x2 on a narrow phone rather
           than four slivers too small to tap.
           STICKY to the bottom of the scrolling .dt-body: the stats block, the
           graph and seven control rows push this well below the fold on a phone,
           so START used to need a long scroll every time ("i have to scroll way
           too much just to start the autoplay"). Pinned, the run controls are on
           screen wherever you are in the tab. The backdrop keeps deck rows from
           showing through as they scroll underneath. */
        #ratchet-master-container #dt-panel-stats .dt-action-bar { display: flex; flex-wrap: wrap; gap: 7px; flex: 0 0 auto; }
        /* Only START is pinned. FULLY opaque, not var(--hud-bg): that token is
           rgba(...,0.97) and on a real iPhone the 3% let deck rows ghost through
           the pinned bar. Per-theme opaque equivalents below. */
        /* Sibling of .dt-body, not inside it — see ensureNutsStatsTab. Opaque, so
           nothing scrolling underneath can ghost through. */
        #ratchet-master-container #hud-content > #dt-aio-panel > .hud-cmd-bar { flex: 0 0 auto;
            display: flex; flex-direction: column; gap: 6px;
            z-index: 6; padding: 7px 8px 8px; margin: 0;
            background: #0f212e; box-shadow: 0 -10px 14px -8px rgba(0, 0, 0, 0.85); }
        #ratchet-master-container.shuffle-theme #hud-content > #dt-aio-panel > .hud-cmd-bar { background: #0a0818; }
        #ratchet-master-container.nuts-theme #hud-content > #dt-aio-panel > .hud-cmd-bar { background: #0a0c14; }
        #ratchet-master-container .hud-cmd-bar .cmd-row { display: flex; gap: 6px; align-items: stretch; }
        /* The primary row must never wrap: bet size and START stay side by side at
           any width, because these two together are the whole point of the bar. */
        #ratchet-master-container .hud-cmd-bar .cmd-primary { flex-wrap: nowrap; }
        #ratchet-master-container .hud-cmd-bar .cmd-bet {
            flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 4px;
            padding: 0 6px 0 8px; border-radius: 8px;
            background: rgba(0, 0, 0, 0.32);
            border: 1px solid var(--hud-border-soft);
        }
        #ratchet-master-container .hud-cmd-bar .cmd-bet-label {
            font-size: 9px; font-weight: 800; letter-spacing: 0.12em;
            opacity: 0.6; flex: 0 0 auto;
        }
        /* Fills the row, so the amount is never the thing that gets truncated —
           an 8dp SOL figure needs every pixel it can get. */
        #ratchet-master-container .hud-cmd-bar .cmd-bet input {
            flex: 1 1 auto; min-width: 0; width: 100%;
            background: transparent; border: 0; outline: none; box-shadow: none;
            color: #fff; font-size: 13px; font-weight: 700;
            font-variant-numeric: tabular-nums; text-align: right; padding: 9px 2px;
        }
        #ratchet-master-container .hud-cmd-bar .cmd-bet .quick-btn {
            flex: 0 0 auto; min-width: 30px; min-height: 30px; padding: 0 7px;
            font-size: 11px; font-weight: 800; border-radius: 6px;
        }
        /* Pushed to the RIGHT. Flush left it sat directly under the floating
           "● Dice" quick enable/disable chip, which is anchored to the bottom-left
           of the viewport — so the chip covered the one control that has to be
           tappable. margin-left:auto rather than justify-content on the row, so it
           stays right-aligned even if buttons are added beside it later. */
        #ratchet-master-container .hud-cmd-bar .cmd-primary > .hud-rapid-btn {
            flex: 0 0 40%; margin-left: auto; min-height: 44px; border-radius: 8px;
            font-size: 13px; font-weight: 900; letter-spacing: 0.08em;
        }
        /* Secondary actions may wrap freely — they sit BELOW the primary row, so
           wrapping can never push START off the bottom of the panel. */
        #ratchet-master-container .hud-cmd-bar .cmd-secondary { flex-wrap: wrap; }
        #ratchet-master-container .hud-cmd-bar .cmd-secondary > button {
            flex: 1 1 auto; min-width: 66px; min-height: 32px; padding: 0 8px;
            font-size: 10.5px; font-weight: 800; letter-spacing: 0.04em;
            border-radius: 7px; white-space: nowrap;
        }
        /* iOS Safari draws stepper arrows inside every number input, which ate a
           chunk of each already-narrow field and looked nothing like the rest of
           the UI. Only visible when rendered in WebKit — Chromium at the same
           width showed clean fields. */
        #ratchet-master-container #dt-panel-stats input[type="number"],
        #ratchet-master-container .cond-modal input[type="number"] {
            -webkit-appearance: none !important; appearance: none !important; margin: 0 !important; }
        #ratchet-master-container #dt-panel-stats input[type="number"]::-webkit-outer-spin-button,
        #ratchet-master-container #dt-panel-stats input[type="number"]::-webkit-inner-spin-button,
        #ratchet-master-container .cond-modal input[type="number"]::-webkit-outer-spin-button,
        #ratchet-master-container .cond-modal input[type="number"]::-webkit-inner-spin-button {
            -webkit-appearance: none !important; appearance: none !important; margin: 0 !important; display: none !important; }
        #ratchet-master-container #dt-panel-stats .dt-action-bar > button { flex: 1 1 46%; min-width: 96px; min-height: 36px;
            padding: 8px 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; border-radius: 6px; }
        /* .hud-update-btn is painted for Stake/Shuffle by the dice-tool bridge CSS,
           which never loads on Nuts. This rule was meant to cover that — but it
           was scoped to .dt-action-bar, and on Nuts the button lives in the
           command bar (.hud-cmd-bar > .cmd-secondary). So it matched NOTHING:
           .cmd-secondary > button sets geometry only, leaving UPDATE as bare text
           with no background or border. RESET and O/U escaped that because their
           paint (.hud-reset-btn / .hud-switch-ou-btn) is scoped to the HUD root
           and matches wherever they sit — which is what these two now do.
           Treatment mirrors what the DESKTOP bundle already does for this exact
           button on this exact site — a tinted accent-a fill with an accent
           border, so START keeps the solid accent to itself and the two are not
           mistakable for each other. The tint is stronger than desktop's 8%:
           that was what made it read as text on a phone. */
        #ratchet-master-container.nuts-theme #dt-panel-stats .hud-update-btn {
            background: rgba(25, 243, 255, 0.18); border: 1px solid rgba(25, 243, 255, 0.6);
            color: var(--hud-green, #19f3ff); cursor: pointer; text-transform: uppercase;
            box-shadow: 0 0 10px rgba(25, 243, 255, 0.18); }
        #ratchet-master-container.nuts-theme #dt-panel-stats .hud-update-btn:active {
            background: rgba(25, 243, 255, 0.34); color: #08121c; }
        #ratchet-master-container .cond-actionbar .btn-group > button { flex: 1 1 0; min-width: 0; min-height: 34px; padding: 7px 6px;
            font-size: 11px; font-weight: 800; letter-spacing: 0.04em; border-radius: 6px; }
        #ratchet-master-container .cond-actionbar .quick-btn { background: #071824; border: 1px solid #2f4553; color: #c9d1d9; border-radius: 3px; box-shadow: none;}
        /* ---- Strategy frame (sunken LabelFrame, like the panel's dt-card) ---- */
        #ratchet-master-container .cond-deck-wrap { position: relative; flex: 0 0 auto; display: flex; flex-direction: column; gap: 9px; padding: 15px 10px 11px;
            background: #162a35 !important; border: 2px solid #c9d1d9 !important; border-radius: 4px !important;
            box-shadow: inset 1px 1px 4px rgba(0,0,0,0.35) !important; backdrop-filter: none !important;
            font-family: "Segoe UI", -apple-system, sans-serif; color: #c9d1d9; }
        #ratchet-master-container .cond-deck-head { position: absolute; top: -11px; left: 10px; background: #162a35; padding: 0 7px;
            font-family: "Times New Roman", Georgia, serif; font-style: italic; font-weight: 700; text-decoration: underline;
            font-size: 13.5px; color: #c9d1d9; letter-spacing: 0; text-transform: none; white-space: nowrap; }
        /* Shared clam fields/buttons inside the frame */
        #ratchet-master-container .cond-deck-wrap input[type="number"],
        #ratchet-master-container .cond-deck-wrap input[type="text"],
        #ratchet-master-container .cond-deck-wrap select { background: #071824; border: 1px solid #2f4553; border-radius: 3px; color: #c9d1d9;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 400; padding: 6px 7px;
            box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4); appearance: auto; outline: none; }
        #ratchet-master-container .cond-deck-wrap input:focus,
        #ratchet-master-container .cond-deck-wrap select:focus { border-color: #c9d1d9; box-shadow: 0 0 0 1px #c9d1d9; }
        #ratchet-master-container .cond-deck-wrap .cond-btn { background: #071824; border: 1px solid #2f4553; color: #c9d1d9; border-radius: 3px; cursor: pointer;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 600; padding: 7px 12px; min-height: 32px; flex: 0 0 auto; }
        #ratchet-master-container .cond-deck-wrap .cond-btn:active { background: #1f333e; color: #fff; }
        #ratchet-master-container .cond-deck-wrap .cond-btn:disabled { opacity: 0.45; }
        /* ---- Saved-strategy bar ---- */
        #ratchet-master-container .cond-strat-bar { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding-bottom: 9px; border-bottom: 1px solid #2f4553; }
        #ratchet-master-container .cond-strat-bar input#h-strat-name { flex: 1 1 130px; min-width: 0; }
        #ratchet-master-container .cond-strat-bar select#h-strat-select { flex: 1 1 100%; min-width: 0; }
        /* ---- Condition rows ---- */
        #ratchet-master-container .cond-deck { display: flex; flex-direction: column; gap: 6px; }
        #ratchet-master-container .cond-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; background: #10202b; border: 1px solid #2f4553; border-radius: 3px; padding: 6px 8px; }
        #ratchet-master-container .cond-row select { width: auto; flex: 0 0 auto; font-size: 11.5px; padding: 5px 6px; }
        #ratchet-master-container .cond-row input[type="number"] { width: 58px; text-align: center; }
        #ratchet-master-container .cond-row input.cond-amount, #ratchet-master-container .cond-row input.cond-value { width: 94px; text-align: left; }
        #ratchet-master-container .cond-row .cond-arrow { color: #7d8a96; font-weight: 700; }
        #ratchet-master-container .cond-row .cond-del { margin-left: auto; background: #071824; border: 1px solid #2f4553; color: #e08a9b; border-radius: 3px;
            width: 28px; height: 28px; cursor: pointer; font-weight: 700; line-height: 1; flex: 0 0 auto; font-size: 15px; }
        #ratchet-master-container .cond-row .cond-del:active { background: #e11d48; border-color: #e11d48; color: #fff; }
        #ratchet-master-container .cond-add-btn { align-self: flex-start; background: #071824; border: 1px solid #2f4553; color: #c9d1d9; border-radius: 3px; cursor: pointer;
            font-family: "Segoe UI", -apple-system, sans-serif; font-size: 12px; font-weight: 600; letter-spacing: 0; text-transform: none; padding: 7px 12px; min-height: 32px; }
        #ratchet-master-container .cond-add-btn:active { background: #1f333e; color: #fff; }
        #ratchet-master-container .cond-empty { color: #7d8a96; font-size: 11.5px; font-style: italic; padding: 2px; }
        /* ---- Conditions popup ----
           Overlays the HUD (see ensureCondModal for why it is absolute-in-HUD
           and not viewport-fixed). Inside is the same .cond-deck-wrap markup
           that used to sit inline, so it keeps the field/button styling above.
           Near-full-bleed on a phone, and the card scrolls rather than the page,
           so a long strategy stays reachable with one thumb. */
        #ratchet-master-container .cond-modal { position: absolute; inset: 0; z-index: 60; display: none;
            align-items: stretch; justify-content: center; padding: 10px; }
        #ratchet-master-container .cond-modal.show { display: flex; }
        #ratchet-master-container .cond-modal-backdrop { position: absolute; inset: 0; background: rgba(4, 6, 12, 0.78); }
        #ratchet-master-container .cond-modal-card { position: relative; z-index: 1; display: flex; flex-direction: column; gap: 8px;
            width: 100%; max-height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: 10px;
            background: var(--hud-panel, #162a35); border: 1px solid var(--hud-border, #2f4553); border-radius: 12px;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6); }
        #ratchet-master-container .cond-modal-head { display: flex; align-items: center; justify-content: space-between;
            gap: 10px; flex: 0 0 auto; }
        #ratchet-master-container .cond-modal-title { font-size: 10.5px; font-weight: 800; letter-spacing: 0.09em;
            text-transform: uppercase; color: var(--hud-green, #00ff9d); }
        #ratchet-master-container .cond-modal-close { width: 34px; height: 34px; flex: 0 0 auto; cursor: pointer;
            background: rgba(255, 255, 255, 0.06); border: 1px solid var(--hud-border-soft, #2f4553); border-radius: 8px;
            color: #f5fbff; font-size: 18px; line-height: 1; font-weight: 700; }
        #ratchet-master-container .cond-modal .cond-deck-wrap { width: 100%; }
        /* Breathing room inside the popup. The rows were butted together, which
           made a five-condition strategy read as one block of controls rather
           than five separate rules. Only inside the modal, so nothing else that
           renders .cond-row is affected. */
        #ratchet-master-container .cond-modal .cond-deck { gap: 12px !important; }
        #ratchet-master-container .cond-modal .cond-row { padding: 10px !important; gap: 8px !important; }
        #ratchet-master-container .cond-modal .cond-strat-bar { gap: 9px !important; padding-bottom: 12px !important; margin-bottom: 4px !important; }
        #ratchet-master-container .cond-modal .cond-add-btn { margin-top: 4px !important; }
        /* iOS Safari ignores background/color on a <select> while it keeps its
           native appearance — the condition dropdowns rendered as WHITE boxes
           with near-invisible text on a real iPhone, while Chromium at the same
           width honoured the dark fill and looked fine. Reset the appearance and
           supply our own chevron: a FILLED triangle, not a stroke path — the
           first attempt used a polyline with fill and painted nothing. */
        #ratchet-master-container .cond-modal select,
        #ratchet-master-container #dt-panel-stats select {
            -webkit-appearance: none !important; appearance: none !important;
            background-image: url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 8'%3E%3Cpath fill='%23aab6c9' d='M6 7.2 0.6 1.4h10.8z'/%3E%3C/svg%3E") !important;
            background-repeat: no-repeat !important;
            background-position: right 9px center !important;
            background-size: 10px 7px !important;
            padding-right: 26px !important; text-overflow: ellipsis; }
        #ratchet-master-container .cond-modal select::-ms-expand { display: none; }
        /* ---- PER-SITE THEME for the conditions editor ----
           The .cond-* chrome above is the DiceTool.exe replica (slate frame,
           Times New Roman italic notched title, gray clam fields). The shared
           panel theme cannot reach it: that block is scoped through
           #hud-content > #dt-aio-panel, and this popup is a child of the HUD
           ROOT, not of the panel — so once the editor moved into the popup it was
           the one surface still slate inside an otherwise cyan/violet HUD.
           (No backticks in here — this whole block is a JS template literal.)
           Scoped through :is(.shuffle-theme, .nuts-theme) so Stake keeps the
           replica, and coloured from the HUD's own vars so Shuffle comes out
           violet and Nuts cyan with no per-site rules. */
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap { padding: 11px !important;
            background: rgba(10, 10, 24, 0.55) !important; border: 1px solid var(--hud-border-soft) !important;
            border-radius: 11px !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03) !important;
            color: #f5fbff !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-head { position: static !important;
            top: auto !important; left: auto !important; display: block !important; background: none !important;
            padding: 0 0 6px !important; margin: 0 0 8px !important; font-family: inherit !important;
            font-style: normal !important; text-decoration: none !important; font-size: 10px !important;
            font-weight: 800 !important; letter-spacing: 0.09em !important; text-transform: uppercase !important;
            color: var(--hud-green) !important; border-bottom: 1px solid var(--hud-border-soft) !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-strat-bar { border-bottom: 1px solid var(--hud-border-soft) !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-strat-bar .cond-strat-sep { background: var(--hud-border-soft) !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap input[type="number"],
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap input[type="text"],
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap select { background: rgba(8, 8, 20, 0.85) !important;
            border: 1px solid var(--hud-border-soft) !important; border-radius: 8px !important; color: #f5fbff !important;
            font-weight: 700 !important; box-shadow: none !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap input:focus,
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap select:focus { border-color: var(--hud-green) !important;
            box-shadow: 0 0 0 2px var(--hud-border-soft) !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap .cond-btn { background: rgba(255, 255, 255, 0.05) !important;
            border: 1px solid var(--hud-border-soft) !important; color: #f5fbff !important; border-radius: 8px !important;
            font-size: 10px !important; font-weight: 800 !important; text-transform: uppercase !important;
            letter-spacing: 0.05em !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-deck-wrap .cond-btn:active:not(:disabled) { background: var(--hud-border-soft) !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-row { background: rgba(8, 8, 20, 0.55) !important;
            border: 1px solid rgba(255, 255, 255, 0.07) !important; border-radius: 9px !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-row .cond-arrow { color: var(--hud-green) !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-row .cond-del { background: rgba(255, 107, 138, 0.12) !important;
            border: 1px solid rgba(255, 107, 138, 0.4) !important; color: #ff6b8a !important; border-radius: 8px !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-row .cond-del:active { background: #ff6b8a !important; color: #fff !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-add-btn { background: rgba(255, 255, 255, 0.04) !important;
            border: 1px dashed var(--hud-green) !important; color: var(--hud-green) !important; border-radius: 8px !important;
            font-size: 10px !important; font-weight: 800 !important; text-transform: uppercase !important;
            letter-spacing: 0.05em !important; }
        #ratchet-master-container:is(.shuffle-theme, .nuts-theme) .cond-empty { color: #a9b2c9 !important; }
        /* Opener sits with the run controls and carries the condition count.
           Panel-scoped, NOT .dt-action-bar-scoped — see .hud-update-btn above:
           this button lives in .hud-cmd-bar > .cmd-secondary, so the old selector
           never matched and CONDITIONS rendered as bare text (a 5% white wash over
           the panel was invisible in any case). Violet accent-b, the same choice
           the desktop bundle makes for this button, so the three sit apart at a
           glance: gradient START, cyan UPDATE, violet CONDITIONS. Literal violet
           because the mobile bundle has no --hud-accent-b token. */
        #ratchet-master-container #dt-panel-stats .cond-open-btn { cursor: pointer;
            background: rgba(143, 99, 255, 0.2); border: 1px solid rgba(143, 99, 255, 0.6);
            color: #c3adff; text-transform: uppercase;
            box-shadow: 0 0 10px rgba(143, 99, 255, 0.16); }
        #ratchet-master-container #dt-panel-stats .cond-open-btn:active {
            background: rgba(143, 99, 255, 0.36); color: #fff; }
    `);
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
    function condCalcDp() { return currencyInputStep() === '0.01' ? 2 : 8; }
    /* ---- Saved strategies — the Nuts stand-in for Stake's native strategy
       list. A strategy is the condition set plus the bet size and payout it was
       built for (the calculator keeps its own state in the panel, as on Stake).
       Name it, Save stores it, and picking it from the dropdown loads it. ---- */
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
            condCurBet = condBaseBet;
            const ci = document.getElementById('h-cond-base');
            if (ci) ci.value = formatCurrencyInput(condBaseBet);
            setBet(condBaseBet);
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
        condNotice = { text: `Loaded “${s.name}” — tap START`, until: Date.now() + 4000 };
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
    /* ---- DiceTool panel (#dt-aio-panel) mount helpers. dt_init() (bundled)
       builds the panel; Advanced IOW mounts it as a direct child of
       #hud-content, where the bridge CSS makes it fill the tab. ---- */
    function unmountDicePanel() {
        const p = document.getElementById('dt-aio-panel');
        if (p && p.parentElement && p.parentElement.id === 'hud-content') {
            document.body.appendChild(p);
            p.classList.remove('show');
            p.classList.add('dt-bridge-hidden');
        }
        // Empty the Stats tab whenever the panel is parked — its controls reuse
        // the HUD's element ids, so leaving them in a detached panel would create
        // duplicate ids that getElementById could hand to another mode.
        const statsPanel = document.getElementById('dt-panel-stats');
        if (statsPanel) statsPanel.textContent = '';
    }
    function mountDicePanel() {
        const p = document.getElementById('dt-aio-panel');
        const content = document.getElementById('hud-content');
        if (!p || !content) return;
        if (p.parentElement !== content) content.appendChild(p);
        p.classList.remove('dt-bridge-hidden');
        p.classList.add('show');
    }
    /** Build (or refill) the Advanced IOW "Stats" tab — the tab the user plays
     *  from, mirroring the one Stake's integration injects: first in the tab
     *  strip and the landing tab. START / RESET / Switch O/U stay in the HUD's
     *  own pinned action bar below the panel, as in every other mobile mode.
     *  Returns false until the DiceTool panel exists. */
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
        /* Lift the START row OUT of the scrolling .dt-body and make it the panel's
           last child. `position: sticky; bottom: 0` cannot work where it was born:
           it was the final child of .hud-shell, a container that hugs its content,
           so there was no room inside the containing block for it to stick to and
           it simply flowed to the end and got clipped by the bottom of the HUD.
           A flex sibling after .dt-body needs no sticky at all — the panel is a
           flex column, .dt-body takes the leftover space and scrolls, and this row
           is always on screen. It also survives tab switches, so START stays
           reachable from Calculator / Strategy Finder too. */
        /* Lifting the bar out of the scroller MOVES it, so re-rendering
           statsPanel.innerHTML above cannot remove the copy already sitting in the
           panel — every extra call would leave another bar behind. Clear the
           previously lifted ones first, so this stays idempotent no matter how
           often it is called. */
        panel.querySelectorAll(':scope > .hud-cmd-bar').forEach(el => el.remove());
        const cmdBar = statsPanel.querySelector('.hud-cmd-bar');
        if (cmdBar) panel.appendChild(cmdBar);
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
        const moneyStep = currencyInputStep();
        return `
            <div class="hud-shell">
                <div class="hud-stats hud-panel">
                    <div class="hud-statusline" id="h-target">Advanced IOW • Tap START</div>
                    <div class="hud-hero">
                        <span class="hud-hero-label">Profit / Loss</span>
                        <span id="h-profit" class="hud-hero-val">0.00</span>
                        <span class="hud-hero-start">from <b id="h-start-bal">0.00</b></span>
                    </div>
                    <!-- The SAME stats the Stake/Shuffle Advanced IOW deck shows,
                         so the tab reads identically whichever site you are on.
                         Start Bal and Profit/Loss are in the hero above; the rest
                         of that deck's twelve rows are here, using the labels it
                         uses ("Streak (W|L)", "Mult Perf", "Balance Target",
                         "Profit Stop") rather than near-misses.

                         Streak (W|L), Mult Perf, Balance Target and Profit Stop
                         were missing entirely, and Wins / L streak with them — so
                         when the status line stopped restating "wins and loss
                         streak" on the grounds that "the stats deck already shows
                         them", on Nuts mobile nothing did. updateUI()'s cond branch
                         writes every id below.

                         Wins / L streak are the PROGRESSION counters (wins since
                         the bet last reset to base, current loss streak), the same
                         pair desktop's Advanced IOW carries as a chip; they are
                         plain rows here because the mobile bundle has no .cond-chip
                         CSS and the row style is what the rest of this deck uses. -->
                    <div class="hud-stats-grid">
                        <div class="stats-col-inner">
                            <div class="hud-row"><span class="hud-label">Peak Bal</span><span id="h-peak-bal" class="hud-val" style="color:#00ff9d;">0.00</span></div>
                            <div class="hud-row"><span class="hud-label">Peak Profit</span><span id="h-high-profit" class="hud-val" style="color:#00ff9d;">0.00</span></div>
                            <div class="hud-row"><span class="hud-label">Session RTP</span><span id="h-rtp" class="hud-val">100.00%</span></div>
                            <div class="hud-row"><span class="hud-label">Streak (W|L)</span><span id="h-streaks" class="hud-val">0/0 | 0/0</span></div>
                            <div class="hud-row"><span class="hud-label">Balance Target</span><span id="h-stats-bal-target" class="hud-val">0.00</span></div>
                            <div class="hud-row" title="Wins since the bet last reset to base — zeroes when the loss reset fires"><span class="hud-label">Wins</span><span id="h-stats-ctr-w" class="hud-val">0</span></div>
                        </div>
                        <div class="stats-col-inner">
                            <div class="hud-row"><span class="hud-label">Total Bets</span><span id="h-total-bets" class="hud-val">0</span></div>
                            <div class="hud-row"><span class="hud-label">Wagered</span><span id="h-wagered" class="hud-val">0.00</span></div>
                            <div class="hud-row"><span class="hud-label">Wins / Losses</span><span id="h-wl" class="hud-val">0 / 0</span></div>
                            <div class="hud-row"><span class="hud-label">Mult Perf</span><span id="h-mult-perf" class="hud-val">1 in 0.00</span></div>
                            <div class="hud-row"><span class="hud-label">Profit Stop</span><span id="h-stats-profit-stop" class="hud-val">0.00</span></div>
                            <div class="hud-row" title="Current loss streak"><span class="hud-label">L streak</span><span id="h-stats-ctr-l" class="hud-val">0</span></div>
                        </div>
                    </div>
                    <div class="hud-meta-row">
                        <div class="hud-meta-chip"><span class="hud-label">Best</span><span id="h-best-w" class="hud-val" style="color:#00ff9d;">-</span></div>
                        <div class="hud-meta-chip"><span class="hud-label">Worst</span><span id="h-worst-l" class="hud-val" style="color:#f87171;">-</span></div>
                    </div>
                </div>
                <div class="hud-graph-box"><canvas id="h-custom-graph"></canvas></div>
                <!-- Controls deck + action bar, deliberately the SAME structure and
                     class vocabulary Stake/Shuffle's mobile Advanced IOW deck uses
                     (.hud-controls-deck of .hud-control-group rows, then a
                     .dt-action-bar of four buttons in the same order), so the three
                     sites read identically. The colours come from the HUD's own
                     custom properties, so .nuts-theme paints this cyan and
                     .shuffle-theme violet with no per-site rules here.

                     Two rows have no Stake counterpart and are Nuts-only, because
                     this mode runs our own conditions engine rather than driving the
                     site's native autoplay: Base Bet, and the Autostop balance.

                     Run controls: the HUD's own #hud-action-bar (which carries
                     START / RESET / Switch O/U for Manual/IOW/Smart) renders 0x0 and
                     unwired in Advanced IOW, so before these existed the mode had NO
                     way to start a strategy — the status line above has always said
                     "Tap START" for a button that was never drawn. These ids are the
                     ones the HUD already wires: the listener pass runs after
                     ensureNutsStatsTab(), and updateUI() flips START/STOP. The panel
                     sits earlier in the DOM than #hud-action-bar, so getElementById
                     resolves these rather than the collapsed originals.
                     Do NOT add an #h-target here — the .hud-statusline above already
                     owns that id, and a second one only ever shows a stale
                     placeholder (getElementById updates the first). -->
                <div class="hud-controls-deck hud-panel">
                    <!-- Base Bet is NOT here any more: it lives in the pinned
                         command bar below, so the bet size is on screen whenever
                         START is. Duplicating it in this scrolling deck is what
                         made the panel feel like three different control surfaces
                         fighting each other. -->
                    <div class="hud-control-group">
                        <label>Balance Divisor</label>
                        <input id="h-stats-bet-div" type="number" inputmode="decimal" step="any" min="1">
                    </div>
                    <div class="hud-control-group">
                        <label>Profit Multiplier</label>
                        <input id="h-stats-profit-mult" type="number" inputmode="decimal" step="any" min="0">
                    </div>
                    <div class="hud-control-group">
                        <label>Autostop Balance</label>
                        <input id="h-autostop" type="number" inputmode="decimal" step="${moneyStep}" value="${autoStopBalance !== null ? formatCurrencyInput(autoStopBalance) : ''}" placeholder="OFF">
                    </div>
                    <div class="hud-control-group">
                        <label>Autostop @ Win Streak</label>
                        <div class="hud-autostop-row">
                            <input type="checkbox" id="h-stats-ws-chk" ${condWsStopOn ? 'checked' : ''}>
                            <input type="number" min="1" step="1" id="h-stats-ws-target" value="${condWsTarget}">
                        </div>
                    </div>
                    <div class="hud-control-group">
                        <label>Stats Track Per</label>
                        <select id="h-stats-track">
                            <option value="session" ${condTrackPer === 'session' ? 'selected' : ''}>Session</option>
                            <option value="cycle" ${condTrackPer === 'cycle' ? 'selected' : ''}>Cycle</option>
                        </select>
                    </div>
                    <div class="hud-control-group hud-volume-group">
                        <label><span>🔊 Volume</span><span id="h-stats-vol-val">${condVolume}</span></label>
                        <input type="range" id="h-stats-vol" min="0" max="100" step="1" value="${condVolume}">
                    </div>
                </div>
                <!-- Always-visible command bar.
                     Bet size, START and the action buttons used to live in three
                     separate places — base bet buried in the scrolling deck, START
                     pinned alone in its own row, the actions in a third bar, and a
                     verbose status line restating the first two. So the controls
                     you actually touch during a run were never on screen together.
                     They are one bar now, lifted out of the scroller by
                     ensureNutsStatsTab() and pinned to the panel, so it holds
                     position no matter how far the deck scrolls.
                     Two rows by design: the primary row (bet size + START) is the
                     one that must never be clipped, so the secondary actions sit
                     below it and can wrap without pushing START off screen.
                     Every id is unchanged — these ARE the elements the engine
                     already wires, moved rather than duplicated. -->
                <!-- No bet-size field here either. The site's own wager box IS the
                     bet size and the conditions engine writes to it; a second copy
                     in the HUD was one more thing to keep in sync and one more row
                     between the user and START. condBaseBet comes from the native
                     wager input instead (see the ticker).
                     Conditions stays a popup on mobile: the desktop side panel is a
                     fixed 300px column, which cannot exist at 393px. -->
                <div class="hud-cmd-bar">
                    <div class="cmd-row cmd-primary">
                        <button id="h-rapid-toggle" class="hud-rapid-btn start">START</button>
                    </div>
                    <div class="cmd-row cmd-secondary">
                        <button id="h-cond-open" class="cond-open-btn" title="Open the strategy conditions editor">Conditions (${condBlocks.length})</button>
                        ${isOnDicePage() ? '<button id="h-switch-ou" class="hud-switch-ou-btn">O/U</button>' : ''}
                        <button id="h-stats-update" class="hud-update-btn" title="Read the current balance, recompute, and retune the loaded strategy">Update</button>
                        <button id="h-reset" class="hud-reset-btn">RESET</button>
                    </div>
                </div>
            </div>
        `;
    }
    /* The conditions editor. Opened from the deck as a popup rather than sitting
       inline, matching how Stake/Shuffle keep their strategy editor in an
       overlay. Markup and every id the engine wires are unchanged from when it
       was inline. */
    function condDeckHTML() {
        return `
            <div id="h-cond-deck-wrap" class="cond-deck-wrap">
                <div class="cond-deck-head">Strategy</div>
                <div class="cond-strat-bar">
                    <input id="h-strat-name" type="text" placeholder="Strategy name" spellcheck="false" autocomplete="off">
                    <button id="h-strat-save" class="cond-btn">Save</button>
                    <select id="h-strat-select" title="Load a saved strategy"></select>
                    <button id="h-strat-del" class="cond-btn">Delete</button>
                </div>
                <div id="h-cond-list" class="cond-deck"></div>
                <button id="h-cond-add" class="cond-add-btn">+ Add condition</button>
            </div>
        `;
    }
    /** Create the conditions popup, hidden, as a child of the HUD.
     *
     *  Absolute-in-HUD rather than a viewport-fixed dialog on document.body: the
     *  HUD root carries backdrop-filter, which makes it the containing block for
     *  fixed descendants and clips them with overflow:hidden, so fixed would be
     *  laid out against the HUD regardless — and outside the HUD none of the
     *  .cond-* rules or --hud-* theme vars apply, since both are scoped through
     *  #ratchet-master-container. Overlaying the HUD keeps the styling for free.
     *
     *  A child of the HUD, so it is rebuilt with it and the listener pass
     *  re-wires #h-cond-add / #h-strat-* naturally. */
    function ensureCondModal() {
        const hud = document.getElementById('ratchet-master-container');
        if (!hud) return false;
        let modal = document.getElementById('h-cond-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'h-cond-modal';
            modal.className = 'cond-modal';
            modal.innerHTML =
                '<div class="cond-modal-backdrop" data-cond-close="1"></div>' +
                '<div class="cond-modal-card">' +
                  '<div class="cond-modal-head">' +
                    '<span class="cond-modal-title">Strategy Conditions</span>' +
                    '<button type="button" id="h-cond-modal-close" class="cond-modal-close" data-cond-close="1" title="Close">&times;</button>' +
                  '</div>' + condDeckHTML() +
                '</div>';
            hud.appendChild(modal);
            // Backdrop and × both carry data-cond-close, so one handler covers both.
            modal.addEventListener('click', e => {
                if (e.target instanceof Element && e.target.closest('[data-cond-close]')) closeCondModal();
            });
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
    /** Removed when leaving Advanced IOW so its ids can't collide with another
     *  mode's markup. */
    function clearCondModal() {
        const m = document.getElementById('h-cond-modal');
        if (m) m.remove();
    }
    function refreshCondOpenBtn() {
        const b = document.getElementById('h-cond-open');
        if (b) b.textContent = 'Conditions (' + condBlocks.length + ')';
    }
    /* =====================================================================
       PER-SITE PANEL THEME (mobile).
       The DiceTool panel wears the DiceTool.exe replica skin (ttk clam slate:
       #162a35 frames, 2px #c9d1d9 LabelFrames with Times New Roman italic
       notched titles, #071824 entries) and there are TWO verbatim copies of
       that skin — DT_MOB_SKIN_CSS in setupIowDiceIntegration (Stake/Shuffle)
       and NUTS_DT_SKIN_CSS in initNutsDiceBridge (Nuts). Both are slate, so on
       Shuffle and Nuts the panel read as a slate window inside a violet / neon
       HUD.

       This is ONE theme shared by both bridges rather than a third copy to keep
       in sync. It works because:
         - buildHUD already toggles .shuffle-theme / .nuts-theme on
           #ratchet-master-container, and both define the SAME custom property
           names (--hud-green, --hud-green-dark, --hud-panel, --hud-border,
           --hud-border-soft), so one rule set repaints both sites and the
           cascade picks the colours. Shuffle: #6c47ff / #4f35b3 violet.
           Nuts: #19f3ff / #8f63ff neon.
         - :is(.shuffle-theme, .nuts-theme) means Stake matches nothing here, so
           Stake keeps the replica exactly — it cannot be affected.
         - 3 IDs + a class outranks the skins' 2 IDs, so this wins on
           SPECIFICITY and does not depend on being injected after them.
       Only the two things the cascade can't infer are split per site below:
       the ink that sits on the accent (white on violet, near-black on cyan)
       and the muted label/caption tints.

       Deliberately NOT themed: the green/red profit VALUE colours — neither
       theme class overrides --hud-positive/--hud-negative, green-is-good is
       semantic rather than brand chrome.
       Colour and type only - nothing here moves a box.
       (No backticks in here - this block is a JS template literal.) */
    const MOB_THEMED = '#ratchet-master-container:is(.shuffle-theme, .nuts-theme) #hud-content > #dt-aio-panel';
    const MOB_SH     = '#ratchet-master-container.shuffle-theme #hud-content > #dt-aio-panel';
    const MOB_NU     = '#ratchet-master-container.nuts-theme #hud-content > #dt-aio-panel';
    const DT_MOB_SITE_THEME_CSS = `
${MOB_THEMED} { background: var(--hud-panel) !important; border: 1px solid var(--hud-border) !important;
  border-radius: 12px !important; color: #f5fbff !important;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.04) !important; }
/* Tab strip = pills; the active pill takes the HUD's own accent so it matches
   the Manual / IOW / Smart / Tools pills above it. Keeps the bridge's
   horizontal scroll (no flex-wrap changes here). */
${MOB_THEMED} .dt-tabs { background: transparent !important; border-bottom: 1px solid var(--hud-border-soft) !important; gap: 5px !important; }
${MOB_THEMED} .dt-tab-btn { background: rgba(8, 8, 20, 0.72) !important; border: 1px solid var(--hud-border-soft) !important;
  border-radius: 9px !important; font-size: 10px !important; font-weight: 800 !important; letter-spacing: 0.05em !important;
  text-transform: uppercase !important; }
${MOB_THEMED} .dt-tab-btn.active { background: linear-gradient(135deg, var(--hud-green), var(--hud-green-dark)) !important;
  border-color: rgba(255, 255, 255, 0.22) !important; box-shadow: 0 0 12px var(--hud-green) !important; }
${MOB_THEMED} .dt-body { background: transparent !important; }
${MOB_THEMED} .dt-panel { background: transparent !important; }
${MOB_THEMED} .dt-body::-webkit-scrollbar-thumb, ${MOB_THEMED} .dt-scroll::-webkit-scrollbar-thumb,
${MOB_THEMED} .dt-terms-scroll::-webkit-scrollbar-thumb { background: var(--hud-green) !important; opacity: 0.5;
  border-radius: 999px !important; border: 2px solid transparent !important; background-clip: padding-box !important; }
/* LabelFrames become cards; the notched Times-italic title becomes a lettered
   caption over a hairline (padding drops to match). */
${MOB_THEMED} .dt-card { background: rgba(10, 10, 24, 0.55) !important; border: 1px solid var(--hud-border-soft) !important;
  border-radius: 11px !important; padding: 11px !important; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03) !important; }
${MOB_THEMED} .dt-card-title { position: static !important; top: auto !important; left: auto !important; display: block !important;
  background: none !important; padding: 0 0 6px !important; margin: 0 0 10px !important;
  font-family: "Segoe UI", -apple-system, sans-serif !important; font-style: normal !important; text-decoration: none !important;
  font-size: 10px !important; font-weight: 800 !important; letter-spacing: 0.09em !important; text-transform: uppercase !important;
  border-bottom: 1px solid var(--hud-border-soft) !important; }
${MOB_THEMED} input.dt-entry, ${MOB_THEMED} select.dt-theme-select { background: rgba(8, 8, 20, 0.85) !important;
  color: #f5fbff !important; border: 1px solid var(--hud-border-soft) !important; border-radius: 8px !important;
  font-weight: 700 !important; box-shadow: none !important; }
${MOB_THEMED} input.dt-entry:focus, ${MOB_THEMED} select.dt-theme-select:focus { border-color: var(--hud-green) !important;
  box-shadow: 0 0 0 2px var(--hud-border-soft) !important; }
${MOB_THEMED} .dt-btn { background: rgba(255, 255, 255, 0.05) !important; border: 1px solid var(--hud-border-soft) !important;
  color: #f5fbff !important; border-radius: 8px !important; font-size: 10px !important; font-weight: 800 !important;
  text-transform: uppercase !important; letter-spacing: 0.05em !important; box-shadow: none !important; }
${MOB_THEMED} .dt-btn:active { background: rgba(255, 255, 255, 0.1) !important; border-color: var(--hud-green) !important; }
/* Block buttons are each tab's primary action - give them the accent fill. */
${MOB_THEMED} .dt-btn-block { background: linear-gradient(135deg, var(--hud-green), var(--hud-green-dark)) !important;
  border-color: rgba(255, 255, 255, 0.2) !important; box-shadow: 0 0 14px var(--hud-green) !important; }
${MOB_THEMED} .dt-progress-wrap { background: rgba(8, 8, 20, 0.85) !important; border: 1px solid var(--hud-border-soft) !important;
  border-radius: 999px !important; overflow: hidden !important; }
${MOB_THEMED} .dt-progress-bar { background: linear-gradient(90deg, var(--hud-green), var(--hud-green-dark)) !important; }
${MOB_THEMED} .dt-scroll { background: rgba(8, 8, 20, 0.72) !important; border: 1px solid var(--hud-border-soft) !important;
  border-radius: 11px !important; }
${MOB_THEMED} .dt-sep { background: var(--hud-border-soft) !important; }
${MOB_THEMED} .dt-chk { accent-color: var(--hud-green) !important; }
/* Tables: accent lettered headers, hairline rules. The replica's #2d2d2d /
   #383838 Tk striping reads as a gray hole punched in a themed panel. */
${MOB_THEMED} table.dt-stats th, ${MOB_THEMED} table.dt-results th { background: rgba(8, 8, 20, 0.94) !important;
  color: var(--hud-green) !important; font-size: 9.5px !important; font-weight: 800 !important; letter-spacing: 0.07em !important;
  text-transform: uppercase !important; border-bottom: 1px solid var(--hud-border-soft) !important; }
${MOB_THEMED} table.dt-stats td, ${MOB_THEMED} table.dt-results td { color: #f5fbff !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05) !important; }
${MOB_THEMED} table.dt-results tr:nth-child(odd) td { background: rgba(255, 255, 255, 0.03) !important; }
${MOB_THEMED} table.dt-results tr:nth-child(even) td { background: transparent !important; }
${MOB_THEMED} table.dt-results tr.selected td { background: var(--hud-border-soft) !important; color: #fff !important; }
${MOB_THEMED} table.dt-results tr.selected td:first-child { box-shadow: inset 2px 0 0 var(--hud-green) !important; }
/* The replica neutralized the colour-coded cells to match DiceTool.exe. Give
   them back — these stay the semantic green/red on every site.
   These MUST be qualified by the table class: the generic "table.dt-results td"
   rule above carries an extra element in its selector, so a bare
   "td.dt-cell-good" loses to it on specificity and the cells silently render
   as plain body text. */
${MOB_THEMED} table.dt-stats td.dt-cell-good, ${MOB_THEMED} table.dt-results td.dt-cell-good { color: #00ff9d !important; }
${MOB_THEMED} table.dt-stats td.dt-cell-mid, ${MOB_THEMED} table.dt-results td.dt-cell-mid { color: #ffd479 !important; }
${MOB_THEMED} table.dt-stats td.dt-cell-bad, ${MOB_THEMED} table.dt-results td.dt-cell-bad { color: #ff6b8a !important; }
/* Terms glossary */
${MOB_THEMED} .dt-terms-scroll { background: rgba(8, 8, 20, 0.72) !important; border: 1px solid var(--hud-border-soft) !important;
  border-radius: 11px !important; }
${MOB_THEMED} .dt-terms-heading { color: var(--hud-green) !important; font-size: 11.5px !important; font-weight: 800 !important;
  letter-spacing: 0.07em !important; text-transform: uppercase !important;
  border-bottom: 1px solid var(--hud-border-soft) !important; padding-bottom: 4px !important; }
${MOB_THEMED} .dt-terms-label { color: #f5fbff !important; }
/* ---- The two things the cascade can't infer: ink on the accent, and the
        muted tints. Shuffle is violet (white ink); Nuts is cyan (dark ink). */
${MOB_SH} .dt-tab-btn.active, ${MOB_SH} .dt-btn-block { color: #ffffff !important; }
${MOB_NU} .dt-tab-btn.active, ${MOB_NU} .dt-btn-block { color: #0a0c14 !important; }
${MOB_SH} .dt-tab-btn { color: #a99ede !important; }
${MOB_NU} .dt-tab-btn { color: #aab6c9 !important; }
${MOB_SH} .dt-card-title, ${MOB_SH} .dt-terms-subheading { color: #9d7cff !important; }
${MOB_NU} .dt-card-title, ${MOB_NU} .dt-terms-subheading { color: #19f3ff !important; }
${MOB_SH} .dt-lbl, ${MOB_SH} .dt-status-line, ${MOB_SH} .dt-set-desc, ${MOB_SH} .dt-set-val,
${MOB_SH} .dt-terms-dash, ${MOB_SH} .dt-terms-def, ${MOB_SH} .dt-terms-text,
${MOB_SH} table.dt-stats td:first-child { color: #a99ede !important; }
${MOB_NU} .dt-lbl, ${MOB_NU} .dt-status-line, ${MOB_NU} .dt-set-desc, ${MOB_NU} .dt-set-val,
${MOB_NU} .dt-terms-dash, ${MOB_NU} .dt-terms-def, ${MOB_NU} .dt-terms-text,
${MOB_NU} table.dt-stats td:first-child { color: #aab6c9 !important; }`;
    /* Build the DiceTool panel on Nuts + inject the bridge CSS that fits it into
       the Advanced IOW tab. Called from boot() on Nuts (where the normal
       dt_init()+integration is skipped). */
    function initNutsDiceBridge() {
        if (window.__nuts_dt_panel_init__) return;
        window.__nuts_dt_panel_init__ = true;
        /* DiceTool.exe replica skin — a verbatim copy of DT_MOB_SKIN_CSS from
           setupIowDiceIntegration (which only runs on Stake/Shuffle), so the
           Nuts Advanced IOW panel renders identically to Stake's. Keep the two
           copies in sync; both are scoped to `#hud-content > #dt-aio-panel`. */
        const NUTS_DT_SKIN_CSS = `
/* Panel chrome */
#hud-content > #dt-aio-panel { background: #162a35 !important; border: 1px solid #2f4553 !important; border-radius: 8px !important; font-size: 12px !important; line-height: 1.45 !important; color: #c9d1d9 !important; font-family: "Segoe UI", -apple-system, sans-serif !important; overflow: hidden !important; }
/* Tab strip = ttk.Notebook: flat tabs, selected = select_bg #1f333e (keeps the bridge's horizontal scroll) */
#hud-content > #dt-aio-panel .dt-tabs { background: #162a35 !important; border-bottom: 1px solid #2f4553 !important; border-radius: 0 !important; padding: 5px 6px 0 !important; gap: 2px !important; }
#hud-content > #dt-aio-panel .dt-tab-btn { flex: 0 0 auto !important; padding: 8px 11px !important; font-size: 11.5px !important; font-weight: 700 !important; color: #c9d1d9 !important; background: #10202b !important; border: 1px solid #2f4553 !important; border-bottom: none !important; border-radius: 4px 4px 0 0 !important; text-transform: none !important; letter-spacing: 0 !important; box-shadow: none !important; }
#hud-content > #dt-aio-panel .dt-tab-btn.active { background: #1f333e !important; color: #ffffff !important; border-color: #3a5566 !important; box-shadow: none !important; }
#hud-content > #dt-aio-panel .dt-tab-btn .dt-tab-icon { display: none !important; }
/* Body */
#hud-content > #dt-aio-panel .dt-body { padding: 15px 8px 8px !important; background: #162a35 !important; }
#hud-content > #dt-aio-panel .dt-panel { background: transparent !important; }
#hud-content > #dt-aio-panel .dt-panel.active { gap: 15px !important; }
/* LabelFrames: sunken, 2px slate border, serif italic underlined title on the border */
#hud-content > #dt-aio-panel .dt-card { background: #162a35 !important; border: 2px solid #c9d1d9 !important; border-radius: 4px !important; padding: 14px 10px 10px !important; margin: 0 !important; box-shadow: inset 1px 1px 4px rgba(0,0,0,0.35) !important; position: relative !important; overflow: visible !important; display: block !important; }
#hud-content > #dt-aio-panel .dt-card-title { position: absolute !important; top: -10px !important; left: 10px !important; background: #162a35 !important; padding: 0 7px !important; font-family: "Times New Roman", Georgia, serif !important; font-style: italic !important; font-weight: 700 !important; text-decoration: underline !important; font-size: 13px !important; color: #c9d1d9 !important; letter-spacing: 0 !important; text-transform: none !important; white-space: nowrap !important; margin: 0 !important; }
/* Labels + entries (ttk clam) */
#hud-content > #dt-aio-panel .dt-lbl { font-size: 12px; font-weight: 700; color: #c9d1d9; }
#hud-content > #dt-aio-panel input.dt-entry, #hud-content > #dt-aio-panel select.dt-theme-select { background: #071824 !important; color: #c9d1d9 !important; border: 1px solid #2f4553 !important; border-radius: 3px !important; padding: 6px 8px !important; font-size: 12px !important; font-weight: 400 !important; font-family: "Segoe UI", -apple-system, sans-serif !important; min-width: 0 !important; min-height: 30px !important; text-align: left !important; box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4) !important; -webkit-appearance: none !important; appearance: none !important; outline: none !important; }
#hud-content > #dt-aio-panel input.dt-entry:focus { border-color: #c9d1d9 !important; box-shadow: 0 0 0 1px #c9d1d9 !important; }
#hud-content > #dt-aio-panel input.dt-out-val[readonly] { opacity: 1 !important; font-weight: 400 !important; width: 100% !important; }
#hud-content > #dt-aio-panel .dt-opt-table .dt-in, #hud-content > #dt-aio-panel .dt-ctl-row input.dt-entry { text-align: center !important; }
#hud-content > #dt-aio-panel .dt-opt-table .dt-values-in { text-align: left !important; }
/* Buttons (ttk clam) */
#hud-content > #dt-aio-panel .dt-btn { background: #071824 !important; border: 1px solid #2f4553 !important; color: #c9d1d9 !important; border-radius: 3px !important; font-size: 12px !important; font-weight: 600 !important; letter-spacing: 0 !important; text-transform: none !important; padding: 6px 12px !important; min-height: 32px !important; font-family: "Segoe UI", -apple-system, sans-serif !important; box-shadow: none !important; }
#hud-content > #dt-aio-panel .dt-btn:active { background: #1f333e !important; transform: none !important; filter: none !important; }
#hud-content > #dt-aio-panel .dt-btn:disabled { opacity: 0.45 !important; }
#hud-content > #dt-aio-panel .dt-btn-copy { padding: 4px 10px !important; min-height: 26px !important; font-size: 11px !important; }
#hud-content > #dt-aio-panel .dt-btn-block { width: 100% !important; margin-top: 11px !important; }
/* Profit Stop stays in the DOM (dt_calcValues + the Stats-tab mirror write/read
   #dt-out_profit) but is not displayed — the strategy's stop condition uses
   Balance Target, so that is the number shown and copied. */
#hud-content > #dt-aio-panel .dt-cv-row[hidden] { display: none !important; }
/* Progress (chunky tk bar, #00ff80 on dark trough) + status */
#hud-content > #dt-aio-panel .dt-progress-wrap { background: #071824 !important; border: 1px solid #2f4553 !important; height: 14px !important; border-radius: 2px !important; margin: 0 !important; }
#hud-content > #dt-aio-panel .dt-progress-bar { background: #00ff80 !important; }
#hud-content > #dt-aio-panel .dt-status-line { font-size: 11px !important; color: #c9d1d9 !important; text-align: center !important; font-family: "Segoe UI", -apple-system, sans-serif !important; opacity: 1 !important; margin: 0 !important; }
/* Scroll regions */
#hud-content > #dt-aio-panel .dt-scroll { border: 1px solid #2f4553 !important; border-radius: 3px !important; background: #071824 !important; }
#hud-content > #dt-aio-panel .dt-res-scroll { flex: 1 1 auto !important; min-height: 200px !important; max-height: none !important; }
#hud-content > #dt-aio-panel #dt-panel-results.active { flex: 1 1 auto !important; min-height: 0 !important; }
/* Simulation Results treeview (Statistic | Value) */
#hud-content > #dt-aio-panel table.dt-stats { font-size: 11.5px !important; }
#hud-content > #dt-aio-panel table.dt-stats th { position: sticky; top: 0; background: #071824 !important; color: #c9d1d9 !important; font-size: 11.5px !important; font-weight: 700 !important; padding: 6px 10px !important; border-bottom: 1px solid #2f4553 !important; text-align: left !important; text-transform: none !important; letter-spacing: 0 !important; }
#hud-content > #dt-aio-panel table.dt-stats th:last-child { text-align: center !important; }
#hud-content > #dt-aio-panel table.dt-stats td { padding: 5px 10px !important; border-bottom: 1px solid #14262f !important; font-size: 11.5px !important; color: #c9d1d9 !important; font-weight: 400 !important; }
#hud-content > #dt-aio-panel table.dt-stats td:last-child { text-align: center !important; font-family: "Segoe UI", -apple-system, sans-serif !important; }
#hud-content > #dt-aio-panel table.dt-stats td.dt-empty { text-align: center !important; color: #7d8a96 !important; padding: 14px !important; }
/* Strategy Finder Results treeview: all columns, centered, gray striping like the app */
#hud-content > #dt-aio-panel table.dt-results { font-size: 11px !important; }
#hud-content > #dt-aio-panel table.dt-results th { position: sticky; top: 0; background: #071824 !important; color: #c9d1d9 !important; font-size: 11px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; text-align: center !important; padding: 6px 8px !important; border-bottom: 1px solid #2f4553 !important; border-right: 1px solid #14262f !important; font-family: "Segoe UI", -apple-system, sans-serif !important; white-space: nowrap !important; }
#hud-content > #dt-aio-panel table.dt-results td { text-align: center !important; color: #c9d1d9 !important; padding: 5px 8px !important; border-bottom: none !important; font-family: "Segoe UI", -apple-system, sans-serif !important; white-space: nowrap !important; }
#hud-content > #dt-aio-panel table.dt-results tr:nth-child(odd) td { background: #2d2d2d !important; }
#hud-content > #dt-aio-panel table.dt-results tr:nth-child(even) td { background: #383838 !important; }
#hud-content > #dt-aio-panel table.dt-results tr.selected td { background: #1f333e !important; color: #ffffff !important; font-weight: 400 !important; box-shadow: none !important; }
/* The app has no color-coded cells or risk bars — neutralize them */
#hud-content > #dt-aio-panel td.dt-cell-good, #hud-content > #dt-aio-panel td.dt-cell-mid, #hud-content > #dt-aio-panel td.dt-cell-bad { color: #c9d1d9 !important; }
#hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-good, #hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-mid, #hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-bad { color: #ffffff !important; }
#hud-content > #dt-aio-panel .dt-riskbar { display: none !important; }
#hud-content > #dt-aio-panel #dt-res_status { display: none !important; }
/* Settings: full-width column of LabelFrames on mobile */
#hud-content > #dt-aio-panel .dt-settings-center { width: 100% !important; max-width: none !important; margin: 4px 0 0 !important; display: flex !important; flex-direction: column !important; gap: 22px !important; }
#hud-content > #dt-aio-panel .dt-set-row { display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 12px !important; padding: 8px 0 !important; }
#hud-content > #dt-aio-panel .dt-sep { height: 1px !important; background: #2f4553 !important; }
#hud-content > #dt-aio-panel .dt-set-desc { font-size: 10.5px !important; font-style: italic !important; color: #7d8a96 !important; margin: 2px 0 6px !important; line-height: 1.4 !important; }
#hud-content > #dt-aio-panel .dt-set-val { color: #7d8a96 !important; font-size: 11.5px !important; }
/* Restore native checkbox chrome inside the replica */
#hud-content > #dt-aio-panel .dt-chk { appearance: auto !important; -webkit-appearance: auto !important; width: 16px !important; height: 16px !important; margin: 0 !important; padding: 0 !important; position: static !important; opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; accent-color: #00ff80 !important; cursor: pointer; flex: 0 0 auto !important; }
#hud-content > #dt-aio-panel input.dt-num-input { width: 60px !important; min-width: 0 !important; flex: 0 0 auto !important; text-align: center !important; background: #071824 !important; color: #c9d1d9 !important; border: 1px solid #2f4553 !important; border-radius: 3px !important; }
/* Terms: the app's plain glossary text area */
#hud-content > #dt-aio-panel .dt-terms-scroll { background: #0f212e !important; border: 1px solid #2f4553 !important; border-radius: 4px !important; padding: 12px 14px !important; font-size: 11.5px !important; line-height: 1.5 !important; font-family: "Segoe UI", -apple-system, sans-serif !important; color: #c9d1d9 !important; }
#hud-content > #dt-aio-panel .dt-terms-heading { color: #c9d1d9 !important; font-size: 15px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; border-bottom: none !important; padding-bottom: 0 !important; margin: 14px 0 5px !important; }
#hud-content > #dt-aio-panel .dt-terms-heading:first-child { margin-top: 0 !important; }
#hud-content > #dt-aio-panel .dt-terms-subheading { color: #c9d1d9 !important; font-size: 12.5px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; margin: 9px 0 3px !important; }
#hud-content > #dt-aio-panel .dt-terms-label { color: #c9d1d9 !important; font-weight: 700 !important; }
#hud-content > #dt-aio-panel .dt-terms-dash { color: #7d8a96 !important; }
#hud-content > #dt-aio-panel .dt-terms-def, #hud-content > #dt-aio-panel .dt-terms-text { color: #c9d1d9 !important; }
/* Leftover modern chrome that must never surface in the replica */
#hud-content > #dt-aio-panel .dt-help, #hud-content > #dt-aio-panel .dt-hint, #hud-content > #dt-aio-panel .dt-steps, #hud-content > #dt-aio-panel .dt-coach { display: none !important; }`;
        const s = addStyle(
            '#dt-aio-button, #dt-backdrop, #dt-aio-counter { display: none !important; }' +
            '#ratchet-master-container #hud-content > #dt-aio-panel {' +
            ' position: static !important; inset: auto !important;' +
            ' top: auto !important; right: auto !important; bottom: auto !important; left: auto !important;' +
            ' width: 100% !important; height: auto !important; max-width: none !important; max-height: none !important;' +
            ' min-height: 420px !important; margin: 0 !important; transform: none !important; opacity: 1 !important;' +
            ' visibility: visible !important; pointer-events: auto !important; z-index: auto !important;' +
            ' display: flex !important; flex-direction: column; box-shadow: none !important;' +
            ' border: 1px solid rgba(255,255,255,0.08) !important; border-radius: 10px !important; }' +
            '#ratchet-master-container #hud-content > #dt-aio-panel .dt-head { display: none !important; }' +
            '#ratchet-master-container #hud-content > #dt-aio-panel .dt-tabs { flex: 0 0 auto !important; }' +
            '#ratchet-master-container #hud-content > #dt-aio-panel .dt-body { flex: 1 1 auto !important; min-height: 0 !important; overflow: auto !important; }' +
            // Skin next so it wins ties, exactly as the Stake integration does,
            // then the shared per-site theme repaints it for .nuts-theme.
            NUTS_DT_SKIN_CSS + DT_MOB_SITE_THEME_CSS
        );
        if (s) s.id = 'nuts-dt-bridge-css';
        try { dt_init(); } catch (e) { console.error('[unified-mobile] dt_init (nuts) failed:', e); }
    }
    /* ---- Cross-scope bridge: the DiceTool panel calls these when its
       "Create Strategy" / "Send To Game" buttons fire on Nuts. All amounts
       from the panel are in the active DISPLAY unit; we convert to SOL. ---- */
    window.__nuts_cond_balance_display__ = function () {
        const bal = getCurrentBalance();
        return (isFinite(bal) && bal > 0) ? solToDisplay(bal).toFixed(condCalcDp()) : '';
    };
    /** "Send To Game" / Update Strategy — the Nuts equivalent of
     *  dt_stake_updateExisting: keep the loaded condition list and only retune it
     *  for the current balance (new bet size from Balance ÷ Balance Divisor, new
     *  balance-target stop from Profit Multiplier). Win increase, loss reset and
     *  payout are left alone. Amounts arrive in the active display unit. */
    window.__nuts_cond_update__ = function (v) {
        const betDisplay = parseFloat(v.bet_size);
        const targetDisplay = parseFloat(v.balance_target);
        if (isFinite(betDisplay) && betDisplay > 0) {
            condBaseBet = Math.max(minBaseBet, displayToSol(betDisplay));
            condCurBet = condBaseBet;
            const ci = document.getElementById('h-cond-base');
            if (ci) ci.value = formatCurrencyInput(condBaseBet);
            setBet(condBaseBet);
        }
        if (isFinite(targetDisplay)) {
            // Stored in display units; the engine's balance trigger converts.
            const stop = condBlocks.find(b => b.trigger === 'balance' && b.action === 'stop');
            if (stop) stop.amount = targetDisplay.toFixed(condCalcDp());
            else condBlocks.push({ trigger: 'balance', count: 1, result: 'win', cmp: 'gte', amount: targetDisplay.toFixed(condCalcDp()), action: 'stop', value: '' });
        }
        resetCondRuntime();
        saveCondState();
        if (ACTIVE_MODE === 'cond') renderCondBlocks();
        condNotice = { text: `Updated for balance ${formatCurrency(getCurrentBalance())} — bet ${formatCurrency(condBaseBet)}`, until: Date.now() + 5000 };
        updateUI();
    };
    window.__nuts_cond_import__ = function (v) {
        const betDisplay = parseFloat(v.bet_size);
        const winInc = parseFloat(v.win_increase);
        const lossReset = Math.max(1, parseInt(v.loss_reset, 10) || 1);
        const mult = parseFloat(v.multiplier);
        const targetDisplay = parseFloat(v.balance_target);
        if (isFinite(mult)) { const pay = getNutsPayoutInput(); if (pay) typeIntoInput(pay, mult.toFixed(2)); }
        if (isFinite(betDisplay) && betDisplay > 0) {
            condBaseBet = Math.max(minBaseBet, displayToSol(betDisplay));
            condCurBet = condBaseBet;
            const ci = document.getElementById('h-cond-base');
            if (ci) ci.value = formatCurrencyInput(condBaseBet);
            setBet(condBaseBet);
        }
        // Target stored in display units; the engine's balance trigger runs it
        // through parseCurrencyInput (display → SOL) when it evaluates.
        condBlocks = [
            { trigger: 'every', count: 1, result: 'win', cmp: 'gte', amount: '', action: 'increaseBet', value: isFinite(winInc) ? winInc : 100 },
            { trigger: 'streak', count: lossReset, result: 'lose', cmp: 'gte', amount: '', action: 'resetBet', value: '' },
            { trigger: 'balance', count: 1, result: 'win', cmp: 'gte', amount: isFinite(targetDisplay) ? targetDisplay.toFixed(condCalcDp()) : '', action: 'stop', value: '' }
        ];
        resetCondRuntime();
        saveCondState();
        if (ACTIVE_MODE === 'cond') renderCondBlocks();
        // Pre-fill the strategy name with the multiplier, the same way Stake's
        // native "Create Strategy" names it `<multiplier>x` before you save.
        const nameInp = document.getElementById('h-strat-name');
        if (nameInp && isFinite(mult)) nameInp.value = mult.toFixed(2) + 'x';
        condNotice = { text: `Strategy imported: ${isFinite(mult) ? mult.toFixed(2) : '?'}x — Save or tap START`, until: Date.now() + 5000 };
        updateUI();
    };
    function condSetBet(amount) {
        if (!isFinite(amount)) return;
        condCurBet = Math.min(Math.max(amount, minBaseBet), maxBaseBet);
        if (isRapidFiring) setBet(condCurBet);
    }
    function condSwitchOverUnder() {
        // Same pause-swap-resume dance as the Switch O/U button: the swap
        // click is ignored if it lands mid click-loop. Bet and per-block
        // counters are restored after the restart so an over/under switch
        // doesn't reset the progression.
        if (condResumePending) return;
        const wasRunning = isRapidFiring;
        const savedBet = condCurBet;
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
        const pct = parseFloat(b.value);
        if (b.action === 'increaseBet') { if (isFinite(pct)) condSetBet(condCurBet * (1 + pct / 100)); }
        else if (b.action === 'decreaseBet') { if (isFinite(pct)) condSetBet(condCurBet * Math.max(0, 1 - pct / 100)); }
        /* The Wins counter means "wins since the bet last reset to base" — the
           label and tooltip both say so — so the action that returns the bet to
           base has to zero it. Without this it only ever counted up, for the
           whole session, and never reset no matter what the strategy did. */
        else if (b.action === 'resetBet') { condSetBet(condBaseBet); counter = 0; }
        else if (b.action === 'setBet') {
            const amt = parseCurrencyInput(b.value, NaN);
            if (isFinite(amt) && amt > 0) condSetBet(amt);
        }
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
                const threshold = parseCurrencyInput(b.amount, NaN);
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
        // Before any early return: the opener doubles as the condition count and
        // must stay correct while the popup (and #h-cond-list) does not exist.
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
            <input class="cond-amount" type="number" step="${currencyInputStep()}" placeholder="amount">
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
        // condStartCycle() captures the baseline the deck's "Cycle" stats scope
        // measures from, so Session|Cycle means the same thing it does on desktop.
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
            /* A new run starts the progression from scratch, so the Wins /
               L streak counters start at 0 rather than carrying the previous
               run's values into the deck. */
            counter = 0; lossStreak = 0;
            resetCondRuntime(); condStartCycle(); condCurBet = condBaseBet; setBet(condBaseBet);
        }
        if (ACTIVE_MODE === 'manual') setBet(manualBet);
        if (ACTIVE_MODE === 'smart') updateBetAmount();
        updateUI();
        // Mobile has no spacebar. Poll the play button for both Stake and
        // Shuffle — the button disables itself while a bet is in flight, so
        // the poll naturally rate-limits to the round cadence.
        if (clickInterval) { NATIVE_CLEAR_INTERVAL(clickInterval); clickInterval = null; }
        const tick = () => {
            if (!isRapidFiring) return;
            const btn = getPlayButton();
            if (btn && !btn.disabled) {
                try { btn.click(); } catch (e) {}
            }
        };
        /* Native timer on purpose: the game-speed hook divides page delays, and
           this poll must keep its own 180ms cadence. It is gated on the button
           being enabled, so a faster game already means faster betting — a
           faster POLL would only spin the CPU. */
        clickInterval = NATIVE_SET_INTERVAL(tick, RAPID_CLICK_INTERVAL_MS);
        tick();
    }

    function stopRapidFire() {
        isRapidFiring = false;
        rapidBlockedSince = 0;
        rapidFireStartedAt = 0;
        lastObservedBetTime = 0;
        if (clickInterval) { NATIVE_CLEAR_INTERVAL(clickInterval); clickInterval = null; }
        updateUI();
    }

    /* Liveness heartbeat, independent of the past-bets DOM feed.
     *
     * The stall guard below used to treat "no bet observed" as "the site has
     * frozen" — but those are different things. If the feed cannot be read (its
     * class is a build hash, and a narrow layout may not render the strip at
     * all) the tool is blind, not stalled, and killing autoplay every few
     * seconds is the wrong response: reported as "it just keeps stopping on
     * mobile", with Bets 0 / Wagered 0 while profit moved, which is exactly the
     * signature of bets happening unseen.
     *
     * A resolved bet always moves the balance, so a balance change proves the
     * run is alive. Used ONLY for liveness — never to decide win/loss, which
     * stays with the observer, because a mis-read result would make the
     * conditions engine bet the opposite of what the strategy says. */
    let lastBalanceChangeAt = 0;
    let lastHeartbeatBalance = null;
    function noteBalanceHeartbeat() {
        const bal = getCurrentBalance();
        if (!isFinite(bal) || bal <= 0) return;
        if (lastHeartbeatBalance === null) { lastHeartbeatBalance = bal; lastBalanceChangeAt = Date.now(); return; }
        if (Math.abs(bal - lastHeartbeatBalance) > 1e-12) {
            lastHeartbeatBalance = bal;
            lastBalanceChangeAt = Date.now();
        }
    }
    function monitorRapidFireHealth() {
        if (!isRapidFiring) return;
        noteBalanceHeartbeat();
        const now = Date.now();
        /* A backgrounded tab is not a stalled run. iOS throttles (and often
           suspends) timers the moment you switch apps or lock the phone, so no
           bet is observed while you are away and the stall check below would
           stop the run the instant you came back — the most common flavour of
           "it stops at random". Skip the check while hidden, and give the page a
           full stall window to produce a bet again after it returns. */
        if (document.hidden) { rapidVisibleAgainAt = 0; return; }
        if (!rapidVisibleAgainAt) rapidVisibleAgainAt = now;
        if (now - rapidVisibleAgainAt < stallStopMs()) return;
        /* Advanced IOW is a dice-page mode. On an SPA navigation to another game
           the run would otherwise keep going and the conditions engine would
           size bets for a game it was never configured against. */
        if (ACTIVE_MODE === 'cond' && !isOnDicePage()) {
            stopRapidFire();
            condNotice = { text: 'Stopped: left the dice page.', until: Date.now() + 5000 };
            return;
        }
        if (isShuffle() || isNuts()) {
            /* Stall-only safety on Shuffle AND Nuts. Both are driven by the
               click-poll, where the play button disables itself while a bet is in
               flight — so "disabled" is the NORMAL inter-bet state and cannot be
               used as a freeze indicator.
               Nuts used to fall through to the button-disabled branch below and
               get killed after RAPID_BLOCKED_STOP_MS (1.5s) by nothing worse than
               a slow round: the poll clicks PLAY, Nuts disables it, and if the
               result tile has not landed within 1.5s the run is stopped. On a
               phone over cellular that fires constantly — reported as "it just
               keeps stopping on mobile". The stall check below still catches a
               genuine freeze, because processNewBet() refreshes
               lastObservedBetTime on every observed bet. */
            const lastSeenBetTime = Math.max(lastObservedBetTime || rapidFireStartedAt, lastBalanceChangeAt);
            if (lastSeenBetTime && now - lastSeenBetTime >= stallStopMs()) {
                stopRapidFire();
                if (ACTIVE_MODE === 'cond')
                    condNotice = { text: 'Stopped: no bet seen for ' + Math.round(stallStopMs() / 1000) + 's.', until: Date.now() + 6000 };
            }
            return;
        }
        const betBtn = getPlayButton();
        if (!betBtn || betBtn.disabled) {
            if (!rapidBlockedSince) rapidBlockedSince = now;
            if (now - rapidBlockedSince >= RAPID_BLOCKED_STOP_MS) stopRapidFire();
            return;
        }
        rapidBlockedSince = 0;
        const lastSeenBetTime = Math.max(lastObservedBetTime || rapidFireStartedAt, lastBalanceChangeAt);
        if (lastSeenBetTime && now - lastSeenBetTime >= stallStopMs()) stopRapidFire();
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

    /* Keep Mult Perf honest in EVERY mode — Advanced IOW included.
       "1 in N" only means something measured against ONE payout, so the samples
       must reset when the target changes — and the comparison that colours the
       number needs the CURRENT target. Both used to live inside
       updateBetAmount(), which returns early unless ACTIVE_MODE is 'smart', the
       loop is running, AND the HUD is not being driven by Advanced IOW
       (dataset.toolsActive === '1' bails out by design, so the bet field is left
       to the strategy editor) — and getUserSetMultiplier() itself hard-returned
       2 outside Smart. Outside Smart, trackedMultiplier therefore sat at its
       initial 0 forever: the ratio accumulated across every payout the session
       had touched, and `ratio <= (trackedMultiplier || 1)` painted the value red
       however well the multiplier was actually running — reported as "multi perf
       is inaccurate on adv iow". Driven off the UI ticker now, so it is
       mode-agnostic, survives toolsActive, and works while stopped. The Advanced
       IOW stats deck reads the same figure through __iow_smart_publish__ (its
       'multPerf' row goes red whenever trackedMultiplier is 0), so it is fixed
       by the same change. */
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
        syncTrackedMultiplier();
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
            // Feed the Streak / Momentum rows the IOW tab now carries, exactly as
            // the Smart and Manual branches do. populateAdvancedStats() below
            // fills Mult Perf and the Best/Worst chips.
            const streaksEl = document.getElementById('h-streaks');
            if (streaksEl) streaksEl.innerHTML = `<span style="color:#00ff9d;">${curWinStreak}/${maxWinStreak}</span> | <span style="color:#f87171;">${curLossStreak}/${maxLossStreak}</span>`;
            const hotEl = document.getElementById('h-hot');
            if (hotEl) hotEl.textContent = `${betHistory.filter(Boolean).length}/${betHistory.length}`;
            populateAdvancedStats();
        } else if (ACTIVE_MODE === 'cond') {
            const targetEl = document.getElementById('h-target');
            if (targetEl) {
                /* Blind-feed warning. runConditionEngine() only runs from
                   processNewBet(), so if the past-bets feed cannot be read the
                   strategy never advances — the bet just sits at base while
                   money moves. That used to be silent (stats simply read 0), so
                   say it out loud instead of letting it look like it is working. */
                const blindFor = isRapidFiring && !lastObservedBetTime && rapidFireStartedAt
                    ? Date.now() - rapidFireStartedAt : 0;
                /* Warnings ONLY. This line used to restate the live bet, the base
                   bet, the block count, wins and loss streak on every tick — all
                   five of which the stats deck already shows, and the first two of
                   which now sit in the command bar. It was pure noise stacked on
                   top of the controls. Empty means nothing is wrong, and the CSS
                   collapses it, so the bar sits directly under the stats. */
                if (condNotice && Date.now() < condNotice.until) targetEl.innerHTML = condNotice.text;
                else if (blindFor > 6000) targetEl.innerHTML = '<span style="color:#f87171">No bets detected — conditions are not advancing.</span>';
                else targetEl.textContent = '';
            }
            /* Repaint the stat rows for the selected scope, exactly as the desktop
               bundle's Advanced IOW does. The ids above were already written with
               SESSION values at the top of updateUI, so this overwrite is what
               makes "Track per = Cycle" mean anything — the selector was on the
               mobile panel but nothing ever read it, so Cycle behaved like
               Session while desktop and the Stake/Shuffle deck both honoured it. */
            const sv = condStatsView();
            const setTxt = (id, text, color) => {
                const el = document.getElementById(id);
                if (!el) return;
                el.textContent = text;
                if (color) el.style.color = color;
            };
            setTxt('h-start-bal', formatCurrency(sv.startBal));
            setTxt('h-profit', formatCurrency(sv.profit),
                sv.profit > 0 ? '#00ff9d' : (sv.profit < 0 ? '#f87171' : '#fff'));
            setTxt('h-peak-bal', formatCurrency(sv.peakBal));
            setTxt('h-high-profit', formatCurrency(sv.peakProfit));
            setTxt('h-total-bets', String(sv.bets));
            setTxt('h-wagered', formatCurrency(sv.wagered));
            setTxt('h-rtp', sv.rtp.toFixed(2) + '%', sv.rtp >= 100 ? '#00ff9d' : '#f87171');
            const wlEl2 = document.getElementById('h-wl');
            if (wlEl2) wlEl2.innerHTML = `<span style="color:#00ff9d;">${sv.wins}</span> / <span style="color:#f87171;">${sv.losses}</span>`;
            /* Streak (W|L) is session-wide like the other modes, not scoped. */
            const condStreaks = document.getElementById('h-streaks');
            if (condStreaks) condStreaks.innerHTML = `<span style="color:#00ff9d;">${curWinStreak}/${maxWinStreak}</span> | <span style="color:#f87171;">${curLossStreak}/${maxLossStreak}</span>`;
            /* Progression counters: wins since the bet was last reset to base (so
               it zeroes when the loss reset fires) and the current loss streak.
               Session/cycle totals are the "W / L" row above. */
            setTxt('h-stats-ctr-w', String(counter));
            setTxt('h-stats-ctr-l', String(lossStreak), lossStreak > 0 ? '#f87171' : '#fff');
            /* Balance Target / Profit Stop mirror the calculator's outputs, so they
               follow the divisor + profit multiplier (and the live balance after an
               UPDATE). Same source the Stake/Shuffle deck reads. */
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
    // Exact DiceTool.exe column headers: labels fall back to the raw DT_RES_COLS
    // keys (BetDiv, ProfitMult, W%, ...), matching the desktop app's treeview.
    const DT_RES_COL_LABELS = {};
    const DT_RES_COLS_PRIMARY = ['BetDiv', 'ProfitMult', 'W%', 'CycleSuccess%', 'Bust%', 'Score'];
    const DT_SAFE_BUST_MAX = 10;
    let dt_safeOnly = false, dt_showAllCols = true; // all 15 DiceTool.exe columns, always (matches the app)
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
                         'opt_balance', 'opt_trials', 'easy_mult'];
            for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'])
                for (const s of ['from', 'to', 'step', 'values']) ids.push(p + '_' + s);
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

        /* ===== DiceTool.exe replica layout (mobile-adapted): the desktop app's
           side-by-side frames stack into one column; the Strategy Finder range
           grid keeps one From/To/Step/Values caption row and scrolls sideways
           if the HUD is too narrow. ===== */
        #${DT_PANEL_ID} .dt-calc-grid, #${DT_PANEL_ID} .dt-calc-right { display: flex; flex-direction: column; gap: 11px; min-width: 0; }
        #${DT_PANEL_ID} .dt-cv-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 5px 0; }
        #${DT_PANEL_ID} .dt-cv-row[hidden] { display: none !important; }
        #${DT_PANEL_ID} .dt-pm-grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 10px; align-items: center; }
        #${DT_PANEL_ID} .dt-pm-btns { display: flex; gap: 8px; margin-top: 10px; }
        #${DT_PANEL_ID} .dt-pm-btns .dt-btn { flex: 1 1 0; }
        #${DT_PANEL_ID} .dt-ctl-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
        #${DT_PANEL_ID} .dt-ctl-row .dt-btn { flex: 0 0 auto; min-width: 104px; }
        #${DT_PANEL_ID} .dt-ctl-row input.dt-in { width: 74px; flex: 0 0 auto; text-align: center; }
        #${DT_PANEL_ID} .dt-ctl-row .dt-progress-wrap { flex: 1 1 auto; margin: 0; }
        #${DT_PANEL_ID} .dt-lbl { font-size: 11.5px; font-weight: 700; color: var(--dt-fg); white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
        #${DT_PANEL_ID} .dt-btn-copy { padding: 4px 10px; min-height: 24px; font-size: 11px; }
        #${DT_PANEL_ID} .dt-opt-scalars { display: flex; align-items: center; gap: 8px 18px; flex-wrap: wrap; margin-bottom: 4px; }
        #${DT_PANEL_ID} .dt-opt-scalars .dt-in { width: 72px; padding: 6px 8px; }
        #${DT_PANEL_ID} .dt-opt-tablewrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
        #${DT_PANEL_ID} .dt-opt-table { display: grid; grid-template-columns: minmax(118px, auto) 56px 10px 56px 48px 150px; gap: 7px 5px; align-items: center; margin-top: 11px; justify-content: start; }
        #${DT_PANEL_ID} .dt-opt-table .dt-lbl { display: flex; align-items: center; white-space: normal; }
        #${DT_PANEL_ID} .dt-opt-table .dt-in { width: 100%; min-width: 0; padding: 6px 6px; font-size: 12px; text-align: center; }
        #${DT_PANEL_ID} .dt-opt-table .dt-values-in { text-align: left; }
        #${DT_PANEL_ID} .dt-opt-cap { font-size: 9px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: color-mix(in srgb, var(--dt-fg) 42%, transparent); text-align: center; padding-bottom: 1px; }
        #${DT_PANEL_ID} .dt-opt-cap.values { text-align: left; padding-left: 4px; }
        #${DT_PANEL_ID} .dt-opt-dash { text-align: center; color: color-mix(in srgb, var(--dt-fg) 38%, transparent); font-weight: 600; }
        #${DT_PANEL_ID} .dt-opt-runrow { margin-top: 11px; }
        #${DT_PANEL_ID} .dt-opt-foot, #${DT_PANEL_ID} .dt-res-foot { display: flex; justify-content: space-between; gap: 8px; }
        #${DT_PANEL_ID} .dt-res-scroll { flex: 1 1 auto; min-height: 200px; }
        #${DT_PANEL_ID} #dt-panel-results.active { flex: 1 1 auto; min-height: 0; }
        #${DT_PANEL_ID} .dt-lf-grow { flex: 1 1 auto; min-height: 0; }

        /* Easy Mode tab */
        #${DT_PANEL_ID} .dt-easy-grid { display: grid; grid-template-columns: auto 1fr; gap: 8px 10px; align-items: center; }
        #${DT_PANEL_ID} .dt-easy-cell { display: flex; align-items: center; gap: 6px; }
        /* Was 76px, sized to leave room for the old "Any" button beside it. With
           the button gone the field takes that space, which the "e.g. 2.00"
           placeholder needs to read in full. */
        #${DT_PANEL_ID} .dt-easy-cell .dt-in { width: 104px; }
        #${DT_PANEL_ID} .dt-easy-meta { display: flex; align-items: center; gap: 9px; margin-top: 9px; flex-wrap: wrap; }
        #${DT_PANEL_ID} .dt-easy-val { font-family: ui-monospace, monospace; color: var(--dt-label-fg); font-weight: 700; }
        #${DT_PANEL_ID} .dt-easy-status { font-size: 10.5px; font-style: italic; color: color-mix(in srgb, var(--dt-fg) 55%, transparent); }
        #${DT_PANEL_ID} .dt-easy-scroll { flex: 1; }

        /* Settings replica frames */
        #${DT_PANEL_ID} .dt-settings-center { width: 100%; display: flex; flex-direction: column; gap: 12px; }
        #${DT_PANEL_ID} .dt-set-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 0; }
        #${DT_PANEL_ID} .dt-sep { height: 1px; background: color-mix(in srgb, var(--dt-border) 20%, transparent); }
        #${DT_PANEL_ID} .dt-set-desc { font-size: 10.5px; font-style: italic; color: color-mix(in srgb, var(--dt-fg) 45%, transparent); margin: 2px 0 6px; line-height: 1.4; }
        #${DT_PANEL_ID} .dt-set-val { color: color-mix(in srgb, var(--dt-fg) 55%, transparent); font-size: 11.5px; }
        #${DT_PANEL_ID} .dt-chk { width: 15px; height: 15px; accent-color: var(--dt-label-fg); }
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
                  <!-- Only two tabs are exposed. "Play" (data-tab="stats") is created at
                       runtime by the site integration and inserts itself ahead of this
                       button. The Calculator / Strategy Finder / Results / Settings panels
                       are still built into .dt-body below — Build Strategy and dt_calcValues()
                       read and write their fields — they just have no tab button now. -->
                  <button class="dt-tab-btn active" data-tab="easy">Find New Strategy</button>
                </nav>
                <div class="dt-body">
                  ${dt_buildCalcPanel()}
                  ${dt_buildEasyPanel()}
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

    /* Exact DiceTool.exe layout, stacked for mobile: Calculated Values,
       Parameters (Simulation Controls under it), Simulation Results treeview
       below. Element IDs are unchanged so all existing wiring still lands. */
    function dt_buildCalcPanel() {
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

    /* ---- Tab: Strategy Finder — mirrors the desktop tool's structured inputs:
       each range row is [From] - [To] with its own Step, plus a Values field
       for individual comma-separated numbers. Range and Values merge into
       one de-duplicated list; either part may be left blank. ---- */
    function dt_buildOptPanel() {
        const scalar = (label, id, value) => `
                <span class="dt-lbl">${label}${dt_helpBtn(label)}</span>
                <input type="text" class="dt-in dt-entry" id="dt-${id}" value="${value}">`;
        const rangeRow = (label, id, frm, to, step, values) => `
              <span class="dt-lbl">${label}${dt_helpBtn(label)}</span>
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
    function dt_buildEasyPanel() {
        return `
          <section class="dt-panel active" id="dt-panel-easy">
            <div class="dt-card dt-lf">
              <div class="dt-card-title">Desired Parameters</div>
              <div class="dt-easy-grid">
                <span class="dt-lbl">Multiplier:${dt_helpBtn('Multiplier')}</span>
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
                <span class="dt-lbl">Win Chance:${dt_helpBtn('Win Chance')}</span><span class="dt-easy-val" id="dt-easy_chance">--</span>
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

    /* ---- Tab: Strategy Finder Results — exact DiceTool.exe layout: the full
       15-column treeview filling the tab, with Apply Selected to Calculator
       (left) and Save to CSV (right) underneath. The res_status element is
       kept hidden because dt_renderResults() writes to it unconditionally. ---- */
    function dt_buildResultsPanel() {
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

    /* ---- Tab: Settings — the desktop app's LabelFrame styling; keeps the
       mobile build's scope (no theme/font/counter controls up here — the
       streak counter lives in the Stats deck on mobile). ---- */
    function dt_buildSettingsPanel() {
        return `
          <section class="dt-panel" id="dt-panel-settings">
            <div class="dt-settings-center">
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
                  <span class="dt-lbl">Version</span>
                  <span class="dt-set-val">Dice &amp; Limbo Tools v5.64 (Mobile)</span>
                </div>
                <button class="dt-btn dt-btn-block" id="dt-reset_state">Reset All Saved Data</button>
              </div>
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

    /* Merge one param's From/To/Step range with its Values comma list into a
       sorted, de-duplicated list (mirrors the desktop tool's _range_values).
       Either part may be blank; a comma list typed in From still works. */
    function dt_mergedRange(id, integer = false) {
        const g = suf => { const el = $dt(id + '_' + suf); return el ? el.value.trim() : ''; };
        const frm = g('from'), to = g('to'), step = g('step'), extra = g('values');
        let vals = [];
        if (frm.includes(',')) vals = vals.concat(dt_parseRange(frm, integer));
        else if (frm) {
            let text = to ? (frm + '-' + to) : frm;
            if (to && step) text += ';step=' + step;
            vals = vals.concat(dt_parseRange(text, integer));
        }
        if (extra) vals = vals.concat(dt_parseRange(extra, integer));
        return Array.from(new Set(vals.filter(Number.isFinite))).sort((a, b) => a - b);
    }

    /* ===== EASY MODE ENGINE (port of the desktop tool's easy_tab) =====
       Pin Multiplier and/or Win Increase %; Loss Reset is enumerated up to
       the multiplier (cap 100) and Buffer % is solved so pinned values are
       matched exactly. With no Multiplier there is nothing to solve against, so
       the search returns null and the tab asks for one. */
    const DT_EASY_W_MAX = 500, DT_EASY_L_SWEEP = 10, DT_EASY_L_CAP = 100, DT_EASY_BUF_MAX = 100;
    let dt_easyRows = [], dt_easySelectedIdx = -1, dt_easySortCol = null, dt_easySortAsc = true, dt_easyTimer = null;
    const DT_EASY_COLS = [
        { key: 'm', label: 'Multiplier' },
        { key: 'w', label: 'Win Increase %' },
        { key: 'l', label: 'Loss Reset' },
        { key: 'b', label: 'Buffer %' },
        { key: 'odds', label: 'Reset Odds %' }
    ];
    function dt_easyFindCombos(m, w) {
        if (m == null && w == null) return null; // unbounded search
        const rows = [];
        const add = (mi, wi, li, bi) => {
            if (mi <= 1) return;
            const chance = 0.99 / mi;
            rows.push({ m: mi, w: wi, l: li, b: bi, chance: chance * 100, odds: Math.pow(1 - chance, li) * 100 });
        };
        const lMax = m != null ? Math.min(Math.floor(m), DT_EASY_L_CAP) : DT_EASY_L_SWEEP;
        for (let l = 1; l <= lMax; l++) {
            if (m == null) { // W pinned, no multiplier: whole-number buffer sweep
                for (let b = 0; b <= DT_EASY_BUF_MAX; b++) add((1 + w / 100) * l * (1 + b / 100), w, l, b);
            } else if (w != null) { // both pinned per L: solve the buffer
                const b = (m / ((1 + w / 100) * l) - 1) * 100;
                if (b >= -1e-9 && b <= DT_EASY_BUF_MAX + 1e-9) add(m, w, l, Math.min(Math.max(b, 0), DT_EASY_BUF_MAX));
            } else { // multiplier pinned: whole-number W sweep, solve the buffer
                for (let wi = 1; wi <= DT_EASY_W_MAX; wi++) {
                    const b = (m / ((1 + wi / 100) * l) - 1) * 100;
                    if (b >= -1e-9 && b <= DT_EASY_BUF_MAX + 1e-9) add(m, wi, l, Math.min(Math.max(b, 0), DT_EASY_BUF_MAX));
                }
            }
        }
        rows.sort((a, b) => a.m - b.m || a.l - b.l || a.w - b.w);
        rows.forEach((r, i) => { r._i = i; });
        return rows;
    }
    function dt_easyParse(id, lo, hi) {
        const el = $dt(id); const t = el ? el.value.trim() : '';
        // Empty = nothing pinned, which the caller turns into "enter a
        // Multiplier to search". A leftover "Any" from a saved state reads the
        // same way rather than as an error (dt_applyStateToUI clears it too).
        if (!t || /^(any|all)$/i.test(t)) return { ok: true, v: null };
        const v = parseFloat(t);
        if (!Number.isFinite(v) || !(v > lo && v <= hi)) return { ok: false, v: null };
        return { ok: true, v };
    }
    function dt_fmtEasyW(w) { return Math.abs(w - Math.round(w)) < 1e-9 ? String(Math.round(w)) : w.toFixed(2); }
    function dt_easyRefresh() {
        dt_easyTimer = null;
        const body = $dt('easy_body'); if (!body) return;
        const pm = dt_easyParse('easy_mult', 1, 9900);
        // Win Increase % is no longer pinnable from this tab, so the search
        // always sweeps it. Kept as a null parse result so dt_easyFindCombos'
        // three branches stay intact.
        const pw = { ok: true, v: null };
        $dt('easy_chance').textContent = (pm.ok && pm.v != null) ? (99 / pm.v).toFixed(2) + '%' : '--';
        dt_easySelectedIdx = -1;
        if (!pm.ok || !pw.ok) {
            dt_easyRows = []; body.innerHTML = ''; $dt('easy_count').textContent = '0';
            $dt('easy_status').textContent = 'Multiplier must be a number above 1.';
            return;
        }
        const rows = dt_easyFindCombos(pm.v, pw.v);
        if (rows == null) {
            dt_easyRows = []; body.innerHTML = ''; $dt('easy_count').textContent = '0';
            $dt('easy_status').textContent = 'Enter a Multiplier to search.';
            return;
        }
        dt_easyRows = rows;
        $dt('easy_count').textContent = String(rows.length);
        $dt('easy_status').textContent = rows.length ? '' : 'No combos match - loosen a filter.';
        dt_renderEasyTable();
    }
    function dt_renderEasyTable() {
        const head = $dt('easy_head'), body = $dt('easy_body');
        if (!head || !body) return;
        head.innerHTML = DT_EASY_COLS.map(c => {
            const arrow = c.key === dt_easySortCol ? (dt_easySortAsc ? ' ▲' : ' ▼') : '';
            return `<th data-col="${c.key}">${c.label}${arrow}</th>`;
        }).join('');
        let rows = dt_easyRows;
        if (dt_easySortCol) {
            rows = rows.slice().sort((a, b) => dt_easySortAsc ? a[dt_easySortCol] - b[dt_easySortCol] : b[dt_easySortCol] - a[dt_easySortCol]);
        }
        body.innerHTML = rows.map(r =>
            `<tr data-idx="${r._i}" class="${r._i === dt_easySelectedIdx ? 'selected' : ''}">` +
            `<td>${r.m.toFixed(2)}</td><td>${dt_fmtEasyW(r.w)}</td><td>${r.l}</td>` +
            `<td>${r.b.toFixed(2)}</td><td>${r.odds.toFixed(2)}</td></tr>`
        ).join('');
    }
    function dt_onEasyTableClick(e) {
        const th = e.target.closest('th');
        if (th && th.dataset.col) {
            if (dt_easySortCol === th.dataset.col) dt_easySortAsc = !dt_easySortAsc;
            else { dt_easySortCol = th.dataset.col; dt_easySortAsc = true; }
            dt_renderEasyTable();
            return;
        }
        const tr = e.target.closest('tr[data-idx]');
        if (tr) {
            $$dt('#dt-easy_body tr').forEach(r => r.classList.remove('selected'));
            tr.classList.add('selected');
            dt_easySelectedIdx = parseInt(tr.dataset.idx, 10);
        }
    }
    /** Build the selected combo into the live strategy and hand the user
     *  straight to Play. The Calculator panel still holds these fields and
     *  dt_calcValues() still derives the bet plan from them — the user just
     *  never has to visit that tab to do it. Falls back to staying put on
     *  builds where no Play tab was injected. */
    async function dt_easyBuildStrategy() {
        if (dt_easySelectedIdx < 0 || !dt_easyRows[dt_easySelectedIdx]) { dt_toast('Select a combo row first.'); return; }
        const r = dt_easyRows[dt_easySelectedIdx];
        $dt('win_inc').value = dt_fmtEasyW(r.w);
        $dt('loss_reset').value = String(r.l);
        $dt('buffer').value = r.b.toFixed(2);
        dt_calcValues();
        dt_saveState();
        // dt_calcValues() only refreshes the Calculator's own output fields —
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
            await dt_gameExport();
            await dt_sleep(150);   // let the calculator settle before its outputs are read
            await dt_gameImport();
        } catch (e) {
            console.error('[Find New Strategy] build failed:', e);
            dt_toast('Could not build the strategy in-game.');
            return;
        }
        if (document.getElementById('dt-panel-stats')) dt_switchTab('stats');
    }
    function dt_easySchedule() {
        if (dt_easyTimer) clearTimeout(dt_easyTimer);
        dt_easyTimer = setTimeout(dt_easyRefresh, 250);
    }

    function dt_getOptParams() {
        const opt = {
            starting_balance: parseFloat($dt('opt_balance').value),
            n_trials: parseInt($dt('opt_trials').value, 10),
            bet_div_range: dt_mergedRange('opt_betdiv'),
            profit_mult_range: dt_mergedRange('opt_profit'),
            w_range: dt_mergedRange('opt_w'),
            l_range: dt_mergedRange('opt_l', true),
            buffer_range: dt_mergedRange('opt_buf')
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
        dt_toast('Strategy Finder complete');
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
            $dt('res_status').textContent = 'No results yet. Run the Strategy Finder.';
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
        if (!confirm('Clear all strategy finder results?')) return;
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
    // Shuffle's strategy modal ignores a plain .click(); its controls fire on
    // pointer/mouse events, so dispatch the full sequence.
    function dt_shfPointerClick(el) {
        if (!el) return false;
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
            try { el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); } catch (e) {}
        });
        return true;
    }
    async function dt_closeStrategyPopup_shuffle() {
        await dt_sleep(400);
        const btn = document.querySelector('button[aria-label*="close" i]');
        if (btn) { dt_shfPointerClick(btn); return true; }
        return false;
    }
    // Persist the strategy (Save Strategy) then ensure the popup is closed, so
    // after a create/update the user lands back on the game ready to play.
    async function dt_saveAndCloseStrategy_shuffle() {
        await dt_sleep(400);
        let saveBtn = await dt_waitForText('button', 'Save Strategy', 4000);
        if (!saveBtn) saveBtn = Array.from(document.querySelectorAll('button')).find(b => /^save strategy$/i.test((b.textContent || '').trim()) && b.offsetParent);
        if (!saveBtn) return false; // no Save button — leave the editor open rather than risk discarding the strategy
        dt_shfPointerClick(saveBtn);
        await dt_sleep(800);
        if (document.querySelector('[class*="AdvancedDiceCondition_root"]')) await dt_closeStrategyPopup_shuffle();
        return true;
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
            let _saved = await dt_saveAndCloseStrategy_shuffle();
            if (!_saved) _saved = await dt_closeStrategyPopup_shuffle(); // existing-strategy edits apply in place; just close out
            dt_toast(_saved ? 'Strategy updated & saved — ready to play.' : 'Strategy updated — close the popup manually.');
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
            // Shuffle dropped id="betInfo"; locate the Multiplier (to set) and
            // Chance (to read) inputs by their labeled InfoBetInput containers,
            // with the old id selector kept as a fallback.
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
            dt_setNativeValue(multInput, multiplier);
            await dt_sleep(600);
            const winChance = chanceInput.value;
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
            for (let i = 0; i < 3; i++) { addBtn.click(); await dt_sleep(500); }
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
            const _saved = await dt_saveAndCloseStrategy_shuffle();
            dt_toast(_saved ? `"${multiplier}x" strategy created & saved — ready to play.` : `"${multiplier}x" strategy created — click "Save Strategy".`);
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
    // Stake's bet-amount field differs by domain: stake.com (and the .bet/.games/
    // staketr* family) use a contenteditable #text-field-container; stake.us still
    // uses the legacy <input data-testid="input-game-amount">. Mirror dt_setBet()'s
    // dual approach so the strategy import/update works on every domain.
    async function dt_setStakeBetAmount(val) {
        const targetStr = String(val);
        const container = document.getElementById('text-field-container');
        if (container) {
            container.focus(); container.click();
            await dt_sleep(60);
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
    async function dt_stake_updateExisting() {
        try {
            const v = dt_currentCalcValues();
            const betSize = v.bet_size;
            const balanceTarget = v.balance_target;
            if (!betSize || !balanceTarget || betSize === 'Invalid' || balanceTarget === 'Invalid') { dt_toast('Missing bet_size or balance_target.'); return; }
            await dt_waitFor('#text-field-container, input[data-testid="input-game-amount"]');
            await dt_setStakeBetAmount(betSize);
            await dt_sleep(200);
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
            await dt_setStakeBetAmount(bet_size);
            await dt_sleep(200);
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
            dt_toast(`"${multiplier}x" strategy created. Click "Save Strategy".`);
        } catch (err) { dt_toast('Import failed: ' + err); console.error(err); }
    }

    /* Nuts has no native Advanced strategy editor, so the panel's two game
       buttons bridge to the Advanced IOW HUD (window hooks it exports). */
    const DT_IS_NUTS = /(^|\.)nuts\.gg$/i.test(location.hostname);
    function dt_nuts_exportBalance() {
        // The calculator's Balance field is in the active display unit (SOL or
        // USD); the HUD exports a ready-to-display string for it.
        const disp = (typeof window.__nuts_cond_balance_display__ === 'function') ? window.__nuts_cond_balance_display__() : '';
        if (disp) { const el = $dt('balance'); if (el) { el.value = disp; dt_trigger(el); } }
        dt_calcValues();
    }
    /** Full-precision calculator values. dt_currentCalcValues() returns the
     *  *displayed* outputs (bet size rounded to 4dp, targets to 2dp) — fine for a
     *  2dp currency, but it mangles 8dp SOL amounts and can collapse a small bet
     *  to 0. Recompute from the raw inputs with dt_calcValues()'s own formulas. */
    function dt_nuts_preciseCalcValues() {
        const balance = parseFloat($dt('balance').value);
        const w = parseFloat($dt('win_inc').value) / 100;
        const l = parseInt($dt('loss_reset').value, 10);
        const div = parseFloat($dt('bet_div').value);
        const pm = parseFloat($dt('profit_mult').value);
        const buffer = 1 + parseFloat($dt('buffer').value) / 100;
        if (![balance, w, div, pm, buffer].every(Number.isFinite) || !Number.isFinite(l) || div === 0) return null;
        const bet = balance / div;
        const profitStop = bet * pm;
        return {
            multiplier: ((1 + w) * l) * buffer,
            bet_size: bet,
            profit_stop: profitStop,
            balance_target: balance + profitStop,
            win_increase: parseFloat($dt('win_inc').value),
            loss_reset: Math.max(1, l)
        };
    }
    function dt_nuts_importNew() {
        dt_calcValues();
        const v = dt_nuts_preciseCalcValues();
        if (!v) { dt_toast('Calculator values invalid.'); return; }
        if (typeof window.__nuts_cond_import__ === 'function') {
            window.__nuts_cond_import__(v);
            dt_toast(`"${v.multiplier.toFixed(2)}x" strategy sent to Advanced IOW — tap START.`);
        } else {
            dt_toast('Advanced IOW HUD not ready.');
        }
    }
    function dt_gameExport() {
        if (DT_IS_NUTS) return dt_nuts_exportBalance();
        if (location.hostname.includes('shuffle.')) return dt_shuffle_exportBalance();
        return dt_stake_exportBalance();
    }
    /** Nuts equivalent of dt_stake_updateExisting — retune the loaded strategy
     *  for the current balance without rebuilding it. */
    function dt_nuts_updateExisting() {
        dt_calcValues();
        const v = dt_nuts_preciseCalcValues();
        if (!v) { dt_toast('Calculator values invalid.'); return; }
        if (typeof window.__nuts_cond_update__ === 'function') {
            window.__nuts_cond_update__(v);
            dt_toast('Strategy updated for the current balance.');
        } else {
            dt_toast('Advanced IOW HUD not ready.');
        }
    }
    function dt_gameUpdate() {
        if (DT_IS_NUTS) return dt_nuts_updateExisting();
        if (location.hostname.includes('shuffle.')) return dt_shuffle_updateExisting();
        return dt_stake_updateExisting();
    }
    function dt_gameImport() {
        if (DT_IS_NUTS) return dt_nuts_importNew();
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
                     'opt_balance', 'opt_trials', 'easy_mult'];
        for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'])
            for (const s of ['from', 'to', 'step', 'values']) ids.push(p + '_' + s);
        for (const k of ids) if ($dt(k) && dt_state[k] != null) $dt(k).value = dt_state[k];
        // Anyone who used the tool before now has "Any" saved for the Multiplier.
        // Restoring that literal text would put the word straight back into the
        // box the moment the panel opened, so drop it and let the placeholder show.
        { const em = $dt('easy_mult'); if (em && /^(any|all)$/i.test(em.value.trim())) em.value = ''; }
        // Migrate legacy combined range strings ("50-100;step=5" / "25,30,40")
        // into the From/To/Step/Values fields the first time they're seen.
        for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf']) {
            if (dt_state[p] == null || dt_state[p + '_from'] != null || dt_state[p + '_values'] != null) continue;
            let text = String(dt_state[p]).trim(), step = '';
            if (text.includes(';')) {
                const parts = text.split(';', 2);
                text = parts[0].trim();
                const mSt = /step\s*=\s*(.+)/i.exec(parts[1] || '');
                if (mSt) step = mSt[1].trim();
            }
            const set = (suf, v) => { const el = $dt(p + '_' + suf); if (el) el.value = v; };
            if (text.includes(',') || !text.includes('-')) {
                set('values', text); set('from', ''); set('to', '');
            } else {
                const i = text.indexOf('-', text[0] === '-' ? 1 : 0);
                set('from', text.slice(0, i).trim()); set('to', text.slice(i + 1).trim()); set('values', '');
            }
            if (step) set('step', step);
        }
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
        ['n_trials', 'opt_balance', 'opt_trials'].forEach(id => {
            const el = $dt(id);
            if (el) el.addEventListener('input', dt_saveState);
        });
        // Strategy Finder From/To/Step/Values fields — persist on edit
        for (const p of ['opt_betdiv', 'opt_profit', 'opt_w', 'opt_l', 'opt_buf'])
            for (const s of ['from', 'to', 'step', 'values']) {
                const el = $dt(p + '_' + s);
                if (el) el.addEventListener('input', dt_saveState);
            }

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

        // Easy Mode
        { const el = $dt('easy_mult'); if (el) el.addEventListener('input', () => { dt_easySchedule(); dt_saveState(); }); }
        $dt('easy_apply').addEventListener('click', dt_easyBuildStrategy);
        document.getElementById('dt-easy_table').addEventListener('click', dt_onEasyTableClick);
        dt_easyRefresh();

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
            // Tokens with no theme variant to borrow. The three that carry a
            // visible slate tint get a host check instead, so the Stats deck's
            // chrome doesn't stay Stake-slate inside Shuffle's violet HUD. This
            // integration only ever runs on Stake/Shuffle, so a two-way check is
            // enough (Nuts uses initNutsDiceBridge). Stake branches are the
            // original values, byte for byte.
            const HUD_FG = '#f5fbff';
            const HUD_RED = '#e11d48';
            const SHUF_DECK = isShuffle();
            const HUD_LABEL = SHUF_DECK ? '#a99ede' : '#94a3b8';
            const HUD_FIELD_BG = SHUF_DECK ? '#0a0818' : '#0b0e17';
            const HUD_FIELD_BORDER = SHUF_DECK ? 'rgba(108, 71, 255, 0.28)' : '#2f4553';
            const HUD_TAB_WRAP_BG = SHUF_DECK ? '#1a1136' : '#13232d';

            /* ---- ADVANCED IOW — DiceTool.exe replica skin (Stake theme),
               mobile-adapted. Reproduces the desktop Dice Tool app in its
               Stake theme (ttk.Notebook tabs, sunken LabelFrames with Times
               New Roman italic underlined titles on 2px #c9d1d9 borders,
               #071824 clam entries/buttons, chunky #00ff80 progress bars,
               and the app's gray-striped #2d2d2d/#383838 results treeview),
               with the frames stacked single-column for phone widths.
               Appended AFTER the bridge rules so it wins ties; scoped to
               the stitched HUD panel. Stats tab (.hud-*) is untouched. */
            const DT_MOB_SKIN_CSS = `
/* Panel chrome */
#hud-content > #dt-aio-panel { background: #162a35 !important; border: 1px solid #2f4553 !important; border-radius: 8px !important; font-size: 12px !important; line-height: 1.45 !important; color: #c9d1d9 !important; font-family: "Segoe UI", -apple-system, sans-serif !important; overflow: hidden !important; }
/* Tab strip = ttk.Notebook: flat tabs, selected = select_bg #1f333e (keeps the bridge's horizontal scroll) */
#hud-content > #dt-aio-panel .dt-tabs { background: #162a35 !important; border-bottom: 1px solid #2f4553 !important; border-radius: 0 !important; padding: 5px 6px 0 !important; gap: 2px !important; }
#hud-content > #dt-aio-panel .dt-tab-btn { flex: 0 0 auto !important; padding: 8px 11px !important; font-size: 11.5px !important; font-weight: 700 !important; color: #c9d1d9 !important; background: #10202b !important; border: 1px solid #2f4553 !important; border-bottom: none !important; border-radius: 4px 4px 0 0 !important; text-transform: none !important; letter-spacing: 0 !important; box-shadow: none !important; }
#hud-content > #dt-aio-panel .dt-tab-btn.active { background: #1f333e !important; color: #ffffff !important; border-color: #3a5566 !important; box-shadow: none !important; }
#hud-content > #dt-aio-panel .dt-tab-btn .dt-tab-icon { display: none !important; }
/* Body */
#hud-content > #dt-aio-panel .dt-body { padding: 15px 8px 8px !important; background: #162a35 !important; }
#hud-content > #dt-aio-panel .dt-panel { background: transparent !important; }
#hud-content > #dt-aio-panel .dt-panel.active { gap: 15px !important; }
/* LabelFrames: sunken, 2px slate border, serif italic underlined title on the border */
#hud-content > #dt-aio-panel .dt-card { background: #162a35 !important; border: 2px solid #c9d1d9 !important; border-radius: 4px !important; padding: 14px 10px 10px !important; margin: 0 !important; box-shadow: inset 1px 1px 4px rgba(0,0,0,0.35) !important; position: relative !important; overflow: visible !important; display: block !important; }
#hud-content > #dt-aio-panel .dt-card-title { position: absolute !important; top: -10px !important; left: 10px !important; background: #162a35 !important; padding: 0 7px !important; font-family: "Times New Roman", Georgia, serif !important; font-style: italic !important; font-weight: 700 !important; text-decoration: underline !important; font-size: 13px !important; color: #c9d1d9 !important; letter-spacing: 0 !important; text-transform: none !important; white-space: nowrap !important; margin: 0 !important; }
/* Labels + entries (ttk clam) */
#hud-content > #dt-aio-panel .dt-lbl { font-size: 12px; font-weight: 700; color: #c9d1d9; }
#hud-content > #dt-aio-panel input.dt-entry, #hud-content > #dt-aio-panel select.dt-theme-select { background: #071824 !important; color: #c9d1d9 !important; border: 1px solid #2f4553 !important; border-radius: 3px !important; padding: 6px 8px !important; font-size: 12px !important; font-weight: 400 !important; font-family: "Segoe UI", -apple-system, sans-serif !important; min-width: 0 !important; min-height: 30px !important; text-align: left !important; box-shadow: inset 1px 1px 2px rgba(0,0,0,0.4) !important; -webkit-appearance: none !important; appearance: none !important; outline: none !important; }
#hud-content > #dt-aio-panel input.dt-entry:focus { border-color: #c9d1d9 !important; box-shadow: 0 0 0 1px #c9d1d9 !important; }
#hud-content > #dt-aio-panel input.dt-out-val[readonly] { opacity: 1 !important; font-weight: 400 !important; width: 100% !important; }
#hud-content > #dt-aio-panel .dt-opt-table .dt-in, #hud-content > #dt-aio-panel .dt-ctl-row input.dt-entry { text-align: center !important; }
#hud-content > #dt-aio-panel .dt-opt-table .dt-values-in { text-align: left !important; }
/* Buttons (ttk clam) */
#hud-content > #dt-aio-panel .dt-btn { background: #071824 !important; border: 1px solid #2f4553 !important; color: #c9d1d9 !important; border-radius: 3px !important; font-size: 12px !important; font-weight: 600 !important; letter-spacing: 0 !important; text-transform: none !important; padding: 6px 12px !important; min-height: 32px !important; font-family: "Segoe UI", -apple-system, sans-serif !important; box-shadow: none !important; }
#hud-content > #dt-aio-panel .dt-btn:active { background: #1f333e !important; transform: none !important; filter: none !important; }
#hud-content > #dt-aio-panel .dt-btn:disabled { opacity: 0.45 !important; }
#hud-content > #dt-aio-panel .dt-btn-copy { padding: 4px 10px !important; min-height: 26px !important; font-size: 11px !important; }
#hud-content > #dt-aio-panel .dt-btn-block { width: 100% !important; margin-top: 11px !important; }
/* Profit Stop stays in the DOM (dt_calcValues + the Stats-tab mirror write/read
   #dt-out_profit) but is not displayed — the strategy's stop condition uses
   Balance Target, so that is the number shown and copied. */
#hud-content > #dt-aio-panel .dt-cv-row[hidden] { display: none !important; }
/* Progress (chunky tk bar, #00ff80 on dark trough) + status */
#hud-content > #dt-aio-panel .dt-progress-wrap { background: #071824 !important; border: 1px solid #2f4553 !important; height: 14px !important; border-radius: 2px !important; margin: 0 !important; }
#hud-content > #dt-aio-panel .dt-progress-bar { background: #00ff80 !important; }
#hud-content > #dt-aio-panel .dt-status-line { font-size: 11px !important; color: #c9d1d9 !important; text-align: center !important; font-family: "Segoe UI", -apple-system, sans-serif !important; opacity: 1 !important; margin: 0 !important; }
/* Scroll regions */
#hud-content > #dt-aio-panel .dt-scroll { border: 1px solid #2f4553 !important; border-radius: 3px !important; background: #071824 !important; }
#hud-content > #dt-aio-panel .dt-res-scroll { flex: 1 1 auto !important; min-height: 200px !important; max-height: none !important; }
#hud-content > #dt-aio-panel #dt-panel-results.active { flex: 1 1 auto !important; min-height: 0 !important; }
/* Simulation Results treeview (Statistic | Value) */
#hud-content > #dt-aio-panel table.dt-stats { font-size: 11.5px !important; }
#hud-content > #dt-aio-panel table.dt-stats th { position: sticky; top: 0; background: #071824 !important; color: #c9d1d9 !important; font-size: 11.5px !important; font-weight: 700 !important; padding: 6px 10px !important; border-bottom: 1px solid #2f4553 !important; text-align: left !important; text-transform: none !important; letter-spacing: 0 !important; }
#hud-content > #dt-aio-panel table.dt-stats th:last-child { text-align: center !important; }
#hud-content > #dt-aio-panel table.dt-stats td { padding: 5px 10px !important; border-bottom: 1px solid #14262f !important; font-size: 11.5px !important; color: #c9d1d9 !important; font-weight: 400 !important; }
#hud-content > #dt-aio-panel table.dt-stats td:last-child { text-align: center !important; font-family: "Segoe UI", -apple-system, sans-serif !important; }
#hud-content > #dt-aio-panel table.dt-stats td.dt-empty { text-align: center !important; color: #7d8a96 !important; padding: 14px !important; }
/* Strategy Finder Results treeview: all columns, centered, gray striping like the app */
#hud-content > #dt-aio-panel table.dt-results { font-size: 11px !important; }
#hud-content > #dt-aio-panel table.dt-results th { position: sticky; top: 0; background: #071824 !important; color: #c9d1d9 !important; font-size: 11px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; text-align: center !important; padding: 6px 8px !important; border-bottom: 1px solid #2f4553 !important; border-right: 1px solid #14262f !important; font-family: "Segoe UI", -apple-system, sans-serif !important; white-space: nowrap !important; }
#hud-content > #dt-aio-panel table.dt-results td { text-align: center !important; color: #c9d1d9 !important; padding: 5px 8px !important; border-bottom: none !important; font-family: "Segoe UI", -apple-system, sans-serif !important; white-space: nowrap !important; }
#hud-content > #dt-aio-panel table.dt-results tr:nth-child(odd) td { background: #2d2d2d !important; }
#hud-content > #dt-aio-panel table.dt-results tr:nth-child(even) td { background: #383838 !important; }
#hud-content > #dt-aio-panel table.dt-results tr.selected td { background: #1f333e !important; color: #ffffff !important; font-weight: 400 !important; box-shadow: none !important; }
/* The app has no color-coded cells or risk bars — neutralize them */
#hud-content > #dt-aio-panel td.dt-cell-good, #hud-content > #dt-aio-panel td.dt-cell-mid, #hud-content > #dt-aio-panel td.dt-cell-bad { color: #c9d1d9 !important; }
#hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-good, #hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-mid, #hud-content > #dt-aio-panel table.dt-results tr.selected td.dt-cell-bad { color: #ffffff !important; }
#hud-content > #dt-aio-panel .dt-riskbar { display: none !important; }
#hud-content > #dt-aio-panel #dt-res_status { display: none !important; }
/* Settings: full-width column of LabelFrames on mobile */
#hud-content > #dt-aio-panel .dt-settings-center { width: 100% !important; max-width: none !important; margin: 4px 0 0 !important; display: flex !important; flex-direction: column !important; gap: 22px !important; }
#hud-content > #dt-aio-panel .dt-set-row { display: flex !important; justify-content: space-between !important; align-items: center !important; gap: 12px !important; padding: 8px 0 !important; }
#hud-content > #dt-aio-panel .dt-sep { height: 1px !important; background: #2f4553 !important; }
#hud-content > #dt-aio-panel .dt-set-desc { font-size: 10.5px !important; font-style: italic !important; color: #7d8a96 !important; margin: 2px 0 6px !important; line-height: 1.4 !important; }
#hud-content > #dt-aio-panel .dt-set-val { color: #7d8a96 !important; font-size: 11.5px !important; }
/* Restore native checkbox chrome inside the replica */
#hud-content > #dt-aio-panel .dt-chk { appearance: auto !important; -webkit-appearance: auto !important; width: 16px !important; height: 16px !important; margin: 0 !important; padding: 0 !important; position: static !important; opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; accent-color: #00ff80 !important; cursor: pointer; flex: 0 0 auto !important; }
#hud-content > #dt-aio-panel input.dt-num-input { width: 60px !important; min-width: 0 !important; flex: 0 0 auto !important; text-align: center !important; background: #071824 !important; color: #c9d1d9 !important; border: 1px solid #2f4553 !important; border-radius: 3px !important; }
/* Terms: the app's plain glossary text area */
#hud-content > #dt-aio-panel .dt-terms-scroll { background: #0f212e !important; border: 1px solid #2f4553 !important; border-radius: 4px !important; padding: 12px 14px !important; font-size: 11.5px !important; line-height: 1.5 !important; font-family: "Segoe UI", -apple-system, sans-serif !important; color: #c9d1d9 !important; }
#hud-content > #dt-aio-panel .dt-terms-heading { color: #c9d1d9 !important; font-size: 15px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; border-bottom: none !important; padding-bottom: 0 !important; margin: 14px 0 5px !important; }
#hud-content > #dt-aio-panel .dt-terms-heading:first-child { margin-top: 0 !important; }
#hud-content > #dt-aio-panel .dt-terms-subheading { color: #c9d1d9 !important; font-size: 12.5px !important; font-weight: 700 !important; letter-spacing: 0 !important; text-transform: none !important; margin: 9px 0 3px !important; }
#hud-content > #dt-aio-panel .dt-terms-label { color: #c9d1d9 !important; font-weight: 700 !important; }
#hud-content > #dt-aio-panel .dt-terms-dash { color: #7d8a96 !important; }
#hud-content > #dt-aio-panel .dt-terms-def, #hud-content > #dt-aio-panel .dt-terms-text { color: #c9d1d9 !important; }
/* Leftover modern chrome that must never surface in the replica */
#hud-content > #dt-aio-panel .dt-help, #hud-content > #dt-aio-panel .dt-hint, #hud-content > #dt-aio-panel .dt-steps, #hud-content > #dt-aio-panel .dt-coach { display: none !important; }
`;

            // Mobile bridge CSS — re-skins every .dt-* element so the Dice Tool's
            // Calculator / Optimizer / Results / Settings / Terms tabs match the
            // Manual / IOW / Smart HUD aesthetic (navy + neon green + uppercase
            // sans + monospace values). The Stats tab uses .hud-* classes
            // directly, so it inherits the HUD CSS already loaded above.
            // The DiceTool.exe replica skin above is appended after these rules
            // and wins ties, turning the panel into the desktop app's look.
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
            ].join('\n') + DT_MOB_SKIN_CSS + DT_MOB_SITE_THEME_CSS;
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
            statsBtn.innerHTML = 'Play';
            // Sit ahead of Find New Strategy so Play is the first tab in the strip.
            const firstBtn = tabsNav.querySelector('[data-tab="easy"]');
            if (firstBtn) tabsNav.insertBefore(statsBtn, firstBtn);
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

            const termsBtn = document.createElement('button');
            termsBtn.className = 'dt-tab-btn';
            termsBtn.dataset.tab = 'terms';
            termsBtn.innerHTML = 'Terms';
            tabsNav.appendChild(termsBtn);

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
                'Stop – Terminates the search currently running.\n' +
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
    function isOnBlackjackPage() { return false; }
    function isOnMolesPage() { return false; }
    function isOnAnyCasinoPage() { return false; }
    function tool_keno() {}
    function tool_mines() {}
    function tool_blackjack() {}
    function tool_moles() {}
    function tool_autovault() {}
    function tool_stake_7day_tracker() {}

})();
