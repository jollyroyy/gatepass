// ProfilePhotoCard's sibling, for a signature rather than a face.
//
// Client, 2026-09-01: "Give one option for them to upload their signature in
// one of the left-side panels. Whatever they have uploaded there, the same
// signature will be shown on the print pass page after they approve it."
//
// It fetches its own current signature (fetchMySignature) on mount instead of
// taking one as a prop the way ProfilePhotoCard takes avatarUrl — Profile.tsx
// has no other reason to hold a signature URL in state, and giving this card
// its own read keeps the page's change to a couple of lines, as the task asks.
//
// The white plate the signature is drawn on lives in `SignatureSwatch` — it is
// a fixed-context surface and has to be literal white with literal ink, while
// this card's own face and captions follow the theme like everything else. The
// two cannot share a file; see that file for why.
import React, { useEffect, useRef, useState } from 'react';
import { uploadSignature, removeSignature, fetchMySignature } from '../../lib/signatureUpload';
import SignatureSwatch from './SignatureSwatch';

type Props = {
  userId: string;
  onChange?: (url: string | null) => void;
};

export default function SignatureCard({ userId, onChange }: Props): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMySignature(userId).then((url) => {
      if (!cancelled) { setSignatureUrl(url); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [userId]);

  const run = async (action: () => Promise<{ url: string | null } | { error: string }>, okMessage: string) => {
    setBusy(true); setError(''); setSaved('');
    const result = await action();
    setBusy(false);
    if ('error' in result) { setError(result.error); return; }
    setSignatureUrl(result.url);
    onChange?.(result.url);
    setSaved(okMessage);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input straight away, so re-picking the same file still fires change.
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    await run(() => uploadSignature(userId, file), 'Signature updated.');
  };

  return (
    <div className="card p-6 flex flex-col items-center text-center gap-4">
      <input ref={fileRef} type="file" accept="image/*" className="hidden"
        aria-label="Choose a signature image" onChange={handleFile} />

      <h2 className="text-lg font-display font-normal text-brand-800 dark:text-brand-300">
        My Signature
      </h2>

      {loading ? (
        <div className="skeleton h-20 w-40 rounded-lg" />
      ) : signatureUrl ? (
        <SignatureSwatch src={signatureUrl} />
      ) : (
        <p className="text-xs text-navy-500">
          Upload your signature so it can appear on gate passes you approve.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" disabled={busy || loading} onClick={() => fileRef.current?.click()}
          className="btn-primary !py-2 !px-4 text-sm inline-flex items-center gap-2">
          {busy ? 'Working…' : signatureUrl ? 'Replace' : 'Upload signature'}
        </button>
        {signatureUrl && (
          <button type="button" disabled={busy}
            onClick={() => run(() => removeSignature(userId), 'Signature removed.')}
            className="text-sm font-bold text-flagged-600 hover:text-flagged-700 px-3 py-2 rounded-xl hover:bg-flagged-500/10 transition-colors">
            Remove
          </button>
        )}
      </div>

      <p className="text-xs text-navy-500">
        Shown on the printed pass only against approvals you actually give — not on every pass in the ladder.
      </p>
      {error && <p role="alert" className="text-xs font-semibold text-flagged-600">{error}</p>}
      {saved && !error && <p className="text-xs font-semibold text-matched-700">{saved}</p>}
    </div>
  );
}
