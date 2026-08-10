// "Mismatches needing review" card on the HOD dashboard. The guard's mismatch
// reason is the single most important input to the HOD's approve/leave-flagged
// decision, so it is rendered as the visual focus of each row — not a footnote.
// Each pass is a PassRow (the 2026-08-08 card rule); the reason rides under it
// in flagged red, and the row's only click opens the pass detail.
import React from 'react';
import type { GatePassView } from '../../types';
import PassRow from '../../components/PassRow';

export default function FlaggedReviewCard({
  rows,
  onOpen,
}: {
  rows: GatePassView[];
  onOpen: (id: string) => void;
}): React.ReactElement | null {
  if (rows.length === 0) return null;

  return (
    <div className="card border border-flagged-500/30 bg-flagged-50/40 p-5 mb-8">
      <h2 className="card-title text-flagged-700 mb-3">Mismatches needing review</h2>
      <div className="flex flex-col gap-3">
        {rows.map((p) => (
          <PassRow key={p.id} pass={p} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}