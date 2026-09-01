// Holds ONE reserved reference number for the Raise form, and swaps it when the
// form changes what the number would say (migration 074).
//
// THE NUMBER IS `TYPE-DEPTCODE-NNNN`, so the pass type and the department are
// both part of it. Toggling RGP → NRGP, or a COO picking a different department,
// invalidates the number already held — it names a pass that is no longer the
// one being written. So this hook does exactly two things on every change:
// release the old number, take a new one.
//
// RELEASE-THEN-TAKE, IN THAT ORDER, and it matters. The server's counter is a
// live max over outstanding reservations, so releasing first lets the very
// number just given back be handed straight to this same form when the reader
// toggles the type and toggles it back — which is the common case, and would
// otherwise burn a serial per keystroke of indecision.
//
// IT IS ALWAYS ALLOWED TO FAIL. A null number means the field shows 074's old
// `####` preview and the pass is numbered on insert exactly as it was before
// this feature existed. Nothing here surfaces an error, because there is no
// error here a person filling in a form could act on.
import { useEffect, useRef, useState } from 'react';
import { releasePassNumber, reservePassNumber } from '../../lib/passNumberReservation';
import type { PassType } from '../../types';

export function useReservedPassNumber(
  type: PassType,
  departmentId: string | undefined,
): string | null {
  const [number, setNumber] = useState<string | null>(null);
  // What we are currently holding, readable from the cleanup without making the
  // effect depend on it — a dependency on the number itself would re-run this
  // effect the moment it succeeded, releasing and re-taking for ever.
  const held = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!departmentId) {
      // A COO or CEO who has not chosen a department yet. Nothing to reserve,
      // and nothing to show but the preview's `DEPT` placeholder.
      void releasePassNumber(held.current);
      held.current = null;
      setNumber(null);
      return () => { cancelled = true; };
    }

    void (async () => {
      await releasePassNumber(held.current);
      held.current = null;
      const next = await reservePassNumber(type, departmentId);
      // A LATER CHANGE HAS ALREADY WON. Two reservations in flight — the reader
      // changed the type twice quickly — must not leave the second one's number
      // on screen under the third one's form, so a cancelled run gives its
      // number straight back rather than storing it.
      if (cancelled) {
        void releasePassNumber(next);
        return;
      }
      held.current = next;
      setNumber(next);
    })();

    return () => { cancelled = true; };
  }, [type, departmentId]);

  // Give the number back when the form is closed without submitting. This is
  // the ONLY unmount path that matters: a submitted pass has consumed its
  // reservation server-side, and `release_pass_number` refuses to touch a
  // consumed row, so a release racing a successful submit is a no-op rather
  // than a pass losing its number.
  useEffect(() => () => { void releasePassNumber(held.current); }, []);

  return number;
}
