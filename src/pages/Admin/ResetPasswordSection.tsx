import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';
import type { Profile } from '../../types';

const MIN_LENGTH = 6;
const GENERATED_LENGTH = 14;
// No 0/O/1/l/I — this password gets read aloud down a phone line or copied off
// a screen, and an ambiguous glyph turns a reset into a second support call.
const GEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';

/**
 * Draws from the CSPRNG, NOT Math.random(). Math.random() is seeded from a value
 * an attacker can often recover and its successive outputs are derivable from
 * one another — fine for a shuffle, unacceptable for a live credential handed to
 * a real person.
 *
 * The `>= limit` rejection is not decoration either: 256 is not a multiple of
 * the alphabet length, so a plain `byte % len` would make the first few
 * characters measurably likelier than the rest and quietly shrink the search
 * space. Discarding the short tail keeps the draw uniform.
 */
function generatePassword(): string {
  const len = GEN_CHARS.length;
  const limit = Math.floor(256 / len) * len;
  let out = '';
  while (out.length < GENERATED_LENGTH) {
    const bytes = new Uint8Array(GENERATED_LENGTH);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;
      out += GEN_CHARS[b % len];
      if (out.length === GENERATED_LENGTH) break;
    }
  }
  return out;
}

interface Props {
  profile: Profile;
}

/**
 * Lives inside the Edit User modal. Deliberately two clicks away from doing
 * anything: "Reset Password" reveals the form, and the form itself is a second
 * commit. Mirrors migration 036's `admin_reset_user_password` contract exactly —
 * see CLAUDE.md's Users tab notes for the server-side behaviour this narrates.
 */
export default function ResetPasswordSection({ profile }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [lengthErr, setLengthErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setOpen(false);
    setPassword('');
    setShowPassword(false);
    setLengthErr(null);
    setSubmitting(false);
    setError(null);
    setResult(null);
    setCopied(false);
  }

  async function handleSubmit() {
    if (password.length < MIN_LENGTH) {
      setLengthErr(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    setLengthErr(null);
    setSubmitting(true);
    setError(null);
    try {
      const { error: rpcErr } = await gp().rpc('admin_reset_user_password', {
        p_user_id: profile.id,
        p_password: password,
      });
      if (rpcErr) throw rpcErr;
      setResult(password);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    if (typeof navigator.clipboard?.writeText === 'function') {
      await navigator.clipboard.writeText(result);
      setCopied(true);
    }
  }

  return (
    <div className="border-t border-surface-200 pt-4 mt-1">
      {!open && (
        <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)}>
          Reset Password
        </button>
      )}

      {open && result && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-navy-900">Password Reset</h3>
          <div className="alert-success flex-col items-start gap-2">
            <p>
              The password for <strong>{profile.email}</strong> has been set. They can sign in with
              it immediately, and will be asked to choose their own password on that first sign-in.
              All of their existing sessions have been signed out.
            </p>
            <div className="flex items-center gap-2 w-full">
              <code className="flex-1 rounded-lg bg-white/60 dark:bg-black/20 border border-matched-500/25 px-3 py-2 text-sm font-mono text-navy-900 break-all">
                {result}
              </code>
              <button type="button" className="btn-secondary shrink-0" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-navy-500">
              This password will not be shown again — copy it now and share it with the user directly.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={reset}>
            Done
          </button>
        </div>
      )}

      {open && !result && (
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="text-sm font-semibold text-navy-900">Reset Password</h3>
            <p className="text-xs text-navy-500 mt-0.5">
              Sets a new password for <strong>{profile.email}</strong> immediately and signs out all
              of their existing sessions. They will be required to choose their own password the next
              time they sign in.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="reset-password-input">New password</label>
            <div className="flex gap-2">
              <input
                id="reset-password-input"
                aria-label="New password"
                className={`input ${lengthErr ? 'input-error' : ''}`}
                type={showPassword ? 'text' : 'password'}
                minLength={MIN_LENGTH}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setLengthErr(null);
                }}
                placeholder="Min 6 characters"
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {lengthErr && <p className="field-error">{lengthErr}</p>}
          </div>
          <button
            type="button"
            className="text-xs font-medium text-brand-600 hover:text-brand-700 self-start"
            onClick={() => setPassword(generatePassword())}
          >
            Generate a strong password
          </button>
          {error && <div className="alert-error">{error}</div>}
          <div className="flex flex-col-reverse md:flex-row gap-3">
            <button type="button" className="btn-secondary flex-1" onClick={reset} disabled={submitting}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={submitting || password.length === 0}
              onClick={handleSubmit}
            >
              {submitting ? 'Setting…' : 'Set New Password'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
