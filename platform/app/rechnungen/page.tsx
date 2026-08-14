import Link from 'next/link';
import { sql, ensureSchema } from '@/lib/db';
import { normalizeInvoiceRow, eur, fmtDate, STATUS_LABEL, type Invoice } from '@/lib/invoices';

export const dynamic = 'force-dynamic';

function StatusBadge({ inv }: { inv: Invoice }) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = inv.status === 'sent' && inv.due_date && inv.due_date < today;
  const color =
    inv.status === 'paid' ? '#34c759'
    : inv.status === 'cancelled' ? '#888'
    : inv.status === 'sent' ? (overdue ? '#ff9a9a' : '#ffd27a')
    : '#9ad';
  return (
    <span style={{ color, fontSize: 13 }}>
      ● {overdue ? 'Überfällig' : STATUS_LABEL[inv.status]}
      {inv.status === 'paid' && inv.paid_at ? <span className="muted"> ({fmtDate(inv.paid_at)})</span> : null}
    </span>
  );
}

export default async function Rechnungen() {
  await ensureSchema();

  let invoices: Invoice[] = [];
  try {
    const { rows } = await sql`select * from invoices order by number desc`;
    invoices = rows.map(normalizeInvoiceRow);
  } catch { /* Tabellen evtl. noch nicht angelegt */ }

  const year = String(new Date().getFullYear());
  const open = invoices.filter((i) => i.status === 'sent');
  const openSum = open.reduce((a, i) => a + i.gross_total, 0);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = open.filter((i) => i.due_date && i.due_date < today);
  const paidYear = invoices
    .filter((i) => i.status === 'paid' && (i.paid_at || '').startsWith(year))
    .reduce((a, i) => a + i.gross_total, 0);
  const drafts = invoices.filter((i) => i.status === 'draft').length;

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/">← Übersicht</Link> / Rechnungen</h1>
        <div className="row" style={{ gap: 8 }}>
          <Link href="/rechnungen/einstellungen" className="btn-sm"
                style={{ border: '1px solid #333', background: '#1d1d20', color: '#eee', padding: '5px 10px', borderRadius: 8, fontSize: 13 }}>
            ⚙️ Einstellungen
          </Link>
          <Link href="/rechnungen/neu" className="btn-primary btn-sm">+ Neue Rechnung</Link>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Offen</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: open.length ? '#ffd27a' : '#e8e8ea' }}>{eur(openSum)}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {open.length} Rechnung{open.length === 1 ? '' : 'en'}
              {overdue.length > 0 && <span style={{ color: '#ff9a9a' }}> · {overdue.length} überfällig</span>}
            </div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Bezahlt {year}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#34c759' }}>{eur(paidYear)}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 12 }}>Entwürfe</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{drafts}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Alle Rechnungen ({invoices.length})</h2>
        {invoices.length === 0 ? (
          <p className="muted">
            Noch keine Rechnungen. Lege oben rechts die erste an — Empfänger und Positionen kannst du
            direkt aus deinen Kunden (Display-Belegungen) übernehmen. Denk daran, vorher einmal die{' '}
            <Link href="/rechnungen/einstellungen">eigenen Firmendaten</Link> zu hinterlegen.
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nr.</th><th>Empfänger</th><th>Datum</th><th>Fällig</th>
                <th style={{ textAlign: 'right' }}>Betrag</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><Link href={`/rechnungen/${inv.id}`}>{inv.number}</Link></td>
                  <td>{inv.c_name}</td>
                  <td className="muted">{fmtDate(inv.issue_date)}</td>
                  <td className="muted">{fmtDate(inv.due_date)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{eur(inv.gross_total)}</td>
                  <td><StatusBadge inv={inv} /></td>
                  <td>
                    <div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      <a href={`/api/invoice-file?id=${inv.id}&format=pdf`} target="_blank" rel="noreferrer"
                         className="btn-sm" title="PDF öffnen"
                         style={{ border: '1px solid #333', padding: '3px 8px', borderRadius: 8, fontSize: 12 }}>
                        PDF
                      </a>
                      <a href={`/api/invoice-file?id=${inv.id}&format=xrechnung`}
                         className="btn-sm" title="E-Rechnung (XRechnung-XML) herunterladen"
                         style={{ border: '1px solid #2a4a33', color: '#34c759', padding: '3px 8px', borderRadius: 8, fontSize: 12 }}>
                        XML
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          <strong>PDF</strong> = lesbare Ausfertigung · <strong>XML</strong> = E-Rechnung
          (XRechnung nach EN 16931) zum Versand an Geschäftskunden und Behörden.
        </p>
      </div>
    </div>
  );
}
