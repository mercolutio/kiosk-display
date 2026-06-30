import Link from 'next/link';
import { sql, ensureSchema } from '@/lib/db';
import { deleteContract, setContractCategory } from '../actions';
import ContractUploadForm from './ContractUploadForm';

export const dynamic = 'force-dynamic';

function fmtSize(n: number | null): string {
  if (!n) return '';
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return Math.max(1, Math.round(n / 1024)) + ' KB';
}

function ContractTable({ rows, moveTo, fillable }: { rows: any[]; moveTo: 'blanko' | 'unterschrieben'; fillable?: boolean }) {
  if (rows.length === 0) return <p className="muted">Noch keine Dokumente.</p>;
  const moveText = moveTo === 'unterschrieben' ? '→ Unterschr.' : '→ Blanko';
  const moveTitle = moveTo === 'unterschrieben' ? 'nach „Unterschrieben" verschieben' : 'nach „Blanko" verschieben';
  return (
    <table>
      <thead>
        <tr><th>Dokument</th><th>Gerät</th><th>Hochgeladen</th><th></th></tr>
      </thead>
      <tbody>
        {rows.map((c: any) => (
          <tr key={c.id}>
            <td>
              <a href={c.url} target="_blank" rel="noreferrer">📄 {c.name}</a>
              {c.size ? <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>{fmtSize(c.size)}</span> : null}
              {c.note ? <div className="muted" style={{ fontSize: 12 }}>{c.note}</div> : null}
            </td>
            <td className="muted">{c.device_name || '—'}</td>
            <td className="muted">{new Date(c.created_at).toLocaleDateString('de-DE')}</td>
            <td>
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                {fillable && ((c.content_type || '').includes('pdf') || /\.pdf(\?|$)/i.test(c.url || '') || /\.pdf$/i.test(c.name || '')) && (
                  <Link href={`/vertraege/${c.id}`} title="im Browser ausfüllen"
                        style={{ border: '1px solid #34c759', color: '#34c759', padding: '3px 8px', borderRadius: 8, fontSize: 12, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                    ✏️ Ausfüllen
                  </Link>
                )}
                <form action={setContractCategory}>
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="category" value={moveTo} />
                  <button className="btn-sm" type="submit" title={moveTitle}>{moveText}</button>
                </form>
                <form action={deleteContract}>
                  <input type="hidden" name="id" value={c.id} />
                  <button className="btn-sm btn-danger" type="submit" title="löschen">×</button>
                </form>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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

  const blanko = contracts.filter((c: any) => (c.category || 'blanko') !== 'unterschrieben');
  const signed = contracts.filter((c: any) => c.category === 'unterschrieben');

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/">← Übersicht</Link> / Verträge</h1>
      </div>

      <div className="card">
        <h2>Blanko ({blanko.length})</h2>
        <ContractTable rows={blanko} moveTo="unterschrieben" fillable />
      </div>

      <div className="card">
        <h2>Unterschrieben ({signed.length})</h2>
        <ContractTable rows={signed} moveTo="blanko" />
      </div>

      <div className="card">
        <h2>Vertrag hochladen</h2>
        <ContractUploadForm devices={devices.map((d: any) => ({ id: d.id, name: d.name }))} />
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          PDF, Word oder Bild · max ~4,5 MB pro Datei. Kategorie (Blanko/Unterschrieben) und
          optional ein Gerät/Standort wählbar. Verschieben geht jederzeit über die Pfeil-Schaltfläche.
        </p>
      </div>
    </div>
  );
}
