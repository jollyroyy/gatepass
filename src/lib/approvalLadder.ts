// THE APPROVAL LADDER a gate pass record prints down its right-hand side.
//
// It is the printed slip's own chain and nothing else — `signatureBlocks.ts`
// has carried it since the beginning:
//
//     Issuing HOD → Security Head → COO → Finance HOD → CEO → the gate
//
// so the screen and the paper name the same five offices in the same order
// (client, 2026-08-19: "just match the print slip"). Change one and change the
// other, or a guard comparing the slip in their hand to the record on the
// tablet finds a level on one that is missing from the other. The CEO moved
// from third to LAST on 2026-08-20, on the client's instruction — see
// `APPROVAL_LADDER` below, `signatureBlocks.ts`, and migration 057.
//
// SINCE MIGRATION 046 IT IS A WORKFLOW — for the passes that carry one. 043
// recorded only WHO holds each office, and this module graded a level on
// whether the seat was filled. 046 added `gatepass.pass_approvals`: one row per
// office a pass actually owes, snapshotted when it is raised, each row carrying
// a real decision, a real author and a real moment.
//
// SO THIS MODULE READS TWO KINDS OF PASS, and the difference is a fact about
// the pass, not a flag:
//
//   * a pass WITH approval rows is graded from them — approved / waiting /
//     rejected, with the name of whoever pressed it and the time they did. Its
//     ladder is exactly the offices it was routed to; an office that was vacant
//     the day it was raised was never required and is not drawn as missing.
//   * a pass WITHOUT any is graded the old way, from the org chart alone. Every
//     one of the 60 passes on this database predates 046 and reads exactly as
//     it did before, which is the whole reason the fallback is kept rather than
//     back-filled: nobody signed those levels in this system, and a migration
//     that wrote "approved" against them would be inventing an audit trail.
//
// AN OFFICE NOBODY HOLDS IS NOT APPROVED — EXCEPT IN THE GUARD'S VIEW.
// A vacant office reads "Not designated yet" rather than counting as signed:
// implying an approval nobody gave is the one thing this ladder must not do.
// (The fact strip's "N of 5 levels approved" counter was deleted on 2026-08-19
// at the client's word — the rail states every level by name, and a number
// beside it was the same fact twice.)
//
// A GUARD IS THE ONE READER FOR WHOM THE OLD KIND IS ALREADY TRUE — and only
// the old kind. A REAL pending row outranks the paper fiction below, always: a
// pass that still owes a signature under 046 is one a guard cannot even see,
// so drawing its levels as signed would be a screen contradicting the policy
// that hid it. Client, 2026-08-19:
// "only the approved ones will be appearing in the guard's view — mark them so
// that they have been approved by those approvers." A pass only reaches the
// barrier with the signed A5 slip travelling beside it, so for a guard all four
// offices read `done`; a seat nobody holds prints the office alone, because the
// signature on the paper is the fact and the name is only how we print it. For
// an HOD or an admin — who read the record from a desk, with no paper in hand —
// a vacant office still reads `unset` / "Not designated yet", because for them
// the fix is a designation, not a truck waiting at the gate.
import type { GatePassView, UserRole } from '../types';
import { gateStep, returnStep, type ApprovalStep } from './passLadderLegs';
import {
  APPROVAL_NOTE,
  APPROVAL_STATE,
  GRANDFATHERED_NOTE,
  type PassApprovalRow,
} from './passApprovalState';

/** The four offices between the issuing HOD and the gate. Mirrors the
 *  `approval_roles_key_known` check in migration 043 — a fifth office is a
 *  migration and a new entry here, never a free-text row. */
export type ApprovalRoleKey = 'security_head' | 'coo' | 'ceo' | 'finance_head';

/** One row of `gatepass.get_approval_ladder()`. `full_name` and
 *  `department_name` are nullable because the RPC LEFT JOINs into VMS's
 *  `public.profiles` / `public.departments` — a narrowed VMS policy must
 *  degrade to a missing name, never to a missing office. */
export interface ApprovalRoleRow {
  role_key: ApprovalRoleKey;
  user_id: string;
  full_name: string | null;
  department_name: string | null;
  designated_at: string;
  /** The office's optional STANDING DEPUTY (migration 054) — a second person
   *  who may approve exactly what the holder may, with no date window. Null is
   *  the ordinary case: an office with no cover. */
  deputy_id: string | null;
  deputy_name: string | null;
}

