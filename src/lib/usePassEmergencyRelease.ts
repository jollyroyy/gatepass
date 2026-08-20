// Was THIS pass released past its approval ladder, and why (migration 055)?
//
// Shaped exactly like `usePassApprovals`: one read keyed on the pass id, a
// cancelled flag so a fast navigation cannot write into an unmounted record,
// and NULL as the answer when the read fails. That last part is deliberate and
// is argued in `fetchPassEmergencyRelease` — a banner is drawn beside the whole
// gate pass record, and one that cannot load must not take the record with it.
//
// The `nonce` is the one difference. A release happens ON this screen, so the
// banner has to appear without a navigation; bumping the nonce re-reads. It is
// a number rather than a boolean because two releases in one session would
// otherwise toggle back to a value the effect had already seen.
import { useEffect, useState } from 'react';
import { fetchPassEmergencyRelease, type PassEmergencyRelease } from './emergencyRelease';

export function usePassEmergencyRelease(
  passId: string | null | undefined,
  nonce = 0,
): PassEmergencyRelease | null {
  const [row, setRow] = useState<PassEmergencyRelease | null>(null);

  useEffect(() => {
    if (!passId) {
      setRow(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const found = await fetchPassEmergencyRelease(passId);
      if (!cancelled) setRow(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [passId, nonce]);

  return row;
}
