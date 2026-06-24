import { sql } from './db';

// Adresse -> Koordinaten über den freien OpenStreetMap-Geocoder (Nominatim),
// SERVERSEITIG (mit gültigem User-Agent, ohne CORS). Wird nur zum einmaligen
// Ermitteln der Position genutzt; die Karte selbst wird ohne Anbieter gezeichnet.
//
// Praxis-Problem: Adressen enthalten oft einen Firmennamen vorne dran
// („autoPRO Autodoktor SZ Marienbruchstraße 72 …") — daran scheitert die Suche.
// Deshalb werden mehrere Kandidaten probiert: erst ab dem Straßennamen, dann nur
// PLZ + Ort (sicherer Fallback, mindestens richtiger Stadtteil), dann die ganze
// Adresse. Der erste Treffer gewinnt.

const SZ_HINT = /salzgitter|lebenstedt|\b382\d\d\b/i; // schon in Salzgitter verortet?

function candidateQueries(address: string): string[] {
  const a = address.trim().replace(/\s+/g, ' ');
  const out: string[] = [];
  // 1) Ab dem Straßennamen bis zum Ende (Firmenname davor wird weggeschnitten).
  const street = a.match(
    /([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\-]*\s+)?[A-Za-zÄÖÜäöüß.\-]*(?:stra(?:ß|ss)e|str\.?|weg|allee|platz|ring|gasse|damm|chaussee)\b.*/i,
  );
  if (street) out.push(street[0].trim());
  // 2) PLZ + Ort — sehr zuverlässig, landet mindestens im richtigen Stadtteil.
  const plz = a.match(/\b\d{5}\b[,\s]+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß.\-]+/);
  if (plz) out.push(plz[0].replace(/,/g, ' ').replace(/\s+/g, ' ').trim());
  // 3) Ganze Adresse als letzter Versuch.
  out.push(a);
  return [...new Set(out)];
}

async function nominatim(query: string): Promise<{ lat: number; lng: number } | null> {
  const q = SZ_HINT.test(query) ? query : `${query}, Salzgitter`;
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de' +
    '&viewbox=10.20,52.24,10.52,52.00&q=' + encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'kiosk-display/1.0 (fleet.microwerbung.com; d.schloesser@mercolutio.com)',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    if (!hit) return null;
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
}

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  for (const q of candidateQueries(address)) {
    const hit = await nominatim(q);
    if (hit) return hit;
  }
  return null;
}

// Für Geräte mit Adresse, aber (noch) ohne Koordinaten: Position einmalig
// ermitteln und speichern. Pro Server-Instanz nur ein Versuch je Gerät, damit
// fehlschlagende Adressen kein Dauerfeuer auf den Geocoder auslösen. Mutiert die
// übergebenen Objekte direkt, damit der aktuelle Render die Pins schon zeigt.
const attempted = new Set<string>();
export async function backfillGeocodes(devices: any[]): Promise<void> {
  for (const d of devices) {
    if ((d.lat != null && d.lng != null) || !d.location || attempted.has(d.id)) continue;
    attempted.add(d.id);
    const c = await geocodeAddress(d.location);
    if (c) {
      d.lat = c.lat;
      d.lng = c.lng;
      try { await sql`update devices set lat = ${c.lat}, lng = ${c.lng} where id = ${d.id}`; } catch {}
    }
  }
}
