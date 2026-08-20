// Migration 056 — the application settings, and the ONE thing these cases exist
// to protect: that the screen never overstates what a field does.
//
// Three of the four settings are stored provisions that enforce nothing yet.
// That is fine as long as it is said out loud, and catastrophic if it is not —
// an admin who flips "Require two-factor", sees "Saved", and walks away
// believes their approvers are protected against a stolen password. The notes
// are therefore tested like behaviour, because that is what they are.
import { describe, it, expect } from 'vitest';
import {
  appSettingsPayload,
  brandingNote,
  formFromSettings,
  sessionTimeoutOf,
  twoFactorNote,
  validateAppSettings,
  APP_NAME_MAX,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  EMPTY_APP_SETTINGS_FORM,
  SESSION_TIMEOUT_MAX,
  SESSION_TIMEOUT_MIN,
  type AppSettings,
} from '../../src/lib/appSettings';
import { IDLE_TIMEOUT_MS } from '../../src/components/SessionTimeout';

const SAVED: AppSettings = {
  app_name: 'Mall Gate Pass',
  brand_color: '#C6A15B',
  require_approver_2fa: true,
  session_timeout_minutes: 20,
  updated_at: '2026-08-20T09:00:00Z',
  updated_by_name: 'Root Admin',
};

describe('the notes are load-bearing, not decoration', () => {
  it('ALWAYS says the 2FA switch is not enforced — on as well as off', () => {
    // The dangerous state is ON: that is when an admin believes something is
    // protecting their approvers. If this ever passes with the word missing,
    // the field has become a lie and should be deleted, not quietened.
    expect(twoFactorNote(true)).toMatch(/not enforced/i);
    expect(twoFactorNote(false)).toMatch(/not enforced/i);
    expect(twoFactorNote(true)).toMatch(/no second factor/i);
  });

  it('says the branding fields change nothing on screen yet', () => {
    expect(brandingNote()).toMatch(/saved for later|nothing on screen changes/i);
  });
});

describe('validateAppSettings', () => {
  it('accepts an empty form — every field is optional', () => {
    expect(validateAppSettings(EMPTY_APP_SETTINGS_FORM)).toEqual({});
  });

  it('refuses an over-long name and a malformed colour, each under its own field', () => {
    const errors = validateAppSettings({
      ...EMPTY_APP_SETTINGS_FORM,
      appName: 'x'.repeat(APP_NAME_MAX + 1),
      brandColor: 'gold',
    });
    expect(errors.appName).toBeTruthy();
    expect(errors.brandColor).toBeTruthy();
    expect(errors.sessionTimeoutMinutes).toBeUndefined();
  });

  it('accepts a six-digit hex in either case, and refuses a three-digit one', () => {
    // The regex mirrors the CHECK in 056 exactly; a mismatch here would mean
    // the browser accepts what the database refuses.
    for (const ok of ['#C6A15B', '#c6a15b', '#000000']) {
      expect(validateAppSettings({ ...EMPTY_APP_SETTINGS_FORM, brandColor: ok })).toEqual({});
    }
    for (const bad of ['#FFF', 'C6A15B', '#GGGGGG', '#C6A15B7']) {
      expect(validateAppSettings({ ...EMPTY_APP_SETTINGS_FORM, brandColor: bad }).brandColor).toBeTruthy();
    }
  });

  it('refuses a timeout outside 5 minutes to 24 hours, and a non-integer', () => {
    for (const bad of ['0', '4', '1441', '10.5', 'soon']) {
      expect(
        validateAppSettings({ ...EMPTY_APP_SETTINGS_FORM, sessionTimeoutMinutes: bad })
          .sessionTimeoutMinutes,
      ).toBeTruthy();
    }
    for (const ok of [String(SESSION_TIMEOUT_MIN), '30', String(SESSION_TIMEOUT_MAX)]) {
      expect(validateAppSettings({ ...EMPTY_APP_SETTINGS_FORM, sessionTimeoutMinutes: ok })).toEqual({});
    }
  });
});

describe('appSettingsPayload', () => {
  it('sends null for a blank field, so "unset" has one spelling', () => {
    expect(appSettingsPayload(EMPTY_APP_SETTINGS_FORM)).toEqual({
      p_app_name: null,
      p_brand_color: null,
      p_require_approver_2fa: false,
      p_session_timeout_minutes: null,
    });
  });

  it('round-trips a saved row through the form unchanged', () => {
    expect(appSettingsPayload(formFromSettings(SAVED))).toEqual({
      p_app_name: 'Mall Gate Pass',
      p_brand_color: '#C6A15B',
      p_require_approver_2fa: true,
      p_session_timeout_minutes: 20,
    });
  });
});

describe('sessionTimeoutOf — the one setting that actually does something', () => {
  it('uses the configured value', () => {
    expect(sessionTimeoutOf(SAVED)).toBe(20);
  });

  it('falls back to the SHIPPED default, never to zero', () => {
    // A zero here would sign every user out the instant they signed in. An
    // unwritten row, an unreadable one and a nonsense one all have to land on
    // the same safe number.
    expect(sessionTimeoutOf(null)).toBe(DEFAULT_SESSION_TIMEOUT_MINUTES);
    expect(sessionTimeoutOf({ ...SAVED, session_timeout_minutes: null })).toBe(DEFAULT_SESSION_TIMEOUT_MINUTES);
    expect(sessionTimeoutOf({ ...SAVED, session_timeout_minutes: 0 })).toBe(DEFAULT_SESSION_TIMEOUT_MINUTES);
    expect(sessionTimeoutOf({ ...SAVED, session_timeout_minutes: 99999 })).toBe(DEFAULT_SESSION_TIMEOUT_MINUTES);
  });

  it('keeps the default equal to what SessionTimeout has always shipped', () => {
    // Making the timeout configurable must not quietly change it for every
    // deployment that never sets one. Five minutes, as before.
    expect(DEFAULT_SESSION_TIMEOUT_MINUTES).toBe(5);
    expect(IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });
});
