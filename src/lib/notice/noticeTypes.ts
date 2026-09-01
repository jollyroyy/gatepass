// WHAT AN EMAIL ABOUT A GATE PASS IS MADE OF. Types and the one lookup map,
// no logic.
//
// ═══ EVERY MODULE IN THIS FOLDER IMPORTS WITH A `.ts` SUFFIX ═══
//
// These files are loaded by two runtimes:
//
//   * the app, through Vite and Vitest;
//   * `supabase/functions/notify-approval/index.ts`, which is DENO, where a
//     local import must carry its `.ts` extension or it does not resolve.
//
// Deno's form is the strict one, so it is the form used everywhere; the app's
// side is unlocked by `allowImportingTsExtensions` in `tsconfig.app.json`.
// `tests/unit/approvalNotice.test.ts` FAILS on a relative import in this folder
// that omits the suffix, and on any import of a package (Deno would have to
// resolve it from a registry these files must never depend on).
//
// This replaced a harder rule — "`approvalNotice.ts` may import NOTHING" —
// which worked but pinned every letter this system sends into one 567-line
// module, against the repo's 300-line cap.

/** EVERY RUNG A PASS'S LADDER CAN CARRY — which is not the same as every
 *  OFFICE. The four offices between the requester and the gate, plus
 *  `department_hod` (migration 077): the rung a pass gets when somebody the HOD
 *  authorised raised it for them, at `level_no = 0`, routed to that HOD.
 *
 *  A RUNG KEY IS NOT AN OFFICE KEY. `ApprovalRoleKey` in `ladderRungs.ts` is
 *  the four SEATS — what `approval_roles`, the Delegation tab and the admin's
 *  ladder card speak in — and `LadderRungKey` is what a `pass_approvals` row
 *  can be. This mirrors the WIDER one, because a letter is written about a
 *  pass's rungs and not about the seating plan.
 *
 *  Restated rather than imported: `ladderRungs.ts` reaches the app's types and
 *  its Supabase client, neither of which Deno can load. `approvalNotice.test.ts`
 *  asserts this map still equals `RUNG_TITLES`. */
export type NoticeRoleKey =
  | 'department_hod'
  | 'security_head'
  | 'coo'
  | 'ceo'
  | 'finance_head';

/** Rung titles, as the printed slip spells them. Must equal `RUNG_TITLES` in
 *  `ladderRungs.ts`; the test asserts it. Without the first entry `titleOf`
 *  falls back to the raw key and a raise notice reads "now with the
 *  department_hod" at a human being. */
export const NOTICE_ROLE_TITLES: Record<NoticeRoleKey, string> = {
  department_hod: 'Department HOD',
  security_head: 'Security Head',
  coo: 'COO',
  ceo: 'CEO',
  finance_head: 'Finance HOD',
};

/** The pass, as much of it as an email needs. A subset of `GatePassView`, named
 *  separately because this module cannot import that type. */
export interface NoticePass {
  id: string;
  pass_number: string;
  type: string;
  status: string;
  visitor_name: string | null;
  purpose: string | null;
  department_name: string | null;
  raised_by_name: string | null;
  /** The raising HOD's address. Nullable and optional: `approval_notice_payload`
   *  LEFT JOINs it out of VMS's `public.profiles`, and a missing address must
   *  drop one message rather than the send.
   *
   *  ⚠ SINCE 2026-09-01 THIS IS LOAD-BEARING ON EVERY LETTER, not just the
   *  `fully_approved` receipt: the raiser is copied on the whole life of their
   *  own pass (client, 2026-09-01). A pass whose raiser has no address on file
   *  still notifies its approvers — see `ccOf`. */
  raised_by_email?: string | null;
  item_count: number;
  total_value: number | null;
  expected_return_date: string | null;
  created_at: string;
  /** THE GATE'S OWN WORDS, for the two letters that report it (2026-09-01).
   *  `flag_reason` is the written justification migration 035 demands and 070
   *  makes final; the pass is closed and a new one must be raised. Null on
   *  every pass the gate has not decided. */
  flag_reason?: string | null;
  /** Who at the gate matched or flagged it, and when. Both nullable for the
   *  same LEFT JOIN reason as `raised_by_email`. */
  verified_by_name?: string | null;
  verified_at?: string | null;
}

/** One row of `gatepass.pass_approvals`, with the holder's name and address
 *  joined on. `approver_email` is nullable because the join reaches VMS's
 *  `public.profiles`: a missing address must drop one message, never the send. */
export interface NoticeApproval {
  role_key: NoticeRoleKey;
  level_no: number;
  status: 'pending' | 'approved' | 'rejected' | 'not_required';
  approver_id: string;
  approver_name: string | null;
  approver_email: string | null;
  decided_at: string | null;
  reason: string | null;
}

/**
 * WHICH LETTER THIS IS. A union rather than a bare string so that adding a kind
 * stays a typed change and `email_log.kind` keeps meaning something.
 *
 * `raised`           — the receipt for the HOD who just raised it (2026-09-01).
 * `awaiting_you`     — it is this office's turn, and the mail asks for a decision.
 * `fully_approved`   — the LAST rung is signed; the pass now waits at the gate.
 * `rejected`         — an approval office refused it, and it is closed (2026-09-01).
 * `gate_cleared`     — the guard matched the material and let it out (2026-09-01).
 * `gate_flagged`     — the guard stopped it at the barrier. Terminal, per 070.
 * `emergency_release`— a fallback office released it past the ladder (055).
 */
export type NoticeKind =
  | 'raised'
  | 'awaiting_you'
  | 'fully_approved'
  | 'rejected'
  | 'gate_cleared'
  | 'gate_flagged'
  | 'emergency_release';

/** One copied-in reader. Visible (`cc`, never `bcc`) on purpose: a gate pass is
 *  an internal control document, and an approver who cannot see that the raiser
 *  was told as well has to go and ask. */
export interface Recipient {
  email: string;
  name: string | null;
}

export interface NoticeMessage {
  to: string;
  toName: string | null;
  /** Everybody else told about this event. Always deduplicated against `to`
   *  and against itself by `ccOf` — two copies of one letter in one inbox read
   *  as a bug rather than as thoroughness. */
  cc?: Recipient[];
  kind: NoticeKind;
  subject: string;
  text: string;
  html: string;
}

/** A call to action in a letter. `primary` is the solid button, `secondary` the
 *  outlined one, `plain` a link that gets no button at all — every one of them
 *  is also printed as a bare URL underneath.
 *
 *  COLOUR CARRIES NOTHING HERE, the same rule the printed slip follows: Approve
 *  and Reject are told apart by their WORDS, so the letter still works in a
 *  client that renders no styles at all. */
export interface Cta {
  href: string;
  label: string;
  kind: 'primary' | 'secondary' | 'plain';
}
