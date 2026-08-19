// WHO IS SIGNED IN — the identity chip at the top right of every screen
// (client, 2026-08-19: "put all the users' profile picture on the top right
// corner ... show the profile picture and edit option, all those on the top
// right corner", for the guard, the admin and the HOD alike).
//
// IT DOES NOT SIGN ANYBODY OUT. Log out stayed at the bottom left of the
// sidebar, by the same instruction — "put only log out at the bottom left" —
// so the corner a reader taps to check who they are is not the corner that
// ends their shift. One destructive control, one place, and it is not the one
// beside the notifications.
//
// COMPACT BY DEFAULT. The name and role show from `xl` up and the avatar alone
// below it, because this bar is fixed over the page's own top-right corner —
// where the guard pages already put their date stamp and the house pages put
// their action buttons. The two page-head rules in index.css reserve the room
// this needs at each of those widths (60px was the bell alone); a chip that was
// 220px wide at every width would sit on top of a tablet's page title.
//
// THE AVATAR IS RE-READ ON NAVIGATION, the same rule the sidebar's chip
// followed: coming back from /profile with a new photo must show the new photo
// without a reload.
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import { fetchDisplayName, fetchMyProfile } from '../../lib/profiles';
import { ROLE_LABELS } from '../../lib/roleLabels';
import { useEscapeKey } from '../../lib/useEscapeKey';

type Props = {
  session: Session;
  role: UserRole | null;
};

function initialsOf(name: string, email: string): string {
  if (name) {
    return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }
  return (email.split('@')[0] ?? 'U').slice(0, 2).toUpperCase();
}

export default function TopBarProfile({ session, role }: Props): React.ReactElement {
  const loc = useLocation();
  const email = session.user.email ?? 'User';
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Best effort, and it degrades to a name derived from the email: this chip
  // must never be the reason a screen fails to render. Goes through
  // `gatepass.my_profile()`, never `public.profiles`, whose policies are VMS's
  // and have recursed (see src/lib/profiles.ts).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = await fetchDisplayName(email);
      if (!cancelled) setName(resolved);
    })();
    return () => { cancelled = true; };
  }, [session.user.id, email]);

  useEffect(() => {
    let cancelled = false;
    void fetchMyProfile()
      .then((p) => { if (!cancelled) setAvatarUrl(p?.avatar_url ?? null); })
      .catch(() => { /* no photo is a normal answer — the initials stand in */ });
    return () => { cancelled = true; };
  }, [loc.pathname]);

  useEscapeKey(() => setOpen(false), open);
  useEffect(() => { setOpen(false); }, [loc.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent): void {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const avatar = avatarUrl ? (
    <img
      src={avatarUrl}
      alt=""
      className="h-9 w-9 rounded-full object-cover ring-2 ring-brand-500/40 shrink-0"
    />
  ) : (
    <span className="h-9 w-9 avatar-brand rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0">
      {initialsOf(name, email)}
    </span>
  );

  return (
    <div ref={wrap} className="relative no-print">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Your account — ${name || email}`}
        className="flex items-center gap-2 h-9 pl-0 pr-1 xl:pr-2 rounded-xl bg-surface-50 shadow-md border border-surface-200 hover:bg-surface-100 transition-colors"
      >
        {avatar}
        <span className="hidden xl:block min-w-0 max-w-[140px] text-left">
          <span className="block text-xs font-semibold text-navy-900 truncate leading-tight">
            {name || email}
          </span>
          {role && (
            <span className="block text-[10px] font-medium text-navy-500 truncate leading-tight">
              {ROLE_LABELS[role]}
            </span>
          )}
        </span>
        <svg
          className={`w-3.5 h-3.5 shrink-0 text-navy-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full right-0 mt-2 w-60 rounded-xl bg-surface-50 shadow-xl border border-surface-200 overflow-hidden"
        >
          {/* The name in full, because the chip above truncates it and on a
              tablet does not show it at all. */}
          <div className="px-4 py-3 border-b border-surface-200">
            <p className="text-sm font-semibold text-navy-900 truncate">{name || email}</p>
            <p className="text-[11px] text-navy-500 truncate">{email}</p>
          </div>

          {/* Both land on /profile — the photo upload, the display-name edit
              and the remove all live there already (src/pages/Shared/Profile).
              Two rows rather than one because "where is my photo changed" and
              "what am I signed in as" are two questions, and a single row
              labelled either way answers only one of them. */}
          <Link
            role="menuitem"
            to="/profile"
            className="block px-4 py-2.5 text-sm font-medium text-navy-800 hover:bg-surface-100 transition-colors"
          >
            My profile
          </Link>
          <Link
            role="menuitem"
            to="/profile"
            className="block px-4 py-2.5 text-sm font-medium text-navy-800 hover:bg-surface-100 transition-colors"
          >
            Edit profile &amp; photo
          </Link>

          {/* NO SIGN OUT HERE — it is the bottom left of the sidebar, and only
              there (client, 2026-08-19). */}
        </div>
      )}
    </div>
  );
}
