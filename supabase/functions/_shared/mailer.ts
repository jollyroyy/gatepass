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

export interface OutgoingMail {
  to: string;
  toName: string | null;
  subject: string;
  text: string;
  html: string;
}

export interface SendResult {
  ok: boolean;
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
export async function sendMail(mail: OutgoingMail): Promise<SendResult> {
  const key = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('MAIL_FROM');

  if (!key || !from) {
    return {
      ok: false,
      providerId: null,
      error:
        'RESEND_API_KEY or MAIL_FROM is not set on this function. ' +
        'Run: supabase secrets set RESEND_API_KEY=... MAIL_FROM="Quest GatePass <gatepass@yourdomain.com>"',
    };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [addressOf(mail.to, mail.toName)],
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { ok: false, providerId: null, error: `${res.status} ${body}`.slice(0, 1000) };
    }
    let providerId: string | null = null;
    try {
      providerId = (JSON.parse(body) as { id?: string }).id ?? null;
    } catch {
      /* Accepted with a body we could not parse. The send still happened. */
    }
    return { ok: true, providerId, error: null };
  } catch (e) {
    return { ok: false, providerId: null, error: String(e).slice(0, 1000) };
  }
}
