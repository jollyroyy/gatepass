// The e2e cast, mirrored from scripts/e2e/accounts.mjs so specs can import it
// as TypeScript. Kept in step by tests/e2e/harness.spec.ts, which fails if the
// two lists ever disagree.
export type RoleKey =
  | 'hod' | 'hod2' | 'guard' | 'admin'
  | 'secHead' | 'finHead' | 'coo' | 'ceo'
  | 'staff' | 'deputy';

export interface Account {
  key: RoleKey;
  email: string;
  name: string;
  /** public.profiles.role — the VMS enum this app authorises off. */
  role: 'hod' | 'guard' | 'admin' | 'staff';
  /** gatepass.approval_roles.role_key, when this account holds a seat. */
  office: 'security_head' | 'finance_head' | 'coo' | 'ceo' | null;
  /** Where this account lands after signing in (src/lib/roleRoutes.ts). */
  home: string;
}

const D = '@e2e.local';

export const ACCOUNTS: Record<RoleKey, Account> = {
  hod:     { key: 'hod',     email: `e2e.hod${D}`,     name: 'Test HOD One',       role: 'hod',   office: null,            home: '/dashboard' },
  hod2:    { key: 'hod2',    email: `e2e.hod2${D}`,    name: 'Test HOD Two',       role: 'hod',   office: null,            home: '/dashboard' },
  guard:   { key: 'guard',   email: `e2e.guard${D}`,   name: 'Test Guard',         role: 'guard', office: null,            home: '/guard-dashboard' },
  admin:   { key: 'admin',   email: `e2e.admin${D}`,   name: 'Test Administrator', role: 'admin', office: null,            home: '/admin-dashboard' },
  // An office REPLACES the role's routes (roleRoutes.ts), so every seat holder
  // lands on the approval queue whatever their VMS role says.
  secHead: { key: 'secHead', email: `e2e.sechead${D}`, name: 'Test Security Head', role: 'staff', office: 'security_head', home: '/approvals' },
  finHead: { key: 'finHead', email: `e2e.finhead${D}`, name: 'Test Finance Head',  role: 'staff', office: 'finance_head',  home: '/approvals' },
  coo:     { key: 'coo',     email: `e2e.coo${D}`,     name: 'Test COO',           role: 'staff', office: 'coo',           home: '/approvals' },
  ceo:     { key: 'ceo',     email: `e2e.ceo${D}`,     name: 'Test CEO',           role: 'staff', office: 'ceo',           home: '/approvals' },
  // Role `staff`, no office: this app opens nothing for them. NOTE THE HOME —
  // `/login`, not `/no-access`. The gate in App.tsx RENDERS <NoAccess> in place
  // rather than navigating, so the URL never changes. See the harness spec,
  // which asserts the screen instead of the path for this one account.
  staff:   { key: 'staff',   email: `e2e.staff${D}`,   name: 'Test Staff',         role: 'staff', office: null,            home: '/login' },
  // An active HOD holding no seat — the only legal delegate for the two lower
  // offices (066).
  deputy:  { key: 'deputy',  email: `e2e.deputy${D}`,  name: 'Test Deputy HOD',    role: 'hod',   office: null,            home: '/dashboard' },
};

export const PASSWORD = process.env.E2E_PASSWORD ?? 'E2ePass!2026x';

/** The department the e2e HOD heads — everything this suite raises belongs to it. */
export const E2E_DEPT = { code: 'E2E', name: 'E2E Test Department' };
export const E2E_DEPT_2 = { code: 'E2E2', name: 'E2E Second Department' };

/** Where a role's signed-in browser state is cached by auth.setup.ts. */
export const storageStateFor = (key: RoleKey) => `tests/e2e/.state/${key}.json`;
