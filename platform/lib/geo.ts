import { sql } from './db';

// Adresse -> Koordinaten über den freien OpenStreetMap-Geocoder (Nominatim),
// SERVERSEITIG (mit gültigem User-Agent, ohne CORS, ohne Client). Wird nur zum
// einmaligen Ermitteln der Position genutzt; die Karte selbst wird ohne externen
// Anbieter gezeichnet. Auf Salzgitter eingegrenzt (countrycodes + viewbox).
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const q = /salzgitter/i.test(address) ? address : `${address}, Salzgitter`;
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
