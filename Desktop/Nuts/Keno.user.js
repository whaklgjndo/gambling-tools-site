// ==UserScript==
// @name         Nuts Keno — Desktop
// @namespace    http://tampermonkey.net/
// @version      3.32
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

    console.log('%cNuts Keno — Desktop — standalone build v3.32', 'color:#17c7b8;font-weight:800;font-size:13px');

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

    /* === source: nuts-keno-desktop.user.js === */
    function tool_nuts_keno() {
        'use strict';
const PRESETS_KEY = 'keno-presets';
    // Slider index → risk name. nuts.gg's slider ranges aria-valuemin=0 to aria-valuemax=3.
    const RISK_BY_INDEX = ['classic', 'low', 'medium', 'high'];
    const INDEX_BY_RISK = Object.fromEntries(RISK_BY_INDEX.map((r, i) => [r, i]));

    // --- Presets store (shared with Stake keno via same localStorage key) ---
    function loadPresets() {
        try {
            const raw = localStorage.getItem(PRESETS_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch { return []; }
    }
    function savePresets(list) {
        localStorage.setItem(PRESETS_KEY, JSON.stringify(list));
    }

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // --- Tile detection: content-based (styled-components class names change on deploy) ---
    function getTiles() {
        // Tile = <button> whose first <span> is exactly a number 1-40. nuts.gg
        // redesigned the tile from 2 children (span + cover) to 3 (span + cover
        // div + hidden haptic input), so match on the numbered span rather than a
        // fixed child count. The 40-distinct-numbers requirement keeps it precise,
        // and children[1] stays the purple/gray cover for readPicksFromDOM.
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

    // Picks are tracked from the user's own click events. DOM-based detection
    // breaks during a round because game-drawn HIT tiles introduce a third
    // class (unselected / user-picked / hit), and the frequency heuristic then
    // picks up hits as selections.
    const userPicks = new Set();

    // DOM-based best guess — only reliable while the board is IDLE (no hits
    // showing). Used once on load to seed userPicks, and via the Sync button.
    function readPicksFromDOM() {
        // A picked tile's cover (children[1]) is the purple accent
        // (~rgb(150,46,255)); unpicked is gray and drawn results are green.
        // A hit flashes green during the reveal then reverts to purple, so this
        // is accurate between rounds. Number comes from the tile's label span.
        const picks = [];
        for (const t of getTiles()) {
            const cover = t.children[1];
            if (!cover) continue;
            const m = (getComputedStyle(cover).backgroundColor || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
            if (!m) continue;
            const r = +m[1], g = +m[2], b = +m[3];
            if (!((r + b) > 200 && g < 100)) continue; // purple cover = picked; green/gray excluded
            const sp = t.querySelector('span');
            const n = sp ? parseInt((sp.textContent || '').trim(), 10) : NaN;
            if (n >= 1 && n <= 40) picks.push(n);
        }
        return picks;
    }
    function syncPicksFromDOM() {
        userPicks.clear();
        for (const n of readPicksFromDOM()) userPicks.add(n);
    }
    function getSelectedNumbers() {
        // Read live from the board (purple cover = picked) so the panel can't
        // drift out of sync and never counts drawn results. userPicks is only a
        // fallback for when the board isn't mounted yet.
        if (getTiles().length) return readPicksFromDOM().slice().sort((a, b) => a - b);
        return Array.from(userPicks).sort((a, b) => a - b);
    }

    function clickTile(number) {
        const tiles = getTiles();
        const t = tiles[number - 1];
        if (!t) return false;
        t.click();
        return true;
    }

    // --- Risk slider ---
    function getRiskSlider() {
        return document.querySelector('[role="slider"][aria-valuemax="3"][aria-valuemin="0"]')
            || document.querySelector('[role="slider"]');
    }
    function getRisk() {
        const s = getRiskSlider();
        if (s) {
            const idx = Number(s.getAttribute('aria-valuenow'));
            if (!isNaN(idx) && RISK_BY_INDEX[idx]) return RISK_BY_INDEX[idx];
        }
        // Fallback: parse the "MEDIUM RISK" label
        const spans = document.querySelectorAll('span');
        for (const sp of spans) {
            const m = (sp.textContent || '').match(/\b(CLASSIC|LOW|MEDIUM|HIGH)\s*RISK\b/i);
            if (m) return m[1].toLowerCase();
        }
        return null;
    }
    async function setRisk(risk) {
        const targetIdx = INDEX_BY_RISK[risk];
        if (targetIdx === undefined) return false;
        const slider = getRiskSlider();
        if (!slider) return false;
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

    async function applyPreset(preset) {
        if (!preset || !Array.isArray(preset.numbers)) return;
        if (preset.risk) {
            await setRisk(preset.risk);
            await sleep(80);
        }
        // After a round the Nuts board is locked (tiles disabled) until the
        // table is cleared back to the betting phase — so loading a different
        // preset would silently do nothing. Click "Clear Table" first to unlock
        // it (resets to 0 picks, all tiles enabled), then select fresh.
        const clearBtn = Array.from(document.querySelectorAll('button'))
            .find(b => /clear\s*table/i.test(b.textContent || ''));
        if (clearBtn && !clearBtn.disabled) { clearBtn.click(); await sleep(250); }
        const current = new Set(getSelectedNumbers());
        const target = new Set(preset.numbers);
        for (const n of current) {
            if (!target.has(n)) { clickTile(n); await sleep(50); }
        }
        for (const n of target) {
            if (!current.has(n)) { clickTile(n); await sleep(50); }
        }
    }

    // --- UI ---
    const style = document.createElement('style');
    style.textContent = `
    #keno-preset-gui {
        position: fixed; bottom: 20px; right: 20px; z-index: 999999;
        --kp-accent: #19f3ff;
        background: rgba(16, 20, 30, 0.55);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        color: #e0ffff; border: 1px solid rgba(0, 255, 255, 0.15);
        border-top: 1px solid rgba(0, 255, 255, 0.3);
        border-left: 1px solid rgba(0, 255, 255, 0.3);
        border-radius: 14px;
        box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.05);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px; width: 260px; user-select: none;
    }
    #keno-preset-gui .kp-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; border-radius: 14px 14px 0 0;
        border-bottom: 1px solid rgba(0, 255, 255, 0.15); cursor: grab;
    }
    #keno-preset-gui .kp-header:active { cursor: grabbing; }
    #keno-preset-gui .kp-title {
        font-weight: 700; font-size: 13px; color: #00ffff;
        letter-spacing: 1px;
        text-shadow: 0 0 10px rgba(0, 255, 255, 0.6), 0 0 20px rgba(0, 255, 255, 0.2);
    }
    #keno-preset-gui .kp-close {
        background: none; border: none; color: rgba(224, 255, 255, 0.5); cursor: pointer;
        padding: 2px 6px; font-size: 16px; line-height: 1; border-radius: 4px;
    }
    #keno-preset-gui .kp-close:hover { color: #00ffff; background: rgba(0, 255, 255, 0.1); text-shadow: 0 0 5px rgba(0, 255, 255, 0.5); }
    #keno-preset-gui .kp-content { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; }
    #keno-preset-gui select {
        width: 100%; background: rgba(0, 0, 0, 0.25); color: #00ffff;
        border: 1px solid rgba(0, 255, 255, 0.2); border-radius: 6px;
        padding: 6px 8px; font-size: 12px; font-weight: 600; outline: none;
        text-shadow: 0 0 5px rgba(0, 255, 255, 0.4);
    }
    #keno-preset-gui select:focus { border-color: rgba(0, 255, 255, 0.6); }
    #keno-preset-gui .kp-btn-row { display: flex; gap: 6px; }
    #keno-preset-gui .kp-btn {
        flex: 1; background: rgba(0, 255, 255, 0.05); color: #e0ffff;
        border: 1px solid rgba(0, 255, 255, 0.2); border-radius: 8px;
        padding: 6px 8px; font-size: 11px; font-weight: 700;
        cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
        transition: all 0.18s ease;
    }
    #keno-preset-gui .kp-btn:hover:not(:disabled) {
        background: rgba(0, 255, 255, 0.15); color: #00ffff;
        box-shadow: 0 0 12px rgba(0, 255, 255, 0.25);
    }
    #keno-preset-gui .kp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    #keno-preset-gui .kp-btn.primary {
        background: rgba(0, 255, 255, 0.15); border-color: rgba(0, 255, 255, 0.5);
        color: #00ffff; text-shadow: 0 0 5px rgba(0, 255, 255, 0.5);
        box-shadow: 0 0 10px rgba(0, 255, 255, 0.15);
    }
    #keno-preset-gui .kp-btn.primary:hover:not(:disabled) {
        background: rgba(0, 255, 255, 0.25);
        box-shadow: 0 0 18px rgba(0, 255, 255, 0.4);
    }
    #keno-preset-gui .kp-btn.danger { color: #ff0055; border-color: rgba(255, 0, 85, 0.3); }
    #keno-preset-gui .kp-btn.danger:hover:not(:disabled) {
        background: rgba(255, 0, 85, 0.15); color: #ff66a0;
        box-shadow: 0 0 12px rgba(255, 0, 85, 0.3);
    }
    #keno-preset-gui .kp-current {
        padding: 8px 10px; background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(0, 255, 255, 0.1); border-radius: 6px;
        font-size: 11px; color: rgba(224, 255, 255, 0.7); line-height: 1.4; word-break: break-word;
    }
    #keno-preset-gui .kp-current b { color: #00ffff; text-shadow: 0 0 5px rgba(0, 255, 255, 0.4); }
    `;
    document.head.appendChild(style);

    const gui = document.createElement('div');
    gui.id = 'keno-preset-gui';
    gui.innerHTML = `
        <div class="kp-header">
            <span class="kp-title">Nuts Keno</span>
            <button class="kp-close" id="kp-close" title="Close">×</button>
        </div>
        <div class="kp-content">
            <div class="kp-current" id="kp-current">Loading…</div>
            <select id="kp-select"></select>
            <div class="kp-btn-row">
                <button class="kp-btn primary" id="kp-load">Load</button>
                <button class="kp-btn" id="kp-save">Save As…</button>
                <button class="kp-btn danger" id="kp-delete">Delete</button>
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
            : `No picks selected · risk <b>${risk}</b>`;
    }

    saveBtn.onclick = () => {
        const nums = getSelectedNumbers();
        if (!nums.length) {
            alert('Select some numbers first, then save as a preset.');
            return;
        }
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
    };

    loadBtn.onclick = async () => {
        const list = loadPresets();
        const p = list.find(x => x.name === selectEl.value);
        if (!p) return;
        loadBtn.disabled = true;
        await applyPreset(p);
        setTimeout(() => {
            loadBtn.disabled = false;
            renderCurrent();
        }, 200);
    };

    deleteBtn.onclick = () => {
        const name = selectEl.value;
        if (!name) return;
        if (!confirm(`Delete preset "${name}"?`)) return;
        const list = loadPresets().filter(p => p.name !== name);
        savePresets(list);
        renderPresets();
    };

    closeBtn.onclick = () => gui.remove();

    // Track user clicks on tiles — our pick set is the source of truth.
    // Nuts tiles are identified by content (number inside a span), so we map
    // the clicked button back to its index via getTiles().
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const tiles = getTiles();
        if (!tiles.length) return;
        const idx = tiles.indexOf(btn);
        if (idx === -1) return;
        const n = idx + 1;
        if (userPicks.has(n)) userPicks.delete(n);
        else userPicks.add(n);
        setTimeout(renderCurrent, 0);
    }, true);

    // Drag
    let isDragging = false, dx = 0, dy = 0;
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.kp-close')) return;
        isDragging = true;
        const rect = gui.getBoundingClientRect();
        dx = e.clientX - rect.left; dy = e.clientY - rect.top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        let nl = e.clientX - dx, nt = e.clientY - dy;
        nl = Math.max(0, Math.min(window.innerWidth - gui.offsetWidth, nl));
        nt = Math.max(0, Math.min(window.innerHeight - gui.offsetHeight, nt));
        gui.style.left = nl + 'px'; gui.style.top = nt + 'px';
        gui.style.right = 'auto'; gui.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; });

    // Re-render on grid / slider changes. Both the tiles' grid container and
    // the risk slider get destroyed + recreated when the user SPA-navigates
    // away from /keno and back, so we keep a persistent loop that re-binds
    // the observers whenever either element identity changes. Avoids the
    // "UI re-appears but picks don't update" bug after navigation.
    let tilesObserver = null;
    let riskObserver = null;
    let _observedGridParent = null;
    let _observedSlider = null;
    function attachWatchers() {
        const tiles = getTiles();
        if (!tiles.length) return false;
        const gridParent = tiles[0].parentElement;
        if (gridParent && gridParent !== _observedGridParent) {
            if (tilesObserver) tilesObserver.disconnect();
            tilesObserver = new MutationObserver(() => renderCurrent());
            tilesObserver.observe(gridParent, { attributes: true, subtree: true, attributeFilter: ['class'] });
            _observedGridParent = gridParent;
            // Re-sync picks + render only on a fresh grid (initial mount or
            // post-SPA-nav); otherwise we'd thrash on every tick.
            syncPicksFromDOM();
            renderCurrent();
        }
        const slider = getRiskSlider();
        if (slider && slider !== _observedSlider) {
            if (riskObserver) riskObserver.disconnect();
            riskObserver = new MutationObserver(() => renderCurrent());
            riskObserver.observe(slider, { attributes: true, attributeFilter: ['aria-valuenow'] });
            _observedSlider = slider;
        }
        return true;
    }

    // Persistent attach loop — runs forever, cheap because attachWatchers
    // only does real work when the grid or slider element identity changes.
    setInterval(attachWatchers, 500);

    renderPresets();
    renderCurrent();


    // The hotspot is part of this tool: it mounts into the panel built
    // above, so there is one Keno panel and one Keno toggle.
    tool_keno_hotspot();
    }
    /* === end tool: nuts-keno === */

    /* ----- Nuts Keno ----- */
    register({
        id: 'nuts-keno',
        name: 'Nuts Keno',
        description: 'Save & load Keno number + risk presets on Nuts.',
        matches: [
            'https://nuts.gg/keno*',
            'https://*.nuts.gg/keno*'
        ],
        runAt: 'document-end',
        defaultEnabled: true,
        group: 'Nuts',
        uiSelectors: ['#keno-preset-gui', '.keno-hot-tint']
    }, tool_nuts_keno);

    /* === source: keno-hotspot (Stake / Shuffle / Nuts) === */
    /**
     * Keno Hotspot — hot/cold heatmap for Stake, Shuffle and Nuts.
     *
     * Records every completed draw, tints the board hot→cold by how often each
     * number has come up over a rolling window, and applies the hottest (or
     * coldest) N numbers in one click.
     *
     * One body serves all three sites via SITES below, because each casino
     * marks its tiles differently and none of them agree:
     *
     *   Stake    data-game-tile-status. Resting is `hidden` — NOT `idle`, which
     *            is Mines' vocabulary; assuming that made every tile read as
     *            drawn and nothing was ever recorded. Resting is therefore
     *            re-derived per read as the plurality status (see restingOf).
     *   Shuffle  hashed CSS-module classes, and its own Keno tool documents
     *            them exactly: selectedButton = pick that missed, buttonSuccess
     *            = pick that was drawn, buttonFailed = drawn but not picked.
     *            So drawn = buttonSuccess | buttonFailed — no inference needed.
     *   Nuts     no stable classes at all; state lives in the cover element's
     *            computed background colour (purple = picked, green = drawn).
     *
     * Capture accumulates the UNION of drawn-looking tiles across the reveal
     * rather than reading the settled board. Nuts forces this — its own tool
     * notes that a hit "flashes green during the reveal then reverts to
     * purple", so the final frame is missing every number you actually hit. The
     * union also makes progressive reveals safe on Stake and Shuffle, where
     * tiles light one at a time and any single frame is a partial draw.
     *
     * A reveal commits when the expected count is reached, or failing that when
     * the set stops growing for STABLE_TICKS polls — so a site that draws a
     * different number of spots still records correctly.
     *
     * Heat is a z-score so it is comparable across window sizes, and it makes no
     * assumption about board size or draws-per-round: expected hits per number
     * is simply the total drawn spread evenly over the board,
     *     mean = total / spots,  p = (total / rounds) / spots,
     *     z    = (count − mean) / sqrt(rounds · p · (1 − p)).
     * Worth saying plainly: draws are independent, so a hot number is not a
     * likelier number. This shows what HAS happened, not what will.
     */
    function tool_keno_hotspot() {
        'use strict';
        if (tool_keno_hotspot._booted) return;
        tool_keno_hotspot._booted = true;

        var KH_VERSION   = '1.10';
        var MAX_PICKS    = 10;   // every one of the three caps a ticket at 10
        var DRAWS_CAP    = 2000; // rolling history cap (~100KB of JSON)
        var STABLE_TICKS = 3;    // ~1.2s of no new tiles ends a reveal
        var POLL_MS      = 400;

        function qsa(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
        function rgb(el) {
            var m = (getComputedStyle(el).backgroundColor || '').match(/(\d+),\s*(\d+),\s*(\d+)/);
            return m ? [+m[1], +m[2], +m[3]] : null;
        }
        /** The status held by the most tiles. A reveal lights a minority of the
         *  board and a ticket is at most 10 spots, so resting always wins. */
        function restingOf(all, statusFn) {
            var freq = {}, best = -1, resting = null, i, s;
            for (i = 0; i < all.length; i++) {
                s = statusFn(all[i]);
                freq[s] = (freq[s] || 0) + 1;
                if (freq[s] > best) { best = freq[s]; resting = s; }
            }
            return resting;
        }
        function stakeStatus(b) {
            return String(b.getAttribute('data-game-tile-status') || '').toLowerCase();
        }
        var STAKE_NOT_DRAWN = { hidden: 1, idle: 1, none: 1, selected: 1, '': 1 };

        var SITES = {
            stake: {
                label: 'Stake',
                key: 'keno-hotspot-stake-v1',
                onPage: function () { return /casino\/games\/keno(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                tiles: function () { return qsa('button[data-testid^="game-tile-"]'); },
                number: function (b, i) {
                    var m = (b.getAttribute('data-testid') || '').match(/game-tile-(\d+)/);
                    if (m) return parseInt(m[1], 10);
                    var d = parseInt(b.dataset ? b.dataset.index : NaN, 10);
                    return isNaN(d) ? (i + 1) : d + 1;
                },
                prepare: function (all) { return restingOf(all, stakeStatus); },
                isDrawn: function (b, resting) {
                    var s = stakeStatus(b);
                    return s !== resting && !STAKE_NOT_DRAWN[s];
                },
                isPicked: function (b) {
                    var s = stakeStatus(b);
                    return s === 'selected' || s === 'match';
                },
                expect: 10
            },
            shuffle: {
                label: 'Shuffle',
                key: 'keno-hotspot-shuffle-v1',
                onPage: function () { return /games\/originals\/keno(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                tiles: function () { return qsa('button[data-testid^="keno-button-"]'); },
                number: function (b, i) {
                    var m = ((b.dataset && b.dataset.testid) || b.getAttribute('data-testid') || '').match(/keno-button-(\d+)/);
                    return m ? parseInt(m[1], 10) : (i + 1);
                },
                prepare: function () { return null; },
                // Documented by Shuffle's own Keno tool — no inference needed.
                isDrawn: function (b) { return /buttonSuccess|buttonFailed/.test(b.className || ''); },
                isPicked: function (b) { return /selectedButton|buttonSuccess/.test(b.className || ''); },
                expect: 10
            },
            nuts: {
                label: 'Nuts',
                key: 'keno-hotspot-nuts-v1',
                onPage: function () { return /\/keno(?:\/|$|\?|#)/i.test(location.pathname || ''); },
                // Content-based, mirroring the Nuts Keno tool: a tile is a
                // <button> whose first <span> is exactly a number 1-40, and all
                // 40 must be present. Returned in number order.
                tiles: function () {
                    var byNum = {}, count = 0, btns = qsa('button'), i;
                    for (i = 0; i < btns.length; i++) {
                        var span = btns[i].querySelector('span');
                        if (!span) continue;
                        var txt = (span.textContent || '').trim();
                        var n = parseInt(txt, 10);
                        if (n >= 1 && n <= 40 && txt === String(n) && !byNum[n]) { byNum[n] = btns[i]; count++; }
                    }
                    if (count < 40) return [];
                    var out = [];
                    for (i = 1; i <= 40; i++) out.push(byNum[i]);
                    return out;
                },
                number: function (b, i) { return i + 1; },   // tiles() is number-ordered
                prepare: function () { return null; },
                // Cover element (children[1]) carries the state as a colour:
                // purple = picked, green = drawn, grey = untouched.
                isDrawn: function (b) {
                    var cover = b.children && b.children[1];
                    if (!cover) return false;
                    var c = rgb(cover);
                    return !!c && c[1] > c[0] + 50 && c[1] > 120;
                },
                isPicked: function (b) {
                    var cover = b.children && b.children[1];
                    if (!cover) return false;
                    var c = rgb(cover);
                    return !!c && (c[0] + c[2]) > 200 && c[1] < 100;
                },
                expect: 10
            }
        };

        function detectSite() {
            var h = location.hostname;
            if (/shuffle\./i.test(h)) return SITES.shuffle;
            if (/(^|\.)nuts\.gg$/i.test(h)) return SITES.nuts;
            return SITES.stake;
        }
        var SITE    = detectSite();
        // Governed by the site's Keno toggle — the hotspot is part of that
        // tool now, not a separately registered one.
        var TOOL_ID = (SITE === SITES.shuffle ? 'shuffle' : SITE === SITES.nuts ? 'nuts' : 'stake') + '-keno';

        function onPage() { try { return SITE.onPage(); } catch (e) { return false; } }
        /** The control panel's switch. Unknown ids read as enabled. */
        function khEnabled() {
            try { return isToolIdEnabled(TOOL_ID); } catch (e) { return true; }
        }

        /* ---------------------------------------------------------------
           STORE — a rolling list of draws, {t, n:[numbers]}. Keyed per site;
           localStorage is per-origin anyway, but the explicit key keeps a
           multi-brand origin from ever mixing two boards.
           --------------------------------------------------------------- */
        var store = { draws: [], window: 100 };
        try {
            var raw = JSON.parse(localStorage.getItem(SITE.key) || 'null');
            if (raw && Array.isArray(raw.draws)) {
                store.draws = raw.draws;
                if (raw.window != null) store.window = raw.window;
            }
        } catch (e) {}
        var storeDirty = false;
        function saveStore() { storeDirty = true; }
        setInterval(function () {          // batch writes; the ticker touches these often
            if (!storeDirty) return;
            storeDirty = false;
            try { localStorage.setItem(SITE.key, JSON.stringify(store)); } catch (e) {}
        }, 1200);

        function recordDraw(nums) {
            store.draws.push({ t: Date.now(), n: nums });
            if (store.draws.length > DRAWS_CAP) store.draws.shift();
            saveStore();
        }
        function resetStore() { store.draws = []; saveStore(); render(); paintTiles(); }

        /* ---------------------------------------------------------------
           STATS
           --------------------------------------------------------------- */
        /** Draws inside the active window. window = 0 means "everything". */
        function windowDraws() {
            var w = store.window | 0;
            if (!w || w >= store.draws.length) return store.draws;
            return store.draws.slice(store.draws.length - w);
        }

        /**
         * Per-number counts and z-scores. Makes no assumption about board size
         * or draws-per-round — both are taken from the data.
         */
        function computeHeat(draws, spots) {
            spots = spots || 40;
            var counts = new Array(spots + 1).fill(0), total = 0, i, j;
            for (i = 0; i < draws.length; i++) {
                var d = draws[i].n;
                for (j = 0; j < d.length; j++) {
                    var v = d[j];
                    if (v >= 1 && v <= spots) { counts[v]++; total++; }
                }
            }
            var rounds = draws.length;
            var mean = spots > 0 ? total / spots : 0;
            var p = (rounds > 0 && spots > 0) ? (total / rounds) / spots : 0;
            var sd = Math.sqrt(rounds * p * (1 - p));
            var z = new Array(spots + 1).fill(0);
            if (rounds > 0 && sd > 0) {
                for (i = 1; i <= spots; i++) z[i] = (counts[i] - mean) / sd;
            }
            return { counts: counts, z: z, rounds: rounds, mean: mean, sd: sd, spots: spots, total: total };
        }

        /** Numbers ranked hottest-first (or coldest-first). Ties break by number
         *  so the ordering is stable and reproducible. */
        function ranked(heat, coldest) {
            var out = [], i;
            for (i = 1; i <= heat.spots; i++) out.push(i);
            out.sort(function (a, b) {
                var d = coldest ? (heat.counts[a] - heat.counts[b]) : (heat.counts[b] - heat.counts[a]);
                return d || (a - b);
            });
            return out;
        }

        /* ---------------------------------------------------------------
           BOARD READING
           --------------------------------------------------------------- */
        function tiles() { try { return SITE.tiles() || []; } catch (e) { return []; } }
        function boardSize() { var n = tiles().length; return n || 40; }

        /** Numbers currently showing as drawn, or null if the board isn't up. */
        function readDrawn() {
            var all = tiles(), i;
            if (!all.length) return null;
            var ctx = null;
            try { ctx = SITE.prepare(all); } catch (e) {}
            var out = [];
            for (i = 0; i < all.length; i++) {
                var hit = false;
                try { hit = SITE.isDrawn(all[i], ctx); } catch (e) {}
                if (!hit) continue;
                var n = SITE.number(all[i], i);
                if (n) out.push(n);
            }
            return out;
        }
        function currentPicks() {
            var all = tiles(), out = [], i;
            for (i = 0; i < all.length; i++) {
                var p = false;
                try { p = SITE.isPicked(all[i]); } catch (e) {}
                if (!p) continue;
                var n = SITE.number(all[i], i);
                if (n) out.push(n);
            }
            return out;
        }

        /* Reveal capture. Accumulates the union of everything that looked drawn
           since the board was last clear, then commits once the expected count
           lands or the set stops growing. Nuts needs the union because a hit
           reverts to the picked colour after flashing; Stake and Shuffle need it
           because tiles reveal one at a time. */
        var pending = [], stableTicks = 0, recorded = false;

        function commitPending() {
            if (!pending.length) return;
            var nums = pending.slice().sort(function (a, b) { return a - b; });
            pending = []; stableTicks = 0; recorded = true;
            if (nums.length > boardSize()) return;    // never record a nonsense draw
            recordDraw(nums);
            render();
            paintTiles();
        }

        function pollBoard() {
            var d = readDrawn();
            if (d == null) return;
            if (d.length === 0) {
                // Board is clear. Flush anything still pending (a reveal cleared
                // before it settled), then re-arm for the next round.
                if (!recorded && pending.length) commitPending();
                pending = []; stableTicks = 0; recorded = false;
                return;
            }
            if (recorded) return;                     // this reveal is already banked
            var grew = false, i;
            for (i = 0; i < d.length; i++) {
                if (pending.indexOf(d[i]) < 0) { pending.push(d[i]); grew = true; }
            }
            if (grew) stableTicks = 0; else stableTicks++;
            if (pending.length >= SITE.expect || stableTicks >= STABLE_TICKS) commitPending();
        }

        /* ---------------------------------------------------------------
           APPLYING PICKS
           --------------------------------------------------------------- */
        function clickTile(n) {
            var all = tiles(), i;
            for (i = 0; i < all.length; i++) {
                if (SITE.number(all[i], i) === n) {
                    if (all[i].disabled) return false;
                    all[i].click();
                    return true;
                }
            }
            return false;
        }
        function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

        /** Toggle the board to exactly `want`; only the difference is clicked. */
        var applying = false;
        async function applyNumbers(want) {
            if (applying) return;
            applying = true;
            try {
                var have = currentPicks(), i;
                for (i = 0; i < have.length; i++) {
                    if (want.indexOf(have[i]) < 0) { clickTile(have[i]); await sleep(45); }
                }
                for (i = 0; i < want.length; i++) {
                    if (have.indexOf(want[i]) < 0) { clickTile(want[i]); await sleep(45); }
                }
            } finally { applying = false; }
            render();
        }

        function applyExtreme(coldest) {
            var heat = computeHeat(windowDraws(), boardSize());
            if (!heat.rounds) { setStatus('No draws recorded yet — play a few rounds.'); return; }
            var count = Math.max(1, Math.min(MAX_PICKS, parseInt(elSpots && elSpots.value, 10) || 10));
            var pick = ranked(heat, coldest).slice(0, count).sort(function (a, b) { return a - b; });
            applyNumbers(pick);
            setStatus((coldest ? 'Coldest ' : 'Hottest ') + count + ': ' + pick.join(', '));
        }

        /* ---------------------------------------------------------------
           TILE TINTING — an absolutely-positioned, pointer-events:none child,
           so the tile stays clickable and the site's own colours read through.
           --------------------------------------------------------------- */
        function tintFor(z) {
            var a = Math.min(1, Math.abs(z) / 2.5);           // |z| >= 2.5 saturates
            if (a < 0.08) return null;                        // near-expected: leave clean
            return z > 0
                ? 'rgba(255,' + Math.round(150 - 110 * a) + ',60,' + (0.16 + 0.42 * a).toFixed(3) + ')'
                : 'rgba(60,' + Math.round(150 + 60 * a) + ',255,' + (0.14 + 0.34 * a).toFixed(3) + ')';
        }
        function clearTints() {
            var old = document.querySelectorAll('.keno-hot-tint'), i;
            for (i = 0; i < old.length; i++) old[i].remove();
        }
        function paintTiles() {
            if (!showHeat) { clearTints(); return; }
            var all = tiles();
            if (!all.length) return;
            var heat = computeHeat(windowDraws(), all.length);
            if (!heat.rounds) { clearTints(); return; }
            for (var i = 0; i < all.length; i++) {
                var btn = all[i], n = SITE.number(btn, i);
                if (!n) continue;
                var col = tintFor(heat.z[n]);
                var tint = btn.querySelector('.keno-hot-tint');
                if (!col) { if (tint) tint.remove(); continue; }
                if (!tint) {
                    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
                    tint = document.createElement('span');
                    tint.className = 'keno-hot-tint';
                    btn.appendChild(tint);
                }
                tint.style.background = col;
                tint.textContent = showCounts ? String(heat.counts[n]) : '';
            }
        }

        /* ---------------------------------------------------------------
           PANEL — the hotspot is not its own window. It mounts as a section
           inside the Keno preset panel (#keno-preset-gui) that the site's Keno
           tool builds, so there is one panel and one enable/disable toggle.
           Colours come from the host panel: --kp-accent is set per site, and
           everything else is a translucent wash over whatever background the
           host uses, so this section themes itself on Stake, Shuffle and Nuts
           without knowing anything about them.
           --------------------------------------------------------------- */
        var CSS =
            '#keno-preset-gui .kh-sect{border-top:1px solid rgba(255,255,255,.10);' +
            'margin-top:2px;padding-top:10px;display:flex;flex-direction:column;gap:8px}' +
            '#keno-preset-gui .kh-sect *{box-sizing:border-box}' +
            '#keno-preset-gui .kh-sect-head{display:flex;align-items:center;justify-content:space-between;' +
            'font-size:10px;letter-spacing:.6px;text-transform:uppercase;opacity:.65}' +
            '#keno-preset-gui .kh-sect-head b{color:var(--kp-accent,#10b981);font-weight:700}' +
            '#keno-preset-gui .kh-row{display:flex;align-items:center;justify-content:space-between;' +
            'gap:8px;font-size:11px}' +
            '#keno-preset-gui .kh-sect select,#keno-preset-gui .kh-sect input[type=number]{' +
            'background:rgba(0,0,0,.28);color:inherit;border:1px solid rgba(255,255,255,.14);' +
            'border-radius:5px;padding:3px 6px;font-size:11px;font-family:inherit}' +
            '#keno-preset-gui .kh-sect input[type=number]{width:52px;text-align:center}' +
            '#keno-preset-gui .kh-sect select:focus,#keno-preset-gui .kh-sect input:focus{' +
            'outline:none;border-color:var(--kp-accent,#10b981)}' +
            '#keno-preset-gui .kh-list{background:rgba(0,0,0,.24);border-radius:5px;padding:6px 8px;' +
            'font-size:11px;line-height:1.55}' +
            '#keno-preset-gui .kh-list b{font-variant-numeric:tabular-nums}' +
            '#keno-preset-gui .kh-hot b{color:#f87171}' +
            '#keno-preset-gui .kh-cold b{color:#60a5fa}' +
            '#keno-preset-gui .kh-k{display:block;opacity:.5;text-transform:uppercase;font-size:9px;' +
            'letter-spacing:.5px;margin-bottom:2px}' +
            '#keno-preset-gui .kh-btns{display:flex;gap:6px}' +
            '#keno-preset-gui .kh-btn{flex:1;background:rgba(255,255,255,.06);color:inherit;' +
            'border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:5px 8px;font-size:11px;' +
            'font-family:inherit;cursor:pointer}' +
            '#keno-preset-gui .kh-btn:hover{background:rgba(255,255,255,.13)}' +
            '#keno-preset-gui .kh-btn.hot:hover{border-color:#f87171;color:#fca5a5}' +
            '#keno-preset-gui .kh-btn.cold:hover{border-color:#60a5fa;color:#93c5fd}' +
            '#keno-preset-gui .kh-status{font-size:10px;opacity:.55;min-height:1.2em;line-height:1.35}' +
            '#keno-preset-gui .kh-foot{display:flex;justify-content:space-between;align-items:center;' +
            'font-size:10px;opacity:.55}' +
            '#keno-preset-gui .kh-reset{background:transparent;border:1px solid rgba(255,255,255,.14);' +
            'color:inherit;border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer;' +
            'font-family:inherit;opacity:.8}' +
            '#keno-preset-gui .kh-reset:hover{color:#f87171;border-color:#f87171;opacity:1}' +
            '.keno-hot-tint{position:absolute;inset:0;border-radius:inherit;pointer-events:none;' +
            'display:flex;align-items:center;justify-content:center;' +
            "font:800 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(255,255,255,.85);" +
            'text-shadow:0 1px 2px rgba(0,0,0,.7)}';

        function injectCss() {
            if (document.getElementById('keno-hot-css')) return;
            var viaGM = false;
            try { if (typeof GM_addStyle === 'function') { GM_addStyle(CSS); viaGM = true; } } catch (e) {}
            var marker = document.createElement(viaGM ? 'meta' : 'style');
            marker.id = 'keno-hot-css';
            if (!viaGM) marker.textContent = CSS;
            (document.head || document.documentElement).appendChild(marker);
        }

        var sect = null, elHot = null, elCold = null, elStat = null, elSpots = null, elCount = null;
        var showHeat = true, showCounts = true;
        function setStatus(t) { if (elStat) elStat.textContent = t || ''; }

        /** Where the section lives: the preset panel's content column. */
        function hostSlot() {
            var host = document.getElementById('keno-preset-gui');
            return host ? (host.querySelector('.kp-content') || host) : null;
        }

        function buildSection() {
            var el = document.createElement('div');
            el.className = 'kh-sect';
            el.innerHTML =
                '<div class="kh-sect-head"><b>Hotspot</b><span data-kh="count">0 draws</span></div>' +
                '<div class="kh-row"><span>Window</span>' +
                  '<select data-kh="window">' +
                    '<option value="50">last 50</option>' +
                    '<option value="100">last 100</option>' +
                    '<option value="250">last 250</option>' +
                    '<option value="500">last 500</option>' +
                    '<option value="0">all</option>' +
                  '</select></div>' +
                '<div class="kh-list kh-hot"><span class="kh-k">Hottest</span><span data-kh="hot">—</span></div>' +
                '<div class="kh-list kh-cold"><span class="kh-k">Coldest</span><span data-kh="cold">—</span></div>' +
                '<div class="kh-row"><span>Spots to pick</span>' +
                  '<input type="number" min="1" max="' + MAX_PICKS + '" value="10" data-kh="spots"></div>' +
                '<div class="kh-btns">' +
                  '<button class="kh-btn hot" type="button" data-kh="pick-hot">Pick hottest</button>' +
                  '<button class="kh-btn cold" type="button" data-kh="pick-cold">Pick coldest</button>' +
                '</div>' +
                '<div class="kh-row"><label style="display:flex;align-items:center;gap:5px;cursor:pointer">' +
                  '<input type="checkbox" data-kh="heat" checked>Heatmap</label>' +
                  '<label style="display:flex;align-items:center;gap:5px;cursor:pointer">' +
                  '<input type="checkbox" data-kh="counts" checked>Counts</label></div>' +
                '<div class="kh-status"></div>' +
                '<div class="kh-foot"><span>v' + KH_VERSION + '</span>' +
                  '<button class="kh-reset" type="button" data-kh="reset">Reset draws</button></div>';

            elHot   = el.querySelector('[data-kh="hot"]');
            elCold  = el.querySelector('[data-kh="cold"]');
            elStat  = el.querySelector('.kh-status');
            elSpots = el.querySelector('[data-kh="spots"]');
            elCount = el.querySelector('[data-kh="count"]');

            var sel = el.querySelector('[data-kh="window"]');
            sel.value = String(store.window);
            sel.addEventListener('change', function () {
                store.window = parseInt(sel.value, 10) || 0;
                saveStore(); render(); paintTiles();
            });
            el.querySelector('[data-kh="pick-hot"]').addEventListener('click', function () { applyExtreme(false); });
            el.querySelector('[data-kh="pick-cold"]').addEventListener('click', function () { applyExtreme(true); });
            el.querySelector('[data-kh="heat"]').addEventListener('change', function (e) { showHeat = e.target.checked; paintTiles(); });
            el.querySelector('[data-kh="counts"]').addEventListener('change', function (e) { showCounts = e.target.checked; paintTiles(); });
            el.querySelector('[data-kh="reset"]').addEventListener('click', function () {
                if (confirm('Clear all recorded ' + SITE.label + ' Keno draws?')) resetStore();
            });
            return el;
        }

        /** "7 +2.1σ" entries for the top/bottom of the ranking. */
        function listHtml(heat, coldest) {
            if (!heat.rounds) return '—';
            return ranked(heat, coldest).slice(0, 6).map(function (n) {
                var z = heat.z[n];
                var sig = (z >= 0 ? '+' : '−') + Math.abs(z).toFixed(1);
                return '<b>' + n + '</b> <span style="opacity:.55">' + sig + 'σ</span>';
            }).join('  ');
        }

        function render() {
            if (!sect || !sect.isConnected) return;
            var heat = computeHeat(windowDraws(), boardSize());
            elHot.innerHTML = listHtml(heat, false);
            elCold.innerHTML = listHtml(heat, true);
            elCount.textContent = store.draws.length + ' draw' + (store.draws.length === 1 ? '' : 's') +
                (heat.rounds !== store.draws.length ? ' (' + heat.rounds + ' in window)' : '');
        }

        /* ---------------------------------------------------------------
           TICKER — mount, poll, repaint. A bad tick must never kill the loop.
           The host panel is rebuilt on SPA navigation, so re-appending when the
           section loses its parent is the normal path, not an error case.
           --------------------------------------------------------------- */
        setInterval(function () {
            try {
                if (!onPage() || !khEnabled()) {
                    if (sect && sect.parentNode) sect.remove();
                    clearTints();
                    return;
                }
                injectCss();
                var slot = hostSlot();
                if (!slot) return;                      // Keno panel not up yet
                if (!sect) sect = buildSection();
                if (sect.parentNode !== slot) { slot.appendChild(sect); render(); }
                pollBoard();
                paintTiles();
            } catch (e) { /* never let one tick kill the ticker */ }
        }, POLL_MS);

        console.log('%c[Keno Hotspot] v' + KH_VERSION + ' on ' + SITE.label + ' — ' +
                    store.draws.length + ' draws stored', 'color:#f87171;font-weight:700');
    }
    /* === end body: keno-hotspot === */

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


    console.log('%c[Nuts Keno — Desktop] loaded (' + TOOLS.length + ' tool slot(s)). Click \u2699 to toggle.', 'color:#8bc34a;font-weight:700;');
})();
