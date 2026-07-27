// ==UserScript==
// @name         Shuffle Auto-Vault — Mobile
// @namespace    http://tampermonkey.net/
// @version      6.03
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

    try { console.log('[Shuffle Auto-Vault — Mobile] standalone build v6.03'); } catch (e) {}


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
        id: 'shuffle-autovault', name: 'Shuffle Auto-Vault', group: 'Shuffle',
        description: 'Auto-deposits profit into the Shuffle vault.',
        matches: ['https://shuffle.com/*', 'https://shuffle.us/*'],
        defaultEnabled: false
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
    function isOnMinesPage() { return false; }
    function isOnBlackjackPage() { return false; }
    function isOnMolesPage() { return false; }
    function tool_keno() {}
    function tool_mines() {}
    function tool_blackjack() {}
    function tool_moles() {}
    function tool_stake_7day_tracker() {}
    function startShuffleObserver() {}
    function startShuffleFeedObserver() {}
    function startObserver() {}
    function dt_init() {}
    function initNutsDiceBridge() {}
    function setupIowDiceIntegration() {}
    function buildHUD() {}
    function updateUI() {}
    function startObserverWrapper() {}
    function monitorRapidFireHealth() {}
    function updateBetAmount() {}
    function stopRapidFire() {}
    function onShuffleBetResult() {}

})();
