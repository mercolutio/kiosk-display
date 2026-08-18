import Link from 'next/link';
import { getCompany } from '@/lib/invoices';
import { saveCompanySettings } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function RechnungsEinstellungen({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const c = await getCompany();
  const inp = { width: '100%' } as const;

  return (
    <div className="container">
      <div className="header">
        <h1><Link href="/rechnungen">← Rechnungen</Link> / Einstellungen</h1>
      </div>

      {saved && (
        <div className="card" style={{ borderColor: '#2a4a33', background: '#162016' }}>
          <span style={{ color: '#34c759' }}>✓ Gespeichert.</span>
        </div>
      )}

      <form action={saveCompanySettings}>
        <div className="card">
          <h2>Eigene Firmendaten (Rechnungsabsender)</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            Mit * markierte Felder braucht die <strong>E-Rechnung (XRechnung)</strong>, damit sie
            beim Empfänger gültig validiert.
          </p>
          <div className="grid2">
            <div>
              <label>Firmenname *</label>
              <input name="name" defaultValue={c.name} required style={inp} placeholder="z. B. microwerbung" />
            </div>
            <div>
              <label>Inhaber / Ansprechpartner</label>
              <input name="owner" defaultValue={c.owner} style={inp} />
            </div>
          </div>
          <label>Straße und Hausnummer *</label>
          <input name="street" defaultValue={c.street} style={inp} />
          <div className="row">
            <div style={{ width: 120 }}>
              <label>PLZ *</label>
              <input name="zip" defaultValue={c.zip} style={inp} />
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label>Ort *</label>
              <input name="city" defaultValue={c.city} style={inp} />
            </div>
            <div style={{ width: 80 }}>
              <label>Land</label>
              <input name="country" defaultValue={c.country} maxLength={2} style={inp} />
            </div>
          </div>
          <div className="grid2">
            <div>
              <label>E-Mail *</label>
              <input name="email" type="email" defaultValue={c.email} style={inp} />
            </div>
            <div>
              <label>Telefon *</label>
              <input name="phone" defaultValue={c.phone} style={inp} />
            </div>
          </div>
          <label>Webseite</label>
          <input name="website" defaultValue={c.website} style={{ width: '100%', maxWidth: 340 }} />
        </div>

        <div className="card">
          <h2>Steuern</h2>
          <div className="grid2">
            <div>
              <label>Steuernummer (oder USt-IdNr.) *</label>
              <input name="tax_number" defaultValue={c.tax_number} style={inp} placeholder="z. B. 38/123/45678" />
            </div>
            <div>
              <label>USt-IdNr. (falls vorhanden)</label>
              <input name="vat_id" defaultValue={c.vat_id} style={inp} placeholder="DE123456789" />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13, color: '#e8e8ea' }}>
            <input type="checkbox" name="small_business" defaultChecked={c.small_business} style={{ width: 'auto' }} />
            Kleinunternehmer nach § 19 UStG (Rechnungen ohne Umsatzsteuer)
          </label>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Wenn aktiv, wird auf allen neuen Rechnungen keine USt ausgewiesen und der Pflichthinweis
            zu § 19 UStG ergänzt (auch in der XRechnung als Steuerkategorie „befreit").
          </p>
        </div>

        <div className="card">
          <h2>Bankverbindung</h2>
          <div className="grid2">
            <div>
              <label>IBAN (empfohlen — landet als Zahlungsweg in der E-Rechnung)</label>
              <input name="iban" defaultValue={c.iban} style={inp} placeholder="DE.." />
            </div>
            <div>
              <label>BIC</label>
              <input name="bic" defaultValue={c.bic} style={inp} />
            </div>
          </div>
          <label>Bank</label>
          <input name="bank_name" defaultValue={c.bank_name} style={{ width: '100%', maxWidth: 340 }} />
        </div>

        <div className="card">
          <h2>Rechnungsstellung</h2>
          <div className="row">
            <div style={{ width: 160 }}>
              <label>Zahlungsziel (Tage)</label>
              <input name="payment_days" type="number" min={0} defaultValue={c.payment_days} style={inp} />
            </div>
            <div style={{ width: 160 }}>
              <label>Nummern-Präfix</label>
              <input name="invoice_prefix" defaultValue={c.invoice_prefix} style={inp} />
            </div>
            <div className="muted" style={{ paddingTop: 26, fontSize: 12 }}>
              Nummernformat: {c.invoice_prefix}-{new Date().getFullYear()}-
              {String(new Date().getMonth() + 1).padStart(2, '0')}-0001 (fortlaufend je Monat)
            </div>
          </div>
          <label>Fußtext auf der PDF (optional)</label>
          <textarea name="invoice_footer" defaultValue={c.invoice_footer} rows={2} style={{ width: '100%' }}
                    placeholder="z. B. Inhaltlich verantwortlich … / Es gelten unsere AGB." />
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn-primary" type="submit">Speichern</button>
        </div>
      </form>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Was ist die E-Rechnung?</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          Seit 2025 ist im B2B-Geschäft in Deutschland die <strong>E-Rechnung</strong> Standard: ein
          strukturiertes XML nach EN 16931 (Format „XRechnung"). Eine normale PDF gilt nur noch als
          „sonstige Rechnung". Dieses Dashboard erzeugt zu jeder Rechnung beides:
          die <strong>PDF</strong> zum Lesen/Drucken und die <strong>XRechnung (XML)</strong> zum
          Versand an Geschäftskunden und Behörden — einfach per E-Mail als Anhang verschicken.
        </p>
      </div>
    </div>
  );
}
