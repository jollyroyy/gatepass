import React from 'react';
import { supabase } from '../../supabaseClient';
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

export default function SidebarProfile({ role, isCollapsed, profileName, initials }: Props): React.ReactElement {
  const avatar = (
    <div className={`${isCollapsed ? 'h-10 w-10' : 'h-11 w-11'} avatar-brand rounded-full flex items-center justify-center text-xs font-semibold shrink-0`}>
      {initials}
    </div>
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
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.03] ${isCollapsed ? 'flex flex-col items-center p-2 gap-2' : 'p-3'}`}>
      {isCollapsed ? (
        <>
          {avatar}
          {signOutButton}
        </>
      ) : (
        <div className="flex items-center gap-3">
          {avatar}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white truncate leading-tight">{profileName || '—'}</p>
            {role && <p className="text-[11px] font-semibold text-slate-300 leading-tight mt-0.5">{ROLE_LABELS[role]}</p>}
          </div>
          {signOutButton}
        </div>
      )}
    </div>
  );
}
