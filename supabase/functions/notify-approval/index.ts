// notify-approval — tell the office whose turn it is, and NOBODY ELSE, that a
// gate pass is waiting for their decision.
//
// ONE EVENT SENDS AT MOST ONE LETTER, to the lowest still-pending office. The
// raising HOD is deliberately never written to (client, 2026-08-19: they raised
// it, so their approval is already given); see `src/lib/approvalNotice.ts`.
// The ladder is therefore driven one rung at a time: raising the pass mails
// level 1, that office approving mails level 2, and so on — each mail is sent
// by the app calling this function AFTER the RPC for the previous step has
// committed.
//
// Called by the app after `raise_pass`, `approve_pass_level` and
// `reject_pass_level` have ALREADY COMMITTED (see `src/lib/notifyApproval.ts`).
// It is deliberately downstream of the state change: the pass matters more than
// the letter, and no mail outage may ever roll one back.
//
// ═══ THE REQUEST BODY IS ONE ID, AND NOTHING ELSE IS TRUSTED ═══
//
// The caller sends `{ pass_id }`. What happened — raised, approved, rejected —
// is DERIVED here from the pass's own approval rows, so a browser cannot make
// this function tell the CEO that a pass cleared a level it did not clear. The
// recipients are derived the same way, from `routed_to` in the database, never
// from the request.
//
// ═══ TWO CLIENTS, AND BOTH ARE LOAD-BEARING ═══
//
//   * the CALLER's client — anon key carrying their JWT — asks one question:
//     "can you see this pass?" That is RLS answering, which is the authority
//     this project already trusts, so authorisation here cannot drift from
//     migration 046. Note what it means: because 046 hides an unapproved pass
//     from a guard, a guard cannot make this function mail anybody.
//   * the SERVICE client reads the payload, because the office holders' email
//     addresses are behind `approval_notice_payload`, which is granted to
//     service_role alone and to no signed-in role.
//
// The service client is never used until the caller's client has said yes.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { sendMail } from '../_shared/mailer.ts';
import { loadMailConfig } from '../_shared/mailConfig.ts';
// The `.ts` extension is required by Deno and is why `approvalNotice.ts` is
// forbidden from importing anything itself — see that file's header, and the
// test that fails if an import appears in it.
import {
  buildApprovalNotices,
  buildEmergencyNotices,
  type NoticeApproval,
  type NoticePass,
} from '../../../src/lib/approvalNotice.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  // Where the links in the letter point. Without it the mail still sends, with
  // relative-looking links that go nowhere — so it is required, loudly.
  const baseUrl = Deno.env.get('APP_BASE_URL') ?? '';

  if (!url || !anonKey || !serviceKey) return json({ error: 'Function is missing its Supabase environment.' }, 500);
  if (!baseUrl) return json({ error: 'APP_BASE_URL is not set on this function.' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Not signed in.' }, 401);

  let passId = '';
  try {
    passId = String(((await req.json()) as { pass_id?: string })?.pass_id ?? '');
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(passId)) return json({ error: 'A pass id is required.' }, 400);

  // ── 1. Is the caller allowed anywhere near this pass? RLS decides. ────────
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: visible, error: visibleErr } = await caller
    .schema('gatepass')
    .from('v_gate_passes')
    .select('id')
    .eq('id', passId)
    .maybeSingle();

  if (visibleErr) return json({ error: 'Could not check that pass.' }, 500);
  // Deliberately the same answer for "no such pass" and "not yours": this
  // endpoint must not confirm that a pass id exists to somebody who cannot read
  // it. A wrong id and a forbidden id are the same 404.
  if (!visible) return json({ error: 'No such gate pass.' }, 404);

  // ── 2. The addresses, which only the service role may read ───────────────
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: payload, error: payloadErr } = await service
    .schema('gatepass')
    .rpc('approval_notice_payload', { p_pass_id: passId });

  if (payloadErr || !payload) return json({ error: 'Could not read that pass.' }, 500);

  const raw = payload as {
    pass: Record<string, unknown> | null;
    approvals: NoticeApproval[] | null;
  };
  if (!raw.pass) return json({ error: 'No such gate pass.' }, 404);

  const p = raw.pass;
  const pass: NoticePass = {
    id: String(p.id),
    pass_number: String(p.pass_number),
    type: String(p.type),
    status: String(p.status),
    // The VENDOR is the name a reader recognises; `visitor_name` is the person
    // carrying the material, which is the fallback when no vendor was recorded.
    visitor_name: (p.vendor_name as string | null) ?? (p.visitor_name as string | null) ?? null,
    purpose: (p.purpose as string | null) ?? null,
    department_name: (p.department_name as string | null) ?? null,
    raised_by_name: (p.raised_by_name as string | null) ?? null,
    item_count: Number(p.item_count ?? 0),
    total_value: p.total_value == null ? null : Number(p.total_value),
    expected_return_date: (p.expected_return_date as string | null) ?? null,
    created_at: String(p.created_at),
  };

  // WHICH LETTER TO WRITE IS DERIVED, NEVER TOLD. The caller sends a pass id
  // and nothing else (see this file's header), so the presence of the
  // `emergency` object in the payload — which only exists because a super admin
  // actually released this pass (055) — is what selects the second kind. A
  // released pass owes nothing, so `buildApprovalNotices` would return an empty
  // array for it anyway; branching makes that explicit instead of accidental.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const emergency = (raw as any).emergency as
    | { released_name?: string | null; reason?: string | null }
    | null
    | undefined;

  const messages = emergency
    ? buildEmergencyNotices(
        pass,
        raw.approvals ?? [],
        emergency.released_name ?? null,
        emergency.reason ?? '',
        baseUrl,
      )
    : buildApprovalNotices(pass, raw.approvals ?? [], baseUrl);

  // Read ONCE per invocation, not per letter: the settings cannot change
  // half way through a send, and a second round trip per message would be a
  // round trip for nothing. Admin → Settings wins over this function's
  // secrets; an unwritten settings table leaves the secrets in charge (052).
  const mailConfig = await loadMailConfig(service);

  // ── 3. Send, and record every attempt ────────────────────────────────────
  // A loop over what is currently at most ONE message. It stays a loop because
  // the shape of `buildApprovalNotices` is "every letter this state calls for",
  // and a second kind must not need this function rewritten.
  const results: { to: string; kind: string; ok: boolean }[] = [];
  for (const m of messages) {
    const sent = await sendMail(m, mailConfig);
    results.push({ to: sent.deliveredTo, kind: m.kind, ok: sent.ok });

    // The log is best-effort and must never break the send loop: failing to
    // record a message that WAS delivered is a smaller problem than aborting
    // before the next recipient.
    const { error: logErr } = await service.schema('gatepass').from('email_log').insert({
      gate_pass_id: passId,
      kind: m.kind,
      // WHERE IT WENT, and where it was aimed when those differ. With
      // MAIL_OVERRIDE_TO set (an unverified Resend account can only write to
      // one inbox) every letter is delivered to that address, and a log saying
      // only "sent to the test inbox" could not tell the four offices' mails
      // apart afterwards.
      recipient:
        sent.deliveredTo.toLowerCase() === m.to.toLowerCase()
          ? m.to
          : `${sent.deliveredTo} (redirected from ${m.to})`,
      subject: m.subject,
      ok: sent.ok,
      provider_id: sent.providerId,
      error: sent.error,
    });
    if (logErr) console.error('[notify-approval] could not write email_log:', logErr.message);
    if (!sent.ok) console.error(`[notify-approval] send failed to ${sent.deliveredTo}: ${sent.error}`);
  }

  // 200 even when a send failed, and the body says which. The caller is a
  // fire-and-forget call behind a gate pass that is already raised; turning a
  // provider outage into an error at that call site would surface a red message
  // about an email on a screen confirming a pass.
  return json({ pass_id: passId, sent: results.filter((r) => r.ok).length, results });
});
