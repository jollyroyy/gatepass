// HOW EVERY LETTER LOOKS, and the handful of formatters it needs. No decision
// about WHO is written to lives here — that is `noticeLadder.ts` and the
// builders above it.
//
// The formatters are written out rather than imported from `formatCurrency.ts`
// and `formatDate.ts` because those modules reach the app's types and its
// Supabase client, which Deno cannot load. `approvalNotice.test.ts` asserts the
// duplicated money format still matches the module it was copied from — the
// duplication is contained and checked, which is the trade for a letter that
// one runtime can render and the other can test.
import type { Cta, NoticePass, NoticeRoleKey } from './noticeTypes.ts';
import { NOTICE_ROLE_TITLES } from './noticeTypes.ts';

/** `formatCurrency`'s rule, restated: exact rupees, Indian grouping, never a
 *  `₹3.1K` abbreviation. The test asserts it still matches that module. */
export function noticeCurrency(n: number): string {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

/** `15 Aug 2026`. A date only — an email is read hours later and a clock time
 *  in it is noise. Returns '' for anything unparseable rather than 'Invalid
 *  Date', which is the one string that must never reach a printed subject. */
export function noticeDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Minimal HTML escaping. Every value below is user-typed — a vendor name, a
 *  rejection reason — and lands inside an HTML mail body. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function titleOf(key: NoticeRoleKey): string {
  return NOTICE_ROLE_TITLES[key] ?? key;
}

/** `https://host` + path, with exactly one slash between them. A trailing slash
 *  on the configured base URL is the likeliest configuration slip, and must not
 *  produce a `//approvals` link that some mail clients mangle. */
export function joinUrl(base: string, path: string): string {
  const b = (base || '').replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

// ─── The facts every mail repeats ───────────────────────────────────────────

/** The pass, as label/value pairs. ONE list, so the plain-text and the HTML
 *  halves of a message cannot describe the pass differently. A fact this pass
 *  does not carry is omitted rather than printed with an em dash — an empty row
 *  in an email is noise a reader has to decode. */
export function passFacts(pass: NoticePass): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [
    { label: 'Gate Pass No.', value: pass.pass_number },
    { label: 'Type', value: pass.type },
  ];
  if (pass.raised_by_name) facts.push({ label: 'Requested By', value: pass.raised_by_name });
  if (pass.department_name) facts.push({ label: 'Department', value: pass.department_name });
  if (pass.visitor_name) facts.push({ label: 'Vendor / Person', value: pass.visitor_name });
  facts.push({ label: 'Items', value: String(pass.item_count) });
  if (pass.total_value != null && pass.total_value > 0) {
    facts.push({ label: 'Total Value', value: noticeCurrency(pass.total_value) });
  }
  if (pass.purpose) facts.push({ label: 'Purpose', value: pass.purpose });
  if (pass.expected_return_date) {
    facts.push({ label: 'Expected Return Date', value: noticeDate(pass.expected_return_date) });
  }
  const raised = noticeDate(pass.created_at);
  if (raised) facts.push({ label: 'Raised On', value: raised });
  return facts;
}

function factsText(pass: NoticePass): string {
  return passFacts(pass)
    .map((f) => `  ${f.label}: ${f.value}`)
    .join('\n');
}

function factsHtml(pass: NoticePass): string {
  const rows = passFacts(pass)
    .map(
      (f) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#555;">${escapeHtml(f.label)}</td>` +
        `<td style="padding:4px 0;color:#111;font-weight:600;">${escapeHtml(f.value)}</td></tr>`
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">${rows}</table>`;
}

/**
 * THE DECISION LINKS THAT GO IN THE LETTER (client, 2026-08-20: "make sure …
 * it gives this Approve or Reject button in the email approval emails for easy
 * visibility of all the approvers. Once it is clicked on any of those links, it
 * should directly open up the portal or it should open up the PWA application
 * if done from mobile … of course it will ask for the username and password").
 *
 * ⚠ NEITHER LINK DECIDES ANYTHING BY BEING FETCHED, and that is deliberate.
 * A link in an email is a GET, and GETs are prefetched: Outlook Safe Links and
 * every other scanner opens a URL before its reader ever does, so a URL that
 * approved a pass would approve passes nobody had read. These open the RECORD,
 * with `?decide=` naming which button was pressed; the app signs the reader in,
 * shows them the whole pass, and offers the decision on screen. The signature
 * is still `approve_pass_level` / `reject_pass_level` under their own JWT, and
 * a rejection still needs the written reason the modal asks for.
 *
 * They are ordinary in-app paths, so on a phone with the PWA installed the
 * scope match hands them to the installed app rather than to the browser; and
 * `postLoginRedirect.ts` is what carries the destination across the sign-in.
 */
export function decisionLinks(baseUrl: string, passId: string): Cta[] {
  const record = joinUrl(baseUrl, `/pass/${passId}`);
  return [
    { href: `${record}?decide=approve`, label: 'Approve', kind: 'primary' },
    { href: `${record}?decide=reject`, label: 'Reject', kind: 'secondary' },
  ];
}

/** The one link every letter that asks for nothing carries: the record. */
export function recordLink(baseUrl: string, passId: string, label = 'Open the gate pass'): Cta[] {
  return [{ href: joinUrl(baseUrl, `/pass/${passId}`), label, kind: 'plain' }];
}

/** The house wrapper. Black on white with no colour-dependent information — the
 *  same rule the printed slip follows, and for the same reason: this is read on
 *  whatever client the reader has, including one that strips styles entirely. */
export function wrapHtml(
  heading: string,
  lead: string,
  pass: NoticePass,
  ctas: Cta[],
  tail: string
): string {
  const buttons = ctas.filter((c) => c.kind !== 'plain');
  // Each button is its own inline-block anchor with its own margin — no float
  // and no flexbox, neither of which Outlook renders, and a decision an
  // approver cannot press is the whole letter wasted.
  const row = buttons.length
    ? `<p style="margin:24px 0;">` +
      buttons
        .map((c) =>
          c.kind === 'secondary'
            ? `<a href="${escapeHtml(c.href)}" style="border:2px solid #16161A;color:#16161A;` +
              `padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;` +
              `display:inline-block;margin:0 8px 8px 0;">${escapeHtml(c.label)}</a>`
            : `<a href="${escapeHtml(c.href)}" style="background:#16161A;color:#ffffff;` +
              `padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;` +
              `display:inline-block;margin:0 8px 8px 0;">${escapeHtml(c.label)}</a>`
        )
        .join('') +
      `</p>`
    : '';
  // EVERY LINK IS ALSO PRINTED AS A BARE URL. A mail client that strips anchors
  // is not unusual, and this is the one letter whose whole purpose is a press.
  const fallback = ctas.length
    ? `<p style="font-size:12px;color:#666;margin:0 0 16px;">If a button does not work, open:<br>` +
      ctas
        .map(
          (c) =>
            `${escapeHtml(c.label)}: <a href="${escapeHtml(c.href)}" style="color:#2B3FA0;">` +
            `${escapeHtml(c.href)}</a>`
        )
        .join('<br>') +
      `</p>`
    : '';
  const button = row + fallback;
  return (
    `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">` +
    `<h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(heading)}</h1>` +
    `<p style="font-size:15px;line-height:1.5;margin:0 0 20px;">${escapeHtml(lead)}</p>` +
    factsHtml(pass) +
    button +
    (tail ? `<p style="font-size:13px;color:#555;line-height:1.5;">${escapeHtml(tail)}</p>` : '') +
    `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px;">` +
    `<p style="font-size:12px;color:#888;margin:0;">Quest GatePass — material gate pass control. ` +
    `This message was sent automatically; replies are not monitored.</p>` +
    `</div>`
  );
}

export function wrapText(
  heading: string,
  lead: string,
  pass: NoticePass,
  ctas: Cta[],
  tail: string
): string {
  return (
    `${heading}\n\n${lead}\n\n${factsText(pass)}\n` +
    (ctas.length ? `\n${ctas.map((c) => `${c.label}: ${c.href}`).join('\n')}\n` : '') +
    (tail ? `\n${tail}\n` : '') +
    `\n--\nQuest GatePass. This message was sent automatically; replies are not monitored.\n`
  );
}
