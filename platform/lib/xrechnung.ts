// E-Rechnung nach EN 16931 im XRechnung-Profil (CIUS 3.0), UBL-2.1-Syntax.
// Erzeugt das XML, das seit 2025 als "E-Rechnung" im B2B-Geschaeft gilt —
// eine normale PDF ist rechtlich nur eine "sonstige Rechnung".
//
// Die UBL-Elementreihenfolge ist strikt vorgegeben; bei Aenderungen die
// Reihenfolge der Bloecke beibehalten.
import type { Company, Invoice, InvoiceItem } from '@/lib/invoices';
import { computeTotals, round2 } from '@/lib/invoices';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const amt = (n: number) => n.toFixed(2);
const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

// Pflichtangaben pruefen, damit die XRechnung validierbar ist (BR-DE-Regeln:
// Verkaeufer-Kontakt mit Name/Telefon/E-Mail, Anschriften, Steuernummer oder
// USt-IdNr., E-Mail des Empfaengers als elektronische Adresse).
export function xrechnungMissing(inv: Invoice, company: Company): string[] {
  const missing: string[] = [];
  if (!company.name) missing.push('Eigene Firmendaten: Name');
  if (!company.street) missing.push('Eigene Firmendaten: Straße');
  if (!company.zip) missing.push('Eigene Firmendaten: PLZ');
  if (!company.city) missing.push('Eigene Firmendaten: Ort');
  if (!company.email) missing.push('Eigene Firmendaten: E-Mail');
  if (!company.phone) missing.push('Eigene Firmendaten: Telefon');
  if (!company.tax_number && !company.vat_id) missing.push('Eigene Firmendaten: Steuernummer oder USt-IdNr.');
  if (!inv.c_street) missing.push('Empfänger: Straße');
  if (!inv.c_zip) missing.push('Empfänger: PLZ');
  if (!inv.c_city) missing.push('Empfänger: Ort');
  if (!inv.c_email) missing.push('Empfänger: E-Mail (elektronische Adresse der E-Rechnung)');
  return missing;
}

