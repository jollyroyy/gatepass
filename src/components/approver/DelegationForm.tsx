// "Create New Delegation" — the client's mock-up form, less the three fields
// they struck out (2026-08-22).
//
// WHAT IS NOT ASKED FOR, AND WHY. The mock drew Approval Type ("Gate Pass"),
// Location / Site ("Bangalore Plant") and Scope / Limit ("All Gate Pass
// Types"), and the client removed all three by name: "no need to select the
// gate … Gate and what type of gate it should be, gate path, so no need to
// mention the type of delegation gate pass and all." They could not have been
// filled honestly anyway — this app approves exactly one kind of document, and
// it has no gate entity and no site to name. A select with one option is not a
// choice; it is a control that teaches a reader there are others.
//
// FIVE FIELDS REMAIN, and every one of them changes what the delegation does:
// who, from when, to when, up to what value, and why. The last two are
// optional and say so.
//
// THE FORM IS THE RPC's RULE STATED EARLY, never instead of it. `validateDelegation`
// mirrors `create_approval_delegation`'s own refusals so a reader is told before
// a round trip; the database still refuses everything it refused before, and the
// refusals a browser cannot know — the delegate already holds a seat, the window
// overlaps another — come back from it as sentences and are shown as they are.
import React from 'react';
import {
  candidateLabel,
  type DelegateCandidate,
  type DelegationDraft,
  type DelegationErrors,
} from '../../lib/approvalDelegation';

type Props = {
  draft: DelegationDraft;
  errors: DelegationErrors;
  candidates: DelegateCandidate[];
  busy: boolean;
  /** The Delegate To control, so the header's "+ Create Delegation" button has
   *  something real to do — it scrolls this card into view and puts the cursor
   *  in the first field. */
  firstFieldRef?: React.RefObject<HTMLSelectElement>;
  onChange: (next: DelegationDraft) => void;
  onSubmit: () => void;
  onReset: () => void;
};

export default function DelegationForm({
  draft,
  errors,
  candidates,
  busy,
  firstFieldRef,
  onChange,
  onSubmit,
  onReset,
}: Props): React.ReactElement {
  const set = (patch: Partial<DelegationDraft>): void => onChange({ ...draft, ...patch });

  return (
    <form
      className="gb-card gb-panel gbd-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <div className="gb-panel-head">
        <h2 className="gb-panel-title">Create New Delegation</h2>
      </div>

      <div className="gbd-grid">
        <div className="gb-rep-field">
          <label className="gb-rep-field-label" htmlFor="delegate-to">
            Delegate To *
          </label>
          <select
            id="delegate-to"
            ref={firstFieldRef}
            className="gb-select"
            value={draft.delegateId}
            onChange={(e) => set({ delegateId: e.target.value })}
          >
            <option value="">Select a person…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {candidateLabel(c)}
              </option>
            ))}
          </select>
          {/* WHY SOMEBODY MAY BE MISSING FROM THIS LIST, said where they would
              have looked for them. The list is narrowed server-side to people
              who hold no other approval seat, and a name silently absent reads
              as a broken query. */}
          <p className="gbd-hint">
            Anyone active who does not already hold an approval office, deputy seat or delegation.
          </p>
          {errors.delegateId && <p className="gb-field-error">{errors.delegateId}</p>}
        </div>

        <div className="gb-rep-field">
          <label className="gb-rep-field-label" htmlFor="delegate-start">
            Start Date &amp; Time *
          </label>
          <input
            id="delegate-start"
            type="datetime-local"
            className="gb-input"
            value={draft.startsAt}
            onChange={(e) => set({ startsAt: e.target.value })}
          />
          {errors.startsAt && <p className="gb-field-error">{errors.startsAt}</p>}
        </div>

        <div className="gb-rep-field">
          <label className="gb-rep-field-label" htmlFor="delegate-end">
            End Date &amp; Time *
          </label>
          <input
            id="delegate-end"
            type="datetime-local"
            className="gb-input"
            value={draft.endsAt}
            onChange={(e) => set({ endsAt: e.target.value })}
          />
          {errors.endsAt && <p className="gb-field-error">{errors.endsAt}</p>}
        </div>

        <div className="gb-rep-field">
          <label className="gb-rep-field-label" htmlFor="delegate-limit">
            Approval Limit (Optional)
          </label>
          <input
            id="delegate-limit"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            className="gb-input"
            placeholder="No Limit"
            value={draft.approvalLimit}
            onChange={(e) => set({ approvalLimit: e.target.value })}
          />
          {/* THE CEILING IS REAL AND IS ENFORCED IN THE DATABASE. Saying so
              here matters: a limit the reader believed was advisory would be a
              control they set and then ignored. */}
          <p className="gbd-hint">
            The most a pass may be worth for your delegate to approve it. Leave blank for no limit.
          </p>
          {errors.approvalLimit && <p className="gb-field-error">{errors.approvalLimit}</p>}
        </div>

        <div className="gb-rep-field gbd-wide">
          <label className="gb-rep-field-label" htmlFor="delegate-reason">
            Reason (Optional)
          </label>
          <textarea
            id="delegate-reason"
            className="gb-input gbd-textarea"
            rows={2}
            maxLength={500}
            placeholder="Official leave"
            value={draft.reason}
            onChange={(e) => set({ reason: e.target.value })}
          />
        </div>
      </div>

      <div className="gbd-form-actions">
        <button type="submit" className="gb-btn-primary" disabled={busy}>
          {busy ? 'Activating…' : 'Activate Delegation'}
        </button>
        <button type="button" className="gb-btn-ghost" onClick={onReset} disabled={busy}>
          Reset
        </button>
      </div>
    </form>
  );
}
