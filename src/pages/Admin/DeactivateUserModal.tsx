// The Deactivate confirmation, split out of UsersTab.tsx (300-line cap).
// Closing (×, Escape, backdrop) all route to `onClose` — never to the
// destructive action. See ModalShell's own header comment for why that rule
// lives there and must never be broken by a caller.
import React from 'react';
import type { Profile } from '../../types';
import ModalShell from '../../components/ModalShell';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';

interface DeactivateUserModalProps {
  profile: Profile;
  /** The approval office this person holds, if any. Deactivating them VACATES
   *  it (migration 059), which is a consequence for other people's passes and
   *  so is said before the press, not discovered after it. */
  office?: ApprovalRoleKey | null;
  deactivating: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeactivateUserModal({
  profile,
  office = null,
  deactivating,
  onClose,
  onConfirm,
}: DeactivateUserModalProps): React.ReactElement {
  return (
    <ModalShell onClose={onClose} className="max-w-sm" labelledBy="deactivate-user-title">
      <h2 id="deactivate-user-title" className="modal-title mb-1">
        Deactivate User?
      </h2>
      <p className="text-sm text-navy-600 mb-2">
        <strong>{profile.full_name}</strong> ({profile.email}) will lose all app access.
      </p>
      {office && (
        <p className="alert-warning text-xs mb-3" data-testid="deactivate-vacates-office">
          This also vacates the <strong>{APPROVAL_ROLE_TITLES[office]}</strong> office. Until you
          designate somebody else, a pass raised from now on will not ask that office to sign, and
          passes already waiting on it stay waiting.
        </p>
      )}
      <p className="text-xs text-navy-500 mb-5">
        Their pass history is preserved. Reactivating them restores their access, but not the
        office — designate that again on the approval ladder.
      </p>
      <div className="flex flex-col-reverse md:flex-row gap-3">
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-danger flex-1" disabled={deactivating} onClick={onConfirm}>
          {deactivating ? 'Deactivating…' : 'Deactivate'}
        </button>
      </div>
    </ModalShell>
  );
}
