// The Deactivate confirmation, split out of UsersTab.tsx (300-line cap).
// Closing (×, Escape, backdrop) all route to `onClose` — never to the
// destructive action. See ModalShell's own header comment for why that rule
// lives there and must never be broken by a caller.
import React from 'react';
import type { Profile } from '../../types';
import ModalShell from '../../components/ModalShell';

interface DeactivateUserModalProps {
  profile: Profile;
  deactivating: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export default function DeactivateUserModal({
  profile,
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
      <p className="text-xs text-navy-500 mb-5">
        Their pass history is preserved. This can be reversed by changing their role back.
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
