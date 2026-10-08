// ==UserScript==
// @name         API Dash
// @namespace    apidash
// @version      1.0.7
// @description  Loads your licensed API Dash dashboard on stake.us, stake.com and nuts.gg - made for phones (Safari + Userscripts, Firefox + Violentmonkey).
// @match        https://stake.us/*
// @match        https://*.stake.us/*
// @match        https://stake.com/*
// @match        https://*.stake.com/*
// @match        https://nuts.gg/*
// @match        https://*.nuts.gg/*
// @match        https://apidash-licences.apidash.workers.dev/buy*
// @run-at       document-idle
// @noframes
// @inject-into  content
// @sandbox      DOM
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.registerMenuCommand
// @grant        GM_registerMenuCommand
// @connect      apidash-licences.apidash.workers.dev
// @updateURL    https://whaklgjndo.github.io/gambling-tools-site/api-dash/apidash-loader.user.js
// @downloadURL  https://whaklgjndo.github.io/gambling-tools-site/api-dash/apidash-loader.user.js
// ==/UserScript==

// THE PHONE LOADER. The Desktop App's job, done by a userscript, for phones.
//
// It holds NO dashboard. It asks the licence server for this site's dashboard
// with the buyer's key, the same /v1/dashboard call the Desktop App makes, and
// runs what comes back in the page - so the file a buyer installs is worth
// nothing without a key that is paid for, and the dashboard is never saved on
// the phone: it is fetched on every page load and lives in that page only.
//
// WHY A USERSCRIPT AND NOT AN APP on iPhone (owner, 2026-10-02): the App Store
// takes real-money gambling apps only from licensed operators, and TestFlight
// is for testing, not selling. A userscript manager is an ordinary approved
// app; this file is a script it runs on the casino's own page.
//
// WHAT IT CANNOT STOP, honestly: the dashboard has to be readable to run, so
// someone with a Mac's Web Inspector attached to their iPhone can read it out
// of the page. That is the same line the Desktop App draws (Dashboards.cs):
// this stops one buyer handing a file to everybody else, not a debugger.
//
// THE HEADER, checked against each manager's source (2026-10-02). Every
// manager skips header lines it does not know, so each line is for someone:
// - @inject-into content: Userscripts and Violentmonkey run the loader in the
//   extension's sandbox, where the GM functions are. @sandbox DOM asks
//   Tampermonkey for the same; without it Tampermonkey runs scripts in the
//   page itself.
// - Both the GM.* and GM_* @grant lines: Userscripts has only GM.* (and no
//   menu), and quietly drops grants it does not know (Functions.swift
//   validGrants), so the extra lines cost nothing there and help elsewhere.
// - @connect: Tampermonkey asks the person before a request to a host not
//   listed here. The others ignore it.
// - https://*.stake.us/* already covers stake.us itself in every manager; the
//   plain lines stay so the list reads plainly.
// - The licence server's /buy is the store (owner, 2026-10-03). The loader
//   runs there only to hand the store the key it holds - see "the store".

