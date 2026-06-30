'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sql, ensureSchema } from '@/lib/db';
import { geocodeAddress } from '@/lib/geo';
import { signToken, SESSION_COOKIE } from '@/lib/auth';

// ---- Auth ----
export async function login(formData: FormData) {
  const pw = String(formData.get('password') || '');
  if (pw && pw === process.env.ADMIN_PASSWORD) {
    const token = await signToken();
    (await cookies()).set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });
    redirect('/');
  }
  redirect('/login?error=1');
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}

// ---- Geraete ----
export async function createDevice(formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  if (!name) redirect('/');
  const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
  const { rows } = await sql`
    insert into devices (name, token) values (${name}, ${token}) returning id
  `;
  redirect(`/devices/${rows[0].id}`);
}

export async function deleteDevice(formData: FormData) {
  const id = String(formData.get('id') || '');
  await sql`delete from devices where id = ${id}`;
  revalidatePath('/');
  redirect('/');
}

export async function updateDeviceSettings(formData: FormData) {
  const id = String(formData.get('id') || '');
  const name = String(formData.get('name') || '').trim();
  const rotation = parseInt(String(formData.get('rotation_interval') || '15'), 10) || 15;
  const idle = parseInt(String(formData.get('idle_timeout') || '5'), 10) || 5;
  const onTime = String(formData.get('screen_on_time') || '').trim() || null;
  const offTime = String(formData.get('screen_off_time') || '').trim() || null;
  const remoteUrl = String(formData.get('remote_url') || '').trim() || null;
  const location = String(formData.get('location') || '').trim() || null;
  await ensureSchema();
  // Bisherige Adresse/Koordinaten lesen, um zu entscheiden, ob neu verortet wird.
  let oldLocation: string | null = null;
  let hasCoords = false;
  try {
    const { rows } = await sql`select location, lat, lng from devices where id = ${id}`;
    oldLocation = rows[0]?.location ?? null;
    hasCoords = rows[0]?.lat != null && rows[0]?.lng != null;
  } catch { /* Spalten evtl. noch nicht migriert */ }
  await sql`
    update devices
       set name = ${name}, rotation_interval = ${rotation}, idle_timeout = ${idle},
           screen_on_time = ${onTime}, screen_off_time = ${offTime}
     where id = ${id}
  `;
  // Fernsteuer-Adresse + Standort separat schreiben, damit eine (noch) fehlende
  // Spalte das Speichern der uebrigen Einstellungen nicht verhindert.
  try {
    await sql`update devices set remote_url = ${remoteUrl} where id = ${id}`;
  } catch {
    /* Spalte remote_url evtl. noch nicht migriert -> ignorieren */
  }
  try {
    await sql`update devices set location = ${location} where id = ${id}`;
  } catch {
    /* Spalte location evtl. noch nicht migriert -> ignorieren */
  }
  // Adresse automatisch auf der Karte verorten — nur wenn sie neu/geändert ist
  // oder noch keine Koordinaten existieren (manuell per Klick gesetzte bleiben so
  // erhalten). Das eigentliche Kartenbild bleibt selbstgezeichnet.
  if (location && (location !== oldLocation || !hasCoords)) {
    const c = await geocodeAddress(location);
    if (c) {
      try { await sql`update devices set lat = ${c.lat}, lng = ${c.lng} where id = ${id}`; } catch {}
    }
  }
  revalidatePath('/');
  revalidatePath(`/devices/${id}`);
}

