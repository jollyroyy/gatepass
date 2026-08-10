// One pass, fully described, as the payload of a dashboard KPI drill. A guard
// clicking "Overdue" needs to act without a second navigation, so everything
// they would otherwise open the pass detail for is here.
//
// The 2026-08-10 card rule (client feedback — "I see the vendor name on top
// AND in the body"): this is a shadcn-idiom Card. `PassRow` in `variant="drill"`
// owns the CardHeader (identity + status only) and the CardContent (every
// other fact, exactly once, via `PassRowBody`); this component supplies only
// the CardFooter — the actions — as `detail`, on its own muted surface. On
// the returnable drills that footer carries Record Returns; that action used
// to live on the Pending Returns page, and when that tab was removed this
// became the ONLY way a guard can close an RGP, so it must stay. Per-line
// returns stay lazy: ItemReturnList mounts only once the guard opens the panel.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import PassRow from '../../components/PassRow';
import ItemReturnList from './ItemReturnList';

type Props = {
  pass: GatePassView;
  /** Whether this drill's material has left the gate and can be closed. */
  returnable: boolean;
  onMarkReturned: (pass: GatePassView, remarks: string) => Promise<void>;
  /** A single line came back. The pass may now be closed — the DATABASE decided
   *  that in `apply_item_returns`, so the caller must re-read rather than
   *  infer it. Optional so existing callers keep compiling. */
  onItemReturned?: () => void;
};

export default function GuardDrillCard({
  pass,
  returnable,
  onMarkReturned,
  onItemReturned,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);

  async function submitReturn() {
    setBusy(true);
    try {
      await onMarkReturned(pass, remarks);
      setOpen(false);
      setRemarks('');
    } finally {
      setBusy(false);
    }
  }

  // CardFooter content — actions only. Every FACT about the pass now lives
  // exactly once, in PassRowBody (rendered by PassRow's "drill" variant); this
  // component never repeats vendor/visitor/department/vehicle/raised-by/dates.
  const detail = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/pass/${pass.id}`} className="text-xs font-semibold text-accent-600 hover:underline shrink-0">
          Full details →
        </Link>
        {returnable && !open && (
          <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
            Record Returns
          </button>
        )}
      </div>

      {returnable && open && (
        <div className="flex flex-col gap-3 border-t border-surface-200/60 pt-3">
          {/* Per-line returns. Mounted only once the guard opens THIS card, so a
              long Awaiting Return drill does not fire one query per pass on a
              device standing at a barrier. The pass closes itself in the
              database when the last line lands, so onReturned re-reads it. */}
          <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
            Return items individually
          </p>
          <ItemReturnList passId={pass.id} onReturned={onItemReturned ?? (() => {})} />

          <label className="label pt-1 border-t border-surface-200/60" htmlFor={`remarks-${pass.id}`}>
            …or return everything at once — remarks (optional)
          </label>
          <textarea
            id={`remarks-${pass.id}`}
            className="input"
            rows={2}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Condition on return, who brought it back, etc."
          />
          <div className="flex gap-3">
            <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn-primary flex-1" onClick={submitReturn} disabled={busy}>
              {busy ? 'Recording…' : 'Return All'}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // Crisp inset ring + a near-flat contact shadow, layered ON TOP of the
  // app-wide `.card` class rather than replacing it: `PendingReturns.tsx`
  // (tests/unit/pendingReturnsTab.test.tsx) locates this exact card via
  // `.closest('.card')`, and this component is the ONLY place that class is
  // produced for a drill card, so dropping it would strand that page's own
  // test. `.card`'s ambient `shadow-card-premium` still cascades from
  // `@layer components`, but `shadow-xs`/`ring-1` are Tailwind utilities
  // (`@layer utilities`, generated after components) and win the box-shadow
  // property at equal specificity — the RENDERED edge is the crisp ring the
  // client asked for; `.card`'s own hairline border is what remains under it.
  // Overdue keeps its own ring colour instead of stacking two rings.
  const ringClass = pass.is_overdue
    ? 'ring-overdue-500/40'
    : 'ring-black/[0.06] dark:ring-white/[0.07]';

  return (
    <div
      className={`card overflow-hidden ring-1 ${ringClass} shadow-xs
                  transition-all duration-200 hover:ring-black/[0.10] dark:hover:ring-white/[0.12]`}
    >
      <PassRow pass={pass} variant="drill" defaultOpen detail={detail} />
    </div>
  );
}