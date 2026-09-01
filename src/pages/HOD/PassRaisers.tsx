// Pass Raisers — an HOD hands the raising of gate passes to somebody in their
// own department, and takes it back (migration 077).
//
// Client, 2026-09-01: "the HOD of all the departments should be able to delegate
// the pass creation capabilities in his left-hand side panel to the person he has
// asked. This should not be any of the department heads or CEO … it should be
// from his own department only. Show the names as a dropdown within his
// department under each HOD and whoever he chooses should be able to log in and
// create passes the way the HOD is raising it. In those scenarios those passes
// should be approved by the HOD as first-level approver and the following is
// routine, followed as usual."
//
// ⚠ THIS IS THE HOD'S OWN SCREEN, NOT THE ADMIN'S — the same rule 062 set for
// the approvers' Delegation tab, one floor down. Nobody approves an
// authorisation: writing it IS the act, and `create_pass_raiser` is gated on
// heading a department rather than on `is_admin()`.
//
// WHAT IT DOES NOT HAND OVER. Not the HOD's dashboard, not their reports, not
// their returns, and above all not their signature: a pass raised under this
// authority carries a level-0 rung addressed back to this department's HODs, so
// the person who raises it cannot be the person who approves it. That is the
// four-eyes property the whole ladder exists for, kept intact one rung lower
// than it used to start.
//
// SAME SKIN AS `/approvals` AND `/delegation`. `.gb-board gb-main` on one div.
import React, { useMemo, useRef, useState } from 'react';
import RaiserForm from '../../components/hod/RaiserForm';
import RaiserTable from '../../components/hod/RaiserTable';
import {
  currentRaiser,
  EMPTY_RAISER_DRAFT,
  raiserArgs,
  raiserLabel,
  RAISER_STATUS_NOTES,
  validateRaiser,
  type RaiserDraft,
  type RaiserErrors,
} from '../../lib/passRaising';
import {
  DELEGATION_STATUS_LABELS,
  DELEGATION_STATUS_PILL,
} from '../../lib/approvalDelegation';
import { formatDateTime } from '../../lib/formatDate';
import {
  createPassRaiser,
  revokePassRaiser,
  usePassRaisers,
} from '../../lib/usePassRaisers';

export default function PassRaisers(): React.ReactElement {
  const { rows, candidates, canAuthorise, loading, error, reload } = usePassRaisers();
  const [draft, setDraft] = useState<RaiserDraft>(EMPTY_RAISER_DRAFT);
  const [errors, setErrors] = useState<RaiserErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLSelectElement>(null);

  const current = useMemo(() => currentRaiser(rows), [rows]);

  function jumpToForm(): void {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    firstFieldRef.current?.focus();
  }

  async function submit(): Promise<void> {
    // Validated against the clock at the moment of the press, not at mount: a
    // page left open over lunch must not accept a window that has since passed.
    const found = validateRaiser(draft, new Date());
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      await createPassRaiser(raiserArgs(draft));
      setDraft(EMPTY_RAISER_DRAFT);
      setDone('Authorised. They can raise passes for your department in that window.');
      // RE-READ, NEVER PATCH. Only the database knows the status the new row
      // came out with — a window opening in an hour is `scheduled`, not
      // `active` — and guessing here is how this page comes to disagree with
      // the authority that decides who may actually raise.
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Could not authorise that person.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setBusy(true);
    setFailure(null);
    setDone(null);
    try {
      await revokePassRaiser(id);
      setDone('Authority revoked. Raising is back with you alone.');
      await reload();
    } catch (err) {
      setFailure(err instanceof Error ? err.message : 'Could not revoke that authority.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gb-board gb-main">
      <div className="gb-page-head">
        <div className="min-w-0">
          <h1 className="gb-page-title">Pass Raisers</h1>
          <p className="gb-sub">
            Let somebody in your department raise gate passes for you. Every pass they raise comes
            to you for approval before it goes anywhere else.
          </p>
        </div>
        <div className="gb-head-tools">
          {canAuthorise && (
            <button type="button" className="gb-btn-primary gbd-head-btn" onClick={jumpToForm}>
              Authorise Someone
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
          {/* NO CARD WHEN NOTHING IS RUNNING — the rule the client set for the
              approvers' own screen (2026-08-23), and the ordinary condition of
              most departments. A live or scheduled authority gets its card. */}
          {current && (
            <div className="gb-card gb-panel">
              <div className="gb-panel-head">
                <h2 className="gb-panel-title">Currently Authorised</h2>
                <span className={DELEGATION_STATUS_PILL[current.status]}>
                  {DELEGATION_STATUS_LABELS[current.status]}
                </span>
              </div>
              <dl className="p-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="label">Person</dt>
                  <dd>{raiserLabel(current)}</dd>
                </div>
                <div>
                  <dt className="label">From</dt>
                  <dd>{formatDateTime(current.starts_at)}</dd>
                </div>
                <div>
                  <dt className="label">To</dt>
                  <dd>{formatDateTime(current.ends_at)}</dd>
                </div>
              </dl>
              <div className="gb-panel-foot">
                <span className="gbd-subline">{RAISER_STATUS_NOTES[current.status]}</span>
              </div>
            </div>
          )}

          {/* AN ACCOUNT THAT HEADS NO DEPARTMENT HAS NOTHING TO HAND OVER, and
              `create_pass_raiser` refuses it — so the form is not drawn rather
              than drawn to fail once it is filled in. */}
          {canAuthorise ? (
            <div ref={formRef}>
              <RaiserForm
                draft={draft}
                errors={errors}
                candidates={candidates}
                busy={busy}
                firstFieldRef={firstFieldRef}
                onChange={setDraft}
                onSubmit={() => void submit()}
                onReset={() => {
                  setDraft(EMPTY_RAISER_DRAFT);
                  setErrors({});
                }}
              />
            </div>
          ) : (
            <div className="gb-card gb-panel">
              <div className="gb-empty">
                You do not head a department yet, so there is nothing here to hand over.
              </div>
            </div>
          )}

          <RaiserTable rows={rows} busy={busy} onRevoke={revoke} />
        </>
      )}
    </div>
  );
}
