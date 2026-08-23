// Approval Delegation — an office holder hands their own office to somebody
// else while they are away (client mock-up, 2026-08-22; migration 062).
//
// ⚠ THIS IS THE APPROVER'S OWN SCREEN, NOT THE ADMIN'S (client: "instead of
// that put it in the approvers section so whatever the approvers choose it
// should be automatically delegated"). Nobody approves a delegation: writing it
// IS the act, and `create_approval_delegation` is gated on holding the office
// yourself rather than on `is_admin()`. The admin's own ladder card still names
// each office's HOLDER and its STANDING DEPUTY (043/054) — a different, longer
// -lived arrangement — and is untouched by this.
//
// THE HISTORY IS HIDDEN UNTIL IT IS ASKED FOR (client: "make sure you don't
// show the history on the first page but only when the user clicks on the top
// right corner, Delegation History, then only you show them below a delegation
// history table"). The button is a real toggle with `aria-expanded`, and the
// table renders under the form when it is on — not a modal, and not a second
// route: what a reader wants after opening it is to compare it with the
// delegation running above.
//
// THE OTHER HEADER BUTTON GOES SOMEWHERE. "+ Create Delegation" scrolls the
// Create New Delegation card into view and puts the cursor in Delegate To. The
// mock draws the button over an always-visible form, and a control that does
// nothing at all is worse than no control — this app's standing rule about the
// mock's own chrome.
//
// SAME SKIN AS `/approvals`. `.gb-board gb-main` on one div, so an office
// holder never crosses between the guard's light screen and the house dark
// default mid-session.
import React, { useMemo, useRef, useState } from 'react';
import GuardPageHeader from '../../components/guard/GuardPageHeader';
import DelegationStatusCard from '../../components/approver/DelegationStatusCard';
import DelegationForm from '../../components/approver/DelegationForm';
import DelegationHistoryTable from '../../components/approver/DelegationHistoryTable';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';
import {
  currentDelegation,
  delegationArgs,
  EMPTY_DELEGATION_DRAFT,
  validateDelegation,
  type DelegationDraft,
  type DelegationErrors,
} from '../../lib/approvalDelegation';
import {
  createDelegation,
  revokeDelegation,
  useApprovalDelegations,
} from '../../lib/useApprovalDelegations';

const HistoryGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <path strokeLinecap="round" d="M3.75 12a8.25 8.25 0 108.25-8.25A8.2 8.2 0 006 6" />
    <path strokeLinecap="round" d="M3.75 3.75V7.5h3.75M12 7.5V12l3 1.75" />
  </svg>
);

const PlusGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <path strokeLinecap="round" d="M12 5.25v13.5M5.25 12h13.5" />
  </svg>
);

export default function ApprovalDelegation({
  office,
}: {
  office: ApprovalRoleKey | null;
}): React.ReactElement {
  const { rows, candidates, canDelegate, loading, error, reload } = useApprovalDelegations();
  const [draft, setDraft] = useState<DelegationDraft>(EMPTY_DELEGATION_DRAFT);
  const [errors, setErrors] = useState<DelegationErrors>({});
  const [showHistory, setShowHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [stamp] = useState(() => new Date().toISOString());
  const formRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  const current = useMemo(() => currentDelegation(rows), [rows]);

  function jumpToForm(): void {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    firstFieldRef.current?.focus();
  }

  async function submit(): Promise<void> {
    // Validated against the clock at the moment of the press, not at mount: a
    // page left open over lunch must not accept a window that has since passed.
    const found = validateDelegation(draft, new Date());
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      await createDelegation(delegationArgs(draft));
      setDraft(EMPTY_DELEGATION_DRAFT);
      setDone('Delegation activated.');
      // RE-READ, NEVER PATCH. Only the database knows the status the new row
      // came out with — a window opening in an hour is `scheduled`, not
      // `active`, and guessing here is how the card comes to disagree with the
      // authority that decides who may sign.
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Could not create that delegation.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      await revokeDelegation(id);
      setDone('Delegation revoked. Approvals are back with you alone.');
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Could not revoke that delegation.');
    } finally {
      setBusy(false);
    }
  }

  if (!office) {
    return (
      <div className="gb-board gb-main">
        <GuardPageHeader
          title="Approval Delegation"
          subtitle="Delegate your gate pass approval authority to another user when you are unavailable."
          glyph="exchange"
          tone="purple"
          stamp={stamp}
        />
        <div className="gb-empty">This account does not hold an approval office.</div>
      </div>
    );
  }

  return (
    <div className="gb-board gb-main">
      <div className="gb-page-head">
        <div className="min-w-0">
          <h1 className="gb-page-title">Approval Delegation</h1>
          <p className="gb-sub">
            Delegate your Gate Pass approval authority to another user when you are unavailable.
          </p>
        </div>
        <div className="gb-head-tools">
          <button
            type="button"
            className="gb-btn-ghost gbd-head-btn"
            aria-expanded={showHistory}
            aria-controls="delegation-history"
            onClick={() => setShowHistory((v) => !v)}
          >
            {HistoryGlyph}
            Delegation History
          </button>
          {canDelegate && (
            <button type="button" className="gb-btn-primary gbd-head-btn" onClick={jumpToForm}>
              {PlusGlyph}
              Create Delegation
            </button>
          )}
        </div>
      </div>

      {error && <div className="gb-alert">{error}</div>}
      {failure && <div className="gb-alert">{failure}</div>}
      {done && <div className="gbd-done">{done}</div>}

      {loading ? (
        <div className="gb-card gb-panel">
          <div className="gb-empty">
            <div className="gb-skeleton" />
          </div>
        </div>
      ) : (
        <>
          {/* NO CARD WHEN NOTHING IS RUNNING (client, 2026-08-23). An office
              with no cover is the ordinary condition of all four of them, and
              a panel whose whole content was "You have no delegation running"
              was the first thing every approver read on this page. A live or
              scheduled delegation still gets its card — and its Revoke. */}
          {current && <DelegationStatusCard row={current} busy={busy} onRevoke={revoke} />}

          {/* A DEPUTY OR A DELEGATE MAY NOT HAND ON WHAT THEY ARE COVERING —
              `create_approval_delegation` refuses them, and drawing the form
              would be a page that fails once it is filled in. They still read
              their own (empty) history above. */}
          {canDelegate ? (
            <div ref={formRef}>
              <DelegationForm
                office={office}
                draft={draft}
                errors={errors}
                candidates={candidates}
                busy={busy}
                firstFieldRef={firstFieldRef}
                onChange={setDraft}
                onSubmit={() => void submit()}
                onReset={() => {
                  setDraft(EMPTY_DELEGATION_DRAFT);
                  setErrors({});
                }}
              />
            </div>
          ) : (
            <div className="gb-card gb-panel">
              <div className="gb-empty">
                You are acting for the {APPROVAL_ROLE_TITLES[office]} office as a stand-in, so there
                is nothing here for you to delegate onward.
              </div>
            </div>
          )}

          {showHistory && <DelegationHistoryTable rows={rows} busy={busy} onRevoke={revoke} />}
        </>
      )}
    </div>
  );
}
