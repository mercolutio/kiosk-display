import Link from 'next/link';
import { sql } from '@/lib/db';
import { createDevice, logout } from './actions';
import AutoRefresh from './auto-refresh';

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

export default async function Dashboard() {
  let devices: any[] = [];
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

  // Konfigurierte Seiten laden, um current_site auf einen lesbaren Namen zu mappen
  // (Schluessel: Geraet + URL). Faellt zurueck, falls die type-Spalte fehlt.
  const siteByKey = new Map<string, { name?: string; type?: string }>();
  try {
    let rows: any[] = [];
    try {
      rows = (await sql`select device_id, url, name, type from sites`).rows;
    } catch {
      rows = (await sql`select device_id, url, name from sites`).rows;
    }
    for (const s of rows) siteByKey.set(`${s.device_id}\n${s.url}`, { name: s.name, type: s.type });
  } catch { /* sites-Tabelle evtl. noch nicht angelegt */ }

  const online = devices.filter((d) => isOnline(d.last_seen_at)).length;
  const offline = devices.length - online;
  const appOn = devices.filter((d) => isOnline(d.last_seen_at) && d.app_active).length;

  return (
    <div className="container">
      <AutoRefresh seconds={10} />
      <div className="header">
        <h1>Kiosk-Verwaltung</h1>
        <form action={logout}>
          <button className="btn-sm" type="submit">Abmelden</button>
        </form>
      </div>

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
                return (
                  <tr key={d.id}>
                    <td><Link href={`/devices/${d.id}`}>{d.name}</Link></td>
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
        <h2>Neues Gerät</h2>
        <form action={createDevice} className="row">
          <input name="name" placeholder="z. B. KioskDisplay001" required style={{ flex: 1 }} />
          <button className="btn-primary" type="submit">Anlegen</button>
        </form>
        <p className="muted" style={{ marginTop: 8 }}>
          Nach dem Anlegen bekommst du ein Geräte-Token für den Pi-Agent.
        </p>
      </div>
    </div>
  );
}
