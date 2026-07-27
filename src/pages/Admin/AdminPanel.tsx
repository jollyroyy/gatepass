// Admin landing page: thin tab shell only. Departments and Users each own
// their data-fetching and mutations — this file just switches between them.
import React, { useState } from 'react';
import DepartmentsTab from './DepartmentsTab';
import UsersTab from './UsersTab';
import AIAnalyticsTab from './AIAnalyticsTab';
import BlacklistTab from './BlacklistTab';

type Tab = 'departments' | 'users' | 'analytics' | 'blacklist';

const TABS: { key: Tab; label: string }[] = [
  { key: 'departments', label: 'Departments' },
  { key: 'users', label: 'Users' },
  { key: 'analytics', label: 'AI Analytics' },
  { key: 'blacklist', label: 'Blacklist' },
];

const TAB_RENDER: Record<Tab, React.ReactElement> = {
  departments: <DepartmentsTab />,
  users: <UsersTab />,
  analytics: <AIAnalyticsTab />,
  blacklist: <BlacklistTab />,
};

export default function AdminPanel(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('departments');

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

      {TAB_RENDER[tab]}
    </div>
  );
}
