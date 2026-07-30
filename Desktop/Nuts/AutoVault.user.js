// ==UserScript==
// @name         Nuts Auto-Vault — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.34
// @description  Standalone single-tool build, extracted from the unified bundle.
// @author       .
// @match        https://nuts.gg/*
// @match        https://*.nuts.gg/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cNuts Auto-Vault — Desktop — standalone build v3.34', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: nuts-autovault-desktop.user.js === */
    function tool_nuts_autovault() {
        'use strict';
// === Constants ===
    const UNIT = 1_000_000_000; // 1 SOL = 1,000,000,000 lamports
    const MIN_BALANCE_CHECKS = 2;
    const RATE_LIMIT_MAX = 50;
    const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
    const WS_URL_MATCH = 'nuts.tools/graphql';

    // === Config ===
    function loadConfig() {
        try {
            const saved = localStorage.getItem('nuts-autovault-config');
            if (saved) return { ...defaults(), ...JSON.parse(saved) };
        } catch (e) {}
        return defaults();
    }
    function defaults() {
        return {
            saveAmount: 0.1,
            bigWinThreshold: 5,
            bigWinMultiplier: 3,
            checkInterval: 90000,
            minDepositSol: 0.001
        };
    }
    function saveConfig() {
        localStorage.setItem('nuts-autovault-config', JSON.stringify(config));
    }

    let config = loadConfig();
    let SAVE_AMOUNT = config.saveAmount;
    let BIG_WIN_THRESHOLD = config.bigWinThreshold;
    let BIG_WIN_MULTIPLIER = config.bigWinMultiplier;
    let CHECK_INTERVAL = config.checkInterval;
    let MIN_DEPOSIT_SOL = config.minDepositSol;

    // === Activity log ===
    const activityLog = [];
    const MAX_LOG_ENTRIES = 50;
    let onLogUpdate = null;

    function logActivity(message, type = 'info') {
        const entry = { time: new Date(), message, type };
        activityLog.unshift(entry);
        if (activityLog.length > MAX_LOG_ENTRIES) activityLog.pop();
        console.log('[NutsAutoVault]', message);
        if (onLogUpdate) onLogUpdate(entry);
    }
    const log = (...args) => logActivity(args.join(' '), 'info');

    const FLAVOR = {
        profit: ['Positive difference,', 'Profit detected'],
        bigWin: ['Big win detected', 'Large profit'],
        start: ['AutoVault started', 'Monitoring active'],
        stop: ['AutoVault stopped', 'Monitoring paused'],
        rateLimit: ['Rate limited, vaulting paused', 'Limit reached, vaulting paused']
    };
    const pickFlavor = arr => arr[Math.floor(Math.random() * arr.length)];

    // === WebSocket hook — patches prototype.send so it catches sockets opened before this script ===
    let nutsSocket = null;
    let socketAuthenticated = false;
    const attachedSockets = new WeakSet();

    function onIncoming(raw) {
        try {
            const msg = JSON.parse(raw);
            // Any incoming response implies the socket is authenticated
            if (msg.type === 'connection_ack' || msg.type === 'next' || msg.type === 'data') {
                if (!socketAuthenticated) {
                    socketAuthenticated = true;
                    log('Socket authenticated with nuts.tools');
                }
            }
            if (msg.type === 'next' && msg.payload?.data) handleSubscriptionPayload(msg);
        } catch {}
    }

    function attachToSocket(ws) {
        if (!ws || attachedSockets.has(ws)) return;
        attachedSockets.add(ws);
        nutsSocket = ws;
        ws.addEventListener('message', (evt) => onIncoming(evt.data));
        ws.addEventListener('close', () => {
            if (nutsSocket === ws) { nutsSocket = null; socketAuthenticated = false; }
        });
        ws.addEventListener('error', () => {});
        log('Hooked nuts.tools socket (readyState=' + ws.readyState + ')');
    }

    try {
        const OriginalSend = WebSocket.prototype.send;
        WebSocket.prototype.send = function(data) {
            try {
                if (this && typeof this.url === 'string' && this.url.includes(WS_URL_MATCH)) {
                    attachToSocket(this);
                }
            } catch (e) {}
            return OriginalSend.apply(this, arguments);
        };
    } catch (e) {
        console.error('[NutsAutoVault] Failed to patch WebSocket.prototype.send:', e);
    }

    // Also hook the constructor so we catch fresh sockets earlier
    try {
        const OriginalWebSocket = window.WebSocket;
        function HookedWebSocket(url, protocols) {
            const ws = protocols !== undefined ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);
            try { if (String(url).includes(WS_URL_MATCH)) attachToSocket(ws); } catch {}
            return ws;
        }
        HookedWebSocket.prototype = OriginalWebSocket.prototype;
        HookedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
        HookedWebSocket.OPEN = OriginalWebSocket.OPEN;
        HookedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
        HookedWebSocket.CLOSED = OriginalWebSocket.CLOSED;
        window.WebSocket = HookedWebSocket;
    } catch (e) {}

    // === State ===
    let playBalance = null;
    let vaultBalance = null;
    let oldBalance = null;
    let lastBalance = null;
    let isInitialized = false;
    let balanceChecks = 0;
    let isProcessing = false;
    let running = false;
    let vaultInterval = null;
    let pendingMutation = null;
    let uiWidget = null;
    let vaultedThisSession = 0;

    function handleSubscriptionPayload(msg) {
        const d = msg.payload.data;
        if (!d) return;
        if ('balance' in d && d.balance && d.balance.after !== undefined) {
            playBalance = Number(d.balance.after);
            if (playBalance > 0 && oldBalance === null) oldBalance = playBalance;
            if (!isInitialized && ++balanceChecks >= MIN_BALANCE_CHECKS && playBalance > 0) {
                isInitialized = true;
                oldBalance = playBalance;
                log(`Initial balance: ${unitToSol(playBalance).toFixed(6)} SOL`);
            }
            if (uiWidget) uiWidget.render();
        }
        if ('vaultBalance' in d && d.vaultBalance && d.vaultBalance.after !== undefined) {
            vaultBalance = Number(d.vaultBalance.after);
            if (uiWidget) uiWidget.render();
        }
        if ('depositToVault' in d && pendingMutation && msg.id === pendingMutation.id) {
            pendingMutation.resolve(msg);
            pendingMutation = null;
        }
    }

    // === Deposit mutation ===
    function sendVaultDeposit(amountUnits) {
        return new Promise((resolve, reject) => {
            if (!nutsSocket || nutsSocket.readyState !== 1 || !socketAuthenticated) {
                return reject(new Error('Nuts socket not ready'));
            }
            const id = uuid();
            const payload = {
                id,
                type: 'subscribe',
                payload: {
                    query: 'mutation depositToVault($amount: Float!) {\n  depositToVault(amount: $amount)\n}',
                    operationName: 'depositToVault',
                    variables: { amount: Math.floor(amountUnits) }
                }
            };
            const timeout = setTimeout(() => {
                if (pendingMutation && pendingMutation.id === id) {
                    pendingMutation = null;
                    reject(new Error('Deposit timed out'));
                }
            }, 15000);
            pendingMutation = {
                id,
                resolve: (msg) => { clearTimeout(timeout); resolve(msg); },
                reject
            };
            try {
                nutsSocket.send(JSON.stringify(payload));
            } catch (e) {
                clearTimeout(timeout);
                pendingMutation = null;
                reject(e);
            }
        });
    }

    function uuid() {
        if (crypto?.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });
    }

    const unitToSol = u => (Number(u) || 0) / UNIT;
    const solToUnit = s => Math.floor(Number(s) * UNIT);

    function findBalanceContainer() {
        const titled = document.querySelectorAll('div[title$=" SOL"]');
        for (const el of titled) {
            if (/^[\d.,]+\s+SOL$/.test((el.getAttribute('title') || '').trim())) return el;
        }
        return null;
    }
    function detectDisplayCurrency() {
        const bal = findBalanceContainer();
        if (!bal) return 'SOL';
        if (bal.querySelector('span[title*="$"]')) return 'USD';
        return (bal.textContent || '').trim().startsWith('$') ? 'USD' : 'SOL';
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
    function formatBalanceForDisplay(units) {
        if (units === null || units === undefined) return '—';
        const sol = unitToSol(units);
        if (detectDisplayCurrency() === 'USD') {
            const rate = getSolToUsdRate();
            if (rate !== null) return `$${(sol * rate).toFixed(2)}`;
        }
        return `${sol.toFixed(6)} SOL`;
    }
    function formatSolAmountForDisplay(solAmount) {
        if (detectDisplayCurrency() === 'USD') {
            const rate = getSolToUsdRate();
            if (rate !== null) return `$${(solAmount * rate).toFixed(2)}`;
        }
        return `${solAmount.toFixed(6)} SOL`;
    }

    // === Rate limiting ===
    function loadRateLimitData() {
        try {
            const saved = sessionStorage.getItem('nuts-autovault-ratelimit');
            if (saved) {
                const data = JSON.parse(saved);
                return data.filter(ts => Date.now() - ts < RATE_LIMIT_WINDOW);
            }
        } catch {}
        return [];
    }
    function saveRateLimitData(ts) {
        sessionStorage.setItem('nuts-autovault-ratelimit', JSON.stringify(ts));
    }
    let vaultActionTimestamps = loadRateLimitData();
    function canVaultNow() {
        const now = Date.now();
        vaultActionTimestamps = vaultActionTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
        saveRateLimitData(vaultActionTimestamps);
        return vaultActionTimestamps.length < RATE_LIMIT_MAX;
    }
    function getVaultCountLastHour() {
        const now = Date.now();
        vaultActionTimestamps = vaultActionTimestamps.filter(ts => now - ts < RATE_LIMIT_WINDOW);
        return vaultActionTimestamps.length;
    }

    // === Floaty UI ===
    let currentViewMode = 'full';

    function createUI() {
        if (document.getElementById('nuts-autovault-floaty')) {
            document.getElementById('nuts-autovault-floaty').remove();
        }
        if (document.getElementById('nuts-autovault-stealth')) {
            document.getElementById('nuts-autovault-stealth').remove();
        }

        const style = document.createElement('style');
        style.id = 'nuts-autovault-styles';
        style.textContent = `
        #nuts-autovault-floaty {
            background: #1a1a2a;
            color: #d0d0e0;
            border: 1px solid #3a3a4a;
            border-radius: 10px;
            box-shadow: 0 6px 20px rgba(0,0,0,0.5);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 13px;
            min-width: 250px;
            max-width: 290px;
            user-select: none;
            position: fixed;
            top: 90px;
            right: 20px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
        }
        #nuts-autovault-floaty.hidden { display: none; }
        #nuts-autovault-floaty .nv-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: linear-gradient(135deg, #2a2a3a, #1e1e2e);
            padding: 8px 12px;
            border-radius: 10px 10px 0 0;
            border-bottom: 1px solid #3a3a4a;
            cursor: grab;
        }
        #nuts-autovault-floaty .nv-header:active { cursor: grabbing; }
        #nuts-autovault-floaty .nv-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 700;
            font-size: 12px;
            color: #bb86fc;
            letter-spacing: 0.3px;
        }
        #nuts-autovault-floaty .nv-dot {
            width: 7px; height: 7px; border-radius: 50%; background: #4a5568;
        }
        #nuts-autovault-floaty .nv-dot.running { background: #03dac6; }
        #nuts-autovault-floaty .nv-dot.socket-bad { background: #ff0266; }
        #nuts-autovault-floaty .nv-header-btns { display: flex; gap: 2px; }
        #nuts-autovault-floaty .nv-header-btn {
            background: none; border: none; color: #7a7a8a; cursor: pointer;
            padding: 4px 6px; border-radius: 4px; font-size: 14px; line-height: 1;
        }
        #nuts-autovault-floaty .nv-header-btn:hover { color: #fff; background: #3a3a4a; }
        #nuts-autovault-floaty .nv-content { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
        #nuts-autovault-floaty .nv-row {
            display: flex; align-items: center; justify-content: space-between;
        }
        #nuts-autovault-floaty .nv-label { color: #a0a0b0; font-size: 12px; }
        #nuts-autovault-floaty input[type="number"] {
            background: #0f0f1a; color: #e0e0f0; border: 1px solid #4a4a5a;
            border-radius: 4px; padding: 4px 6px; font-size: 12px; width: 72px;
            text-align: right;
        }
        #nuts-autovault-floaty input[type="number"]:focus { outline: none; border-color: #bb86fc; }
        #nuts-autovault-floaty .nv-btn-row { display: flex; gap: 6px; margin-top: 4px; }
        #nuts-autovault-floaty .nv-btn {
            flex: 1; background: #2a2a3a; color: #d0d0e0; border: 1px solid #3a3a4a;
            border-radius: 4px; padding: 6px 10px; font-size: 11px; font-weight: 600;
            cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
        }
        #nuts-autovault-floaty .nv-btn:hover:not(:disabled) { background: #3a3a4a; color: #fff; }
        #nuts-autovault-floaty .nv-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        #nuts-autovault-floaty .nv-btn.primary { background: linear-gradient(135deg, #bb86fc, #8e63c4); border-color: #bb86fc; color: #fff; }
        #nuts-autovault-floaty .nv-btn.danger { background: linear-gradient(135deg, #ff0266, #c2185b); border-color: #ff0266; color: #fff; }
        #nuts-autovault-floaty .nv-stats {
            display: flex; justify-content: space-between; gap: 6px;
            padding-top: 8px; border-top: 1px solid #3a3a4a; font-size: 11px;
        }
        #nuts-autovault-floaty .nv-stat { display: flex; flex-direction: column; gap: 2px; }
        #nuts-autovault-floaty .nv-stat-label { color: #7a7a8a; font-size: 10px; text-transform: uppercase; }
        #nuts-autovault-floaty .nv-stat-value { color: #bb86fc; font-weight: 700; }
        #nuts-autovault-floaty .nv-log-toggle {
            display: flex; align-items: center; justify-content: space-between;
            padding: 6px 12px; background: #1e1e2e; border-top: 1px solid #3a3a4a;
            cursor: pointer;
        }
        #nuts-autovault-floaty .nv-log-toggle:hover { background: #24243a; }
        #nuts-autovault-floaty .nv-log-toggle-text { font-size: 10px; color: #7a7a8a; text-transform: uppercase; }
        #nuts-autovault-floaty .nv-log-toggle-icon { font-size: 10px; color: #7a7a8a; transition: transform 0.2s; }
        #nuts-autovault-floaty .nv-log-toggle.open .nv-log-toggle-icon { transform: rotate(180deg); }
        #nuts-autovault-floaty .nv-log {
            max-height: 0; overflow: hidden; transition: max-height 0.25s ease-out; background: #0f0f1a;
        }
        #nuts-autovault-floaty .nv-log.open { max-height: 130px; }
        #nuts-autovault-floaty .nv-log-inner {
            padding: 8px; max-height: 130px; overflow-y: auto;
            font-family: 'Menlo', 'Monaco', 'Consolas', monospace; font-size: 10px; line-height: 1.4;
        }
        #nuts-autovault-floaty .nv-log-entry { padding: 2px 0; color: #7a7a8a; display: flex; gap: 6px; }
        #nuts-autovault-floaty .nv-log-entry.success,
        #nuts-autovault-floaty .nv-log-entry.profit { color: #03dac6; }
        #nuts-autovault-floaty .nv-log-entry.bigwin { color: #fbbf24; }
        #nuts-autovault-floaty .nv-log-entry.warning { color: #f59e0b; }
        #nuts-autovault-floaty .nv-log-entry.error { color: #ff0266; }
        #nuts-autovault-floaty .nv-log-time { color: #4a4a5a; flex-shrink: 0; }
        #nuts-autovault-floaty .nv-log-empty {
            color: #4a4a5a; font-style: italic; text-align: center; padding: 8px;
        }
        #nuts-autovault-floaty.mini { min-width: auto; max-width: none; border-radius: 20px; }
        #nuts-autovault-floaty.mini .nv-header { border-radius: 20px; padding: 6px 12px; border-bottom: none; }
        #nuts-autovault-floaty.mini .nv-content,
        #nuts-autovault-floaty.mini .nv-log-toggle,
        #nuts-autovault-floaty.mini .nv-log { display: none; }
        #nuts-autovault-floaty.mini .nv-title span { display: none; }
        #nuts-autovault-stealth {
            position: fixed; bottom: 10px; right: 10px; width: 9px; height: 9px;
            border-radius: 50%; background: #4a5568; cursor: pointer; z-index: 999999;
            box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        }
        #nuts-autovault-stealth.running { background: #03dac6; }
        #nuts-autovault-stealth.hidden { display: none; }
        @media (max-width: 500px) {
            #nuts-autovault-floaty { right: 10px !important; left: 10px !important; max-width: none; min-width: auto; }
        }
        `;
        document.head.appendChild(style);

        const widget = document.createElement('div');
        widget.id = 'nuts-autovault-floaty';

        const stealthDot = document.createElement('div');
        stealthDot.id = 'nuts-autovault-stealth';
        stealthDot.className = 'hidden';
        stealthDot.title = 'Nuts AutoVault (click to expand)';
        document.body.appendChild(stealthDot);

        const header = document.createElement('div');
        header.className = 'nv-header';
        header.innerHTML = `
            <div class="nv-title">
                <div class="nv-dot" id="nvStatusDot"></div>
                <span>Nuts AutoVault</span>
            </div>
            <div class="nv-header-btns">
                <button class="nv-header-btn" id="nvMinBtn" title="Minimize">−</button>
                <button class="nv-header-btn" id="nvStealthBtn" title="Stealth">○</button>
                <button class="nv-header-btn" id="nvCloseBtn" title="Close">×</button>
            </div>
        `;
        widget.appendChild(header);

        const content = document.createElement('div');
        content.className = 'nv-content';
        content.innerHTML = `
            <div class="nv-row">
                <span class="nv-label">Save % of profit</span>
                <input type="number" id="nvSavePct" min="0" max="1" step="0.01" value="${SAVE_AMOUNT}">
            </div>
            <div class="nv-row">
                <span class="nv-label">Big-win threshold (×)</span>
                <input type="number" id="nvBigWin" min="1" step="0.1" value="${BIG_WIN_THRESHOLD}">
            </div>
            <div class="nv-row">
                <span class="nv-label">Big-win multiplier</span>
                <input type="number" id="nvBigMult" min="1" step="0.1" value="${BIG_WIN_MULTIPLIER}">
            </div>
            <div class="nv-row">
                <span class="nv-label">Check interval (s)</span>
                <input type="number" id="nvCheck" min="10" step="1" value="${Math.round(CHECK_INTERVAL/1000)}">
            </div>
            <div class="nv-row">
                <span class="nv-label">Min deposit (SOL)</span>
                <input type="number" id="nvMinDep" min="0" step="0.0001" value="${MIN_DEPOSIT_SOL}">
            </div>
            <div class="nv-btn-row">
                <button class="nv-btn primary" id="nvStart">Start</button>
                <button class="nv-btn danger" id="nvStop" disabled>Stop</button>
            </div>
            <div class="nv-stats">
                <div class="nv-stat"><span class="nv-stat-label">Balance</span><span class="nv-stat-value" id="nvBal">—</span></div>
                <div class="nv-stat"><span class="nv-stat-label">Vault</span><span class="nv-stat-value" id="nvVault">—</span></div>
                <div class="nv-stat"><span class="nv-stat-label">Actions/hr</span><span class="nv-stat-value" id="nvCount">0/${RATE_LIMIT_MAX}</span></div>
            </div>
        `;
        widget.appendChild(content);

        const logToggle = document.createElement('div');
        logToggle.className = 'nv-log-toggle';
        logToggle.innerHTML = `<span class="nv-log-toggle-text">Activity</span><span class="nv-log-toggle-icon">▼</span>`;
        widget.appendChild(logToggle);

        const logPanel = document.createElement('div');
        logPanel.className = 'nv-log';
        logPanel.innerHTML = `<div class="nv-log-inner" id="nvLogInner"><div class="nv-log-empty">No activity yet...</div></div>`;
        widget.appendChild(logPanel);
        const logInner = logPanel.querySelector('#nvLogInner');

        logToggle.onclick = () => { logToggle.classList.toggle('open'); logPanel.classList.toggle('open'); };

        const fmt = (d) => [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
        onLogUpdate = (entry) => {
            const empty = logInner.querySelector('.nv-log-empty');
            if (empty) empty.remove();
            const div = document.createElement('div');
            div.className = `nv-log-entry ${entry.type}`;
            div.innerHTML = `<span class="nv-log-time">${fmt(entry.time)}</span><span></span>`;
            div.lastChild.textContent = entry.message;
            logInner.insertBefore(div, logInner.firstChild);
            while (logInner.children.length > 25) logInner.removeChild(logInner.lastChild);
        };

        const statusDot = widget.querySelector('#nvStatusDot');
        const balEl = content.querySelector('#nvBal');
        const vaultEl = content.querySelector('#nvVault');
        const countEl = content.querySelector('#nvCount');
        const startBtn = content.querySelector('#nvStart');
        const stopBtn = content.querySelector('#nvStop');
        const minBtn = widget.querySelector('#nvMinBtn');
        const stealthBtn = widget.querySelector('#nvStealthBtn');
        const closeBtn = widget.querySelector('#nvCloseBtn');

        function setViewMode(mode) {
            currentViewMode = mode;
            widget.classList.toggle('mini', mode === 'mini');
            widget.classList.toggle('hidden', mode === 'stealth');
            stealthDot.classList.toggle('hidden', mode !== 'stealth');
        }
        minBtn.onclick = (e) => {
            e.stopPropagation();
            setViewMode(currentViewMode === 'mini' ? 'full' : 'mini');
            minBtn.textContent = currentViewMode === 'mini' ? '+' : '−';
        };
        stealthBtn.onclick = (e) => { e.stopPropagation(); setViewMode('stealth'); };
        stealthDot.onclick = () => { setViewMode('full'); minBtn.textContent = '−'; };
        closeBtn.onclick = () => { widget.remove(); stealthDot.remove(); };

        // Drag
        let isDragging = false, dx = 0, dy = 0;
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.nv-header-btns')) return;
            isDragging = true;
            const rect = widget.getBoundingClientRect();
            dx = e.clientX - rect.left; dy = e.clientY - rect.top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let nl = e.clientX - dx, nt = e.clientY - dy;
            nl = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, nl));
            nt = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, nt));
            widget.style.left = nl + 'px'; widget.style.top = nt + 'px'; widget.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });

        // Parameter bindings
        content.querySelector('#nvSavePct').onchange = function() {
            let v = parseFloat(this.value);
            if (isNaN(v) || v < 0) v = 0;
            if (v > 1) v = 1;
            SAVE_AMOUNT = config.saveAmount = v;
            this.value = v; saveConfig();
        };
        content.querySelector('#nvBigWin').onchange = function() {
            let v = parseFloat(this.value);
            if (isNaN(v) || v < 1) v = 1;
            BIG_WIN_THRESHOLD = config.bigWinThreshold = v;
            this.value = v; saveConfig();
        };
        content.querySelector('#nvBigMult').onchange = function() {
            let v = parseFloat(this.value);
            if (isNaN(v) || v < 1) v = 1;
            BIG_WIN_MULTIPLIER = config.bigWinMultiplier = v;
            this.value = v; saveConfig();
        };
        content.querySelector('#nvCheck').onchange = function() {
            let v = parseInt(this.value, 10);
            if (isNaN(v) || v < 10) v = 10;
            CHECK_INTERVAL = v * 1000; config.checkInterval = CHECK_INTERVAL;
            this.value = v; saveConfig();
            if (running) { stopVault(); startVault(); }
        };
        content.querySelector('#nvMinDep').onchange = function() {
            let v = parseFloat(this.value);
            if (isNaN(v) || v < 0) v = 0;
            MIN_DEPOSIT_SOL = config.minDepositSol = v;
            this.value = v; saveConfig();
        };

        startBtn.onclick = () => { startVault(); };
        stopBtn.onclick = () => { stopVault(); };

        function render() {
            balEl.textContent = formatBalanceForDisplay(playBalance);
            vaultEl.textContent = formatBalanceForDisplay(vaultBalance);
            const c = getVaultCountLastHour();
            countEl.textContent = `${c}/${RATE_LIMIT_MAX}`;
            countEl.style.color = c >= RATE_LIMIT_MAX ? '#ff0266' : c >= RATE_LIMIT_MAX*0.8 ? '#f59e0b' : '#03dac6';
            statusDot.classList.toggle('running', running);
            statusDot.classList.toggle('socket-bad', !socketAuthenticated);
            stealthDot.classList.toggle('running', running);
            startBtn.disabled = running;
            stopBtn.disabled = !running;
        }
        setInterval(render, 3000);
        document.body.appendChild(widget);
        return { render };
    }

    // === Vault logic ===
    async function processDeposit(amountUnits, isBigWin) {
        if (amountUnits < solToUnit(MIN_DEPOSIT_SOL) || isProcessing) return;
        if (!canVaultNow()) {
            logActivity(`${pickFlavor(FLAVOR.rateLimit)} — rate limit reached`, 'warning');
            return;
        }
        if (!socketAuthenticated) {
            logActivity('Socket not authenticated — waiting', 'warning');
            return;
        }
        isProcessing = true;
        const pct = (SAVE_AMOUNT * (isBigWin ? BIG_WIN_MULTIPLIER : 1) * 100).toFixed(0);
        const flavor = pickFlavor(isBigWin ? FLAVOR.bigWin : FLAVOR.profit);
        logActivity(`${flavor} vaulting ${pct}%: ${formatSolAmountForDisplay(unitToSol(amountUnits))}`, isBigWin ? 'bigwin' : 'profit');
        try {
            const resp = await sendVaultDeposit(amountUnits);
            isProcessing = false;
            // depositToVault returns null on success; vaultBalance subscription auto-updates
            vaultedThisSession += amountUnits;
            vaultActionTimestamps.push(Date.now());
            saveRateLimitData(vaultActionTimestamps);
            oldBalance = playBalance;
            logActivity(`Secured ${formatSolAmountForDisplay(unitToSol(amountUnits))}`, 'success');
            if (uiWidget) uiWidget.render();
        } catch (e) {
            isProcessing = false;
            logActivity(`Vault error: ${e.message}`, 'error');
        }
    }

    function checkBalanceChanges() {
        if (playBalance === null || !isInitialized) return;
        if (oldBalance === null) { oldBalance = playBalance; return; }
        if (playBalance > oldBalance) {
            const profit = playBalance - oldBalance;
            const ratio = oldBalance > 0 ? playBalance / oldBalance : 1;
            const isBig = ratio >= BIG_WIN_THRESHOLD;
            const dep = Math.floor(profit * SAVE_AMOUNT * (isBig ? BIG_WIN_MULTIPLIER : 1));
            if (dep > 0) processDeposit(dep, isBig);
            oldBalance = playBalance;
        } else if (playBalance < oldBalance) {
            oldBalance = playBalance;
        }
        lastBalance = playBalance;
        if (uiWidget) uiWidget.render();
    }

    function startVault() {
        if (running) return;
        running = true;
        logActivity(pickFlavor(FLAVOR.start), 'success');
        oldBalance = playBalance;
        isProcessing = false;
        vaultedThisSession = 0;
        vaultInterval = setInterval(checkBalanceChanges, CHECK_INTERVAL);
        if (uiWidget) uiWidget.render();
    }
    function stopVault() {
        if (!running) return;
        running = false;
        if (vaultInterval) clearInterval(vaultInterval);
        vaultInterval = null;
        logActivity(pickFlavor(FLAVOR.stop), 'info');
        if (uiWidget) uiWidget.render();
    }

    // === Init ===
    function onDomReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn);
        } else {
            fn();
        }
    }

    onDomReady(() => {
        setTimeout(() => {
            if (!uiWidget) uiWidget = createUI();
        }, 2000);
    });


    }


    /* ----- Nuts Auto-Vault ----- */
    register({
        id: 'nuts-autovault',
        name: 'Nuts Auto-Vault',
        description: 'Auto-deposits a % of profits to your Nuts vault.',
        matches: [
            'https://nuts.gg/*',
            'https://*.nuts.gg/*'
        ],
        runAt: 'document-start',
        defaultEnabled: true,
        group: 'Nuts',
        uiSelectors: ['#nuts-autovault-floaty', '#nuts-autovault-stealth']
    }, tool_nuts_autovault);

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


    /* Standalone build: no IOW/dice stitching needed for this tool. */
    function setupIowDiceIntegration() {}


    console.log('%c[Nuts Auto-Vault — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
