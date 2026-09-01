// The one screen every role can reach: your own account. Opened from the
// profile button at the bottom of the sidebar. Photo upload/replace/remove and
// display-name editing live here — the photo is written to the shared avatars
// bucket (see src/lib/avatarUpload.ts), so it also shows in VMS.
//
// Reachable by all four roles, so it is listed LAST in every ROLE_ROUTES entry:
// the first entry of each list is that role's landing page (see roleRoutes.ts).
import React, { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import type { ApprovalRoleKey } from '../../lib/approvalLadder';
import { gp, pub } from '../../supabaseClient';
import { useMyProfile } from '../../lib/useMyProfile';
import ProfilePhotoCard from './ProfilePhotoCard';
import SignatureCard from './SignatureCard';
import ProfileDetails from './ProfileDetails';

type Props = {
  session: Session;
  role: UserRole | null;
  /** The approval office this account holds (046), or null. An office holder's
   *  VMS role can read `staff` (`officeReplacesRole`), which is true but not
   *  what the profile should show — the office title takes precedence. */
  office?: ApprovalRoleKey | null;
};

export default function ProfilePage({ session, role, office = null }: Props): React.ReactElement {
  const userId = session.user.id;
  const { profile, loading, error, saveName, setAvatarUrl } = useMyProfile();
  const [deptNames, setDeptNames] = useState<string[]>([]);
  const [announce, setAnnounce] = useState('');

  // An HOD can cover several departments (gatepass.hod_departments); VMS's
  // single profiles.department_id cannot express that, so resolve them here.
  const loadDepartments = useCallback(async () => {
    try {
      const [deptRes, assignRes] = await Promise.all([
        pub().from('departments').select('id, name'),
        gp().from('hod_departments').select('department_id').eq('hod_id', userId),
      ]);
      if (deptRes.error || assignRes.error) return;
      const names = new Map(((deptRes.data ?? []) as { id: string; name: string }[]).map((d) => [d.id, d.name]));
      const ids = ((assignRes.data ?? []) as { department_id: string }[]).map((a) => a.department_id);
      setDeptNames(ids.map((id) => names.get(id)).filter((n): n is string => !!n));
    } catch {
      // Best effort — the page works without the department line.
    }
  }, [userId]);

  useEffect(() => {
    if (role === 'hod') void loadDepartments();
  }, [role, loadDepartments]);

  useEffect(() => { if (announce) { const t = setTimeout(() => setAnnounce(''), 4000); return () => clearTimeout(t); } }, [announce]);

  const effectiveRole = role ?? profile?.role ?? null;
  const email = session.user.email ?? profile?.email ?? '';

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      <div>
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">Your photo and account details</p>
      </div>

      {loading ? (
        <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr]">
          <div className="card p-6"><div className="skeleton h-28 w-28 rounded-full mx-auto" /></div>
          <div className="card p-6 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 w-full rounded-xl" />)}</div>
        </div>
      ) : error || !profile ? (
        <div className="card p-8 text-center">
          <p className="text-sm font-semibold text-flagged-600">
            {error ?? 'We could not load your profile. Please refresh and try again.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-[minmax(0,18rem)_1fr] items-start">
          <div className="flex flex-col gap-6">
            <ProfilePhotoCard
              userId={userId}
              fullName={profile.full_name ?? ''}
              email={email}
              avatarUrl={profile.avatar_url ?? null}
              onAvatarChange={(url) => { setAvatarUrl(url); setAnnounce(url ? 'Photo updated' : 'Photo removed'); }}
            />
            <SignatureCard
              userId={userId}
              onChange={(url) => setAnnounce(url ? 'Signature updated' : 'Signature removed')}
            />
          </div>
          <ProfileDetails
            fullName={profile.full_name ?? ''}
            email={email}
            role={effectiveRole}
            office={office}
            deptNames={deptNames}
            createdAt={profile.created_at}
            onSaveName={saveName}
          />
        </div>
      )}

      <p aria-live="polite" className="sr-only">{announce}</p>
    </div>
  );
}
