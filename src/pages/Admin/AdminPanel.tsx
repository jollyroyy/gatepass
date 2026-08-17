// Admin landing page: thin tab shell only. Departments and Users each own
// their data-fetching and mutations — this file just switches between them.
//
// The Whitelist tab is the CEO's queue (039). It carries the CEO-designation
// card above the queue because the two are one setting and one consequence:
// with nobody designated, every request in the list below is unapprovable, and
// splitting them across screens would hide that.
import React, { useState } from 'react';
import DepartmentsTab from './DepartmentsTab';
import UsersTab from './UsersTab';
import BlacklistTab from './BlacklistTab';
import WhitelistRequestsTab from './WhitelistRequestsTab';
import CeoApproverCard from './CeoApproverCard';
import { useMyProfile } from '../../lib/useMyProfile';

type Tab = 'departments' | 'users' | 'blacklist' | 'whitelist';

const TABS: { key: Tab; label: string }[] = [
  { key: 'departments', label: 'Departments' },
  { key: 'users', label: 'Users' },
  { key: 'blacklist', label: 'Blacklist' },
  { key: 'whitelist', label: 'Whitelist Requests' },
];

export default function AdminPanel(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('departments');
  const { profile } = useMyProfile();
  const isSuperAdmin = profile?.role === 'super_admin';

  const rendered: Record<Tab, React.ReactElement> = {
    departments: <DepartmentsTab />,
    users: <UsersTab />,
    blacklist: <BlacklistTab />,
    whitelist: (
      <div className="space-y-6">
        <CeoApproverCard isSuperAdmin={isSuperAdmin} />
        <WhitelistRequestsTab />
      </div>
    ),
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
