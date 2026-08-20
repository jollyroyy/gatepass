// Admin → Settings → the application's own settings (migration 056).
//
// ⚠ THIS CARD'S MOST IMPORTANT JOB IS TELLING THE TRUTH ABOUT WHAT IT DOES.
// One control here enforces something today (the sign-out timer). Three are
// stored provisions that change nothing yet — the 2FA switch, the app name and
// the brand colour. A settings screen that looks live but is not is worse than
// one that admits it, and in the 2FA case it is worse still: an admin who flips
// "Require two-factor", sees "Saved", and walks away believes their approvers
// are protected against a stolen password. They are not.
//
// So the notes under those fields are not decoration. `twoFactorNote` and
// `brandingNote` in `appSettings.ts` are load-bearing; removing them turns this
// card into a set of lies, and the honest fix at that point is to delete the
// fields rather than quieten the sentences.
//
// The shape is `MailSettingsCard`'s, deliberately: same load/apply/save, same
// `safeErrorMessage`, same "Last changed … by …" line, same skeleton. Two
// settings cards on one tab that behave differently is a defect in itself.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/formatDate';
import {
  appSettingsPayload,
  brandingNote,
  formFromSettings,
  twoFactorNote,
  validateAppSettings,
  APP_NAME_MAX,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  SESSION_TIMEOUT_MAX,
  SESSION_TIMEOUT_MIN,
  type AppSettings,
  type AppSettingsErrors,
  type AppSettingsForm,
} from '../../lib/appSettings';
import SettingField from './SettingField';

export default function AppSettingsCard(): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [form, setForm] = useState<AppSettingsForm>(() => formFromSettings(null));
  const [errors, setErrors] = useState<AppSettingsErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = useCallback((data: unknown) => {
    const s = (data ?? null) as AppSettings | null;
    setSettings(s);
    setForm(formFromSettings(s));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await gp().rpc('get_app_settings');
      if (err) throw err;
      apply(data);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not read the application settings.'));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => { void load(); }, [load]);

  function set<K extends keyof AppSettingsForm>(key: K, value: AppSettingsForm[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save(): Promise<void> {
    const found = validateAppSettings(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { data, error: err } = await gp().rpc('set_app_settings', appSettingsPayload(form));
      if (err) throw err;
      apply(data);
      setSaved(true);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not save the application settings.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card p-4 space-y-3">
        <div className="skeleton h-6 w-1/3" />
        <div className="skeleton h-10 w-full" />
        <div className="skeleton h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-4">
      <div>
        <h2 className="section-title mb-0">Application settings</h2>
        <p className="text-sm text-navy-500">
          How this deployment behaves and what it is called.
        </p>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {saved && <div className="alert-success">Saved.</div>}

      {/* ── Security ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="card-title mb-0">Security</h3>

        <SettingField
          id="app-session-timeout"
          label="Sign out after this many minutes of inactivity"
          value={form.sessionTimeoutMinutes}
          onChange={(v) => set('sessionTimeoutMinutes', v)}
          error={errors.sessionTimeoutMinutes}
          hint={`Between ${SESSION_TIMEOUT_MIN} and ${SESSION_TIMEOUT_MAX}. Leave blank for the default of ${DEFAULT_SESSION_TIMEOUT_MINUTES} minutes. This one takes effect immediately.`}
          inputMode="numeric"
          placeholder={String(DEFAULT_SESSION_TIMEOUT_MINUTES)}
        />

        <div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.requireApprover2fa}
              onChange={(e) => set('requireApprover2fa', e.target.checked)}
            />
            <span className="text-sm font-semibold text-navy-900">
              Require two-factor authentication for approvers
            </span>
          </label>
          {/* THE SENTENCE THAT KEEPS THIS HONEST. See the header. */}
          <p className="text-xs text-pending-700 mt-1">{twoFactorNote(form.requireApprover2fa)}</p>
          <details className="mt-2">
            <summary className="text-xs text-accent-600 cursor-pointer">
              What setting this up will involve
            </summary>
            <ol className="text-xs text-navy-500 mt-1 ml-4 list-decimal space-y-1">
              <li>
                Each approver registers an authenticator app (Google or Microsoft Authenticator)
                against their account, scanning a QR code once.
              </li>
              <li>
                From then on, signing in asks for the 6-digit code from that app as well as the
                password.
              </li>
              <li>
                The approval itself is refused by the database unless that second factor was proven
                recently — so a stolen password on its own cannot approve a gate pass.
              </li>
              <li>
                Anyone who loses their phone needs an admin to reset their enrolment, so keep at
                least two admins.
              </li>
            </ol>
          </details>
        </div>
      </div>

      {/* ── Branding ─────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="card-title mb-0">Branding</h3>
        <p className="text-xs text-pending-700">{brandingNote()}</p>

        <SettingField
          id="app-name"
          label="Application name"
          value={form.appName}
          onChange={(v) => set('appName', v)}
          error={errors.appName}
          hint={`Up to ${APP_NAME_MAX} characters. Blank keeps the name the app ships with.`}
          placeholder="Quest Gate Pass"
        />

        <SettingField
          id="app-brand-color"
          label="Brand colour"
          value={form.brandColor}
          onChange={(v) => set('brandColor', v)}
          error={errors.brandColor}
          // No example hex here either — see the note in `appSettings.ts`.
          hint="A hash followed by six hex digits. Blank keeps the shipped gold."
          placeholder="Hash plus six hex digits"
        />
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {settings?.updated_at && (
          <p className="text-xs text-navy-500">
            Last changed {formatDateTime(settings.updated_at)}
            {settings.updated_by_name ? ` by ${settings.updated_by_name}` : ''}.
          </p>
        )}
      </div>
    </div>
  );
}
