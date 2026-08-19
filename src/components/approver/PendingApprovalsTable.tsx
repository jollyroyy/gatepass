// The Pending Approvals queue as a table (client mock-up, 2026-08-19,
// migration 046). One row open at a time — the same rule Pending OUT's table
// follows, so a decision-maker reads one pass, decides, and moves to the next
// without four detail panels left open behind them.
//
// THE REJECT MODAL IS RENDERED HERE, OUTSIDE `<table>`, not by the row that
// requests it — a `<tr>` inside `<tbody>` cannot host a modal's own `<div>`
// markup without producing invalid DOM nesting.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import PendingApprovalRow from './PendingApprovalRow';
import RejectApprovalModal from './RejectApprovalModal';

type Props = {
  rows: GatePassView[];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
};

export default function PendingApprovalsTable({ rows, onApprove, onReject }: Props): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const rejectingPass = rows.find((p) => p.id === rejectingId) ?? null;

  return (
    <>
      <table className="gb-table">
        <thead>
          <tr>
            <th><span className="sr-only">Show items</span></th>
            <th>Pass ID</th>
            <th>Pass Type</th>
            <th>Vendor</th>
            <th>Purpose</th>
            <th>Requested By</th>
            <th>Requested On</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <PendingApprovalRow
              key={p.id}
              pass={p}
              open={openId === p.id}
              onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
              onApprove={onApprove}
              onRequestReject={() => setRejectingId(p.id)}
            />
          ))}
        </tbody>
      </table>

      {rejectingPass && (
        <RejectApprovalModal
          passNumber={rejectingPass.pass_number}
          onSubmit={async (reason) => {
            await onReject(rejectingPass.id, reason);
            // Only clears on success — a thrown error leaves the modal open
            // with the reason the reader already typed.
            setRejectingId(null);
          }}
          onClose={() => setRejectingId(null)}
        />
      )}
    </>
  );
}
