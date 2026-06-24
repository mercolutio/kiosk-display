'use client';
// Interaktive Standort-Karte (Leaflet + OpenStreetMap, ohne API-Key). Die beim
// Geraet hinterlegten Adressen werden clientseitig per Nominatim geocodiert und
// im localStorage gecacht (jede Adresse nur einmal). Leaflet wird per CDN
// nachgeladen -> keine zusaetzliche npm-Abhaengigkeit, kein SSR-Problem.
import { useEffect, useRef, useState } from 'react';

type MapDevice = { id: string; name: string; location: string; online: boolean };

// Salzgitter (Fallback-Mittelpunkt, bis Marker den Ausschnitt bestimmen).
const SALZGITTER: [number, number] = [52.1503, 10.3594];

function loadLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.L) return resolve(w.L);
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    let script = document.getElementById('leaflet-js') as HTMLScriptElement | null;
    if (script) {
      script.addEventListener('load', () => resolve(w.L));
      script.addEventListener('error', reject);
      return;
    }
    script = document.createElement('script');
    script.id = 'leaflet-js';
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.async = true;
    script.onload = () => resolve(w.L);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

async function geocode(address: string): Promise<[number, number] | null> {
  const key = 'geo:' + address;
  try {
    const cached = localStorage.getItem(key);
    if (cached != null) {
      const p = JSON.parse(cached);
      return p && typeof p.lat === 'number' ? [p.lat, p.lng] : null;
    }
  } catch { /* localStorage nicht verfuegbar */ }
  try {
    const res = await fetch(
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address),
      { headers: { Accept: 'application/json' } },
    );
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    const coord: [number, number] | null = hit ? [parseFloat(hit.lat), parseFloat(hit.lon)] : null;
    try { localStorage.setItem(key, JSON.stringify(coord ? { lat: coord[0], lng: coord[1] } : null)); } catch {}
    return coord;
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export default function MapCard({ devices }: { devices: MapDevice[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let map: any;
    let cancelled = false;
    (async () => {
      const L = await loadLeaflet().catch(() => null);
      if (!L || cancelled || !ref.current) { if (!cancelled) setStatus('error'); return; }
      map = L.map(ref.current, { scrollWheelZoom: false }).setView(SALZGITTER, 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const located: [number, number][] = [];
      for (const d of devicesRef.current) {
        if (!d.location || cancelled) continue;
        const c = await geocode(d.location);
        if (!c || cancelled) continue;
        L.circleMarker(c, {
          radius: 10,
          color: '#0a0a0a',
          weight: 2,
          fillColor: d.online ? '#34c759' : '#f99',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(`<strong>${escapeHtml(d.name)}</strong><br>${escapeHtml(d.location)}`);
        located.push(c);
      }
      if (cancelled) return;
      if (located.length === 1) map.setView(located[0], 14);
      else if (located.length > 1) map.fitBounds(located, { padding: [40, 40] });
      setTimeout(() => { if (!cancelled && map) map.invalidateSize(); }, 100);
      setStatus(located.length ? 'ready' : 'empty');
    })();
    return () => { cancelled = true; if (map) map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <div ref={ref} style={{ height: 380, borderRadius: 8, overflow: 'hidden', background: '#0e0e10' }} />
        {status !== 'ready' && (
          <div
            className="muted"
            style={{ position: 'absolute', left: 12, bottom: 12, fontSize: 12, background: 'rgba(0,0,0,.65)', padding: '4px 8px', borderRadius: 6, zIndex: 500 }}
          >
            {status === 'loading'
              ? 'Karte lädt…'
              : status === 'empty'
              ? 'Noch keine Standorte – Adresse beim Gerät eintragen.'
              : 'Karte konnte nicht geladen werden.'}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 12 }}>
        <span className="muted"><span style={{ color: '#34c759' }}>●</span> online</span>
        <span className="muted"><span style={{ color: '#f99' }}>●</span> offline</span>
        <span className="muted">Karte © OpenStreetMap</span>
      </div>
    </div>
  );
}