/** The title printed beside the level. "Finance HOD" and not "Finance Head"
 *  because that is the word on the slip, and the two documents must agree. */
export const APPROVAL_ROLE_TITLES: Record<ApprovalRoleKey, string> = {
  security_head: 'Security Head',
  coo: 'COO',
  ceo: 'CEO',
  finance_head: 'Finance HOD',
};

/** Slip order, and the order the levels are numbered in. An array rather than
 *  the Record's key order, because level numbers depend on it and object key
 *  order is a language detail, not a promise.
 *
 *  FINANCE SIGNS THIRD AND THE CEO SIGNS LAST (client, 2026-08-20: "1. The
 *  security head has to approve 2. COO 3. Finance 4. CEO"). This REVERSES the
 *  order 043 took off the printed A5 slip, which had the CEO third — the CEO
 *  now signs on a pass finance has already costed. `signatureBlocks.ts` and
 *  migration 057 move with it, and they must be moved together: the paper, the
 *  screen and `pass_approvals.level_no` are one order stated in three places,
 *  and a guard comparing the slip in their hand to the record on the tablet
 *  must not find a level on one that is missing from the other. */
export const APPROVAL_LADDER: { key: ApprovalRoleKey; level: number }[] = [
  { key: 'security_head', level: 1 },
  { key: 'coo', level: 2 },
  { key: 'finance_head', level: 3 },
  { key: 'ceo', level: 4 },
];

/** "COO (Vikram Singh)" — the office first, the person in brackets (client).
 *  The office is the fact that matters on an audit trail; the holder changes.
 *  A vacant office prints its own title alone, never "COO (—)". */
export function approverLine(title: string, name: string | null | undefined): string {
  return name && name.trim() ? `${title} (${name.trim()})` : title;
}

/**
 * "COO (Priya Mehta — delegated by Sudeshna Pal)" — the same bracket, saying in
 * it that the person who signed was standing in (client, 2026-08-22: "if he is
 * a delegated person, in the bracket it should be mentioned that the person has
 * this approver who was delegated by the original approver and the approver's
 * name").
 *
 * IT IS THE BRACKET AND NOT ONLY THE LINE BENEATH, deliberately: the merged
 * timeline, the pass record and the printed reading all show `who` at a glance
 * and the detail line only underneath it, and "who signed this" is exactly the
 * question a delegated signature makes ambiguous.
 *
 * Falls back to the plain `approverLine` in both directions — a delegated
 * decision whose delegator name failed to resolve out of VMS still prints the
 * signer, and an unnamed signer still prints the office. Never "(null)".
 */
export function delegatedLine(
  title: string,
  name: string | null | undefined,
  delegatedBy: string | null | undefined,
): string {
  const who = (name ?? '').trim();
  const from = (delegatedBy ?? '').trim();
  if (!who || !from) return approverLine(title, name);
  return `${title} (${who} — delegated by ${from})`;
}

// Re-exported so a reader of the ladder does not have to know either lives next
// door: both files exist for the file-size cap, not as boundaries.
export type { PassApprovalRow } from './passApprovalState';
export type { ApprovalStep, ApprovalStepState } from './passLadderLegs';

function byKey(roles: ApprovalRoleRow[]): Map<ApprovalRoleKey, ApprovalRoleRow> {
  return new Map(roles.map((r) => [r.role_key, r]));
}

/**
 * Every step of the ladder for one pass, oldest first.
 *
 * `roles` is the whole designation table; a missing entry is an empty office,
 * not an error. The four offices are graded on whether somebody holds them,
 * because their approval is the signature on the paper that travels WITH the
 * material — a pass at the gate with an unsigned box is a conversation between
 * the guard and the driver, not a state this database can observe.
 */
