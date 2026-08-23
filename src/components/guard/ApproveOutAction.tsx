// The one button a guard presses on a waiting pass: **Approve OUT**.
//
// It was "Verify at Gate" until the client asked for the mock-up's own word
// (2026-08-19). Every caller gates it on `canVerifyAtGate`, the same rule
// `match_pass` enforces server-side, so a button that would always fail is
// never drawn.
//
// IT OPENS THE DECISION, NOT THE RECORD ABOVE IT (client, 2026-08-23: pressing
// Approve in the guard's queue "should directly take him to the green-coloured
// Approve or Reject button"). It opened `/pass/:id` between 2026-08-19 and
// today, and that record carried its own Approve OUT on to `/verify/:id` — two
// presses to reach the one screen the guard came for, with a vehicle waiting at
// the barrier. `/verify/:id` draws the whole pass and its material lines above
// the two buttons, so nothing that was read on the way is lost.
//
// It lives in its own file because three surfaces render it — the Pending OUT
// page, the mobile-number search results, and any future queue — and a label
// the client chose must have exactly one spelling in the codebase.
import React from 'react';
import { Link } from 'react-router-dom';

const ArrowGlyph = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 12h15M14 7l5 5-5 5" />
  </svg>
);

export default function ApproveOutAction({ id }: { id: string }): React.ReactElement {
  return (
    <Link to={`/verify/${id}`} className="gb-action gb-action-orange">
      {ArrowGlyph}
      Approve OUT
    </Link>
  );
}
