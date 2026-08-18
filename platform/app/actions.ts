'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sql, ensureSchema } from '@/lib/db';
import { geocodeAddress } from '@/lib/geo';
import { signToken, SESSION_COOKIE } from '@/lib/auth';
import { computeTotals, nextInvoiceNumber, getCompany, loadInvoice, type InvoiceItem } from '@/lib/invoices';
import { sendInvoiceMail } from '@/lib/invoice-mail';

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

// ---- Rechnungen ----
export async function saveCompanySettings(formData: FormData) {
  await ensureSchema();
  const s = (k: string) => String(formData.get(k) || '').trim();
  const smallBusiness = formData.get('small_business') != null;
  const paymentDays = Math.max(0, parseInt(s('payment_days') || '14', 10) || 14);
  const prefix = (s('invoice_prefix') || 'RE').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'RE';
  const smtpPort = parseInt(s('smtp_port') || '587', 10) || 587;
  // Leeres Passwortfeld = gespeichertes Passwort behalten (es wird im Formular
  // nie wieder angezeigt, nur ueberschrieben).
  let smtpPass = s('smtp_pass');
  if (!smtpPass) {
    try {
      const r = await sql`select smtp_pass from company_settings where id = 1`;
      smtpPass = r.rows[0]?.smtp_pass || '';
    } catch {}
  }
  try {
    await sql`
      insert into company_settings (id, name, owner, street, zip, city, country, email, phone, website,
                                    tax_number, vat_id, iban, bic, bank_name,
                                    small_business, payment_days, invoice_prefix, invoice_footer,
                                    smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from, smtp_bcc, updated_at)
      values (1, ${s('name')}, ${s('owner')}, ${s('street')}, ${s('zip')}, ${s('city')}, ${s('country') || 'DE'},
              ${s('email')}, ${s('phone')}, ${s('website')},
              ${s('tax_number')}, ${s('vat_id')}, ${s('iban')}, ${s('bic')}, ${s('bank_name')},
              ${smallBusiness}, ${paymentDays}, ${prefix}, ${s('invoice_footer')},
              ${s('smtp_host')}, ${smtpPort}, ${s('smtp_user')}, ${smtpPass}, ${s('smtp_from')}, ${s('smtp_bcc')}, now())
      on conflict (id) do update set
        name = excluded.name, owner = excluded.owner, street = excluded.street,
        zip = excluded.zip, city = excluded.city, country = excluded.country,
        email = excluded.email, phone = excluded.phone, website = excluded.website,
        tax_number = excluded.tax_number, vat_id = excluded.vat_id,
        iban = excluded.iban, bic = excluded.bic, bank_name = excluded.bank_name,
        small_business = excluded.small_business, payment_days = excluded.payment_days,
        invoice_prefix = excluded.invoice_prefix, invoice_footer = excluded.invoice_footer,
        smtp_host = excluded.smtp_host, smtp_port = excluded.smtp_port,
        smtp_user = excluded.smtp_user, smtp_pass = excluded.smtp_pass,
        smtp_from = excluded.smtp_from, smtp_bcc = excluded.smtp_bcc,
        updated_at = now()
    `;
  } catch { /* Tabelle evtl. noch nicht angelegt */ }
  revalidatePath('/rechnungen');
  redirect('/rechnungen/einstellungen?saved=1');
}

// Positionen aus dem (per hidden field uebergebenen) JSON lesen und absichern.
function parseInvoiceItems(formData: FormData, smallBusiness: boolean): InvoiceItem[] {
  let raw: any[] = [];
  try { raw = JSON.parse(String(formData.get('items') || '[]')); } catch {}
  const items: InvoiceItem[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const description = String(r?.description || '').trim();
    if (!description) continue;
    const quantity = Math.max(0, Number(r?.quantity) || 0);
    const unit = ['C62', 'MON', 'HUR', 'DAY'].includes(String(r?.unit)) ? String(r.unit) : 'C62';
    const unit_price = Math.round((Number(r?.unit_price) || 0) * 100) / 100;
    let vat_rate = [19, 7, 0].includes(Number(r?.vat_rate)) ? Number(r.vat_rate) : 19;
    if (smallBusiness) vat_rate = 0; // § 19 UStG: nie USt ausweisen
    items.push({ position: items.length, description, quantity, unit, unit_price, vat_rate });
  }
  return items;
}

