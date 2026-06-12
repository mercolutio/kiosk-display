// Gemeinsamer E-Mail-Versand ueber Resend (fuer Alarme & Reports).
// Konfiguration via Env: RESEND_API_KEY, REPORT_FROM, REPORT_TO.

const DEFAULT_FROM = 'microwerbung <onboarding@resend.dev>';
const DEFAULT_TO = 'd.schloesser@mercolutio.com';

export function reportRecipients(): string[] {
  return (process.env.REPORT_TO || DEFAULT_TO)
    .split(',').map((s) => s.trim()).filter(Boolean);
}

export async function sendMail(opts: { subject: string; html: string; to?: string[] }):
  Promise<{ ok: boolean; id?: string; status?: number; error?: any }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY fehlt' };
  const to = opts.to && opts.to.length ? opts.to : reportRecipients();
  const from = process.env.REPORT_FROM || DEFAULT_FROM;
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject: opts.subject, html: opts.html }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error('[mail] Resend-Fehler', resp.status, JSON.stringify(body));
      return { ok: false, status: resp.status, error: body };
    }
    return { ok: true, id: (body as any).id };
  } catch (e: any) {
    console.error('[mail] Fehler', e?.message);
    return { ok: false, error: String(e?.message || e) };
  }
}
