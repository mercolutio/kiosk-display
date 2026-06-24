'use client';
// Standort per Klick auf der Karte setzen. Speichert die Koordinaten sofort
// (Server-Action setDeviceLocation) — kein Geocoding, kein externer Anbieter.
import { useEffect, useRef, useState, useTransition } from 'react';
import { loadLeaflet } from '../../leaflet-loader';
import { setDeviceLocation, clearDeviceLocation } from '../../actions';

const SALZGITTER: [number, number] = [52.1503, 10.3594];

export default function LocationPicker({
  deviceId, lat, lng,
}: {
  deviceId: string;
  lat: number | null;
  lng: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [coords, setCoords] = useState<[number, number] | null>(
    lat != null && lng != null ? [lat, lng] : null,
  );
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function place(c: [number, number]) {
    const L = (window as any).L;
    setCoords(c);
    setSaved(false);
    if (mapRef.current && L) {
      if (markerRef.current) {
        markerRef.current.setLatLng(c);
      } else {
        markerRef.current = L.marker(c, { draggable: true }).addTo(mapRef.current);
        markerRef.current.on('dragend', (e: any) => {
          const ll = e.target.getLatLng();
          place([ll.lat, ll.lng]);
        });
      }
    }
    start(async () => {
      await setDeviceLocation(deviceId, c[0], c[1]);
      setSaved(true);
    });
  }

  function clear() {
    setCoords(null);
    setSaved(false);
    if (markerRef.current && mapRef.current) {
      mapRef.current.removeLayer(markerRef.current);
      markerRef.current = null;
    }
    start(async () => {
      await clearDeviceLocation(deviceId);
      setSaved(true);
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await loadLeaflet().catch(() => null);
      if (!L || cancelled || !ref.current) return;
      const startCenter = coords || SALZGITTER;
      const map = L.map(ref.current, { scrollWheelZoom: false }).setView(startCenter, coords ? 15 : 12);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      if (coords) {
        markerRef.current = L.marker(coords, { draggable: true }).addTo(map);
        markerRef.current.on('dragend', (e: any) => {
          const ll = e.target.getLatLng();
          place([ll.lat, ll.lng]);
        });
      }
      map.on('click', (e: any) => place([e.latlng.lat, e.latlng.lng]));
      setTimeout(() => { if (!cancelled) map.invalidateSize(); }, 100);
    })();
    return () => { cancelled = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div ref={ref} style={{ height: 320, borderRadius: 8, overflow: 'hidden', background: '#0e0e10' }} />
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {coords
            ? <>Position: {coords[0].toFixed(5)}, {coords[1].toFixed(5)}{pending ? ' · speichert…' : saved ? ' · ✓ gespeichert' : ''}</>
            : 'Auf die Karte klicken, wo das Display steht — wird sofort gespeichert. Marker ist verschiebbar.'}
        </span>
        {coords && (
          <button type="button" className="btn-sm" onClick={clear} disabled={pending}>Standort entfernen</button>
        )}
      </div>
    </div>
  );
}