function invoiceFieldsFrom(formData: FormData) {
  const s = (k: string) => String(formData.get(k) || '').trim();
  const d = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s(k)) ? s(k) : null);
  return {
    issue_date: d('issue_date') || new Date().toISOString().slice(0, 10),
    due_date: d('due_date'),
    service_start: d('service_start'),
    service_end: d('service_end'),
    c_name: s('c_name'),
    c_contact: s('c_contact') || null,
    c_street: s('c_street') || null,
    c_zip: s('c_zip') || null,
    c_city: s('c_city') || null,
    c_country: (s('c_country') || 'DE').toUpperCase().slice(0, 2),
    c_email: s('c_email') || null,
    c_vat_id: s('c_vat_id') || null,
    c_reference: s('c_reference') || null,
    note: s('note') || null,
  };
}

export async function createInvoice(formData: FormData) {
  await ensureSchema();
  const company = await getCompany();
  const f = invoiceFieldsFrom(formData);
  const items = parseInvoiceItems(formData, company.small_business);
  if (!f.c_name || items.length === 0) redirect('/rechnungen/neu?error=leer');
  const t = computeTotals(items);
  const gross = company.small_business ? t.net : t.gross;
  const tax = company.small_business ? 0 : t.tax;

  // Fortlaufende Nummer; bei (sehr unwahrscheinlicher) Kollision neu versuchen.
  let id = '';
  for (let attempt = 0; attempt < 3 && !id; attempt++) {
    const number = await nextInvoiceNumber(company.invoice_prefix);
    try {
      const { rows } = await sql`
        insert into invoices (number, issue_date, due_date, service_start, service_end,
                              c_name, c_contact, c_street, c_zip, c_city, c_country,
                              c_email, c_vat_id, c_reference, note, small_business,
                              net_total, tax_total, gross_total)
        values (${number}, ${f.issue_date}, ${f.due_date}, ${f.service_start}, ${f.service_end},
                ${f.c_name}, ${f.c_contact}, ${f.c_street}, ${f.c_zip}, ${f.c_city}, ${f.c_country},
                ${f.c_email}, ${f.c_vat_id}, ${f.c_reference}, ${f.note}, ${company.small_business},
                ${t.net}, ${tax}, ${gross})
        returning id
      `;
      id = rows[0].id;
    } catch (e) {
      if (!/unique|duplicate/i.test((e as Error).message) || attempt === 2) throw e;
    }
  }
  for (const it of items) {
    await sql`
      insert into invoice_items (invoice_id, position, description, quantity, unit, unit_price, vat_rate)
      values (${id}, ${it.position}, ${it.description}, ${it.quantity}, ${it.unit}, ${it.unit_price}, ${it.vat_rate})
    `;
  }
  revalidatePath('/rechnungen');
  redirect(`/rechnungen/${id}`);
}

