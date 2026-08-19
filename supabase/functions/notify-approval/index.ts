// notify-approval — tell the office whose turn it is that a gate pass is
// waiting, and copy the HOD who raised it.
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
// The `.ts` extension is required by Deno and is why `approvalNotice.ts` is
// forbidden from importing anything itself — see that file's header, and the
// test that fails if an import appears in it.
import {
  buildApprovalNotices,
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

  const messages = buildApprovalNotices(
    pass,
    raw.approvals ?? [],
    { email: (p.raised_by_email as string | null) ?? null, name: pass.raised_by_name },
    baseUrl,
  );

  // ── 3. Send, and record every attempt ────────────────────────────────────
  // Sequential, not Promise.all: at most two messages come out of one event,
  // and a provider rate limit hit by parallel calls costs a delivery for no
  // measurable gain.
  const results: { to: string; kind: string; ok: boolean }[] = [];
  for (const m of messages) {
    const sent = await sendMail(m);
    results.push({ to: m.to, kind: m.kind, ok: sent.ok });

    // The log is best-effort and must never break the send loop: failing to
    // record a message that WAS delivered is a smaller problem than aborting
    // before the next recipient.
    const { error: logErr } = await service.schema('gatepass').from('email_log').insert({
      gate_pass_id: passId,
      kind: m.kind,
      recipient: m.to,
      subject: m.subject,
      ok: sent.ok,
      provider_id: sent.providerId,
      error: sent.error,
    });
    if (logErr) console.error('[notify-approval] could not write email_log:', logErr.message);
    if (!sent.ok) console.error(`[notify-approval] send failed to ${m.to}: ${sent.error}`);
  }

  // 200 even when a send failed, and the body says which. The caller is a
  // fire-and-forget call behind a gate pass that is already raised; turning a
  // provider outage into an error at that call site would surface a red message
  // about an email on a screen confirming a pass.
  return json({ pass_id: passId, sent: results.filter((r) => r.ok).length, results });
});
