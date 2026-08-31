// Preflight: are the four approval offices still held by the e2e cast?
//
// AN OFFICE IS A SINGLETON SEAT (049), and ANYTHING else that touches this
// shared project can take one back — an admin clicking through the Approval
// Ladder card, another session, a stray spec. When that happens the four
// office-holder sign-ins stop landing on `/approvals` and FIFTY-TWO tests fail
// with "sign in as secHead", which says nothing about the real cause.
//
// So the suite checks before it runs, says plainly what it found, and re-takes
// the seats. It never overwrites the snapshot — scripts/e2e/seed.mjs took that
// once, and `npm run e2e:restore` is still the way back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCOUNTS } from './accounts.mjs';
import { psql, psqlRows } from './db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const idsPath = path.join(root, 'tests/e2e/.state/ids.json');

export function ensureLadder() {
  // OPT-IN, AND DELIBERATELY SO. On 2026-08-24 this ran while somebody was
  // working in the app: they had just seated the Security Head, the Finance HOD
  // and the COO themselves, and the preflight took all three back out from
  // under them mid-session. A test harness may not quietly reassign a live
  // system's approval ladder. Set E2E_TAKE_LADDER=1 only when the project is
  // yours for the duration.
  if (process.env.E2E_TAKE_LADDER !== '1') {
    return { checked: false, reason: 'E2E_TAKE_LADDER is not 1 — leaving the approval ladder alone' };
  }
  if (!fs.existsSync(idsPath)) return { checked: false, reason: 'no ids.json — run npm run e2e:seed' };
  const ids = JSON.parse(fs.readFileSync(idsPath, 'utf8'));

  const held = new Map(
    psqlRows('select role_key, user_id::text from gatepass.approval_roles;').map(([k, v]) => [k, v]),
  );

  const wrong = ACCOUNTS.filter((a) => a.office).filter((a) => held.get(a.office) !== ids[a.key]);
  if (wrong.length === 0) return { checked: true, retaken: [] };

  for (const a of wrong) {
    console.warn(`[e2e] ${a.office} is not held by ${a.email} — re-taking the seat`);
    psql(`delete from gatepass.approval_roles where role_key = '${a.office}' or user_id = '${ids[a.key]}';`);
    psql(
      `insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at) `
      + `values ('${a.office}', '${ids[a.key]}', '${ids.admin}', now());`,
    );
  }
  return { checked: true, retaken: wrong.map((a) => a.office) };
}

if (process.argv[1] && process.argv[1].endsWith('ensure-ladder.mjs')) {
  const r = ensureLadder();
  console.log(JSON.stringify(r));
}