export function buildXRechnung(inv: Invoice, items: InvoiceItem[], company: Company): string {
  const t = computeTotals(items);
  const currency = 'EUR';
  const kleinunternehmer = inv.small_business;
  const exemptionNote = 'Kein Ausweis von Umsatzsteuer, da Kleinunternehmer gemäß § 19 UStG.';

  // Steuer-Kategorie je Position: S = Standard-/ermaessigter Satz, E = befreit
  // (Kleinunternehmer), Z = Nullsatz.
  const catFor = (rate: number) => (kleinunternehmer ? 'E' : rate > 0 ? 'S' : 'Z');

  const taxSubtotals: string[] = [];
  if (kleinunternehmer || t.taxByRate.length === 0) {
    // Eine Gruppe ueber die gesamte Nettosumme mit 0 % (E bzw. Z).
    const cat = kleinunternehmer ? 'E' : 'Z';
    taxSubtotals.push(`    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${amt(t.net)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>0</cbc:Percent>${kleinunternehmer ? `
        <cbc:TaxExemptionReason>${esc(exemptionNote)}</cbc:TaxExemptionReason>` : ''}
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
  } else {
    for (const g of t.taxByRate) {
      taxSubtotals.push(`    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${amt(g.base)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">${amt(g.tax)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${qty(g.rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
    }
    // Nettoanteile mit 0 % (falls gemischt) als Z-Gruppe ergaenzen.
    const zeroBase = t.byRate.get(0);
    if (zeroBase) {
      taxSubtotals.push(`    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${currency}">${amt(zeroBase)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${currency}">0.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>Z</cbc:ID>
        <cbc:Percent>0</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`);
    }
  }

  const lines = items.map((it, i) => {
    const lineNet = round2(it.quantity * it.unit_price);
    const rate = kleinunternehmer ? 0 : it.vat_rate;
    return `  <cac:InvoiceLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(it.unit || 'C62')}">${qty(it.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${currency}">${amt(lineNet)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(it.description.slice(0, 100) || 'Position')}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${catFor(it.vat_rate)}</cbc:ID>
        <cbc:Percent>${qty(rate)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${currency}">${amt(it.unit_price)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`;
  }).join('\n');

  // Verkaeufer: USt-IdNr. als VAT-Registrierung (BT-31), sonst Steuernummer
  // als nationale Registrierung (BT-32, TaxScheme FC).
  const sellerTax: string[] = [];
  if (company.vat_id) {
    sellerTax.push(`        <cac:PartyTaxScheme>
          <cbc:CompanyID>${esc(company.vat_id)}</cbc:CompanyID>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:PartyTaxScheme>`);
  }
  if (company.tax_number) {
    sellerTax.push(`        <cac:PartyTaxScheme>
          <cbc:CompanyID>${esc(company.tax_number)}</cbc:CompanyID>
          <cac:TaxScheme><cbc:ID>FC</cbc:ID></cac:TaxScheme>
        </cac:PartyTaxScheme>`);
  }

  const buyerVat = inv.c_vat_id ? `        <cac:PartyTaxScheme>
          <cbc:CompanyID>${esc(inv.c_vat_id)}</cbc:CompanyID>
          <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
        </cac:PartyTaxScheme>
` : '';

  const period = inv.service_start && inv.service_end ? `  <cac:InvoicePeriod>
    <cbc:StartDate>${inv.service_start}</cbc:StartDate>
    <cbc:EndDate>${inv.service_end}</cbc:EndDate>
  </cac:InvoicePeriod>
` : '';

  // Zahlungsangaben (BG-16, in XRechnung Pflicht): SEPA-Ueberweisung mit IBAN,
  // ohne hinterlegte IBAN generische Ueberweisung (Code 30).
  const paymentMeans = company.iban ? `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${esc(inv.number)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(company.iban.replace(/\s+/g, ''))}</cbc:ID>
      <cbc:Name>${esc(company.name)}</cbc:Name>${company.bic ? `
      <cac:FinancialInstitutionBranch><cbc:ID>${esc(company.bic)}</cbc:ID></cac:FinancialInstitutionBranch>` : ''}
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
` : `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>
    <cbc:PaymentID>${esc(inv.number)}</cbc:PaymentID>
  </cac:PaymentMeans>
`;

  const paymentTermsNote = inv.due_date
    ? `Zahlbar bis ${inv.due_date.split('-').reverse().join('.')} ohne Abzug.`
    : `Zahlbar innerhalb von ${company.payment_days} Tagen ohne Abzug.`;

  const notes: string[] = [];
  if (kleinunternehmer) notes.push(exemptionNote);
  if (inv.note) notes.push(inv.note);

  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(inv.number)}</cbc:ID>
  <cbc:IssueDate>${inv.issue_date}</cbc:IssueDate>${inv.due_date ? `
  <cbc:DueDate>${inv.due_date}</cbc:DueDate>` : ''}
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>${notes.map((n) => `
  <cbc:Note>${esc(n)}</cbc:Note>`).join('')}
  <cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(inv.c_reference || inv.number)}</cbc:BuyerReference>
${period}  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${esc(company.email)}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${esc(company.name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(company.street)}</cbc:StreetName>
        <cbc:CityName>${esc(company.city)}</cbc:CityName>
        <cbc:PostalZone>${esc(company.zip)}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${esc(company.country || 'DE')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
${sellerTax.join('\n')}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(company.name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${esc(company.owner || company.name)}</cbc:Name>
        <cbc:Telephone>${esc(company.phone)}</cbc:Telephone>
        <cbc:ElectronicMail>${esc(company.email)}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${esc(inv.c_email || '')}</cbc:EndpointID>
      <cac:PartyName><cbc:Name>${esc(inv.c_name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(inv.c_street || '')}</cbc:StreetName>
        <cbc:CityName>${esc(inv.c_city || '')}</cbc:CityName>
        <cbc:PostalZone>${esc(inv.c_zip || '')}</cbc:PostalZone>
        <cac:Country><cbc:IdentificationCode>${esc(inv.c_country || 'DE')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
${buyerVat}      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(inv.c_name)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>${inv.c_contact ? `
      <cac:Contact><cbc:Name>${esc(inv.c_contact)}</cbc:Name></cac:Contact>` : ''}
    </cac:Party>
  </cac:AccountingCustomerParty>
${paymentMeans}  <cac:PaymentTerms>
    <cbc:Note>${esc(paymentTermsNote)}</cbc:Note>
  </cac:PaymentTerms>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${currency}">${amt(kleinunternehmer ? 0 : t.tax)}</cbc:TaxAmount>
${taxSubtotals.join('\n')}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${currency}">${amt(t.net)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${currency}">${amt(t.net)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${currency}">${amt(kleinunternehmer ? t.net : t.gross)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="${currency}">${amt(kleinunternehmer ? t.net : t.gross)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</ubl:Invoice>
`;
}
