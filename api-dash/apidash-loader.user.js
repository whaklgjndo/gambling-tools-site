// ==UserScript==
// @name         API Dash
// @namespace    apidash
// @version      1.0.14
// @description  Loads your licensed API Dash dashboard on stake.us, stake.com, nuts.gg, winna.com and rainbet.com - made for phones (Safari + Userscripts, Firefox + Violentmonkey).
// @match        https://stake.us/*
// @match        https://*.stake.us/*
// @match        https://stake.com/*
// @match        https://*.stake.com/*
// @match        https://nuts.gg/*
// @match        https://*.nuts.gg/*
// @match        https://winna.com/*
// @match        https://*.winna.com/*
// @match        https://rainbet.com/*
// @match        https://*.rainbet.com/*
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

(function () {
    'use strict';

    var SERVER = 'https://apidash-licences.apidash.workers.dev';
    var STORE = SERVER + '/buy';
    var LOADER_URL = 'https://whaklgjndo.github.io/gambling-tools-site/api-dash/apidash-loader.user.js';
    var APP = 'phone-loader 1.0.14';

    var SITES = [
        { key: 'com', label: 'stake.com', host: 'stake.com', accent: '#1475e1' },
        { key: 'us', label: 'stake.us', host: 'stake.us', accent: '#1475e1' },
        { key: 'nuts', label: 'nuts.gg', host: 'nuts.gg', accent: '#7165f2' },
        { key: 'winna', label: 'winna.com', host: 'winna.com', accent: '#10abe1' },
        { key: 'rainbet', label: 'rainbet.com', host: 'rainbet.com', accent: '#1077d1' },
    ];

    if (window.top !== window.self) return;
    var host = location.hostname.toLowerCase();
    var onStore = location.origin === SERVER && location.pathname.indexOf('/buy') === 0;
    var site = SITES.filter(function (s) { return host === s.host || host.slice(-(s.host.length + 1)) === '.' + s.host; })[0];
    if (!site && !onStore) return;

    var G = (typeof GM !== 'undefined' && GM) || {};
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
        } catch (e) { }
        return Promise.resolve(d);
    }
    function setValue(k, v) {
        return new Promise(function (resolve) {
            var clock = setTimeout(function () { resolve(false); }, 4000);
            function end(ok) { clearTimeout(clock); resolve(ok); }
            try {
                var p;
                if (G.setValue) p = G.setValue(k, v);
                else if (typeof GM_setValue === 'function') p = GM_setValue(k, v);
                else { end(false); return; }
                Promise.resolve(p).then(function () { end(true); }, function () { end(false); });
            } catch (e) { end(false); }
        });
    }
    function menu(label, fn) {
        try {
            if (G.registerMenuCommand) G.registerMenuCommand(label, fn);
            else if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand(label, fn);
        } catch (e) { }
    }
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
                try { text = r.responseText; } catch (e) { }
                if (typeof text !== 'string' || !text) text = r.response;
                if (text && typeof text === 'object') json = text;
                else { try { json = JSON.parse(text); } catch (e) { } }
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
            if (ret && typeof ret.then === 'function') ret.then(function (r) { if (r) answer(r); }, unreachable);
            clock = setTimeout(unreachable, WAIT + 15000);
        });
    }

    var DEVICE_KEY = '__apidashDevice';
    var DEVICE_OK = /^[0-9a-f]{16}$/;
    function siteDevice() {
        try { return localStorage.getItem(DEVICE_KEY) || ''; } catch (e) { return ''; }
    }
    function keepOnSite(d) {
        try { if (localStorage.getItem(DEVICE_KEY) !== d) localStorage.setItem(DEVICE_KEY, d); } catch (e) { }
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

    var root = document.documentElement;
    function pageRun(text) {
        var s = document.createElement('script');
        s.textContent = text;
        (document.head || root).appendChild(s);
        s.remove();
    }
    function pageAsk(expr) {
        pageRun("document.documentElement.setAttribute('data-apidash-ask',String((function(){try{return " + expr + "}catch(e){return ''}})()))");
        var v = root.getAttribute('data-apidash-ask') || '';
        root.removeAttribute('data-apidash-ask');
        return v;
    }
    function mountedVersion() { return pageAsk("(self.ApiMode&&self.ApiMode.version)?self.ApiMode.version:''"); }

    function hostSet(end) {
        pageRun('(function(){var h=window.ApiDashHost;if(!h||typeof h!=="object"){h=window.ApiDashHost={};}' +
            'h.site=' + JSON.stringify(site.key) + ';' +
            'h.app={platform:"iphone",version:' + JSON.stringify(APP.split(' ').pop()) + '};' +
            'h.end=' + (end === undefined ? 'undefined' : JSON.stringify(end)) + ';' +
            'h.addTime=function(){window.open(' + JSON.stringify(STORE) + ',"_blank")};})()');
    }
    var FRIENDS_ASK = 'apidash-friends-ask', FRIENDS_ANSWER = 'apidash-friends-answer';
    var friendsKey = null;
    var FRIENDS_PAGE = '(function(){var h=window.ApiDashHost;if(!h||typeof h!=="object"){h=window.ApiDashHost={};}' +
        'if(h.friends)return;var n=0;' +
        'h.friends=function(what,body){return new Promise(function(res){' +
        'var id="f"+(++n)+"."+Date.now();' +
        'function on(e){var d;try{d=JSON.parse(e.detail)}catch(x){return}if(!d||d.id!==id)return;' +
        'document.removeEventListener("' + FRIENDS_ANSWER + '",on);res({status:d.status,body:d.body||{}})}' +
        'document.addEventListener("' + FRIENDS_ANSWER + '",on);' +
        'document.dispatchEvent(new CustomEvent("' + FRIENDS_ASK + '",' +
        '{detail:JSON.stringify({id:id,what:String(what),body:body||{}})}))})}})()';
    function friendsOn(key, device) {
        var first = !friendsKey;
        friendsKey = { key: key, device: device };
        pageRun(FRIENDS_PAGE);
        if (!first) return;
        document.addEventListener(FRIENDS_ASK, function (e) {
            var d = null;
            try { d = JSON.parse(String(e.detail)); } catch (x) { return; }
            if (!d || typeof d.id !== 'string' || !/^[a-z]{2,10}$/.test(String(d.what))) return;
            var body = Object.assign({}, d.body && typeof d.body === 'object' ? d.body : {},
                { key: friendsKey.key, device: friendsKey.device, app: APP });
            post('/v1/friends/' + d.what, body).then(function (r) {
                var out = JSON.stringify({ id: d.id, status: r.status,
                    body: r.json && typeof r.json === 'object' ? r.json : {} });
                pageRun('document.dispatchEvent(new CustomEvent("' + FRIENDS_ANSWER + '",{detail:' + JSON.stringify(out) + '}))');
            });
        });
    }

    function newer(a, b) {
        var x = String(a).split('.'), y = String(b).split('.');
        for (var i = 0; i < Math.max(x.length, y.length); i++) {
            var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
            if (d) return d > 0;
        }
        return false;
    }
    var offeredUpdate = false;
    function offerUpdate() {
        if (offeredUpdate) return;
        offeredUpdate = true;
        var mine = APP.split(' ').pop();
        post('/v1/app', {}).then(function (r) {
            var m = null;
            try { m = r.json && typeof r.json.manifest === 'string' ? JSON.parse(r.json.manifest) : null; } catch (e) { m = null; }
            var out = m && m.loader && m.loader.version;
            if (!out || !newer(out, mine)) return;
            return getValue('updateLater', '').then(function (later) {
                var p = String(later || '').split('|');
                if (p[0] === out && Date.now() - Number(p[1]) < 86400000) return;
                var u = shell();
                if (!u.scrim.hidden) return;
                u.scrim.textContent = '';
                var card = el('div', 'card');
                card.setAttribute('role', 'dialog');
                card.setAttribute('aria-label', 'API Dash update');
                card.appendChild(el('h1', null, 'API Dash · update'));
                var release = m.tag ? String(m.tag).replace(/^v/, '') : out;
                card.appendChild(el('p', null, 'API Dash ' + release + ' is out: loader ' + out + ' (this is ' + mine + ').'));
                if (m.notes) card.appendChild(el('p', 'dim', String(m.notes)));
                card.appendChild(el('p', 'dim', 'Your userscript app will ask to update it. Then reload this page.'));
                var row = el('div', 'row');
                var later = el('button', 'btn', 'Not now');
                var go = el('a', 'btn pri', 'Update');
                go.href = LOADER_URL;
                go.target = '_blank';
                go.rel = 'noopener';
                row.appendChild(later);
                row.appendChild(go);
                card.appendChild(row);
                u.scrim.appendChild(card);
                u.scrim.hidden = false;
                function close() { u.scrim.hidden = true; u.scrim.textContent = ''; }
                later.onclick = function () { setValue('updateLater', out + '|' + Date.now()); close(); };
                go.addEventListener('click', close);
            });
        });
    }

    function endFrom(ends) {
        return ends && typeof ends === 'object' && site.key in ends ? ends[site.key] : undefined;
    }

    function inject(code) {
        if (mountedVersion()) return { ok: true, said: 'already on this page' };
        pageRun("window.__apidashErr=function(e){document.documentElement.setAttribute('data-apidash-err',String((e&&e.message)||'error'))};" +
                "window.addEventListener('error',window.__apidashErr)");
        var ranMark = 'data-apidash-ran';
        root.removeAttribute(ranMark);
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
        if (hideAfter) pillTimer = setTimeout(function () {
            u.pill.hidden = true;
            if (ui === u && u.scrim.hidden) { u.host.remove(); ui = null; }
        }, hideAfter);
    }
    var keyKept = true;
    function freeKey(k) {
        if (!window.confirm('Free this key from the device that holds it?\n\nA key works on one device at a time. Whichever device uses it next claims it.')) return Promise.resolve(null);
        return post('/v1/unbind', { key: k }).then(function (r) {
            if (r.status === 200 && r.json && !r.json.error) return { ok: true, said: r.json.said };
            if (r.json && r.json.error) return { ok: false, said: r.json.error };
            return { ok: false, said: 'Could not reach the licence server. Check your connection and try again.' };
        });
    }

    function askKey(message, isProblem, stuckKey) {
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
            card.appendChild(el('p', 'dim', 'The key is kept in your userscript app on this phone. It works on one device at a time - on a new phone or computer, free it first.'));
            var row = el('div', 'row');
            var later = el('button', 'btn', 'Not now');
            var save = el('button', 'btn pri', 'Save key');
            row.appendChild(later);
            row.appendChild(save);
            card.appendChild(row);
            var alt = el('p', 'alt', 'No key yet? ');
            alt.appendChild(storeLink('a', 'Buy one'));
            card.appendChild(alt);
            var free = el('p', 'alt');
            var freeBtn = el('button', null, 'Key on another device? Free it');
            free.appendChild(freeBtn);
            card.appendChild(free);
            u.scrim.appendChild(card);
            u.scrim.hidden = false;
            function done(v) { u.scrim.hidden = true; u.scrim.textContent = ''; resolve(v); }
            freeBtn.onclick = function () {
                var k = inp.value.trim() || stuckKey || '';
                if (!k) { inp.focus(); return; }
                freeBtn.disabled = true;
                freeKey(k).then(function (r) {
                    freeBtn.disabled = false;
                    if (!r) return;
                    if (!r.ok) { freeBtn.textContent = r.said; return; }
                    setValue('key', k).then(function (ok) { keyKept = ok; done(k); });
                });
            };
            later.onclick = function () { done(null); };
            save.onclick = function () {
                var k = inp.value.trim();
                if (!k) { inp.focus(); return; }
                save.disabled = true;
                setValue('key', k).then(function (ok) { keyKept = ok; done(k); });
            };
            inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') save.click(); });
            setTimeout(function () { inp.focus(); }, 50);
        });
    }

    function storeLink(cls, text) {
        var a = el('a', cls, text);
        a.href = STORE;
        a.target = '_blank';
        a.rel = 'noopener';
        return a;
    }

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

    function load(key, device, tries) {
        say('Loading the ' + site.label + ' dashboard…');
        return post('/v1/dashboard', { key: key, device: device, site: site.key, app: APP }).then(function (r) {
            if (r.status === -1) {
                say('Your userscript app cannot reach the licence server. Use Userscripts (iPhone) or Violentmonkey (Android).', true);
                return;
            }
            if (r.status === 0) {
                say(handler() === 'Userscripts'
                    ? 'Could not reach the licence server. Check your connection, and that Safari allows Userscripts on All Websites (Settings > Apps > Safari > Extensions > Userscripts). Then reload.'
                    : 'Could not reach the licence server. Check your connection, then reload the page.', true);
                return;
            }
            var j = r.json || {};
            if (j.error) {
                if (r.status === 403 && tries < 3) {
                    return post('/v1/licence', { key: key, device: device, app: APP }).then(function (lr) {
                        var lic = lr.status === 200 && lr.json && !lr.json.error ? lr.json : null;
                        if (lic) return noTime(key, device, tries, lic, j.error);
                        return askKey(j.error, true, key).then(function (k) {
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
                friendsOn(key, device);
                offerUpdate();
                if (keyKept) say('API Dash ' + got.said, false, 2500);
                else say('API Dash ' + got.said + ' - but your userscript app would not keep the key, so it will ask again next time.', false, 9000);
            } else {
                say(got.said, true);
            }
        });
    }

    function noTime(key, device, tries, lic, said) {
        var covers = function (l) { return !!(l && l.sites && l.sites.indexOf(site.key) >= 0); };
        if (covers(lic)) return load(key, device, tries + 1);
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

    var RUN_ATTR = 'data-apidash-run';
    var RUN_EVERY = 5, RUN_STALE = 15;
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
        live.chain = live.chain.then(go).then(null, liveEnd);
    }
    function send(gone) {
        if (live.over) return null;
        var st = liveState();
        var body = { key: live.key, device: live.device, site: site.key, app: APP,
            running: st.running, sim: st.sim, visible: document.visibilityState === 'visible' };
        if (gone) body.gone = true;
        return post('/v1/live', body).then(function (r) {
            if (r.status === 400 || r.status === 403) { liveEnd(); return; }
            if (r.status === 200) {
                var e = Number(r.json && r.json.every);
                live.every = e > 0 ? Math.min(600, Math.max(30, e)) : 60;
            }
            if (!live.waiting) liveNext();
        });
    }
    function goLive(key, device) {
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

    if (onStore) {
        getValue('key', '').then(function (k) {
            k = String(k || '').trim();
            if (k) pageRun('window.apidashUseKey&&window.apidashUseKey(' + JSON.stringify(k) + ')');
        });
        return;
    }

    menu('Change licence key', function () { start(true); });
    menu('Buy a key or add time', function () { window.open(STORE, '_blank'); });
    menu('Free this key (to use it on another device)', function () {
        getValue('key', '').then(function (k) {
            k = String(k || '').trim();
            if (!k) { say('No key is saved on this phone.', true, 5000); return; }
            freeKey(k).then(function (r) {
                if (r) say(r.ok ? 'Key freed. It works on the next device that uses it.' : r.said, !r.ok, 8000);
            });
        });
    });
    start(/(^|[#&])apidash-key\b/.test(location.hash));
})();
