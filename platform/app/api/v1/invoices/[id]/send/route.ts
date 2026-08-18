// REST-API: Rechnung per E-Mail an den Empfaenger senden (SMTP, wie der
// Dashboard-Knopf). Anhaenge: PDF immer, XRechnung-XML wenn vollstaendig.
// Ein Entwurf wird bei Erfolg automatisch auf "versendet" gesetzt.
//   POST /api/v1/invoices/{id}/send
import { sql, ensureSchema } from '@/lib/db';
import { requireApi, ok, err } from '@/lib/api';
import { loadInvoice, getCompany } from '@/lib/invoices';
import { sendInvoiceMail, smtpConfigured } from '@/lib/invoice-mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  await ensureSchema();
  const data = await loadInvoice(id);
  if (!data) return err('Rechnung nicht gefunden', 404);
  if (data.invoice.status === 'cancelled') return err('Rechnung ist storniert', 409);
  const company = await getCompany();
  if (!smtpConfigured(company)) {
    return err('SMTP nicht konfiguriert — unter Rechnungen → Einstellungen → E-Mail-Versand hinterlegen', 503);
  }
  const res = await sendInvoiceMail(data.invoice, data.items, company);
  if (!res.ok) return err(res.error || 'Versand fehlgeschlagen', 502);
  if (data.invoice.status === 'draft') {
    try { await sql`update invoices set status = 'sent' where id = ${id} and status = 'draft'`; } catch {}
  }
  return ok({ sent: true, to: res.to, with_xrechnung: !!res.withXml, number: data.invoice.number });
}
