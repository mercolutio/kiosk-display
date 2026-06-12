// Offline-Sofort-Alarm: meldet per E-Mail, sobald ein Display laenger als
// OFFLINE_MINUTES (Standard 3) keinen Heartbeat mehr schickt — und wieder,
// wenn es zurueck ist. Laeuft serverseitig, ausgeloest bei jedem Agent-Sync
// (eines beliebigen Geraets) sowie ueber /api/cron/offline-check.
import { sql } from '@/lib/db';
import { sendMail } from '@/lib/mail';

const OFFLINE_MIN = Number(process.env.OFFLINE_MINUTES || 3);

function dashboardUrl(): string {
  return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'kiosk-display-mercolutios-projects.vercel.app'}`;
}

function alertHtml(name: string, lastSeen: string | null, recovered: boolean): string {
  const accent = recovered ? '#34c759' : '#ff6b6b';
  const icon = recovered ? '✓' : '⚠️';
  const headline = recovered ? 'Display wieder online' : 'Display offline';
  const since = lastSeen
    ? new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }).format(new Date(lastSeen))
    : '—';
  const detail = recovered
    ? `<b>${esc(name)}</b> meldet sich wieder. Alles wieder im grünen Bereich.`
    : `<b>${esc(name)}</b> hat sich seit <b>${esc(since)}</b> nicht mehr gemeldet (> ${OFFLINE_MIN} Min).`;
  return `<!doctype html><html><body style="margin:0;background:#0a0a0a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0;"><tr><td align="center">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:520px;max-width:520px;font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <tr><td style="padding:8px 12px 16px;">
      <span style="font-size:20px;font-weight:800;letter-spacing:-.5px;color:#e8e8ea;">micro<span style="color:#34c759;">werbung</span></span>
    </td></tr>
    <tr><td style="padding:0 8px;">
      <div style="background:#161618;border:1px solid ${accent};border-radius:12px;padding:18px;">
        <div style="font-size:16px;font-weight:800;color:${accent};">${icon} ${headline}</div>
        <div style="font-size:14px;color:#e8e8ea;margin-top:8px;line-height:1.6;">${detail}</div>
      </div>
    </td></tr>
    <tr><td align="center" style="padding:16px 8px 4px;">
      <a href="${dashboardUrl()}" style="display:inline-block;background:#34c759;color:#0a0a0a;font-weight:700;font-size:14px;text-decoration:none;padding:11px 22px;border-radius:10px;">Zum Dashboard öffnen</a>
    </td></tr>
    <tr><td align="center" style="padding:10px 8px 0;"><div style="color:#5a5a5f;font-size:11px;">microwerbung · automatischer Status-Alarm</div></td></tr>
  </table></td></tr></table></body></html>`;
}

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

// Geraet hat sich gerade gemeldet: war es zuvor als offline gemeldet, jetzt
// "wieder online" senden und das Flag loeschen.
export async function handleRecovery(deviceId: string): Promise<void> {
  try {
    const r = await sql`
      update devices set offline_alerted_at = null
       where id = ${deviceId} and offline_alerted_at is not null
       returning name`;
    if (r.rows[0]) {
      await sendMail({ subject: `✓ Wieder online: ${r.rows[0].name}`, html: alertHtml(r.rows[0].name, null, true) });
    }
  } catch { /* Spalte evtl. noch nicht migriert -> ignorieren */ }
}

// Flotte pruefen: Geraete, die neu die Offline-Schwelle ueberschritten haben,
// atomar "beanspruchen" (Flag setzen) und je einen Alarm senden. Gibt die Anzahl
// neu gemeldeter Ausfaelle zurueck.
export async function checkOfflineAndAlert(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - OFFLINE_MIN * 60_000).toISOString();
    const r = await sql`
      update devices set offline_alerted_at = now()
       where last_seen_at is not null
         and last_seen_at < ${cutoff}
         and offline_alerted_at is null
       returning name, last_seen_at`;
    for (const d of r.rows) {
      await sendMail({ subject: `⚠️ Display offline: ${d.name}`, html: alertHtml(d.name, d.last_seen_at, false) });
    }
    return r.rows.length;
  } catch {
    return 0; // Spalte offline_alerted_at evtl. noch nicht migriert
  }
}
