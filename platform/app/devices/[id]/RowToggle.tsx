'use client';
// Checkbox, die ihre Zeile beim Umschalten SOFORT speichert (kein Klick auf
// „Speichern" noetig). Sie sendet einfach das umschliessende <form> ab, das an
// die Server-Action updateSite gebunden ist (mit allen aktuellen Zeilen-Werten).

export default function RowToggle({
  name, defaultChecked, label,
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
}) {
  return (
    <label
      className="row"
      style={{ margin: 0, color: '#bbb' }}
      title={name === 'invoiced' ? 'Fakturiert? Nicht fakturierte Slots zählen nicht ins MRR.' : undefined}
    >
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />{' '}
      {label}
    </label>
  );
}
