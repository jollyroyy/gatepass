// THE STANDING COPY LIST, as a block of address rows in Admin → Settings
// (migration 078).
//
// Client, 2026-09-01: "admin should be able to configure three to four email
// IDs in the setting part and all those emails should be receiving the
// notifications about the gate pass raising and all those status changes."
//
// ═══ WHY FIXED ROWS AND NOT AN ADD/REMOVE LIST ═══
//
// Four boxes, always there, blanks allowed. A list with Add and Remove buttons
// would be more elegant and worse to use for this: the whole interaction is
// "type three addresses once, change one of them a year later". Fixed rows mean
// clearing row 2 does not renumber rows 3 and 4 under the cursor, and there is
// no button to find before you can type.
//
// A row is REMOVED by emptying it. `copyListPayload` drops the blanks on the
// way to the database, so the stored array is dense however gappy the form is.
import React from 'react';
import SettingField from './SettingField';
import { MAX_COPY_ADDRESSES, copyListNote, copyListPayload } from '../../lib/mailRecipients';

interface Props {
  rows: string[];
  onChange: (rows: string[]) => void;
  /** One message per wrong row, keyed by index — a single string could not say
   *  WHICH of four addresses is the duplicate. */
  errors?: Record<number, string>;
  /** The redirect, if one is set. Not used to disable anything: it is used to
   *  SAY that these copies are currently going nowhere, which is the one way
   *  this feature silently does nothing. */
  overrideTo: string | null;
}

export default function NotifyCcFields({
  rows, onChange, errors = {}, overrideTo,
}: Props): React.ReactElement {
  function setRow(index: number, value: string) {
    onChange(rows.map((r, i) => (i === index ? value : r)));
  }

  const filled = copyListPayload(rows).length;

  return (
    <div className="border-t border-surface-200 dark:border-navy-700 pt-4 space-y-3">
      <div>
        <h3 className="card-title mb-1">Always copy these people</h3>
        <p className="text-sm text-navy-600">{copyListNote(filled, overrideTo)}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {rows.map((value, i) => (
          <SettingField
            key={i}
            id={`mail-notify-cc-${i}`}
            label={`Address ${i + 1}`}
            value={value}
            onChange={(v) => setRow(i, v)}
            error={errors[i]}
            type="email"
            autoComplete="off"
            placeholder="name@company.com"
          />
        ))}
      </div>

      {errors[MAX_COPY_ADDRESSES] && (
        <p className="text-xs text-flagged-600">{errors[MAX_COPY_ADDRESSES]}</p>
      )}

      <p className="text-xs text-navy-500">
        These addresses do not need an account in this system, and they are copied visibly — the
        approver can see who else was told. They receive every letter about every pass, so keep the
        list to people who genuinely want all of it.
      </p>
    </div>
  );
}
