import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadInvoice, getCompany, eur, fmtDate, computeTotals, STATUS_LABEL, UNITS, round2 } from '@/lib/invoices';
import { xrechnungMissing } from '@/lib/xrechnung';
import { smtpConfigured } from '@/lib/invoice-mail';
import { setInvoiceStatus, deleteInvoice, sendInvoiceEmail, renumberInvoice } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function RechnungDetail({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mailed?: string; noxml?: string; mailerror?: string }>;
}) {
  const { id } = await params;
  const { mailed, noxml, mailerror } = await searchParams;
  const data = await loadInvoice(id);
  if (!data) notFound();
  const { invoice: inv, items } = data;
  const company = await getCompany();
  const t = computeTotals(items);
  const gross = inv.small_business ? t.net : t.gross;
  const missing = xrechnungMissing(inv, company);
  const smtpOk = smtpConfigured(company);
  const canMail = (inv.status === 'draft' || inv.status === 'sent');

  const statusColor =
    inv.status === 'paid' ? '#34c759'
    : inv.status === 'cancelled' ? '#888'
    : inv.status === 'sent' ? '#ffd27a' : '#9ad';

  const StatusForm = ({ to, label, primary }: { to: string; label: string; primary?: boolean }) => (
    <form action={setInvoiceStatus}>
      <input type="hidden" name="id" value={inv.id} />
      <input type="hidden" name="to" value={to} />
      <button className={primary ? 'btn-primary btn-sm' : 'btn-sm'} type="submit">{label}</button>
    </form>
  );

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/rechnungen">← Rechnungen</Link> / {inv.number}</h1>
        <span style={{ color: statusColor, fontWeight: 600 }}>● {STATUS_LABEL[inv.status]}</span>
      </div>

      {mailed && (
        <div className="card" style={{ borderColor: '#2a4a33', background: '#162016' }}>
          <span style={{ color: '#34c759' }}>
            ✓ Rechnung per E-Mail an <strong>{mailed}</strong> versendet
            {noxml ? ' — nur als PDF (für die XRechnung fehlten Pflichtangaben)' : ' (XRechnung + PDF)'}.
          </span>
        </div>
      )}
      {mailerror && (
        <div className="card" style={{ borderColor: '#5a2a2a', background: '#241616' }}>
          <span style={{ color: '#ff9a9a' }}>✗ E-Mail nicht versendet: {mailerror}</span>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 8 }}>
            <a href={`/api/invoice-file?id=${inv.id}&format=pdf`} target="_blank" rel="noreferrer"
               className="btn-primary btn-sm" style={{ textDecoration: 'none' }}>
              📄 PDF öffnen
            </a>
            <a href={`/api/invoice-file?id=${inv.id}&format=xrechnung`}
               className="btn-sm" title="E-Rechnung als XRechnung-XML herunterladen"
               style={{ border: '1px solid #2a4a33', color: '#34c759', padding: '4px 9px', borderRadius: 8, textDecoration: 'none' }}>
              🧾 E-Rechnung (XML)
            </a>
            {canMail && smtpOk && inv.c_email && (
              <form action={sendInvoiceEmail}>
                <input type="hidden" name="id" value={inv.id} />
                <button className="btn-sm" type="submit"
                        title={`sendet PDF + XRechnung an ${inv.c_email}${inv.status === 'draft' ? ' und markiert die Rechnung als versendet' : ''}`}
                        style={{ border: '1px solid #2a4a33', color: '#34c759' }}>
                  📧 {inv.status === 'sent' ? 'Erneut per E-Mail senden' : `Per E-Mail senden an ${inv.c_email}`}
                </button>
              </form>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {inv.status === 'draft' && (
              <>
                <StatusForm to="sent" label="Als versendet markieren" primary />
                <Link href={`/rechnungen/${inv.id}/bearbeiten`} className="btn-sm"
                      style={{ border: '1px solid #333', background: '#1d1d20', color: '#eee', padding: '4px 9px', borderRadius: 8, textDecoration: 'none' }}>
                  ✏️ Bearbeiten
                </Link>
                {!/^[A-Z0-9]+-\d{4}-\d{2}-\d{4}$/.test(inv.number) && (
                  <form action={renumberInvoice}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button className="btn-sm" type="submit"
                            title="Diese Nummer stammt noch aus dem alten Format — vergibt die nächste Nummer im Format RE-JJJJ-MM-Nr (nur bei Entwürfen möglich)">
                      № aktualisieren
                    </button>
                  </form>
                )}
              </>
            )}
            {inv.status === 'sent' && (
              <>
                <StatusForm to="paid" label="✓ Als bezahlt markieren" primary />
                <StatusForm to="draft" label="Zurück auf Entwurf" />
                <StatusForm to="cancelled" label="Stornieren" />
              </>
            )}
            {(inv.status === 'draft' || inv.status === 'cancelled') && (
              <form action={deleteInvoice}>
                <input type="hidden" name="id" value={inv.id} />
                <button className="btn-sm btn-danger" type="submit">Löschen</button>
              </form>
            )}
          </div>
        </div>
        {inv.status === 'draft' && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            Entwurf: noch änderbar. Nach „versendet" ist die Rechnung fixiert (Bearbeiten gesperrt) —
            so bleiben Nummernkreis und Inhalte revisionssicher.
          </p>
        )}
        {canMail && !smtpOk && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            📧 Direktversand inaktiv — Postfach-Zugangsdaten unter{' '}
            <Link href="/rechnungen/einstellungen">Einstellungen</Link> im Abschnitt
            „E-Mail-Versand (SMTP)" hinterlegen.
          </p>
        )}
        {canMail && smtpOk && !inv.c_email && (
          <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
            📧 Direktversand: beim Empfänger ist keine E-Mail-Adresse hinterlegt
            {inv.status === 'draft' && <> — über <Link href={`/rechnungen/${inv.id}/bearbeiten`}>Bearbeiten</Link> ergänzen</>}.
          </p>
        )}
        {missing.length > 0 && (
          <p style={{ margin: '10px 0 0', fontSize: 12, color: '#ffd27a' }}>
            ⚠️ Für eine <strong>gültige XRechnung</strong> fehlt noch: {missing.join(' · ')} —{' '}
            <Link href="/rechnungen/einstellungen">Einstellungen</Link>
            {inv.status === 'draft' && <> / <Link href={`/rechnungen/${inv.id}/bearbeiten`}>Rechnung bearbeiten</Link></>}
          </p>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>Empfänger</h2>
          <div style={{ lineHeight: 1.6 }}>
            <strong>{inv.c_name}</strong>
            {inv.c_contact && <div>{inv.c_contact}</div>}
            {inv.c_street && <div>{inv.c_street}</div>}
            {(inv.c_zip || inv.c_city) && <div>{[inv.c_zip, inv.c_city].filter(Boolean).join(' ')}</div>}
            {inv.c_country !== 'DE' && <div>{inv.c_country}</div>}
            {inv.c_email && <div className="muted">{inv.c_email}</div>}
            {inv.c_vat_id && <div className="muted">USt-IdNr. {inv.c_vat_id}</div>}
            {inv.c_reference && <div className="muted">Referenz {inv.c_reference}</div>}
          </div>
        </div>
        <div className="card">
          <h2>Eckdaten</h2>
          <table>
            <tbody>
              <tr><td className="muted">Rechnungsdatum</td><td>{fmtDate(inv.issue_date)}</td></tr>
              <tr><td className="muted">Zahlbar bis</td><td>{fmtDate(inv.due_date)}</td></tr>
              <tr><td className="muted">Leistungszeitraum</td>
                  <td>{inv.service_start ? `${fmtDate(inv.service_start)} – ${fmtDate(inv.service_end)}` : '—'}</td></tr>
              {inv.paid_at && <tr><td className="muted">Bezahlt am</td><td style={{ color: '#34c759' }}>{fmtDate(inv.paid_at)}</td></tr>}
            </tbody>
          </table>
          {inv.note && <p className="muted" style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{inv.note}</p>}
        </div>
      </div>

      <div className="card">
        <h2>Positionen</h2>
        <table>
          <thead>
            <tr>
              <th>Pos.</th><th>Beschreibung</th><th style={{ textAlign: 'right' }}>Menge</th><th>Einheit</th>
              <th style={{ textAlign: 'right' }}>Einzelpreis</th>
              {!inv.small_business && <th style={{ textAlign: 'right' }}>USt</th>}
              <th style={{ textAlign: 'right' }}>Betrag</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="muted">{i + 1}</td>
                <td style={{ whiteSpace: 'pre-wrap' }}>{it.description}</td>
                <td style={{ textAlign: 'right' }}>{it.quantity}</td>
                <td className="muted">{UNITS[it.unit] || it.unit}</td>
                <td style={{ textAlign: 'right' }}>{eur(it.unit_price)}</td>
                {!inv.small_business && <td style={{ textAlign: 'right' }} className="muted">{it.vat_rate} %</td>}
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{eur(round2(it.quantity * it.unit_price))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {!inv.small_business && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'right' }}>Netto</td>
                <td colSpan={2} style={{ textAlign: 'right' }}>{eur(t.net)}</td>
              </tr>
            )}
            {!inv.small_business && t.taxByRate.map((g) => (
              <tr key={g.rate}>
                <td colSpan={5} className="muted" style={{ textAlign: 'right' }}>USt {g.rate} %</td>
                <td colSpan={2} style={{ textAlign: 'right' }}>{eur(g.tax)}</td>
              </tr>
            ))}
            <tr>
              <td colSpan={inv.small_business ? 4 : 5} style={{ textAlign: 'right', fontWeight: 700 }}>Gesamtbetrag</td>
              <td colSpan={2} style={{ textAlign: 'right', fontWeight: 700, color: '#34c759' }}>{eur(gross)}</td>
            </tr>
          </tfoot>
        </table>
        {inv.small_business && (
          <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.
          </p>
        )}
      </div>
    </div>
  );
}
