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
// THE THIRD TIER IS NEW (2026-08-23) AND APPLIES TO THE SENDER ONLY. If
// neither the table nor MAIL_FROM names a sender, the From line falls back to
// `onboarding@resend.dev` — the shared address Resend grants every account
// before it has verified a domain of its own. Without this tier, clearing a
// bad sender address left the field null and `sendMail` refused to send at
// all ("No mail sender is configured"), which turns "undo my mistake" into a
// second outage. There is deliberately NO equivalent tier for the recipient:
// guessing who a letter is for is not a safe default, and a null override
// already has a correct meaning (write to the office holder named on it).
//
// `mail_config()` is granted to `service_role` alone: it returns the stored
// SMTP password, which no signed-in role may read. It is read with the SERVICE
// client, after the caller's own client has already said they may see the pass.
//
// ═══ THE SMTP FIELDS ARE NOT A TRANSPORT YET ═══
//
// They are carried here so the sender can see them, and `sendMail` still posts
// to the Resend API regardless. When an SMTP sender is written, this is the
// object it reads and the rule is "a host is configured, so dial it".
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export interface MailConfig {
  /** Resend API key. Only ever from the environment — a provider credential
   *  does not belong in a table a `postgres` connection can read. */
  apiKey: string | null;
  /** `Name <address>` as the provider wants it. */
  from: string | null;
  /** Redirect every letter here, whoever it names. Null = write to each
   *  approver's own address. */
  overrideTo: string | null;
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

/** Resend's shared sender, available to every account with no DNS setup at
 *  all. It is the last resort, never a preference: mail from it is far more
 *  likely to be filtered than mail from a verified corporate domain, and while
 *  an account is unverified Resend will only DELIVER it to the address that
 *  owns the account. It exists here so that "no sender configured" is never a
 *  state this function can be left in. */
export const FALLBACK_FROM = 'Quest GatePass <onboarding@resend.dev>';

/** `Name <address>` when a sender name is stored, the bare address otherwise.
 *  A stored sender wins over MAIL_FROM whole — mixing the table's name with
 *  the environment's address would produce a From line nobody configured. */
function fromLine(row: Record<string, unknown>, envFrom: string | null): string | null {
  const email = text(row.from_email);
  if (!email) return envFrom ?? FALLBACK_FROM;
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
  const apiKey = text(Deno.env.get('RESEND_API_KEY'));

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
    smtp: {
      host: text(row.smtp_host),
      port: typeof row.smtp_port === 'number' ? row.smtp_port : null,
      username: text(row.smtp_username),
      password: text(row.smtp_password),
      security: text(row.smtp_security),
    },
  };
}
