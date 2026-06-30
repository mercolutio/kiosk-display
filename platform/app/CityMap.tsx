'use client';
// Selbstgezeichnete Salzgitter-Karte: SVG aus dem eingebetteten Umriss, ganz
// ohne externen Karten-/Geocoding-Dienst und ohne Leaflet. Marker werden über
// ihre Koordinaten projiziert; mit onPick wird die Karte anklickbar und liefert
// die geklickte Position (lat/lng) zurück.
import { SALZGITTER_RING } from './salzgitter';

export type CityMarker = { id: string; name: string; lat: number; lng: number; online?: boolean; label?: string };

const W = 380;
const PAD = 16;

const lngs = SALZGITTER_RING.map((p) => p[0]);
const lats = SALZGITTER_RING.map((p) => p[1]);
const minLng = Math.min(...lngs);
const maxLng = Math.max(...lngs);
const minLat = Math.min(...lats);
const maxLat = Math.max(...lats);
// Längengrade an der geografischen Breite stauchen (cos), damit die Form stimmt.
const K = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
const SCALE = (W - 2 * PAD) / ((maxLng - minLng) * K);
const H = Math.round(2 * PAD + (maxLat - minLat) * SCALE);

function project(lng: number, lat: number): [number, number] {
  return [PAD + (lng - minLng) * K * SCALE, PAD + (maxLat - lat) * SCALE];
}
function unproject(x: number, y: number): { lat: number; lng: number } {
  return { lat: maxLat - (y - PAD) / SCALE, lng: minLng + (x - PAD) / (K * SCALE) };
}
const RING_PATH =
  SALZGITTER_RING.map((p, i) => {
    const [x, y] = project(p[0], p[1]);
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join(' ') + ' Z';

// Ein paar Stadtteile zur Orientierung (dezent), damit das Setzen per Klick leichter fällt.
const DISTRICTS: { name: string; lat: number; lng: number }[] = [
  { name: 'Lebenstedt', lat: 52.157, lng: 10.333 },
  { name: 'Salzgitter-Bad', lat: 52.0588, lng: 10.358 },
  { name: 'Thiede', lat: 52.196, lng: 10.476 },
  { name: 'Watenstedt', lat: 52.123, lng: 10.383 },
  { name: 'Gebhardshagen', lat: 52.085, lng: 10.300 },
  { name: 'Lichtenberg', lat: 52.110, lng: 10.357 },
];

export default function CityMap({
  markers,
  maxWidth = 380,
  onPick,
  emptyHint,
}: {
  markers: CityMarker[];
  maxWidth?: number;
  onPick?: (lat: number, lng: number) => void;
  emptyHint?: string;
}) {
  const valid = markers.filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));

  // Ausschnitt + Zoom: bei >=2 Standorten automatisch auf deren Bereich zoomen,
  // damit die Abstände der Displays sichtbar werden. Im Picker (onPick) bleibt
  // die Vollansicht, damit man überall klicken kann.
  let vx = 0, vy = 0, vw = W, vh = H;
  if (!onPick && valid.length >= 2) {
    const pts = valid.map((m) => project(m.lng, m.lat));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const pad = Math.max(Math.max(maxX - minX, maxY - minY) * 0.6, 34);
    let x0 = minX - pad, y0 = minY - pad, w0 = maxX - minX + pad * 2, h0 = maxY - minY + pad * 2;
    const minSpan = W * 0.12;          // nicht zu stark reinzoomen
    if (w0 < minSpan) { x0 -= (minSpan - w0) / 2; w0 = minSpan; }
    if (h0 < minSpan) { y0 -= (minSpan - h0) / 2; h0 = minSpan; }
    const big = Math.max(w0, h0);      // Seitenverhältnis halbwegs ausgewogen halten
    if (w0 < big * 0.6) { x0 -= (big * 0.6 - w0) / 2; w0 = big * 0.6; }
    if (h0 < big * 0.6) { y0 -= (big * 0.6 - h0) / 2; h0 = big * 0.6; }
    // nur zoomen, wenn der Ausschnitt klar kleiner als die ganze Karte ist
    if (w0 < W * 0.9 && h0 < H * 0.9) { vx = x0; vy = y0; vw = w0; vh = h0; }
  }
  const u = vw / W; // Skalierung, damit Marker/Schrift unabhängig vom Zoom gleich groß bleiben

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onPick) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    const { lat, lng } = unproject(x, y);
    onPick(lat, lng);
  }

  return (
    <div style={{ width: '100%', maxWidth, margin: '0 auto' }}>
      <svg
        viewBox={`${vx} ${vy} ${vw} ${vh}`}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          borderRadius: 10,
          background: '#0e0e10',
          cursor: onPick ? 'crosshair' : 'default',
        }}
        onClick={handleClick}
        role="img"
        aria-label="Karte von Salzgitter mit Display-Standorten"
      >
        <path d={RING_PATH} fill="#13251a" stroke="#34c759" strokeWidth={1.5 * u} strokeLinejoin="round" strokeLinecap="round" />
        {DISTRICTS.map((d) => {
          const [x, y] = project(d.lng, d.lat);
          return (
            <g key={d.name} pointerEvents="none">
              <circle cx={x} cy={y} r={1.6 * u} fill="#5a6b5f" />
              <text x={x + 4 * u} y={y + 3 * u} fontSize={8 * u} fill="#7e8d83">{d.name}</text>
            </g>
          );
        })}
        {valid.map((m) => {
          const [x, y] = project(m.lng, m.lat);
          return (
            <g key={m.id}>
              <circle cx={x} cy={y} r={6.5 * u} fill={m.online === false ? '#f99' : '#34c759'} stroke="#0a0a0a" strokeWidth={2 * u}>
                <title>{m.name}{m.label ? ' — ' + m.label : ''}</title>
              </circle>
              <text x={x + 10 * u} y={y + 4 * u} fontSize={12 * u} fill="#e8e8ea" stroke="#0b0b0c" strokeWidth={3 * u} style={{ paintOrder: 'stroke' }}>
                {m.name}
              </text>
            </g>
          );
        })}
        {valid.length === 0 && emptyHint && (
          <text x={W / 2} y={H / 2} fontSize={13} fill="#888" textAnchor="middle">{emptyHint}</text>
        )}
      </svg>
    </div>
  );
}
