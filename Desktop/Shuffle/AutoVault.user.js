// ==UserScript==
// @name         Shuffle Auto-Vault — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.40
// @description  Standalone single-tool build, extracted from the unified bundle.
// @author       .
// @match        https://shuffle.com/*
// @match        https://shuffle.us/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Desktop/Shuffle/AutoVault.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Desktop/Shuffle/AutoVault.user.js
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cShuffle Auto-Vault — Desktop — standalone build v3.40', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: shuffle-autovault-desktop.user.js ===
       Shuffle vault auto-depositor. Mirrors the Stake / Nuts auto-vault
       behavior: monitors balance every N seconds, detects profit since the
       last baseline, and auto-deposits a configurable % to the vault when
       the profit threshold is hit. A "big win" multiplier triggers a larger
       deposit on outsized wins.

       Deposit mechanism: GraphQL `vaultDeposit` mutation posted to the
       page's own origin (shuffle.com or shuffle.us) — the live endpoint is
       captured from Shuffle's own GraphQL traffic so a cross-origin POST
       can't trip a CORS "Load failed". Authorization is likewise
       captured live from Shuffle's own outgoing fetch calls so we always
       use a current token — same general pattern as Stake's autovault,
       just adapted to Shuffle's session-bound auth header. */
    function tool_shuffle_autovault() {
        'use strict';

        const CONFIG_KEY = 'shuffle-autovault-config';
        const SESSION_VAULTED_KEY = 'shuffle-autovault-vaulted-session';
        const DEBUG = false; // flip to true to enable verbose console logging
        const MIN_DEPOSIT = 0.01;
        const MIN_BIG_WIN_PROFIT = 10;
        const DEFAULTS = {
            saveAmount: 0.25,       // 25% of profit per deposit (Balanced preset)
            bigWinThreshold: 2,     // BALANCE MULTIPLE, as on Stake and Nuts
            bigWinMultiplier: 2,
            checkInterval: 60000,
            bigWinIsMultiple: true, // marks a config already migrated
            isRunning: false        // start paused (user clicks Start)
        };
        function loadConfig() {
            try {
                const raw = localStorage.getItem(CONFIG_KEY);
                if (raw) {
                    const c = { ...DEFAULTS, ...JSON.parse(raw) };
                    /* `bigWinThreshold` used to be a PERCENT OF BALANCE here and
                       a balance MULTIPLE on the other two panels — the same
                       number meaning two different things depending on which
                       panel you had open, and no preset able to describe both.
                       Unified on the multiple. An old value is a percent (the
                       default was 5, i.e. "profit > 5% of balance"), which as a
                       multiple would be a hair over 1 and fire on essentially
                       every win, so it is reset to the Balanced default rather
                       than converted. Flagged so it happens once. */
                    if (!c.bigWinIsMultiple) {
                        c.bigWinThreshold = DEFAULTS.bigWinThreshold;
                        c.bigWinIsMultiple = true;
                        try { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); } catch (e) {}
                    }
                    return c;
                }
            } catch (e) {}
            return { ...DEFAULTS };
        }
        function saveConfig(c) { localStorage.setItem(CONFIG_KEY, JSON.stringify(c)); }
        let config = loadConfig();

        // ---- Activity log ----
        const log = [];
        function logEntry(msg, type = 'info') {
            log.unshift({ time: new Date(), msg, type });
            if (log.length > 30) log.pop();
            renderLog();
            console.log('[Shuffle Auto-Vault]', msg);
        }

        // ---- Active balance button finder (with caching) ----
        // Shuffle's wallet header has two <button> tabs with class
        // `ShuffleUsBalanceSelect_button…` (one for GC, one for SC). The
        // active tab carries an extra `TabView_active…` class. Inside each
        // button: an <img alt="GC|SC"> + the balance as plain text. Caching
        // the resolved button matters because the fast UI tick runs every
        // 1.5s and a fresh querySelectorAll + scan is wasteful when the DOM
        // tree hasn't changed.
        let _activeBalBtnCache = null;
        function getActiveBalanceButton() {
            if (_activeBalBtnCache && _activeBalBtnCache.isConnected && /TabView_active/.test(_activeBalBtnCache.className || '')) {
                return _activeBalBtnCache;
            }
            const btns = document.querySelectorAll('button[class*="ShuffleUsBalanceSelect"]');
            let active = null;
            for (const b of btns) {
                if (/TabView_active/.test(b.className || '') || b.getAttribute('aria-selected') === 'true' || b.dataset.active === 'true') {
                    active = b; break;
                }
            }
            _activeBalBtnCache = active;
            return active;
        }

        // ---- Combined balance + currency reader (single DOM query) ----
        function readBalanceAndCurrency() {
            // shuffle.com (crypto): balance + currency icon live on the header
            // balance button — <button>…<img alt="ETH">…<span data-testid="balance">.
            // Verified live; the .us GC/SC path below is kept as a fallback.
            const balEl = document.querySelector('[data-testid="balance"]');
            const comBtn = balEl && balEl.closest('button');
            if (comBtn) {
                const cv = parseFloat((balEl.textContent || '').trim().replace(/,/g, ''));
                const alt = Array.from(comBtn.querySelectorAll('img[alt]'))
                    .map(im => (im.getAttribute('alt') || '').trim())
                    .find(a => /^[A-Za-z]{2,6}$/.test(a) && !/^(arrow|wallet|chevron|menu|icon|token|search)$/i.test(a));
                if (alt) return { balance: isNaN(cv) || cv < 0 ? NaN : cv, currency: alt.toUpperCase() };
            }
            // shuffle.us (sweeps): GC/SC tab button with img alt.
            const active = getActiveBalanceButton();
            if (!active) return { balance: NaN, currency: 'GC' };
            const v = parseFloat((active.textContent || '').trim().replace(/,/g, ''));
            const img = active.querySelector('img[alt="GC"], img[alt="SC"]');
            return {
                balance: isNaN(v) || v < 0 ? NaN : v,
                currency: (img && img.alt) || 'GC'
            };
        }
        function getBalance() { return readBalanceAndCurrency().balance; }
        function getActiveCurrency() { return readBalanceAndCurrency().currency; }

        // ---- GraphQL API helper ----
        // Hook the PAGE's fetch (not the userscript sandbox's) so we can
        // capture the live `authorization` header Shuffle sends on its own
        // GraphQL requests and replay it on ours. Cookies alone aren't
        // enough — Shuffle requires a Bearer token in this header. We use
        // `unsafeWindow` (Tampermonkey's escape hatch) to install the hook
        // on the real page fetch that Shuffle's React app actually calls.
        const PAGE_WIN = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
        if (!PAGE_WIN.__shuffleAvFetchHookInstalled) {
            PAGE_WIN.__shuffleAvFetchHookInstalled = true;
            PAGE_WIN.__shuffleAvLatestAuth = null;
            PAGE_WIN.__shuffleAvLatestAuthAt = 0;
            const origFetch = PAGE_WIN.fetch;
            PAGE_WIN.fetch = function(input, init) {
                try {
                    const url = typeof input === 'string' ? input : (input && input.url) || '';
                    if (init && init.headers && /graphql/i.test(url)) {
                        const h = init.headers;
                        let auth = null;
                        if (typeof h.get === 'function') {
                            try { auth = h.get('authorization'); } catch (e) {}
                        } else if (Array.isArray(h)) {
                            const row = h.find(p => (p[0] || '').toLowerCase() === 'authorization');
                            if (row) auth = row[1];
                        } else if (typeof h === 'object') {
                            for (const k of Object.keys(h)) {
                                if (k.toLowerCase() === 'authorization') { auth = h[k]; break; }
                            }
                        }
                        if (auth) {
                            PAGE_WIN.__shuffleAvLatestAuth = auth;
                            PAGE_WIN.__shuffleAvLatestAuthAt = Date.now();
                        }
                    }
                } catch (e) {}
                return origFetch.apply(this, arguments);
            };
        }
        // Token freshness threshold — if we haven't seen Shuffle send an
        // authenticated GraphQL call recently, the cached token may have
        // been rotated by the server. Warn but still attempt the deposit.
        const AUTH_FRESH_MS = 10 * 60 * 1000; // 10 minutes

        // The vault GraphQL endpoint is path-stable across shuffle.com / .us;
        // only the origin differs, so derive it from the current page.
        const SHUFFLE_GQL_ENDPOINT = location.origin + '/main-api/graphql/api/graphql';
        function genCorrId() {
            try {
                if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
            } catch (e) {}
            return Date.now() + '-' + Math.random().toString(36).slice(2);
        }
        async function shuffleGqlCall(operationName, query, variables) {
            const headers = {
                'accept': 'application/graphql-response+json,application/json;q=0.9',
                'content-type': 'application/json',
                'x-correlation-id': genCorrId()
            };
            const auth = PAGE_WIN.__shuffleAvLatestAuth;
            if (auth) headers['authorization'] = auth;
            // Apollo Client signature — Shuffle's server may filter on it.
            const bodyObj = {
                operationName,
                variables,
                extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' } },
                query
            };
            const bodyJson = JSON.stringify(bodyObj);
            // Use the SANDBOX fetch for our outgoing request — it forwards
            // to the browser's real network stack and avoids the cross-realm
            // object-wrapping problems that bite when calling unsafeWindow's
            // fetch with a sandbox init dict. Cookies are sent via
            // credentials:'include'; the Bearer token rides in the header.
            let res, status, statusText, rawText, parsed;
            try {
                res = await fetch(SHUFFLE_GQL_ENDPOINT, {
                    method: 'POST',
                    credentials: 'include',
                    headers,
                    body: bodyJson,
                    mode: 'cors',
                    cache: 'no-cache'
                });
                status = res.status;
                statusText = res.statusText;
                rawText = await res.text();
            } catch (e) {
                console.error('[Shuffle Auto-Vault] fetch threw:', e);
                return { error: true, status: 0, message: 'fetch-threw: ' + e.message };
            }
            try { parsed = rawText ? JSON.parse(rawText) : null; }
            catch (e) { parsed = null; }
            if (DEBUG) console.log('[Shuffle Auto-Vault] response', { op: operationName, status, statusText, raw: rawText && rawText.slice(0, 800), parsed });
            if (status < 200 || status >= 300) {
                return { error: true, status, message: statusText, raw: rawText, parsed };
            }
            return parsed || { error: true, status: -1, message: 'non-json-body', raw: rawText };
        }

        async function depositToVault(amount) {
            if (!(amount > 0)) return { ok: false, reason: 'amount-invalid' };
            if (!PAGE_WIN.__shuffleAvLatestAuth) {
                // No captured auth yet — Shuffle's React app polls regularly,
                // so this is just a transient state on a fresh page. Skip
                // this tick and wait for the next one.
                return { ok: false, reason: 'awaiting-auth-capture' };
            }
            const tokenAge = Date.now() - (PAGE_WIN.__shuffleAvLatestAuthAt || 0);
            if (tokenAge > AUTH_FRESH_MS) {
                console.warn('[Shuffle Auto-Vault] cached auth token is', Math.round(tokenAge / 60000), 'min old — may be stale');
            }
            const currency = getActiveCurrency();
            const amountStr = amount.toFixed(2);
            const query = `mutation VaultDeposit($data: VaultDepositInput!) {\n  vaultDeposit(data: $data) {\n    id\n    type\n    currency\n    amount\n    createdAt\n    afterVaultBalance\n    __typename\n  }\n}`;
            if (DEBUG) console.log('[Shuffle Auto-Vault] depositing', { currency, amount: amountStr });
            let result;
            try {
                result = await shuffleGqlCall('VaultDeposit', query, {
                    data: { currency, amount: amountStr }
                });
            } catch (e) {
                console.error('[Shuffle Auto-Vault] depositToVault threw:', e);
                return { ok: false, reason: 'exception: ' + e.message, currency };
            }
            // HTTP-level error
            if (result && result.error) {
                const msg = result.parsed && result.parsed.errors && result.parsed.errors[0] && result.parsed.errors[0].message;
                return { ok: false, reason: 'http-' + result.status + (msg ? ': ' + msg : ''), currency, raw: result };
            }
            // GraphQL-level errors
            if (result && result.errors && result.errors.length) {
                const msg = result.errors[0].message || 'graphql-error';
                return { ok: false, reason: msg, currency, raw: result };
            }
            const data = result && result.data && result.data.vaultDeposit;
            // STRICT success check: server must return an id AND a positive
            // amount. Anything else (null record, zero amount, missing id)
            // is treated as failure regardless of HTTP status.
            const serverAmount = data ? parseFloat(data.amount) : NaN;
            const afterVault = data ? parseFloat(data.afterVaultBalance) : NaN;
            if (data && data.id && !isNaN(serverAmount) && serverAmount > 0) {
                return {
                    ok: true,
                    currency: data.currency || currency,
                    amount: serverAmount,
                    afterVault: isNaN(afterVault) ? null : afterVault
                };
            }
            return {
                ok: false,
                reason: data ? `bad-response (id=${data.id || 'none'}, amount=${data.amount || '0'})` : 'no-data',
                currency,
                raw: result
            };
        }

        // ---- Session-vaulted tracking ----
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

        // ---- UI (Shuffle purple theme, Stake-equivalent layout) ----
        const style = document.createElement('style');
        style.textContent = `
            #autovault-floaty {
                position: fixed; bottom: 64px; left: 16px; z-index: 999998;
                width: 260px;
                background: linear-gradient(180deg, rgba(20, 8, 38, 0.96) 0%, rgba(12, 6, 28, 0.96) 100%);
                color: #e9d5ff;
                border: 1px solid rgba(168, 85, 247, 0.3);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(168, 85, 247, 0.15);
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                font-size: 13px; user-select: none;
                overflow: hidden;
            }
            #autovault-floaty .av-header {
                display: flex; align-items: center; justify-content: space-between;
                padding: 10px 14px;
                background: linear-gradient(135deg, rgba(124, 58, 237, 0.4), rgba(76, 29, 149, 0.4));
                border-bottom: 1px solid rgba(168, 85, 247, 0.25);
                cursor: grab;
            }
            #autovault-floaty .av-header:active { cursor: grabbing; }
            #autovault-floaty .av-title { font-weight: 700; color: #fff; font-size: 13px; }
            #autovault-floaty .av-status {
                font-size: 10px; padding: 2px 8px; border-radius: 10px;
                background: rgba(168, 85, 247, 0.15); color: #c4b5fd; margin-left: 6px;
            }
            #autovault-floaty .av-status.on { background: rgba(16, 185, 129, 0.2); color: #34d399; }
            #autovault-floaty .av-mini-btn {
                background: none; border: none; color: #a78bfa; cursor: pointer;
                padding: 2px 6px; font-size: 14px; line-height: 1; border-radius: 4px;
            }
            #autovault-floaty .av-mini-btn:hover { color: #fff; background: rgba(168, 85, 247, 0.2); }
            #autovault-floaty .av-body { padding: 12px 14px; }
            #autovault-floaty .av-row {
                display: flex; justify-content: space-between; align-items: center;
                margin: 5px 0; font-size: 12px;
            }
            #autovault-floaty .av-row .av-label { color: #c4b5fd; }
            #autovault-floaty .av-row .av-val { font-weight: 700; color: #fff; }
            #autovault-floaty .av-row .av-val.pos { color: #34d399; }
            #autovault-floaty .av-row .av-val.neg { color: #f87171; }
            #autovault-floaty .av-section-title {
                font-size: 10px; color: #a78bfa; text-transform: uppercase;
                letter-spacing: 0.5px; margin: 10px 0 6px; font-weight: 700;
            }
            #autovault-floaty .av-config { display: grid; grid-template-columns: 1fr 70px; gap: 6px 8px; align-items: center; margin-top: 4px; }
            #autovault-floaty .av-config label { font-size: 11px; color: #c4b5fd; }
            #autovault-floaty .av-config input {
                width: 100%; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(168, 85, 247, 0.3);
                background: rgba(0,0,0,0.4); color: #fff; font-size: 11px; font-weight: 600; text-align: right; outline: none;
            }
            #autovault-floaty .av-config input:focus { border-color: #a855f7; }
            #autovault-floaty .av-btn-row { display: flex; gap: 6px; margin-top: 10px; }
            #autovault-floaty .av-btn {
                flex: 1; background: rgba(168, 85, 247, 0.1); color: #e9d5ff;
                border: 1px solid rgba(168, 85, 247, 0.3); border-radius: 6px;
                padding: 7px 8px; font-size: 11px; font-weight: 700;
                cursor: pointer; text-transform: uppercase; letter-spacing: 0.4px;
                transition: all 0.18s ease;
            }
            #autovault-floaty .av-btn:hover { background: rgba(168, 85, 247, 0.25); color: #fff; }
            #autovault-floaty .av-btn.primary {
                background: linear-gradient(135deg, #a855f7, #7c3aed); border-color: #a855f7; color: #fff;
                box-shadow: 0 0 12px rgba(168, 85, 247, 0.3);
            }
            #autovault-floaty .av-btn.primary:hover { background: linear-gradient(135deg, #c084fc, #8b5cf6); }
            #autovault-floaty .av-btn.danger { color: #f87171; border-color: rgba(248,113,113,0.3); }
            #autovault-floaty .av-btn.danger:hover { background: rgba(248,113,113,0.15); }
            #autovault-floaty .av-log {
                margin-top: 10px; max-height: 110px; overflow-y: auto;
                background: rgba(0,0,0,0.25); border: 1px solid rgba(168,85,247,0.15);
                border-radius: 6px; padding: 6px 8px;
                font-family: 'Monaco', 'Consolas', monospace; font-size: 10px; line-height: 1.4;
            }
            #autovault-floaty .av-log::-webkit-scrollbar { width: 4px; }
            #autovault-floaty .av-log::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.4); border-radius: 2px; }
            #autovault-floaty .av-log-row { color: #c4b5fd; display: flex; gap: 6px; padding: 1px 0; }
            #autovault-floaty .av-log-row .av-log-time { color: #7c3aed; flex-shrink: 0; }
            #autovault-floaty .av-log-row.success { color: #34d399; }
            #autovault-floaty .av-log-row.bigwin { color: #fbbf24; }
            #autovault-floaty .av-log-row.warning { color: #f59e0b; }
            #autovault-floaty .av-log-row.error { color: #f87171; }
            #autovault-floaty .av-log-empty { color: #6b7280; font-style: italic; text-align: center; padding: 4px; font-size: 10px; }
            #autovault-floaty.mini { width: auto; min-width: 0; }
            #autovault-floaty.mini .av-body { display: none; }
        `;
        document.head.appendChild(style);

        const gui = document.createElement('div');
        /* Presets. Same three names as the Stake and Nuts panels so they mean
           the same thing to a user, but the big-win number here is a PERCENT OF
           BALANCE (profit greater than N% of balance), not a balance multiple —
           so heavier saving means a LOWER percentage, and the values cannot be
           shared with the other two panels. */
        const AV_PRESETS = {
            /* Big wins: a long grind punctuated by a spike. Skim little on the way,
               take a big bite when the balance actually jumps, and do not bother
               looking often — nothing happens between hits. */
            bigwins:   { saveAmount: 0.10, bigWinThreshold: 3.0, bigWinMultiplier: 4, checkInterval: 120000 },
            /* Fast paced (dice, limbo): profit arrives steadily and rarely spikes,
               so the big-win branch is switched off (multiplier 1) and the ordinary
               skim does the work. The interval is set just under the deposit rate
               limit of 50/hour — 75s allows 48 — so it banks as often as the site
               permits without ever tripping the cap. */
            fast:      { saveAmount: 0.12, bigWinThreshold: 5.0, bigWinMultiplier: 1, checkInterval: 75000 },
            /* Balanced: fires under most conditions, meaningful slice each time. */
            balanced:  { saveAmount: 0.25, bigWinThreshold: 2.0, bigWinMultiplier: 2, checkInterval: 60000 },
            /* Aggressive: bigger slices, and a low bar for calling something big. */
            aggressive:{ saveAmount: 0.50, bigWinThreshold: 1.4, bigWinMultiplier: 2, checkInterval: 45000 }
                };
        function avPresetNameFor(c) {
            for (const name in AV_PRESETS) {
                const p = AV_PRESETS[name];
                if (Math.abs((c.saveAmount || 0) - p.saveAmount) < 1e-9 &&
                    Math.abs((c.bigWinThreshold || 0) - p.bigWinThreshold) < 1e-9 &&
                    Math.abs((c.bigWinMultiplier || 0) - p.bigWinMultiplier) < 1e-9 &&
                    Math.abs((c.checkInterval || 0) - p.checkInterval) < 1e-9) return name;
            }
            return 'custom';
        }

        gui.id = 'autovault-floaty';
        gui.innerHTML = `
            <div class="av-header">
                <div style="display: flex; align-items: center;">
                    <span class="av-title">Auto-Vault</span>
                    <span class="av-status" id="av-status">OFF</span>
                </div>
                <button class="av-mini-btn" id="av-mini" title="Collapse">−</button>
            </div>
            <div class="av-body">
                <div class="av-row"><span class="av-label">Balance</span><span class="av-val" id="av-bal">—</span></div>
                <div class="av-row"><span class="av-label">Vaulted (session)</span><span class="av-val" id="av-vaulted">0.00</span></div>
                <div class="av-row"><span class="av-label">Last profit</span><span class="av-val" id="av-profit">—</span></div>
                <div class="av-section-title">Settings</div>
                <div class="av-config">
                    <label>Preset</label>
                    <select id="av-preset">
                        <option value="bigwins">Big wins — slots, keno, chasing multis</option>
                        <option value="fast">Fast paced — dice / limbo</option>
                        <option value="balanced">Balanced</option>
                        <option value="aggressive">Aggressive</option>
                        <option value="custom">Custom</option>
                    </select>
                    <!-- A real percentage. It read "%" while taking a FRACTION. -->
                    <label>Save % of profit</label>
                    <input type="number" id="av-save" min="1" max="100" step="1" value="${Math.round(config.saveAmount * 100)}">
                    <label>Big win at balance ×</label>
                    <input type="number" id="av-bwt" min="1" step="0.1" value="${config.bigWinThreshold}">
                    <label>Big-win multiplier</label>
                    <input type="number" id="av-bwm" min="1" step="0.5" value="${config.bigWinMultiplier}">
                    <label>Check interval (sec)</label>
                    <input type="number" id="av-int" min="10" step="10" value="${Math.round(config.checkInterval / 1000)}">
                </div>
                <div class="av-btn-row">
                    <button class="av-btn primary" id="av-toggle">${config.isRunning ? 'Stop' : 'Start'}</button>
                    <button class="av-btn danger" id="av-reset">Reset</button>
                </div>
                <div class="av-section-title">Activity</div>
                <div class="av-log" id="av-log"><div class="av-log-empty">No activity yet</div></div>
            </div>
        `;
        document.body.appendChild(gui);

        const statusEl = document.getElementById('av-status');
        const balEl = document.getElementById('av-bal');
        const vaultedEl = document.getElementById('av-vaulted');
        const profitEl = document.getElementById('av-profit');
        const toggleBtn = document.getElementById('av-toggle');
        const resetBtn = document.getElementById('av-reset');
        const miniBtn = document.getElementById('av-mini');
        const logEl = document.getElementById('av-log');

        function renderLog() {
            if (!log.length) { logEl.innerHTML = '<div class="av-log-empty">No activity yet</div>'; return; }
            logEl.innerHTML = log.map(e => {
                const t = e.time.toTimeString().slice(0, 5);
                return `<div class="av-log-row ${e.type}"><span class="av-log-time">${t}</span><span>${e.msg}</span></div>`;
            }).join('');
        }
        function renderStatus() {
            statusEl.textContent = config.isRunning ? 'ON' : 'OFF';
            statusEl.classList.toggle('on', config.isRunning);
            toggleBtn.textContent = config.isRunning ? 'Stop' : 'Start';
            // Toggle the panel status badge on the menu list too (same hook
            // the loader's refreshStatuses watches for).
            const root = document.documentElement;
            root.classList.toggle('uts-running-shuffle-autovault', config.isRunning);
        }
        // Memoize last rendered values so the 1.5s UI tick doesn't write to
        // the DOM when nothing actually changed — fewer style recalcs and
        // less work for any DOM observers Shuffle might have running.
        const _lastRendered = { bal: '\0', vaulted: '\0', profitText: '\0', profitCls: '\0' };
        function renderStats(bal, profit, vaulted) {
            const balText = isNaN(bal) ? '—' : bal.toFixed(2);
            const vaultedText = (vaulted || 0).toFixed(2);
            const profitText = isNaN(profit) ? '—' : (profit >= 0 ? '+' : '') + profit.toFixed(2);
            const profitCls = isNaN(profit) ? 'av-val' : ('av-val ' + (profit > 0 ? 'pos' : (profit < 0 ? 'neg' : '')));
            if (_lastRendered.bal !== balText) { balEl.textContent = balText; _lastRendered.bal = balText; }
            if (_lastRendered.vaulted !== vaultedText) { vaultedEl.textContent = vaultedText; _lastRendered.vaulted = vaultedText; }
            if (_lastRendered.profitText !== profitText) { profitEl.textContent = profitText; _lastRendered.profitText = profitText; }
            if (_lastRendered.profitCls !== profitCls) { profitEl.className = profitCls; _lastRendered.profitCls = profitCls; }
        }

        // ---- Monitoring loop ----
        let lastBaseline = NaN;
        let monitorTimer = null;
        let depositInProgress = false;

        async function tick() {
            if (depositInProgress) return;
            const bal = getBalance();
            if (isNaN(bal)) { renderStats(bal, NaN, getSessionVaulted()); return; }
            if (isNaN(lastBaseline)) lastBaseline = bal;
            const profit = bal - lastBaseline;
            renderStats(bal, profit, getSessionVaulted());

            if (!config.isRunning) return;
            if (profit <= 0) return;

            /* Base deposit = saveAmount × profit; a big win scales it by
               bigWinMultiplier.

               `bigWinThreshold` is a BALANCE MULTIPLE here now, matching Stake
               and Nuts. It used to be a percent-of-balance, which meant the same
               number meant two different things depending on which panel you
               were looking at and no preset could describe both. Migrated on
               load. The dust floor stays: on a tiny balance almost any win is
               technically a multiple. */
            const baseDeposit = profit * config.saveAmount;
            const thr = Math.max(1, Number(config.bigWinThreshold) || 1);
            const isBigWin = lastBaseline > 0
                && (bal / lastBaseline) >= thr
                && profit > MIN_BIG_WIN_PROFIT;
            const depositAmount = isBigWin ? baseDeposit * config.bigWinMultiplier : baseDeposit;
            if (depositAmount < MIN_DEPOSIT) return;

            depositInProgress = true;
            logEntry(`${isBigWin ? 'Big win — ' : ''}depositing ${depositAmount.toFixed(2)} (${(config.saveAmount * 100).toFixed(0)}% of ${profit.toFixed(2)})`, isBigWin ? 'bigwin' : 'info');
            try {
                const result = await depositToVault(depositAmount);
                if (result.ok) {
                    // Trust the SERVER's reported amount, not what we asked
                    // for. Track and log what actually moved.
                    const actual = result.amount;
                    addSessionVaulted(actual);
                    lastBaseline = bal - actual;
                    const ccy = result.currency ? ` ${result.currency}` : '';
                    const av = (result.afterVault != null && !isNaN(result.afterVault)) ? ` (vault: ${result.afterVault.toFixed(2)})` : '';
                    logEntry(`✓ Vaulted ${actual.toFixed(2)}${ccy}${av}`, 'success');
                } else {
                    logEntry(`Deposit failed: ${result.reason}`, 'warning');
                }
            } catch (e) {
                logEntry(`Deposit error: ${e.message}`, 'error');
            }
            depositInProgress = false;
            renderStats(getBalance(), getBalance() - lastBaseline, getSessionVaulted());
        }

        function startMonitor() {
            if (monitorTimer) return;
            lastBaseline = getBalance();
            tick();
            monitorTimer = setInterval(tick, config.checkInterval);
            logEntry('Auto-Vault started', 'success');
        }
        function stopMonitor() {
            if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = null; }
            logEntry('Auto-Vault stopped');
        }

        // ---- Event handlers ----
        toggleBtn.onclick = () => {
            config.isRunning = !config.isRunning;
            saveConfig(config);
            renderStatus();
            if (config.isRunning) startMonitor(); else stopMonitor();
        };
        resetBtn.onclick = () => {
            if (!confirm('Reset Auto-Vault session?\n\nClears vaulted-this-session total and resets the profit baseline to your current balance.')) return;
            resetSessionVaulted();
            lastBaseline = getBalance();
            log.length = 0;
            renderStats(getBalance(), 0, 0);
            renderLog();
            logEntry('Session reset', 'info');
        };
        miniBtn.onclick = () => {
            gui.classList.toggle('mini');
            miniBtn.textContent = gui.classList.contains('mini') ? '+' : '−';
        };

        // Config inputs
        const avPreset = document.getElementById('av-preset');
        const avSyncPreset = () => { avPreset.value = avPresetNameFor(config); };
        avPreset.onchange = (e) => {
            const p = AV_PRESETS[e.target.value];
            if (!p) return;                        // Custom: change nothing
            config.saveAmount = p.saveAmount;
            config.bigWinThreshold = p.bigWinThreshold;
            config.bigWinMultiplier = p.bigWinMultiplier;
            config.checkInterval = p.checkInterval;
            document.getElementById('av-save').value = Math.round(p.saveAmount * 100);
            document.getElementById('av-bwt').value = p.bigWinThreshold;
            document.getElementById('av-bwm').value = p.bigWinMultiplier;
            document.getElementById('av-int').value = Math.round(p.checkInterval / 1000);
            saveConfig(config);
            if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = setInterval(tick, config.checkInterval); }
        };
        avSyncPreset();

        document.getElementById('av-save').oninput = (e) => {
            // Typed as a percentage, stored as a fraction.
            let pct = parseFloat(e.target.value);
            if (isNaN(pct) || pct <= 0) return;
            if (pct > 100) pct = 100;
            config.saveAmount = pct / 100;
            saveConfig(config); avSyncPreset();
        };
        document.getElementById('av-bwt').oninput = (e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 1) { config.bigWinThreshold = v; saveConfig(config); avSyncPreset(); }
        };
        document.getElementById('av-bwm').oninput = (e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 1) { config.bigWinMultiplier = v; saveConfig(config); avSyncPreset(); }
        };
        document.getElementById('av-int').oninput = (e) => {
            const v = parseInt(e.target.value);
            if (!isNaN(v) && v >= 10) {
                config.checkInterval = v * 1000; saveConfig(config); avSyncPreset();
                if (monitorTimer) { clearInterval(monitorTimer); monitorTimer = setInterval(tick, config.checkInterval); }
            }
        };

        // Drag — attach mousemove/mouseup only while dragging so we don't
        // bleed document-wide handlers when the user isn't touching the
        // widget. Removes them on mouseup so multiple panels don't pile up.
        let dx = 0, dy = 0;
        const header = gui.querySelector('.av-header');
        const onMove = (e) => {
            let nl = e.clientX - dx, nt = e.clientY - dy;
            nl = Math.max(0, Math.min(window.innerWidth - gui.offsetWidth, nl));
            nt = Math.max(0, Math.min(window.innerHeight - gui.offsetHeight, nt));
            gui.style.left = nl + 'px'; gui.style.top = nt + 'px';
            gui.style.bottom = 'auto';
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            const rect = gui.getBoundingClientRect();
            dx = e.clientX - rect.left; dy = e.clientY - rect.top;
            e.preventDefault();
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // ---- Init ----
        renderStatus();
        renderLog();
        // Fast UI refresh loop — keeps the displayed balance current even
        // when other tools (Limbo/Dice auto-bot) are changing it every
        // second. Independent of the slow deposit-check tick. Guarded with
        // a global timer id so a re-run on SPA navigation replaces the
        // previous timer instead of stacking.
        if (PAGE_WIN.__shuffleAvUiTimer) clearInterval(PAGE_WIN.__shuffleAvUiTimer);
        PAGE_WIN.__shuffleAvUiTimer = setInterval(() => {
            if (depositInProgress) return;
            const bal = getBalance();
            if (isNaN(bal)) return;
            if (isNaN(lastBaseline)) lastBaseline = bal;
            renderStats(bal, bal - lastBaseline, getSessionVaulted());
        }, 1500);
        // First full tick after a brief delay so the header balance has rendered.
        setTimeout(() => { renderStats(getBalance(), NaN, getSessionVaulted()); if (config.isRunning) startMonitor(); }, 1500);
    }



    /* ----- Shuffle Auto-Vault ----- */
    register({
        id: 'shuffle-autovault',
        name: 'Shuffle Auto-Vault',
        description: 'Tracks balance + session profit on Shuffle, with one-click access to the vault dialog.',
        matches: [
            'https://shuffle.us/*',
            'https://shuffle.com/*'
        ],
        runAt: 'document-end',
        defaultEnabled: true,
        group: 'Shuffle',
        uiSelectors: ['#autovault-floaty']
    }, tool_shuffle_autovault);

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


    console.log('%c[Shuffle Auto-Vault — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
