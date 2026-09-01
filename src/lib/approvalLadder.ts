// THE APPROVAL LADDER a gate pass record prints down its right-hand side.
//
// It is the printed slip's own chain and nothing else — `printSignatureBoxes.ts`
// draws the very same offices as the tick boxes on the paper:
//
//     Issuing HOD → Security Head → Finance HOD → COO *or* CEO → the gate
//
// so the screen and the paper name the same offices in the same order (client,
// 2026-08-19: "just match the print slip"). Change one and change the other, or
// a guard comparing the slip in their hand to the record on the tablet finds a
// level on one that is missing from the other. The order has moved twice on the
// client's instruction — the CEO from third to last on 2026-08-20 (057), and
// then on 2026-08-22 to the shape below, where Finance signs second and LEVEL 3
// IS ONE RUNG THE COO AND THE CEO SHARE (063). See `APPROVAL_LADDER`.
//
// SINCE MIGRATION 046 IT IS A WORKFLOW — for the passes that carry one. 043
// recorded only WHO holds each office, and this module graded a level on
// whether the seat was filled. 046 added `gatepass.pass_approvals`: one row per
// office a pass actually owes, snapshotted when it is raised, each row carrying
// a real decision, a real author and a real moment.
//
// SO THIS MODULE READS TWO KINDS OF PASS, and the difference is a fact about
// the pass, not a flag:
//   * a pass WITH approval rows is graded from them — approved / waiting /
//     rejected, with the name of whoever pressed it and the time they did. Its
//     ladder is exactly the offices it was routed to; an office that was vacant
//     the day it was raised was never required and is not drawn as missing.
//   * a pass WITHOUT any is graded the old way, from the org chart alone. The
//     oldest 60 passes here predate 046 and read exactly as they did before,
//     which is why the fallback is kept rather than back-filled: nobody signed
//     those levels, and writing "approved" would invent an audit trail.
//
// AN OFFICE NOBODY HOLDS IS NOT APPROVED — EXCEPT IN THE GUARD'S VIEW.
// A vacant office reads "Not designated yet" rather than counting as signed:
// implying an approval nobody gave is the one thing this ladder must not do.
//
// A GUARD IS THE ONE READER FOR WHOM THE OLD KIND IS ALREADY TRUE — and only
// the old kind. A REAL pending row outranks the paper fiction below, always: a
// pass that still owes a signature under 046 is one a guard cannot even see, so
// drawing its levels as signed would contradict the policy that hid it. Client,
// 2026-08-19: "only the approved ones will be appearing in the guard's view."
// A pass only reaches the barrier with the signed A5 slip beside it, so for a
// guard every office reads `done`. For an HOD or an admin — reading from a desk
// with no paper in hand — a vacant office still reads `unset`, because for them
// the fix is a designation, not a truck waiting at the gate.
import type { GatePassView, UserRole } from '../types';
import { gateStep, returnStep, type ApprovalStep } from './passLadderLegs';
import { escalationNote, isHeldForEscalation } from './approvalDecision';
import { raisedStepLabel, raisedStepNote, issuingBoxLabel, raisingOfficeOf } from './raisedByOffice';
import {
  APPROVAL_NOTE,
  APPROVAL_STATE,
  GRANDFATHERED_NOTE,
  type PassApprovalRow,
} from './passApprovalState';
// APPROVAL_ROLE_TITLES and approverLine now LIVE in `ladderRungs.ts` and are
// re-exported below, unchanged. They moved because the rung titles are built
// from them and a module cannot import a value from a module that imports a
// value from it — every existing importer names them through this file and is
// untouched.
import { DEPARTMENT_HOD_RUNG, departmentHodStep, APPROVAL_ROLE_TITLES, approverLine } from './ladderRungs';

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
  /** WHO IS ANSWERING FOR THIS OFFICE TODAY (migration 072). Equal to the
   *  holder on every ordinary day, and the delegate while a delegation is live —
   *  which is the only name a board asking "who is this pass waiting with" may
   *  print, because the holder declared themselves away and the database will
   *  take the press from the delegate. The holder columns above never move: an
   *  admin seating an office reads those.
   *
   *  Optional because a client holding a response from before 072 has neither,
   *  and a missing name must degrade to the holder rather than to a blank. */
  acting_user_id?: string | null;
  acting_name?: string | null;
  delegated?: boolean | null;
}

/** Ladder order, and the order the levels are numbered in. An array rather
 *  than the Record's key order, because level numbers depend on it and object
 *  key order is a language detail, not a promise.
 *
 *  LEVEL 3 IS HELD BY TWO OFFICES (client, 2026-08-22: "Level one approver will
 *  be the security head. Level two approver will be the finance head and level
 *  three approval approver will be either co or CEO"). One signature closes it:
 *  whichever of the two signs, the other's rung is recorded `not_required`, and
 *  the CEO may only sign it once the COO's window has run out (migration 063).
 *
 *  This supersedes 057's Security Head 1 · COO 2 · Finance HOD 3 · CEO 4.
 *  `printSignatureBoxes.ts` and migration 063 carry the same order, and the
 *  three move together: the paper, the screen and `pass_approvals.level_no` are
 *  one order stated in three places, and a guard comparing the slip in their
 *  hand to the record on the tablet must not find a level on one that is
 *  missing from the other. */
