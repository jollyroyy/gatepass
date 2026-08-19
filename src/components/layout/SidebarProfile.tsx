import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { fetchMyProfile } from '../../lib/profiles';
import type { UserRole } from '../../types';

/** Direct lookup — never derive a role label from string matching. */
export const ROLE_LABELS: Record<UserRole, string> = {
  guard: 'Security',
  hod: 'HOD',
  admin: 'Admin',
  super_admin: 'Admin',
  staff: 'Staff',
};

const SIGNOUT_ICON = 'M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9';

type Props = {
  role: UserRole | null;
  isCollapsed: boolean;
  profileName: string;
  initials: string;
};

// Clicking this block opens /profile — the photo upload, display-name edit and
// remove all live on that page (src/pages/Shared/Profile.tsx). Re-read the
// avatar on navigation so returning from /profile shows the new photo without
// a reload.
export default function SidebarProfile({ role, isCollapsed, profileName, initials }: Props): React.ReactElement {
  const loc = useLocation();
  const onProfile = loc.pathname.startsWith('/profile');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchMyProfile().then((p) => {
      if (!cancelled) setAvatarUrl(p?.avatar_url ?? null);
    });
    return () => { cancelled = true; };
  }, [loc.pathname]);

  const avatar = (
    avatarUrl ? (
      <img src={avatarUrl} alt={profileName || 'Your profile'}
        className={`${isCollapsed ? 'h-10 w-10' : 'h-11 w-11'} rounded-full object-cover ring-2 ring-brand-500/40 shrink-0`} />
    ) : (
      <div className={`${isCollapsed ? 'h-10 w-10' : 'h-11 w-11'} avatar-brand rounded-full flex items-center justify-center text-xs font-semibold shrink-0`}>
        {initials}
      </div>
    )
  );

  const signOutButton = (
    <button
      type="button"
      onClick={() => { void supabase.auth.signOut(); }}
      title="Sign out"
      className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-flagged-500 hover:bg-white/[0.06] transition-all duration-200"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d={SIGNOUT_ICON} />
      </svg>
    </button>
  );

  return (
    <div className={`rounded-2xl border transition-colors ${onProfile
      ? 'border-brand-500/40 bg-brand-500/10'
      : 'border-white/[0.06] bg-white/[0.03]'} ${isCollapsed ? 'flex flex-col items-center p-2 gap-2' : 'p-3'}`}>
      {isCollapsed ? (
        <>
          <Link to="/profile" title="My profile" aria-label="My profile" aria-current={onProfile ? 'page' : undefined} className="group shrink-0">
            {avatar}
          </Link>
          {signOutButton}
        </>
      ) : (
        <div className="flex items-center gap-3">
          <Link to="/profile" aria-current={onProfile ? 'page' : undefined}
            className="group flex items-center gap-3 min-w-0 flex-1 rounded-xl -m-1 p-1 hover:bg-white/[0.06] transition-colors">
            {avatar}
            <div className="min-w-0 flex-1 text-left">
              <p className="text-sm font-bold text-white truncate leading-tight">{profileName || '—'}</p>
              {role && <p className="text-[11px] font-semibold text-brand-400 leading-tight mt-0.5">{ROLE_LABELS[role]}</p>}
            </div>
          </Link>
          {signOutButton}
        </div>
      )}
    </div>
  );
}
