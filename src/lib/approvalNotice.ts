// WHO GETS AN EMAIL WHEN A GATE PASS MOVES, and what it says — the one import
// path for all of it. Everything below lives in `src/lib/notice/`; this file is
// the door, so that a caller (the app, the Edge Function, the tests) names one
// module and not eight.
//
// ═══ WHY IT WAS SPLIT (2026-09-01) ═══
//
// It was 567 lines, against this repo's 300-line cap, and the reason it had
// grown that way was a hard rule in its own header: THIS FILE MAY IMPORT
// NOTHING. That rule existed because the file is loaded by two runtimes —
// Vite/Vitest here, and Deno in `supabase/functions/notify-approval` — and Deno
// resolves a local import only WITH a `.ts` suffix while the app's tooling, as
// configured then, accepted only one without.
//
// `allowImportingTsExtensions` in `tsconfig.app.json` removes that conflict:
// every module in `src/lib/notice/` imports with the `.ts` suffix, which BOTH
// runtimes now resolve. The rule that replaced "import nothing" is narrower and
// is still enforced by `tests/unit/approvalNotice.test.ts` — a relative import
// in that folder must carry its `.ts` suffix, and nothing there may import a
// package, because Deno would have to fetch it from a registry these files must
// never depend on.
//
// The formatters are still written out rather than imported from
// `formatCurrency.ts` and `formatDate.ts`, for the same reason as before: those
// modules reach the app's types and its Supabase client, which Deno cannot
// load. The test still asserts the duplicated money format matches.

export {
  NOTICE_ROLE_TITLES,
  type Cta,
  type NoticeApproval,
  type NoticeKind,
  type NoticeMessage,
  type NoticePass,
  type NoticeRoleKey,
  type Recipient,
} from './notice/noticeTypes.ts';

export {
  decisionLinks,
  escapeHtml,
  joinUrl,
  noticeCurrency,
  noticeDate,
  passFacts,
  recordLink,
  titleOf,
  wrapHtml,
  wrapText,
} from './notice/noticeFormat.ts';

export {
  ccOf,
  currentApproval,
  holderLabel,
  officeRecipients,
  raiserRecipient,
  rejectedApproval,
  signedSoFar,
} from './notice/noticeLadder.ts';

export {
  awaitingNotices,
  buildApprovalNotices,
  fullyApprovedNotices,
} from './notice/noticeApproval.ts';

export { raisedNotices, rejectedNotices } from './notice/noticeLifecycle.ts';
export { gateClearedNotices, gateFlaggedNotices } from './notice/noticeGate.ts';
export { buildEmergencyNotices } from './notice/noticeEmergency.ts';

/** THE ONE ENTRY POINT THE EDGE FUNCTION CALLS. Every letter this pass's
 *  current state calls for, derived from the pass and its approval rows and
 *  never from anything the caller said. See `notice/noticeDispatch.ts`. */
export { buildNotices } from './notice/noticeDispatch.ts';
