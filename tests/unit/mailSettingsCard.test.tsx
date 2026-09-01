// Admin → Settings → Approval email (052).
//
// Client, 2026-08-20: the letters currently all go to one inbox and an admin
// must be able to change WHICH ONE, one address at a time, with the SMTP
// server fields there for later.
//
// Pins: the stored redirect is shown and is editable, a list of addresses is
// refused before any RPC is made, the password is never rendered back, an
// untouched password box does not clear the stored one, and the SMTP block
// says out loud that it does not send anything yet.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  senderDomainWarning,
  validateMailSettings,
  explainSendError,
  senderNote,
  type MailSettingsForm,
} from '../../src/lib/mailSettings';

/* eslint-disable @typescript-eslint/no-explicit-any */
function thenable(result: { data: unknown; error: unknown }) {
  const obj: any = {
    then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, err),
  };
  return obj;
}

let stored: Record<string, unknown>;
let rpc: ReturnType<typeof vi.fn>;
let lastSend: Record<string, unknown>[];

// `email_log` is read through the query builder, not an RPC: one row, newest
// first (047 + 050, admin-select).
function logBuilder() {
  const o: any = {};
  for (const m of ['select', 'order', 'limit']) o[m] = () => o;
  o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data: lastSend, error: null }).then(ok, err);
  return o;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    rpc: (...args: unknown[]) => (rpc as any)(...args),
    from: () => logBuilder(),
  }),
}));

const { default: MailSettingsCard } = await import('../../src/pages/Admin/MailSettingsCard');

beforeEach(() => {
  stored = {
    override_to: 'someone@example.com', from_email: null, from_name: null,
    smtp_host: null, smtp_port: null, smtp_username: null, smtp_security: null,
    smtp_password_set: true, updated_at: '2026-08-20T05:00:00Z', updated_by_name: 'Alice Admin',
    notify_cc: [],
  };
  rpc = vi.fn((name: string) => thenable({ data: stored, error: null }));
  lastSend = [];
});

async function renderCard() {
  render(<MailSettingsCard />);
  await waitFor(() => expect(screen.getByLabelText(/send all approval mail to/i)).toBeInTheDocument());
}

