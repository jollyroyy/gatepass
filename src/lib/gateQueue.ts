// "Waiting at the gate" — the one predicate two dashboards ask about.
//
// It used to live in `src/lib/boardKpis.ts`, alongside the admin board's KPI
// definitions. That board was replaced wholesale by the client's Overview
// mock-up (2026-08-19, twelfth pass) and the file went with it; this predicate
// survived because both the HOD's "N pending at the gate" note and the admin
// Overview's "Pending Approvals" figure are the same question.
//
// AN EXPIRED PASS IS NOT IN THE QUEUE, and that exclusion is load-bearing.
// `match_pass` refuses a pass past its `expires_at` forever, so counting it
// under "Pending Approvals" tells an admin the queue is longer than it is and
// tells the raising HOD their paperwork is still alive. It is surfaced instead
// as a decision for that HOD — the bell, and `/expired/:id`.
//
// `is_expired` comes straight off `gatepass.v_gate_passes`. Never recompute
// expiry in TypeScript.
import type { GatePassView } from '../types';

export const isWaitingAtGate = (p: GatePassView): boolean => p.status === 'pending' && !p.is_expired;
