/*
 * kiosk-core.js — reine Logik des Kiosk-Prototyps (ohne DOM).
 *
 * Bewusst frei von Browser-APIs, damit es 1:1 in Node getestet werden kann
 * (siehe test/kiosk-core.test.js) UND im Browser/WebKit als window.__KIOSK_CORE__
 * zur Verfuegung steht.
 *
 * Kernidee der Rotation im WPE-Prototyp: Es gibt keine persistente JS-Variable
 * fuer den "aktuellen Index" (jeder Seitenwechsel ist ein voller Reload, wie schon
 * in der Electron-Version ueber webview.src). Stattdessen wird der aktuelle Index
 * aus der geladenen URL abgeleitet — die URL IST der Zustand.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.__KIOSK_CORE__ = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // URL/Hostname -> normalisierter Host (ohne Protokoll, ohne fuehrendes "www.").
  function normalizeHost(urlOrHost) {
    if (!urlOrHost) return '';
    var host = String(urlOrHost);
    try {
      host = new URL(host).hostname;
    } catch (e) {
      // Vielleicht schon ein Host oder eine URL ohne Protokoll
      try { host = new URL('http://' + host).hostname; } catch (e2) { /* roh lassen */ }
    }
    return host.replace(/^www\./i, '').toLowerCase();
  }

  // Index der Seite finden, deren Host zur uebergebenen URL passt.
  // Subdomains zaehlen als Treffer (shop.example.de -> example.de).
  // -1, wenn keine konfigurierte Seite passt (z.B. Nutzer folgte externem Link).
  function findIndexForUrl(sites, url) {
    var host = normalizeHost(url);
    if (!host) return -1;
    for (var i = 0; i < sites.length; i++) {
      var siteHost = normalizeHost(sites[i] && sites[i].url);
      if (!siteHost) continue;
      if (host === siteHost ||
          host.endsWith('.' + siteHost) ||
          siteHost.endsWith('.' + host)) {
        return i;
      }
    }
    return -1;
  }

  function nextIndex(current, length) {
    if (length <= 0) return 0;
    return (current + 1) % length;
  }

  function prevIndex(current, length) {
    if (length <= 0) return 0;
    return (current - 1 + length) % length;
  }

  // Anzeigedauer pro Seite mit Fallback auf rotationInterval
  // (entspricht getSiteDuration() der Electron-Version: site.duration || rotationInterval).
  function resolveDuration(site, config) {
    var d = site && site.duration;
    if (typeof d === 'number' && d > 0) return d;
    var fallback = config && config.rotationInterval;
    return (typeof fallback === 'number' && fallback > 0) ? fallback : 15;
  }

  return {
    normalizeHost: normalizeHost,
    findIndexForUrl: findIndexForUrl,
    nextIndex: nextIndex,
    prevIndex: prevIndex,
    resolveDuration: resolveDuration
  };
});
