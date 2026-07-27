// `public.profiles` belongs to VMS, and a policy on it once recursed into
// itself: every GatePass screen that read a name died with SQLSTATE 42P17
// ("infinite recursion detected in policy for relation profiles"). VMS has
// shipped that fix three times and it keeps coming back, so this app no
// longer depends on the policies of a table it does not own — every person
// lookup goes through gatepass-schema RPCs/views in src/lib/profiles.ts
// instead (migration 006). If a `pub().from('profiles')` call reappears
// anywhere, the app is one VMS policy edit away from breaking again.
import { describe, expect, it } from 'vitest';
import { readSrc, srcFiles, stripComments } from './sourceScan';

const PROFILES_LIB = 'src\\lib\\profiles.ts';
const SUPABASE_CLIENT = 'src\\supabaseClient.ts';

function isAllowedFile(file: string, allowed: string): boolean {
  return file.replace(/\//g, '\\').endsWith(allowed);
}

describe('no direct public.profiles reads', () => {
  it('never calls .from(\'profiles\') / .from("profiles") anywhere in src/', () => {
    const pattern = /\.from\(\s*['"]profiles['"]/;
    const offenders = srcFiles()
      .filter((file) => pattern.test(stripComments(readSrc(file))))
      .map((file) => file.replace(process.cwd(), '.'));

    expect(
      offenders,
      `these files read public.profiles directly instead of going through ` +
        `src/lib/profiles.ts — that table's RLS policy has recursed into ` +
        `itself in the live project before (SQLSTATE 42P17):\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  it('src/lib/profiles.ts exists and wraps the gatepass RPC replacements', () => {
    const file = srcFiles().find((f) => isAllowedFile(f, PROFILES_LIB));
    expect(file, 'src/lib/profiles.ts is missing — it is the only sanctioned place to read person data').toBeDefined();

    const text = stripComments(readSrc(file!));
    expect(text, 'src/lib/profiles.ts must call the gatepass.my_profile() RPC (migration 006)').toContain('my_profile');
    expect(
      text,
      'src/lib/profiles.ts must call the gatepass.admin_list_profiles() RPC (migration 006)'
    ).toContain('admin_list_profiles');
  });

  it('no file outside src/lib/profiles.ts / src/supabaseClient.ts references my_profile', () => {
    // src/supabaseClient.ts is allowed: its role fallback calls the RPC
    // directly to avoid an import cycle with src/lib/profiles.ts (see its
    // own comment on getUserRole()).
    const offenders = srcFiles()
      .filter((file) => !isAllowedFile(file, PROFILES_LIB) && !isAllowedFile(file, SUPABASE_CLIENT))
      .filter((file) => stripComments(readSrc(file)).includes('my_profile'))
      .map((file) => file.replace(process.cwd(), '.'));

    expect(
      offenders,
      `only src/lib/profiles.ts and src/supabaseClient.ts may call gatepass.my_profile() directly — ` +
        `every other caller should go through fetchMyProfile()/fetchDisplayName():\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
