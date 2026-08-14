// Rechnungs-PDF (menschenlesbare Ausfertigung zur XRechnung) mit pdf-lib.
// A4, DIN-5008-artiges Layout: Absenderzeile, Empfaengerblock, Metablock,
// Positionstabelle mit Seitenumbruch, Summen, Zahlungshinweis, Fusszeile.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import type { Company, Invoice, InvoiceItem } from '@/lib/invoices';
import { computeTotals, round2, fmtDate, UNITS } from '@/lib/invoices';

const A4 = { w: 595.28, h: 841.89 };
const M = 50;               // Seitenrand
const GRAY = rgb(0.45, 0.45, 0.47);
const DARK = rgb(0.1, 0.1, 0.12);
const RULE = rgb(0.85, 0.85, 0.87);
const GREEN = rgb(0.1, 0.55, 0.25);

// WinAnsi-sichere Zeichen (Standard-Helvetica kann kein Unicode daruber hinaus).
const WINANSI_OK = /[ -~ -ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ\n]/;
const safe = (s: string) =>
  [...(s || '')].map((ch) => (WINANSI_OK.test(ch) ? ch : '')).join('');

// Eigenes Geldformat (statt toLocaleString), damit garantiert nur
// WinAnsi-Zeichen entstehen: 1.234,56 €
const money = (n: number) => {
  const neg = n < 0;
  const [int, frac] = Math.abs(n).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${grouped},${frac} €`;
};
const numDE = (n: number) =>
  (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ','));

export async function buildInvoicePdf(inv: Invoice, items: InvoiceItem[], company: Company): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Rechnung ${inv.number}`);
  doc.setAuthor(company.name || 'Rechnung');

  let page = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M; // aktuelle Schreibposition (von oben)

  const text = (p: PDFPage, s: string, x: number, yy: number, size = 9.5, f: PDFFont = font, color = DARK) =>
    p.drawText(safe(s), { x, y: yy, size, font: f, color });
  const textRight = (p: PDFPage, s: string, xRight: number, yy: number, size = 9.5, f: PDFFont = font, color = DARK) => {
    const t = safe(s);
    p.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y: yy, size, font: f, color });
  };
  const rule = (p: PDFPage, yy: number, x1 = M, x2 = A4.w - M, color = RULE, w = 0.6) =>
    p.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: w, color });

  // Text auf Breite umbrechen (Wortumbruch, sehr lange Woerter werden geteilt).
  const wrap = (s: string, width: number, size = 9.5, f: PDFFont = font): string[] => {
    const out: string[] = [];
    for (const raw of safe(s).split('\n')) {
      const words = raw.split(/\s+/).filter(Boolean);
      let line = '';
      const push = () => { if (line) out.push(line); line = ''; };
      for (let w of words) {
        while (f.widthOfTextAtSize(w, size) > width) { // Wort selbst zu lang
          let cut = w.length;
          while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
          push(); out.push(w.slice(0, cut)); w = w.slice(cut);
        }
        const probe = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(probe, size) > width) { push(); line = w; }
        else line = probe;
      }
      push();
      if (words.length === 0) out.push('');
    }
    return out.length ? out : [''];
  };

  // ---- Kopf: Firmenname links, Kontaktblock rechts ----
  text(page, company.name || 'Rechnung', M, y - 6, 15, bold);
  const headRight = [
    company.street,
    [company.zip, company.city].filter(Boolean).join(' '),
    company.phone,
    company.email,
    company.website,
  ].filter(Boolean);
  let hy = y;
  for (const l of headRight) { textRight(page, l, A4.w - M, hy, 8, font, GRAY); hy -= 11; }

  // ---- Absenderzeile + Empfaenger ----
  y = A4.h - 145;
  const senderLine = [company.name, company.street, [company.zip, company.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(' · ');
  text(page, senderLine, M, y, 7, font, GRAY);
  y -= 16;
  const recipient = [
    inv.c_name,
    inv.c_contact || '',
    inv.c_street || '',
    [inv.c_zip, inv.c_city].filter(Boolean).join(' '),
    (inv.c_country && inv.c_country !== 'DE') ? inv.c_country : '',
  ].filter(Boolean);
  for (const l of recipient) { text(page, l, M, y, 10.5); y -= 15; }

  // ---- Metablock rechts ----
  let my = A4.h - 161;
  const meta: [string, string][] = [
    ['Rechnungs-Nr.', inv.number],
    ['Rechnungsdatum', fmtDate(inv.issue_date)],
  ];
  if (inv.due_date) meta.push(['Zahlbar bis', fmtDate(inv.due_date)]);
  if (inv.service_start && inv.service_end)
    meta.push(['Leistungszeitraum', `${fmtDate(inv.service_start)} – ${fmtDate(inv.service_end)}`]);
  if (inv.c_vat_id) meta.push(['USt-IdNr. Kunde', inv.c_vat_id]);
  if (inv.c_reference) meta.push(['Referenz', inv.c_reference]);
  for (const [k, v] of meta) {
    textRight(page, k, A4.w - M - 115, my, 8.5, font, GRAY);
    textRight(page, v, A4.w - M, my, 9, font, DARK);
    my -= 14;
  }

  // ---- Titel ----
  y = Math.min(y, my) - 26;
  text(page, `Rechnung ${inv.number}`, M, y, 14, bold);
  if (inv.status === 'cancelled') textRight(page, 'STORNIERT', A4.w - M, y, 14, bold, rgb(0.8, 0.2, 0.2));
  y -= 24;

  // ---- Tabelle ----
  const X = {
    pos: M,             // Pos (links)
    desc: M + 26,       // Beschreibung (links, Breite descW)
    qtyR: 348,          // Menge (rechtsbuendig)
    unit: 356,          // Einheit (links)
    priceR: 462,        // Einzelpreis (rechtsbuendig)
    vatR: 496,          // USt % (rechtsbuendig)
    sumR: A4.w - M,     // Betrag (rechtsbuendig)
  };
  const descW = 315 - X.desc;

  const tableHead = (p: PDFPage, yy: number): number => {
    text(p, 'Pos.', X.pos, yy, 8.5, bold, GRAY);
    text(p, 'Beschreibung', X.desc, yy, 8.5, bold, GRAY);
    textRight(p, 'Menge', X.qtyR, yy, 8.5, bold, GRAY);
    text(p, 'Einheit', X.unit, yy, 8.5, bold, GRAY);
    textRight(p, 'Einzelpreis', X.priceR, yy, 8.5, bold, GRAY);
    textRight(p, 'USt', X.vatR, yy, 8.5, bold, GRAY);
    textRight(p, 'Betrag', X.sumR, yy, 8.5, bold, GRAY);
    rule(p, yy - 6, M, A4.w - M, rgb(0.55, 0.55, 0.58), 0.8);
    return yy - 20;
  };
  const newPage = (): void => {
    page = doc.addPage([A4.w, A4.h]);
    y = A4.h - M - 10;
    y = tableHead(page, y);
  };

  y = tableHead(page, y);
  const kleinunternehmer = inv.small_business;
  items.forEach((it, i) => {
    const lines = wrap(it.description, descW, 9.5);
    const rowH = Math.max(lines.length, 1) * 13 + 8;
    if (y - rowH < 150) newPage();
    text(page, String(i + 1), X.pos, y, 9.5);
    lines.forEach((l, li) => text(page, l, X.desc, y - li * 13, 9.5));
    textRight(page, numDE(it.quantity), X.qtyR, y, 9.5);
    text(page, UNITS[it.unit] || it.unit, X.unit, y, 9.5);
    textRight(page, money(it.unit_price), X.priceR, y, 9.5);
    textRight(page, kleinunternehmer ? '—' : `${numDE(it.vat_rate)} %`, X.vatR, y, 9.5);
    textRight(page, money(round2(it.quantity * it.unit_price)), X.sumR, y, 9.5);
    y -= rowH;
    rule(page, y + 6);
  });

  // ---- Summen ----
  const t = computeTotals(items);
  const gross = kleinunternehmer ? t.net : t.gross;
  const sums: [string, string, boolean][] = [];
  if (!kleinunternehmer && t.taxByRate.length > 0) {
    sums.push(['Zwischensumme (netto)', money(t.net), false]);
    for (const g of t.taxByRate) sums.push([`zzgl. ${numDE(g.rate)} % USt auf ${money(g.base)}`, money(g.tax), false]);
  }
  sums.push(['Gesamtbetrag', money(gross), true]);

  const sumBlockH = sums.length * 17 + 12;
  if (y - sumBlockH < 130) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M - 10; }
  y -= 8;
  for (const [label, val, strong] of sums) {
    textRight(page, label, X.sumR - 110, y, strong ? 11 : 9.5, strong ? bold : font, strong ? DARK : GRAY);
    textRight(page, val, X.sumR, y, strong ? 11 : 9.5, strong ? bold : font, strong ? DARK : DARK);
    y -= 17;
  }
  if (kleinunternehmer) {
    y -= 2;
    for (const l of wrap('Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.', A4.w - 2 * M, 8.5)) {
      text(page, l, M, y, 8.5, font, GRAY); y -= 12;
    }
  }

  // ---- Hinweis / Freitext ----
  if (inv.note) {
    y -= 8;
    for (const l of wrap(inv.note, A4.w - 2 * M, 9.5)) {
      if (y < 120) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M - 10; }
      text(page, l, M, y, 9.5); y -= 13;
    }
  }

  // ---- Zahlungshinweis ----
  if (inv.status !== 'cancelled') {
    y -= 14;
    if (y < 150) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M - 10; }
    const till = inv.due_date ? ` bis zum ${fmtDate(inv.due_date)}` : '';
    const payLines = [
      `Bitte überweisen Sie den Betrag von ${money(gross)}${till} unter Angabe der`,
      `Rechnungsnummer ${inv.number} auf das folgende Konto:`,
    ];
    for (const l of payLines) { text(page, l, M, y, 9.5); y -= 13; }
    y -= 3;
    if (company.iban) {
      const bank: [string, string][] = [['IBAN', company.iban]];
      if (company.bic) bank.push(['BIC', company.bic]);
      if (company.bank_name) bank.push(['Bank', company.bank_name]);
      for (const [k, v] of bank) {
        text(page, k, M, y, 9, bold);
        text(page, v, M + 42, y, 9);
        y -= 13;
      }
    }
    y -= 10;
    text(page, 'Vielen Dank für Ihren Auftrag!', M, y, 9.5, font, GREEN);
  }

  // ---- Fusszeile auf jeder Seite ----
  const taxLine = company.vat_id
    ? `USt-IdNr. ${company.vat_id}`
    : company.tax_number ? `Steuernr. ${company.tax_number}` : '';
  const cols: string[][] = [
    [company.name, company.owner, company.street, [company.zip, company.city].filter(Boolean).join(' ')].filter(Boolean),
    [company.phone && `Tel. ${company.phone}`, company.email, company.website].filter(Boolean) as string[],
    [company.bank_name, company.iban && `IBAN ${company.iban}`, taxLine].filter(Boolean) as string[],
  ];
  const pages = doc.getPages();
  pages.forEach((p, pi) => {
    rule(p, 76, M, A4.w - M);
    const colX = [M, 235, 405];
    cols.forEach((col, ci) => {
      let fy = 64;
      for (const l of col) { text(p, l, colX[ci], fy, 7.3, font, GRAY); fy -= 10; }
    });
    if (pages.length > 1) textRight(p, `Seite ${pi + 1} / ${pages.length}`, A4.w - M, 84, 7.5, font, GRAY);
    if (company.invoice_footer && pi === pages.length - 1) {
      // Freier Fusstext (z. B. Amtsgericht/Zusatz) mittig ueber der Fusszeile.
      const fl = wrap(company.invoice_footer, A4.w - 2 * M, 7.3);
      let fy = 84 + (fl.length - 1) * 10;
      for (const l of fl) { text(p, l, M, fy, 7.3, font, GRAY); fy -= 10; }
    }
  });

  return doc.save();
}
