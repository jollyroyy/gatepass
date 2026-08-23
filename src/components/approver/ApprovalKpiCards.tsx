// THE THREE FIGURES ON AN OFFICE HOLDER'S BOARD (client, 2026-08-20: "all four
// approvers should be able to see all the gate passes that they have approved
// and rejected. Make a KPI card for that in the dashboard. As well when they
// drill down on those cards, they should be able to list off all those things
// exactly as they are seeing the approval/rejection requests in the same stack
// format but without any approval/reject button").
//
// EACH CARD IS THE BUTTON, not a chevron inside a panel — the same rule the
// overdue board's single `.gpo-total` follows, and the same rule the HOD board
// took when its KPIs became drillable: a 32px figure with a two-character hit
// area is a control nobody can press.
//
// ONE OPEN AT A TIME, and the open one is `aria-expanded`. Three stacks on
// screen at once would put three lists under three figures and leave the
// reader working out which list belongs to which number.
//
// A ZERO CARD IS DISABLED AND STAYS ON SCREEN saying zero rather than
// vanishing — a figure that disappears when it reaches nothing is a figure
// nobody can trust at a glance.
import React from 'react';
import GuardIcon, { type GuardGlyph, type GuardTone } from '../guard/GuardIcon';

export type ApprovalCardKey = 'pending' | 'approved' | 'rejected' | 'stuck';

interface CardDef {
  key: ApprovalCardKey;
  title: string;
  glyph: GuardGlyph;
  tone: GuardTone;
  /** The class that repaints `.gpo-total`, which is red for the overdue board
   *  it was written for. */
  skin: string;
  note: string;
  empty: string;
}

const CARDS: CardDef[] = [
  {
    key: 'pending',
    title: 'Awaiting Your Approval',
    glyph: 'exchange',
    tone: 'purple',
    skin: 'gpo-total--purple',
    note: 'Waiting on you — tap to see them',
    empty: 'Nothing is waiting on your signature',
  },
  {
    key: 'approved',
    title: 'Approved by You',
    glyph: 'check',
    tone: 'green',
    skin: 'gpo-total--green',
    note: 'Passes you signed — tap to see them',
    empty: 'You have not approved anything yet',
  },
  {
    key: 'rejected',
    title: 'Rejected by You',
    glyph: 'cross',
    tone: 'red',
    skin: '',
    note: 'Passes you turned back — tap to see them',
    empty: 'You have not rejected anything',
  },
  {
    // THE FOURTH FIGURE IS NOT EVERY OFFICE'S (migration 067). It is drawn only
    // for the COO and the CEO, who carry the super admin fallback — `counts`
    // simply omits the key for anybody else, and a card with no count is not
    // rendered. Last on the row on purpose: it is the exception, not the work.
    key: 'stuck',
    title: 'Nobody Has Approved',
    glyph: 'alert',
    tone: 'red',
    skin: '',
    note: 'Stuck below your level — tap to see them',
    empty: 'Nothing is stuck',
  },
];

const Chevron = ({ open }: { open: boolean }): React.ReactElement => (
  <svg
    className="gpo-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ transform: open ? 'rotate(180deg)' : undefined }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

type Props = {
  /** The length of the very array each card's stack renders — never a second
   *  count and never an aggregate, which is the board invariant this app has
   *  carried since its first KPI. */
  counts: Partial<Record<ApprovalCardKey, number>>;
  active: ApprovalCardKey | null;
  onSelect: (key: ApprovalCardKey) => void;
};

export default function ApprovalKpiCards({ counts, active, onSelect }: Props): React.ReactElement {
  return (
    <div className="gpo-total-row" data-testid="approval-kpis">
      {CARDS.map((c) => {
        const total = counts[c.key];
        // An office that does not carry this figure at all is not shown a zero
        // for it — `undefined` means "not this reader's card", which is a
        // different fact from "none today".
        if (total === undefined) return null;
        return (
          <button
            key={c.key}
            type="button"
            className={`gpo-total ${c.skin}`.trim()}
            aria-expanded={active === c.key}
            aria-controls="approval-stack"
            disabled={total === 0}
            onClick={() => onSelect(c.key)}
          >
            <GuardIcon glyph={c.glyph} tone={c.tone} shape="square" />
            <span className="gpo-total-body">
              <span className="gpo-total-title">{c.title}</span>
              <span className="gpo-total-figure">{total}</span>
              <span className="gpo-total-note">{total === 0 ? c.empty : c.note}</span>
            </span>
            {total > 0 && <Chevron open={active === c.key} />}
          </button>
        );
      })}
    </div>
  );
}
