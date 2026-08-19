// LOG OUT — the bottom left of the sidebar, and the only place it appears
// (client, 2026-08-19: "put only log out at the bottom left").
//
// THIS FILE REPLACES SidebarProfile. That block carried the avatar, the name,
// the role and a small sign-out icon all in one; the identity half moved to the
// top-right chip (TopBarProfile) and what is left here is the one control the
// client asked to stay. Keeping a second avatar down here would mean two places
// to press for the same page, and one of them sitting next to the button that
// ends the session.
//
// IT IS SPELLED OUT, NOT AN ICON, and it is the only red-tending control in the
// nav. Signing out mid-shift at a barrier is a real cost — a glyph a guard has
// to recognise is the wrong affordance for it.
import React from 'react';
import { supabase } from '../../supabaseClient';

const SIGNOUT_ICON = 'M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9';

type Props = { isCollapsed: boolean };

export default function SidebarSignOut({ isCollapsed }: Props): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => { void supabase.auth.signOut(); }}
      title="Log out"
      aria-label="Log out"
      className={`sidebar-link w-full px-3 py-2.5 text-slate-300 hover:text-flagged-400 ${
        isCollapsed ? 'justify-center !px-0' : ''
      }`}
    >
      <span className="shrink-0">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d={SIGNOUT_ICON} />
        </svg>
      </span>
      {!isCollapsed && <span>Log out</span>}
    </button>
  );
}
