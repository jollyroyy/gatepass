// AUTHORISE SOMEBODY TO RAISE — the HOD's own form (migration 077; client,
// 2026-09-01: "Show the names as a dropdown within his department under each
// HOD and whoever he chooses should be able to log in and create passes the way
// the HOD is raising it").
//
// THE DROPDOWN IS THE FEATURE. It is `gatepass.list_raiser_candidates()` and
// nothing else — active members of this HOD's own department who are not
// department heads, admins, guards or approvers — so every name on it is one the
// write will accept. The eligibility sentence sits under the control rather than
// in a tooltip: a silently short list reads as a broken query, and the person
// looking for a colleague who is not there needs to know why in the place they
// are looking.
//
// NO VALUE CEILING AND NO SCOPE FIELDS. The approvers' delegation form carries
// an approval limit; this one has nothing to cap, because a raiser commits the
// business to nothing — every pass they raise comes back to the HOD for
// signature before it moves at all.
//
// Same skin as the rest of the app's boards: `.gb-card gb-panel` on the sheet,
// the house field classes inside it.
import React from 'react';
import {
  RAISER_ELIGIBILITY_NOTE,
  raiserCandidateLabel,
  type RaiserCandidate,
  type RaiserDraft,
  type RaiserErrors,
} from '../../lib/passRaising';

interface Props {
  draft: RaiserDraft;
  errors: RaiserErrors;
  candidates: RaiserCandidate[];
  busy: boolean;
  firstFieldRef?: React.RefObject<HTMLSelectElement>;
  onChange: (draft: RaiserDraft) => void;
  onSubmit: () => void;
  onReset: () => void;
}

export default function RaiserForm({
  draft, errors, candidates, busy, firstFieldRef, onChange, onSubmit, onReset,
}: Props): React.ReactElement {
  const set = <K extends keyof RaiserDraft>(key: K, value: RaiserDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <form
      className="gb-card gb-panel"
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      noValidate
    >
      <div className="gb-panel-head">
        <h2 className="gb-panel-title">Authorise Someone to Raise</h2>
      </div>

      <div className="p-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="raiser-person">Who may raise for you</label>
          <select
            id="raiser-person"
            ref={firstFieldRef}
            className="input"
            value={draft.raiserId}
            disabled={busy}
            onChange={(e) => set('raiserId', e.target.value)}
          >
            <option value="">Select a person…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{raiserCandidateLabel(c)}</option>
            ))}
          </select>
          {/* THE RULE, WHERE THE MISSING NAME WOULD BE LOOKED FOR. */}
          <p className="mt-1 text-xs text-navy-500">{RAISER_ELIGIBILITY_NOTE}</p>
          {candidates.length === 0 && (
            <p className="mt-1 text-xs text-navy-500">
              Nobody in your department is eligible yet. An admin creates the account and puts
              them in your department; they appear here as soon as they do.
            </p>
          )}
          {errors.raiserId && <p className="error-text">{errors.raiserId}</p>}
        </div>

        <div>
          <label className="label" htmlFor="raiser-starts">Starts</label>
          <input
            id="raiser-starts"
            type="datetime-local"
            className="input"
            value={draft.startsAt}
            disabled={busy}
            onChange={(e) => set('startsAt', e.target.value)}
          />
          {errors.startsAt && <p className="error-text">{errors.startsAt}</p>}
        </div>

        <div>
          <label className="label" htmlFor="raiser-ends">Ends</label>
          <input
            id="raiser-ends"
            type="datetime-local"
            className="input"
            value={draft.endsAt}
            disabled={busy}
            onChange={(e) => set('endsAt', e.target.value)}
          />
          {errors.endsAt && <p className="error-text">{errors.endsAt}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className="label" htmlFor="raiser-reason">Reason (optional)</label>
          <input
            id="raiser-reason"
            type="text"
            className="input"
            placeholder="Covering my site visits in September"
            maxLength={500}
            value={draft.reason}
            disabled={busy}
            onChange={(e) => set('reason', e.target.value)}
          />
        </div>

        <p className="sm:col-span-2 text-xs text-navy-500">
          Every pass they raise comes to you for approval first, at level 0, and then climbs the
          usual ladder. They can see only the passes they raised themselves.
        </p>
      </div>

      <div className="gb-panel-foot flex flex-wrap gap-2 justify-end">
        <button type="button" className="gb-btn-ghost" disabled={busy} onClick={onReset}>
          Clear
        </button>
        <button type="submit" className="gb-btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Authorise'}
        </button>
      </div>
    </form>
  );
}
