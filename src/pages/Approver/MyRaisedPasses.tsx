// THE PASSES A COO OR CEO RAISED THEMSELVES.
//
// Client, 2026-08-31: the COO and the CEO may raise a pass "on behalf of any
// department". This is the other half of that — the register they read it back
// from.
//
// IT EXISTS BECAUSE NO OTHER SCREEN OF THEIRS CAN SHOW SUCH A PASS. An office
// holder heads no department, so `gate_passes_select` admits their own pass
// only through migration 069's `raised_by = auth.uid()` arm; their approval
// queue lists what is routed TO them and 061 hides a pass until every rung
// below theirs is signed. Without this page a pass they raised is unreachable
// the moment the confirmation modal closes — not filtered out, genuinely gone
// from every list they can open.
//
// THE FILTER IS THE FACT, NOT A SCOPE. `raised_by = auth.uid()` is stated in
// the query because this page means "mine", and RLS would otherwise also admit
// anything routed to their office — a pass somebody else raised has no business
// in a list headed "Passes I Raised". An HOD's register is Reports, which is a
// department's passes and a different question.
//
// One read, no realtime: a pass here changes when an approver signs it, which
// is minutes-to-days away and is what a refresh is for. The board that does
// need the live view is the queue, and it has one.
import React, { useEffect, useState } from 'react';
import { supabase, gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { APPROVER_HOME } from '../../lib/roleRoutes';
import DrillPageShell from '../../components/DrillPageShell';
import PassStack from '../../components/PassStack';

export default function MyRaisedPasses(): React.ReactElement {
  const [passes, setPasses] = useState<GatePassView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (!uid) throw new Error('Could not determine your user account. Please sign in again.');
        const { data, error: readErr } = await gp()
          .from('v_gate_passes')
          .select('*')
          .eq('raised_by', uid)
          .order('created_at', { ascending: false });
        if (readErr) throw readErr;
        if (!cancelled) setPasses((data as GatePassView[]) ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(safeErrorMessage(err));
          setPasses([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <DrillPageShell
      backTo={APPROVER_HOME}
      backLabel="Back to Pending for My Approval"
      title="Passes I Raised"
      subtitle="Every gate pass you raised on a department's behalf, newest first."
      count={passes?.length}
      error={error}
    >
      {passes === null && <div className="skeleton h-40 w-full" />}
      {passes !== null && passes.length === 0 && !error && (
        <div className="empty-state card p-10">
          <p className="text-navy-700 font-medium">You have not raised a gate pass yet.</p>
          <p className="text-caption text-navy-600 mt-1">
            Raise Gate Pass takes you through the same form a department head uses — you choose which
            department it is raised for.
          </p>
        </div>
      )}
      {passes !== null && passes.length > 0 && (
        // `showContext` prints the department on the card, which is the one
        // fact this reader cannot infer: every pass in an HOD's list is their
        // own department's, and none of these are.
        <PassStack passes={passes} showRaisedBy={false} showContext />
      )}
    </DrillPageShell>
  );
}
