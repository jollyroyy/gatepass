// Standalone page for a signed-in user whose role has no business in this
// app (`staff`). No sidebar/layout assumptions — this can render before any
// shell mounts.
import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { QuestLockup } from '../components/QuestMark';

export default function NoAccess(): React.ReactElement {
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
        <h1 className="page-title !mb-0">No Gate Pass Access</h1>
        <p className="text-sm text-navy-500">
          {email ? (
            <>
              Your account (<span className="font-semibold text-navy-700">{email}</span>) does not have access to
              the Quest Gate Pass system.
            </>
          ) : (
            'Your account does not have access to the Quest Gate Pass system.'
          )}
        </p>
        <p className="text-sm text-navy-500">
          An administrator can grant your account access if you believe this is a mistake.
        </p>
        <button type="button" className="btn-secondary w-full" onClick={handleSignOut} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign Out'}
        </button>
      </div>
    </div>
  );
}
