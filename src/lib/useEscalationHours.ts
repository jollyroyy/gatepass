// HOW LONG THE COO HAS BEFORE THE CEO MAY SIGN LEVEL 3 (migration 063).
//
// One integer, read from `gatepass.get_escalation_hours()` — which is granted
// to every signed-in user for the same reason `get_session_timeout` is: the
// office holding the pass is not an admin, and their own screen has to be able
// to say when a pass becomes theirs. It returns that one field and no other.
//
// A FAILURE IS THE SHIPPED DEFAULT, NOT AN ERROR. Every screen that asks this
// is a screen about a pass, and refusing to render an approval queue because a
// settings lookup failed would be worse than being an hour out on one sentence.
// The database enforces the real window inside `approve_pass_level` either way.
import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import { DEFAULT_ESCALATION_HOURS } from './approvalDecision';

export function useEscalationHours(): number {
  const [hours, setHours] = useState(DEFAULT_ESCALATION_HOURS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await gp().rpc('get_escalation_hours');
        if (cancelled || error) return;
        const n = Number(data);
        if (Number.isFinite(n) && n > 0) setHours(n);
      } catch {
        /* The shipped default — see the header. */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return hours;
}
