import Link from 'next/link';
import { getCompany } from '@/lib/invoices';
import { saveCompanySettings, saveAndTestSmtp } from '../../actions';

export const dynamic = 'force-dynamic';

export default async function RechnungsEinstellungen({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; mailtest?: string; mailtesterror?: string }>;
}) {
  const { saved, mailtest, mailtesterror } = await searchParams;
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
      {mailtest && (
        <div className="card" style={{ borderColor: '#2a4a33', background: '#162016' }}>
          <span style={{ color: '#34c759' }}>
            ✓ Gespeichert und Testmail an <strong>{mailtest}</strong> verschickt — bitte Posteingang
            (auch Spam-Ordner) prüfen.
          </span>
        </div>
      )}
      {mailtesterror && (
        <div className="card" style={{ borderColor: '#5a2a2a', background: '#241616' }}>
          <span style={{ color: '#ff9a9a' }}>
            ✗ Gespeichert, aber Testmail fehlgeschlagen: {mailtesterror}
          </span>
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
          <h2>E-Mail-Versand (SMTP)</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
            Zugangsdaten deines Postfachs — dieselben wie in einer Mail-App (das Sende-Gegenstück
            zu IMAP). Damit verschickt das Tool Rechnungen direkt per Knopf
            „📧 Per E-Mail senden" (PDF + XRechnung im Anhang).
          </p>
          <div className="grid2">
            <div>
              <label>SMTP-Server (Host)</label>
              <input name="smtp_host" defaultValue={c.smtp_host} style={inp}
                     placeholder="z. B. smtp.ionos.de / smtp.strato.de" />
            </div>
            <div>
              <label>Port (587 = Standard, 465 = SSL)</label>
              <input name="smtp_port" type="number" defaultValue={c.smtp_port || 587} style={inp} />
            </div>
          </div>
          <div className="grid2">
            <div>
              <label>Benutzer (meist deine E-Mail-Adresse)</label>
              <input name="smtp_user" defaultValue={c.smtp_user} style={inp} placeholder="rechnung@…" />
            </div>
            <div>
              <label>Passwort {c.smtp_pass ? '(gespeichert — leer lassen zum Behalten)' : ''}</label>
              <input name="smtp_pass" type="password" autoComplete="new-password" style={inp}
                     placeholder={c.smtp_pass ? '••••••••' : 'Postfach-Passwort'} />
            </div>
          </div>
          <div className="grid2">
            <div>
              <label>Absenderanzeige (optional)</label>
              <input name="smtp_from" defaultValue={c.smtp_from} style={inp}
                     placeholder={`z. B. microwerbung <rechnung@…>`} />
            </div>
            <div>
              <label>Kopie an dich (BCC, optional)</label>
              <input name="smtp_bcc" defaultValue={c.smtp_bcc} style={inp}
                     placeholder="deine@adresse.de" />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Tipp: BCC an dich selbst setzen — dann liegt jede versendete Rechnung als Kopie in
            deinem Postfach (SMTP befüllt den „Gesendet"-Ordner nicht). Bei Gmail/Outlook ein
            App-Passwort verwenden. Das Passwort wird in der Datenbank der Plattform gespeichert.
          </p>
          <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 200, maxWidth: 320 }}>
              <label>Testmail an (leer = BCC bzw. Firmen-E-Mail)</label>
              <input name="smtp_test_to" placeholder="deine@adresse.de" style={{ width: '100%' }} />
            </div>
            <button className="btn-sm" formAction={saveAndTestSmtp} type="submit"
                    style={{ border: '1px solid #2a4a33', color: '#34c759' }}>
              💾 Speichern &amp; Testmail senden
            </button>
          </div>
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
