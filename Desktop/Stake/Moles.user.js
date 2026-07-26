// ==UserScript==
// @name         Stake Moles — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.30
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

    console.log('%cStake Moles — Desktop — standalone build v3.30', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: moles.user.js — "Holy Moley" by Zerocu, v0.9.5 === */
    function tool_stake_moles() {
    'use strict';

    /* =========================================================
    STYLES — mirrors the TypicalPrag HUD visual language:
    dark teal gradient panels, neon-green accents, uppercase
    micro-labels, blurred backdrops, 12px radii.
    ========================================================= */
    GM_addStyle(`
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

        #moles-master-container .hud-body { display: flex; flex-direction: column; gap: 5px; }

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
            padding: 7px 8px;
            display: flex; flex-direction: column; gap: 5px;
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
        const candidates = [
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
        sparkCanvas = root.querySelector('[data-lock-spark]');
        sparkCtx = sparkCanvas ? sparkCanvas.getContext('2d') : null;
        const exportBtn = root.querySelector('[data-act="export-csv"]');
        if (exportBtn) exportBtn.addEventListener('click', exportCsv);
        const audioBtn = root.querySelector('[data-act="toggle-audio"]');
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
        historyEl = root.querySelector('[data-lock-history]');
        multEl = root.querySelector('[data-lock-mult]');
        subEl = root.querySelector('[data-lock-sub]');
        wEl = root.querySelector('[data-tally-w]');
        lEl = root.querySelector('[data-tally-l]');
        bestEl = root.querySelector('[data-tally-best]');
        statsEls = {
            wager: root.querySelector('[data-st-wager]'),
            ret: root.querySelector('[data-st-return]'),
            pnl: root.querySelector('[data-st-pnl]'),
            rtp: root.querySelector('[data-st-rtp]'),
            wr: root.querySelector('[data-st-wr]'),
            avg: root.querySelector('[data-st-avg]'),
            big: root.querySelector('[data-st-big]'),
            bal: root.querySelector('[data-st-bal]'),
            next: root.querySelector('[data-st-next]'),
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
        const lockSide = document.querySelector('#moles-board-lock .lock-side');
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

        const sidebar = document.querySelector('.game-sidebar');
        if (!sidebar) return;
        if (getComputedStyle(sidebar).position === 'static') sidebar.style.position = 'relative';
        sidebar.appendChild(root);
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

    /* Disabling the tool only CSS-hides its HUD. This tool also resizes the
       shared game chrome, so it has to read its own toggle and undo that too,
       otherwise a disabled Moles would still squash the sidebar. */
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
        if (!resizeObserver) setupResizeObserver();
    }, 500);

    window.addEventListener('unload', () => {
        if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
        if (resizeObserver) resizeObserver.disconnect();
    });
    }

    /* ----- Stake Moles ----- */
    register({
        id: 'stake-moles',
        name: 'Stake Moles',
        description: 'Autoplays Moles on Stake via DOM clicks or direct API calls, with a live board overlay.',
        matches: [
            'https://stake.com/casino/games/moles*',
            'https://stake.us/casino/games/moles*',
            'https://stake.bet/casino/games/moles*',
            'https://stake.games/casino/games/moles*',
            'https://staketr.com/casino/games/moles*',
            'https://staketr2.com/casino/games/moles*',
            'https://staketr3.com/casino/games/moles*',
            'https://staketr4.com/casino/games/moles*',
            'https://stake.bz/casino/games/moles*',
            'https://stake.pet/casino/games/moles*'
        ],
        runAt: 'document-end',
        defaultEnabled: true,
        group: 'Stake',
        uiSelectors: ['#moles-master-container', '#moles-board-lock']
    }, tool_stake_moles);

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


    console.log('%c[Stake Moles — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
