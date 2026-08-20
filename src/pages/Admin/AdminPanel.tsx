// Admin landing page: thin tab shell only. Departments and Users each own
// their data-fetching and mutations — this file just switches between them.
//
// The Whitelist tab is the CEO's queue (039). It carries NO CEO-designation
// card: since 053 `is_ceo()` is true for the holder of the CEO office on the
// approval ladder, so the person who decides these requests is designated once,
// on the Users tab, beside the three offices they sign gate passes with. The
// second designation it used to carry (`gatepass.ceo_approver`, 039 — super
// admin only, and namable only on an ADMIN account, which no ladder CEO is)
// could therefore only ever warn that nobody held an office somebody did hold.
//
// The Users tab carries the gate pass approval ladder (043) for the same
// reason: it is four people picked out of the very directory listed under it.
//
// Settings (052) is where anything an operator configures goes. It holds the
// approval-email card today: which inbox the ladder's letters are redirected
// to, the sender, and the SMTP server fields that are stored provision only.
import React, { useState } from 'react';
import DepartmentsTab from './DepartmentsTab';
import UsersTab from './UsersTab';
import FunctionalRolesTab from './FunctionalRolesTab';
import BlacklistTab from './BlacklistTab';
import WhitelistRequestsTab from './WhitelistRequestsTab';
import ApprovalLadderCard from './ApprovalLadderCard';
import EmergencyReleasesCard from './EmergencyReleasesCard';
import MailSettingsCard from './MailSettingsCard';
import AppSettingsCard from './AppSettingsCard';

type Tab = 'departments' | 'users' | 'roles' | 'blacklist' | 'whitelist' | 'settings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'departments', label: 'Departments' },
  { key: 'users', label: 'Users' },
  // Beside Users and Departments, on the client's own instruction (2026-08-20).
  { key: 'roles', label: 'Functional Roles' },
  { key: 'blacklist', label: 'Blacklist' },
  { key: 'whitelist', label: 'Whitelist of Vendors' },
  { key: 'settings', label: 'Settings' },
];

export default function AdminPanel(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('departments');
  const rendered: Record<Tab, React.ReactElement> = {
    departments: <DepartmentsTab />,
    users: (
      <div className="space-y-6">
        <ApprovalLadderCard />
        {/* Sits beside the ladder because it is the same subject: who may sign,
            and what happened when nobody could. Renders NOTHING at all when no
            pass has ever been released under emergency (055). */}
        <EmergencyReleasesCard />
        <UsersTab />
      </div>
    ),
    roles: <FunctionalRolesTab />,
    blacklist: <BlacklistTab />,
    settings: (
      <div className="space-y-6">
        <AppSettingsCard />
        <MailSettingsCard />
      </div>
    ),
    whitelist: <WhitelistRequestsTab />,
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Admin</h1>
        <p className="page-subtitle">Manage departments, HOD coverage, and view accounts.</p>
      </div>

      <div className="tab-group w-fit mb-6">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'tab-active' : 'tab-inactive'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {rendered[tab]}
    </div>
  );
}
