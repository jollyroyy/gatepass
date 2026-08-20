// The admin's outgoing-mail settings (migration 052) — shape, validation and
// the sentences the card states, with no React and no Supabase in sight.
//
// ═══ WHAT THIS SETTING ACTUALLY DOES ═══
//
// `override_to` is a REDIRECT: when it is set, every approval letter the
// ladder sends is handed to that ONE address whatever office it was aimed at,
// and the log records both. It exists because an unverified Resend account may
// only write to the address that owns it, so the four offices' letters have to
// land in one inbox to be seen at all. Clearing it is half of the production
// switch-over (the other half is a verified sending domain).
//
// ONE ADDRESS, NEVER A LIST (client, 2026-08-20). The database says the same
// thing in a CHECK; this module says it first, so the person typing gets a
// sentence instead of a constraint violation.
//
// ═══ THE SMTP FIELDS SEND NOTHING YET ═══
//
// They are stored provision (client: "keep a provision for later-stage SMTP
// server and SMTP configuration"). The Edge Function still posts to the Resend
// API, and `smtpNote` below is what says so on the screen — a settings form
// that looks live but is not is worse than one that admits it.

export type SmtpSecurity = 'none' | 'starttls' | 'tls';

/** What `gatepass.get_mail_settings()` returns. There is deliberately no
 *  `smtp_password` — it is written and never read back, so the only fact a
 *  screen gets about it is whether one is stored. */
export interface MailSettings {
  override_to: string | null;
  from_email: string | null;
  from_name: string | null;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_security: SmtpSecurity | null;
  smtp_password_set: boolean;
  updated_at: string | null;
  updated_by_name: string | null;
}

/** Every field as the form holds it: strings, because that is what an input
 *  gives back. The port is parsed once, on the way out. */
export interface MailSettingsForm {
  overrideTo: string;
  fromEmail: string;
  fromName: string;
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpSecurity: string;
  smtpPassword: string;
}

export const SMTP_SECURITY_LABELS: Record<SmtpSecurity, string> = {
  none: 'None (port 25)',
  starttls: 'STARTTLS (usually port 587)',
  tls: 'SSL/TLS (usually port 465)',
};

/** One address: no separator, no whitespace, no angle brackets, and an @ with
 *  a dotted domain after it. The same expression the migration's CHECK uses —
 *  deliberately loose about what a domain may contain and strict about the two
 *  things that would turn this field into a list. */
const ONE_ADDRESS = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

export function isOneEmailAddress(value: string): boolean {
  return ONE_ADDRESS.test(value.trim());
}

export function formFromSettings(s: MailSettings | null): MailSettingsForm {
  return {
    overrideTo: s?.override_to ?? '',
    fromEmail: s?.from_email ?? '',
    fromName: s?.from_name ?? '',
    smtpHost: s?.smtp_host ?? '',
    smtpPort: s?.smtp_port == null ? '' : String(s.smtp_port),
    smtpUsername: s?.smtp_username ?? '',
    smtpSecurity: s?.smtp_security ?? '',
    // Never populated: the password is not returned by any read. An empty box
    // means "leave the stored one alone", which is what `mailSettingsPayload`
    // sends when nobody typed in it.
    smtpPassword: '',
  };
}

export type MailSettingsErrors = Partial<Record<keyof MailSettingsForm, string>>;

export function validateMailSettings(f: MailSettingsForm): MailSettingsErrors {
  const errors: MailSettingsErrors = {};

  if (f.overrideTo.trim() && !isOneEmailAddress(f.overrideTo)) {
    errors.overrideTo = 'Enter one email address, or leave it blank to write to each approver.';
  }
  if (f.fromEmail.trim() && !isOneEmailAddress(f.fromEmail)) {
    errors.fromEmail = 'Enter one email address.';
  }

  const port = f.smtpPort.trim();
  if (port) {
    const n = Number(port);
    if (!/^\d+$/.test(port) || !Number.isInteger(n) || n < 1 || n > 65535) {
      errors.smtpPort = 'Enter a port between 1 and 65535.';
    }
  } else if (f.smtpHost.trim()) {
    // A host with no port cannot be dialled, and guessing one for somebody is
    // how mail silently goes nowhere on the day this becomes the transport.
    errors.smtpPort = 'Enter the port this server listens on.';
  }

  return errors;
}

export interface MailSettingsPayload {
  p_override_to: string | null;
  p_from_email: string | null;
  p_from_name: string | null;
  p_smtp_host: string | null;
  p_smtp_port: number | null;
  p_smtp_username: string | null;
  p_smtp_security: string | null;
  p_smtp_password: string | null;
}

const or_null = (v: string): string | null => (v.trim() ? v.trim() : null);

/**
 * The RPC arguments.
 *
 * `passwordTouched` is what makes the write-only field survivable: a blank box
 * that was never typed in sends **null**, which the RPC reads as "leave the
 * stored password alone". Only somebody who actually cleared the box sends
 * `''`, which deletes it.
 */
export function mailSettingsPayload(f: MailSettingsForm, passwordTouched: boolean): MailSettingsPayload {
  const port = f.smtpPort.trim();
  return {
    p_override_to: or_null(f.overrideTo),
    p_from_email: or_null(f.fromEmail),
    p_from_name: or_null(f.fromName),
    p_smtp_host: or_null(f.smtpHost),
    p_smtp_port: port ? Number(port) : null,
    p_smtp_username: or_null(f.smtpUsername),
    p_smtp_security: or_null(f.smtpSecurity),
    p_smtp_password: passwordTouched ? f.smtpPassword.trim() : null,
  };
}

/** What is happening to approval mail right now, in one sentence. */
export function deliveryNote(s: MailSettings | null): string {
  const to = s?.override_to?.trim();
  return to
    ? `Every approval letter is sent to ${to}, whichever approver it names.`
    : 'Each approval letter is sent to the office holder it names.';
}

/** What the stored SMTP server is doing, which is nothing yet — and says so. */
export function smtpNote(s: MailSettings | null): string {
  const host = s?.smtp_host?.trim();
  if (!host) return 'No SMTP server is configured. Mail is sent through the Resend API.';
  const where = s?.smtp_port ? `${host}:${s.smtp_port}` : host;
  return `Saved: ${where}. It is not used for sending yet — mail still goes through the Resend API.`;
}
