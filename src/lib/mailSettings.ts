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

// ═══ THE SENDER ADDRESS IS THE ONE THAT STOPS ALL MAIL ═══
//
// On 2026-08-22 somebody set the sender address to a gmail.com address, and
// every approval letter since was refused by the provider with
//
//   403 The gmail.com domain is not verified. Please, add and verify your
//       domain on https://resend.com/domains
//
// That reads like a problem with the RECIPIENT and is not: a mail provider
// will only send FROM a domain whose DNS you control and have proved you
// control. Nobody can send from gmail.com through Resend — not the owner of
// the gmail account, not anyone. The field was accepted, saved, and silently
// broke every letter, and the only symptom was an inbox that stayed empty.
//
// So the check lives here, in front of the person typing, and NOT in a
// database CHECK: "is one address" is a permanent truth about the field and
// belongs in both places, but "is not gmail.com" is PROVIDER POLICY. It
// changes, and a constraint would need a migration to undo on the day this
// deployment verifies a real domain.
const PUBLIC_MAILBOX_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'ymail.com',
  'hotmail.com', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com',
  'rediffmail.com', 'zoho.com', 'mail.com', 'gmx.com', 'yandex.com',
]);

export function domainOf(email: string): string {
  return email.trim().split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Why this address cannot be a sender, or null if it can be.
 *
 * Only free consumer mailboxes are refused, and only as SENDERS. They are the
 * whole of the mistake this guards against — an address somebody owns and
 * reasonably assumes they may therefore send from. A corporate domain is
 * allowed through even when it is unverified, because this app cannot know
 * which domains the account has verified and refusing one it has would be the
 * worse error.
 */
export function senderDomainProblem(email: string): string | null {
  const domain = domainOf(email);
  if (!domain || !PUBLIC_MAILBOX_DOMAINS.has(domain)) return null;
  return (
    `Mail cannot be sent FROM ${domain} — a provider only sends from a domain ` +
    `you have verified, so this address is refused for everybody. Use an address ` +
    `at your own verified domain, or leave this blank to use the provider's ` +
    `shared sender.`
  );
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
  } else if (f.fromEmail.trim()) {
    // Only reached when the address is well-formed: "that is not an address"
    // and "that address cannot send" are different sentences and the first
    // one has to come first.
    const problem = senderDomainProblem(f.fromEmail);
    if (problem) errors.fromEmail = problem;
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

/** Which sender is actually in force, named. Blank does not mean "no mail" —
 *  it means the provider's shared sender — and a field that reads empty while
 *  something is quietly working is exactly how the 2026-08-22 outage was
 *  mistaken for a recipient problem. */
export function senderNote(s: MailSettings | null): string {
  const from = s?.from_email?.trim();
  return from
    ? `Letters are sent from ${from}. Its domain must be verified with the mail provider.`
    : 'Letters are sent from the provider\'s shared address. While the mail account is unverified, ' +
      'that address can only DELIVER to the address that owns the account — verify a domain to ' +
      'reach anyone else.';
}

/**
 * The provider's refusal, translated — without hiding it.
 *
 * The two 403s this system can produce look almost identical and mean opposite
 * things, and telling them apart is the entire diagnosis:
 *
 *   "domain is not verified"          → the SENDER address is wrong. Nobody
 *                                       gets mail. Fix the sender field.
 *   "can only send testing emails to" → the sender is fine; the account is
 *                                       unverified, so the RECIPIENT must be
 *                                       the account owner. Verify a domain.
 *
 * Returns null when there is nothing to add, in which case the caller shows
 * the provider's own text alone.
 */
export function explainSendError(error: string | null): string | null {
  if (!error) return null;
  const e = error.toLowerCase();
  if (e.includes('not verified') && e.includes('domain')) {
    return (
      'The Sender address below is on a domain the mail provider has not verified, so it ' +
      'refuses every letter — whoever they are addressed to. Clear the Sender address to fall ' +
      'back to the provider\'s shared sender, or set one at a domain you have verified.'
    );
  }
  if (e.includes('can only send testing emails') || e.includes('own email address')) {
    return (
      'The sender is fine — the mail account is unverified, so the provider will only deliver ' +
      'to the address that owns it. Verify a domain at resend.com/domains and set a Sender ' +
      'address at that domain to reach any other recipient.'
    );
  }
  return null;
}

/** What the stored SMTP server is doing, which is nothing yet — and says so. */
export function smtpNote(s: MailSettings | null): string {
  const host = s?.smtp_host?.trim();
  if (!host) return 'No SMTP server is configured. Mail is sent through the Resend API.';
  const where = s?.smtp_port ? `${host}:${s.smtp_port}` : host;
  return `Saved: ${where}. It is not used for sending yet — mail still goes through the Resend API.`;
}
