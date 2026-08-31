// Put the approval ladder back the way scripts/e2e/seed.mjs found it.
//
// Seeding evicts the four sitting office holders because a seat is a singleton
// (049) and the e2e cast has to be able to sign a pass up the whole ladder.
// This reads tests/e2e/.state/approval_roles.snapshot.json and restores it
// exactly, then deletes the snapshot so a later seed takes a fresh one.
//
// It does NOT delete the e2e accounts: gate_passes.raised_by references them and
// a raised pass is permanent (024), so removing the HOD would orphan real rows.
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { psql } from './db.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

const snapPath = path.join(root, 'tests/e2e/.state/approval_roles.snapshot.json');
if (!fs.existsSync(snapPath)) {
  console.log('No approval_roles snapshot — nothing to restore.');
  process.exit(0);
}
const rows = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
psql('delete from gatepass.approval_roles;');
for (const r of rows) {
  // `deputy_id` is ignored if an older snapshot still carries one — migration
  // 068 dropped the column, and a seat that no longer exists cannot be restored.
  const by = r.designated_by ? `'${r.designated_by}'` : 'null';
  psql(`insert into gatepass.approval_roles (role_key, user_id, designated_by, designated_at) values ('${r.role_key}', '${r.user_id}', ${by}, now());`);
  console.log(`  restored ${r.role_key}`);
}
fs.unlinkSync(snapPath);
console.log(`Approval ladder restored (${rows.length} seat(s)).`);
