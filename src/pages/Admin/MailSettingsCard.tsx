// Admin → Settings → Approval email (migration 052).
//
// The approval ladder's letters used to be addressed by the Edge Function's
// secrets alone: changing the inbox they are redirected to meant a
// `supabase secrets set` and a redeploy. This card is that setting, in the
// hands of the people who run the system (client, 2026-08-20).
//
// THE PASSWORD GOES IN AND NEVER COMES OUT. `get_mail_settings()` does not
// return it — only whether one is stored — so the box below always renders
// empty, and an untouched box sends null, which the RPC reads as "leave the
// stored one alone". See `mailSettings.ts` for that rule.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/formatDate';
import {
  senderDomainWarning,
  formFromSettings,
  validateMailSettings,
  mailSettingsPayload,
  deliveryNote,
  senderNote,
  smtpNote,
  SMTP_SECURITY_LABELS,
  type MailSettings,
  type MailSettingsForm,
  type MailSettingsErrors,
} from '../../lib/mailSettings';
import SettingField from './SettingField';
import NotifyCcFields from './NotifyCcFields';
import LastSendNote, { type SendAttempt } from './LastSendNote';

export default function MailSettingsCard(): React.ReactElement {
  const [settings, setSettings] = useState<MailSettings | null>(null);
  const [form, setForm] = useState<MailSettingsForm>(() => formFromSettings(null));
  // A blank password box means two different things — "I never touched it" and
  // "I want it gone" — and only this flag tells them apart.
  const [passwordTouched, setPasswordTouched] = useState(false);
  const [errors, setErrors] = useState<MailSettingsErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // The one fact this card cannot derive: whether the provider ACCEPTED the
  // last letter. An unverified Resend account refuses every address but the
  // one that owns it, so a perfectly saved setting can still send nothing —
  // and that refusal lived only in `email_log` until now.
  const [lastSend, setLastSend] = useState<SendAttempt | null>(null);

  const apply = useCallback((data: unknown) => {
    const s = (data ?? null) as MailSettings | null;
    setSettings(s);
    setForm(formFromSettings(s));
    setPasswordTouched(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await gp().rpc('get_mail_settings');
      if (err) throw err;
      apply(data);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not read the mail settings.'));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => { load(); }, [load]);

  // Best-effort and deliberately separate from `load`: a mail log that cannot
  // be read must not stop an admin editing the settings.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await gp()
          .from('email_log')
          .select('recipient, subject, ok, error, created_at')
          .order('created_at', { ascending: false })
          .limit(1);
        setLastSend(((data as SendAttempt[] | null) ?? [])[0] ?? null);
      } catch {
        /* No log, no strip. */
      }
    })();
  }, []);

  /** The copy list is the one field that is not a string, so it gets its own
   *  setter rather than widening `set` and losing the type on every caller. */
  function setNotifyCc(rows: string[]) {
    setForm((f) => ({ ...f, notifyCc: rows }));
    setSaved(false);
  }

  function set(field: keyof MailSettingsForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaved(false);
    if (field === 'smtpPassword') setPasswordTouched(true);
  }

  // A WARNING, NOT AN ERROR (2026-09-01). The provider accepts a free-mailbox
  // sender and rewrites the sending domain rather than refusing it, so this
  // must not block Save — but it must be visible, because the rewrite is
  // invisible from inside this app and costs deliverability.
  const senderWarning = senderDomainWarning(form.fromEmail);

  async function handleSave() {
    const found = validateMailSettings(form);
    setErrors(found);
    // Nothing is sent while a field is wrong: the database says the same thing
    // in a CHECK, and a 23514 reaching the browser is not a sentence anybody
    // can act on.
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setError(null);
    try {
      const { data, error: err } = await gp()
        .rpc('set_mail_settings', mailSettingsPayload(form, passwordTouched));
      if (err) throw err;
      apply(data);
      setSaved(true);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not save the mail settings.'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="card p-4 space-y-3">
        <h2 className="section-title mb-0">Approval email</h2>
        <div className="skeleton h-6 w-1/2" />
        <div className="skeleton h-4 w-1/3" />
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-4">
      <div>
        <h2 className="section-title mb-1">Approval email</h2>
        <p className="text-sm text-navy-600">{deliveryNote(settings)}</p>
        <p className="text-sm text-navy-600 mt-1">{senderNote(settings)}</p>
        {settings?.updated_at && (
          <p className="text-xs text-navy-500 mt-1">
            Last changed {formatDateTime(settings.updated_at)}
            {settings.updated_by_name ? ` by ${settings.updated_by_name}` : ''}
          </p>
        )}
      </div>

      <LastSendNote attempt={lastSend} />

      {error && <div className="alert-error">{error}</div>}
      {saved && !error && <div className="alert-success">Mail settings saved.</div>}

      <SettingField
        id="mail-override-to"
        label="Send all approval mail to"
        value={form.overrideTo}
        onChange={(v) => set('overrideTo', v)}
        error={errors.overrideTo}
        type="email"
        placeholder="name@company.com"
        // Why this field exists at all, in the words of the situation it solves.
        hint="One address at a time — every approver's letter is redirected here. Leave it blank to write to each approver's own address instead."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SettingField
          id="mail-from-name"
          label="Sender name"
          value={form.fromName}
          onChange={(v) => set('fromName', v)}
          placeholder="Quest GatePass"
        />
        <SettingField
          id="mail-from-email"
          label="Sender address"
          value={form.fromEmail}
          onChange={(v) => set('fromEmail', v)}
          error={errors.fromEmail}
          type="email"
          placeholder="gatepass@company.com"
          // A gmail/outlook address here refuses EVERY letter, which is not
          // what "must belong to a verified domain" told anybody on the day it
          // happened. The hint now says what to do instead, and
          // `senderDomainProblem` refuses to save one at all.
          hint="A domain you have authenticated with the mail provider. A Gmail or Outlook address still sends, but the provider rewrites the sender and the mail is far more likely to be filtered."
        />
        {senderWarning && <p className="text-xs text-pending-700 sm:col-span-2">{senderWarning}</p>}
      </div>

      <NotifyCcFields
        rows={form.notifyCc}
        onChange={setNotifyCc}
        errors={errors.notifyCcRows}
        overrideTo={settings?.override_to ?? null}
      />

      <div className="border-t border-surface-200 dark:border-navy-700 pt-4 space-y-3">
        <div>
          <h3 className="card-title mb-1">SMTP server</h3>
          <p className="text-sm text-navy-600">{smtpNote(settings)}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <SettingField
              id="mail-smtp-host"
              label="SMTP host"
              value={form.smtpHost}
              onChange={(v) => set('smtpHost', v)}
              placeholder="smtp.company.com"
            />
          </div>
          <SettingField
            id="mail-smtp-port"
            label="Port"
            value={form.smtpPort}
            onChange={(v) => set('smtpPort', v)}
            error={errors.smtpPort}
            inputMode="numeric"
            placeholder="587"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="mail-smtp-security" className="block text-sm font-semibold text-navy-900 mb-1">
              Security
            </label>
            <select
              id="mail-smtp-security"
              className="input w-full"
              value={form.smtpSecurity}
              onChange={(e) => set('smtpSecurity', e.target.value)}
            >
              <option value="">Not set</option>
              {(Object.keys(SMTP_SECURITY_LABELS) as (keyof typeof SMTP_SECURITY_LABELS)[]).map((k) => (
                <option key={k} value={k}>{SMTP_SECURITY_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <SettingField
            id="mail-smtp-username"
            label="SMTP username"
            value={form.smtpUsername}
            onChange={(v) => set('smtpUsername', v)}
            autoComplete="off"
          />
          <SettingField
            id="mail-smtp-password"
            label="SMTP password"
            value={form.smtpPassword}
            onChange={(v) => set('smtpPassword', v)}
            type="password"
            autoComplete="new-password"
            hint={
              settings?.smtp_password_set
                ? 'A password is saved. Leave this blank to keep it, or type a new one to replace it.'
                : 'Stored write-only — it is never shown again.'
            }
          />
        </div>
      </div>

      <button
        type="button"
        className="btn-primary self-start"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? 'Saving…' : 'Save mail settings'}
      </button>
    </div>
  );
}
