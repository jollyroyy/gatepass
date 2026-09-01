// The uploaded signatures ONE pass has actually earned (migration 075).
//
// One RPC, `gatepass.get_pass_signatures`, which returns a mark only where this
// database holds a recorded act by that person on this pass — they raised it,
// approved a rung, cleared it out of the gate, or took every line back in. A
// pending rung, a rejected one, and a level-3 rung closed as `not_required`
// because the other office signed (063) all return NO ROW. That is the client's
// "don't show the signature until and unless I approve", enforced where it
// cannot be argued with rather than in the component that draws the box.
//
// IT IS A SEPARATE CALL, not a column on an existing read, and deliberately:
// `v_gate_passes` is read by every list, card, drill, report and CSV in this
// app with `select('*')`, and hanging seven signature URLs off it would put
// them on every one of those queries for the sake of the one screen that
// prints. This asks only when a slip is being drawn.
//
// FAILURE IS AN EMPTY MAP, NEVER AN ERROR ON SCREEN. A slip with no signature
// images is exactly the slip this app printed the day before the feature
// existed — every box still carries its tick, its name, its date and its
// caption, which is what the paper is actually read for. Putting "could not
// load signatures" on a gate pass would be noise on a legal-ish document.
import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { PassSignatures } from './printSignatureBoxes';

type SignatureRow = { slot: string; signature_url: string | null };

export function usePassSignatures(passId: string | undefined): PassSignatures {
  const [signatures, setSignatures] = useState<PassSignatures>({});

  useEffect(() => {
    if (!passId) {
      setSignatures({});
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        const { data, error } = await gp().rpc('get_pass_signatures', { p_pass_id: passId });
        if (cancelled || error) return;
        const map: PassSignatures = {};
        for (const row of (data as SignatureRow[] | null) ?? []) {
          if (row.slot && row.signature_url) map[row.slot] = row.signature_url;
        }
        setSignatures(map);
      } catch {
        // See above: an empty map is a correct slip, not a broken one.
      }
    })();

    return () => { cancelled = true; };
  }, [passId]);

  return signatures;
}
