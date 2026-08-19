// "Add Guard Remark" — the side box the overdue card's menu opens (client,
// 2026-08-19).
//
// A SIDE BOX, NOT A MODAL, for the same reason AddReturnBox is one: the guard
// is reading the pass's own row while typing the note about it, so nothing
// behind is covered or disabled. Escape or Cancel closes it.
//
// A REMARK CANNOT BE EDITED OR DELETED — `gatepass.pass_remarks` (044) grants
// nobody UPDATE or DELETE and there is no RPC for either. That is what makes it
// a record of the chase rather than a note somebody can tidy up afterwards, and
// it is why the box says so above the button rather than after the press.
import React, { useState } from 'react';
import { addPassRemark } from '../../lib/passActions';
import { safeErrorMessage } from '../../lib/errors';
import { useEscapeKey } from '../../lib/useEscapeKey';

const MAX = 1000;

type Props = {
  passId: string;
  passNumber: string;
  onClose: () => void;
};

export default function RemarkBox({ passId, passNumber, onClose }: Props): React.ReactElement {
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEscapeKey(onClose, !saving);

  const trimmed = body.trim();

  async function save(): Promise<void> {
    if (trimmed.length === 0) {
      setError('A remark cannot be empty.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await addPassRemark(passId, trimmed);
      setSaved(true);
      // Long enough to read the confirmation, short enough not to be in the
      // way of the next card.
      window.setTimeout(onClose, 900);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not save that remark.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="gb-returnbox" role="dialog" aria-label={`Add a guard remark on ${passNumber}`}>
      <div className="gb-returnbox-title">Add Guard Remark</div>
      <div className="gb-returnbox-note">
        {passNumber} — a remark is part of the record and cannot be edited or removed afterwards.
      </div>

      <div className="gb-field">
        <label className="gb-field-label" htmlFor={`remark-${passId}`}>
          What happened
        </label>
        <textarea
          id={`remark-${passId}`}
          className="gb-input gpo-textarea"
          rows={3}
          maxLength={MAX}
          value={body}
          disabled={saving || saved}
          placeholder="Rang the site office — truck returns Monday morning."
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      {error && <div className="gb-field-error">{error}</div>}
      {saved && <div className="gb-returnbox-note">Remark saved.</div>}

      <div className="gb-returnbox-foot">
        <button type="button" className="gb-btn-ghost" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="gb-btn-primary"
          onClick={() => void save()}
          disabled={saving || saved || trimmed.length === 0}
        >
          {saving ? 'Saving…' : 'Save Remark'}
        </button>
      </div>
    </div>
  );
}
