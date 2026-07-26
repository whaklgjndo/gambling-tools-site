// ==UserScript==
// @name         Stake Wager Tracker — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.31
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
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cStake Wager Tracker — Desktop — standalone build v3.31', 'color:#17c7b8;font-weight:800;font-size:13px');

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
                btn.addEventListener('click', () => quickToggleClick(tool));
                document.body.appendChild(btn);
            }
            // Stack above the ⚙ control panel button (bottom: 16px, ~38px tall).
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

/* === source: stake-7day-tracker (desktop) v2.21.0 — embedded as a bundle tool === */
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

    var VERSION   = '2.24.2';                       // bump on every change; surfaced in the HUD (data-ver) so the running build is verifiable
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
        ui: { open: true, left: null, top: null, graphOpen: false, graphSpan: 604800000, graphLive: true },
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
            ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(hxi + 0.5, pTop); ctx.lineTo(hxi + 0.5, pBot); ctx.stroke(); ctx.setLineDash([]);
            gShowTipBar(T(hxi), span / plotW, colW[hxi] || 0);
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

    /* ---------------- CODE CLAIM TRACKER ----------------
       Stake caps bonus-drop code claims at CODES_LIMIT per FIXED daily window
       that resets at CODES_RESET_HOUR — the site's own claim dialog states
       "Claim up to 10 bonus drops daily, your claims reset at 7:00 PM each day".
       The whole allowance returns at once on that boundary.

       This was previously modelled as a ROLLING 24h window where each claim
       freed its own slot 24h after it was made. That under-reports what is
       actually available: claim 10 drops at 18:55 and the real site gives all
       10 back five minutes later at 19:00, while the rolling model showed 0
       left for another 24 hours.

       Counting is authoritative: fetchCodeClaims() polls Stake's transaction
       ledger (bonusDrop, SC rows, in the current window) so claims from every
       method and device are reflected; in-browser claim mutations and the
       ledger response seen passively update the HUD instantly between polls. The −/+
       buttons in the HUD correct over/under-counts. Stored per account. */
    var CODES_KEY = 'stk7w:codes:v2';     // v2: claim timestamps (v1 stored a bare count)
    var CODES_LIMIT = 10;
    /* Local time. The dialog says "7:00 PM" with no timezone qualifier, which is
       how a site renders a boundary it has already converted for the viewer — so
       the reset is treated as 19:00 in the browser's own zone. If Stake turns out
       to mean a fixed zone (e.g. 7 PM ET for everyone), this one constant is the
       only thing that needs to change. */
    var CODES_RESET_HOUR = 19;
    var codesLastSeen = 0;
    var codesLastClaimAt = 0;
    /* Epoch ms of the most recent reset boundary: today's if it has already
       passed, otherwise yesterday's. Everything claimed before this is spent
       history and no longer counts against the cap. */
    function codesWindowStart() {
        var d = new Date();
        d.setHours(CODES_RESET_HOUR, 0, 0, 0);
        if (d.getTime() > Date.now()) d.setDate(d.getDate() - 1);
        return d.getTime();
    }
    /* Epoch ms of the next reset boundary. Built by setting the wall-clock hour
       and then stepping the date, so a DST shift keeps it at 19:00 local rather
       than drifting an hour (which adding 24h to the window start would do). */
    function codesNextResetAt() {
        var d = new Date();
        d.setHours(CODES_RESET_HOUR, 0, 0, 0);
        if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
        return d.getTime();
    }
    function codesFmtLeft(ms) {
        if (ms <= 0) return '0s';
        if (ms < 3600000) { var m0 = Math.floor(ms / 60000), s0 = Math.floor((ms % 60000) / 1000); return m0 + 'm ' + (s0 < 10 ? '0' : '') + s0 + 's'; }
        return formatDur(ms);
    }
    function codesLoadAll() { try { var v = JSON.parse(localStorage.getItem(CODES_KEY) || '{}'); return (v && typeof v === 'object') ? v : {}; } catch (e) { return {}; } }
    function codesSaveAll(all) { try { localStorage.setItem(CODES_KEY, JSON.stringify(all)); } catch (e) {} }
    // Per-account record { claims: [epochMs,...] }: timestamps of drop-code claims,
    // pruned to the current daily window on every read, so crossing the reset
    // boundary drops the count to 0 with no reset event to schedule.
    function codesRec() {
        var id = S.active || 'default';
        var all = codesLoadAll(), r = all[id];
        if (!r || !Array.isArray(r.claims)) r = { claims: [] };
        all[id] = r;
        var cutoff = codesWindowStart(), before = r.claims.length;
        r.claims = r.claims.filter(function (t) { return typeof t === 'number' && t > cutoff; }).sort(function (a, b) { return a - b; });
        if (r.claims.length !== before) codesSaveAll(all);
        return { all: all, rec: r };
    }
    function codesCount() { return codesRec().rec.claims.length; }
    // Record an in-browser drop claim: +N appends N claim timestamps at now — the
    // instant fast-path when a claim mutation is seen; the ledger poll then reconciles.
    function codesBump(d) {
        var c = codesRec();
        if (d > 0) { for (var i = 0; i < d; i++) c.rec.claims.push(Date.now()); }
        else if (d < 0) { for (var j = 0; j < -d && c.rec.claims.length; j++) c.rec.claims.pop(); }
        c.rec.claims.sort(function (a, b) { return a - b; });
        codesSaveAll(c.all);
        scheduleRender();
    }
    // ms until the whole allowance comes back (the next reset boundary).
    function codesResetMs() {
        return Math.max(0, codesNextResetAt() - Date.now());
    }
    // Replace stored claim timestamps with the authoritative set from Stake's ledger.
    // The ledger reflects every method + device, so it is the source of truth. A local
    // claim made <15s ago (not yet committed to the ledger) is preserved to avoid a brief
    // flicker; the list is pruned to the current window and capped at CODES_LIMIT.
    function codesSetAuthoritative(tsList) {
        if (!Array.isArray(tsList)) return;
        var c = codesRec();
        var merged = tsList.slice();
        if (Date.now() - codesLastClaimAt < 15000) {
            c.rec.claims.forEach(function (t) {
                if (Date.now() - t < 15000 && !merged.some(function (m) { return Math.abs(m - t) < 4000; })) merged.push(t);
            });
        }
        var cutoff = codesWindowStart();
        merged = merged.filter(function (t) { return t > cutoff; }).sort(function (a, b) { return a - b; });
        if (merged.length > CODES_LIMIT) merged = merged.slice(merged.length - CODES_LIMIT);
        c.rec.claims = merged;
        codesSaveAll(c.all);
        scheduleRender();
        note('codes authoritative -> ' + merged.length);
    }

    // Extract in-window drop-claim timestamps (epoch ms) from a Transaction-query
    // response. A claim = a bonusDrop row with currency "sweeps" (each drop = 1 SC + 1
    // gold row at the same createdAt; the SC row is the claim). Gold rows and all other
    // transaction types are ignored. Returns null when the response isn't a tx list.
    function codesExtractDropClaims(root) {
        try {
            var tx = root && root.user && root.user.transaction;
            if (!Array.isArray(tx)) return null;
            var cutoff = codesWindowStart(), out = [];
            for (var i = 0; i < tx.length; i++) {
                var t = tx[i];
                if (t && t.type === 'bonusDrop' && t.currency === 'sweeps') {
                    var at = Date.parse(t.createdAt);
                    if (isFinite(at) && at > cutoff) out.push(at);
                }
            }
            return out;
        } catch (e) { return null; }
    }

    // Poll the authoritative ledger: Stake's Transaction query filtered to bonusDrop,
    // authenticated exactly like the tracker's other queries (session-cookie access
    // token). limit 50 covers a daily window many times over (cap is CODES_LIMIT).
    // This is what makes the count reflect claims from ANY method and ANY device within
    // one poll. Social-only: the drop/sweeps code system is stake.us; nothing to poll on stake.com.
    var CODES_QUERY = 'query CodeClaims($types:[TransactionTypeEnum!],$limit:Int){user{id transaction(types:$types,limit:$limit){id type currency createdAt}}}';
    function fetchCodeClaims() {
        if (!IS_SOCIAL) return;
        try {
            fetch(location.origin + '/_api/graphql', {
                method: 'POST', credentials: 'include',
                headers: { 'content-type': 'application/json', 'x-access-token': getCookie('session'), 'x-language': 'en' },
                body: JSON.stringify({ operationName: 'CodeClaims', query: CODES_QUERY, variables: { types: ['bonusDrop'], limit: 50 } })
            }).then(function (r) { return r.json(); }).then(function (j) {
                if (!j || j.errors || !j.data) return;   // not authed / blocked -> leave in-browser + passive counting in place
                var claims = codesExtractDropClaims(j.data);
                if (claims) codesSetAuthoritative(claims);
            }).catch(function () {});
        } catch (e) {}
    }

    // ALL drop-code claims count, regardless of how or where they were made. The
    // authoritative source is Stake's transaction ledger (fetchCodeClaims polls it every
    // ~45s and on tab focus), reflecting claims from every device and method. Between
    // polls, fast-path signals keep the HUD live from what THIS browser sees:
    //   (1) the ledger's own Transaction response seen passively (e.g. opening
    //       Transactions > Bonuses > Drops) -> reconcile authoritatively;
    //   (2) a successful claim mutation in this browser (claimConditionBonusCode) -> record
    //       the claim now, then a confirming poll;
    //   (3) a daily-limit error on the claim path -> poll immediately for the true state.
    // Non-limit failures never count. Unrecognized claim ops are breadcrumbed via diag().
    function codesScanClaims(data) {
        try {
            if (!data || typeof data !== 'object') return;
            var root = data.data || (data.payload && data.payload.data);    // plain GraphQL or graphql-ws frame

            // (3) daily-limit error -> the window is full; poll for the authoritative timestamps
            if (data.errors && data.errors.length) {
                for (var e = 0; e < data.errors.length; e++) {
                    var er = data.errors[e] || {};
                    var em = ((er.message || '') + ' ' + (er.errorType || '')).trim();
                    var path = (er.path || []).join('.');
                    if (/daily|24\s*h|per\s*day|reached|maximum|too many|limit/i.test(em) &&
                        (/bonus|code|claim|drop|redeem/i.test(em) || /BonusCode/i.test(path))) {
                        note('code limit signalled: ' + em.slice(0, 70)); fetchCodeClaims(); return;
                    }
                }
                return;   // other errors never count
            }
            if (!root || typeof root !== 'object') return;

            // (1) authoritative ledger response seen passively (Transaction query)
            var claims = codesExtractDropClaims(root);
            if (claims != null) { codesSetAuthoritative(claims); return; }

            // (2) successful in-browser claim mutation -> record it now, then confirm via poll
            var hit = root.claimConditionBonusCode;
            if (!hit) {
                var keys = Object.keys(root);
                for (var i = 0; i < keys.length; i++) {
                    var k = keys[i], v = root[k];
                    if (/(claim|redeem).*bonus.*code|bonus.*code.*(claim|redeem)/i.test(k) &&
                        v && typeof v === 'object' && !Array.isArray(v) && v.amount != null) { hit = v; break; }
                    else if (/claim|redeem/i.test(k) && /code|promo|coupon/i.test(k) && !Array.isArray(v)) diag('code? unmatched op "' + k + '"');
                }
            }
            if (hit && typeof hit === 'object' && hit.amount != null) {
                var now = Date.now();
                if (now - codesLastSeen < 1500) return;      // fetch + WS double-report guard for the same claim
                codesLastSeen = now; codesLastClaimAt = now;
                codesBump(1);                                // append a claim at now
                setTimeout(fetchCodeClaims, 2500);           // reconcile against the ledger once it commits
                note('code claim +' + hit.amount + ' ' + (hit.currency || ''));
            }
        } catch (e) {}
    }

    var nameSamples = 0;
    function handlePayload(text) {
        if (!text || text.length > 1500000) return;
        if (!IS_SOCIAL && text.indexOf('baseRate') >= 0) {
            try { var d0 = JSON.parse(text); var cc = d0 && d0.data && d0.data.currencyConfiguration; if (cc && cc.baseRates) applyRates(cc.baseRates); } catch (e) {}
        }
        // ---- code-claim detection (runs BEFORE the 'amount' pre-filter). Cheap
        //      substring gate: "onusCode" catches the claim mutation and its daily-limit
        //      error (field/path echoes claimConditionBonusCode); "bonusDrop" catches the
        //      authoritative Transaction ledger response (Transactions > Bonuses > Drops). ----
        if (text.length < 400000 && (text.indexOf('onusCode') >= 0 || text.indexOf('bonusDrop') >= 0)) {
            try { codesScanClaims(JSON.parse(text)); } catch (e) {}
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
        var css = ''
        // ---- main panel: a static "instrument" dashboard mounted under the balance ----
        + '#stk7w{position:fixed;z-index:850;top:58px;left:50%;transform:translateX(-50%);width:912px;max-width:calc(100vw - 18px);'
        + 'color:#e8f0f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
        + 'background:radial-gradient(135% 120% at 16% -10%,rgba(31,214,85,.07),transparent 45%),radial-gradient(120% 130% at 100% 0%,rgba(79,184,214,.06),transparent 50%),linear-gradient(180deg,#102433,#0a1620);'
        + 'border:1px solid #26404e;border-radius:18px;overflow:hidden;box-shadow:0 30px 70px -18px rgba(0,0,0,.78),0 1px 0 rgba(255,255,255,.07) inset,0 0 0 1px rgba(255,255,255,.015) inset;}'
        + '#stk7w *{box-sizing:border-box;}'
        + '#stk7w .mono{font-family:ui-monospace,SFMono-Regular,"SF Mono","JetBrains Mono",Menlo,monospace;font-variant-numeric:tabular-nums;}'
        + '@keyframes stk7wpulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.82)}}'
        + '#stk7w .hd{display:flex;align-items:center;justify-content:space-between;padding:10px 20px;border-bottom:1px solid rgba(255,255,255,.055);background:linear-gradient(180deg,rgba(255,255,255,.025),transparent);}'
        + '#stk7w .who{display:flex;align-items:center;gap:11px;font-size:11.5px;color:#9fb4c1;}'
        + '#stk7w .who b{color:#fff;font-weight:600;}'
        + '#stk7w .live{display:inline-flex;align-items:center;gap:6px;font-size:9.5px;letter-spacing:.16em;color:#1fd655;text-transform:uppercase;font-weight:600;}'
        + '#stk7w .live i{width:6px;height:6px;border-radius:50%;background:#1fd655;box-shadow:0 0 9px #1fd655;animation:stk7wpulse 1.9s infinite ease-in-out;}'
        + '#stk7w .hrt{display:flex;align-items:center;gap:14px;}'
        + '#stk7w .pin{font-size:11px;color:#ffb020;font-family:ui-monospace,Menlo,monospace;}'
        + '#stk7w .pin.ok{color:#1fd655;}#stk7w .pin b{font-weight:700;}'
        + '#stk7w .badge{font-size:9px;font-weight:700;letter-spacing:.08em;color:#1fd655;background:rgba(31,214,85,.13);border:1px solid rgba(31,214,85,.25);padding:3px 7px;border-radius:6px;cursor:default;}'
        + '#stk7w .x{cursor:pointer;color:#5f7585;font-size:18px;line-height:1;width:16px;text-align:center;user-select:none;}'
        + '#stk7w .x:hover{color:#fff;}'
        + '#stk7w .grid{display:flex;}'
        + '#stk7w .cell{padding:17px 20px;}'
        + '#stk7w .cell+.cell{border-left:1px solid rgba(255,255,255,.05);}'
        + '#stk7w .c1{width:312px;flex:none;}#stk7w .c2{width:344px;flex:none;}#stk7w .c3{flex:1;min-width:0;}'
        + '#stk7w .lbl{font-size:9px;letter-spacing:.18em;color:#65808f;text-transform:uppercase;font-weight:600;}'
        + '#stk7w .hero{margin-top:9px;display:flex;align-items:baseline;gap:6px;}'
        + '#stk7w .hnum{font-size:38px;font-weight:700;line-height:.9;letter-spacing:-1.4px;color:#fff;text-shadow:0 0 30px rgba(31,214,85,.32);}'
        + '#stk7w .hu{font-size:14px;color:#8aa0b0;font-weight:500;}'
        + '#stk7w .goalw{margin-top:18px;}'
        + '#stk7w .gbar{height:7px;border-radius:5px;background:#091520;box-shadow:inset 0 1px 3px rgba(0,0,0,.6);overflow:hidden;}'
        + '#stk7w .gbar > i{display:block;height:100%;border-radius:5px;background:linear-gradient(90deg,#00a838,#1fd655);box-shadow:0 0 11px rgba(31,214,85,.65);width:0;transition:width .3s;}'
        + '#stk7w .gmeta{display:flex;justify-content:space-between;margin-top:8px;font-size:10.5px;color:#8aa0b0;cursor:pointer;}'
        + '#stk7w .gmeta .pc{color:#1fd655;font-weight:600;}'
        + '#stk7w .gmeta .rem-ok{color:#1fd655;font-weight:600;}'
        + '#stk7w .gedit{display:none;width:100%;margin-top:8px;background:#091520;border:1px solid #2f4553;color:#fff;border-radius:6px;padding:5px 8px;font-size:11px;font-family:ui-monospace,Menlo,monospace;}'
        + '#stk7w .rtpw{margin-top:19px;padding-top:17px;border-top:1px solid rgba(255,255,255,.05);}'
        + '#stk7w .meter{display:flex;height:9px;border-radius:6px;overflow:hidden;background:#091520;box-shadow:inset 0 1px 3px rgba(0,0,0,.6);}'
        + '#stk7w .meter > i{height:100%;width:0;transition:width .3s;}'
        + '#stk7w .rtpr{margin-top:12px;}'
        + '#stk7w .rline{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:10px;}'
        + '#stk7w .rline .rk{display:flex;align-items:center;gap:7px;color:#9fb4c1;min-width:0;}'
        + '#stk7w .rline .rk i{width:7px;height:7px;border-radius:2px;flex:none;}'
        + '#stk7w .rline .rval{font-size:11px;color:#dfe9ef;font-weight:600;margin-left:10px;white-space:nowrap;}'
        + '#stk7w .ctop{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;}'
        + '#stk7w .ct{display:flex;gap:4px;align-items:center;}'
        + '#stk7w .ct button{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#9fb4c1;border-radius:6px;font-size:10px;padding:2px 7px;cursor:pointer;line-height:1.4;font-family:inherit;}'
        + '#stk7w .ct button:hover{border-color:#3a4a57;color:#fff;background:rgba(255,255,255,.07);}'
        + '#stk7w .ct .live2{font-weight:700;letter-spacing:.02em;}'
        + '#stk7w .ct .live2.on{color:#1fd655;border-color:rgba(31,214,85,.5);background:rgba(31,214,85,.1);}'
        + '#stk7w .well{background:#07121a;border:1px solid rgba(255,255,255,.045);border-radius:11px;box-shadow:inset 0 2px 10px rgba(0,0,0,.55);padding:11px 13px 7px;}'
        + '#stk7w #stk7w-gcanvas{width:100%;height:150px;display:block;cursor:crosshair;touch-action:none;}'
        + '#stk7w .egp{display:flex;justify-content:space-between;align-items:center;margin:15px 0 9px;}'
        + '#stk7w .egp:first-of-type{margin-top:0;}'
        + '#stk7w .egn{font-size:10.5px;font-weight:700;color:#d2dde4;}'
        + '#stk7w .egn span{color:#65808f;font-weight:500;font-size:9px;letter-spacing:.1em;text-transform:uppercase;margin-left:5px;}'
        + '#stk7w .egc{font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;}'
        + '#stk7w .egc.ok{background:rgba(31,214,85,.14);color:#1fd655;}'
        + '#stk7w .egc.no{background:rgba(255,91,104,.13);color:#ff6b76;}'
        + '#stk7w .egc.part{background:rgba(255,176,32,.14);color:#ffb020;}'
        + '#stk7w .et{display:flex;align-items:center;gap:10px;margin-top:8px;}'
        + '#stk7w .ep{width:9px;height:9px;border-radius:50%;flex:none;}'
        + '#stk7w .ep.ok{background:#1fd655;box-shadow:0 0 8px rgba(31,214,85,.75);}'
        + '#stk7w .ep.no{background:transparent;border:1.5px solid #ff5b68;}'
        + '#stk7w .etn{font-size:10.5px;color:#aebecb;min-width:74px;}'
        + '#stk7w .etn b{color:#e8f0f5;font-weight:600;}'
        + '#stk7w .etn .rq{color:#5f7585;font-size:9px;margin-left:3px;}'
        + '#stk7w .es{margin-left:auto;font-size:10px;text-align:right;}'
        + '#stk7w .es b{font-weight:700;}'
        + '#stk7w .es .q{color:#65808f;font-size:9px;margin-left:2px;}'
        // ---- docked nav pill (collapsed state; lives in Stake top bar, right of Wallet) ----
        + '#stk7w-dock{display:inline-flex;align-items:center;gap:9px;height:36px;align-self:center;margin-left:10px;padding:0 13px;background:#0c1c27;border:1px solid rgba(31,214,85,.5);border-radius:10px;cursor:pointer;color:#e8f0f5;font-family:-apple-system,"Segoe UI",sans-serif;font-size:12.5px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35);}'
        + '#stk7w-dock.fixed{position:fixed;z-index:850;top:10px;right:16px;}'
        + '#stk7w-dock:hover{border-color:#1fd655;background:#0f2531;}'
        + '#stk7w-dock .dl{width:7px;height:7px;border-radius:50%;background:#1fd655;box-shadow:0 0 8px #1fd655;animation:stk7wpulse 1.9s infinite ease-in-out;flex:none;}'
        + '#stk7w-dock .dlbl{color:#cddbe4;font-weight:600;}'
        + '#stk7w-dock .dsep{width:1px;height:16px;background:rgba(255,255,255,.12);}'
        + '#stk7w-dock .dval{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums;color:#fff;font-weight:600;}'
        + '#stk7w-dock .dval i{color:#8aa0b0;font-style:normal;font-size:10px;font-weight:500;margin-left:2px;}'
        + '#stk7w-dock .dcv{color:#5f7585;font-size:9px;}'
        + '#stk7w-dock.open .dcv{color:#1fd655;}'
        // ---- chart hover tooltip ----
        + '#stk7w-gtip{position:fixed;z-index:860;pointer-events:none;display:none;background:#0a1822;border:1px solid rgba(79,184,214,.4);border-radius:7px;padding:7px 10px;box-shadow:0 8px 24px rgba(0,0,0,.6);}'
        + '#stk7w-gtip .gtl{color:#65808f;font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-family:ui-monospace,Menlo,monospace;}'
        + '#stk7w-gtip .gtv{color:#fff;font-size:12.5px;font-weight:700;margin-top:2px;font-family:ui-monospace,Menlo,monospace;}'
        + '#stk7w-gtip .gtf{color:#9fd0e0;font-size:10px;margin-top:3px;font-family:ui-monospace,Menlo,monospace;}';
        var st = document.createElement('style');
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    function buildHud() {
        if (document.getElementById('stk7w')) return;
        injectStyle();

        // ---- docked nav pill (the collapsed state; sits in Stake's top bar, right of Wallet) ----
        var dock = document.createElement('div');
        dock.id = 'stk7w-dock';
        dock.innerHTML = '<span class="dl"></span><span class="dlbl">Rolling 7-Day Wager Tracker</span><span class="dsep"></span><span class="dval" id="stk7w-dval">–</span><span class="dcv">▾</span>';
        hud.dock = dock;
        hud.dval = dock.querySelector('#stk7w-dval');
        dock.addEventListener('click', function () { S.ui.open = !S.ui.open; save(); applyOpen(); });

        // ---- main panel (static instrument dashboard) ----
        var w = document.createElement('div');
        w.id = 'stk7w';
        w.setAttribute('data-ver', VERSION);
        w.innerHTML =
            '<div class="hd">'
          + '  <div class="who"><span class="live"><i></i>Live</span><b id="stk7w-acct">—</b><span id="stk7w-tixw">· — tickets</span></div>'
          + '  <div class="hrt"><span class="pin" id="stk7w-cover">—</span><span class="x" id="stk7w-sync-btn" title="cross-device sync" style="font-size:15px;">⇄</span><span class="badge" id="stk7w-cur" title="tracking ' + S.currency + '">' + S.currency + '</span><span class="x" id="stk7w-min" title="collapse">–</span></div>'
          + '</div>'
          + '<div class="grid">'
          + '  <div class="cell c1">'
          + '    <div class="lbl">Rolling 7-Day Wager</div>'
          + '    <div class="hero"><span class="hnum mono" id="stk7w-roll">–</span><span class="hu">' + S.currency + '</span></div>'
          + '    <div class="goalw">'
          + '      <div class="gbar"><i id="stk7w-fill"></i></div>'
          + '      <div class="gmeta" id="stk7w-gmeta" title="click to set a goal"><span class="mono" id="stk7w-gleft">—</span><span class="mono" id="stk7w-gright">—</span></div>'
          + '      <input class="gedit mono" id="stk7w-target" type="number" min="0" step="any" placeholder="goal (' + S.currency + ')">'
          + '    </div>'
          + '    <div class="rtpw"><div class="lbl">RTP Distribution</div>'
          + '      <div class="meter"><i id="stk7w-mhi" style="background:linear-gradient(90deg,#16b045,#1fd655)"></i><i id="stk7w-mmid" style="background:#ffb020"></i><i id="stk7w-mlow" style="background:linear-gradient(90deg,#ff5b68,#c43d48)"></i></div>'
          + '      <div class="rtpr">'
          + '        <div class="rline"><span class="rk"><i style="background:#1fd655"></i>Originals (99%&lt;)</span><span class="rval mono" id="stk7w-bhi">—</span></div>'
          + '        <div class="rline"><span class="rk"><i style="background:#ffb020"></i>Originals/Table Games (98%-99%)</span><span class="rval mono" id="stk7w-bmid">—</span></div>'
          + '        <div class="rline"><span class="rk"><i style="background:#ff5b68"></i>Slots (98% &gt;)</span><span class="rval mono" id="stk7w-blow">—</span></div>'
          + '      </div>'
          + '    </div>'
          + '  </div>'
          + '  <div class="cell c2">'
          + '    <div class="ctop"><div class="lbl">Wager Activity · 7d</div>'
          + '      <div class="ct"><button class="live2 on" id="stk7w-glive" title="snap to live">⟲ Live</button><button id="stk7w-gout" title="zoom out">−</button><button id="stk7w-gin" title="zoom in">+</button><button id="stk7w-gfit" title="fit 7 days">⛶</button></div>'
          + '    </div>'
          + '    <div class="well"><canvas id="stk7w-gcanvas"></canvas></div>'
          + '  </div>'
          + '  <div class="cell c3"><div class="lbl" style="margin-bottom:13px">Code Eligibility</div><div id="stk7w-elig"></div></div>'
          + '</div>';
        document.body.appendChild(w);
        hud.w = w;
        hud.acct = w.querySelector('#stk7w-acct');
        hud.tixw = w.querySelector('#stk7w-tixw');
        hud.cover = w.querySelector('#stk7w-cover');
        hud.cur = w.querySelector('#stk7w-cur');
        hud.roll = w.querySelector('#stk7w-roll');
        hud.fill = w.querySelector('#stk7w-fill');
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
        window.addEventListener('resize', scheduleRender);

        // ---- wager-activity chart: reuses the existing zoom/pan/hover engine ----
        hud.gwrap = w.querySelector('.well');
        hud.gcanvas = w.querySelector('#stk7w-gcanvas');
        hud.glive = w.querySelector('#stk7w-glive');
        hud.gtip = document.createElement('div'); hud.gtip.id = 'stk7w-gtip'; document.body.appendChild(hud.gtip);
        if (S.ui.graphLive == null) S.ui.graphLive = true;
        gView.end = Date.now();
        function setLiveBtn() { if (hud.glive) hud.glive.className = 'live2' + (S.ui.graphLive ? ' on' : ''); }
        function setLive(on) { S.ui.graphLive = !!on; if (on) gView.end = Date.now(); save(); setLiveBtn(); scheduleGraph(); }
        function zoomBy(factor, atX) {
            var W = hud.gcanvas.clientWidth || 300, span = gSpan(), end = gEnd(), now = Date.now();
            var cx = (atX == null) ? W / 2 : atX, tc = (end - span) + (cx / W) * span;   // time under cursor (now-right)
            var ns = Math.max(GSPAN_MIN, Math.min(GSPAN_MAX, span * factor));
            var ne = tc + ns * (1 - cx / W);                                              // keep that time under the cursor
            S.ui.graphSpan = ns;
            if (ne >= now - 500) { S.ui.graphLive = true; gView.end = now; }
            else { S.ui.graphLive = false; gView.end = ne; }
            save(); setLiveBtn(); scheduleGraph();
        }
        hud.glive.addEventListener('click', function () { setLive(true); });
        w.querySelector('#stk7w-gout').addEventListener('click', function () { zoomBy(1 / 0.7); });
        w.querySelector('#stk7w-gin').addEventListener('click', function () { zoomBy(0.7); });
        w.querySelector('#stk7w-gfit').addEventListener('click', function () { S.ui.graphSpan = GSPAN_MAX; S.ui.graphLive = true; gView.end = Date.now(); save(); setLiveBtn(); scheduleGraph(); });
        hud.gcanvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            var rect = hud.gcanvas.getBoundingClientRect();
            zoomBy(e.deltaY > 0 ? 1 / 0.85 : 0.85, e.clientX - rect.left);
        }, { passive: false });
        hud.gcanvas.addEventListener('mousedown', function (e) { gView.dragX = e.clientX; gView.dragEnd = gEnd(); e.preventDefault(); });
        window.addEventListener('mousemove', function (e) {
            if (!S.ui.open || !hud.gcanvas) return;
            var rect = hud.gcanvas.getBoundingClientRect();
            if (gView.dragX != null) {
                var W = hud.gcanvas.clientWidth || 300, span = gSpan(), now = Date.now();
                var ne = gView.dragEnd - ((e.clientX - gView.dragX) / W) * span;   // now-right: drag right pans into history
                ne = Math.max(now - WINDOW_MS + span, Math.min(now, ne));
                S.ui.graphLive = (ne >= now - 500); gView.end = ne; setLiveBtn();
            }
            var inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
            if (inside) { gView.hoverX = e.clientX - rect.left; gView.mx = e.clientX; gView.my = e.clientY; }
            else if (gView.hoverX != null) { gView.hoverX = null; gHideTip(); }
            scheduleGraph();
        });
        window.addEventListener('mouseup', function () { if (gView.dragX != null) { gView.dragX = null; save(); } });
        setLiveBtn();

        // ---- Code Eligibility ladder: a status pip + days-left / amount-needed, all six tiers visible ----
        var DROPS = [
            { name: 'Daily', tiers: [{ v: '$1', req: 4000 }, { v: '$2', req: 8000 }, { v: '$3', req: 12000 }] },
            { name: 'High Roller', tiers: [{ v: '$12.50', req: 50000 }, { v: '$25', req: 100000 }, { v: '$50', req: 200000 }] }
        ];
        hud.elig = w.querySelector('#stk7w-elig');
        // ---- code-claim counter (daily limit + reset countdown; −/+ manual correction) ----
        var cst = document.createElement('style');
        cst.textContent = '#stk7w .ecw{display:flex;align-items:center;gap:10px;margin:0 0 10px;padding:10px 12px;border:1px solid rgba(122,150,165,.3);border-radius:12px;background:rgba(9,18,24,.5)}'
            + '#stk7w .ecw .etn{flex:1;display:flex;flex-direction:column;gap:2px}'
            + '#stk7w .ecw .etn b{font-size:12px;letter-spacing:.2px}'
            + '#stk7w .ecw .rq{font-size:11px}'
            + '#stk7w .ecw .ep{width:11px;height:11px}'
            + '#stk7w-ccount{font-size:26px;font-weight:800;letter-spacing:.5px;line-height:1;font-variant-numeric:tabular-nums}';
        document.head.appendChild(cst);
        var cw = document.createElement('div'); cw.className = 'ecw';
        cw.innerHTML = '<span class="ep no" id="stk7w-cpip"></span>'
            + '<span class="etn"><b>Codes claimed</b><span class="rq" id="stk7w-creset">—</span></span>'
            + '<span class="es mono" id="stk7w-ccount">—</span>';
        hud.elig.appendChild(cw);
        hud.cpip = cw.querySelector('#stk7w-cpip');
        hud.creset = cw.querySelector('#stk7w-creset');
        hud.ccount = cw.querySelector('#stk7w-ccount');
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

        // ---- goal: click the meta line to edit inline (Enter/blur commits, blank clears) ----
        var editing = false;
        function showEdit() { editing = true; hud.target.value = getTarget() || ''; hud.gmeta.style.display = 'none'; hud.target.style.display = 'block'; hud.target.focus(); hud.target.select(); }
        function hideEdit() { if (!editing) return; editing = false; hud.target.style.display = 'none'; hud.gmeta.style.display = 'flex'; render(); }
        hud.gmeta.addEventListener('click', showEdit);
        hud.target.addEventListener('input', function () { var a = acct(true); if (a) { a.target = parseFloat(hud.target.value) || 0; a.targetAt = Date.now(); save(); } });
        hud.target.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === 'Escape') hideEdit(); });
        hud.target.addEventListener('blur', hideEdit);

        if (TRACK_CCY.length > 1) hud.cur.addEventListener('click', cycleCurrency);
        else { hud.cur.style.cursor = 'default'; }
        w.querySelector('#stk7w-min').addEventListener('click', function () { S.ui.open = false; save(); applyOpen(); });
        w.querySelector('#stk7w-sync-btn').addEventListener('click', openSyncDialog);

        if (S.ui.open == null) S.ui.open = true;
        ensureDocked();
        applyOpen();
        render();
    }

    // Keep the collapsed pill docked in Stake's top bar (right of Wallet); re-dock if the SPA re-renders.
    function ensureDocked() {
        if (!hud.dock) return;
        var bt = document.querySelector('.balance-toggle');
        if (bt && bt.parentNode) {
            if (hud.dock.previousElementSibling !== bt) { hud.dock.classList.remove('fixed'); bt.parentNode.insertBefore(hud.dock, bt.nextSibling); }
        } else if (!hud.dock.isConnected) {
            hud.dock.classList.add('fixed'); document.body.appendChild(hud.dock);   // fallback: float top-right
        }
    }

    function applyOpen() {
        if (!hud.w) return;
        ensureDocked();
        if (S.ui.open) { hud.w.style.display = ''; if (hud.dock) hud.dock.classList.add('open'); }
        else { hud.w.style.display = 'none'; if (hud.dock) hud.dock.classList.remove('open'); }
        render();
    }

    function status(msg, cls) {
        if (!hud.status) return;
        hud.status.className = 'st' + (cls ? ' ' + cls : '');
        hud.status.textContent = msg || '';
    }

    function cycleCurrency() {
        var idx = TRACK_CCY.indexOf(S.currency);
        S.currency = TRACK_CCY[(idx + 1) % TRACK_CCY.length];
        save(); render();
    }

    function renderDebug() {
        if (!hud.dbg || hud.dbg.style.display === 'none') return;
        var r = curRec();
        var a = acct();
        var lines = [];
        lines.push('currency: ' + S.currency + '   account: ' + (a ? (a.name || (S.active || '').slice(0, 8) + '…') : 'none') +
                   '  (' + Object.keys(S.accounts || {}).length + ' tracked)');
        lines.push('bets stored: ' + r.bets.length + (r.trackStart ? ('   since ' + shortDate(r.trackStart)) : ''));
        lines.push('games with edge: ' + Object.keys(S.gameEdge || {}).length +
                   (IS_SOCIAL ? '' : '   USD rates: ' + Object.keys(rates).length));
        lines.push('— recent own bets —');
        var rb = r.bets.slice(-8);
        for (var i = rb.length - 1; i >= 0; i--) {
            var be = rb[i].edge != null ? rb[i].edge : edgeForGame(rb[i].game);
            lines.push(new Date(rb[i].t).toLocaleTimeString() + '  ' + fmt(rb[i].amt) + (rb[i].rc ? ' (' + rb[i].raw + rb[i].rc + ')' : '') +
                       '  ' + (rb[i].game || '?') + '  ' + (be != null ? be + '% ' + bucketOfEdge(be) : 'edge?'));
        }
        if (S.diag && S.diag.length) {
            lines.push('— bet-owner samples —');
            for (var j = Math.max(0, S.diag.length - 5); j < S.diag.length; j++) {
                lines.push(S.diag[j].split(' ').slice(1).join(' '));
            }
        }
        hud.dbg.textContent = lines.join('\n');
    }

    // v2.17: cap the body height to the viewport so the HUD never runs off the bottom,
    // even with every section expanded — it scrolls internally instead.
    function fitBody() {
        if (!hud.bd || !hud.w || hud.w.style.display === 'none') return;
        var hd = hud.w.querySelector('.hd'), hh = hd ? hd.offsetHeight : 33;
        hud.bd.style.maxHeight = Math.max(140, window.innerHeight - hud.w.getBoundingClientRect().top - hh - 12) + 'px';
    }
    function render() {
        if (!hud.w) return;
        ensureDocked();
        var C = ' ' + S.currency;
        if (hud.cur) hud.cur.textContent = S.currency;

        var a = acct();
        hud.acct.textContent = a ? (a.name || (S.active || '').slice(0, 10) + '…') : 'detecting…';
        hud.tixw.textContent = '· ' + ((a && a.tickets != null) ? a.tickets : '—') + ' tickets';

        var info = rolling();
        var rollStr = info.ready ? fmt(info.rolling) : '–';
        hud.roll.textContent = rollStr;
        if (hud.dval) hud.dval.innerHTML = rollStr + '<i>' + S.currency + '</i>';   // live in the docked pill too

        // header: pinpoint / coverage status
        if (!a) { hud.cover.textContent = 'detecting account…'; hud.cover.className = 'pin'; }
        else if (!info.ready) { hud.cover.textContent = 'reading lifetime…'; hud.cover.className = 'pin'; }
        else if (info.realFull) { hud.cover.innerHTML = '✓ <b>calibrated</b>'; hud.cover.className = 'pin ok'; }
        else {
            var bridged = !!(a.ltAnchors && a.ltAnchors.some(function (p) { return p.seed; }));
            hud.cover.innerHTML = '◷ ' + (bridged ? 'calibrated in ' : 'full window in ') + '<b>' + formatDur(WINDOW_MS - info.realCoverMs) + '</b>';
            hud.cover.className = 'pin';
        }

        // RTP distribution: meter widths + values (sample proportions scaled to the authoritative total,
        // so the three tiers sum to the rolling figure — the API gives the total, not the split).
        var bk = rollingBuckets(), bst = bk.high + bk.mid + bk.low;
        if (bst > 0 && info.ready) {
            var roll = info.rolling || 0, vh = roll * bk.high / bst, vm = roll * bk.mid / bst, vl = roll * bk.low / bst, tot = (vh + vm + vl) || 1;
            hud.bhi.textContent = fmtShort(vh); hud.bmid.textContent = fmtShort(vm); hud.blow.textContent = fmtShort(vl);
            hud.mhi.style.width = (vh / tot * 100) + '%'; hud.mmid.style.width = (vm / tot * 100) + '%'; hud.mlow.style.width = (vl / tot * 100) + '%';
        } else {
            hud.bhi.textContent = hud.bmid.textContent = hud.blow.textContent = '—';
            hud.mhi.style.width = hud.mmid.style.width = hud.mlow.style.width = '0%';
        }

        // goal progress (inline editor handles setting / clearing)
        var tgt = getTarget();
        if (tgt > 0 && info.ready) {
            var pct = Math.max(0, Math.min(1, info.rolling / tgt)), rem = tgt - info.rolling;
            hud.fill.style.width = (pct * 100) + '%';
            if (rem <= 0) { hud.gleft.innerHTML = '<span class="rem-ok">✓ goal complete</span>'; hud.gright.textContent = fmtShort(tgt) + C; }
            else { hud.gleft.innerHTML = '<span class="pc">' + Math.round(pct * 100) + '%</span> of ' + fmtShort(tgt) + ' goal'; hud.gright.textContent = fmtShort(rem) + ' to go'; }
        } else {
            hud.fill.style.width = '0%';
            hud.gleft.textContent = 'No goal set'; hud.gright.textContent = 'click to set →';
        }

        // Code Eligibility: status pip + days-left / amount-needed, plus an (n/total) count pill per category.
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

        // code-claim counter + reset countdown (ticks with the 1s render loop)
        if (hud.ccount) {
            var ccN = codesCount(), ccReset = codesResetMs();
            hud.ccount.textContent = ccN + '/' + CODES_LIMIT;
            hud.ccount.style.color = ccN >= CODES_LIMIT ? '#ff6b76' : (ccN >= CODES_LIMIT - 2 ? '#ffb020' : '#1fd655');
            hud.cpip.className = 'ep ' + (ccN >= CODES_LIMIT ? 'no' : 'ok');
            /* The allowance returns all at once, so the countdown is to the reset
               boundary. "+1 in" was rolling-window wording and would now be a
               lie — at the boundary the user gets all CODES_LIMIT back, not one. */
            hud.creset.textContent = ccN >= CODES_LIMIT ? ('all ' + CODES_LIMIT + ' back in ' + codesFmtLeft(ccReset))
                : (ccN > 0 ? ((CODES_LIMIT - ccN) + ' left · resets in ' + codesFmtLeft(ccReset)) : (CODES_LIMIT + ' available'));
        }

        if (S.ui.open) drawGraph();
    }

    /* ---------------------------- drag panel ----------------------------- */
    function makeDraggable(panel, handle) {
        var sx, sy, ox, oy, drag = false;
        handle.addEventListener('mousedown', function (e) {
            if (e.target.classList.contains('x') || e.target.classList.contains('badge')) return;
            drag = true;
            var r = panel.getBoundingClientRect();
            sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
            e.preventDefault();
        });
        window.addEventListener('mousemove', function (e) {
            if (!drag) return;
            var nl = Math.max(0, Math.min(window.innerWidth - 60, ox + e.clientX - sx));
            var nt = Math.max(0, Math.min(window.innerHeight - 30, oy + e.clientY - sy));
            panel.style.left = nl + 'px'; panel.style.top = nt + 'px'; panel.style.right = 'auto';
        });
        window.addEventListener('mouseup', function () {
            if (!drag) return; drag = false;
            var r = panel.getBoundingClientRect();
            S.ui.left = Math.round(r.left); S.ui.top = Math.round(r.top); save();
        });
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
        fetchCodeClaims();                     // authoritative drop-code claim count (stake.us; all methods/devices)
        setInterval(fetchCodeClaims, 45 * 1000);
        document.addEventListener('visibilitychange', function () { if (!document.hidden) { fetchLifetime(); fetchRaffle(); fetchBuckets(); fetchCodeClaims(); } });
        setInterval(render, 1000);             // keep the rolling window + fall-off current
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
}



    /* ----- Stake 7-Day Wager Tracker ----- */
    register({
        id: 'stake-7day-tracker',
        name: 'Stake 7-Day Wager Tracker',
        description: 'Rolling 7-day wager total, goal tracker, RTP split & fall-off chart.',
        matches: [
            'https://stake.com/*', 'https://stake.us/*', 'https://stake.bet/*', 'https://stake.games/*',
            'https://staketr.com/*', 'https://staketr2.com/*', 'https://staketr3.com/*', 'https://staketr4.com/*',
            'https://stake.bz/*', 'https://stake.pet/*'
        ],
        runAt: 'document-start',
        defaultEnabled: true,
        group: 'Stake',
        uiSelectors: ['#stk7w', '#stk7w-dock', '#stk7w-sync', '#stk7w-gtip']
    }, tool_stake_7day_tracker);

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


    console.log('%c[Stake Wager Tracker — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
