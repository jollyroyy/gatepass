// Standalone page for a signed-in user who cannot use this app. Two distinct
// reasons reach it, and they need different sentences: their role has no
// business here (VMS `staff`), or an admin suspended their account (migration
// 040) — in which case the account is fine and someone chose to stop it, so
// "an administrator can grant access" would be the wrong thing to read.
//
// No sidebar/layout assumptions — this can render before any shell mounts.
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { QuestLockup } from '../components/QuestMark';

export default function NoAccess({ deactivated = false }: { deactivated?: boolean }): React.ReactElement {
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    setSigningOut(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 p-6">
      <div className="card p-8 max-w-md w-full text-center flex flex-col items-center gap-4">
        <QuestLockup tone="light" size="md" subtitle="Gate Pass" className="justify-center mb-6" />
        <div className="h-12 w-12 rounded-full bg-flagged-50 text-flagged-700 flex items-center justify-center text-2xl font-bold">
          !
        </div>
        <h1 className="page-title !mb-0">
          {deactivated ? 'Account Deactivated' : 'No Gate Pass Access'}
        </h1>
        <p className="text-sm text-navy-500">
          {email ? (
            <>
              Your account (<span className="font-semibold text-navy-700">{email}</span>){' '}
              {deactivated
                ? 'has been deactivated by an administrator.'
                : 'does not have access to the Quest Gate Pass system.'}
            </>
          ) : deactivated ? (
            'Your account has been deactivated by an administrator.'
          ) : (
            'Your account does not have access to the Quest Gate Pass system.'
          )}
        </p>
        <p className="text-sm text-navy-500">
          {deactivated
            ? 'Your role and department are unchanged — an administrator can reactivate the account.'
            : 'An administrator can grant your account access if you believe this is a mistake.'}
        </p>
        <button type="button" className="btn-secondary w-full" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
      </div>
    </div>
  );
}
