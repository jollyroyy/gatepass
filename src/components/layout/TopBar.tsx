// The fixed top-right cluster: notifications, then who is signed in.
//
// IT EXISTS SO THE TWO CANNOT OVERLAP. The bell used to position ITSELF at
// `fixed top-4 right-4`; putting a second fixed control at the same corner
// would have stacked one on the other. The positioning moved here, once, and
// the bell became an ordinary block that sits in this row — which is also why
// `.gb-page-head`'s right pad has one thing to clear rather than two.
//
// ORDER IS BELL THEN PROFILE, matching the client's mock-up and every other
// console the guards use: the thing that changes is on the left, the thing that
// identifies you is at the edge.
import React from 'react';
import type { Session } from '@supabase/supabase-js';
import type { UserRole } from '../../types';
import NotificationBell from './NotificationBell';
import TopBarProfile from './TopBarProfile';

type Props = {
  session: Session;
  role: UserRole | null;
};

export default function TopBar({ session, role }: Props): React.ReactElement {
  return (
    <div className="no-print fixed top-4 right-4 z-50 flex items-center gap-2">
      <NotificationBell />
      <TopBarProfile session={session} role={role} />
    </div>
  );
}
