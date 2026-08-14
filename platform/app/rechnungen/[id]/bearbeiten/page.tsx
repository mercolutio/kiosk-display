import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { loadInvoice } from '@/lib/invoices';
import { updateInvoice } from '../../../actions';
import InvoiceForm, { type ItemDraft } from '../../InvoiceForm';

export const dynamic = 'force-dynamic';

export default async function RechnungBearbeiten({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const data = await loadInvoice(id);
  if (!data) notFound();
  const { invoice: inv, items } = data;
  if (inv.status !== 'draft') redirect(`/rechnungen/${id}`); // nur Entwuerfe aenderbar

  const itemDrafts: ItemDraft[] = items.map((it) => ({
    description: it.description,
    quantity: String(it.quantity).replace('.', ','),
    unit: it.unit,
    unit_price: it.unit_price.toFixed(2).replace('.', ','),
    vat_rate: it.vat_rate,
  }));

  const serviceLabel = new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

  return (
    <div className="container">
      <div className="header">
        <h1>
          <Link href="/rechnungen">← Rechnungen</Link> /{' '}
          <Link href={`/rechnungen/${inv.id}`}>{inv.number}</Link> / Bearbeiten
        </h1>
      </div>
      <InvoiceForm
        action={updateInvoice}
        customers={[]}
        smallBusiness={inv.small_business}
        serviceLabel={serviceLabel}
        defaults={{ issue: inv.issue_date, due: inv.due_date || '', serviceStart: inv.service_start || '', serviceEnd: inv.service_end || '' }}
        initial={{
          id: inv.id,
          buyer: {
            name: inv.c_name, contact: inv.c_contact || '', street: inv.c_street || '',
            zip: inv.c_zip || '', city: inv.c_city || '', country: inv.c_country || 'DE',
            email: inv.c_email || '', vat_id: inv.c_vat_id || '', reference: inv.c_reference || '',
          },
          issue: inv.issue_date,
          due: inv.due_date || '',
          serviceStart: inv.service_start || '',
          serviceEnd: inv.service_end || '',
          note: inv.note || '',
          items: itemDrafts,
        }}
        submitLabel="Änderungen speichern"
        error={error}
      />
    </div>
  );
}
