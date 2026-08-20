// The admin's application settings (migration 056) — shape, validation and the
// sentences the card states, with no React and no Supabase in sight. Written
// against `mailSettings.ts`, deliberately: two settings cards on one tab that
// behave differently is a defect in itself.
//
// ═══ WHICH OF THESE ACTUALLY DO ANYTHING ═══
//
// ONE DOES. `sessionTimeoutMinutes` is read by `SessionTimeout.tsx`, the idle
// timer that already signs a user out — it reads this instead of a constant, so
// it is real from the day it ships.
//
// THREE DO NOT, and the card says so under each of them:
//
//   * `requireApprover2fa` — THERE IS NO SECOND FACTOR IN THIS SYSTEM. Supabase
//     Auth ships TOTP and the enforcement point would be an `aal2` check inside
//     `approve_pass_level`, but none of it is built. The client asked for the
//     switch now and the enforcement later.
//     ⚠ A control labelled "Require 2FA" that silently does nothing is WORSE
//     than no control: an admin who flips it and walks away believes their
//     approvers are protected. `twoFactorNote()` is what stops that being true,
//     and it is not decoration — if it is ever removed, this field becomes a
//     lie and should be deleted rather than left quiet.
//   * `appName`, `brandColor` — saved, and not applied. The app keeps its
//     shipped identity until a later phase wires them.
//
// The same rule `mailSettings.ts` follows for its SMTP fields, and the same
// reason: a settings form that looks live but is not is worse than one that
// admits it.

/** What `gatepass.get_app_settings()` returns. */
export interface AppSettings {
  app_name: string | null;
  brand_color: string | null;
  require_approver_2fa: boolean;
  session_timeout_minutes: number | null;
  updated_at: string | null;
  updated_by_name: string | null;
}

/** Every field as the form holds it: strings, because that is what an input
 *  gives back. The timeout is parsed once, on the way out. */
export interface AppSettingsForm {
  appName: string;
  brandColor: string;
  requireApprover2fa: boolean;
  sessionTimeoutMinutes: string;
}

export type AppSettingsErrors = Partial<Record<keyof AppSettingsForm, string>>;

/** The app's own default, stated once. It is FIVE minutes because that is what
 *  `SessionTimeout.tsx` has always shipped — a gate terminal is a shared
 *  machine in a public corridor, so an abandoned session there is a bigger
 *  exposure than one at a desk. `SessionTimeout` falls back to this when the
 *  settings row is unwritten or unreadable, so the shipped behaviour and the
 *  "cleared field" behaviour are the same behaviour rather than two. */
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 5;
export const SESSION_TIMEOUT_MIN = 5;
export const SESSION_TIMEOUT_MAX = 1440;
export const APP_NAME_MAX = 40;

/** Mirrors the CHECK in 056. Kept identical on purpose — the client-side
 *  message exists so the person typing never meets a 23514. */
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export const EMPTY_APP_SETTINGS_FORM: AppSettingsForm = {
  appName: '',
  brandColor: '',
  requireApprover2fa: false,
  sessionTimeoutMinutes: '',
};

export function formFromSettings(s: AppSettings | null): AppSettingsForm {
  if (!s) return EMPTY_APP_SETTINGS_FORM;
  return {
    appName: s.app_name ?? '',
    brandColor: s.brand_color ?? '',
    requireApprover2fa: s.require_approver_2fa,
    sessionTimeoutMinutes: s.session_timeout_minutes == null ? '' : String(s.session_timeout_minutes),
  };
}

export function validateAppSettings(form: AppSettingsForm): AppSettingsErrors {
  const errors: AppSettingsErrors = {};

  const name = form.appName.trim();
  if (name.length > APP_NAME_MAX) {
    errors.appName = `Use ${APP_NAME_MAX} characters or fewer.`;
  }

  const colour = form.brandColor.trim();
  if (colour && !HEX_COLOR.test(colour)) {
    // No example colour in this sentence, deliberately: `themeAudit.test.ts`
    // bans a literal hex anywhere under src/**, and that ban is only useful
    // while it is absolute. A worked example is not worth an exemption.
    errors.brandColor = 'Use a hash followed by six hex digits.';
  }

  const timeout = form.sessionTimeoutMinutes.trim();
  if (timeout) {
    const n = Number(timeout);
    // `Number('')` is 0 and `Number('12abc')` is NaN — both have to be caught
    // here, because the input is type=number and still yields a string.
    if (!Number.isInteger(n) || n < SESSION_TIMEOUT_MIN || n > SESSION_TIMEOUT_MAX) {
      errors.sessionTimeoutMinutes = `Use a whole number of minutes between ${SESSION_TIMEOUT_MIN} and ${SESSION_TIMEOUT_MAX}.`;
    }
  }

  return errors;
}

/** The RPC's arguments. Blank becomes null — "unset" has one spelling, and the
 *  database restores its own default from it. */
export function appSettingsPayload(form: AppSettingsForm): Record<string, unknown> {
  const orNull = (s: string) => {
    const t = s.trim();
    return t === '' ? null : t;
  };
  const timeout = form.sessionTimeoutMinutes.trim();
  return {
    p_app_name: orNull(form.appName),
    p_brand_color: orNull(form.brandColor),
    p_require_approver_2fa: form.requireApprover2fa,
    p_session_timeout_minutes: timeout === '' ? null : Number(timeout),
  };
}

/** How long the idle timer should wait, in minutes. The settings row wins; an
 *  unwritten or out-of-range value falls back to the shipped default rather
 *  than to zero, which would sign everybody out immediately. */
export function sessionTimeoutOf(s: AppSettings | null): number {
  const n = s?.session_timeout_minutes;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_SESSION_TIMEOUT_MINUTES;
  if (n < SESSION_TIMEOUT_MIN || n > SESSION_TIMEOUT_MAX) return DEFAULT_SESSION_TIMEOUT_MINUTES;
  return n;
}

/** The sentence under the 2FA switch. It must always say that nothing enforces
 *  it — see this file's header. */
export function twoFactorNote(on: boolean): string {
  return on
    ? 'Saved — but NOT enforced. There is no second factor in this system yet, so approvers still sign in with a password alone. Turning this on changes nothing until it is built.'
    : 'Not enforced, and not yet possible. When it is built, approvers will register an authenticator app and be asked for a 6-digit code before each approval.';
}

/** The sentence under the branding fields. Same job as `smtpNote` in
 *  `mailSettings.ts`: admit that the field is stored and not yet used. */
export function brandingNote(): string {
  return 'Saved for later — the app still shows its own name, logo and colours. Nothing on screen changes yet.';
}
