// The admin's outgoing-mail settings (migration 052) — shape, validation and
// the sentences the card states, with no React and no Supabase in sight.
//
// ═══ WHAT THIS SETTING ACTUALLY DOES ═══
//
// `override_to` is a REDIRECT: when it is set, every approval letter the
// ladder sends is handed to that ONE address whatever office it was aimed at,
// and the log records both. It is a testing valve: before a sending domain is
// authenticated, the offices' letters land in one inbox to be seen at all.
// Clearing it is half of the production switch-over (the other half is an
// authenticated sending domain).
//
// ONE ADDRESS, NEVER A LIST (client, 2026-08-20). The database says the same
// thing in a CHECK; this module says it first, so the person typing gets a
// sentence instead of a constraint violation.
//
// ═══ THE SMTP FIELDS SEND NOTHING YET ═══
//
// They are stored provision (client: "keep a provision for later-stage SMTP
// server and SMTP configuration"). The Edge Function posts to the Brevo HTTP
// API, and `smtpNote` below is what says so on the screen — a settings form
// that looks live but is not is worse than one that admits it.

import { copyListPayload, copyRowsFrom, validateCopyList } from './mailRecipients';

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
  /** The standing copy list (078). Always an array — `get_mail_settings`
   *  returns `[]` for a settings row that has never been written, so "nobody"
   *  and "unwritten" are the same value here on purpose. */
  notify_cc: string[];
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
  /** Fixed-length rows, blanks included, so clearing row 2 does not renumber
   *  rows 3 and 4 under the person's cursor. See `mailRecipients.ts`. */
  notifyCc: string[];
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

// ═══ THE SENDER ADDRESS IS THE ONE THAT DECIDES WHERE MAIL LANDS ═══
//
// On 2026-08-22 somebody set the sender to a gmail.com address and every
// letter after it was refused outright, with a message naming the DOMAIN and
// reading like a problem with the recipient. It is not: a mail provider will
// only send FROM a domain whose DNS you control and have proved you control.
// The field was accepted, saved, and silently broke every letter, and the only
// symptom was an inbox that stayed empty.
//
// The current provider is gentler and therefore sneakier — it accepts a free
// mailbox as sender and rewrites the sending domain rather than refusing — so
// the same mistake now costs deliverability instead of everything. That is why
// the list below survives as a WARNING; see `senderDomainWarning`.
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
 * What is WRONG with this sender address, or null if nothing is.
 *
 * ═══ A WARNING SINCE 2026-09-01, NOT A REFUSAL, AND THE PROVIDER IS WHY ═══
 *
 * The previous provider made this block the save: it answered a gmail.com
 * sender with a flat `403 … domain is not verified` and every letter died. That
 * was the right call for that provider.
 *
 * Brevo does not refuse. Free webmail domains cannot be AUTHENTICATED with it —
 * that part is unchanged and is why this warning still exists — but rather than
 * rejecting the message Brevo silently REWRITES the sending domain to
 * `@brevosend.com` and delivers it. Verified 2026-09-01 by sending one.
 *
 * So the cost changed shape: mail still arrives, but it arrives from a domain
 * nobody at this company owns, which is worse for trust and much worse for
 * spam filtering — and it is invisible from inside the app. Blocking a
 * configuration that demonstrably delivers would be the bigger error, so this
 * is now a sentence on the screen and not a locked Save button.
 *
 * Only free consumer mailboxes are named. A corporate domain is left alone even
 * when unverified, because this app cannot know which domains the account has
 * authenticated and refusing one it has would be the worse error.
 */
export function senderDomainWarning(email: string): string | null {
  const domain = domainOf(email);
  if (!domain || !PUBLIC_MAILBOX_DOMAINS.has(domain)) return null;
  return (
    `${domain} cannot be authenticated with the mail provider, so letters will ` +
    `be delivered with the sender rewritten to a provider-owned domain ` +
    `(@brevosend.com). They will still arrive, but they will look like they came ` +
    `from a stranger and are far more likely to be filtered as spam. Use an ` +
    `address at a domain you have authenticated as soon as you have one.`
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
    notifyCc: copyRowsFrom(s?.notify_cc),
  };
}

export type MailSettingsErrors = Partial<Record<keyof MailSettingsForm, string>> & {
  /** One message per wrong ROW of the copy list, keyed by index (078). A
   *  single string could not say WHICH of four addresses is the duplicate. */
  notifyCcRows?: Record<number, string>;
};

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
    // ⚠ NOT AN ERROR ANY MORE — see `senderDomainWarning`. The previous
    // provider refused a free-mailbox sender outright and had to block the save;
    // Brevo accepts it and rewrites the sending domain instead, so blocking it
    // would now refuse a configuration that demonstrably delivers.
  }

  const rows = validateCopyList(f.notifyCc);
  if (Object.keys(rows).length > 0) errors.notifyCcRows = rows;

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
  p_notify_cc: string[];
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
    // ALWAYS SENT, never null. Null means "leave the stored list alone" to the
    // RPC, which is the right default for a caller that does not know about
    // the field — but this form always shows it, so an untouched empty form
    // genuinely means "copy nobody" and must be able to say so.
    p_notify_cc: copyListPayload(f.notifyCc),
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
      'to the address that owns it. Authenticate a sending domain with the mail provider and set ' +
      'a Sender address at that domain to reach any other recipient.'
    );
  }
  // Brevo names the sender rather than the domain when the From address is not
  // one it will send from. Different words, same fix as the branch above.
  if (e.includes('sender') && (e.includes('not valid') || e.includes('not found'))) {
    return (
      'The Sender address below is not one the mail provider will send from. Add and verify it ' +
      'under Senders in the provider, or set a Sender address at a domain you have authenticated.'
    );
  }
  return null;
}

/** What the stored SMTP server is doing, which is nothing yet — and says so. */
export function smtpNote(s: MailSettings | null): string {
  const host = s?.smtp_host?.trim();
  if (!host) return 'No SMTP server is configured. Mail is sent through the Brevo API.';
  const where = s?.smtp_port ? `${host}:${s.smtp_port}` : host;
  return `Saved: ${where}. It is not used for sending yet — mail still goes through the Brevo API.`;
}
