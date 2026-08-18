'use client';
// Rechnung anlegen/bearbeiten: Empfaenger, Eckdaten, dynamische Positionen mit
// Live-Summen. Kunden-Dropdown fuellt Empfaenger + Positionsvorschlaege aus den
// Display-Belegungen (Preisliste) bzw. aus der letzten Rechnung des Kunden.
import { useMemo, useState } from 'react';

export type PrefillCustomer = {
  name: string;
  devices: string[];   // Namen der fakturierten Displays
  billed: number;
  rate: number;        // €/Display laut Preisliste
  last?: {
    contact: string; street: string; zip: string; city: string; country: string;
    email: string; vat_id: string; reference: string;
  };
};

export type ItemDraft = {
  description: string;
  quantity: string;    // als Text, damit Komma-Eingabe moeglich ist
  unit: string;
  unit_price: string;
  vat_rate: number;
};

type Buyer = {
  name: string; contact: string; street: string; zip: string; city: string;
  country: string; email: string; vat_id: string; reference: string;
};

const UNIT_OPTIONS: [string, string][] = [
  ['C62', 'Stk.'],
  ['MON', 'Monat(e)'],
  ['HUR', 'Std.'],
  ['DAY', 'Tag(e)'],
];

const num = (s: string) => {
  const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
// Einfache Zahl (Menge) ohne Tausender-Logik parsen.
const qnum = (s: string) => {
  const n = parseFloat(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const eur = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

const EMPTY_ITEM: ItemDraft = { description: '', quantity: '1', unit: 'C62', unit_price: '', vat_rate: 19 };

export default function InvoiceForm(props: {
  action: (formData: FormData) => void | Promise<void>;
  customers: PrefillCustomer[];
  smallBusiness: boolean;
  serviceLabel: string;      // z. B. "August 2026" (fuer Positionsvorschlag)
  defaults: { issue: string; due: string; serviceStart: string; serviceEnd: string };
  initial?: {
    id: string;
    buyer: Buyer;
    issue: string; due: string; serviceStart: string; serviceEnd: string;
    note: string;
    items: ItemDraft[];
  };
  submitLabel: string;
  error?: string;
}) {
  const { customers, smallBusiness } = props;
  const defVat = smallBusiness ? 0 : 19;
  const [buyer, setBuyer] = useState<Buyer>(props.initial?.buyer || {
    name: '', contact: '', street: '', zip: '', city: '', country: 'DE', email: '', vat_id: '', reference: '',
  });
  const [items, setItems] = useState<ItemDraft[]>(
    props.initial?.items?.length ? props.initial.items : [{ ...EMPTY_ITEM, vat_rate: defVat }],
  );
  const [note, setNote] = useState(props.initial?.note || '');

  const set = (k: keyof Buyer) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setBuyer((b) => ({ ...b, [k]: e.target.value }));

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((arr) => [...arr, { ...EMPTY_ITEM, vat_rate: defVat }]);
  const removeItem = (i: number) => setItems((arr) => (arr.length > 1 ? arr.filter((_, idx) => idx !== i) : arr));

  // Kunden-Vorauswahl: Empfaengerdaten aus letzter Rechnung + Positionsvorschlag
  // aus den fakturierten Displays (1 Zeile pro Display, Preis laut Preisliste).
  function applyCustomer(name: string) {
    const c = customers.find((x) => x.name === name);
    if (!c) return;
    setBuyer((b) => ({
      ...b,
      name: c.name,
      contact: c.last?.contact || b.contact,
      street: c.last?.street || '',
      zip: c.last?.zip || '',
      city: c.last?.city || '',
      country: c.last?.country || 'DE',
      email: c.last?.email || '',
      vat_id: c.last?.vat_id || '',
      reference: c.last?.reference || '',
    }));
    if (c.billed > 0) {
      setItems(c.devices.map((d) => ({
        description: `Microwerbung – digitale Werbeanzeige auf Display „${d}", ${props.serviceLabel}`,
        quantity: '1',
        unit: 'MON',
        unit_price: c.rate.toFixed(2).replace('.', ','),
        vat_rate: defVat,
      })));
    }
  }

  // Summen live berechnen (gleiche Rundungslogik wie der Server).
  const totals = useMemo(() => {
    const byRate = new Map<number, number>();
    let net = 0;
    for (const it of items) {
      const line = round2(qnum(it.quantity) * num(it.unit_price));
      net = round2(net + line);
      const rate = smallBusiness ? 0 : it.vat_rate;
      byRate.set(rate, round2((byRate.get(rate) || 0) + line));
    }
    const groups = [...byRate.entries()].filter(([r]) => r > 0).sort((a, b) => b[0] - a[0])
      .map(([rate, base]) => ({ rate, tax: round2(base * rate / 100) }));
    const tax = round2(groups.reduce((a, g) => a + g.tax, 0));
    return { net, tax, gross: round2(net + tax), groups };
  }, [items, smallBusiness]);

  // Positionen als JSON fuer die Server-Action.
  const itemsJson = useMemo(() => JSON.stringify(
    items
      .filter((it) => it.description.trim())
      .map((it) => ({
        description: it.description.trim(),
        quantity: qnum(it.quantity),
        unit: it.unit,
        unit_price: num(it.unit_price),
        vat_rate: smallBusiness ? 0 : it.vat_rate,
      })),
  ), [items, smallBusiness]);

  const inp = { background: '#1d1d20' } as const;

  return (
    <form action={props.action}>
      {props.initial && <input type="hidden" name="id" value={props.initial.id} />}
      <input type="hidden" name="items" value={itemsJson} />

      {props.error && (
        <div className="card" style={{ borderColor: '#5a2a2a', background: '#241616' }}>
          <span style={{ color: '#ff9a9a' }}>
            Bitte mindestens den Empfänger-Namen und eine Position mit Beschreibung angeben.
          </span>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Empfänger</h2>
          {!props.initial && customers.length > 0 && (
            <select defaultValue="" onChange={(e) => { applyCustomer(e.target.value); e.target.value = ''; }}
                    style={{ maxWidth: 320 }}>
              <option value="">Kunde übernehmen …</option>
              {customers.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}{c.billed > 0 ? ` · ${c.billed} Display${c.billed > 1 ? 's' : ''} à ${eur(c.rate)}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="grid2" style={{ marginTop: 10 }}>
          <div>
            <label>Firma / Name *</label>
            <input value={buyer.name} onChange={set('name')} name="c_name" required style={{ width: '100%', ...inp }} />
          </div>
          <div>
            <label>Ansprechpartner</label>
            <input value={buyer.contact} onChange={set('contact')} name="c_contact" style={{ width: '100%', ...inp }} />
          </div>
        </div>
        <label>Straße und Hausnummer</label>
        <input value={buyer.street} onChange={set('street')} name="c_street" style={{ width: '100%', ...inp }} />
        <div className="row" style={{ marginTop: 0 }}>
          <div style={{ width: 120 }}>
            <label>PLZ</label>
            <input value={buyer.zip} onChange={set('zip')} name="c_zip" style={{ width: '100%', ...inp }} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label>Ort</label>
            <input value={buyer.city} onChange={set('city')} name="c_city" style={{ width: '100%', ...inp }} />
          </div>
          <div style={{ width: 80 }}>
            <label>Land</label>
            <input value={buyer.country} onChange={set('country')} name="c_country" maxLength={2} style={{ width: '100%', ...inp }} />
          </div>
        </div>
        <div className="grid2">
          <div>
            <label>E-Mail (für die E-Rechnung nötig)</label>
            <input value={buyer.email} onChange={set('email')} name="c_email" type="email" style={{ width: '100%', ...inp }} />
          </div>
          <div>
            <label>USt-IdNr. des Kunden (optional)</label>
            <input value={buyer.vat_id} onChange={set('vat_id')} name="c_vat_id" style={{ width: '100%', ...inp }} />
          </div>
        </div>
        <label>Käufer-Referenz / Leitweg-ID (optional, für Behörden)</label>
        <input value={buyer.reference} onChange={set('reference')} name="c_reference" style={{ width: '100%', maxWidth: 340, ...inp }} />
      </div>

      <div className="card">
        <h2>Eckdaten</h2>
        <div className="row">
          <div>
            <label>Rechnungsdatum</label>
            <input type="date" name="issue_date" defaultValue={props.initial?.issue || props.defaults.issue} style={inp} />
          </div>
          <div>
            <label>Zahlbar bis</label>
            <input type="date" name="due_date" defaultValue={props.initial?.due || props.defaults.due} style={inp} />
          </div>
          <div>
            <label>Leistungszeitraum von</label>
            <input type="date" name="service_start" defaultValue={props.initial?.serviceStart || props.defaults.serviceStart} style={inp} />
          </div>
          <div>
            <label>bis</label>
            <input type="date" name="service_end" defaultValue={props.initial?.serviceEnd || props.defaults.serviceEnd} style={inp} />
          </div>
        </div>
        <label>Hinweis auf der Rechnung (optional)</label>
        <textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
                  style={{ width: '100%', ...inp }} placeholder="z. B. Dankeschön, Vertragsnummer, Zusatzinfo …" />
      </div>

      <div className="card">
        <h2>Positionen</h2>
        {items.map((it, i) => {
          const line = round2(qnum(it.quantity) * num(it.unit_price));
          return (
            <div key={i} className="row" style={{ alignItems: 'flex-end', marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <label>Beschreibung (mehrzeilig möglich)</label>
                <textarea value={it.description} onChange={(e) => setItem(i, { description: e.target.value })}
                          rows={Math.min(6, Math.max(1, it.description.split('\n').length))}
                          placeholder="z. B. Microwerbung – digitale Werbeanzeige …"
                          style={{ width: '100%', resize: 'vertical', ...inp }} />
              </div>
              <div style={{ width: 70 }}>
                <label>Menge</label>
                <input value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })}
                       inputMode="decimal" style={{ width: '100%', ...inp }} />
              </div>
              <div style={{ width: 100 }}>
                <label>Einheit</label>
                <select value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} style={{ width: '100%' }}>
                  {UNIT_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div style={{ width: 110 }}>
                <label>Einzelpreis € (netto)</label>
                <input value={it.unit_price} onChange={(e) => setItem(i, { unit_price: e.target.value })}
                       inputMode="decimal" placeholder="19,90" style={{ width: '100%', ...inp }} />
              </div>
              {!smallBusiness && (
                <div style={{ width: 84 }}>
                  <label>USt</label>
                  <select value={it.vat_rate} onChange={(e) => setItem(i, { vat_rate: Number(e.target.value) })}
                          style={{ width: '100%' }}>
                    <option value={19}>19 %</option>
                    <option value={7}>7 %</option>
                    <option value={0}>0 %</option>
                  </select>
                </div>
              )}
              <div style={{ width: 92, textAlign: 'right', paddingBottom: 9, fontWeight: 600 }}>
                {eur(line)}
              </div>
              <button type="button" className="btn-sm btn-danger" onClick={() => removeItem(i)}
                      title="Position entfernen" style={{ marginBottom: 4 }}>×</button>
            </div>
          );
        })}
        <button type="button" className="btn-sm" onClick={addItem}>+ Position</button>

        <div style={{ marginTop: 16, borderTop: '1px solid #262629', paddingTop: 12, textAlign: 'right' }}>
          {!smallBusiness && (
            <>
              <div className="muted">Zwischensumme (netto): {eur(totals.net)}</div>
              {totals.groups.map((g) => (
                <div key={g.rate} className="muted">zzgl. {g.rate} % USt: {eur(g.tax)}</div>
              ))}
            </>
          )}
          <div style={{ fontSize: 17, fontWeight: 700, marginTop: 4 }}>
            Gesamtbetrag: {eur(smallBusiness ? totals.net : totals.gross)}
          </div>
          {smallBusiness && (
            <div className="muted" style={{ marginTop: 4 }}>
              Kein Ausweis von Umsatzsteuer (Kleinunternehmer, § 19 UStG)
            </div>
          )}
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn-primary" type="submit">{props.submitLabel}</button>
      </div>
    </form>
  );
}