export async function updateInvoice(formData: FormData) {
  await ensureSchema();
  const id = String(formData.get('id') || '');
  if (!id) redirect('/rechnungen');
  const { rows } = await sql`select status, small_business from invoices where id = ${id} limit 1`;
  if (!rows[0]) redirect('/rechnungen');
  if (rows[0].status !== 'draft') redirect(`/rechnungen/${id}`); // nur Entwuerfe aenderbar
  const smallBusiness = !!rows[0].small_business;
  const f = invoiceFieldsFrom(formData);
  const items = parseInvoiceItems(formData, smallBusiness);
  if (!f.c_name || items.length === 0) redirect(`/rechnungen/${id}/bearbeiten?error=leer`);
  const t = computeTotals(items);
  await sql`
    update invoices set
      issue_date = ${f.issue_date}, due_date = ${f.due_date},
      service_start = ${f.service_start}, service_end = ${f.service_end},
      c_name = ${f.c_name}, c_contact = ${f.c_contact}, c_street = ${f.c_street},
      c_zip = ${f.c_zip}, c_city = ${f.c_city}, c_country = ${f.c_country},
      c_email = ${f.c_email}, c_vat_id = ${f.c_vat_id}, c_reference = ${f.c_reference},
      note = ${f.note},
      net_total = ${t.net}, tax_total = ${smallBusiness ? 0 : t.tax},
      gross_total = ${smallBusiness ? t.net : t.gross}
    where id = ${id}
  `;
  await sql`delete from invoice_items where invoice_id = ${id}`;
  for (const it of items) {
    await sql`
      insert into invoice_items (invoice_id, position, description, quantity, unit, unit_price, vat_rate)
      values (${id}, ${it.position}, ${it.description}, ${it.quantity}, ${it.unit}, ${it.unit_price}, ${it.vat_rate})
    `;
  }
  revalidatePath('/rechnungen');
  revalidatePath(`/rechnungen/${id}`);
  redirect(`/rechnungen/${id}`);
}

// Statuswechsel mit erlaubten Uebergaengen (Entwurf -> Offen -> Bezahlt/Storno).
export async function setInvoiceStatus(formData: FormData) {
  const id = String(formData.get('id') || '');
  const to = String(formData.get('to') || '');
  const allowed: Record<string, string[]> = {
    sent: ['draft'],
    paid: ['sent'],
    cancelled: ['draft', 'sent'],
    draft: ['sent'], // zurueck auf Entwurf (falls versehentlich markiert)
  };
  const from = allowed[to];
  if (!id || !from) redirect('/rechnungen');
  try {
    const { rows } = await sql`select status from invoices where id = ${id} limit 1`;
    if (rows[0] && from.includes(rows[0].status)) {
      if (to === 'paid') {
        await sql`update invoices set status = 'paid', paid_at = current_date where id = ${id}`;
      } else {
        await sql`update invoices set status = ${to}, paid_at = null where id = ${id}`;
      }
    }
  } catch { /* Tabelle evtl. noch nicht angelegt */ }
  revalidatePath('/rechnungen');
  revalidatePath(`/rechnungen/${id}`);
}

// Rechnung per E-Mail an den Empfaenger senden (PDF + XRechnung als Anhang).
// Bei Erfolg wird ein Entwurf automatisch auf "versendet" gesetzt.
export async function sendInvoiceEmail(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (!id) redirect('/rechnungen');
  const data = await loadInvoice(id);
  if (!data) redirect('/rechnungen');
  const company = await getCompany();
  const res = await sendInvoiceMail(data.invoice, data.items, company);
  if (res.ok) {
    try { await sql`update invoices set status = 'sent' where id = ${id} and status = 'draft'`; } catch {}
    revalidatePath('/rechnungen');
    revalidatePath(`/rechnungen/${id}`);
    redirect(`/rechnungen/${id}?mailed=${encodeURIComponent(res.to || '1')}${res.withXml ? '' : '&noxml=1'}`);
  }
  redirect(`/rechnungen/${id}?mailerror=${encodeURIComponent(res.error || 'unbekannter Fehler')}`);
}

export async function deleteInvoice(formData: FormData) {
  const id = String(formData.get('id') || '');
  try {
    // Nur Entwuerfe/Stornos loeschen — versendete Rechnungen bleiben (GoBD).
    await sql`delete from invoices where id = ${id} and status in ('draft', 'cancelled')`;
  } catch {}
  revalidatePath('/rechnungen');
  redirect('/rechnungen');
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
