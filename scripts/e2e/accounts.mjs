// THE E2E CAST. Dedicated accounts, created by scripts/e2e/seed.mjs and used by
// nothing else. They live on the shared project alongside the demo accounts and
// are recognisable by the `@e2e.local` domain — never delete anything that is
// not on that domain.
export const E2E_DOMAIN = '@e2e.local';
export const E2E_DEPT = { code: 'E2E', name: 'E2E Test Department' };
// NOTE: public.profiles carries a NOT-VALID check `full_name ~ '^[A-Za-z .''-]+$'`.
// A DIGIT in a full name aborts public.handle_new_user() and GoTrue answers 500
// with an EMPTY error body — so no e2e display name may contain one.
export const E2E_DEPT_2 = { code: 'E2E2', name: 'E2E Second Department' };

// role  = public.profiles.role / app_metadata.role (the VMS enum)
// office = gatepass.approval_roles.role_key, or null
export const ACCOUNTS = [
  { key: 'hod',     email: `e2e.hod${E2E_DOMAIN}`,     name: 'Test HOD One',        role: 'hod',   office: null,            dept: E2E_DEPT.code },
  { key: 'hod2',    email: `e2e.hod2${E2E_DOMAIN}`,    name: 'Test HOD Two',        role: 'hod',   office: null,            dept: E2E_DEPT_2.code },
  { key: 'guard',   email: `e2e.guard${E2E_DOMAIN}`,   name: 'Test Guard',          role: 'guard', office: null,            dept: null },
  { key: 'admin',   email: `e2e.admin${E2E_DOMAIN}`,   name: 'Test Administrator',  role: 'admin', office: null,            dept: null },
  { key: 'secHead', email: `e2e.sechead${E2E_DOMAIN}`, name: 'Test Security Head',  role: 'staff', office: 'security_head', dept: null },
  { key: 'finHead', email: `e2e.finhead${E2E_DOMAIN}`, name: 'Test Finance Head',   role: 'staff', office: 'finance_head',  dept: null },
  { key: 'coo',     email: `e2e.coo${E2E_DOMAIN}`,     name: 'Test COO',            role: 'staff', office: 'coo',           dept: null },
  { key: 'ceo',     email: `e2e.ceo${E2E_DOMAIN}`,     name: 'Test CEO',            role: 'staff', office: 'ceo',           dept: null },
  // No role, no office: the /no-access gate.
  { key: 'staff',   email: `e2e.staff${E2E_DOMAIN}`,   name: 'Test Staff',          role: 'staff', office: null,            dept: null },
  // An HOD with no seat — the only legal delegate for the two lower offices (066).
  { key: 'deputy',  email: `e2e.deputy${E2E_DOMAIN}`,  name: 'Test Deputy HOD',     role: 'hod',   office: null,            dept: null },
];

export const byKey = (k) => {
  const a = ACCOUNTS.find((x) => x.key === k);
  if (!a) throw new Error(`No e2e account "${k}"`);
  return a;
};
