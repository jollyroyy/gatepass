// The one button a guard presses on a waiting pass: **Approve OUT**.
//
// It was "Verify at Gate" until the client asked for the mock-up's own word
// (2026-08-19). Every caller gates it on `canVerifyAtGate`, the same rule
// `match_pass` enforces server-side, so a button that would always fail is
// never drawn.
//
// IT OPENS THE PASS RECORD, NOT THE VERIFY SCREEN (client, 2026-08-19: pressing
// Approve or Verify Return from a guard list "would come up like this", the
// full Gate Pass Details record). The record carries its own Approve OUT
// button through to `/verify/:id`, which is still where Match, Flag and Hold
// are offered — so nothing is unreachable, and a guard reads the whole pass,
// its approval ladder and its material lines before deciding.
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
    <Link to={`/pass/${id}`} className="gb-action gb-action-orange">
      {ArrowGlyph}
      Approve OUT
    </Link>
  );
}
