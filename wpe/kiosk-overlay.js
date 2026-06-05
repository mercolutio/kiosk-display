/*
 * kiosk-overlay.js — wird als WebKit-User-Script in JEDE geladene Seite injiziert.
 *
 * Ersetzt die Electron-"Shell" (main.js + renderer.html) komplett durch in die
 * Seite injizierten Code. Enthaelt:
 *   1. Rotation (Index aus URL ableiten, Timer, Navigation per location.href)
 *   2. Overlay-UI in einer Shadow-DOM (Statusbar + Dots + Timer, Bottom-Bar mit Pfeilen)
 *   3. Interaktions-/Idle-Erkennung (Timer pausieren bei Touch/Scroll)
 *   4. Cookie-Banner-Killer (portiert aus renderer.html)
 *   5. Optionale Scroll-Simulation fuer Touch (portiert aus webview-preload.js)
 *   6. Einfache Bildschirmtastatur (tippt in das fokussierte Eingabefeld)
 *
 * Erwartet:
 *   window.__KIOSK_CONFIG__  (vom Launcher injiziert, Inhalt von sites.json)
 *   window.__KIOSK_CORE__    (kiosk-core.js, vorher injiziert)
 */
(function () {
  'use strict';

  // Nur im obersten Frame laufen (nicht in iframes der Seite).
  if (window.top !== window.self) return;
  // Doppelinjektion vermeiden.
  if (window.__KIOSK_OVERLAY_ACTIVE__) return;
  window.__KIOSK_OVERLAY_ACTIVE__ = true;

  var CFG = window.__KIOSK_CONFIG__ || { rotationInterval: 15, idleTimeout: 5, sites: [] };
  var Core = window.__KIOSK_CORE__;
  var sites = (CFG && CFG.sites) || [];
  if (!Core || !sites.length) {
    console.warn('KIOSK: keine Config/Core oder keine Seiten — Overlay inaktiv');
    return;
  }

  var ENABLE_SCROLL_SIM = false; // Standard: natives Touch-Scrolling von WebKit nutzen.
                                 // Auf true setzen, falls die Hardware kein natives
                                 // Touch-Scroll liefert (siehe README).

  var idleMs = (CFG.idleTimeout || 5) * 1000;

  // ── Aktuellen Zustand aus der URL ableiten ─────────────────────────────
  var currentIndex = Core.findIndexForUrl(sites, location.href);
  var onKnownSite = currentIndex !== -1;
  if (!onKnownSite) currentIndex = 0; // externer Link: nicht auto-rotieren, aber Nav erlauben

  var duration = Core.resolveDuration(sites[currentIndex], CFG);
  var timeRemaining = duration;
  var paused = false;
  var idleTimer = null;

  // ── Navigation (jeder Wechsel = voller Reload, wie in der Electron-Version) ──
  function gotoIndex(i) { location.href = sites[i].url; }
  function nextSite() { gotoIndex(Core.nextIndex(currentIndex, sites.length)); }
  function prevSite() { gotoIndex(Core.prevIndex(currentIndex, sites.length)); }

  // ── DOM-ready Helfer (Injektion erfolgt zu document-start) ─────────────
  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  // ── Overlay-UI (Shadow-DOM, isoliert von der Host-Seite) ───────────────
  var ui = {}; // gefuellt in buildOverlay()

  var OVERLAY_CSS = [
    ':host{all:initial}',
    '.bar{position:fixed;left:0;right:0;height:44px;background:#0a0a0a;color:#fff;',
    '  display:flex;align-items:center;justify-content:center;padding:0 16px;',
    "  font-family:-apple-system,'Plus Jakarta Sans',sans-serif;font-size:13px;",
    '  pointer-events:auto;box-sizing:border-box;z-index:2147483647}',
    '.bar.top{top:0;border-bottom:1px solid rgba(200,255,0,.15)}',
    '.bar.bottom{bottom:0;gap:16px;border-top:1px solid rgba(200,255,0,.15)}',
    '.dots{position:absolute;left:16px;display:flex;gap:10px;align-items:center}',
    '.dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.2);',
    '  transition:background .3s,transform .15s;cursor:pointer}',
    '.dot:active{transform:scale(1.4)}',
    '.dot.active{background:#c8ff00;box-shadow:0 0 6px rgba(200,255,0,.4)}',
    '.name{font-family:ui-monospace,"Space Mono",monospace;font-size:12px;',
    '  color:rgba(255,255,255,.7);letter-spacing:.5px;max-width:60vw;overflow:hidden;',
    '  white-space:nowrap;text-overflow:ellipsis}',
    '.timer{position:absolute;right:16px;display:flex;align-items:center;gap:8px}',
    '.pause{color:#c8ff00;font-size:10px;font-weight:700;letter-spacing:1px;display:none}',
    '.pause.on{display:inline}',
    '.tbar{width:60px;height:2px;background:rgba(255,255,255,.1);border-radius:1px;overflow:hidden}',
    '.prog{height:100%;width:100%;background:#c8ff00;border-radius:1px;transition:width .25s linear}',
    '.prog.paused{background:rgba(200,255,0,.35)}',
    '.ttext{font-family:ui-monospace,monospace;font-size:11px;color:rgba(255,255,255,.6);min-width:26px;text-align:right}',
    '.nav{background:none;border:1px solid rgba(200,255,0,.2);color:rgba(200,255,0,.6);',
    '  font-size:20px;width:120px;height:34px;border-radius:8px;cursor:pointer;',
    '  display:flex;align-items:center;justify-content:center;padding:0}',
    '.nav:active{background:#c8ff00;color:#0a0a0a}'
  ].join('');

  function adoptCss(target, cssText) {
    // Constructable Stylesheet umgeht CSP style-src; Fallback auf <style>.
    try {
      var sheet = new CSSStyleSheet();
      sheet.replaceSync(cssText);
      target.adoptedStyleSheets = (target.adoptedStyleSheets || []).concat(sheet);
      return;
    } catch (e) { /* Fallback */ }
    var el = document.createElement('style');
    el.textContent = cssText;
    (target.appendChild ? target : document.head).appendChild(el);
  }

  function buildOverlay() {
    var hostEl = document.createElement('div');
    hostEl.id = '__kiosk_overlay_host__';
    // Container deckt alles ab, blockt aber keine Klicks (nur die Bars sind klickbar).
    hostEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';

    var root = hostEl.attachShadow ? hostEl.attachShadow({ mode: 'open' }) : hostEl;
    adoptCss(root, OVERLAY_CSS);

    root.innerHTML +=
      '<div class="bar top">' +
        '<div class="dots"></div>' +
        '<div class="name"></div>' +
        '<div class="timer">' +
          '<span class="pause">PAUSE</span>' +
          '<div class="tbar"><div class="prog"></div></div>' +
          '<span class="ttext"></span>' +
        '</div>' +
      '</div>' +
      '<div class="bar bottom">' +
        '<button class="nav prev">❮</button>' +
        '<button class="nav next">❯</button>' +
      '</div>';

    ui.root = root;
    ui.dots = root.querySelector('.dots');
    ui.name = root.querySelector('.name');
    ui.pause = root.querySelector('.pause');
    ui.prog = root.querySelector('.prog');
    ui.ttext = root.querySelector('.ttext');

    // Dots aufbauen
    for (var i = 0; i < sites.length; i++) {
      (function (idx) {
        var dot = document.createElement('div');
        dot.className = 'dot' + (idx === currentIndex && onKnownSite ? ' active' : '');
        var handler = function (e) { e.preventDefault(); onInteraction(); gotoIndex(idx); };
        dot.addEventListener('click', handler);
        dot.addEventListener('touchstart', handler, { passive: false });
        ui.dots.appendChild(dot);
      })(i);
    }

    var prevBtn = root.querySelector('.nav.prev');
    var nextBtn = root.querySelector('.nav.next');
    var prevH = function (e) { e.preventDefault(); onInteraction(); prevSite(); };
    var nextH = function (e) { e.preventDefault(); onInteraction(); nextSite(); };
    prevBtn.addEventListener('click', prevH);
    nextBtn.addEventListener('click', nextH);
    prevBtn.addEventListener('touchstart', prevH, { passive: false });
    nextBtn.addEventListener('touchstart', nextH, { passive: false });

    // Seitenname anzeigen
    var label;
    if (onKnownSite) {
      try { label = new URL(sites[currentIndex].url).hostname; }
      catch (e) { label = sites[currentIndex].name || ''; }
    } else {
      try { label = 'extern · ' + new URL(location.href).hostname; }
      catch (e) { label = 'extern'; }
    }
    ui.name.textContent = label;

    (document.documentElement || document.body).appendChild(hostEl);
    updateTimerDisplay();
  }

  function updateTimerDisplay() {
    if (!ui.prog) return;
    var pct = Math.max(0, Math.min(100, (timeRemaining / duration) * 100));
    ui.prog.style.width = pct + '%';
    ui.ttext.textContent = onKnownSite ? Math.ceil(Math.max(0, timeRemaining)) + 's' : '—';
  }

  function showPause(on) {
    if (!ui.pause) return;
    ui.pause.classList.toggle('on', on);
    ui.prog.classList.toggle('paused', on);
  }

  // ── Interaktion / Idle ─────────────────────────────────────────────────
  function onInteraction() {
    if (!paused) { paused = true; showPause(true); }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      paused = false;
      showPause(false);
      timeRemaining = duration; // nach Idle wieder volle Dauer dieser Seite
      updateTimerDisplay();
    }, idleMs);
  }

  // ── Timer-Loop (alle 0.5s) ──────────────────────────────────────────────
  function startTimer() {
    setInterval(function () {
      if (paused || !onKnownSite) return; // von externen Seiten nicht auto-rotieren
      timeRemaining -= 0.5;
      updateTimerDisplay();
      if (timeRemaining <= 0) nextSite();
    }, 500);
  }

  // ── Cookie-Banner-Killer (portiert aus renderer.html) ───────────────────
  function killCookiesSetup() {
    var bannerSelectors = [
      '#cookie-banner', '#cookie-consent', '#cookiebanner', '#cookie-notice',
      '#cookieNotice', '#cookie-popup', '#cookie-bar', '#cookie-law',
      '.cookie-banner', '.cookie-consent', '.cookiebanner', '.cookie-notice',
      '.cookie-popup', '.cookie-bar', '.cookie-overlay', '.cookie-modal',
      '.cc-banner', '.cc-window', '.cc-overlay',
      '.gdpr-banner', '.gdpr-consent', '.gdpr-popup', '#gdpr-banner', '#gdpr-consent',
      '.consent-banner', '.consent-popup', '.consent-modal', '#consent-banner', '#consent-popup',
      '#CybotCookiebotDialog', '.cky-consent-container', '#cky-consent',
      '#onetrust-banner-sdk', '#onetrust-consent-sdk', '.otFlat', '#ot-sdk-btn-floating',
      '#usercentrics-root', '.sp-message-container', '#klaro', '.klaro',
      '[id*="cookie" i][id*="banner" i]', '[id*="cookie" i][id*="consent" i]',
      '[class*="cookie" i][class*="banner" i]', '[class*="cookie" i][class*="consent" i]',
      '[aria-label*="cookie" i]', '[aria-label*="consent" i]'
    ];
    var acceptSelectors = [
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '#CybotCookiebotDialogBodyButtonAccept',
      '.cky-btn-accept', '#cky-btn-accept', '#onetrust-accept-btn-handler',
      '.cc-accept', '.cc-btn.cc-allow', '.cc-dismiss',
      '[data-action="accept"]', '[data-cookie-accept]',
      '.consent-accept', '.accept-cookies', '.allow-cookies',
      '#accept-cookies', '#acceptCookies',
      'button[id*="accept" i]', 'button[class*="accept" i]',
      'a[id*="accept" i]', 'a[class*="accept" i]'
    ];
    var acceptTexts = [
      'akzeptieren', 'alle akzeptieren', 'accept', 'accept all',
      'alle cookies akzeptieren', 'allow all', 'allow cookies',
      'zustimmen', 'alle zustimmen', 'einverstanden', 'ok',
      'ich stimme zu', 'verstanden', 'alles klar'
    ];

    function clickAcceptButtons() {
      for (var i = 0; i < acceptSelectors.length; i++) {
        var btn = document.querySelector(acceptSelectors[i]);
        if (btn) { btn.click(); return true; }
      }
      var buttons = document.querySelectorAll('button, a[role="button"], .btn, [type="submit"]');
      for (var j = 0; j < buttons.length; j++) {
        var text = (buttons[j].textContent || '').trim().toLowerCase();
        for (var k = 0; k < acceptTexts.length; k++) {
          if (text === acceptTexts[k] || text.includes(acceptTexts[k])) {
            buttons[j].click();
            return true;
          }
        }
      }
      return false;
    }

    function removeBanners() {
      bannerSelectors.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) { el.remove(); });
      });
      document.querySelectorAll('[class*="overlay" i]').forEach(function (el) {
        var s = window.getComputedStyle(el);
        if (s.position === 'fixed' && parseFloat(s.zIndex) > 999) el.remove();
      });
      document.body.style.overflow = '';
      document.documentElement.style.overflow = '';
    }

    clickAcceptButtons();
    [500, 1500, 3000].forEach(function (ms) {
      setTimeout(function () { clickAcceptButtons(); removeBanners(); }, ms);
    });

    var observer = new MutationObserver(function () { clickAcceptButtons(); removeBanners(); });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 10000);
  }

  // ── Scroll-Simulation fuer Touch (portiert aus webview-preload.js) ──────
  // Standardmaessig deaktiviert; nur die Interaktions-Erkennung laeuft immer.
  function scrollSimSetup() {
    var startY = null, lastY = null, scrolling = false, isDown = false;
    function down(y) { startY = y; lastY = y; scrolling = false; isDown = true; onInteraction(); }
    function move(y, e) {
      if (!isDown || lastY === null) return;
      var dy = lastY - y;
      if (!scrolling && Math.abs(y - startY) > 5) scrolling = true;
      if (scrolling) {
        window.scrollBy(0, dy);
        try { e.preventDefault(); } catch (x) {}
        onInteraction();
      }
      lastY = y;
    }
    function up() { startY = null; lastY = null; scrolling = false; isDown = false; }
    document.addEventListener('touchstart', function (e) { down(e.touches[0].clientY); }, true);
    document.addEventListener('touchmove', function (e) { move(e.touches[0].clientY, e); }, true);
    document.addEventListener('touchend', up, true);
  }

  // Interaktions-Erkennung (immer aktiv) — pausiert den Rotations-Timer.
  function interactionDetectionSetup() {
    ['touchstart', 'pointerdown', 'wheel', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, onInteraction, { capture: true, passive: true });
    });
    window.addEventListener('scroll', onInteraction, { capture: true, passive: true });
  }

  // ── Sehr einfache Bildschirmtastatur ────────────────────────────────────
  function keyboardSetup() {
    var rows = [
      '1234567890ß'.split(''),
      'qwertzuiopü'.split(''),
      'asdfghjklöä'.split(''),
      'yxcvbnm,.-'.split('')
    ];
    var kb = document.createElement('div');
    kb.id = '__kiosk_kb__';
    kb.style.cssText = 'position:fixed;left:0;right:0;bottom:44px;z-index:2147483646;' +
      'background:#0a0a0a;border-top:1px solid rgba(200,255,0,.2);padding:6px;display:none;';
    var shift = false;

    function setVisible(v) { kb.style.display = v ? 'block' : 'none'; }
    function typeInto(ch) {
      var el = document.activeElement;
      if (!el) return;
      var tag = (el.tagName || '').toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable) return;
      var start = el.selectionStart != null ? el.selectionStart : (el.value || '').length;
      var end = el.selectionEnd != null ? el.selectionEnd : start;
      var val = el.value != null ? el.value : '';
      if (el.isContentEditable) { document.execCommand('insertText', false, ch); return; }
      el.value = val.slice(0, start) + ch + val.slice(end);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      var pos = start + ch.length;
      if (el.setSelectionRange) el.setSelectionRange(pos, pos);
    }
    function backspace() {
      var el = document.activeElement;
      if (!el || el.value == null) return;
      var start = el.selectionStart != null ? el.selectionStart : el.value.length;
      var end = el.selectionEnd != null ? el.selectionEnd : start;
      if (start === end && start > 0) start--;
      el.value = el.value.slice(0, start) + el.value.slice(end);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      if (el.setSelectionRange) el.setSelectionRange(start, start);
    }
    function mkKey(label, onTap, flex) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'flex:' + (flex || 1) + ';margin:2px;height:38px;border:1px solid #333;' +
        'background:#161616;color:#eee;border-radius:6px;font-size:15px;';
      b.addEventListener('mousedown', function (e) { e.preventDefault(); onInteraction(); onTap(); });
      b.addEventListener('touchstart', function (e) { e.preventDefault(); onInteraction(); onTap(); }, { passive: false });
      return b;
    }

    function render() {
      kb.innerHTML = '';
      rows.forEach(function (chars) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:center';
        chars.forEach(function (ch) {
          var label = shift ? ch.toUpperCase() : ch;
          row.appendChild(mkKey(label, function () { typeInto(label); if (shift) { shift = false; render(); } }));
        });
        kb.appendChild(row);
      });
      var ctrl = document.createElement('div');
      ctrl.style.cssText = 'display:flex;justify-content:center';
      ctrl.appendChild(mkKey('⇧', function () { shift = !shift; render(); }, 2));
      ctrl.appendChild(mkKey('@', function () { typeInto('@'); }, 1));
      ctrl.appendChild(mkKey('SPACE', function () { typeInto(' '); }, 4));
      ctrl.appendChild(mkKey('⌫', backspace, 2));
      ctrl.appendChild(mkKey('✕', function () { setVisible(false); }, 2));
      kb.appendChild(ctrl);
    }
    render();
    document.body.appendChild(kb);

    document.addEventListener('focusin', function (e) {
      var t = (e.target.tagName || '').toLowerCase();
      if (t === 'input' || t === 'textarea' || e.target.isContentEditable) setVisible(true);
    });
  }

  // ── Start ───────────────────────────────────────────────────────────────
  ready(function () {
    try { buildOverlay(); } catch (e) { console.warn('KIOSK overlay:', e); }
    try { interactionDetectionSetup(); } catch (e) {}
    if (ENABLE_SCROLL_SIM) { try { scrollSimSetup(); } catch (e) {} }
    try { killCookiesSetup(); } catch (e) {}
    try { keyboardSetup(); } catch (e) {}
  });
  startTimer();

  console.log('KIOSK: overlay aktiv, index=' + currentIndex + ' known=' + onKnownSite + ' dauer=' + duration + 's');
})();
