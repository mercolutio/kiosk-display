// REST-API: Rechnungsdokumente per API-Key abrufen (z. B. für den
// WhatsApp-Assistenten, der die PDF an den Kunden weiterleitet).
//   GET /api/v1/invoices/{id}/file?format=pdf        -> PDF
//   GET /api/v1/invoices/{id}/file?format=xrechnung  -> E-Rechnung (UBL-XML)
import { NextResponse } from 'next/server';
import { requireApi } from '@/lib/api';
import { loadInvoice, getCompany } from '@/lib/invoices';
import { buildInvoicePdf } from '@/lib/invoice-pdf';
import { buildXRechnung, xrechnungMissing } from '@/lib/xrechnung';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = requireApi(request);
  if (denied) return denied;
  const { id } = await params;
  const format = new URL(request.url).searchParams.get('format') || 'pdf';

  const data = await loadInvoice(id);
  if (!data) return new NextResponse('Rechnung nicht gefunden', { status: 404 });
  const company = await getCompany();

  try {
    if (format === 'xrechnung') {
      const missing = xrechnungMissing(data.invoice, company);
      if (missing.length > 0) {
        return NextResponse.json(
          { error: 'Für eine gültige XRechnung fehlen Angaben', missing },
          { status: 400 },
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
        'Content-Disposition': `attachment; filename="Rechnung-${data.invoice.number}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (e) {
    return new NextResponse('Fehler bei der Erzeugung: ' + (e as Error).message, { status: 500 });
  }
}
