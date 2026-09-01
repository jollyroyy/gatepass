// WHERE THE SENDER'S SETTINGS COME FROM — the database first, this function's
// secrets second.
//
// Migration 052 put the settings in `gatepass.mail_settings`, editable by an
// admin, because changing the inbox every approval letter is redirected to
// used to mean `supabase secrets set` and a redeploy (client, 2026-08-20).
//
// ═══ PRECEDENCE, AND WHY IT IS THIS WAY ROUND ═══
//
//   a non-null value in the table  >  the environment variable  >  a built-in
//
// An EMPTY table therefore changes nothing: this function behaves exactly as
// it did before 052. That is the safe direction — a migration must not be able
// to silently redirect or stop live mail, and a deployment whose admin has
// never opened the Settings tab must keep working.
//
// ═══ THERE IS NO THIRD TIER FOR THE SENDER (2026-09-01) ═══
//
// The previous provider granted every account a shared sender address, so the
// From line could fall back to it when neither the table nor MAIL_FROM named
// one. That existed so clearing a bad sender could not turn "undo my mistake"
// into a second outage.
//
// BREVO GRANTS NO SUCH ADDRESS. Every sender it will send from is one you
// individually verified or a domain you authenticated by DNS, so any constant
// this file invented would be refused by the provider on every message — a
// silent outage dressed up as a safe default. So the tier is gone, and
// `sendMail` answers a missing sender with the sentence that names both places
// it can be set. There is, as before, NO tier for the recipient: guessing who
// a letter is for is not a safe default, and a null override already has a
// correct meaning (write to the office holder named on it).
//
// `mail_config()` is granted to `service_role` alone: it returns the stored
// SMTP password, which no signed-in role may read. It is read with the SERVICE
// client, after the caller's own client has already said they may see the pass.
//
// ═══ THE SMTP FIELDS ARE NOT A TRANSPORT YET ═══
//
// They are carried here so the sender can see them, and `sendMail` still posts
// to the Brevo API regardless. When an SMTP sender is written, this is the
// object it reads and the rule is "a host is configured, so dial it". Brevo's
// own relay (`smtp-relay.brevo.com:587`) is one such host, so this is also the
// path to Brevo without the HTTP API — it is not written because the API needs
// no socket and returns a `messageId` the log can quote.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export interface MailConfig {
  /** Brevo API key. Only ever from the environment — a provider credential
   *  does not belong in a table a `postgres` connection can read, and `psql`
   *  connects to this database as `postgres`. */
  apiKey: string | null;
  /** `Name <address>` as the provider wants it. */
  from: string | null;
  /** Redirect every letter here, whoever it names. Null = write to each
   *  approver's own address. */
  overrideTo: string | null;
  /** THE STANDING COPY LIST (078). Up to five addresses an admin typed in
   *  Admin -> Settings, copied on EVERY letter — raised, awaiting approval,
   *  approved, rejected, and both gate outcomes (client, 2026-09-01: "all
   *  those emails should be receiving the notifications about the gate pass
   *  raising and all those status changes ... gate pass creations and
   *  approvals").
   *
   *  These people are NOT participants: they hold no office and several have
   *  no login, which is exactly why deriving recipients from the pass could
   *  never reach them. Empty array = nobody, and that is the default.
   *
   *  Suppressed with every other copy when `overrideTo` is set — a redirected
   *  test letter must not reach a live watcher. */
  notifyCc: string[];
  /** Stored provision. Nothing sends through these yet. */
  smtp: {
    host: string | null;
    port: number | null;
    username: string | null;
    password: string | null;
    security: string | null;
  };
}

const text = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
};

/** `notify_cc` as the database sends it — a jsonb array — read defensively.
 *  A function deployed against a database that has not yet run 078 gets no key
 *  at all and must copy nobody, not throw: the ladder's mail matters more than
 *  the watch list. Blanks are dropped rather than posted to the provider as an
 *  empty recipient, which Brevo rejects for the WHOLE message. */
const addressList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x.length > 0)
    : [];

/** `Name <address>` when a sender name is stored, the bare address otherwise.
 *  A stored sender wins over MAIL_FROM whole — mixing the table's name with
 *  the environment's address would produce a From line nobody configured. */
function fromLine(row: Record<string, unknown>, envFrom: string | null): string | null {
  const email = text(row.from_email);
  // NO INVENTED FALLBACK — see the header. Null here means "nobody has
  // configured a sender", which `sendMail` reports as a refusal naming both
  // places one can be set, rather than posting a From line Brevo will bounce.
  if (!email) return envFrom;
  const name = text(row.from_name);
  // Same stripping rule as `addressOf`: a display name carrying a quote or an
  // angle bracket gets the whole message rejected by the provider.
  const clean = (name ?? '').replace(/["<>\r\n,;]/g, '').trim();
  return clean ? `${clean} <${email}>` : email;
}

/**
 * Read the settings. Never throws: a settings table that cannot be read must
 * degrade to the environment this function has always had, not to an outage on
 * a gate pass that is already raised.
 */
export async function loadMailConfig(service: SupabaseClient): Promise<MailConfig> {
  const envFrom = text(Deno.env.get('MAIL_FROM'));
  const envOverride = text(Deno.env.get('MAIL_OVERRIDE_TO'));
  // BREVO_API_KEY, and nothing else. A fallback read of the previous
  // provider's key was kept for a few hours on 2026-09-01 so the swap would not
  // be a flag day; it is gone now that the secret is set, because a credential
  // this function no longer knows how to use is not a fallback — it is a dead
  // read that makes "which provider is this deployment on?" unanswerable.
  const apiKey = text(Deno.env.get('BREVO_API_KEY'));

  let row: Record<string, unknown> = {};
  try {
    const { data, error } = await service.schema('gatepass').rpc('mail_config');
    if (error) console.error('[notify-approval] could not read mail_config:', error.message);
    else if (data && typeof data === 'object') row = data as Record<string, unknown>;
  } catch (e) {
    console.error('[notify-approval] could not read mail_config:', String(e));
  }

  return {
    apiKey,
    from: fromLine(row, envFrom),
    overrideTo: text(row.override_to) ?? envOverride,
    notifyCc: addressList(row.notify_cc),
    smtp: {
      host: text(row.smtp_host),
      port: typeof row.smtp_port === 'number' ? row.smtp_port : null,
      username: text(row.smtp_username),
      password: text(row.smtp_password),
      security: text(row.smtp_security),
    },
  };
}
