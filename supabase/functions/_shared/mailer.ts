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
// ═══ BREVO, AND WHAT IT COSTS (verified 2026-09-01) ═══
//
// `POST https://api.brevo.com/v3/smtp/email`, authenticated by an `api-key`
// HEADER — not a Bearer token, which is the single easiest thing to get wrong
// when porting from another provider. It answers `201 { messageId }`.
//
// Free tier: 300 messages a DAY, shared between marketing and transactional
// sends. A single mall's gate passes are far below that; a deployment that
// starts sending campaigns from the same Brevo account is not, so the shared
// daily cap is worth knowing before somebody adds one. No card required.
//
// FOR A CORPORATE DEPLOYMENT YOU MUST AUTHENTICATE YOUR OWN DOMAIN — add the
// DKIM, DMARC and Brevo-code DNS records Brevo prints under Senders, Domains &
// Dedicated IPs, then set the sender to an address at that domain. Until you
// do, Brevo sends only from an individually verified sender address and the
// mail is far more likely to be filtered. That is the single most common reason
// a first test "sends successfully" and reaches nobody, so `sendMail` reports
// the provider's own refusal text verbatim rather than a tidy summary.

import type { MailConfig } from './mailConfig.ts';

export interface OutgoingMail {
  to: string;
  toName: string | null;
  /** EVERYBODY ELSE WHO IS TOLD, and who can see that they were told. Copies
   *  are visible on purpose: a gate pass is an internal control document, and
   *  an approver who cannot see that the raiser was written to as well has to
   *  ask. Deduplicated against `to` by the notice builders, never here. */
  cc?: { email: string; name: string | null }[];
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

/** Brevo caps a display name at 70 characters and rejects the whole message
 *  when one is longer, so the name is trimmed here rather than at every call
 *  site. Same stripping rule as `addressOf`, for the same reason. */
export function cleanName(name: string): string {
  return name.replace(/["<>\r\n,;]/g, '').trim().slice(0, 70);
}

/** Brevo wants the sender SPLIT — `{ email, name }` — where every other
 *  provider this project has used took one `Name <address>` string, which is
 *  the form `mail_settings` stores and `MAIL_FROM` carries. Parsing here rather
 *  than changing the stored shape keeps the settings table and the admin screen
 *  provider-agnostic, which is the whole point of this file being the swap
 *  point.
 *
 *  A string with no angle brackets is a bare address, because that is exactly
 *  what `fromLine` produces when no sender NAME is configured. */
export function parseSender(from: string): { email: string; name?: string } {
  const m = /^\s*(.*?)\s*<\s*([^>]+?)\s*>\s*$/.exec(from);
  if (!m) return { email: from.trim() };
  const name = cleanName(m[1].replace(/^["']|["']$/g, ''));
  return name ? { email: m[2], name } : { email: m[2] };
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
  // A testing valve, for an account whose sending domain is not authenticated
  // yet: with it set, every office's letter lands in that one inbox, one per
  // approval step, each naming its office in the subject line.
  //
  // IT IS A SETTING, NOT A CONSTANT, and that is the point: authenticating a
  // domain and CLEARING THIS FIELD is the entire production switch-over. Since
  // 052 it is edited in Admin → Settings and falls back to the
  // MAIL_OVERRIDE_TO secret; `loadMailConfig` owns that precedence, and nothing
  // in the repo names the test inbox.
  //
  // ⚠ IT SUPPRESSES THE COPIES TOO. Redirecting the `to` while still copying
  // the real approvers would deliver a test letter to live office holders,
  // which is the exact accident this valve exists to prevent.
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
        'No mail sender is configured: BREVO_API_KEY must be set on this function, ' +
        'and a sender address must be set either in Admin → Settings or as the MAIL_FROM secret.',
    };
  }

  const deliveredTo = overrideTo || mail.to;
  const cc = overrideTo ? [] : (mail.cc ?? []);

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        // A HEADER NAMED `api-key`, not `Authorization: Bearer`. Brevo answers
        // a Bearer token with a 401 whose message does not say why.
        'api-key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: parseSender(from),
        // When the override is set the display name is dropped: labelling
        // somebody else's inbox with the CEO's name is how a test mail gets
        // mistaken for a real one.
        to: [
          overrideTo
            ? { email: overrideTo }
            : { email: mail.to, ...(mail.toName ? { name: cleanName(mail.toName) } : {}) },
        ],
        ...(cc.length
          ? {
              cc: cc.map((c) => ({
                email: c.email,
                ...(c.name ? { name: cleanName(c.name) } : {}),
              })),
            }
          : {}),
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { ok: false, deliveredTo, providerId: null, error: `${res.status} ${body}`.slice(0, 1000) };
    }
    let providerId: string | null = null;
    try {
      providerId = (JSON.parse(body) as { messageId?: string }).messageId ?? null;
    } catch {
      /* Accepted with a body we could not parse. The send still happened. */
    }
    return { ok: true, deliveredTo, providerId, error: null };
  } catch (e) {
    return { ok: false, deliveredTo, providerId: null, error: String(e).slice(0, 1000) };
  }
}
