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
        <h2>Geräte ({devices.length})</h2>
        {devices.length === 0 ? (
          <p className="muted">Noch keine Geräte. Lege unten dein erstes Kiosk-Gerät an.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Name</th><th>Gerät</th><th>App</th><th>Aktuelle Seite</th><th></th></tr>
            </thead>
            <tbody>
              {devices.map((d: any) => (
                <tr key={d.id}>
                  <td><Link href={`/devices/${d.id}`}>{d.name}</Link></td>
                  <td className={isOnline(d.last_seen_at) ? 'badge-online' : 'badge-offline'}>
                    {isOnline(d.last_seen_at) ? '● online' : '● offline'}
                  </td>
                  <td>{appStatus(isOnline(d.last_seen_at), d.app_active)}</td>
                  <td className="muted">{d.current_site || '—'}</td>
                  <td><Link href={`/devices/${d.id}`}>verwalten →</Link></td>
                </tr>
              ))}
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
