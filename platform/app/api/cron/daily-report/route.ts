// Taeglicher Report per E-Mail (Resend), ausgeloest per Vercel-Cron.
//
// Cron laeuft 18:00 UND 19:00 UTC; gesendet wird nur, wenn es in Europe/Berlin
// gerade 20:00 ist -> exakt 20:00 Ortszeit, sommerzeit-/winterzeitsicher.
//
// Schutz: erfordert Authorization: Bearer <CRON_SECRET> (setzt Vercel beim Cron
// automatisch) oder ?secret=<CRON_SECRET>. Mit ?test=1 wird die Uhrzeit-Sperre
// uebersprungen (zum manuellen Ausloesen).
//
// Env: RESEND_API_KEY, CRON_SECRET, optional REPORT_FROM, REPORT_TO.
import { sql } from '@/lib/db';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = 'Europe/Berlin';
const DEFAULT_FROM = 'microwerbung Report <onboarding@resend.dev>';
// Standard-Empfaenger. info@velvetgreen-immobilien.de wieder aufnehmen
// (kommagetrennt via REPORT_TO oder hier), sobald in Resend eine Domain
// verifiziert und REPORT_FROM gesetzt ist — sonst lehnt Resend Fremdadressen ab.
const DEFAULT_TO = 'd.schloesser@mercolutio.com';

