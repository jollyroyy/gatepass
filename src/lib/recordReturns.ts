// Recording a set of ticked lines as returned — one place, two callers
// (Scheduled Returns and Overdue Items).
//
// ONE RPC CALL PER PASS. `apply_item_returns` takes a pass and its OWN lines,
// and a table of lines can span several passes; splitting the ticks by parent
// here is what lets a guard clear three passes in one press.
//
// THE PASS CLOSES ITSELF. The RPC rolls the lines up into the parent in the
// same statement — the client never decides "everything is back". Re-read after
// this resolves; do not infer.
//
// THERE IS NO UNDO, and that is settled: `returned_qty` only ever increases and
// `returned_at` is written through `coalesce`. Callers must therefore make this
// a deliberate second press, never a side effect of a tap.
import { gp } from '../supabaseClient';
import type { GatePassItemView, GatePassView } from '../types';

export interface ReturnableLine {
  item: Pick<GatePassItemView, 'id' | 'line_no' | 'name' | 'outstanding_qty'>;
  pass: Pick<GatePassView, 'id'>;
}

/** Records every line's FULL outstanding quantity. Throws the first RPC error,
 *  so a caller's catch shows the database's own words. */
export async function recordItemReturns(lines: ReturnableLine[]): Promise<void> {
  const byPass = new Map<string, ReturnableLine[]>();
  for (const line of lines) {
    byPass.set(line.pass.id, [...(byPass.get(line.pass.id) ?? []), line]);
  }
  for (const [passId, group] of byPass) {
    const { error } = await gp().rpc('apply_item_returns', {
      p_pass_id: passId,
      p_lines: group.map((l) => ({ item_id: l.item.id, qty: l.item.outstanding_qty })),
      p_remarks: `Returned ${group.length} ${group.length === 1 ? 'line' : 'lines'}: ${group
        .map((l) => `#${l.item.line_no} ${l.item.name}`)
        .join(', ')}`,
    });
    if (error) throw error;
  }
}