describe('the approval mail settings card', () => {
  it('shows the inbox every letter currently goes to, and lets it be edited', async () => {
    await renderCard();
    const box = screen.getByLabelText(/send all approval mail to/i) as HTMLInputElement;
    expect(box.value).toBe('someone@example.com');
    // TWO places name it since 078: `deliveryNote` at the top, and the copy
    // list's own note, which has to say that the standing copies are suppressed
    // while everything is redirected here. Both are correct, so this asserts
    // the sentence that was always the point rather than uniqueness.
    expect(screen.getByText(/Every approval letter is sent to someone@example\.com/))
      .toBeInTheDocument();
    expect(box.readOnly).toBe(false);
  });

  it('saves one new address, and only that', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText(/send all approval mail to/i), {
      target: { value: 'other@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_mail_settings', expect.anything()));
    const args = rpc.mock.calls.find((c) => c[0] === 'set_mail_settings')![1] as any;
    expect(args.p_override_to).toBe('other@example.com');
    // The box was never typed in, so the stored SMTP password must be left
    // exactly where it is — null, not ''.
    expect(args.p_smtp_password).toBeNull();
  });

  it('refuses a list of addresses without ever calling the RPC', async () => {
    await renderCard();
    fireEvent.change(screen.getByLabelText(/send all approval mail to/i), {
      target: { value: 'a@example.com, b@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/one email address/i);
    expect(rpc.mock.calls.filter((c) => c[0] === 'set_mail_settings')).toHaveLength(0);
  });

  it('never renders a stored password back, and says one is set', async () => {
    await renderCard();
    const pw = screen.getByLabelText(/smtp password/i) as HTMLInputElement;
    expect(pw.value).toBe('');
    expect(pw.type).toBe('password');
    expect(screen.getByText(/password is saved/i)).toBeInTheDocument();
  });

  it('says the SMTP server does not send anything yet', async () => {
    stored = { ...stored, smtp_host: 'smtp.example.com', smtp_port: 587 };
    await renderCard();
    expect(screen.getByText(/not used for sending yet/i)).toBeInTheDocument();
  });

  // The provider is the only thing that knows whether a changed address can
  // actually be written to — an unverified account refuses every
  // address but the one that owns it, and that refusal used to be visible
  // nowhere but `email_log`.
  it('shows the last send attempt, and the provider s refusal verbatim', async () => {
    lastSend = [{
      recipient: 'someone@example.com (redirected from coo@demo.vms)',
      subject: 'Approval needed by COO',
      ok: false,
      error: '403 You can only send testing emails to your own email address.',
      created_at: '2026-08-20T04:20:00Z',
    }];
    await renderCard();
    expect(screen.getByText(/redirected from coo@demo\.vms/)).toBeInTheDocument();
    expect(screen.getByText(/only send testing emails/i)).toBeInTheDocument();
  });

  it('surfaces an RPC refusal instead of pretending it saved', async () => {
    await renderCard();
    rpc = vi.fn((name: string) =>
      name === 'set_mail_settings'
        ? thenable({ data: null, error: { message: 'Only an admin can change the mail settings.' } })
        : thenable({ data: stored, error: null }));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await screen.findByText(/only an admin can change the mail settings/i);
  });
});

// ═══ THE 2026-08-22 OUTAGE, PINNED ═══
//
// A gmail.com address was saved as the SENDER and every approval letter since
// was refused with "The gmail.com domain is not verified". Nothing in the form
// objected, and the only symptom was an empty inbox. These are the regression.
// ═══ REWRITTEN 2026-09-01, WHEN THE PROVIDER CHANGED ═══
//
// These cases used to assert that a consumer mailbox as SENDER was a hard
// validation error that blocked Save. That was right for the previous provider,
// which answered such a sender with a flat 403 and delivered nothing.
//
// Brevo does not refuse it: free webmail domains cannot be authenticated, so it
// REWRITES the sending domain to a provider-owned one and delivers anyway
// (verified 2026-09-01 by sending a real message from a gmail.com sender —
// accepted, 201). Blocking a configuration that demonstrably delivers is the
// bigger error, so the rule moved from `validateMailSettings` to
// `senderDomainWarning`: a sentence on the screen, not a locked button.
//
// WHAT MUST NOT COME BACK is silence. The rewrite is invisible from inside this
// app and costs deliverability, so the warning has to name the domain and say
// what it costs.
describe('a consumer mailbox as SENDER warns, and no longer blocks', () => {
  const blank: MailSettingsForm = {
    overrideTo: '', fromEmail: '', fromName: '', smtpHost: '',
    smtpPort: '', smtpUsername: '', smtpSecurity: '', smtpPassword: '',
    notifyCc: [],
  };

  it('warns about a consumer mailbox, naming the domain and the cost', () => {
    const warning = senderDomainWarning('jitubhi89@gmail.com');
    expect(warning).toBeTruthy();
    expect(warning).toContain('gmail.com');
    expect(warning).toMatch(/rewritten|rewrite/i);
    expect(warning).toMatch(/spam|filtered/i);
  });

  it('warns about the other common ones too', () => {
    for (const addr of ['a@outlook.com', 'b@yahoo.com', 'c@hotmail.com', 'd@icloud.com']) {
      expect(senderDomainWarning(addr)).toBeTruthy();
    }
  });

  it('does NOT block the save — the mail still gets delivered', () => {
    expect(validateMailSettings({ ...blank, fromEmail: 'jitubhi89@gmail.com' }).fromEmail)
      .toBeUndefined();
  });

  it('says nothing about a corporate address — this app cannot know which domains are authenticated', () => {
    expect(senderDomainWarning('gatepass@questmall.in')).toBeNull();
    expect(validateMailSettings({ ...blank, fromEmail: 'gatepass@questmall.in' }).fromEmail)
      .toBeUndefined();
  });

  it('says nothing about a blank sender', () => {
    expect(senderDomainWarning('')).toBeNull();
    expect(validateMailSettings(blank).fromEmail).toBeUndefined();
  });

  it('still refuses something that is not an address at all', () => {
    expect(validateMailSettings({ ...blank, fromEmail: 'not-an-address' }).fromEmail)
      .toBe('Enter one email address.');
  });

  // A RECIPIENT may be a gmail address, and always could be. Only the sender is
  // constrained, and confusing the two is the whole reason the original bug
  // took a day to find.
  it('leaves a consumer address alone as the redirect recipient', () => {
    expect(validateMailSettings({ ...blank, overrideTo: 'sohampatra866@gmail.com' }).overrideTo)
      .toBeUndefined();
  });
});

describe('explainSendError tells the two 403s apart', () => {
  it('reads a refused sender as a sender problem', () => {
    const msg = explainSendError(
      '403 {"statusCode":403,"message":"The gmail.com domain is not verified."}'
    );
    expect(msg).toContain('Sender address');
  });

  it('reads a refused recipient as an unverified-account problem', () => {
    const msg = explainSendError(
      '403 You can only send testing emails to your own email address.'
    );
    expect(msg).toMatch(/authenticat/i);
    expect(msg).toContain('sender is fine');
  });

  it('adds nothing it does not recognise, and nothing to a success', () => {
    expect(explainSendError('500 upstream exploded')).toBeNull();
    expect(explainSendError(null)).toBeNull();
  });
});

describe('senderNote names what is actually sending', () => {
  it('names a configured sender', () => {
    expect(senderNote({ from_email: 'gatepass@questmall.in' } as never))
      .toContain('gatepass@questmall.in');
  });

  it('explains that blank is the shared sender, not "no mail"', () => {
    const note = senderNote(null);
    expect(note).toContain('shared address');
    expect(note).toContain('owns the account');
  });
});
