'use client';
// Standort per Klick auf der selbstgezeichneten Salzgitter-Karte setzen.
// Speichert die Koordinaten sofort (Server-Action) — kein externer Dienst.
import { useState, useTransition } from 'react';
import CityMap from '../../CityMap';
import { setDeviceLocation, clearDeviceLocation } from '../../actions';

export default function LocationPicker({
  deviceId, name, lat, lng,
}: {
  deviceId: string;
  name: string;
  lat: number | null;
  lng: number | null;
}) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null,
  );
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function pick(la: number, lo: number) {
    setCoords({ lat: la, lng: lo });
    setSaved(false);
    start(async () => {
      await setDeviceLocation(deviceId, la, lo);
      setSaved(true);
    });
  }
  function clear() {
    setCoords(null);
    setSaved(false);
    start(async () => {
      await clearDeviceLocation(deviceId);
      setSaved(true);
    });
  }

  const markers = coords ? [{ id: deviceId, name, lat: coords.lat, lng: coords.lng, online: true }] : [];

  return (
    <div>
      <CityMap markers={markers} maxWidth={440} onPick={pick} emptyHint="Hier ins Stadtgebiet klicken" />
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {coords
            ? <>Position: {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}{pending ? ' · speichert…' : saved ? ' · ✓ gespeichert' : ''}</>
            : 'Auf die Karte klicken, wo das Display steht — wird sofort gespeichert.'}
        </span>
        {coords && (
          <button type="button" className="btn-sm" onClick={clear} disabled={pending}>Standort entfernen</button>
        )}
      </div>
    </div>
  );
}
