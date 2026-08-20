// THE HOD IS ASKED BEFORE THEIR DEPARTMENT IS DELETED (migration 060).
//
// Client, 2026-08-20: "the admin should not be able to delete the department.
// He needs approval from the HOD ... it should send an approval request to the
// HOD for the deletion of the department." This card is where that request is
// read and decided; the admin's press only ever raises it.
//
// APPROVING DELETES THE DEPARTMENT THERE AND THEN — the client's own choice
// between one decision and two. So the button says what it does, and a second
// press confirms it: `Approve deletion` arms, `Confirm — delete <name>` acts.
// The same two-press shape the gate's return entry uses, and for the same
// reason: the act cannot be undone.
//
// A REFUSAL NEEDS A WRITTEN REASON, exactly as the approval ladder's rejection
// does, and 060 refuses a short one — so the box is validated here first, in
// the same words, and the button is dead until there is something in it.
//
// THE CARD DRAWS NOTHING when there is nothing to decide. An empty bordered
// strip on a dashboard reads as a panel that failed to load.
import React, { useState } from 'react';
import { safeErrorMessage } from '../../lib/errors';
import {
  decidableRequests,
  deletionReasonError,
  type DepartmentDeleteRequest,
} from '../../lib/departmentDeleteRequests';
import { decideDepartmentDeletion } from '../../lib/useDepartmentDeleteRequests';
import { formatDateTime } from '../../lib/formatDate';
import HodIcon from './HodIcon';

type Props = {
  requests: DepartmentDeleteRequest[];
  onDecided: () => Promise<void> | void;
};

export default function DepartmentDeleteRequests({
  requests,
  onDecided,
}: Props): React.ReactElement | null {
  const mine = decidableRequests(requests);
  if (mine.length === 0) return null;

  return (
    <div className="gb-card" data-testid="dept-delete-requests">
      <div className="gb-approvals-head">
        <HodIcon glyph="alert" tone="orange" shape="chip" />
        <span className="min-w-0">
          <h2 className="gb-quick-title">Department Deletion Request</h2>
          <span className="gb-approvals-sub">
            An administrator wants to delete a department you head. It stays exactly as it is
            until you approve.
          </span>
        </span>
      </div>

      <div className="flex flex-col gap-3 mt-3">
        {mine.map((r) => (
          <RequestRow key={r.id} request={r} onDecided={onDecided} />
        ))}
      </div>
    </div>
  );
}

function RequestRow({
  request,
  onDecided,
}: {
  request: DepartmentDeleteRequest;
  onDecided: () => Promise<void> | void;
}): React.ReactElement {
  const [mode, setMode] = useState<'idle' | 'confirm' | 'reject'>('idle');
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    if (!approve) {
      const err = deletionReasonError(reason, 'reason for refusing');
      setReasonErr(err);
      if (err) return;
    }
    setBusy(true);
    setError(null);
    try {
      await decideDepartmentDeletion(request.id, approve, approve ? reason : reason.trim());
      await onDecided();
    } catch (err) {
      setError(safeErrorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-surface-300 bg-surface-50 p-4">
      <p className="text-sm font-semibold text-navy-800">
        {request.department_name} ({request.department_code})
      </p>
      <p className="text-xs text-navy-500 mt-0.5">
        Requested by {request.requested_name ?? 'an administrator'} ·{' '}
        {formatDateTime(request.created_at)}
      </p>
      <p className="text-sm text-navy-700 mt-2">
        <span className="text-navy-500">Reason: </span>
        {request.reason}
      </p>

      {mode === 'confirm' && (
        <div className="alert-error text-sm mt-3">
          Approving deletes <strong>{request.department_name}</strong> immediately. Its gate pass
          history must already be clear, and the people assigned to it lose their department.
          This cannot be undone.
        </div>
      )}

      {mode === 'reject' && (
        <div className="mt-3">
          <label className="label" htmlFor={`reject-${request.id}`}>
            Reason for refusing *
          </label>
          <textarea
            id={`reject-${request.id}`}
            className={`input ${reasonErr ? 'input-error' : ''}`}
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setReasonErr(null);
            }}
            placeholder="Why this department must stay"
          />
          <div className="flex justify-between mt-1">
            {reasonErr ? <p className="field-error">{reasonErr}</p> : <span />}
            <span className="text-xs text-navy-500">{reason.trim().length}/500</span>
          </div>
        </div>
      )}

      {error && <div className="alert-error text-sm mt-3">{error}</div>}

      <div className="flex flex-wrap gap-2 mt-3">
        {mode === 'idle' && (
          <>
            <button
              type="button"
              className="btn-primary text-sm"
              onClick={() => setMode('confirm')}
            >
              Approve deletion
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setMode('reject')}
            >
              Reject
            </button>
          </>
        )}

        {mode === 'confirm' && (
          <>
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={busy}
              onClick={() => void decide(true)}
            >
              {busy ? 'Deleting…' : `Confirm — delete ${request.department_name}`}
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy}
              onClick={() => setMode('idle')}
            >
              Cancel
            </button>
          </>
        )}

        {mode === 'reject' && (
          <>
            <button
              type="button"
              className="btn-primary text-sm"
              disabled={busy || reason.trim().length === 0}
              onClick={() => void decide(false)}
            >
              {busy ? 'Sending…' : 'Confirm rejection'}
            </button>
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy}
              onClick={() => {
                setMode('idle');
                setReason('');
                setReasonErr(null);
              }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
