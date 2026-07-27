// scripts/create-user.ts — the ONLY place in this repo that touches the
// Supabase service-role key. Run with `npm run create-user -- <args>` (tsx).
//
// Why this exists as a script and not a form in the admin UI: creating an auth
// user requires `supabase.auth.admin.createUser`, which only works with the
// service-role key. That key bypasses every RLS policy in the project — VMS's
// and this app's — so it must never be bundled into client-side JS. Vite would
// happily inline any `VITE_`-prefixed env var into the browser bundle; keeping
// this key bare (`SUPABASE_SERVICE_ROLE_KEY`, no `VITE_` prefix) and reading it
// only via `process.env` in a node script is what keeps it server-side.
//
// Setting `app_metadata.role` on creation is essential, not cosmetic: every RLS
// policy in gatepass (see gatepass.app_role() in migration 002) and the client's
// getUserRole() read the role from the JWT's app_metadata first. An account
// created without it has no role until someone patches the JWT by hand.
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SCRIPT_ROLES = ['hod', 'guard', 'admin'] as const;
type ScriptRole = (typeof SCRIPT_ROLES)[number];

interface ParsedArgs {
  email?: string;
  password?: string;
  name?: string;
  role?: string;
  depts: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = { depts: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--email':
        result.email = next;
        i++;
        break;
      case '--password':
        result.password = next;
        i++;
        break;
      case '--name':
        result.name = next;
        i++;
        break;
      case '--role':
        result.role = next;
        i++;
        break;
      case '--dept':
        if (next) result.depts.push(next);
        i++;
        break;
      default:
        break;
    }
  }
  return result;
}

function printUsage(): void {
  console.log(`
Usage:
  npm run create-user -- --email <email> --password <password> --name <full name> --role <${SCRIPT_ROLES.join('|')}> [--dept <uuid-or-code> ...]

Examples:
  npm run create-user -- --email guard1@company.com --password "TempPass123!" --name "Ravi Kumar" --role guard
  npm run create-user -- --email jane.doe@company.com --password "TempPass123!" --name "Jane Doe" --role hod --dept ENG --dept QA

Required: --email --password --name --role
Optional: --dept (repeatable, only applied when --role hod; accepts a department UUID or its code)
`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A service-role key is a JWT whose payload carries `role: "service_role"`.
 * Decoding (not verifying) the middle segment is enough to catch the most
 * common mistake: pasting the anon key here by accident, which would silently
 * make every call below fail with a permissions error far from this check.
 */
function assertLooksLikeServiceRoleKey(key: string): void {
  const parts = key.split('.');
  if (parts.length !== 3) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY does not look like a JWT (expected three dot-separated parts).');
  }
  let payload: { role?: string };
  try {
    const json = Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    payload = JSON.parse(json);
  } catch {
    throw new Error('Could not decode SUPABASE_SERVICE_ROLE_KEY — check it was copied correctly.');
  }
  if (payload.role === 'anon') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY looks like the ANON key, not the service-role key. Check .env.');
  }
  if (payload.role !== 'service_role') {
    throw new Error(`SUPABASE_SERVICE_ROLE_KEY has unexpected JWT role "${payload.role}" (expected "service_role").`);
  }
}

async function resolveDepartmentId(
  supabase: ReturnType<typeof createClient>,
  value: string,
): Promise<{ id: string; code: string; name: string }> {
  const query = UUID_RE.test(value)
    ? supabase.schema('public').from('departments').select('id, code, name').eq('id', value).maybeSingle()
    : supabase.schema('public').from('departments').select('id, code, name').eq('code', value.toUpperCase()).maybeSingle();

  const { data, error } = await query;
  if (error) throw new Error(`Looking up department "${value}" failed: ${error.message}`);
  if (!data) throw new Error(`Department "${value}" not found (tried as UUID and as code).`);
  return data as { id: string; code: string; name: string };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email || !args.password || !args.name || !args.role) {
    console.error('Missing required argument(s).');
    printUsage();
    process.exit(1);
  }

  if (!SCRIPT_ROLES.includes(args.role as ScriptRole)) {
    console.error(`Invalid --role "${args.role}". Must be one of: ${SCRIPT_ROLES.join(', ')}.`);
    printUsage();
    process.exit(1);
  }
  const role = args.role as ScriptRole;

  const url = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error('Missing VITE_SUPABASE_URL in .env at the project root.');
    process.exit(1);
  }
  if (!serviceRoleKey) {
    console.error(
      'Missing SUPABASE_SERVICE_ROLE_KEY in .env at the project root. This script cannot run without it.',
    );
    process.exit(1);
  }
  assertLooksLikeServiceRoleKey(serviceRoleKey);

  if (args.depts.length > 0 && role !== 'hod') {
    console.warn(`Note: --dept is only applied for --role hod. Ignoring ${args.depts.length} --dept value(s).`);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Creating auth user ${args.email} (role: ${role})…`);
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: args.email,
    password: args.password,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: args.name },
  });
  if (createErr || !created.user) {
    console.error(`Failed to create auth user: ${createErr?.message ?? 'unknown error'}`);
    process.exit(1);
  }
  const userId = created.user.id;

  console.log('Writing public.profiles row…');
  const { error: profileErr } = await supabase
    .schema('public')
    .from('profiles')
    .upsert({ id: userId, email: args.email, full_name: args.name, role }, { onConflict: 'id' });
  if (profileErr) {
    console.error(`Auth user was created (id: ${userId}) but the profiles upsert failed: ${profileErr.message}`);
    process.exit(1);
  }

  const assignedDepartments: { id: string; code: string; name: string }[] = [];
  if (role === 'hod' && args.depts.length > 0) {
    console.log('Resolving and assigning departments…');
    for (const raw of args.depts) {
      const dept = await resolveDepartmentId(supabase, raw);
      const { error: assignErr } = await supabase
        .schema('gatepass')
        .from('hod_departments')
        .insert({ hod_id: userId, department_id: dept.id });
      if (assignErr && (assignErr as { code?: string }).code !== '23505') {
        console.error(`Failed to assign department "${dept.name}": ${assignErr.message}`);
        process.exit(1);
      }
      assignedDepartments.push(dept);
    }
  }

  console.log('\n✓ Account provisioned successfully');
  console.log('──────────────────────────────────');
  console.log(`  User ID:     ${userId}`);
  console.log(`  Email:       ${args.email}`);
  console.log(`  Name:        ${args.name}`);
  console.log(`  Role:        ${role}`);
  if (assignedDepartments.length > 0) {
    console.log(`  Departments: ${assignedDepartments.map((d) => `${d.name} (${d.code})`).join(', ')}`);
  }
  console.log('──────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Unexpected failure:', err instanceof Error ? err.message : err);
  process.exit(1);
});
