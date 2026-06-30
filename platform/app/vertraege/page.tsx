import Link from 'next/link';
import { sql, ensureSchema } from '@/lib/db';
import { deleteContract } from '../actions';
import ContractUploadForm from './ContractUploadForm';

export const dynamic = 'force-dynamic';

function fmtSize(n: number | null): string {
  if (!n) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

export default async function Vertraege() {
  await ensureSchema();

  let contracts: any[] = [];
  try {
    contracts = (await sql`
      select c.*, d.name as device_name
        from contracts c
        left join devices d on d.id = c.device_id
       order by c.created_at desc
    `).rows;
  } catch { /* contracts-Tabelle evtl. noch nicht angelegt */ }

  let devices: any[] = [];
  try {
    devices = (await sql`select id, name from devices order by created_at asc`).rows;
  } catch { /* devices evtl. nicht erreichbar */ }

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/">← Übersicht</Link> / Verträge</h1>
      </div>

      <div className="card">
        <h2>Verträge ({contracts.length})</h2>
        {contracts.length === 0 ? (
          <p className="muted">Noch keine Verträge. Lade unten dein erstes Dokument hoch.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Dokument</th><th>Gerät</th><th>Hochgeladen</th><th></th></tr>
            </thead>
            <tbody>
              {contracts.map((c: any) => (
                <tr key={c.id}>
                  <td>
                    <a href={c.url} target="_blank" rel="noreferrer">📄 {c.name}</a>
                    {c.size ? <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{fmtSize(c.size)}</span> : null}
                    {c.note ? <div className="muted" style={{ fontSize: 12 }}>{c.note}</div> : null}
                  </td>
                  <td className="muted">{c.device_name || '—'}</td>
                  <td className="muted">{new Date(c.created_at).toLocaleDateString('de-DE')}</td>
                  <td>
                    <form action={deleteContract}>
                      <input type="hidden" name="id" value={c.id} />
                      <button className="btn-sm btn-danger" type="submit" title="löschen">×</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Vertrag hochladen</h2>
        <ContractUploadForm devices={devices.map((d: any) => ({ id: d.id, name: d.name }))} />
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          PDF, Word oder Bild · max ~4,5 MB pro Datei. Optional einem Gerät/Standort zuordnen.
        </p>
      </div>
    </div>
  );
}
