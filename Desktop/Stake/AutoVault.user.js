// ==UserScript==
// @name         Stake Auto-Vault — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.40
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
// @match        https://stake.jp/*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/AutoVault.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/Desktop/Stake/AutoVault.user.js
// ==/UserScript==

(function () {
    'use strict';

    console.log('%cStake Auto-Vault — Desktop — standalone build v3.40', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: stake-autovault-desktop.user.js === */
    function tool_stake_autovault() {
        'use strict';
// --- Config ---
    const INIT_DELAY = 2000;
    const DEFAULT_CURRENCY = 'bnb';
    const DEFAULT_US_CURRENCY = 'sc';
    const MIN_BALANCE_CHECKS = 2;
    const DEPOSIT_VAULT_PERCENTAGE = 0.2;
    const CURRENCY_CACHE_TIMEOUT = 5000;
    const BALANCE_INIT_RETRIES = 5;
    const RATE_LIMIT_MAX = 50;
    const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour

    // Load config from localStorage or use defaults
    function loadConfig() {
        const saved = localStorage.getItem('autovault-config');
        if (saved) {
            try {
                const cfg = JSON.parse(saved);
                /* A saved threshold of exactly 5 is the OLD default, and the old
                   default could not fire: the test is `balance >= oldBalance ×
                   threshold`, so 5 asked the balance to QUINTUPLE inside a single
                   check window (90s by default). Nobody chose that number, they
                   just never changed it, and the consequence was that the
                   big-win branch was dead code for every default install.

                   Migrated once, to 1.5 — a 50% jump in one window, which is a
                   real big win and actually happens. Marked so that anyone who
                   deliberately types 5 afterwards keeps it. */
                if (cfg.bigWinThreshold === 5 && !cfg.bigWinMigrated) {
                    cfg.bigWinThreshold = 1.5;
                    cfg.bigWinMigrated = true;
                    try { localStorage.setItem('autovault-config', JSON.stringify(cfg)); } catch (e) {}
                }
                return cfg;
            } catch (e) {
                log('Failed to load saved config:', e);
            }
        }
        return {
            saveAmount: 0.1,
            bigWinThreshold: 1.5,
            bigWinMultiplier: 3,
            bigWinMigrated: true,
            checkInterval: 90000
        };
    }

    function saveConfig(config) {
        localStorage.setItem('autovault-config', JSON.stringify(config));
    }

    /* PRESETS — one coherent setup each, so the four numbers below do not have
       to be understood in order to be used.

       They differ in the obvious direction: the more you bank, the lower the bar
       for calling something a big win and the more often it checks. Values are
       stored exactly as a hand-typed setting would be, so a preset is only a way
       of filling the fields — nothing downstream knows presets exist.

       `saveAmount` is the stored FRACTION (0.1 = 10%); the field shows percent. */
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
    /** Which preset a config matches, or 'custom'. Derived by comparison rather
     *  than stored, so an existing config picks up the right label with no
     *  migration and hand-typed values that happen to match are labelled too. */
    function avPresetNameFor(cfg) {
        for (const name in AV_PRESETS) {
            const p = AV_PRESETS[name];
            if (Math.abs((cfg.saveAmount || 0) - p.saveAmount) < 1e-9 &&
                Math.abs((cfg.bigWinThreshold || 0) - p.bigWinThreshold) < 1e-9 &&
                Math.abs((cfg.bigWinMultiplier || 0) - p.bigWinMultiplier) < 1e-9 &&
                Math.abs((cfg.checkInterval || 0) - p.checkInterval) < 1e-9) return name;
        }
        return 'custom';
    }

    let config = loadConfig();
    let SAVE_AMOUNT = config.saveAmount;
    let BIG_WIN_THRESHOLD = config.bigWinThreshold;
    let BIG_WIN_MULTIPLIER = config.bigWinMultiplier;
    let CHECK_INTERVAL = config.checkInterval;

    // --- Site detection ---
    const hostname = window.location.hostname;
    const isStakeUS = hostname.endsWith('.us');
    let isScriptInitialized = false;

    // --- Activity Log ---
    const activityLog = [];
    const MAX_LOG_ENTRIES = 50;
    let onLogUpdate = null; // callback for UI updates

    function logActivity(message, type = 'info') {
        const entry = {
            time: new Date(),
            message,
            type // 'info', 'success', 'warning', 'profit', 'bigwin'
        };
        activityLog.unshift(entry);
        if (activityLog.length > MAX_LOG_ENTRIES) activityLog.pop();
        console.log('[AutoVault]', message);
        if (onLogUpdate) onLogUpdate(entry);
    }
    const log = (...args) => logActivity(args.join(' '), 'info');

    // --- Flavor Text ---
    const FLAVOR = {
        profit: [
            "Positive difference,",
            "Profit detected"
        ],
        bigWin: [
            "Big win detected",
            "Large profit"
        ],
        deposit: [
            "Deposit detected",
        
        ],
        start: [
            "AutoVault started",
            "Monitoring active"
        ],
        stop: [
            "AutoVault stopped",
            "Monitoring paused"
        ],
        rateLimit: [
            "Rate limited, vaulting paused. Please wait until it resets",
            "Limit reached, vaulting paused. Please wait until it resets"
        ]
    };
    const pickFlavor = (arr) => arr[Math.floor(Math.random() * arr.length)];

    // --- Cookie helper ---
    const getCookie = (name) => {
        const m = document.cookie.match('(^|;)\\s*' + name + '\\s*=\\s*([^;]+)');
        return m ? m.pop().replace(/"/g, '') : '';
    };

    // --- Balance selectors (updated for current Stake DOM structure) ---
    // Primary: coin-toggle button contains balance in .content span
    // Fallbacks included for potential variations
    const BALANCE_SELECTORS = [
        '[data-testid="coin-toggle"] .content span[data-ds-text="true"]',
        '[data-testid="balance-toggle"] .content span[data-ds-text="true"]',
        '[data-testid="coin-toggle"] .content span',
        '[data-testid="balance-toggle"] span.content span',
        // Legacy selectors as final fallback
        '[data-testid="user-balance"] .numeric',
        '.numeric.variant-highlighted',
        '[data-testid="user-balance"]',
        '.balance-value'
    ];

    // --- Stake API ---
    class StakeApi {
        constructor() {
            this.apiUrl = window.location.origin + '/_api/graphql';
            this._accessToken = getCookie("session");
            this.headers = {
                'content-type': 'application/json',
                'x-access-token': this._accessToken,
                'x-language': 'en'
            };
        }
        async call(body, opName) {
            const headers = {...this.headers};
            if (opName) headers['x-operation-name'] = opName;
            try {
                const res = await fetch(this.apiUrl, {
                    credentials: 'include',
                    headers,
                    referrer: window.location.origin,
                    body: body,
                    method: 'POST',
                    mode: 'cors',
                    cache: 'no-cache'
                });
                if (!res.ok) {
                    log(`API call failed with status ${res.status}: ${res.statusText}`);
                    return { error: true, status: res.status, message: res.statusText };
                }
                return res.json();
            } catch (e) {
                log('API call failed:', e);
                return { error: true, message: e.message, type: 'network' };
            }
        }
        async getBalances() {
            const q = {
                query: `query UserBalances {
                    user { id balances {
                        available { amount currency }
                        vault { amount currency }
                    }}}`,
                variables: {}
            };
            return this.call(JSON.stringify(q), 'UserBalances');
        }
        async depositToVault(currency, amount) {
            const q = {
                query: `mutation CreateVaultDeposit($currency: CurrencyEnum!, $amount: Float!) {
                    createVaultDeposit(currency: $currency, amount: $amount) {
                        id amount currency user {
                            id balances {
                                available { amount currency }
                                vault { amount currency }
                            }
                        }
                        __typename
                    }
                }`,
                variables: { currency, amount }
            };
            return this.call(JSON.stringify(q), 'CreateVaultDeposit');
        }
    }

    // --- Vault Display UI (floaty) ---
    class VaultDisplay {
        constructor() {
            this._el = document.createElement("span");
            this._el.id = "vaultDisplayElement";
            this._vaulted = 0;
            this._currency = getCurrency();
            this._el.title = "Vaulted this session";
            Object.assign(this._el.style, {
                marginLeft: "8px",
                color: "#00c4a7",
                fontSize: "1em",
                fontWeight: "bold",
                background: "#1a2c38",
                borderRadius: "6px",
                padding: "2px 8px",
                boxShadow: "0 2px 8px #0002"
            });
            // Instead of inserting into nav, floaty UI will show this in the widget
            this._load();
            this.render();
        }
        _storageKey() {
            const c = (this._currency || getCurrency() || '').toLowerCase();
            return `autovault-vaulted-session:${c}`;
        }
        _load() {
            try {
                const raw = sessionStorage.getItem(this._storageKey());
                const v = parseFloat(raw);
                if (!isNaN(v) && v >= 0) this._vaulted = v;
            } catch (e) {
                // ignore
            }
        }
        _save() {
            try {
                sessionStorage.setItem(this._storageKey(), String(this._vaulted));
            } catch (e) {
                // ignore
            }
        }
        setCurrency(currency) {
            this._currency = (currency || getCurrency() || '').toLowerCase();
            this._load();
            this.render();
        }
        render() {
            if (!this._el) return;
            this._el.innerText = (this._vaulted || 0).toFixed(8);
        }
        update(amount) {
            const add = +amount;
            if (isNaN(add) || add <= 0) return;
            this._vaulted = (this._vaulted || 0) + add;
            this._save();
            this.render();
        }
        reset() {
            this._vaulted = 0;
            this._save();
            this.render();
        }
    }

    // --- Simplified currency detection ---
    function parseStakeAmount(text) {
        if (!text) return NaN;
        const raw = String(text).replace(/\u00a0/g, ' ').trim();
        if (!raw) return NaN;
        if (/[•*]+/.test(raw)) return NaN;

        const m = raw.match(/[-+]?\d[\d\s,.'’]*(?:[.,]\d+)?[kmbt]?/i);
        if (!m) return NaN;

        let token = m[0].trim();
        const suffixMatch = token.match(/[kmbt]$/i);
        const suffix = suffixMatch ? suffixMatch[0].toLowerCase() : '';
        token = token.replace(/[kmbt]$/i, '').trim();

        token = token.replace(/[\s'’]/g, '');

        const hasDot = token.includes('.');
        const hasComma = token.includes(',');
        if (hasDot && hasComma) {
            if (token.lastIndexOf('.') > token.lastIndexOf(',')) {
                token = token.replace(/,/g, '');
            } else {
                token = token.replace(/\./g, '').replace(/,/g, '.');
            }
        } else if (hasComma && !hasDot) {
            const parts = token.split(',');
            if (parts.length === 2 && parts[1].length <= 2) token = `${parts[0]}.${parts[1]}`;
            else token = token.replace(/,/g, '');
        } else {
            token = token.replace(/,/g, '');
        }

        const n = parseFloat(token);
        if (isNaN(n)) return NaN;

        const mult =
            suffix === 'k' ? 1e3 :
            suffix === 'm' ? 1e6 :
            suffix === 'b' ? 1e9 :
            suffix === 't' ? 1e12 :
            1;

        return n * mult;
    }

    function detectCurrencyFromBalanceBar() {
        /* The balance bar used to read "25.00 SC". Since Stake's 2026 redesign it
           reads "25.00 Wallet" — no currency code — so the old uppercase-letters
           match returned null and the currency cross-check inside
           getCurrentBalance() silently stopped working. Read the attribute the
           page now carries instead; it is the same value getCurrency() uses, so
           the two agree by construction. */
        const attr = document.querySelector('[data-active-currency]') ||
                     document.querySelector('[data-bet-amount-active-currency]');
        if (attr) {
            const v = attr.getAttribute('data-active-currency') ||
                      attr.getAttribute('data-bet-amount-active-currency');
            if (v) return v.toLowerCase();
        }
        const el =
            document.querySelector('[data-testid="coin-toggle"]') ||
            document.querySelector('[data-testid="balance-toggle"]');
        if (!el) return null;
        const txt = (el.textContent || '').trim();
        const m = txt.match(/\b[A-Z]{2,5}\b/);
        return m ? m[0].toLowerCase() : null;
    }

    function getCurrency() {
        const now = Date.now();
        if (getCurrency.cached && getCurrency.cacheTime && (now - getCurrency.cacheTime < CURRENCY_CACHE_TIMEOUT)) {
            return getCurrency.cached;
        }
        const el = document.querySelector('[data-active-currency]');
        if (el) {
            const c = el.getAttribute('data-active-currency');
            if (c) {
                getCurrency.cached = c.toLowerCase();
                getCurrency.cacheTime = now;
                return getCurrency.cached;
            }
        }
        const fromBar = detectCurrencyFromBalanceBar();
        if (fromBar) {
            getCurrency.cached = fromBar;
            getCurrency.cacheTime = now;
            return getCurrency.cached;
        }
        const defaultCurr = isStakeUS ? DEFAULT_US_CURRENCY : DEFAULT_CURRENCY;
        getCurrency.cached = defaultCurr;
        getCurrency.cacheTime = now;
        return defaultCurr;
    }

    /* False while the API is the source of truth but has no figure for the
       ACTIVE currency yet — i.e. the seconds right after a currency switch.
       checkBalanceChanges sits those out rather than acting on a number whose
       units it cannot vouch for. */
    let balanceTrusted = true;

    // --- Get balance from UI ---
    function getCurrentBalance() {
        const curCode = (activeCurrency || getCurrency() || '').toLowerCase();
        /* THE API VALUE WINS, always.

           It is the balance in COIN units. The number on the page is whatever
           the user set their display to, and on stake.com that is routinely
           fiat — a $300 balance shown for what is really a fraction of a SOL.
           The vault mutation takes a coin amount, so feeding it the displayed
           figure asked to move 24.3 SOL when the user meant $24.30, and Stake
           answered "insufficient balance". Reported 2026-08-03.

           This used to be reached only when the UI currency disagreed with the
           active one, which never happens in fiat mode — same coin, different
           unit. Preferring the API outright makes display mode irrelevant
           instead of trying to detect and convert it. The DOM read below stays
           as the fallback for when the API has not answered yet. */
        if (curCode) {
            const apiVal = getCurrentBalance._api?.[curCode];
            if (typeof apiVal === 'number' && apiVal >= 0) {
                balanceTrusted = true;
                return apiVal;
            }
        }
        /* ONCE THE API HAS ANSWERED, THE DOM IS NEVER TRUSTED AGAIN.

           The remaining hole in the fiat fix was a currency switch: change coin
           mid-session and `_api[newCode]` is empty for a few seconds, so the
           code below would hand back the DISPLAYED figure — dollars — and the
           vault would be handed a fiat number again, which is the whole bug.

           So if the API is known to work at all, an unknown currency means "not
           yet", not "ask the page". The caller checks `balanceTrusted` and sits
           the round out rather than acting on a number of unknown units. */
        if (getCurrentBalance._api && Object.keys(getCurrentBalance._api).length) {
            balanceTrusted = false;
            return getCurrentBalance.lastKnownBalance || 0;
        }
        // Try each selector in order until we find a valid balance
        for (const selector of BALANCE_SELECTORS) {
            try {
                const el = document.querySelector(selector);
                if (el) {
                    const val = parseStakeAmount(el.textContent);
                    if (!isNaN(val) && val >= 0) {
                        // Cache the working selector for performance
                        if (!getCurrentBalance._workingSelector || getCurrentBalance._workingSelector !== selector) {
                            getCurrentBalance._workingSelector = selector;
                            log(`📍 Balance detected using selector: ${selector}`);
                        }
                        getCurrentBalance.lastKnownBalance = val;
                        balanceTrusted = true;
                        return val;
                    }
                }
            } catch (e) {
                // Continue to next selector
            }
        }
        if (curCode) {
            const apiVal = getCurrentBalance._api?.[curCode];
            if (typeof apiVal === 'number' && apiVal >= 0) return apiVal;
        }
        // If no selector worked, log a warning (but only once per session)
        if (!getCurrentBalance._warned) {
            getCurrentBalance._warned = true;
            log('⚠️ Could not detect balance with any known selector. Please check if Stake updated their UI.');
        }
        return getCurrentBalance.lastKnownBalance || 0;
    }

    // --- Vault Rate Limit Tracking ---
    function loadRateLimitData() {
        const saved = sessionStorage.getItem('autovault-ratelimit');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                return data.filter(ts => Date.now() - ts < RATE_LIMIT_WINDOW);
            } catch (e) {
                log('Failed to load rate limit data:', e);
            }
        }
        return [];
    }

    function saveRateLimitData(timestamps) {
        sessionStorage.setItem('autovault-ratelimit', JSON.stringify(timestamps));
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

    // --- Floaty UI Widget ---
    // View modes: 'full', 'mini', 'stealth'
    let currentViewMode = 'full';

    function createVaultFloatyUI(startCallback, stopCallback, getParams, setParams, vaultDisplay) {
        // Remove old if present
        if (document.getElementById('autovault-floaty')) {
            document.getElementById('autovault-floaty').remove();
        }
        if (document.getElementById('autovault-stealth')) {
            document.getElementById('autovault-stealth').remove();
        }

        // Style - Clean, minimal design
        const style = document.createElement('style');
        style.id = 'autovault-styles';
        style.textContent = `
        /* === FULL PANEL === */
        #autovault-floaty {
            background: #0f212e;
            color: #b1bad3;
            border: 1px solid #2f4553;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.4);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            font-size: 13px;
            min-width: 240px;
            max-width: 280px;
            user-select: none;
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 999999;
            display: flex;
            flex-direction: column;
            transition: opacity 0.2s, transform 0.2s;
        }
        #autovault-floaty.hidden { display: none; }
        #autovault-floaty .av-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: #1a2c38;
            padding: 8px 10px;
            border-radius: 8px 8px 0 0;
            border-bottom: 1px solid #2f4553;
            cursor: grab;
        }
        #autovault-floaty .av-header:active { cursor: grabbing; }
        #autovault-floaty .av-title {
            display: flex;
            align-items: center;
            gap: 6px;
            font-weight: 600;
            font-size: 12px;
            color: #fff;
            letter-spacing: 0.3px;
        }
        #autovault-floaty .av-status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #4a5568;
        }
        #autovault-floaty .av-status-dot.running { background: #10b981; }
        #autovault-floaty .av-header-btns {
            display: flex;
            gap: 2px;
        }
        #autovault-floaty .av-header-btn {
            background: none;
            border: none;
            color: #64748b;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            font-size: 14px;
            line-height: 1;
            transition: color 0.15s, background 0.15s;
        }
        #autovault-floaty .av-header-btn:hover {
            color: #fff;
            background: #2f4553;
        }
        #autovault-floaty .av-content {
            padding: 12px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        #autovault-floaty .av-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        #autovault-floaty .av-label {
            color: #94a3b8;
            font-size: 12px;
        }
        #autovault-floaty input[type="number"] {
            background: #1a2c38;
            color: #e2e8f0;
            border: 1px solid #2f4553;
            border-radius: 4px;
            padding: 4px 6px;
            font-size: 12px;
            width: 60px;
            text-align: right;
            transition: border-color 0.15s;
        }
        #autovault-floaty input[type="number"]:focus {
            outline: none;
            border-color: #3b82f6;
        }
        #autovault-floaty .av-btn-row {
            display: flex;
            gap: 6px;
            margin-top: 4px;
        }
        #autovault-floaty .av-btn {
            flex: 1;
            background: #1a2c38;
            color: #b1bad3;
            border: 1px solid #2f4553;
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        #autovault-floaty .av-btn:hover:not(:disabled) {
            background: #2f4553;
            color: #fff;
        }
        #autovault-floaty .av-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        #autovault-floaty .av-btn.primary {
            background: #10b981;
            border-color: #10b981;
            color: #fff;
        }
        #autovault-floaty .av-btn.primary:hover:not(:disabled) {
            background: #059669;
        }
        #autovault-floaty .av-btn.danger {
            background: #ef4444;
            border-color: #ef4444;
            color: #fff;
        }
        #autovault-floaty .av-btn.danger:hover:not(:disabled) {
            background: #dc2626;
        }
        #autovault-floaty .av-stats {
            display: flex;
            justify-content: space-between;
            padding-top: 8px;
            border-top: 1px solid #2f4553;
            font-size: 11px;
        }
        #autovault-floaty .av-stat {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        #autovault-floaty .av-stat-label {
            color: #64748b;
            font-size: 10px;
            text-transform: uppercase;
        }
        #autovault-floaty .av-stat-value {
            color: #10b981;
            font-weight: 600;
        }
        #autovault-floaty .av-footer {
            display: flex;
            justify-content: center;
            padding: 6px;
            border-top: 1px solid #2f4553;
        }
        #autovault-floaty .av-link {
            color: #64748b;
            font-size: 10px;
            text-decoration: none;
            transition: color 0.15s;
        }
        #autovault-floaty .av-link:hover { color: #94a3b8; }

        /* === LOG PANEL === */
        #autovault-floaty .av-log-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 12px;
            background: #1a2c38;
            border-top: 1px solid #2f4553;
            cursor: pointer;
            transition: background 0.15s;
        }
        #autovault-floaty .av-log-toggle:hover { background: #243442; }
        #autovault-floaty .av-log-toggle-text {
            font-size: 10px;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        #autovault-floaty .av-log-toggle-icon {
            font-size: 10px;
            color: #64748b;
            transition: transform 0.2s;
        }
        #autovault-floaty .av-log-toggle.open .av-log-toggle-icon {
            transform: rotate(180deg);
        }
        #autovault-floaty .av-log {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.25s ease-out;
            background: #0a1a24;
        }
        #autovault-floaty .av-log.open {
            max-height: 120px;
        }
        #autovault-floaty .av-log-inner {
            padding: 8px;
            max-height: 120px;
            overflow-y: auto;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 10px;
            line-height: 1.4;
        }
        #autovault-floaty .av-log-inner::-webkit-scrollbar {
            width: 4px;
        }
        #autovault-floaty .av-log-inner::-webkit-scrollbar-track {
            background: #0a1a24;
        }
        #autovault-floaty .av-log-inner::-webkit-scrollbar-thumb {
            background: #2f4553;
            border-radius: 2px;
        }
        #autovault-floaty .av-log-entry {
            padding: 2px 0;
            color: #64748b;
            display: flex;
            gap: 6px;
        }
        #autovault-floaty .av-log-entry.success { color: #10b981; }
        #autovault-floaty .av-log-entry.profit { color: #10b981; }
        #autovault-floaty .av-log-entry.bigwin { color: #fbbf24; }
        #autovault-floaty .av-log-entry.warning { color: #f59e0b; }
        #autovault-floaty .av-log-entry.error { color: #ef4444; }
        #autovault-floaty .av-log-time {
            color: #475569;
            flex-shrink: 0;
        }
        #autovault-floaty .av-log-empty {
            color: #475569;
            font-style: italic;
            text-align: center;
            padding: 8px;
        }

        /* === MINI MODE === */
        #autovault-floaty.mini {
            min-width: auto;
            max-width: none;
            border-radius: 20px;
        }
        #autovault-floaty.mini .av-header {
            border-radius: 20px;
            padding: 6px 12px;
            border-bottom: none;
        }
        #autovault-floaty.mini .av-content,
        #autovault-floaty.mini .av-log-toggle,
        #autovault-floaty.mini .av-log,
        #autovault-floaty.mini .av-footer { display: none; }
        #autovault-floaty.mini .av-title span { display: none; }

        /* === STEALTH MODE === */
        #autovault-stealth {
            position: fixed;
            bottom: 10px;
            right: 10px;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #4a5568;
            cursor: pointer;
            z-index: 999999;
            transition: transform 0.15s, background 0.15s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        }
        #autovault-stealth:hover {
            transform: scale(1.5);
        }
        #autovault-stealth.running { background: #10b981; }
        #autovault-stealth.hidden { display: none; }

        @media (max-width: 500px) {
            #autovault-floaty {
                right: 10px !important;
                left: 10px !important;
                max-width: none;
                min-width: auto;
            }
        }
        `;
        document.head.appendChild(style);

        // Main widget container
        const widget = document.createElement('div');
        widget.id = 'autovault-floaty';

        // Stealth indicator (separate element)
        const stealthDot = document.createElement('div');
        stealthDot.id = 'autovault-stealth';
        stealthDot.className = 'hidden';
        stealthDot.title = 'AutoVault (click to expand)';
        document.body.appendChild(stealthDot);

        // Header
        const header = document.createElement('div');
        header.className = 'av-header';
        header.innerHTML = `
            <div class="av-title">
                <div class="av-status-dot" id="avStatusDot"></div>
                <span>AutoVault</span>
            </div>
            <div class="av-header-btns">
                <!-- No close button by design. Removing the panel needs a page
                     reload to get it back, and it was sitting one pixel from
                     Minimize. Use the ⚙ panel's toggle to actually disable the
                     tool; − collapses it to a draggable pill. -->
                <button class="av-header-btn" id="avMinBtn" title="Minimize">−</button>
                <button class="av-header-btn" id="avStealthBtn" title="Stealth Mode">○</button>
            </div>
        `;
        widget.appendChild(header);

        // Content
        const content = document.createElement('div');
        content.className = 'av-content';
        content.innerHTML = `
            <!-- Presets, because four interacting numbers is three too many for
                 anyone who has not read the code. Each one is a whole coherent
                 setup; the fields stay visible and editable, and touching any of
                 them flips this to Custom rather than silently disagreeing with
                 the label above it. -->
            <div class="av-row">
                <span class="av-label" title="A ready-made set of the four values below">Preset</span>
                <select id="vaultPreset">
                    <option value="bigwins">Big wins — slots, keno, chasing multis</option>
                    <option value="fast">Fast paced — dice / limbo</option>
                    <option value="balanced">Balanced</option>
                    <option value="aggressive">Aggressive</option>
                    <option value="custom">Custom</option>
                </select>
            </div>
            <!-- The field is a real percentage now. It used to be labelled
                 "Save %" while accepting a FRACTION (min 0, max 1), so 0.1 meant
                 10% and anyone typing 30 for "30%" was clamped to 1 and vaulted
                 the lot. Stored as a fraction still; only the display changed. -->
            <div class="av-row">
                <span class="av-label" title="Percent of each profit moved to the vault">Save % of profit</span>
                <input type="number" id="vaultSaveAmount" min="0" max="100" step="1" value="${Math.round(getParams().saveAmount * 100)}">
            </div>
            <div class="av-row">
                <span class="av-label" title="Vault extra when the balance reaches this multiple of what it was at the last check">Big win at balance ×</span>
                <input type="number" id="vaultBigWinThreshold" min="1" step="0.1" value="${getParams().bigWinThreshold}">
            </div>
            <div class="av-row">
                <span class="av-label">Big Win Multiplier</span>
                <input type="number" id="vaultBigWinMultiplier" min="1" step="0.1" value="${getParams().bigWinMultiplier}">
            </div>
            <div class="av-row">
                <span class="av-label">Check Interval (sec)</span>
                <input type="number" id="vaultCheckInterval" min="10" step="1" value="${getParams().checkInterval}">
            </div>
            <div class="av-btn-row">
                <button class="av-btn primary" id="vaultStartBtn">Start</button>
                <button class="av-btn danger" id="vaultStopBtn" disabled>Stop</button>
            </div>
            <div class="av-stats">
                <div class="av-stat">
                    <span class="av-stat-label">Vault Balance</span>
                    <span class="av-stat-value" id="avVaultBal">0.00</span>
                </div>
                <div class="av-stat">
                    <span class="av-stat-label">Actions/hr</span>
                    <span class="av-stat-value" id="avVaultCount">0/50</span>
                </div>
            </div>
        `;
        widget.appendChild(content);

        // Log toggle
        const logToggle = document.createElement('div');
        logToggle.className = 'av-log-toggle';
        logToggle.innerHTML = `
            <span class="av-log-toggle-text">Activity Log</span>
            <span class="av-log-toggle-icon">▼</span>
        `;
        widget.appendChild(logToggle);

        // Log panel
        const logPanel = document.createElement('div');
        logPanel.className = 'av-log';
        logPanel.innerHTML = `<div class="av-log-inner" id="avLogInner"><div class="av-log-empty">No activity yet...</div></div>`;
        widget.appendChild(logPanel);

        const logInner = logPanel.querySelector('#avLogInner');

        // Toggle log panel
        logToggle.onclick = () => {
            logToggle.classList.toggle('open');
            logPanel.classList.toggle('open');
        };

        // Format time for log
        const formatTime = (date) => {
            const h = date.getHours().toString().padStart(2, '0');
            const m = date.getMinutes().toString().padStart(2, '0');
            const s = date.getSeconds().toString().padStart(2, '0');
            return `${h}:${m}:${s}`;
        };

        // Add log entry to UI
        function addLogEntry(entry) {
            // Remove empty message if present
            const empty = logInner.querySelector('.av-log-empty');
            if (empty) empty.remove();

            const div = document.createElement('div');
            div.className = `av-log-entry ${entry.type}`;
            div.innerHTML = `<span class="av-log-time">${formatTime(entry.time)}</span><span>${entry.message}</span>`;
            logInner.insertBefore(div, logInner.firstChild);

            // Keep only last 20 entries in UI
            while (logInner.children.length > 20) {
                logInner.removeChild(logInner.lastChild);
            }
        }

        // Set up log callback
        onLogUpdate = addLogEntry;

        // Footer
        const footer = document.createElement('div');
        footer.className = 'av-footer';
        footer.innerHTML = `<a href="https://stakestats.net/" target="_blank" class="av-link">stakestats.net</a>`;
        widget.appendChild(footer);

        // Replace vault display element reference
        const vaultBalEl = content.querySelector('#avVaultBal');
        vaultDisplay._el = vaultBalEl;
        vaultDisplay.render();

        // View mode switching
        const statusDot = widget.querySelector('#avStatusDot');
        const minBtn = widget.querySelector('#avMinBtn');
        const stealthBtn = widget.querySelector('#avStealthBtn');

        function setViewMode(mode) {
            currentViewMode = mode;
            if (mode === 'full') {
                widget.classList.remove('mini', 'hidden');
                stealthDot.classList.add('hidden');
            } else if (mode === 'mini') {
                widget.classList.add('mini');
                widget.classList.remove('hidden');
                stealthDot.classList.add('hidden');
            } else if (mode === 'stealth') {
                widget.classList.add('hidden');
                stealthDot.classList.remove('hidden');
            }
        }

        minBtn.onclick = (e) => {
            e.stopPropagation();
            setViewMode(currentViewMode === 'mini' ? 'full' : 'mini');
            minBtn.textContent = currentViewMode === 'mini' ? '+' : '−';
            minBtn.title = currentViewMode === 'mini' ? 'Expand' : 'Minimize';
        };

        stealthBtn.onclick = (e) => {
            e.stopPropagation();
            setViewMode('stealth');
        };

        stealthDot.onclick = () => {
            setViewMode('full');
            minBtn.textContent = '−';
        };


        // Drag logic (works on header)
        let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
        header.addEventListener('mousedown', function(e) {
            if (e.target.closest('.av-header-btns')) return;
            isDragging = true;
            dragOffsetX = e.clientX - widget.getBoundingClientRect().left;
            dragOffsetY = e.clientY - widget.getBoundingClientRect().top;
            e.preventDefault();
        });
        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            let newLeft = e.clientX - dragOffsetX;
            let newTop = e.clientY - dragOffsetY;
            newLeft = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, newLeft));
            newTop = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, newTop));
            widget.style.left = newLeft + 'px';
            widget.style.top = newTop + 'px';
            widget.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });

        // Status & vault count updates
        const startBtn = content.querySelector('#vaultStartBtn');
        const stopBtn = content.querySelector('#vaultStopBtn');
        const vaultCountEl = content.querySelector('#avVaultCount');

        function updateVaultCountUI() {
            const count = getVaultCountLastHour();
            vaultCountEl.textContent = `${count}/50`;
            vaultCountEl.style.color = count >= 50 ? '#ef4444' : count >= 40 ? '#f59e0b' : '#10b981';
        }
        window.__updateVaultCountUI = updateVaultCountUI;
        updateVaultCountUI();
        setInterval(updateVaultCountUI, 10000);

        function setRunningState(isRunning) {
            statusDot.classList.toggle('running', isRunning);
            stealthDot.classList.toggle('running', isRunning);
            startBtn.disabled = isRunning;
            stopBtn.disabled = !isRunning;
        }

        startBtn.onclick = () => {
            setRunningState(true);
            startCallback();
            updateVaultCountUI();
        };
        stopBtn.onclick = () => {
            setRunningState(false);
            stopCallback();
            updateVaultCountUI();
        };

        // Parameter change handlers
        /* Preset wiring. Selecting one fills every field; editing any field puts
           the selector back to Custom, so the label can never claim a preset the
           numbers no longer match. */
        const presetSel = content.querySelector('#vaultPreset');
        const syncPresetLabel = () => { presetSel.value = avPresetNameFor(getParams()); };
        presetSel.onchange = function () {
            const p = AV_PRESETS[this.value];
            if (!p) return;                       // "Custom" selected: change nothing
            setParams({
                saveAmount: p.saveAmount,
                bigWinThreshold: p.bigWinThreshold,
                bigWinMultiplier: p.bigWinMultiplier,
                checkInterval: p.checkInterval / 1000   // setParams takes seconds
            });
            content.querySelector('#vaultSaveAmount').value = Math.round(p.saveAmount * 100);
            content.querySelector('#vaultBigWinThreshold').value = p.bigWinThreshold;
            content.querySelector('#vaultBigWinMultiplier').value = p.bigWinMultiplier;
            content.querySelector('#vaultCheckInterval').value = Math.round(p.checkInterval / 1000);
        };
        syncPresetLabel();

        content.querySelector('#vaultSaveAmount').onchange = function() {
            // Typed as a percentage, stored as a fraction.
            let pct = parseFloat(this.value);
            if (isNaN(pct) || pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            setParams({saveAmount: pct / 100});
            this.value = pct;
            syncPresetLabel();
        };
        content.querySelector('#vaultBigWinThreshold').onchange = function() {
            let v = parseFloat(this.value);
            if (isNaN(v) || v < 1) v = 1;
            setParams({bigWinThreshold: v});
            this.value = v;
            syncPresetLabel();
        };
        content.querySelector('#vaultBigWinMultiplier').onchange = function() {
            let v = parseFloat(this.value);
            if (isNaN(v) || v < 1) v = 1;
            setParams({bigWinMultiplier: v});
            this.value = v;
            syncPresetLabel();
        };
        content.querySelector('#vaultCheckInterval').onchange = function() {
            let v = parseInt(this.value, 10);
            if (isNaN(v) || v < 10) v = 10;
            setParams({checkInterval: v});
            this.value = v;
            syncPresetLabel();
        };

        document.body.appendChild(widget);

        return {
            setStatus: (txt, color) => {},
            setRunning: setRunningState,
            updateVaultCount: updateVaultCountUI
        };
    }

    // --- Main logic ---
    let vaultInterval = null;
    let vaultDisplay = null;
    let stakeApi = null;
    let activeCurrency = null;
    let apiBalanceInterval = null;
    let oldBalance = 0;
    let isProcessing = false;
    let isInitialized = false;
    let balanceChecks = 0;
    let lastDepositDetected = 0;
    let lastDepositAmount = 0;
    let lastBalance = 0;
    let lastVaultedDeposit = 0;
    let running = false;
    let uiWidget = null;

    async function refreshApiBalance() {
        try {
            if (!stakeApi) stakeApi = new StakeApi();
            const cur = (activeCurrency || getCurrency() || '').toLowerCase();
            if (!cur) return;
            const resp = await stakeApi.getBalances();
            const balances = resp?.data?.user?.balances;
            if (!Array.isArray(balances)) return;
            const bal = balances.find(x => x?.available?.currency?.toLowerCase() === cur);
            /* The VAULT side of the same response is what tells a withdrawal
               apart from a win. Both raise the available balance; only a
               withdrawal lowers the vault at the same time. Free to collect —
               the query already asks for it. */
            const vAmt = bal?.vault?.amount;
            const vn = typeof vAmt === 'number' ? vAmt : parseFloat(vAmt);
            if (!isNaN(vn) && vn >= 0) {
                if (!getCurrentBalance._vault) getCurrentBalance._vault = {};
                getCurrentBalance._vault[cur] = vn;
            }
            const amt = bal?.available?.amount;
            const n = typeof amt === 'number' ? amt : parseFloat(amt);
            if (isNaN(n) || n < 0) return;
            if (!getCurrentBalance._api) getCurrentBalance._api = {};
            getCurrentBalance._api[cur] = n;
        } catch (e) {
            // ignore
        }
    }

    function startApiBalancePolling() {
        if (apiBalanceInterval) clearInterval(apiBalanceInterval);
        apiBalanceInterval = setInterval(refreshApiBalance, 5000);
        refreshApiBalance();
    }

    function stopApiBalancePolling() {
        if (apiBalanceInterval) clearInterval(apiBalanceInterval);
        apiBalanceInterval = null;
    }

    function getParams() {
        return {
            saveAmount: SAVE_AMOUNT,
            bigWinThreshold: BIG_WIN_THRESHOLD,
            bigWinMultiplier: BIG_WIN_MULTIPLIER,
            checkInterval: Math.round(CHECK_INTERVAL/1000)
        };
    }
    function setParams(obj) {
        if (obj.saveAmount !== undefined) SAVE_AMOUNT = obj.saveAmount;
        if (obj.bigWinThreshold !== undefined) BIG_WIN_THRESHOLD = obj.bigWinThreshold;
        if (obj.bigWinMultiplier !== undefined) BIG_WIN_MULTIPLIER = obj.bigWinMultiplier;
        if (obj.checkInterval !== undefined) CHECK_INTERVAL = obj.checkInterval * 1000;

        // Save config to localStorage
        config = {
            saveAmount: SAVE_AMOUNT,
            bigWinThreshold: BIG_WIN_THRESHOLD,
            bigWinMultiplier: BIG_WIN_MULTIPLIER,
            checkInterval: CHECK_INTERVAL
        };
        saveConfig(config);

        if (running) {
            stopVaultScript();
            startVaultScript();
        }
    }

    function checkCurrencyChange() {
        getCurrency.cached = null;
        getCurrency.cacheTime = null;
        const newCurrency = getCurrency();
        if (newCurrency !== activeCurrency) {
            log(`💱 Currency changed: ${activeCurrency} → ${newCurrency}`);
            activeCurrency = newCurrency;
            startApiBalancePolling();
            vaultDisplay.setCurrency(activeCurrency);
            vaultDisplay.reset();
            isInitialized = false;
            balanceChecks = 0;
            updateCurrentBalance();
            return true;
        }
        return false;
    }

    function updateCurrentBalance() {
        const cur = getCurrentBalance();
        if (cur > 0) {
            oldBalance = cur;
            if (!isInitialized && balanceChecks++ >= MIN_BALANCE_CHECKS) {
                isInitialized = true;
                log(`🐾 Initial balance: ${oldBalance.toFixed(8)} ${activeCurrency}`);
            }
        }
    }

    // --- Vault Rate Limit Enforcement in processDeposit ---
    async function processDeposit(amount, isBigWin) {
        if (amount < 1e-8 || isProcessing) return;
        if (!canVaultNow()) {
            logActivity(`${pickFlavor(FLAVOR.rateLimit)} - Rate limit reached`, 'warning');
            if (uiWidget && typeof uiWidget.updateVaultCount === "function") uiWidget.updateVaultCount();
            return;
        }
        isProcessing = true;
        const pct = (SAVE_AMOUNT * (isBigWin ? BIG_WIN_MULTIPLIER : 1) * 100).toFixed(0);
        const flavor = pickFlavor(isBigWin ? FLAVOR.bigWin : FLAVOR.profit);
        logActivity(`${flavor} Vaulting ${pct}%: ${amount.toFixed(6)} ${activeCurrency.toUpperCase()}`, isBigWin ? 'bigwin' : 'profit');
        try {
            const resp = await stakeApi.depositToVault(activeCurrency, amount);
            isProcessing = false;
            if (resp && resp.data && resp.data.createVaultDeposit) {
                vaultDisplay.update(amount);
                vaultActionTimestamps.push(Date.now());
                saveRateLimitData(vaultActionTimestamps);
                /* Re-read balance after successful deposit to avoid drift. Both
                   halves together — our own deposit raises the vault, and
                   leaving prevVaultBal behind would make that rise look like a
                   withdrawal was owed on the next check. */
                rebaseline(getCurrentBalance());
                if (uiWidget && typeof uiWidget.updateVaultCount === "function") uiWidget.updateVaultCount();
                logActivity(`Secured ${amount.toFixed(6)} ${activeCurrency.toUpperCase()}`, 'success');
            } else {
                logActivity('Vault failed - may be rate limited', 'error');
            }
        } catch (e) {
            isProcessing = false;
            logActivity('Vault error: ' + (e.message || 'unknown'), 'error');
        }
    }

    function initializeBalance() {
        updateCurrentBalance();
        let tries = 0;
        const intv = setInterval(() => {
            updateCurrentBalance();
            if (++tries >= BALANCE_INIT_RETRIES) {
                clearInterval(intv);
                if (oldBalance > 0) {
                    isInitialized = true;
                    log(`Initialized with starting balance: ${oldBalance.toFixed(8)} ${activeCurrency}`);
                } else {
                    log(`Unable to detect starting balance! Using current balance.`);
                    const cur = getCurrentBalance();
                    if (cur > 0) {
                        oldBalance = cur;
                        isInitialized = true;
                        log(`Last attempt balance: ${oldBalance.toFixed(8)} ${activeCurrency}`);
                    }
                }
            }
        }, 1000);
    }

    function detectDepositEvent() {
        let found = false;
        let depositAmount = 0;
        const possibleSelectors = [
            '[data-testid*="notification"]',
            '[class*="notification"]',
            '[class*="transaction"]',
            '[class*="history"]',
            '[class*="activity"]'
        ];
        for (const sel of possibleSelectors) {
            const nodes = document.querySelectorAll(sel);
            for (const node of nodes) {
                const txt = (node.textContent || '');
                const lower = txt.toLowerCase();
                if (lower.includes('deposit') && /\d/.test(lower)) {
                    const amt = parseStakeAmount(txt);
                    if (!isNaN(amt) && amt > 0) {
                        depositAmount = amt;
                        found = true;
                        break;
                    }
                }
            }
            if (found) break;
        }
        if (found) {
            lastDepositDetected = Date.now();
            lastDepositAmount = depositAmount;
            return depositAmount;
        }
        return 0;
    }

    /* How much came OUT of the vault since the last check.

       Moving money from the vault back to your balance looks exactly like a win
       to a balance watcher, so AutoVault took its cut of it and put a slice
       straight back — reported as "the damn vaulter keeps vaulting my balance as
       soon as I move the vault to my balance". The vault figure is the signal
       that separates the two: a win raises the balance and leaves the vault
       alone, a withdrawal raises the balance and drops the vault by the same
       amount. Our own deposits move the vault UP, so they can never be mistaken
       for a withdrawal here.

       THE VAULT READING IS PAIRED WITH THE BALANCE, NOT WITH THE CHECK. An
       earlier cut of this advanced its own baseline on every check, so a check
       that did nothing still consumed the drop and the withdrawal was forgotten
       before anything acted on the matching balance rise. Measured on the mobile
       twin: a 5 SOL withdrawal still vaulted 1.41. `oldBalance` and
       `prevVaultBal` now only ever move together, via rebaseline(). */
    let prevVaultBal = null;
    function currentVaultBal() {
        const code = (activeCurrency || getCurrency() || '').toLowerCase();
        const v = getCurrentBalance._vault ? getCurrentBalance._vault[code] : undefined;
        return typeof v === 'number' ? v : null;
    }
    /** Move both halves of the observation at once. */
    function rebaseline(bal) {
        oldBalance = bal;
        prevVaultBal = currentVaultBal();
    }

    function checkBalanceChanges() {
        if (checkCurrencyChange()) return;
        const cur = getCurrentBalance();
        /* Units unknown for the moment — see balanceTrusted. Skipping is safe:
           the next tick re-baselines from a figure we can vouch for. */
        if (!balanceTrusted) { rebaseline(cur); lastBalance = cur; return; }
        const vaultNow = currentVaultBal();
        const withdrawn = (vaultNow !== null && prevVaultBal !== null)
            ? Math.max(0, prevVaultBal - vaultNow) : 0;
        if (!isInitialized) return updateCurrentBalance();

        let depositAmt = detectDepositEvent();
        if (depositAmt > 0) {
            if (cur - lastBalance >= depositAmt * 0.95 && lastVaultedDeposit !== depositAmt) {
                const toVault = depositAmt * SAVE_AMOUNT;
                logActivity(`${pickFlavor(FLAVOR.deposit)} +${depositAmt.toFixed(4)} ${activeCurrency.toUpperCase()}`, 'info');
                processDeposit(toVault, false);
                lastVaultedDeposit = depositAmt;
                rebaseline(cur);
            }
        } else if (cur > oldBalance) {
            /* Subtracted rather than ignored, so a window holding BOTH a
               withdrawal and a genuine win still vaults the winnings. */
            const profit = Math.max(0, (cur - oldBalance) - withdrawn);
            if (profit <= 0) {
                if (withdrawn > 0)
                    logActivity(`Vault withdrawal of ${withdrawn.toFixed(8)} ${activeCurrency.toUpperCase()} — not counted as profit`, 'info');
                rebaseline(cur);
            } else {
                /* `>=` so the threshold means what it says. Measured against the
                   balance this window STARTED from, i.e. 1.5 = "the balance is
                   half again what it was". */
                const isBig = oldBalance > 0 && cur >= oldBalance * BIG_WIN_THRESHOLD;
                const depAmt = profit * SAVE_AMOUNT * (isBig ? BIG_WIN_MULTIPLIER : 1);
                processDeposit(depAmt, isBig);
                rebaseline(cur);
            }
        } else if (cur < oldBalance) {
            rebaseline(cur);
        }
        lastBalance = cur;
        if (uiWidget && typeof uiWidget.updateVaultCount === "function") uiWidget.updateVaultCount();
    }

    function startVaultScript() {
        if (running) return;
        isScriptInitialized = true;
        running = true;
        logActivity(pickFlavor(FLAVOR.start), 'success');
        logActivity(`Watching ${getCurrency().toUpperCase()} on ${isStakeUS ? 'Stake.us' : 'Stake.com'}`, 'info');
        if (!vaultDisplay) vaultDisplay = new VaultDisplay();
        stakeApi = new StakeApi();
        activeCurrency = getCurrency();
        startApiBalancePolling();
        vaultDisplay.setCurrency(activeCurrency);
        vaultDisplay.reset();
        oldBalance = 0;
        isProcessing = false;
        isInitialized = false;
        balanceChecks = 0;
        lastDepositDetected = 0;
        lastDepositAmount = 0;
        lastBalance = getCurrentBalance();
        lastVaultedDeposit = 0;
        vaultActionTimestamps = [];
        initializeBalance();
        vaultInterval = setInterval(checkBalanceChanges, CHECK_INTERVAL);
        if (uiWidget) {
            uiWidget.setStatus('Running', '#00c4a7');
            uiWidget.setRunning(true);
            if (typeof uiWidget.updateVaultCount === "function") uiWidget.updateVaultCount();
        }
    }
    function stopVaultScript() {
        if (!running) return;
        running = false;
        isScriptInitialized = false;
        if (vaultInterval) clearInterval(vaultInterval);
        vaultInterval = null;
        stopApiBalancePolling();
        if (vaultDisplay) vaultDisplay.reset();
        if (uiWidget) {
            uiWidget.setStatus('Stopped', '#fff');
            uiWidget.setRunning(false);
            if (typeof uiWidget.updateVaultCount === "function") uiWidget.updateVaultCount();
        }
        logActivity(pickFlavor(FLAVOR.stop), 'info');
    }

    // --- UI Widget setup (floaty) ---
    setTimeout(() => {
        if (!uiWidget) {
            if (!vaultDisplay) vaultDisplay = new VaultDisplay();
            uiWidget = createVaultFloatyUI(
                startVaultScript,
                stopVaultScript,
                getParams,
                setParams,
                vaultDisplay
            );
            vaultDisplay.setCurrency(getCurrency());
        }
    }, INIT_DELAY);



    }


    /* ----- Stake Auto-Vault ----- */
    register({
        id: 'stake-autovault',
        name: 'Stake Auto-Vault',
        description: 'Auto-deposits a % of profits to your Stake vault.',
        matches: [
            'https://stake.com/*',
            'https://stake.bet/*',
            'https://stake.games/*',
            'https://staketr.com/*',
            'https://staketr2.com/*',
            'https://staketr3.com/*',
            'https://staketr4.com/*',
            'https://stake.bz/*',
            'https://stake.us/*',
            'https://stake.pet/*', 'https://stake.jp/*'
        ],
        runAt: 'document-end',
        defaultEnabled: true,
        group: 'Stake',
        uiSelectors: ['#autovault-floaty', '#autovault-stealth']
    }, tool_stake_autovault);

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


    console.log('%c[Stake Auto-Vault — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
