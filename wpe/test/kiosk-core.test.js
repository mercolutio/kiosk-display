/*
 * Tests fuer kiosk-core.js — laufen mit reinem Node, ohne Framework:
 *     node wpe/test/kiosk-core.test.js
 */
'use strict';
const assert = require('assert');
const C = require('../kiosk-core.js');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok   - ' + name); }
  catch (e) { fail++; console.error('  FAIL - ' + name + ': ' + e.message); }
}

const sites = [
  { url: 'https://velvetgreen-dienstleistungen.de', name: 'Velvetgreen', duration: 20 },
  { url: 'https://immobilien-doll.de', name: 'Doll' },
  { url: 'https://ausbeultechnik-nord.de', name: 'Nord' },
  { url: 'https://rexfortis.de', name: 'Rexfortis', duration: 30 }
];
const config = { rotationInterval: 15, idleTimeout: 5, sites };

t('normalizeHost entfernt Protokoll, Pfad und www.', () => {
  assert.strictEqual(C.normalizeHost('https://www.Example.com/x?y=1'), 'example.com');
  assert.strictEqual(C.normalizeHost('immobilien-doll.de'), 'immobilien-doll.de');
  assert.strictEqual(C.normalizeHost(''), '');
});

t('findIndexForUrl trifft exakten Host (auch mit Pfad/www)', () => {
  assert.strictEqual(C.findIndexForUrl(sites, 'https://rexfortis.de/impressum'), 3);
  assert.strictEqual(C.findIndexForUrl(sites, 'https://www.immobilien-doll.de/'), 1);
  assert.strictEqual(C.findIndexForUrl(sites, 'https://velvetgreen-dienstleistungen.de'), 0);
});

t('findIndexForUrl trifft Subdomain auf Apex', () => {
  assert.strictEqual(C.findIndexForUrl(sites, 'https://shop.rexfortis.de/x'), 3);
});

t('findIndexForUrl liefert -1 fuer externe Seite', () => {
  assert.strictEqual(C.findIndexForUrl(sites, 'https://google.com'), -1);
  assert.strictEqual(C.findIndexForUrl(sites, 'about:blank'), -1);
});

t('nextIndex / prevIndex laufen rund (wrap-around)', () => {
  assert.strictEqual(C.nextIndex(3, 4), 0);
  assert.strictEqual(C.nextIndex(0, 4), 1);
  assert.strictEqual(C.prevIndex(0, 4), 3);
  assert.strictEqual(C.prevIndex(2, 4), 1);
});

t('resolveDuration bevorzugt site.duration, sonst rotationInterval', () => {
  assert.strictEqual(C.resolveDuration(sites[0], config), 20);
  assert.strictEqual(C.resolveDuration(sites[1], config), 15);
  assert.strictEqual(C.resolveDuration(sites[3], config), 30);
});

t('resolveDuration faellt auf 15 zurueck, wenn nichts Brauchbares da ist', () => {
  assert.strictEqual(C.resolveDuration({}, { rotationInterval: 0 }), 15);
  assert.strictEqual(C.resolveDuration(null, null), 15);
});

console.log('\n' + pass + ' bestanden, ' + fail + ' fehlgeschlagen');
process.exit(fail ? 1 : 0);