(function () {
    'use strict';

    // One host, written here. Pointing a copy of this file at another server
    // gets that server's code, not ours - there is nothing on ours to take
    // without a key.
    var SERVER = 'https://apidash-licences.apidash.workers.dev';
    var STORE = SERVER + '/buy';
    var APP = 'phone-loader 1.0.7';

    // The same three sites, matched the same way, as the Desktop App's
    // Sites.cs: the host itself or a subdomain of it, so the stake.com build
    // can never land on stake.us.
    var SITES = [
        { key: 'com', label: 'stake.com', host: 'stake.com', accent: '#1475e1' },
        { key: 'us', label: 'stake.us', host: 'stake.us', accent: '#1475e1' },
        { key: 'nuts', label: 'nuts.gg', host: 'nuts.gg', accent: '#7165f2' },
    ];

    if (window.top !== window.self) return;
    var host = location.hostname.toLowerCase();
    var onStore = location.origin === SERVER && location.pathname.indexOf('/buy') === 0;
    var site = SITES.filter(function (s) { return host === s.host || host.slice(-(s.host.length + 1)) === '.' + s.host; })[0];
    if (!site && !onStore) return;

    // ---- the userscript manager -------------------------------------------------
    // GM.* where the manager has it (Userscripts, Violentmonkey, Tampermonkey
    // all do), the older GM_* where it does not. Userscripts keeps these values
    // under the script's FILE NAME, so a copy saved under another name starts
    // with no key and a new device id - the README says so.
    var G = (typeof GM !== 'undefined' && GM) || {};
    // Which manager this is, for messages only: 'Userscripts' on iPhone.
    function handler() {
        try {
            var info = G.info || (typeof GM_info !== 'undefined' ? GM_info : null);
            return String((info && info.scriptHandler) || '');
        } catch (e) { return ''; }
    }
    function getValue(k, d) {
        try {
            if (G.getValue) return Promise.resolve(G.getValue(k, d));
            if (typeof GM_getValue === 'function') return Promise.resolve(GM_getValue(k, d));
        } catch (e) { /* fall through */ }
        return Promise.resolve(d);
    }
    function setValue(k, v) {
        try {
            if (G.setValue) return Promise.resolve(G.setValue(k, v));
            if (typeof GM_setValue === 'function') return Promise.resolve(GM_setValue(k, v));
        } catch (e) { /* fall through */ }
        return Promise.resolve();
    }
    // Userscripts (iPhone) has no menu yet (its issue #230), so there the
    // #apidash-key address is the only way to the key box. That is enough.
    function menu(label, fn) {
        try {
            if (G.registerMenuCommand) G.registerMenuCommand(label, fn);
            else if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
        } catch (e) { /* the #apidash-key address still works */ }
    }
    // The licence server is another host, so the request goes through the
    // manager rather than the page: no CORS, and nothing on the page sees it.
    // (In Safari that holds only where the person has allowed Userscripts on
    // the server's address too - see the "could not reach" message below.)
    //
    // Written to hold across the three managers:
    // - called AS A METHOD of GM, never lifted off it: Violentmonkey binds its
    //   functions, but Tampermonkey's source is closed, so no bet on it.
    // - the answer is read from responseText, else from response: Userscripts
    //   fills responseText only for text answers (its api.js), and a manager
    //   that parsed the JSON itself hands over an object.
    // - settled ONCE, by whichever comes first: onload, onerror, ontimeout,
    //   onabort, the promise GM.xmlHttpRequest returns, or our own clock.
    //   Userscripts sends the request without waiting to hear it was taken,
    //   and iOS may stop the extension's background page, so a request can
    //   end with no call at all; the clock turns that into "could not reach"
    //   rather than a pill that says Loading forever.
    var WAIT = 45000;
    function post(path, body) {
        return new Promise(function (resolve) {
            var settled = false, clock = null;
            function finish(r) {
                if (settled) return;
                settled = true;
                clearTimeout(clock);
                resolve(r);
            }
            function unreachable() { finish({ status: 0 }); }
            function answer(r) {
                if (!r) { unreachable(); return; }
                var text = null, json = null;
                try { text = r.responseText; } catch (e) { /* a getter that throws for non-text */ }
                if (typeof text !== 'string' || !text) text = r.response;
                if (text && typeof text === 'object') json = text;
                else { try { json = JSON.parse(text); } catch (e) { /* not ours */ } }
                var status = Number(r.status) || 0;
                if (!status && json) status = 200;
                finish({ status: status, json: json });
            }
            var details = {
                method: 'POST', url: SERVER + path, timeout: WAIT,
                headers: { 'content-type': 'application/json' },
                data: JSON.stringify(body),
                onload: answer,
                onerror: unreachable,
                ontimeout: unreachable,
                onabort: unreachable,
            };
            var ret;
            try {
                if (G.xmlHttpRequest) ret = G.xmlHttpRequest(details);
                else if (typeof GM_xmlhttpRequest === 'function') ret = GM_xmlhttpRequest(details);
                else { finish({ status: -1 }); return; }
            } catch (e) { unreachable(); return; }
            // Also takes the rejection, so a failed request is not reported
            // as an unhandled error in Violentmonkey and Tampermonkey. A
            // promise that settles with nothing is left to the callbacks.
            if (ret && typeof ret.then === 'function') ret.then(function (r) { if (r) answer(r); }, unreachable);
            clock = setTimeout(unreachable, WAIT + 15000);
        });
    }

    // ---- which phone this is ----------------------------------------------------
    // The server binds a key to ONE device. A userscript cannot read anything
    // about the phone, so the device is a random id made once and kept in the
    // manager's own storage. Deleting the manager app loses it, and the key
    // then needs the admin panel's Unbind - the README says so.
    //
    // KEPT TWICE since 1.0.7: in the manager's storage AND in this site's own
    // storage (localStorage, which the manager's sandbox shares with the
    // page). A customer's iPad, low on space, had iOS clear Userscripts'
    // storage whenever Safari was quit: a new id every launch, and "already
    // in use on another computer" every time. Whichever copy survives puts
    // the other back, so the id only changes if both are lost together.
    var DEVICE_KEY = '__apidashDevice';
    var DEVICE_OK = /^[0-9a-f]{16}$/;
    function siteDevice() {
        try { return localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { return ''; }
    }
    function keepOnSite(d) {
        try { if (localStorage.getItem(DEVICE_KEY) !== d) localStorage.setItem(DEVICE_KEY, d); } catch (e) { /* storage blocked: the manager's copy stands */ }
    }
    function deviceId() {
        return getValue('device', '').then(function (d) {
            if (DEVICE_OK.test(d)) { keepOnSite(d); return d; }
            var kept = siteDevice();
            if (DEVICE_OK.test(kept)) return setValue('device', kept).then(function () { return kept; });
            var b = new Uint8Array(8);
            crypto.getRandomValues(b);
            d = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
            keepOnSite(d);
            return setValue('device', d).then(function () { return d; });
        });
    }

    // ---- running the dashboard in the page ----------------------------------------
    // The loader runs in the manager's sandbox; the dashboard must run in the
    // PAGE, where the userscripts always ran (@grant none), so it rides the
    // page's own session. A script element is how - the same thing
    // Tampermonkey does. stake.us's CSP is report-only and nuts.gg sends none
    // (Desktop App, SiteWindow.cs), so neither blocks it; if that changes the
    // check below says so rather than leaving a page with no dashboard.
    // Safari too (WebKit ScriptElement.cpp, ScriptController.cpp): an inline
    // script added by code runs DURING the append, in the page's own world,
    // whichever world added it - so the attribute read straight after works.
    // It is also how Userscripts itself runs @inject-into page scripts.
    var root = document.documentElement;
    function pageRun(text) {
        var s = document.createElement('script');
        s.textContent = text;
        (document.head || root).appendChild(s);
        s.remove();
    }
    // What the page says about itself, carried back on an attribute: the
    // sandbox cannot read the page's globals, but both see the same DOM.
    function pageAsk(expr) {
        pageRun("document.documentElement.setAttribute('data-apidash-ask',String((function(){try{return " + expr + "}catch(e){return ''}})()))");
        var v = root.getAttribute('data-apidash-ask') || '';
        root.removeAttribute('data-apidash-ask');
        return v;
    }
    function mountedVersion() { return pageAsk("(self.ApiMode&&self.ApiMode.version)?self.ApiMode.version:''"); }

    // ---- this site's time, for the panel ----------------------------------------------
    // Owner, 2026-10-03: users see their time, and add to it, in the apps. The
    // panel reads window.ApiDashHost: `end` - when this site's time runs out
    // (ISO; null for never) - and `addTime`, which here opens the store in a new
    // tab. The KEY is not in it: the store gets the key from this loader, on
    // the store's own page, never from the casino's.
    function hostSet(end) {
        pageRun('(function(){var h=window.ApiDashHost;if(!h||typeof h!=="object"){h=window.ApiDashHost={};}' +
            'h.site=' + JSON.stringify(site.key) + ';' +
            'h.end=' + (end === undefined ? 'undefined' : JSON.stringify(end)) + ';' +
            'h.addTime=function(){window.open(' + JSON.stringify(STORE) + ',"_blank")};})()');
    }
    function endFrom(ends) {
        return ends && typeof ends === 'object' && site.key in ends ? ends[site.key] : undefined;
    }

    function inject(code) {
        if (mountedVersion()) return { ok: true, said: 'already on this page' };
        // The first error the dashboard throws while it starts, kept for the
        // message - a dashboard that did not appear looks the same from outside
        // whatever the reason.
        pageRun("window.__apidashErr=function(e){document.documentElement.setAttribute('data-apidash-err',String((e&&e.message)||'error'))};" +
                "window.addEventListener('error',window.__apidashErr)");
        var ranMark = 'data-apidash-ran';
        root.removeAttribute(ranMark);
        // The run-state mirror rides in this same script element (see "who
        // is live"), so check-ins never need a script element of their own.
        pageRun(code + "\n;document.documentElement.setAttribute('" + ranMark + "','1');" + RUN_MIRROR);
        pageRun("window.removeEventListener('error',window.__apidashErr);delete window.__apidashErr;");
        var ran = root.getAttribute(ranMark) === '1';
        var err = root.getAttribute('data-apidash-err');
        root.removeAttribute(ranMark);
        root.removeAttribute('data-apidash-err');
        var v = mountedVersion();
        if (v) return { ok: true, said: 'v' + v + ' ready' };
        if (err) return { ok: false, said: 'The dashboard stopped while starting: ' + err };
        if (!ran) return { ok: false, said: 'This page refused to run the dashboard. Send us a screenshot of this.' };
        return { ok: false, said: 'The dashboard ran but did not appear. Reload the page.' };
    }

    // ---- what the person sees -------------------------------------------------------
    // In its own shadow root, so the casino's styles cannot reach it and its
    // styles cannot reach the casino. Gone once the dashboard is up.
    var ui = null;
    function shell() {
        if (ui) return ui;
        var host = document.createElement('div');
        host.setAttribute('data-apidash-loader', '');
        host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
        var sh = host.attachShadow({ mode: 'closed' });
        sh.innerHTML =
            '<style>' +
            '*{box-sizing:border-box;margin:0;font-family:-apple-system,system-ui,sans-serif}' +
            '.pill{position:absolute;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);max-width:calc(100% - 24px);' +
            'display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:#172b39;color:#ecf3f9;' +
            'border:1px solid #3e586c;font-size:13px;font-weight:700;box-shadow:0 6px 20px rgba(0,0,0,.45);pointer-events:auto}' +
            '.pill.bad{border-color:#e9113c}.pill button{background:none;border:0;color:#a1bfd6;font-size:16px;padding:0 0 0 4px;cursor:pointer}' +
            '.dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--a)}' +
            '.scrim{position:absolute;inset:0;background:rgba(4,12,18,.62);pointer-events:auto;display:flex;align-items:flex-end}' +
            '.card{width:100%;background:#172b39;color:#ecf3f9;border-top:2px solid var(--a);border-radius:16px 16px 0 0;' +
            'padding:18px 16px max(18px,env(safe-area-inset-bottom))}' +
            'h1{font-size:15px;font-weight:900;letter-spacing:.02em;text-transform:uppercase;color:#4a97ec}' +
            'p{font-size:14px;line-height:1.5;margin-top:8px;color:#ecf3f9}p.dim{color:#a1bfd6;font-size:12.5px}p.bad{color:#ff6b7f;font-weight:700}' +
            'label{display:block;font-size:10.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#a1bfd6;margin:14px 0 6px}' +
            'input{width:100%;height:46px;background:#0e202d;color:#ecf3f9;border:1px solid #3e586c;border-radius:4px;padding:0 12px;' +
            'font-size:16px;font-family:ui-monospace,Menlo,monospace}input:focus{outline:none;border-color:#1475e1}' +
            '.row{display:flex;gap:8px;margin-top:14px}' +
            '.btn{flex:1;min-height:48px;border-radius:999px;border:1px solid #3e586c;background:transparent;color:#ecf3f9;' +
            'font-weight:800;font-size:12px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer}' +
            '.pri{background:#1475e1;border-color:#1475e1;color:#fff;flex:1.4}' +
            'a.btn{display:flex;align-items:center;justify-content:center;text-decoration:none}' +
            '.alt{text-align:center;margin-top:14px;font-size:13px;color:#a1bfd6}' +
            '.alt a,.alt button{color:#4a97ec;font-weight:800;font-size:13px;background:none;border:0;padding:4px;' +
            'text-decoration:underline;cursor:pointer}' +
            '</style><div class="pill" hidden></div><div class="scrim" hidden></div>';
        (document.body || root).appendChild(host);
        ui = { host: host, pill: sh.querySelector('.pill'), scrim: sh.querySelector('.scrim') };
        host.style.setProperty('--a', site.accent);
        sh.querySelector('.pill').style.setProperty('--a', site.accent);
        sh.querySelector('.scrim').style.setProperty('--a', site.accent);
        return ui;
    }
    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    var pillTimer = null;
    function say(text, bad, hideAfter) {
        var u = shell();
        clearTimeout(pillTimer);
        u.pill.textContent = '';
        u.pill.className = 'pill' + (bad ? ' bad' : '');
        u.pill.appendChild(el('span', 'dot'));
        u.pill.appendChild(el('span', null, text));
        var x = el('button', null, '✕');
        x.setAttribute('aria-label', 'Dismiss');
        x.onclick = function () { u.pill.hidden = true; };
        u.pill.appendChild(x);
        u.pill.hidden = false;
        // A message that goes by itself takes the whole layer with it when
        // nothing else is showing, so nothing of the loader stays on the page.
        if (hideAfter) pillTimer = setTimeout(function () {
            u.pill.hidden = true;
            if (ui === u && u.scrim.hidden) { u.host.remove(); ui = null; }
        }, hideAfter);
    }
    // The key box, as a sheet from the bottom. Resolves with the key saved, or
    // null for Not now.
    function askKey(message, isProblem) {
        return new Promise(function (resolve) {
            var u = shell();
            u.pill.hidden = true;
            u.scrim.textContent = '';
            var card = el('div', 'card');
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-label', 'API Dash licence key');
            card.appendChild(el('h1', null, 'API Dash · ' + site.label));
            card.appendChild(el('p', isProblem ? 'bad' : null, message));
            var lab = el('label', null, 'Licence key');
            var inp = el('input');
            inp.id = 'apidash-key';
            lab.htmlFor = 'apidash-key';
            inp.setAttribute('autocomplete', 'off');
            inp.setAttribute('autocapitalize', 'off');
            inp.setAttribute('autocorrect', 'off');
            inp.setAttribute('spellcheck', 'false');
            inp.placeholder = 'Paste the key you were sent';
            card.appendChild(lab);
            card.appendChild(inp);
            card.appendChild(el('p', 'dim', 'The key is kept in your userscript app on this phone. It works on one device - ask us to move it if you change phones.'));
            var row = el('div', 'row');
            var later = el('button', 'btn', 'Not now');
            var save = el('button', 'btn pri', 'Save key');
            row.appendChild(later);
            row.appendChild(save);
            card.appendChild(row);
            // No key yet: the store sells one, with time for the sites wanted.
            var alt = el('p', 'alt', 'No key yet? ');
            alt.appendChild(storeLink('a', 'Buy one'));
            card.appendChild(alt);
            u.scrim.appendChild(card);
            u.scrim.hidden = false;
            function done(v) { u.scrim.hidden = true; u.scrim.textContent = ''; resolve(v); }
            later.onclick = function () { done(null); };
            save.onclick = function () {
                var k = inp.value.trim();
                if (!k) { inp.focus(); return; }
                setValue('key', k).then(function () { done(k); });
            };
            inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') save.click(); });
            setTimeout(function () { inp.focus(); }, 50);
        });
    }

    // The way to the store: a real link, opened in a new tab. A link the
    // person tapped is never stopped by Safari's pop-up blocker, which a
    // window.open from code can be. The store then gets the key from this
    // loader, on the store's own page (see "the store").
    function storeLink(cls, text) {
        var a = el('a', cls, text);
        a.href = STORE;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
    }

    // No time on this site, or it ran out (owner, 2026-10-04: "the ios version
    // doesn't have an option to buy time"). The KEY is fine here, so the answer
    // is the store, not the key box - which is what this used to show, with
    // the refusal above a box asking for a new key. Coming back to this tab
    // with time bought loads the dashboard by itself.
    //
    // Resolves 'load' once the site has time, 'key' for "Use a different key",
    // or null for Not now.
    function askTime(message, hasTime) {
        return new Promise(function (resolve) {
            var u = shell();
            u.pill.hidden = true;
            u.scrim.textContent = '';
            var card = el('div', 'card');
            card.setAttribute('role', 'dialog');
            card.setAttribute('aria-label', 'API Dash time on ' + site.label);
            card.appendChild(el('h1', null, 'API Dash · ' + site.label));
            card.appendChild(el('p', 'bad', message));
            card.appendChild(el('p', 'dim', 'Time is bought for each site, in hours. The store opens in a new tab ' +
                'with your key already in it. Come back to this tab once you have paid.'));
            var row = el('div', 'row');
            var later = el('button', 'btn', 'Not now');
            row.appendChild(later);
            row.appendChild(storeLink('btn pri', 'Add time'));
            card.appendChild(row);
            var alt = el('p', 'alt');
            var other = el('button', null, 'Use a different key');
            alt.appendChild(other);
            card.appendChild(alt);
            u.scrim.appendChild(card);
            u.scrim.hidden = false;
            var asking = false;
            function back() {
                if (document.visibilityState !== 'visible' || asking) return;
                asking = true;
                hasTime().then(function (yes) { asking = false; if (yes) done('load'); });
            }
            function done(v) {
                document.removeEventListener('visibilitychange', back);
                u.scrim.hidden = true;
                u.scrim.textContent = '';
                resolve(v);
            }
            document.addEventListener('visibilitychange', back);
            later.onclick = function () { done(null); };
            other.onclick = function () { done('key'); };
        });
    }

    // ---- the whole job ---------------------------------------------------------------
    function load(key, device, tries) {
        say('Loading the ' + site.label + ' dashboard…');
        return post('/v1/dashboard', { key: key, device: device, site: site.key, app: APP }).then(function (r) {
            if (r.status === -1) {
                say('Your userscript app cannot reach the licence server. Use Userscripts (iPhone) or Violentmonkey (Android).', true);
                return;
            }
            if (r.status === 0) {
                // On iPhone the usual cause is not the connection: Safari lets
                // Userscripts reach another website only where the person has
                // allowed it (Userscripts issue #897), and the licence server
                // is another website. The server sends no CORS headers, so
                // allowing just the casino is not enough.
                say(handler() === 'Userscripts'
                    ? 'Could not reach the licence server. Check your connection, and that Safari allows Userscripts on All Websites (Settings > Apps > Safari > Extensions > Userscripts). Then reload.'
                    : 'Could not reach the licence server. Check your connection, then reload the page.', true);
                return;
            }
            var j = r.json || {};
            if (j.error) {
                // Refused. Either the key is the problem, or the key is fine
                // and this site has no time on it - and the server's licence
                // answer says which: it is a 200 for a good key whatever its
                // time. A server problem gets neither box - a new key would not
                // help.
                if (r.status === 403 && tries < 3) {
                    return post('/v1/licence', { key: key, device: device, app: APP }).then(function (lr) {
                        var lic = lr.status === 200 && lr.json && !lr.json.error ? lr.json : null;
                        if (lic) return noTime(key, device, tries, lic, j.error);
                        return askKey(j.error, true).then(function (k) {
                            if (k) return load(k, device, tries + 1);
                            say(j.error, true);
                        });
                    });
                }
                say(j.error, true);
                return;
            }
            if (!j.code) { say('The licence server sent no dashboard. Reload the page in a minute.', true); return; }
            var got = inject(j.code);
            if (got.ok) {
                hostSet(endFrom(j.ends));
                watchTime(key, device);
                goLive(key, device);
                say('API Dash ' + got.said, false, 2500);
            } else {
                say(got.said, true);
            }
        });
    }

    // A good key with no time on this site. The sheet offers the store; time
    // bought there loads the dashboard as soon as this tab is looked at again.
    function noTime(key, device, tries, lic, said) {
        var covers = function (l) { return !!(l && l.sites && l.sites.indexOf(site.key) >= 0); };
        // Time arrived between the two questions: just load.
        if (covers(lic)) return load(key, device, tries + 1);
        // Ran out: the server's sentence, which says when. Never had any: ours.
        var message = endFrom(lic.ends) ? said : 'There is no ' + site.label + ' time on this key yet. Add time to play it.';
        var hasTime = function () {
            return post('/v1/licence', { key: key, device: device, app: APP }).then(function (r) {
                return r.status === 200 && covers(r.json);
            });
        };
        return askTime(message, hasTime).then(function (next) {
            if (next === 'load') return load(key, device, tries + 1);
            if (next === 'key') {
                return askKey('Paste the key to use on this phone instead.', false).then(function (k) {
                    if (k) return load(k, device, tries + 1);
                    say(message, true);
                });
            }
            say('No ' + site.label + ' time on this key. Reload the page to add some.', false, 8000);
        });
    }

    // Coming back to this tab - from the store, most likely - asks the server
    // for the time again, so hours just bought show at once. At most every
    // 20 seconds, and never while the tab is out of sight.
    var watching = false, askedAt = 0;
    function watchTime(key, device) {
        if (watching) return;
        watching = true;
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible' || Date.now() - askedAt < 20000) return;
            askedAt = Date.now();
            post('/v1/licence', { key: key, device: device, app: APP }).then(function (r) {
                if (r.status === 200 && r.json && r.json.ends) hostSet(endFrom(r.json.ends));
            });
        });
    }

    // ---- session check-in ----------------------------------------------------------
    // While a dashboard is open, the loader checks in with the licence server
    // (/v1/live): once when it is up, then every `every` seconds the server
    // names while the page is on screen, and once more ("gone") when the page
    // closes.
    //
    // - What is sent: the key and device (as with every licence call), the
    //   site, the loader's version, whether a run is going, whether it is
    //   simulated, and whether the page is on screen. Nothing else - no
    //   balance, bet, account or address.
    // - Sent by post(), through the manager, like every licence call; never
    //   from the page itself.
    // - The two run facts come from a small mirror set up once, inside the
    //   dashboard's own script element (inject): it copies ApiMode.engine's
    //   running and simulated, with the time, into one attribute on <html> -
    //   at once, every 5 s, and whenever the page is hidden or shown (iOS
    //   stops a hidden page's timers). The loader only reads the attribute;
    //   missing, or older than 15 s, reads as not running, not simulated. No
    //   further script element is ever added for it.
    // - Silent: it shows nothing, waits on nothing and throws nothing.
    //   Anything but a 200 - a refused key or device (403), a bad request
    //   (400), a server without /v1/live (404), no connection - ends it for
    //   this page; the next page load starts it again.
    // - Hidden: one check-in says so, and the clock stops. Shown again: one
    //   goes at once and the clock restarts. A page Safari brings back (back,
    //   forward) starts again as if just opened.
    // - One at a time, in order, so "gone" is always the last thing sent: a
    //   check-in starts only once the one before has answered or failed, and
    //   at most one waits behind it. (A page that closes with one in flight
    //   takes the waiting "gone" with it; the server times it out.)
    // - One clock per page: cleared whenever a check-in is asked for, set only
    //   by an answer with nothing waiting.
    var RUN_ATTR = 'data-apidash-run';
    var RUN_EVERY = 5, RUN_STALE = 15;   // seconds
    var RUN_MIRROR = "\n;(function(){try{var m=function(){try{var e=self.ApiMode&&self.ApiMode.engine;" +
        "document.documentElement.setAttribute('" + RUN_ATTR + "',(e&&e.running?1:0)+','+(e&&e.simulated?1:0)+','+Date.now())}catch(x){}};" +
        "m();setInterval(m," + RUN_EVERY * 1000 + ");" +
        "document.addEventListener('visibilitychange',m);addEventListener('pageshow',m)}catch(x){}})();";
    var live = null;
    function liveState() {
        var v = String(root.getAttribute(RUN_ATTR) || '').split(',');
        var fresh = v.length === 3 && Math.abs(Date.now() - Number(v[2])) <= RUN_STALE * 1000;
        return { running: fresh && v[0] === '1', sim: fresh && v[1] === '1' };
    }
    function liveEnd() {
        if (!live) return;
        live.over = true;
        clearTimeout(live.timer);
        live.timer = null;
    }
    function liveNext() {
        clearTimeout(live.timer);
        live.timer = null;
        if (live.over || live.gone || document.visibilityState !== 'visible') return;
        live.timer = setTimeout(function () { checkIn(false); }, live.every * 1000);
    }
    function checkIn(gone) {
        if (!live || live.over) return;
        clearTimeout(live.timer);
        live.timer = null;
        if (gone) live.gone = true;
        if (live.waiting) { live.waiting.gone = !!gone; return; }
        var w = live.waiting = { gone: !!gone };
        function go() { live.waiting = null; return send(w.gone); }
        // Whatever throws or rejects anywhere in a check-in ends here, quietly.
        live.chain = live.chain.then(go).then(null, liveEnd);
    }
    function send(gone) {
        if (live.over) return null;
        var st = liveState();
        var body = { key: live.key, device: live.device, site: site.key, app: APP,
            running: st.running, sim: st.sim, visible: document.visibilityState === 'visible' };
        if (gone) body.gone = true;
        return post('/v1/live', body).then(function (r) {
            if (r.status !== 200) { liveEnd(); return; }
            // Seconds, 30 to 600; 60 when the answer does not say.
            var e = Number(r.json && r.json.every);
            live.every = e > 0 ? Math.min(600, Math.max(30, e)) : 60;
            if (!live.waiting) liveNext();
        });
    }
    function goLive(key, device) {
        // Loaded again on the same page (a key changed from the menu): the
        // clock already running carries on, with that key.
        if (live) { live.key = key; live.device = device; return; }
        live = { key: key, device: device, every: 60, timer: null, over: false, gone: false,
            chain: Promise.resolve(), waiting: null };
        document.addEventListener('visibilitychange', function () { if (!live.gone) checkIn(false); });
        window.addEventListener('pagehide', function () { checkIn(true); });
        window.addEventListener('pageshow', function (e) {
            if (e.persisted && live.gone) { live.gone = false; checkIn(false); }
        });
        checkIn(false);
    }

    function start(forceKeyBox) {
        Promise.all([getValue('key', ''), deviceId()]).then(function (got) {
            var key = String(got[0] || '').trim(), device = got[1];
            if (!key || forceKeyBox) {
                return askKey(key ? 'Paste a new key to replace the one on this phone.' : 'Paste the licence key you were sent to put the dashboard on ' + site.label + '.', false)
                    .then(function (k) {
                        if (k) return load(k, device, 0);
                        if (key && forceKeyBox) return load(key, device, 0);
                        say('No key yet. Open ' + site.label + '/#apidash-key to add one.', false, 6000);
                    });
            }
            return load(key, device, 0);
        }).catch(function (e) { say('The loader stopped: ' + (e && e.message), true); });
    }

    // ---- the store ----------------------------------------------------------------
    // On the store's own page, the loader hands it the key it already holds,
    // so the buyer never retypes it (store.html's window.apidashUseKey). Never
    // in the address: an address is kept in history, and this key alone can
    // move the licence to another phone. Nothing else happens here.
    if (onStore) {
        getValue('key', '').then(function (k) {
            k = String(k || '').trim();
            if (k) pageRun('window.apidashUseKey&&window.apidashUseKey(' + JSON.stringify(k) + ')');
        });
        return;
    }

    // Changing the key: the manager's own menu where it has one, and an
    // address that works everywhere - stake.us/#apidash-key.
    menu('Change licence key', function () { start(true); });
    // Where the manager has a menu (not Userscripts yet); on iPhone the sheets
    // and the panel's Add time are the way to the store.
    menu('Buy a key or add time', function () { window.open(STORE, '_blank'); });
    start(/(^|[#&])apidash-key\b/.test(location.hash));
})();
