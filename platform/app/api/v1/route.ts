import { requireApi, ok } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Selbstdokumentierender Einstieg: GET /api/v1
export async function GET(request: Request) {
  const denied = requireApi(request);
  if (denied) return denied;
  return ok({
    name: 'kiosk-display API',
    version: 'v1',
    auth: 'Authorization: Bearer <KIOSK_API_KEY>  (oder ?api_key=<KIOSK_API_KEY>)',
    endpoints: {
      'GET    /api/v1/devices': 'Geräte auflisten',
      'POST   /api/v1/devices': 'Gerät anlegen { name, location? }',
      'GET    /api/v1/devices/{id}': 'Gerät inkl. Agent-Token',
      'PATCH  /api/v1/devices/{id}': 'ändern { name?, rotation_interval?, idle_timeout?, screen_on_time?, screen_off_time?, remote_url?, location?, lat?, lng? }',
      'DELETE /api/v1/devices/{id}': 'Gerät löschen',
      'GET    /api/v1/devices/{id}/sites': 'Seiten/Medien auflisten',
      'POST   /api/v1/devices/{id}/sites': 'anlegen { name, url, type?(web|image|video), duration?, enabled?, invoiced? }',
      'PATCH  /api/v1/sites/{siteId}': 'Seite ändern { name?, url?, duration?, enabled?, type?, invoiced?, position? }',
      'DELETE /api/v1/sites/{siteId}': 'Seite löschen',
      'GET    /api/v1/devices/{id}/commands': 'letzte Befehle',
      'POST   /api/v1/devices/{id}/commands': 'Befehl senden { type: start_app|stop_app|restart_app|reboot|reload_config }',
      'GET    /api/v1/devices/{id}/stats?days=7': 'Wiedergabe-/Interaktions-Statistik',
      'POST   /api/v1/media?filename=...': 'Datei (Bild/Video) als Roh-Body hochladen -> { url }',
    },
  });
}