export function buildApprovalSteps(
  pass: GatePassView,
  roles: ApprovalRoleRow[],
  viewerRole: UserRole | null = null,
  approvals: PassApprovalRow[] = []
): ApprovalStep[] {
  const held = byKey(roles);
  const decided = new Map(approvals.map((a) => [a.role_key, a]));
  // The paper fiction is for a pass that carries no ladder of its own. One that
  // does has a real answer for every level it owes, and it wins.
  const signedOnPaper = viewerRole === 'guard' && approvals.length === 0;

  const steps: ApprovalStep[] = [
    {
      key: 'raised',
      label: 'Raised By',
      who: pass.raised_by_name,
      detail: pass.department_name,
      at: pass.created_at,
      // The issuing HOD raised it, which IS their approval — there is nobody
      // for them to wait on (client, 2026-08-19).
      state: 'done',
      note: 'Approved on raising',
    },
  ];

  for (const { key, level } of APPROVAL_LADDER) {
    const row = held.get(key);
    const title = APPROVAL_ROLE_TITLES[key];
    const own = decided.get(key);

    // This pass owes this office a signature, and the database knows how that
    // went. `decided_name` first: the person who pressed it is the fact, and
    // the office may have changed hands since.
    if (own) {
      steps.push({
        key: `level-${own.level_no}`,
        label: `Level ${own.level_no} Approval`,
        // A ROLLOUT-CLOSED LEVEL NAMES NOBODY (058). `decided_name` is null on
        // such a row by design, and the usual fall-back to `routed_name` would
        // print whoever held the office the day the pass was raised — saying
        // they approved a pass they were never shown.
        // A DELEGATE IS NAMED WITH THE PERSON WHO DELEGATED TO THEM, in the
        // bracket (062; client, 2026-08-22). `delegatedLine` degrades to the
        // plain bracket when either name is missing.
        who: own.grandfathered
          ? approverLine(title, null)
          : own.decided_as_delegate
            ? delegatedLine(title, own.decided_name ?? own.routed_name ?? row?.full_name, own.delegated_by_name)
            : approverLine(title, own.decided_name ?? own.routed_name ?? row?.full_name),
        // WHICH SEAT SIGNED IT, where the department would otherwise sit. A
        // deputy's or a delegate's own department is not the fact a reader of
        // this rung wants, and an unlabelled stand-in reads as the office
        // holder — the thing Workday's "On Behalf Of" line exists to prevent.
        //
        // A DELEGATION OUTRANKS A DEPUTY LABEL. The two seats are mutually
        // exclusive by the one-seat rule (049/054/062), so both flags cannot be
        // true of one decision — but if a row ever carried both, the delegation
        // is the more specific fact and the one with a window on it.
        detail: own.grandfathered
          ? null
          : own.decided_as_delegate
            ? `Delegated ${title} — signed for ${own.delegated_by_name ?? 'the office holder'}`
            : own.decided_as_deputy
              ? `Standing deputy for the ${title}`
              : row?.department_name ?? null,
        at: own.decided_at,
        state: APPROVAL_STATE[own.status],
        // A rejection's reason IS the note — it is the sentence somebody typed
        // and the only answer the raising HOD gets.
        note: own.grandfathered
          ? GRANDFATHERED_NOTE
          : own.status === 'rejected' && own.reason
            ? own.reason
            : APPROVAL_NOTE[own.status],
      });
      continue;
    }

    // An office this pass was never routed to, on a pass that has a ladder, is
    // not a gap: it was vacant the day the pass was raised and nothing waits on
    // it. Saying "Not designated yet" there would describe a problem that does
    // not exist.
    if (approvals.length > 0) continue;

    steps.push({
      key: `level-${level}`,
      label: `Level ${level} Approval`,
      who: approverLine(title, row?.full_name),
      detail: row?.department_name ?? null,
      at: null,
      state: row || signedOnPaper ? 'done' : 'unset',
      note: row || signedOnPaper ? 'Signed on the printed pass' : 'Not designated yet',
    });
  }

  steps.push(gateStep(pass));

  const back = returnStep(pass);
  if (back) steps.push(back);

  return steps;
}

/**
 * May this reader still record a return on this pass?
 *
 * Both halves are the DATABASE's rule, restated so a button that would always
 * fail is never drawn: `apply_item_returns` refuses anyone who is not security
 * (`is_security()`), and refuses any pass whose `return_status` is outside
 * awaiting/partially returned. A returned pass therefore has nothing editable
 * left on it at all — which is the client's rule too (2026-08-19: "once it is
 * marked as returned, nothing can be edited anymore").
 */
export function canRecordReturns(pass: GatePassView, role: UserRole | null): boolean {
  if (role !== 'guard') return false;
  return pass.return_status === 'awaiting_return' || pass.return_status === 'partially_returned';
}

/** The pass has been fully returned and is closed. Not the same as "has no
 *  editable action": an NRGP has none either, but it was never awaiting one. */
export function isReturnClosed(pass: GatePassView): boolean {
  return pass.return_status === 'returned';
}