export const APPROVAL_LADDER: { key: ApprovalRoleKey; level: number }[] = [
  { key: 'security_head', level: 1 },
  { key: 'finance_head', level: 2 },
  { key: 'coo', level: 3 },
  { key: 'ceo', level: 3 },
];

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
// door: these files exist for the file-size cap, not as boundaries.
export type { PassApprovalRow } from './passApprovalState';
export {
  DEPARTMENT_HOD_RUNG, RUNG_TITLES, isDepartmentHodRung, rungTitle,
  APPROVAL_ROLE_TITLES, approverLine, departmentHodStep,
} from './ladderRungs';
export type { LadderRungKey } from './ladderRungs';
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

  // WHICH OFFICE RAISED IT, IF AN OFFICE DID (069/071) — null is the ordinary
  // case, an HOD raising for their own department, and every line below then
  // reads exactly as it always has. `boxLabel` is the PRINTED heading and must
  // not ride on `office`: that field means an approval rung, and `printCeoBox`
  // filters the CEO's own rung by it.
  const raisedBy = raisingOfficeOf(pass);

  const steps: ApprovalStep[] = [
    {
      key: 'raised',
      label: raisedStepLabel(raisedBy),
      who: pass.raised_by_name,
      // Still the DEPARTMENT: the office is added to this rung, never in place
      // of the department the material is moving for.
      detail: pass.department_name,
      at: pass.created_at,
      // The issuing HOD raised it, which IS their approval — there is nobody
      // for them to wait on (client, 2026-08-19). The COO and the CEO raise on
      // the same terms and still sign their own level-3 rung below (069).
      state: 'done',
      note: raisedStepNote(raisedBy),
      boxLabel: issuingBoxLabel(raisedBy),
    },
  ];

  // LEVEL 0, AND ONLY WHEN THE PASS CARRIES IT (migration 077). A pass raised
  // by somebody the HOD authorised owes that HOD's signature BEFORE the Security
  // Head's, so the rung is drawn directly under "Raised By" and above the four
  // offices — the order the database numbers them in, and the order the paper
  // has to carry. It is built next door because it belongs to no office and so
  // is not part of `APPROVAL_LADDER`; see `ladderRungs.ts`.
  const hodRung = departmentHodStep(decided.get(DEPARTMENT_HOD_RUNG), pass.department_name);
  if (hodRung) steps.push(hodRung);

  for (const { key, level } of APPROVAL_LADDER) {
    const row = held.get(key);
    const title = APPROVAL_ROLE_TITLES[key];
    const own = decided.get(key);

    // This pass owes this office a signature, and the database knows how that
    // went. `decided_name` first: the person who pressed it is the fact, and
    // the office may have changed hands since.
    if (own) {
      steps.push({
        key: `level-${key}`,
        office: key,
        label: `Level ${own.level_no} Approval`,
        // A ROLLOUT-CLOSED LEVEL NAMES NOBODY (058). `decided_name` is null on
        // such a row by design, and the usual fall-back to `routed_name` would
        // print whoever held the office the day the pass was raised — saying
        // they approved a pass they were never shown.
        // A DELEGATE IS NAMED WITH THE PERSON WHO DELEGATED TO THEM, in the
        // bracket (062; client, 2026-08-22). `delegatedLine` degrades to the
        // plain bracket when either name is missing.
        // A RUNG NOBODY HAD TO SIGN NAMES NOBODY EITHER. `not_required` means
        // the other office on this level signed it; falling back to
        // `routed_name` would print a person beside a signature that was never
        // given, which is the same mistake `grandfathered` exists to prevent.
        who: own.grandfathered || own.status === 'not_required'
          ? approverLine(title, null)
          : own.decided_as_delegate
            ? delegatedLine(title, own.decided_name ?? own.routed_name ?? row?.full_name, own.delegated_by_name)
            : approverLine(title, own.decided_name ?? own.routed_name ?? row?.full_name),
        // WHO SIGNED IT IN WHAT CAPACITY, where the department would otherwise
        // sit. A delegate's own department is not the fact a reader of this rung
        // wants, and an unlabelled stand-in reads as the office holder — the
        // thing Workday's "On Behalf Of" line exists to prevent.
        detail: own.grandfathered || own.status === 'not_required'
          ? null
          : own.decided_as_delegate
            ? `Delegated ${title} — signed for ${own.delegated_by_name ?? 'the office holder'}`
            : row?.department_name ?? null,
        at: own.decided_at,
        state: APPROVAL_STATE[own.status],
        // A rejection's reason IS the note — it is the sentence somebody typed
        // and the only answer the raising HOD gets.
        // A REJECTION'S AND A SKIPPED RUNG'S REASON IS ITS NOTE. One is the
        // sentence somebody typed and the only answer the raising HOD gets; the
        // other is the database's own sentence naming the office that signed
        // instead. Both say more than the one-word fall-back.
        note: own.grandfathered
          ? GRANDFATHERED_NOTE
          : (own.status === 'rejected' || own.status === 'not_required') && own.reason
            ? own.reason
            // A RUNG THIS OFFICE CANNOT YET SIGN SAYS SO, AND SAYS WHEN. "Waiting
            // for this approval" against the CEO on a pass that is genuinely with
            // the COO names the wrong desk (063).
            : isHeldForEscalation(own) && own.escalates_at
              ? escalationNote(own.escalates_at)
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
      key: `level-${key}`,
      office: key,
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

// The two return questions live in `passLadderLegs.ts` with the return leg of
// the ladder itself, and are re-exported here because every caller names them
// through this module. They moved for the 300-line cap — see that file.
export { canRecordReturns, isReturnClosed } from './passLadderLegs';
