// Liefert eine Rechnung als Datei: ?id=<uuid>&format=pdf | xrechnung
// PDF = menschenlesbare Ausfertigung, XRechnung = E-Rechnung (EN 16931 / UBL).
// Wird bei jedem Abruf deterministisch aus den DB-Daten erzeugt (kein Blob noetig).
// Session-geschuetzt (zusaetzlich zur Middleware).
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken, SESSION_COOKIE } from '@/lib/auth';
import { loadInvoice, getCompany } from '@/lib/invoices';
import { buildInvoicePdf } from '@/lib/invoice-pdf';
import { buildXRechnung, xrechnungMissing } from '@/lib/xrechnung';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifyToken(session))) return new NextResponse('nicht angemeldet', { status: 401 });

  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  const format = url.searchParams.get('format') || 'pdf';

  const data = await loadInvoice(id);
  if (!data) return new NextResponse('Rechnung nicht gefunden', { status: 404 });
  const company = await getCompany();

  try {
    if (format === 'xrechnung') {
      const missing = xrechnungMissing(data.invoice, company);
      if (missing.length > 0) {
        return new NextResponse(
          'Für eine gültige XRechnung fehlen noch Angaben:\n\n- ' + missing.join('\n- ') +
          '\n\nBitte unter „Rechnungen → Einstellungen" bzw. in der Rechnung ergänzen.',
          { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
        );
      }
      const xml = buildXRechnung(data.invoice, data.items, company);
      return new NextResponse(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename="${data.invoice.number}-xrechnung.xml"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }

    const pdf = await buildInvoicePdf(data.invoice, data.items, company);
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="Rechnung-${data.invoice.number}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return new NextResponse('Fehler bei der Erzeugung: ' + (e as Error).message, { status: 500 });
  }
}
