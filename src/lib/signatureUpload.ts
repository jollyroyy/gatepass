// Signature upload/removal — `avatarUpload.ts`'s twin, and deliberately so.
//
// Client, 2026-09-01: "give one option for them to upload their signature in
// one of the left-side panels."
//
// SAME BUCKET, DIFFERENT OBJECT. The image goes to the shared `avatars` bucket
// (VMS's migration 053) at a fixed `${userId}/signature`, beside the profile
// photo at `${userId}/avatar`. Reusing the bucket is what makes this feature
// possible at all without touching VMS's storage configuration: its RLS already
// keys writes on the first path segment being the caller's own uid, which is
// exactly the rule a signature needs, and this app's migrations may not create
// buckets or storage policies on a project VMS owns.
//
// ⚠ THE BUCKET IS PUBLIC, and the client was asked about this specifically and
// chose it (2026-09-01). A signature is therefore readable by anyone holding
// its URL — the same exposure a profile photo already has, and no more, but a
// signature is a more consequential thing to leave world-readable than a face.
// The URL is unguessable (a uuid path segment) and is only ever handed out by
// `get_pass_signatures`, which returns a mark only to somebody who may already
// read the pass it was made on. If that trade is ever revisited, the change is
// a private bucket plus `createSignedUrl` here and in `usePassSignatures` —
// nothing else in the feature would move.
//
// No extension on the path, for `avatarUpload`'s reason: storage keeps the
// content type beside the object, so a stable key means an upsert REPLACES the
// old signature rather than leaving a `.png` orphaned next to the new `.jpg`,
// and removal knows the one key to delete.
//
// The pointer row goes through `gatepass.set_my_signature()` (075) — never a
// direct table write, and never anywhere near `public.profiles`, which is VMS's
// and which this schema may not add a column to.
import { supabase, gp } from '../supabaseClient';

/** Smaller than the 2 MB an avatar gets, on purpose. A signature is a few
 *  strokes on a white ground: anything approaching a megabyte is a photograph
 *  of a page, which prints as a grey rectangle on the slip and is the failure
 *  this limit is really guarding against. */
export const MAX_SIGNATURE_BYTES = 1024 * 1024;

export type SignatureResult = { url: string | null } | { error: string };

/** Returns an error message, or null when the file is an acceptable signature. */
export function validateSignatureFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) {
    return 'Please choose an image file (PNG, JPG or WebP).';
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    return 'That image is over 1 MB. Please choose a smaller one.';
  }
  return null;
}

export function signaturePath(userId: string): string {
  return `${userId}/signature`;
}

export async function uploadSignature(userId: string, file: File): Promise<SignatureResult> {
  const invalid = validateSignatureFile(file);
  if (invalid) return { error: invalid };

  const path = signaturePath(userId);
  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadErr) {
    const msg = uploadErr.message ?? '';
    // A missing bucket is a deployment problem, not something the user can fix
    // by retrying.
    if (/bucket/i.test(msg) || /not found/i.test(msg)) {
      return { error: 'Signature storage is not configured on this environment.' };
    }
    return { error: msg || 'Upload failed. Please try again.' };
  }

  // Public bucket, so no signed URL. The timestamp defeats the browser cache —
  // the object key never changes, so without it a replaced signature would keep
  // showing the old one on every screen that had already loaded it.
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;

  const { error: rowErr } = await gp().rpc('set_my_signature', { p_signature_url: url });
  if (rowErr) {
    return { error: 'Signature uploaded, but saving it to your profile failed. Please try again.' };
  }
  return { url };
}

export async function removeSignature(userId: string): Promise<SignatureResult> {
  // Clear the pointer first: that is the field every slip reads, so a failed
  // storage delete leaves an orphaned object rather than a signature still
  // printing on paper after somebody asked for it to come down.
  const { error: rowErr } = await gp().rpc('set_my_signature', { p_signature_url: null });
  if (rowErr) return { error: rowErr.message || 'Could not remove your signature.' };

  await supabase.storage.from('avatars').remove([signaturePath(userId)]);
  return { url: null };
}

/** The caller's own signature, or null. Reads the table directly — migration
 *  075's `user_signatures_select_own` policy admits exactly this one row, and
 *  nobody else's. */
export async function fetchMySignature(userId: string): Promise<string | null> {
  try {
    const { data, error } = await gp()
      .from('user_signatures')
      .select('signature_url')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) return null;
    return (data as { signature_url: string } | null)?.signature_url ?? null;
  } catch {
    return null;
  }
}
