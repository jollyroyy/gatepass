// The frame every chart panel on the admin board sits in: a title on the left,
// an optional control on the right, a loading skeleton, and the body.
//
// It exists so the six panels cannot drift apart in padding, heading level or
// skeleton height — the "make it consistent" half of the brief. `card-title`
// (18px/600), never `section-title` (22px/700): these are cards WITHIN the
// board, and using the section heading here would flatten the type ladder the
// design system spends its whole comment budget defending.
import React from 'react';

type Props = {
  title: string;
  /** A period select, a "View All" link — whatever this panel is controlled by. */
  control?: React.ReactNode;
  /** One line under the title. Use it to state a scope that differs from the
   *  board's period filter, never to repeat the title in other words. */
  subtitle?: string;
  loading?: boolean;
  skeletonHeight?: string;
  children: React.ReactNode;
};

export default function AdminCard({
  title,
  control,
  subtitle,
  loading,
  skeletonHeight = 'h-48',
  children,
}: Props): React.ReactElement {
  return (
    <section className="card p-5 flex flex-col h-full min-w-0">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h2 className="card-title border-0 pb-0 min-w-0">{title}</h2>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {subtitle && <p className="text-caption text-navy-500 mb-3">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-3'}>
        {loading ? <div className={`skeleton w-full ${skeletonHeight}`} /> : children}
      </div>
    </section>
  );
}

/** The compact select in a panel's top-right corner — the client's reference
 *  board puts one on nearly every card. A native `<select>`, not a custom
 *  popup: `.dark select` in index.css already forces an opaque, dark-schemed
 *  option list, and a hand-rolled dropdown here would be a fourth menu
 *  implementation to keep in sync with the theme. */
export function AdminCardSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}): React.ReactElement {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="input py-1.5 px-3 text-caption w-auto"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
