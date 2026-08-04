// Avatar upload/removal against the shared `avatars` storage bucket.
//
// The bucket lives on the same Supabase project as VMS (its migration 053), so
// a photo set here is visible in VMS too, and vice versa. The object path is a
// fixed `${userId}/avatar` with NO extension, on purpose: storage stores the
// content type alongside the object, and a stable path means an upsert replaces
// the previous photo instead of leaving a `.png` orphaned next to the new
// `.jpg`. It also makes removal exact — we know the one key to delete. Bucket
// RLS keys on the first path segment being the caller's uid, so a user can only
// ever write inside their own folder.
//
// The profile row write goes through gatepass.set_my_avatar() — never
// public.profiles directly (see src/lib/profiles.ts for why).
import { supabase, gp } from '../supabaseClient';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export type AvatarResult = { url: string | null } | { error: string };

/** Returns an error message, or null when the file is an acceptable avatar. */
export function validateAvatarFile(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith('image/')) return 'Please choose an image file (JPG, PNG or WebP).';
  if (file.size > MAX_AVATAR_BYTES) return 'That image is over 2 MB. Please choose a smaller one.';
  return null;
}

export function avatarPath(userId: string): string {
  return `${userId}/avatar`;
}

export async function uploadAvatar(userId: string, file: File): Promise<AvatarResult> {
  const invalid = validateAvatarFile(file);
  if (invalid) return { error: invalid };

  const path = avatarPath(userId);
  const { error: uploadErr } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadErr) {
    const msg = uploadErr.message ?? '';
    // A missing bucket is a deployment problem, not something the user can
    // fix by retrying.
    if (/bucket/i.test(msg) || /not found/i.test(msg)) {
      return { error: 'Photo storage is not configured on this environment.' };
    }
    return { error: msg || 'Upload failed. Please try again.' };
  }

  // Public bucket, so no signed URL. The timestamp defeats the browser cache —
  // the object key never changes, so without it the old photo stays on screen.
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  const url = `${data.publicUrl}?t=${Date.now()}`;

  const { error: profileErr } = await gp().rpc('set_my_avatar', { p_avatar_url: url });
  if (profileErr) {
    return { error: 'Photo uploaded, but saving it to your profile failed. Please try again.' };
  }
  return { url };
}

export async function removeAvatar(userId: string): Promise<AvatarResult> {
  // Clear the profile first: that is the field every screen reads, so a failed
  // storage delete leaves an orphaned object rather than a broken <img>.
  const { error: profileErr } = await gp().rpc('set_my_avatar', { p_avatar_url: null });
  if (profileErr) return { error: profileErr.message || 'Could not remove your photo.' };

  await supabase.storage.from('avatars').remove([avatarPath(userId)]);
  return { url: null };
}