// Standort-Koordinaten setzen (per Klick auf der Karte) bzw. entfernen.
export async function setDeviceLocation(deviceId: string, lat: number, lng: number) {
  if (!deviceId || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  await ensureSchema();
  try {
    await sql`update devices set lat = ${lat}, lng = ${lng} where id = ${deviceId}`;
  } catch { /* Spalten evtl. noch nicht migriert */ }
  revalidatePath('/');
  revalidatePath(`/devices/${deviceId}`);
}

export async function clearDeviceLocation(deviceId: string) {
  if (!deviceId) return;
  await ensureSchema();
  try {
    await sql`update devices set lat = null, lng = null where id = ${deviceId}`;
  } catch { /* Spalten evtl. noch nicht migriert */ }
  revalidatePath('/');
  revalidatePath(`/devices/${deviceId}`);
}

// ---- Seiten ----
export async function addSite(formData: FormData) {
  const deviceId = String(formData.get('device_id') || '');
  const name = String(formData.get('name') || '').trim();
  const url = String(formData.get('url') || '').trim();
  const typeRaw = String(formData.get('type') || 'web').trim();
  const type = ['web', 'image', 'video'].includes(typeRaw) ? typeRaw : 'web';
  const durationRaw = String(formData.get('duration') || '').trim();
  const duration = durationRaw ? parseInt(durationRaw, 10) : null;
  const invoiced = formData.get('invoiced') != null;
  if (deviceId && name && url) {
    await ensureSchema();
    const { rows } = await sql`
      select coalesce(max(position), -1) + 1 as pos from sites where device_id = ${deviceId}
    `;
    const { rows: ins } = await sql`
      insert into sites (device_id, name, url, duration, position)
      values (${deviceId}, ${name}, ${url}, ${duration}, ${rows[0].pos})
      returning id
    `;
    // Typ + Fakturiert separat setzen -> bricht nicht, falls die Spalte noch nicht migriert ist.
    try { await sql`update sites set type = ${type} where id = ${ins[0].id}`; } catch {}
    try { await sql`update sites set invoiced = ${invoiced} where id = ${ins[0].id}`; } catch {}
  }
  revalidatePath(`/devices/${deviceId}`);
}

export async function updateSite(formData: FormData) {
  const id = String(formData.get('id') || '');
  const deviceId = String(formData.get('device_id') || '');
  const name = String(formData.get('name') || '').trim();
  const url = String(formData.get('url') || '').trim();
  const durationRaw = String(formData.get('duration') || '').trim();
  const duration = durationRaw ? parseInt(durationRaw, 10) : null;
  const enabled = formData.get('enabled') != null;
  const invoiced = formData.get('invoiced') != null;
  const typeRaw = String(formData.get('type') || '').trim();
  const type = ['web', 'image', 'video'].includes(typeRaw) ? typeRaw : '';
  await ensureSchema();
  await sql`
    update sites set name = ${name}, url = ${url}, duration = ${duration}, enabled = ${enabled}
     where id = ${id}
  `;
  if (type) { try { await sql`update sites set type = ${type} where id = ${id}`; } catch {} }
  try { await sql`update sites set invoiced = ${invoiced} where id = ${id}`; } catch {}
  revalidatePath(`/devices/${deviceId}`);
}

export async function deleteSite(formData: FormData) {
  const id = String(formData.get('id') || '');
  const deviceId = String(formData.get('device_id') || '');
  await sql`delete from sites where id = ${id}`;
  revalidatePath(`/devices/${deviceId}`);
}

export async function moveSite(formData: FormData) {
  const id = String(formData.get('id') || '');
  const deviceId = String(formData.get('device_id') || '');
  const dir = String(formData.get('dir') || '');
  const { rows: cur } = await sql`select position from sites where id = ${id}`;
  if (!cur[0]) return;
  const pos = cur[0].position;
  // Nachbar in Bewegungsrichtung holen (ohne SQL-Fragment-Komposition,
  // die @vercel/postgres nicht unterstuetzt).
  const neighRes = dir === 'up'
    ? await sql`select id, position from sites where device_id = ${deviceId} and position < ${pos} order by position desc limit 1`
    : await sql`select id, position from sites where device_id = ${deviceId} and position > ${pos} order by position asc limit 1`;
  const neigh = neighRes.rows[0];
  if (neigh) {
    await sql`update sites set position = ${neigh.position} where id = ${id}`;
    await sql`update sites set position = ${pos} where id = ${neigh.id}`;
  }
  revalidatePath(`/devices/${deviceId}`);
}

// ---- Verträge / Dokumente ----
export async function addContract(formData: FormData) {
  await ensureSchema();
  const name = String(formData.get('name') || '').trim();
  const url = String(formData.get('url') || '').trim();
  if (!name || !url) return;
  const note = String(formData.get('note') || '').trim() || null;
  const deviceId = String(formData.get('device_id') || '').trim() || null;
  const contentType = String(formData.get('content_type') || '').trim() || null;
  const size = parseInt(String(formData.get('size') || ''), 10) || null;
  const cat = String(formData.get('category') || 'blanko').trim();
  const category = cat === 'unterschrieben' ? 'unterschrieben' : 'blanko';
  try {
    const { rows } = await sql`
      insert into contracts (name, url, note, device_id, content_type, size)
      values (${name}, ${url}, ${note}, ${deviceId}, ${contentType}, ${size})
      returning id
    `;
    // Kategorie separat -> bricht nicht, falls die Spalte noch nicht migriert ist.
    try { await sql`update contracts set category = ${category} where id = ${rows[0].id}`; } catch {}
  } catch { /* contracts-Tabelle evtl. noch nicht angelegt */ }
  revalidatePath('/vertraege');
}

export async function deleteContract(formData: FormData) {
  const id = String(formData.get('id') || '');
  try { await sql`delete from contracts where id = ${id}`; } catch {}
  revalidatePath('/vertraege');
}

// Vertrag zwischen "Blanko" und "Unterschrieben" verschieben.
export async function setContractCategory(formData: FormData) {
  const id = String(formData.get('id') || '');
  const cat = String(formData.get('category') || '').trim();
  const category = cat === 'unterschrieben' ? 'unterschrieben' : 'blanko';
  try { await sql`update contracts set category = ${category} where id = ${id}`; } catch {}
  revalidatePath('/vertraege');
}

// ---- Befehle (Fernsteuerung) ----
export async function enqueueCommand(formData: FormData) {
  const deviceId = String(formData.get('device_id') || '');
  const type = String(formData.get('type') || '');
  if (deviceId && ['restart_app', 'stop_app', 'start_app', 'reboot', 'reload_config'].includes(type)) {
    try {
      await sql`insert into commands (device_id, type) values (${deviceId}, ${type})`;
    } catch {
      /* z. B. wenn die Typ-Pruefung (stop_app/start_app) in der DB noch nicht migriert ist */
    }
  }
  revalidatePath(`/devices/${deviceId}`);
}
