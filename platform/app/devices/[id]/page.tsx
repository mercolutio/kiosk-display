import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { sql } from '@/lib/db';
import {
  updateDeviceSettings, deleteDevice,
  addSite, updateSite, deleteSite, moveSite,
  enqueueCommand,
} from '../../actions';

export const dynamic = 'force-dynamic';

function isOnline(lastSeen: string | null): boolean {
  return !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 60_000;
}
function hhmm(t: string | null): string {
  return t ? String(t).slice(0, 5) : '';
}

export default async function DevicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { rows: devices } = await sql`select * from devices where id = ${id} limit 1`;
  const device = devices[0];
  if (!device) notFound();

  const { rows: sites } = await sql`
    select * from sites where device_id = ${id} order by position asc, created_at asc
  `;
  const { rows: commands } = await sql`
    select type, status, created_at from commands
     where device_id = ${id} order by created_at desc limit 5
  `;

  const h = await headers();
  const host = h.get('host') || 'dein-projekt.vercel.app';
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0];
  const baseUrl = `${proto}://${host}`;

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/">← Geräte</Link> / {device.name}</h1>
        <span className={isOnline(device.last_seen_at) ? 'badge-online' : 'badge-offline'}>
          {isOnline(device.last_seen_at) ? '● online' : '● offline'}
        </span>
      </div>

      {/* Fernsteuerung */}
      <div className="card">
        <h2>Fernsteuerung</h2>
        <div className="row">
          <form action={enqueueCommand}>
            <input type="hidden" name="device_id" value={id} />
            <input type="hidden" name="type" value="restart_app" />
            <button className="btn-primary" type="submit">Kiosk neu starten</button>
          </form>
          <form action={enqueueCommand}>
            <input type="hidden" name="device_id" value={id} />
            <input type="hidden" name="type" value="reboot" />
            <button type="submit">Pi neu starten</button>
          </form>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>
          Aktuelle Seite: {device.current_site || '—'} · zuletzt gesehen:{' '}
          {device.last_seen_at ? new Date(device.last_seen_at).toLocaleString('de-DE') : 'nie'}
          {commands.length > 0 && (
            <> · letzter Befehl: {commands[0].type} ({commands[0].status})</>
          )}
        </p>
      </div>

      {/* Seiten */}
      <div className="card">
        <h2>Webseiten ({sites.length})</h2>
        {sites.map((s: any) => (
          <div key={s.id} className="row" style={{ borderBottom: '1px solid #232326', paddingBottom: 10, marginBottom: 10 }}>
            <form action={updateSite} className="row" style={{ flex: 1 }}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="device_id" value={id} />
              <input name="name" defaultValue={s.name} placeholder="Name" style={{ width: 150 }} />
              <input name="url" defaultValue={s.url} placeholder="https://…" style={{ flex: 1, minWidth: 180 }} />
              <input name="duration" type="number" min="1" defaultValue={s.duration ?? ''} placeholder="Dauer s" style={{ width: 90 }} />
              <label className="row" style={{ margin: 0, color: '#bbb' }}>
                <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> aktiv
              </label>
              <button className="btn-sm" type="submit">Speichern</button>
            </form>
            <form action={moveSite}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="device_id" value={id} />
              <button className="btn-sm" name="dir" value="up" type="submit" title="hoch">↑</button>
            </form>
            <form action={moveSite}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="device_id" value={id} />
              <button className="btn-sm" name="dir" value="down" type="submit" title="runter">↓</button>
            </form>
            <form action={deleteSite}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="device_id" value={id} />
              <button className="btn-sm btn-danger" type="submit">×</button>
            </form>
          </div>
        ))}
        <form action={addSite} className="row" style={{ marginTop: 6 }}>
          <input type="hidden" name="device_id" value={id} />
          <input name="name" placeholder="Name" required style={{ width: 150 }} />
          <input name="url" placeholder="https://…" required style={{ flex: 1, minWidth: 180 }} />
          <input name="duration" type="number" min="1" placeholder="Dauer s" style={{ width: 90 }} />
          <button className="btn-primary btn-sm" type="submit">+ Seite</button>
        </form>
      </div>

      {/* Einstellungen */}
      <div className="card">
        <h2>Einstellungen</h2>
        <form action={updateDeviceSettings}>
          <input type="hidden" name="id" value={id} />
          <div className="grid2">
            <div>
              <label>Name</label>
              <input name="name" defaultValue={device.name} style={{ width: '100%' }} />
            </div>
            <div className="grid2">
              <div>
                <label>Standard-Dauer (s)</label>
                <input name="rotation_interval" type="number" min="1" defaultValue={device.rotation_interval} style={{ width: '100%' }} />
              </div>
              <div>
                <label>Idle-Timeout (s)</label>
                <input name="idle_timeout" type="number" min="1" defaultValue={device.idle_timeout} style={{ width: '100%' }} />
              </div>
            </div>
            <div>
              <label>Bildschirm an ab (optional)</label>
              <input name="screen_on_time" type="time" defaultValue={hhmm(device.screen_on_time)} style={{ width: '100%' }} />
            </div>
            <div>
              <label>Bildschirm aus ab (optional)</label>
              <input name="screen_off_time" type="time" defaultValue={hhmm(device.screen_off_time)} style={{ width: '100%' }} />
            </div>
          </div>
          <button className="btn-primary" type="submit" style={{ marginTop: 14 }}>Speichern</button>
        </form>
      </div>

      {/* Agent-Einrichtung */}
      <div className="card">
        <h2>Pi-Agent verbinden</h2>
        <p className="muted">Trag das auf dem Pi in <code>~/.config/kiosk-agent.env</code> ein:</p>
        <pre>{`KIOSK_API_URL=${baseUrl}
KIOSK_DEVICE_TOKEN=${device.token}`}</pre>
        <p className="muted">Setup-Schritte: siehe <code>platform/README.md</code> im Repo.</p>
      </div>

      {/* Gefahrenzone */}
      <div className="card">
        <h2>Gerät entfernen</h2>
        <form action={deleteDevice}>
          <input type="hidden" name="id" value={id} />
          <button className="btn-danger" type="submit">Dieses Gerät löschen</button>
        </form>
      </div>
    </div>
  );
}
