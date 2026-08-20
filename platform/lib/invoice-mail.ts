// Rechnungsversand per E-Mail ueber das eigene Postfach (SMTP).
// Zugangsdaten kommen aus den Rechnungs-Einstellungen im Dashboard
// (company_settings.smtp_*); Env-Variablen (SMTP_HOST/PORT/USER/PASS/FROM/BCC)
// dienen nur noch als Fallback.
import nodemailer from 'nodemailer';
import type { Company, Invoice, InvoiceItem } from '@/lib/invoices';
import { eur, fmtDate } from '@/lib/invoices';
import { buildInvoicePdf } from '@/lib/invoice-pdf';
import { buildXRechnung, xrechnungMissing } from '@/lib/xrechnung';

// Aufgeloeste SMTP-Konfiguration: Einstellungen aus dem Tool zuerst, Env als Fallback.
export function smtpSettings(company: Company) {
  return {
    host: company.smtp_host || process.env.SMTP_HOST || '',
    port: company.smtp_port || parseInt(process.env.SMTP_PORT || '587', 10) || 587,
    user: company.smtp_user || process.env.SMTP_USER || '',
    pass: company.smtp_pass || process.env.SMTP_PASS || '',
    from: company.smtp_from || process.env.SMTP_FROM || '',
    bcc: company.smtp_bcc || process.env.SMTP_BCC || '',
  };
}

export function smtpConfigured(company: Company): boolean {
  const s = smtpSettings(company);
  return !!(s.host && s.user && s.pass);
}

const escHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Einfache Testnachricht (Knopf in den Einstellungen), um die
// SMTP-Zugangsdaten ohne echte Rechnung zu pruefen.
export async function sendTestMail(company: Company, to: string): Promise<{ ok: boolean; error?: string }> {
  if (!smtpConfigured(company)) {
    return { ok: false, error: 'SMTP nicht konfiguriert — bitte Host, Benutzer und Passwort ausfüllen' };
  }
  if (!to) return { ok: false, error: 'Keine Ziel-Adresse — Testfeld, BCC oder Firmen-E-Mail ausfüllen' };
  const smtp = smtpSettings(company);
  const transporter = nodemailer.createTransport({
    host: smtp.host, port: smtp.port, secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
  });
  const firma = company.name || 'microwerbung';
  try {
    await transporter.sendMail({
      from: smtp.from || `${firma} <${smtp.user}>`,
      to,
      subject: `Testnachricht — Rechnungsversand ${firma}`,
      html: `<p>Diese Testnachricht bestätigt: Der E-Mail-Versand des Rechnungsmoduls funktioniert.</p>
        <p style="color:#888;font-size:12px">Server ${escHtml(smtp.host)}:${smtp.port} · Absender ${escHtml(smtp.user)}</p>`,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `${(e as Error).message} — Server ${smtp.host}:${smtp.port}, Benutzer „${smtp.user}"` };
  }
}

export async function sendInvoiceMail(
  inv: Invoice, items: InvoiceItem[], company: Company,
): Promise<{ ok: boolean; error?: string; withXml?: boolean; to?: string }> {
  if (!smtpConfigured(company)) {
    return { ok: false, error: 'SMTP nicht konfiguriert — Postfach-Zugangsdaten unter Rechnungen → Einstellungen → „E-Mail-Versand" hinterlegen' };
  }
  if (!inv.c_email) return { ok: false, error: 'Beim Empfänger ist keine E-Mail-Adresse hinterlegt' };

  const smtp = smtpSettings(company);
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
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

  const from = smtp.from || `${firma} <${smtp.user}>`;
  const bcc = smtp.bcc.split(',').map((s) => s.trim()).filter(Boolean);

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
    return {
      ok: false,
      error: `Versand fehlgeschlagen: ${(e as Error).message} — Server ${smtp.host}:${smtp.port}, Benutzer „${smtp.user}"`,
    };
  }
}
