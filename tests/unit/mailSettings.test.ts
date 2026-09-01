// The admin's mail settings, decided in one pure module (052).
//
// Client, 2026-08-20: the approval mail currently lands in one inbox because
// the provider will only write to one; an admin must be able to change WHICH
// inbox, ONE AT A TIME, and the SMTP server fields must exist for later.
import { describe, it, expect } from 'vitest';
import {
  formFromSettings,
  validateMailSettings,
  mailSettingsPayload,
  deliveryNote,
  smtpNote,
  type MailSettings,
  type MailSettingsForm,
} from '../../src/lib/mailSettings';

function settings(over: Partial<MailSettings> = {}): MailSettings {
  return {
    override_to: null, from_email: null, from_name: null,
    smtp_host: null, smtp_port: null, smtp_username: null, smtp_security: null,
    smtp_password_set: false, updated_at: null, updated_by_name: null,
    ...over,
  };
}

function form(over: Partial<MailSettingsForm> = {}): MailSettingsForm {
  return { ...formFromSettings(null), ...over };
}

describe('reading the settings back onto a form', () => {
  it('turns every null into an empty field, so an unwritten table renders', () => {
    expect(formFromSettings(null)).toEqual({
      overrideTo: '', fromEmail: '', fromName: '',
      smtpHost: '', smtpPort: '', smtpUsername: '', smtpSecurity: '', smtpPassword: '',
      // Four blank rows for the standing copy list (078) — the number the
      // client asked to be able to configure, offered up front so adding one
      // needs no button.
      notifyCc: ['', '', '', ''],
    });
  });

  it('carries the stored values, and never a password (it is not returned)', () => {
    const f = formFromSettings(settings({
      override_to: 'test@example.com', smtp_host: 'smtp.office365.com', smtp_port: 587,
      smtp_security: 'starttls', smtp_password_set: true,
    }));
    expect(f.overrideTo).toBe('test@example.com');
    expect(f.smtpPort).toBe('587');
    expect(f.smtpSecurity).toBe('starttls');
    expect(f.smtpPassword).toBe('');
  });
});

describe('one address at a time', () => {
  it('accepts a single address', () => {
    expect(validateMailSettings(form({ overrideTo: 'someone@example.com' }))).toEqual({});
  });

  it('accepts a blank one — that means no redirect at all', () => {
    expect(validateMailSettings(form({ overrideTo: '   ' }))).toEqual({});
  });

  it.each([
    'a@example.com, b@example.com',
    'a@example.com; b@example.com',
    'Someone <a@example.com>',
    'a@example.com b@example.com',
    'not-an-address',
  ])('refuses %s', (bad) => {
    expect(validateMailSettings(form({ overrideTo: bad })).overrideTo).toBeTruthy();
  });

  it('refuses a sender address that is not one address either', () => {
    expect(validateMailSettings(form({ fromEmail: 'a@x.com, b@x.com' })).fromEmail).toBeTruthy();
  });
});

describe('the SMTP fields', () => {
  it('are optional together — none of them is an error', () => {
    expect(validateMailSettings(form())).toEqual({});
  });

  it('need a port once a host is named, because a host alone cannot be dialled', () => {
    expect(validateMailSettings(form({ smtpHost: 'smtp.example.com' })).smtpPort).toBeTruthy();
  });

  it('refuse a port that is not a port', () => {
    expect(validateMailSettings(form({ smtpHost: 'smtp.example.com', smtpPort: '0' })).smtpPort)
      .toBeTruthy();
    expect(validateMailSettings(form({ smtpHost: 'smtp.example.com', smtpPort: '70000' })).smtpPort)
      .toBeTruthy();
    expect(validateMailSettings(form({ smtpHost: 'smtp.example.com', smtpPort: '25.5' })).smtpPort)
      .toBeTruthy();
  });

  it('accept a whole host, port and security together', () => {
    expect(validateMailSettings(form({
      smtpHost: 'smtp.example.com', smtpPort: '587', smtpSecurity: 'starttls',
      smtpUsername: 'gatepass', smtpPassword: 'hunter2',
    }))).toEqual({});
  });
});

describe('the payload sent to set_mail_settings', () => {
  it('sends null for every blank, so clearing a field really clears it', () => {
    expect(mailSettingsPayload(form({ overrideTo: '  ' }), true)).toEqual({
      p_override_to: null, p_from_email: null, p_from_name: null,
      p_smtp_host: null, p_smtp_port: null, p_smtp_username: null,
      p_smtp_security: null, p_smtp_password: '',
      // Blank rows are dropped on the way out, so an untouched form stores an
      // empty list rather than four empty strings the CHECK would refuse.
      p_notify_cc: [],
    });
  });

  it('omits the password entirely when the field was not touched', () => {
    // Null means "leave the stored one alone" server-side. A form that always
    // sent '' would silently delete a working credential on every save.
    expect(mailSettingsPayload(form({ smtpHost: 'smtp.example.com', smtpPort: '587' }), false))
      .toMatchObject({ p_smtp_host: 'smtp.example.com', p_smtp_port: 587, p_smtp_password: null });
  });

  it('sends a typed password when it was', () => {
    expect(mailSettingsPayload(form({ smtpPassword: 'hunter2' }), true).p_smtp_password)
      .toBe('hunter2');
  });

  it('trims what it sends', () => {
    expect(mailSettingsPayload(form({ overrideTo: ' who@example.com ' }), false).p_override_to)
      .toBe('who@example.com');
  });
});

describe('what the card says is happening', () => {
  it('names the one inbox everything is redirected to', () => {
    expect(deliveryNote(settings({ override_to: 'test@example.com' })))
      .toContain('test@example.com');
  });

  it('says letters reach the real office holders when nothing is set', () => {
    const note = deliveryNote(settings());
    expect(note).toMatch(/office holder/i);
    expect(note).not.toMatch(/redirect/i);
  });

  it('says the SMTP server is saved but not sending yet', () => {
    expect(smtpNote(settings({ smtp_host: 'smtp.example.com', smtp_port: 587 })))
      .toMatch(/not.*(used|sending)/i);
  });

  it('says nothing is configured when no host is stored', () => {
    expect(smtpNote(settings())).toMatch(/no smtp server/i);
  });
});