function esc(s: any): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}
function isOnline(ts: any): boolean {
  return !!ts && Date.now() - new Date(ts).getTime() < 120_000;
}
function berlinHour(): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === 'hour')?.value ?? -1);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const secret = process.env.CRON_SECRET || '';
  const auth = req.headers.get('authorization') || '';
  const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (url.searchParams.get('secret') || '');
  if (!secret || provided !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const isTest = url.searchParams.get('test') === '1';
  if (!isTest && berlinHour() !== 20) {
    return NextResponse.json({ skipped: true, reason: 'nicht 20 Uhr (Europe/Berlin)' });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY fehlt' }, { status: 500 });
  }

  // ---- Daten holen ----
  const { rows: devices } = await sql`select id, name, last_seen_at, current_site from devices order by created_at asc`;
  const { rows: siteRows } = await sql`
    select device_id, url, seconds, views, pauses, pause_seconds
      from site_stats where day = current_date`;
  const { rows: siteNames } = await sql`select url, max(name) as name from sites group by url`;
  const { rows: errs } = await sql`
    select device_id, message, created_at from events
     where created_at >= current_date and level = 'error'
     order by created_at desc limit 10`;
  let avgPrev = 0;
  try {
    const { rows } = await sql`
      select coalesce(round(avg(daily)), 0)::int as avg_seconds from (
        select day, sum(seconds) as daily from site_stats
         where day >= current_date - 7 and day < current_date group by day) t`;
    avgPrev = rows[0]?.avg_seconds || 0;
  } catch { /* egal */ }

  // ---- Aggregieren ----
  const nameByUrl: Record<string, string> = {};
  for (const r of siteNames as any[]) nameByUrl[r.url] = r.name;
  const deviceNameById: Record<string, string> = {};
  for (const d of devices as any[]) deviceNameById[d.id] = d.name;

  const deviceTotals: Record<string, any> = {};
  const deviceTop: Record<string, any> = {};
  const byUrl: Record<string, any> = {};
  let fleetSeconds = 0, fleetPauses = 0, fleetPauseSeconds = 0;
  for (const r of siteRows as any[]) {
    const dt = deviceTotals[r.device_id] || { seconds: 0, pauses: 0, pause_seconds: 0 };
    dt.seconds += r.seconds; dt.pauses += r.pauses; dt.pause_seconds += r.pause_seconds;
    deviceTotals[r.device_id] = dt;
    if (!deviceTop[r.device_id] || r.seconds > deviceTop[r.device_id].seconds) {
      deviceTop[r.device_id] = { url: r.url, seconds: r.seconds };
    }
    const u = byUrl[r.url] || { url: r.url, seconds: 0, views: 0, pauses: 0, pause_seconds: 0 };
    u.seconds += r.seconds; u.views += r.views; u.pauses += r.pauses; u.pause_seconds += r.pause_seconds;
    byUrl[r.url] = u;
    fleetSeconds += r.seconds; fleetPauses += r.pauses; fleetPauseSeconds += r.pause_seconds;
  }
  const topSites = Object.values(byUrl).sort((a: any, b: any) => b.seconds - a.seconds).slice(0, 8);
  const onlineCount = (devices as any[]).filter((d) => isOnline(d.last_seen_at)).length;
  const offline = (devices as any[]).filter((d) => !isOnline(d.last_seen_at));

  const dateLong = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const dateShort = new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const dashboardUrl = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'kiosk-display-mercolutios-projects.vercel.app'}`;

  const html = buildHtml({
    dateLong, dashboardUrl, onlineCount, total: devices.length,
    fleetSeconds, fleetPauses, fleetPauseSeconds, avgPrev,
    devices, deviceTotals, deviceTop, nameByUrl, deviceNameById,
    topSites, offline, errs,
  });

  // ---- Senden ----
  const to = (process.env.REPORT_TO || DEFAULT_TO).split(',').map((s) => s.trim()).filter(Boolean);
  const from = process.env.REPORT_FROM || DEFAULT_FROM;
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject: `microwerbung · Tagesreport ${dateShort}`, html }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('[daily-report] Resend-Fehler', resp.status, JSON.stringify(body));
    return NextResponse.json({ error: 'resend', status: resp.status, body }, { status: 502 });
  }
  console.log('[daily-report] gesendet an', to.join(', '), '->', (body as any).id);
  return NextResponse.json({ sent: true, from, to, id: (body as any).id });
}

function kpi(label: string, value: string, danger = false): string {
  const accent = danger ? '#ff6b6b' : '#34c759';
  const bg = danger ? '#241617' : '#161618';
  const border = danger ? '#5a2a2a' : '#262629';
  return `<td width="33%" valign="top" style="padding:4px;">
    <div style="background:${bg};border:1px solid ${border};border-radius:12px;padding:14px;">
      <div style="font-size:21px;font-weight:800;color:${accent};line-height:1.15;">${value}</div>
      <div style="font-size:11px;color:#8a8a8f;margin-top:6px;letter-spacing:.4px;text-transform:uppercase;">${label}</div>
    </div></td>`;
}
function card(title: string, inner: string): string {
  return `<tr><td style="padding:8px;">
    <div style="background:#161618;border:1px solid #262629;border-radius:12px;padding:16px;">
      <div style="font-size:13px;font-weight:700;color:#e8e8ea;margin-bottom:12px;">${title}</div>
      ${inner}
    </div></td></tr>`;
}

function buildHtml(d: any): string {
  const {
    dateLong, dashboardUrl, onlineCount, total, fleetSeconds, fleetPauses, fleetPauseSeconds,
    avgPrev, devices, deviceTotals, deviceTop, nameByUrl, deviceNameById, topSites, offline, errs,
  } = d;

  // KPIs
  const kpis = `<table width="100%" cellpadding="0" cellspacing="0"><tr>
    ${kpi('Displays online', `${onlineCount} / ${total}`, offline.length > 0)}
    ${kpi('Anzeigezeit heute', fmtDur(fleetSeconds))}
    ${kpi('Interaktionen', `${fleetPauses}× · ${fmtDur(fleetPauseSeconds)}`)}
  </tr></table>`;

  // Auffaelligkeiten
  let issues = '';
  if (offline.length === 0 && errs.length === 0) {
    issues = `<div style="color:#34c759;font-size:13px;">✓ Alles läuft — alle Displays online, keine Fehler heute.</div>`;
  } else {
    const parts: string[] = [];
    for (const dev of offline) {
      const since = dev.last_seen_at
        ? new Intl.DateTimeFormat('de-DE', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(dev.last_seen_at))
        : 'noch nie';
      parts.push(`<div style="font-size:13px;color:#ffb4b4;padding:3px 0;">● <b>${esc(dev.name)}</b> offline — zuletzt gesehen ${esc(since)}</div>`);
    }
    for (const e of (errs as any[]).slice(0, 8)) {
      parts.push(`<div style="font-size:12px;color:#d3a3a3;padding:3px 0;">⚠️ ${esc(deviceNameById[e.device_id] || 'Gerät')}: ${esc(e.message)}</div>`);
    }
    issues = parts.join('');
  }

  // Pro Display
  const deviceRows = (devices as any[]).map((dev) => {
    const online = isOnline(dev.last_seen_at);
    const t = deviceTotals[dev.id] || { seconds: 0, pauses: 0 };
    const top = deviceTop[dev.id];
    const topName = top ? (nameByUrl[top.url] || top.url) : '—';
    return `<tr>
      <td style="padding:7px 0;border-bottom:1px solid #232326;font-size:13px;color:#e8e8ea;">
        <span style="color:${online ? '#34c759' : '#ff6b6b'};">●</span> ${esc(dev.name)}
      </td>
      <td align="right" style="padding:7px 0;border-bottom:1px solid #232326;font-size:12px;color:#9a9a9f;">
        ${fmtDur(t.seconds)} · 🖐️ ${t.pauses}× · <span style="color:#cfcfd2;">${esc(topName)}</span>
      </td></tr>`;
  }).join('');
  const deviceTable = total > 0
    ? `<table width="100%" cellpadding="0" cellspacing="0">${deviceRows}</table>`
    : `<div class="muted" style="color:#8a8a8f;font-size:13px;">Noch keine Geräte angelegt.</div>`;

  // Top-Seiten
  let topInner = '';
  if (topSites.length === 0) {
    topInner = `<div style="color:#8a8a8f;font-size:13px;">Heute noch keine Anzeigedaten erfasst.</div>`;
  } else {
    topInner = (topSites as any[]).map((s) => {
      const name = nameByUrl[s.url] || s.url;
      const pct = fleetSeconds ? Math.round((s.seconds / fleetSeconds) * 100) : 0;
      const paused = s.pauses > 0 ? ` · 🖐️ ${s.pauses}×` : '';
      return `<div style="margin-bottom:11px;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:13px;color:#e8e8ea;font-weight:600;">${esc(name)}</td>
          <td align="right" style="font-size:12px;color:#9a9a9f;white-space:nowrap;">${fmtDur(s.seconds)} · ${s.views}×${paused}</td>
        </tr></table>
        <div style="height:7px;background:#1e1e20;border-radius:4px;overflow:hidden;margin-top:4px;">
          <div style="height:7px;width:${pct}%;background:#34c759;"></div>
        </div></div>`;
    }).join('');
  }

  // 7-Tage-Trend
  let trendCard = '';
  if (avgPrev > 0) {
    const diff = fleetSeconds - avgPrev;
    const pct = Math.round((diff / avgPrev) * 100);
    const up = diff >= 0;
    trendCard = card('📈 7-Tage-Trend', `<div style="font-size:13px;color:#e8e8ea;">
      Anzeigezeit heute: <b>${fmtDur(fleetSeconds)}</b> &nbsp;·&nbsp; 7-Tage-Schnitt: ${fmtDur(avgPrev)}
      &nbsp; <span style="color:${up ? '#34c759' : '#ffb4b4'};font-weight:700;">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>
    </div>`);
  }

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;font-family:'Plus Jakarta Sans',-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <tr><td style="padding:8px 12px 18px;">
    <span style="font-size:22px;font-weight:800;letter-spacing:-.5px;color:#e8e8ea;">micro<span style="color:#34c759;">werbung</span></span>
    <div style="color:#8a8a8f;font-size:13px;margin-top:6px;">Tagesreport · ${esc(dateLong)}</div>
  </td></tr>
  <tr><td style="padding:0 8px 4px;">${kpis}</td></tr>
  ${card(offline.length || errs.length ? '⚠️ Auffälligkeiten' : '✓ Status', issues)}
  ${card('🖥️ Displays', deviceTable)}
  ${card('🏆 Top-Werbeseiten heute', topInner)}
  ${trendCard}
  <tr><td align="center" style="padding:18px 8px 6px;">
    <a href="${esc(dashboardUrl)}" style="display:inline-block;background:#34c759;color:#0a0a0a;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:10px;">Zum Dashboard öffnen</a>
  </td></tr>
  <tr><td align="center" style="padding:10px 8px 0;">
    <div style="color:#5a5a5f;font-size:11px;">microwerbung · automatischer Tagesreport · ${esc(dateLong)}</div>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}
