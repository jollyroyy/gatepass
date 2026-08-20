// ONE whitelist request, as a DISCLOSURE (client, 2026-08-20: "you don't show
// all these things in the dashboard of the whitelist ... if I click on an
// individual card, then only that particular respective details of the
// whitelisting should appear").
//
// So the face of the card is the vendor, its list type and where the request
// stands — enough to find the one you came for — and NOTHING is rendered of
// the blocked reason, the justification, the decision or the CEO's controls
// until this card is the one that was opened. A list of ten requests is a list
// of ten names, not ten essays.
//
// THE OPEN CARD IS HELD BY THE LIST, not here: "one at a time" is a fact about
// the list, and a card that owned its own flag could not know another was
// opened. Same shape `PassStack` uses for the approver's queue.
//
// The face is a real `<button>` with `aria-expanded`, never a clickable div —
// it is a control, and the keyboard must reach it.
import React from 'react';
import type { BlacklistType, WhitelistRequest, WhitelistRequestStatus } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import WhitelistDecisionControls from './WhitelistDecisionControls';

const TYPE_STYLES: Record<BlacklistType, string> = {
  company: 'bg-red-50 text-red-700',
  vehicle: 'bg-orange-50 text-orange-700',
  driver: 'bg-yellow-50 text-yellow-700',
};

// 'company' reads as "Vendor" everywhere in the UI now — the stored label is
// unchanged (see BlacklistTab), and the two screens must not disagree about
// what the same row is called.
const TYPE_LABELS: Record<BlacklistType, string> = {
  company: 'Vendor',
  vehicle: 'Vehicle',
  driver: 'Driver',
};

const STATUS_STYLES: Record<WhitelistRequestStatus, string> = {
  pending: 'bg-pending-50 text-pending-700',
  approved: 'bg-matched-50 text-matched-700',
  rejected: 'bg-flagged-50 text-flagged-700',
};

const STATUS_LABELS: Record<WhitelistRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

interface WhitelistRequestCardProps {
  request: WhitelistRequest;
  isCeo: boolean;
  open: boolean;
  onToggle: () => void;
  onDecided: () => void;
  onError: (msg: string) => void;
}

export default function WhitelistRequestCard({
  request, isCeo, open, onToggle, onDecided, onError,
}: WhitelistRequestCardProps): React.ReactElement {
  const isPending = request.status === 'pending';
  const bodyId = `whitelist-request-${request.id}`;

  return (
    <div className="card p-0 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 flex-wrap p-4 text-left"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
      >
        <span className="flex items-center gap-2">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_STYLES[request.list_type]}`}>
            {TYPE_LABELS[request.list_type]}
          </span>
          <span className="font-semibold text-navy-900 text-base">{request.list_value}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-navy-500">{formatDateTime(request.requested_at)}</span>
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[request.status]}`}>
            {STATUS_LABELS[request.status]}
          </span>
          <span aria-hidden className="text-navy-500 text-xs">{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open && (
        <div id={bodyId} data-testid="whitelist-request-details" className="px-4 pb-4 space-y-2 border-t border-navy-100 pt-3">
          <div className="text-sm text-navy-600">
            <span className="font-medium text-navy-700">Blocked because: </span>
            {request.blocked_reason}
          </div>

          <div className="text-sm text-navy-800">
            <span className="font-medium text-navy-700">Justification: </span>
            {request.justification}
          </div>

          <div className="text-xs text-navy-500">
            Requested by {request.requested_by_name ?? 'Unknown'} on {formatDateTime(request.requested_at)}
          </div>

          {!isPending && (
            <div className="text-xs text-navy-500">
              Decided by {request.decided_by_name ?? 'Unknown'} on {formatDateTime(request.decided_at)}
              {request.decision_note && (
                <div className="mt-1">
                  <span className="font-medium text-navy-700">Note: </span>{request.decision_note}
                </div>
              )}
            </div>
          )}

          {isPending && isCeo && (
            <WhitelistDecisionControls requestId={request.id} onDecided={onDecided} onError={onError} />
          )}
        </div>
      )}
    </div>
  );
}
