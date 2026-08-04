// Profile photo card — upload, replace and remove the avatar. Mirrors the VMS
// profile page's photo card: the photo lives in the shared `avatars` bucket so
// it shows in both apps.
import React, { useRef, useState } from 'react';
import { uploadAvatar, removeAvatar } from '../../lib/avatarUpload';
import { initialsFor } from '../../lib/initials';

const CAMERA_ICON = 'M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z';
const CIRCLE_ICON = 'M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z';

type Props = {
  userId: string;
  fullName: string;
  email: string;
  avatarUrl: string | null;
  onAvatarChange: (url: string | null) => void;
};

export default function ProfilePhotoCard({ userId, fullName, email, avatarUrl, onAvatarChange }: Props): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const run = async (action: () => Promise<{ url: string | null } | { error: string }>, okMessage: string) => {
    setBusy(true); setError(''); setSaved('');
    const result = await action();
    setBusy(false);
    if ('error' in result) { setError(result.error); return; }
    onAvatarChange(result.url);
    setSaved(okMessage);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input straight away, so re-picking the same file still fires change.
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    await run(() => uploadAvatar(userId, file), 'Photo updated.');
  };

  return (
    <div className="card p-6 flex flex-col items-center text-center gap-4">
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        aria-label="Choose a profile photo" onChange={handleFile} />

      {avatarUrl ? (
        <img src={avatarUrl} alt={`${fullName || 'Your'} profile photo`}
          className="h-28 w-28 rounded-full object-cover ring-4 ring-brand-600/25" />
      ) : (
        <div className="h-28 w-28 rounded-full avatar-brand flex items-center justify-center text-2xl font-bold">
          {initialsFor(fullName, email)}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
          className="btn-primary !py-2 !px-4 text-sm inline-flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d={CAMERA_ICON} />
            <path strokeLinecap="round" strokeLinejoin="round" d={CIRCLE_ICON} />
          </svg>
          {busy ? 'Working…' : avatarUrl ? 'Change photo' : 'Upload photo'}
        </button>
        {avatarUrl && (
          <button type="button" disabled={busy}
            onClick={() => run(() => removeAvatar(userId), 'Photo removed.')}
            className="text-sm font-bold text-flagged-600 hover:text-flagged-700 px-3 py-2 rounded-xl hover:bg-flagged-500/10 transition-colors">
            Remove
          </button>
        )}
      </div>

      <p className="text-xs text-navy-400">JPG, PNG or WebP · up to 2 MB</p>
      {error && <p role="alert" className="text-xs font-semibold text-flagged-600">{error}</p>}
      {saved && !error && <p className="text-xs font-semibold text-matched-700">{saved}</p>}
    </div>
  );
}
