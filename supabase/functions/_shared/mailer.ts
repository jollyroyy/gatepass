// THE ONE PLACE THIS PROJECT TALKS TO A MAIL PROVIDER.
//
// Everything above it — who to write to, what the letter says — is decided in
// `src/lib/approvalNotice.ts` and is provider-agnostic. This file is the swap
// point, and it is small on purpose: moving to a corporate SMTP relay means
// rewriting `sendMail` and nothing else.
//
// ═══ WHY NOT SUPABASE'S OWN SENDER ═══
//
// Because it cannot do this at all. The built-in sender is capped at roughly
// TWO EMAILS PER HOUR PROJECT-WIDE — a cap shared with the VMS system on this
// same project — and it only sends GoTrue's own auth templates. There is no API
// for "send this arbitrary message". A gate pass ladder that mails four offices
// would exhaust an hour's quota on one pass and take VMS's password resets down
// with it. This is the same limit that made password reset admin-assisted in
// this app; see the deployment notes.
//
// ═══ RESEND, AND WHAT IT COSTS ═══
//
// Free tier: 3,000 messages a month, 100 a day, which is far above what a
// single mall's gate passes generate. No card required.
//
// FOR A CORPORATE DEPLOYMENT YOU MUST VERIFY YOUR OWN DOMAIN — add the SPF and
// DKIM records Resend prints, then set MAIL_FROM to an address at that domain
// (e.g. "Quest GatePass <gatepass@yourcompany.com>"). Until you do, Resend
// permits sending ONLY from `onboarding@resend.dev` and ONLY to the address
// that owns the Resend account. That restriction is the single most common
// reason a first test "sends successfully" and reaches nobody, so `sendMail`
// reports the provider's own refusal text verbatim rather than a tidy summary.

import type { MailConfig } from './mailConfig.ts';

export interface OutgoingMail {
  to: string;
  toName: string | null;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  ok: boolean;
  /** The address the provider was actually handed. Equal to `mail.to` unless
   *  MAIL_OVERRIDE_TO is set, in which case it is that address — the log must
   *  record where the letter WENT, not where it was aimed. */
  deliveredTo: string;
  /** The provider's id for an accepted message — what you quote when asking
   *  them where it went. */
  providerId: string | null;
  /** The provider's refusal, verbatim. Null when it accepted. */
  error: string | null;
}

/** `Name <address>` when a name is known, a bare address otherwise. A display
 *  name containing a quote or an angle bracket is stripped rather than escaped:
 *  a malformed header is rejected by the provider for the whole message, and a
 *  slightly plainer name is a far better outcome than an undelivered letter. */
export function addressOf(email: string, name: string | null): string {
  const clean = (name ?? '').replace(/["<>\r\n,;]/g, '').trim();
  return clean ? `${clean} <${email}>` : email;
}

/**
 * Send one message. Never throws — a mail failure must not become a 500 that
 * the browser reports to an HOD whose gate pass was raised perfectly.
 */
export async function sendMail(mail: OutgoingMail, config: MailConfig): Promise<SendResult> {
  const key = config.apiKey;
  const from = config.from;
  // ═══ MAIL_OVERRIDE_TO — EVERY LETTER GOES TO ONE INBOX ═══
  //
  // Set on this deployment because the Resend account is unverified: it may
  // send ONLY to the address that owns it, so a mail addressed to the real COO
  // is refused by the provider and the ladder looks broken for a reason that
  // has nothing to do with this app. With the override set, the four offices'
  // letters all land in that one inbox, one per approval step, each naming its
  // office in the subject line.
  //
  // IT IS A SETTING, NOT A CONSTANT, and that is the point: verifying a domain
  // and clearing it is the entire production switch-over. Since 052 it is
  // edited in Admin → Settings and falls back to the MAIL_OVERRIDE_TO secret;
  // `loadMailConfig` owns that precedence, and nothing in the repo names the
  // test inbox.
  //
  // The caller still knows who the letter was AIMED at (`mail.to`) and writes
  // both into `email_log`, so the log never claims the CEO was written to
  // directly when the letter went somewhere else.
  const overrideTo = config.overrideTo ?? '';

  if (!key || !from) {
    return {
      ok: false,
      deliveredTo: overrideTo || mail.to,
      providerId: null,
      error:
        'No mail sender is configured: RESEND_API_KEY must be set on this function, ' +
        'and a sender address must be set either in Admin → Settings or as the MAIL_FROM secret.',
    };
  }

  const deliveredTo = overrideTo || mail.to;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        // When the override is set the display name is dropped: labelling
        // somebody else's inbox with the CEO's name is how a test mail gets
        // mistaken for a real one.
        to: [overrideTo ? overrideTo : addressOf(mail.to, mail.toName)],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { ok: false, deliveredTo, providerId: null, error: `${res.status} ${body}`.slice(0, 1000) };
    }
    let providerId: string | null = null;
    try {
      providerId = (JSON.parse(body) as { id?: string }).id ?? null;
    } catch {
      /* Accepted with a body we could not parse. The send still happened. */
    }
    return { ok: true, deliveredTo, providerId, error: null };
  } catch (e) {
    return { ok: false, deliveredTo, providerId: null, error: String(e).slice(0, 1000) };
  }
}
