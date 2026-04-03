// Scroll-Simulation für Touchscreen ohne natives Scroll
(function() {
  var startY = null, lastY = null, scrolling = false, isDown = false;

  function down(y) {
    startY = y; lastY = y; scrolling = false; isDown = true;
    console.log('KIOSK:interaction');
  }

  function move(y, e) {
    if (!isDown || lastY === null) return;
    var dy = lastY - y;
    if (!scrolling && Math.abs(y - startY) > 5) scrolling = true;
    if (scrolling) {
      window.scrollBy(0, dy);
      try { e.preventDefault(); } catch(x) {}
      console.log('KIOSK:interaction');
    }
    lastY = y;
  }

  function up() {
    startY = null; lastY = null; scrolling = false; isDown = false;
  }

  // Pointer Events
  document.addEventListener('pointerdown', function(e) { down(e.clientY); }, true);
  document.addEventListener('pointermove', function(e) { if (isDown) move(e.clientY, e); }, true);
  document.addEventListener('pointerup', up, true);

  // Mouse Events
  document.addEventListener('mousedown', function(e) { down(e.clientY); }, true);
  document.addEventListener('mousemove', function(e) { move(e.clientY, e); }, true);
  document.addEventListener('mouseup', up, true);

  // Touch Events
  document.addEventListener('touchstart', function(e) { down(e.touches[0].clientY); }, true);
  document.addEventListener('touchmove', function(e) { move(e.touches[0].clientY, e); }, true);
  document.addEventListener('touchend', up, true);

  // Text-Selektion verhindern
  document.addEventListener('selectstart', function(e) {
    var t = (e.target.tagName || '').toLowerCase();
    if (t !== 'input' && t !== 'textarea') e.preventDefault();
  });

  console.log('KIOSK:scroll-sim-loaded');

  // ── Cookie-Banner entfernen (nach DOMContentLoaded) ──
  var bannerSelectors = [
    '#cookie-banner', '#cookie-consent', '#cookiebanner', '#cookie-notice',
    '#cookieNotice', '#cookie-popup', '#cookie-bar', '#cookie-law',
    '.cookie-banner', '.cookie-consent', '.cookiebanner', '.cookie-notice',
    '.cookie-popup', '.cookie-bar', '.cookie-overlay', '.cookie-modal',
    '.cc-banner', '.cc-window', '.cc-overlay',
    '.gdpr-banner', '.gdpr-consent', '.gdpr-popup',
    '#gdpr-banner', '#gdpr-consent',
    '.consent-banner', '.consent-popup', '.consent-modal',
    '#consent-banner', '#consent-popup',
    '#CybotCookiebotDialog', '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '.cky-consent-container', '#cky-consent',
    '#onetrust-banner-sdk', '#onetrust-consent-sdk',
    '.otFlat', '#ot-sdk-btn-floating',
    '#usercentrics-root',
    '.sp-message-container',
    '#klaro', '.klaro',
    '[id*="cookie" i][id*="banner" i]',
    '[id*="cookie" i][id*="consent" i]',
    '[class*="cookie" i][class*="banner" i]',
    '[class*="cookie" i][class*="consent" i]',
    '[aria-label*="cookie" i]',
    '[aria-label*="consent" i]'
  ];

  var acceptSelectors = [
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    '.cky-btn-accept', '#cky-btn-accept',
    '#onetrust-accept-btn-handler',
    '.cc-accept', '.cc-btn.cc-allow', '.cc-dismiss',
    '[data-action="accept"]',
    '[data-cookie-accept]',
    '.consent-accept', '.accept-cookies', '.allow-cookies',
    '#accept-cookies', '#acceptCookies',
    'button[id*="accept" i]',
    'button[class*="accept" i]',
    'a[id*="accept" i]',
    'a[class*="accept" i]'
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
        if (text === acceptTexts[k] || text.indexOf(acceptTexts[k]) !== -1) {
          buttons[j].click();
          return true;
        }
      }
    }
    return false;
  }

  function removeBanners() {
    for (var i = 0; i < bannerSelectors.length; i++) {
      var els = document.querySelectorAll(bannerSelectors[i]);
      for (var j = 0; j < els.length; j++) {
        els[j].style.display = 'none';
        els[j].remove();
      }
    }
    var overlays = document.querySelectorAll('[class*="overlay" i]');
    for (var k = 0; k < overlays.length; k++) {
      var s = window.getComputedStyle(overlays[k]);
      if (s.position === 'fixed' && parseFloat(s.zIndex) > 999) {
        overlays[k].remove();
      }
    }
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  function killCookies() {
    clickAcceptButtons();
    setTimeout(function() { clickAcceptButtons(); removeBanners(); }, 500);
    setTimeout(function() { clickAcceptButtons(); removeBanners(); }, 1500);
    setTimeout(function() { clickAcceptButtons(); removeBanners(); }, 3000);
  }

  document.addEventListener('DOMContentLoaded', function() {
    killCookies();
    var observer = new MutationObserver(function() {
      clickAcceptButtons();
      removeBanners();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(function() { observer.disconnect(); }, 10000);

    // Scrollbar sichtbar machen (ohne overflow-y zu aendern)
    var style = document.createElement('style');
    style.textContent = '::-webkit-scrollbar{width:20px!important;background:#111!important}::-webkit-scrollbar-thumb{background:#c8ff00!important;border-radius:10px!important;border:3px solid #111!important}::-webkit-scrollbar-thumb:active{background:#fff!important}';
    document.head.appendChild(style);
  });
})();
