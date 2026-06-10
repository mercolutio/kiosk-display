'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sql } from '@/lib/db';
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
  await sql`
    update devices
       set name = ${name}, rotation_interval = ${rotation}, idle_timeout = ${idle},
           screen_on_time = ${onTime}, screen_off_time = ${offTime}
     where id = ${id}
  `;
  revalidatePath(`/devices/${id}`);
}

// ---- Seiten ----
export async function addSite(formData: FormData) {
  const deviceId = String(formData.get('device_id') || '');
  const name = String(formData.get('name') || '').trim();
  const url = String(formData.get('url') || '').trim();
  const durationRaw = String(formData.get('duration') || '').trim();
  const duration = durationRaw ? parseInt(durationRaw, 10) : null;
  if (deviceId && name && url) {
    const { rows } = await sql`
      select coalesce(max(position), -1) + 1 as pos from sites where device_id = ${deviceId}
    `;
    await sql`
      insert into sites (device_id, name, url, duration, position)
      values (${deviceId}, ${name}, ${url}, ${duration}, ${rows[0].pos})
    `;
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
  await sql`
    update sites set name = ${name}, url = ${url}, duration = ${duration}, enabled = ${enabled}
     where id = ${id}
  `;
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

// ---- Befehle (Fernsteuerung) ----
export async function enqueueCommand(formData: FormData) {
  const deviceId = String(formData.get('device_id') || '');
  const type = String(formData.get('type') || '');
  if (deviceId && ['restart_app', 'reboot', 'reload_config'].includes(type)) {
    await sql`insert into commands (device_id, type) values (${deviceId}, ${type})`;
  }
  revalidatePath(`/devices/${deviceId}`);
}
