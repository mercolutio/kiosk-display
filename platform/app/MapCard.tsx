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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);

      const pts: [number, number][] = [];
      for (const d of devicesRef.current) {
        if (!isFinite(d.lat) || !isFinite(d.lng)) continue;
        const c: [number, number] = [d.lat, d.lng];
        L.circleMarker(c, {
          radius: 9,
          color: '#0a0a0a',
          weight: 2,
          fillColor: d.online ? '#34c759' : '#f99',
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(`<strong>${escapeHtml(d.name)}</strong>${d.label ? '<br>' + escapeHtml(d.label) : ''}`);
        pts.push(c);
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
        <span className="muted">Karte © OpenStreetMap</span>
      </div>
    </div>
  );
}
