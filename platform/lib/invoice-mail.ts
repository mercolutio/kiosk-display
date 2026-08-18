// Rechnungsversand per E-Mail ueber das eigene Postfach (SMTP).
// Konfiguration via Env (Vercel):
//   SMTP_HOST  z. B. smtp.ionos.de / smtp.strato.de / smtp.gmail.com
//   SMTP_PORT  587 (STARTTLS, Standard) oder 465 (SSL)
//   SMTP_USER  Postfach-Benutzer (meist die E-Mail-Adresse)
//   SMTP_PASS  Postfach-Passwort (bei Gmail/Outlook: App-Passwort)
//   SMTP_FROM  optional, Absenderanzeige — Standard: "<Firma> <SMTP_USER>"
//   SMTP_BCC   optional, Kopie-Empfaenger (kommagetrennt) — so landet der
//              Versand auch bei dir (Ersatz fuer den "Gesendet"-Ordner,
//              den reines SMTP nicht befuellt)
import nodemailer from 'nodemailer';
import type { Company, Invoice, InvoiceItem } from '@/lib/invoices';
import { eur, fmtDate } from '@/lib/invoices';
import { buildInvoicePdf } from '@/lib/invoice-pdf';
import { buildXRechnung, xrechnungMissing } from '@/lib/xrechnung';

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendInvoiceMail(
  inv: Invoice, items: InvoiceItem[], company: Company,
): Promise<{ ok: boolean; error?: string; withXml?: boolean; to?: string }> {
  if (!smtpConfigured()) {
    return { ok: false, error: 'SMTP nicht konfiguriert — SMTP_HOST, SMTP_USER und SMTP_PASS in Vercel setzen' };
  }
  if (!inv.c_email) return { ok: false, error: 'Beim Empfänger ist keine E-Mail-Adresse hinterlegt' };

  const port = parseInt(process.env.SMTP_PORT || '587', 10) || 587;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  // Anhaenge: PDF immer; XRechnung nur, wenn alle Pflichtangaben da sind
  // (sonst wuerde ein invalides XML verschickt).
  const pdf = await buildInvoicePdf(inv, items, company);
  const withXml = xrechnungMissing(inv, company).length === 0;
  const attachments: { filename: string; content: Buffer }[] = [
    { filename: `Rechnung-${inv.number}.pdf`, content: Buffer.from(pdf) },
  ];
  if (withXml) {
    attachments.push({
      filename: `${inv.number}-xrechnung.xml`,
      content: Buffer.from(buildXRechnung(inv, items, company), 'utf8'),
    });
  }

  const firma = company.name || 'microwerbung';
  const addressLine = [company.street, [company.zip, company.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(' · ');
  const html = `
    <p>Sehr geehrte Damen und Herren,</p>
    <p>anbei erhalten Sie unsere Rechnung <strong>${escHtml(inv.number)}</strong>
       über <strong>${escHtml(eur(inv.gross_total))}</strong>${inv.due_date ? `,
       zahlbar bis zum ${escHtml(fmtDate(inv.due_date))}` : ''}.</p>
    <p>Im Anhang finden Sie ${withXml
      ? 'die E-Rechnung im XRechnung-Format (XML) sowie eine PDF-Ausfertigung zur Ansicht'
      : 'die Rechnung als PDF'}.</p>
    <p>Mit freundlichen Grüßen<br/>${escHtml(company.owner || firma)}<br/>${escHtml(firma)}</p>
    <p style="color:#888;font-size:12px">${escHtml(addressLine)}${company.phone ? ` · Tel. ${escHtml(company.phone)}` : ''}${company.email ? ` · ${escHtml(company.email)}` : ''}</p>
  `;

  const from = process.env.SMTP_FROM || `${firma} <${process.env.SMTP_USER}>`;
  const bcc = (process.env.SMTP_BCC || '').split(',').map((s) => s.trim()).filter(Boolean);

  try {
    await transporter.sendMail({
      from,
      to: inv.c_email,
      bcc: bcc.length ? bcc : undefined,
      subject: `Rechnung ${inv.number} — ${firma}`,
      html,
      attachments,
    });
    return { ok: true, withXml, to: inv.c_email };
  } catch (e) {
    return { ok: false, error: 'Versand fehlgeschlagen: ' + (e as Error).message };
  }
}
