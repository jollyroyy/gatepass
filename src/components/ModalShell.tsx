// Shared wrapper for every popup/modal in the app. Exists so a close control
// — button, Escape, backdrop click — is implemented exactly once instead of
// copy-pasted into every file that opens a `.modal-overlay`.
//
// `onClose` is deliberately the ONLY exit this component knows about. For a
// destructive confirmation (delete/deactivate), the caller MUST pass its
// Cancel handler here, never the destructive action — closing a popup must
// never be able to mean "confirm".
import React from 'react';
import { useEscapeKey } from '../lib/useEscapeKey';

interface ModalShellProps {
  onClose: () => void;
  children: React.ReactNode;
  /** Extra classes on `.modal-content` — e.g. `max-w-sm` / `max-w-lg` to
   *  override the default `max-w-md` from index.css. */
  className?: string;
  /** Extra classes on `.modal-overlay` itself — e.g. a higher `z-` for a
   *  popup (SessionTimeout) that must sit above every other modal. */
  overlayClassName?: string;
  /** id of the element that names this dialog, wired to aria-labelledby. */
  labelledBy?: string;
}

export default function ModalShell({ onClose, children, className, overlayClassName, labelledBy }: ModalShellProps): React.ReactElement {
  useEscapeKey(onClose);

  return (
    <div className={`modal-overlay${overlayClassName ? ` ${overlayClassName}` : ''}`} onClick={onClose}>
      <div
        className={`modal-content relative p-6${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" onClick={onClose} aria-label="Close" className="modal-close-btn">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
