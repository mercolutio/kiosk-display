import Link from 'next/link';
import { sql, ensureSchema } from '@/lib/db';
import { backfillGeocodes, geocodeAddress } from '@/lib/geo';
import { createDevice, logout } from './actions';
import AutoRefresh from './auto-refresh';
import CityMap from './CityMap';

export const dynamic = 'force-dynamic';

function isOnline(lastSeen: string | null): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < 60_000;
}
function appStatus(online: boolean, active: boolean | null | undefined) {
  if (!online || active == null) return <span className="muted">—</span>;
  return active
    ? <span style={{ color: '#34c759' }}>● App an</span>
    : <span style={{ color: '#ffd27a' }}>● App aus</span>;
}
// „vor 5 min" – kurze, relative Zeitangabe fuer zuletzt-gesehen.
function relTime(t: string | null): string {
  if (!t) return 'nie';
  const m = Math.floor((Date.now() - new Date(t).getTime()) / 60_000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.floor(h / 24)} d`;
}
function hostnameOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}
const isBlobUrl = (u: string) => /\.blob\.vercel-storage\.com/i.test(u);
const looksLikeVideo = (u: string) => /\.(mp4|webm|mov|mkv|m4v|ogg)(\?|$)/i.test(u);

// „Aktuelle Seite" lesbar anzeigen: konfigurierter Name + Typ-Icon statt roher
// (oft sehr langer) Blob-/Web-URL. match = die in der Geraete-Konfiguration
// hinterlegte Seite zu dieser URL (falls vorhanden).
function currentSiteLabel(current: string | null, match: { name?: string; type?: string } | undefined) {
  if (!current) return <span className="muted">—</span>;
  let type = match?.type;
  if (!type) type = isBlobUrl(current) ? (looksLikeVideo(current) ? 'video' : 'image') : 'web';
  const icon = type === 'image' ? '🖼️' : type === 'video' ? '🎬' : '🌐';
  const text = match?.name
    ? match.name
    : type === 'web' ? hostnameOf(current) : type === 'video' ? 'Video' : 'Bild';
  return (
    <span title={current} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span aria-hidden>{icon}</span>
      <span>{text}</span>
    </span>
  );
}

// Preispolitik fürs MRR: 19,90 €/Display, ab 3 Displays 14,90 €/Display
// (der günstigere Satz gilt dann für alle Displays des Kunden).
const PRICE_STD = 19.9;
const PRICE_VOL = 14.9;
const VOL_FROM = 3;
const customerRate = (displays: number) => (displays >= VOL_FROM ? PRICE_VOL : PRICE_STD);
const eur = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ debug?: string }> }) {
  const debug = (await searchParams)?.debug === 'geo';
  await ensureSchema();
  let devices: any[] = [];
  try {
    const r = await sql`
      select id, name, last_seen_at, current_site, app_active, location, lat, lng from devices order by created_at asc
    `;
    devices = r.rows;
  } catch {
    try {
      const r = await sql`
        select id, name, last_seen_at, current_site, app_active from devices order by created_at asc
      `;
      devices = r.rows;
    } catch {
      const r = await sql`
        select id, name, last_seen_at, current_site from devices order by created_at asc
      `;
      devices = r.rows;
    }
  }

  // --- temporäre Diagnose (?debug=geo): zeigt gespeicherte Adresse/Koordinaten
  // und ob der Geocoder von Vercel aus überhaupt erreichbar ist ---
  let geoTest = '(aus)';
  if (debug) {
    const lines: string[] = [];
    for (const d of devices) {
      if (!d.location) { lines.push(`${d.name}: keine Adresse`); continue; }
      const c = await geocodeAddress(d.location);
      lines.push(`${d.name}: ${c ? `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}` : 'KEIN Treffer'}  ←  "${d.location}"`);
    }
    geoTest = lines.join('\n');
  }

  // Konfigurierte Seiten einmal laden — daraus speisen sich „Aktuelle Seite"
  // (lesbarer Name) UND die Kunden-/MRR-Übersicht. Fällt zurück, falls Spalten fehlen.
  let siteRows: any[] = [];
  try {
    siteRows = (await sql`select device_id, url, name, type, invoiced from sites`).rows;
  } catch {
    try {
      siteRows = (await sql`select device_id, url, name, type from sites`).rows;
    } catch {
      try { siteRows = (await sql`select device_id, url, name from sites`).rows; } catch {}
    }
  }
  const siteByKey = new Map<string, { name?: string; type?: string }>();
  for (const s of siteRows) siteByKey.set(`${s.device_id}\n${s.url}`, { name: s.name, type: s.type });

  // Kunden aus den Seiten ableiten: nach Name zusammengefasst (Dedup). Je Display
  // wird gemerkt, ob die Platzierung fakturiert ist (= mind. ein fakturierter Slot
  // dort). Nicht fakturierte Displays zählen nicht ins MRR.
  const deviceNameById = new Map<string, string>(devices.map((d: any) => [d.id, d.name] as [string, string]));
  const custByKey = new Map<string, { name: string; placements: Map<string, boolean> }>();
  for (const s of siteRows) {
    const name = (s.name ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let c = custByKey.get(key);
    if (!c) { c = { name, placements: new Map<string, boolean>() }; custByKey.set(key, c); }
    const billed = (c.placements.get(s.device_id) || false) || (s.invoiced !== false);
    c.placements.set(s.device_id, billed);
  }
  const customers = [...custByKey.values()]
    .map((c) => {
      const entries = [...c.placements.entries()];          // [deviceId, fakturiert?]
      const billedDisplays = entries.filter(([, b]) => b).length;
      const unbilled = entries.length - billedDisplays;
      const rate = customerRate(billedDisplays);
      return { name: c.name, entries, billedDisplays, unbilled, rate, mrr: billedDisplays * rate };
    })
    .sort((a, b) => b.mrr - a.mrr || a.name.localeCompare(b.name, 'de'));
  const totalMrr = customers.reduce((a, c) => a + c.mrr, 0);
  const totalBilled = customers.reduce((a, c) => a + c.billedDisplays, 0);
  const totalUnbilled = customers.reduce((a, c) => a + c.unbilled, 0);

  const online = devices.filter((d) => isOnline(d.last_seen_at)).length;
  const offline = devices.length - online;
  const appOn = devices.filter((d) => isOnline(d.last_seen_at) && d.app_active).length;

  // Geräte mit Adresse, aber ohne Koordinaten einmalig automatisch verorten.
  await backfillGeocodes(devices);

  // Geräte mit gesetzten Koordinaten für die Karte (Marker direkt).
  const mapDevices = devices
    .filter((d: any) => d.lat != null && d.lng != null)
    .map((d: any) => ({
      id: d.id, name: d.name, label: d.location || '',
      lat: Number(d.lat), lng: Number(d.lng), online: isOnline(d.last_seen_at),
    }));

  return (
    <div className="container">
      <AutoRefresh seconds={10} />
      <div className="header">
        <h1>Kiosk-Verwaltung</h1>
        <form action={logout}>
          <button className="btn-sm" type="submit">Abmelden</button>
        </form>
      </div>

      {debug && (
        <div className="card" style={{ borderColor: '#5a2a2a' }}>
          <h2>Diagnose Standorte</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {devices.map((d: any) => `${d.name}: location=${JSON.stringify(d.location ?? null)} lat=${d.lat ?? null} lng=${d.lng ?? null}`).join('\n')
              + `\n\nGeocode-Test "Rathaus, Salzgitter":\n${geoTest}`}
          </pre>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Geräte ({devices.length})</h2>
          {devices.length > 0 && (
            <div className="row" style={{ gap: 12, fontSize: 13 }}>
              <span style={{ color: online > 0 ? '#9f9' : '#888' }}>● {online} online</span>
              {offline > 0 && <span style={{ color: '#f99' }}>● {offline} offline</span>}
              <span style={{ color: '#34c759' }}>● {appOn} App an</span>
            </div>
          )}
        </div>
        {devices.length === 0 ? (
          <p className="muted">Noch keine Geräte. Lege unten dein erstes Kiosk-Gerät an.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Gerät</th><th>App</th><th>Aktuelle Seite</th><th></th></tr>
            </thead>
            <tbody>
              {devices.map((d: any) => {
                const on = isOnline(d.last_seen_at);
                const match = d.current_site ? siteByKey.get(`${d.id}\n${d.current_site}`) : undefined;
                const pin = d.lat != null && d.lng != null
                  ? `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=18/${d.lat}/${d.lng}`
                  : d.location
                  ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(d.location)}`
                  : null;
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/devices/${d.id}`}>{d.name}</Link>
                      {pin && (
                        <a
                          href={pin}
                          target="_blank"
                          rel="noreferrer"
                          title={d.location ? `Standort: ${d.location}` : 'Standort öffnen'}
                          style={{ marginLeft: 8, textDecoration: 'none' }}
                        >📍</a>
                      )}
                    </td>
                    <td>
                      <span className={on ? 'badge-online' : 'badge-offline'}>
                        {on ? '● online' : '● offline'}
                      </span>
                      {!on && (
                        <div className="muted" style={{ fontSize: 11 }}>zuletzt {relTime(d.last_seen_at)}</div>
                      )}
                    </td>
                    <td>{appStatus(on, d.app_active)}</td>
                    <td>{currentSiteLabel(d.current_site, match)}</td>
                    <td><Link href={`/devices/${d.id}`}>verwalten →</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Kunden ({customers.length})</h2>
          {customers.length > 0 && (
            <div className="row" style={{ gap: 14, fontSize: 13 }}>
              <span className="muted">{totalBilled} fakturiert</span>
              {totalUnbilled > 0 && <span style={{ color: '#ffd27a' }}>{totalUnbilled} nicht fakt.</span>}
              <span style={{ color: '#34c759', fontWeight: 600 }}>MRR {eur(totalMrr)}</span>
            </div>
          )}
        </div>
        {customers.length === 0 ? (
          <p className="muted">
            Noch keine Kunden. Sobald du einem Display eine Webseite, ein Bild oder ein Video gibst,
            erscheint der Name hier automatisch — mit Umsatz nach Preisliste.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Kunde</th><th>Displays (fakturiert)</th><th>Tarif</th>
                <th style={{ textAlign: 'right' }}>MRR / Monat</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>
                    {c.billedDisplays}
                    {c.unbilled > 0 && (
                      <span style={{ color: '#ffd27a', marginLeft: 8, fontSize: 12 }}>
                        +{c.unbilled} nicht fakturiert
                      </span>
                    )}
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {c.entries
                        .map(([id, billed]) => (deviceNameById.get(id) || id) + (billed ? '' : ' (nicht fakt.)'))
                        .join(', ')}
                    </div>
                  </td>
                  <td className="muted">{c.billedDisplays > 0 ? `${eur(c.rate)}/Display` : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{eur(c.mrr)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="muted">
                  Gesamt · {customers.length} Kunden · {totalBilled} fakturiert
                  {totalUnbilled > 0 ? ` · ${totalUnbilled} nicht fakturiert` : ''}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: '#34c759' }}>{eur(totalMrr)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Preispolitik: 19,90 €/Display · ab 3 Displays 14,90 €/Display. Gleicher Name = ein Kunde
          (keine Dopplung). <strong>Nicht fakturierte</strong> Slots zählen nicht ins MRR.
        </p>
      </div>

      <div className="card">
        <h2>Standorte – Salzgitter</h2>
        <CityMap markers={mapDevices} maxWidth={420} emptyHint="Noch keine Standorte – auf der Geräteseite per Klick setzen" />
        <div className="row" style={{ gap: 14, marginTop: 8, fontSize: 12, justifyContent: 'center' }}>
          <span className="muted"><span style={{ color: '#34c759' }}>●</span> online</span>
          <span className="muted"><span style={{ color: '#f99' }}>●</span> offline</span>
        </div>
      </div>

      <div className="card">
        <h2>Neues Gerät</h2>
        <form action={createDevice} className="row">
          <input name="name" placeholder="z. B. KioskDisplay001" required style={{ flex: 1 }} />
          <button className="btn-primary" type="submit">Anlegen</button>
        </form>
        <p className="muted" style={{ marginTop: 8 }}>
          Nach dem Anlegen bekommst du auf der Geräteseite den fertigen Installationsbefehl (mit Token).
        </p>

        <details className="guide">
          <summary>📋 Komplette Anleitung: neuen Pi von Null einrichten</summary>
          <div className="muted">
            <p style={{ margin: '10px 0 0' }}>
              Du brauchst: Raspberry Pi (5 empfohlen), SD-Karte ≥ 16 GB, Bildschirm, WLAN.
            </p>
            <ol>
              <li>
                <strong>SD-Karte flashen.</strong> Mit dem{' '}
                <a href="https://www.raspberrypi.com/software/" target="_blank" rel="noreferrer">Raspberry&nbsp;Pi&nbsp;Imager</a>{' '}
                „Raspberry Pi OS (64-bit) <strong>with Desktop</strong>" wählen. Im Imager (⚙️) gleich setzen:
                Hostname (z.&nbsp;B. <code>kiosk001</code>), Benutzer + Passwort, WLAN, Zeitzone und{' '}
                <strong>SSH aktivieren</strong>. Karte in den Pi, einschalten.
              </li>
              <li>
                <strong>Autologin einschalten.</strong> Auf dem Pi <code>sudo raspi-config</code> →{' '}
                <em>System Options</em> → <em>Boot / Auto Login</em> → <strong>Desktop Autologin</strong>,
                danach <code>sudo reboot</code>. (Wichtig — der Kiosk läuft in der angemeldeten Desktop-Sitzung.)
              </li>
              <li>
                <strong>Gerät hier anlegen.</strong> Oben Namen eintragen → <em>Anlegen</em>. Auf der
                Geräteseite stehen dann <strong>API-URL + Token</strong> und der fertige Befehl.
              </li>
              <li>
                <strong>Installieren.</strong> Auf dem Pi (Terminal oder per SSH) ausführen:
                <pre style={{ marginTop: 6 }}>{`git clone --branch claude/gallant-thompson-RB2Fq \\
  https://github.com/mercolutio/kiosk-display.git ~/kiosk-display
bash ~/kiosk-display/platform/agent/install.sh`}</pre>
                Das Skript fragt <strong>Plattform-URL + Token</strong> ab (von der Geräteseite kopieren),
                installiert Node, Electron, Agent und Autostart — und bietet die <strong>Fernsteuerung</strong>{' '}
                gleich mit an. Tipp: auf der Geräteseite steht der Befehl mit schon eingesetztem Token.
              </li>
              <li>
                <strong>Fertig.</strong> Nach 1–2&nbsp;Min wird das Gerät hier{' '}
                <span style={{ color: '#9f9' }}>● online</span>. Seiten, Bilder und Videos fügst du dann auf
                der Geräteseite hinzu.
              </li>
              <li>
                <strong>Fernsteuerung (optional).</strong> Im Installer „Fernsteuern einrichten?" mit{' '}
                <strong>J</strong> bestätigen und einmal den <strong>Tailscale-Login-Link</strong> öffnen.
                Die angezeigte Adresse beim Gerät unter <em>Einstellungen → Fernsteuer-Adresse</em> eintragen
                → der Knopf <strong>🖥️ Fernsteuern</strong> erscheint.
              </li>
            </ol>
          </div>
        </details>
      </div>
    </div>
  );
}
