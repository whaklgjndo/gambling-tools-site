// ==UserScript==
// @name         Shuffle Mines — Mobile
// @namespace    http://tampermonkey.net/
// @version      6.04
// @description  Standalone single-tool mobile build, extracted from the unified mobile bundle.
// @author       .
// @match        https://shuffle.com/*
// @match        https://shuffle.us/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    try { console.log('[Shuffle Mines — Mobile] standalone build v6.04'); } catch (e) {}


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
        id: 'shuffle-mines', name: 'Shuffle Mines', group: 'Shuffle',
        description: 'Auto-play with Live Stats + Projected Range.',
        matches: ['https://shuffle.com/games/originals/mines*', 'https://shuffle.us/games/originals/mines*'],
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
    function isOnKenoPage() { return false; }
    function isOnBlackjackPage() { return false; }
    function isOnMolesPage() { return false; }
    function isOnAnyCasinoPage() { return false; }
    function tool_keno() {}
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
