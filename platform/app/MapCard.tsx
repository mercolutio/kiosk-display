'use client';
// Standort-Karte mit echten Straßen (Leaflet + OpenStreetMap-Kacheln). Zoomt
// automatisch auf die gesetzten Display-Standorte (fitBounds), damit man ihre
// Abstände zueinander sieht. Marker grün = online / rot = offline.
import { useEffect, useRef, useState } from 'react';
import { loadLeaflet } from './leaflet-loader';

type MapDevice = { id: string; name: string; label: string; lat: number; lng: number; online: boolean };

const SALZGITTER: [number, number] = [52.1503, 10.3594];

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
      // Dunkler Kartenstil (CARTO dark) — lässt die grüne Linie strahlen und passt
      // zum dunklen Dashboard; Straßennamen bleiben lesbar.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      }).addTo(map);

      const devs = devicesRef.current.filter((d) => isFinite(d.lat) && isFinite(d.lng));
      const pts: [number, number][] = devs.map((d) => [d.lat, d.lng] as [number, number]);

      // Verbindungslinien zwischen allen Standorten (Netzwerkeffekt): eine dezente
      // Basislinie + eine animierte grüne „Fluss"-Linie. Zuerst zeichnen, damit die
      // Marker darüber liegen.
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const seg: [number, number][] = [pts[i], pts[j]];
          L.polyline(seg, { color: '#34c759', weight: 1.5, opacity: 0.3, interactive: false }).addTo(map);
          L.polyline(seg, { color: '#34c759', weight: 2.5, opacity: 0.95, lineCap: 'round', dashArray: '2 12', className: 'mw-flow', interactive: false }).addTo(map);
        }
      }

      for (const d of devs) {
        L.circleMarker([d.lat, d.lng] as [number, number], {
          radius: 9,
          color: '#0a0a0a',
          weight: 2,
          fillColor: d.online ? '#34c759' : '#f99',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(`<strong>${escapeHtml(d.name)}</strong>${d.label ? '<br>' + escapeHtml(d.label) : ''}`);
      }
      if (cancelled) return;
      // Auto-Zoom auf die Standorte (maxZoom begrenzt, damit nah beieinander
      // liegende Displays nicht bis zur Hausnummer reingezoomt werden).
      if (pts.length === 1) map.setView(pts[0], 16);
      else if (pts.length > 1) map.fitBounds(pts, { padding: [45, 45], maxZoom: 17 });
      setTimeout(() => { if (!cancelled && map) map.invalidateSize(); }, 100);
      setStatus(pts.length ? 'ready' : 'empty');
    })();
    return () => { cancelled = true; if (map) map.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <div ref={ref} style={{ height: 420, borderRadius: 8, overflow: 'hidden', background: '#0e0e10' }} />
        {status !== 'ready' && (
          <div
            className="muted"
            style={{ position: 'absolute', left: 12, bottom: 12, fontSize: 12, background: 'rgba(0,0,0,.65)', padding: '4px 8px', borderRadius: 6, zIndex: 500 }}
          >
            {status === 'loading'
              ? 'Karte lädt…'
              : status === 'empty'
              ? 'Noch keine Standorte – auf der Geräteseite per Klick auf die Karte setzen.'
              : 'Karte konnte nicht geladen werden.'}
          </div>
        )}
      </div>
      <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 12 }}>
        <span className="muted"><span style={{ color: '#34c759' }}>●</span> online</span>
        <span className="muted"><span style={{ color: '#f99' }}>●</span> offline</span>
        <span className="muted">Karte © OpenStreetMap, © CARTO</span>
      </div>
    </div>
  );
}
