// Gemeinsame Helfer für die öffentliche REST-API (/api/v1).
// Auth: globaler Bearer-Token aus der Env-Variable KIOSK_API_KEY.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

// Prüft den API-Key. Gibt eine Fehler-Response zurück, wenn nicht autorisiert,
// sonst null (= weitermachen). Key per Header `Authorization: Bearer <key>`
// oder Query `?api_key=<key>`.
export function requireApi(request: Request): NextResponse | null {
  const key = process.env.KIOSK_API_KEY;
  if (!key) return err('API nicht konfiguriert: KIOSK_API_KEY fehlt', 503);
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const provided = (m ? m[1] : new URL(request.url).searchParams.get('api_key')) || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(key);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return err('nicht autorisiert', 401);
  return null;
}

export const ok = (data: any, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function readJson(request: Request): Promise<any> {
  try { return await request.json(); } catch { return {}; }
}

export function isOnline(lastSeen: any): boolean {
  return !!lastSeen && Date.now() - new Date(lastSeen).getTime() < 60_000;
}

export function serializeDevice(d: any, includeToken = false) {
  const out: any = {
    id: d.id,
    name: d.name,
    online: isOnline(d.last_seen_at),
    app_active: d.app_active ?? null,
    current_site: d.current_site ?? null,
    last_seen_at: d.last_seen_at ?? null,
    rotation_interval: d.rotation_interval ?? null,
    idle_timeout: d.idle_timeout ?? null,
    screen_on_time: d.screen_on_time ?? null,
    screen_off_time: d.screen_off_time ?? null,
    remote_url: d.remote_url ?? null,
    location: d.location ?? null,
    lat: d.lat == null ? null : Number(d.lat),
    lng: d.lng == null ? null : Number(d.lng),
    created_at: d.created_at ?? null,
  };
  if (includeToken) out.token = d.token ?? null;
  return out;
}

export function serializeSite(s: any) {
  return {
    id: s.id,
    device_id: s.device_id,
    name: s.name,
    url: s.url,
    type: s.type ?? 'web',
    duration: s.duration ?? null,
    position: s.position ?? 0,
    enabled: s.enabled ?? true,
    invoiced: s.invoiced ?? true,
    created_at: s.created_at ?? null,
  };
}

export const SITE_TYPES = ['web', 'image', 'video'];
export const COMMAND_TYPES = ['restart_app', 'stop_app', 'start_app', 'reboot', 'reload_config'];
