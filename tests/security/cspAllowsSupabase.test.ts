// The deployed CSP must permit every Supabase origin the app actually uses.
//
// This exists because of a real production bug: `img-src 'self' data: blob:`
// blocked profile photos on Vercel while localhost worked perfectly, since the
// Vite dev server sends no CSP at all. Uploads succeeded (connect-src allowed
// the host) and the row was written, so the only symptom was a photo that never
// appeared — no error anywhere. Storage objects are served from the Supabase
// host, not from 'self'.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type VercelConfig = {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

const config = JSON.parse(
  readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8')
) as VercelConfig;

const csp = config.headers
  .flatMap((h) => h.headers)
  .find((h) => h.key === 'Content-Security-Policy')?.value;

/** The directive's source list, e.g. directive('img-src') → ["'self'", 'data:', …]. */
function directive(name: string): string[] {
  const found = (csp ?? '')
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
  if (!found) return [];
  return found.split(/\s+/).slice(1);
}

const SUPABASE_ORIGIN = 'https://oxzzeonftrmohdrancex.supabase.co';

describe('vercel.json Content-Security-Policy', () => {
  it('declares a CSP at all', () => {
    expect(csp).toBeTruthy();
  });

  it('allows images from the Supabase storage host — avatars are served from there', () => {
    expect(directive('img-src')).toContain(SUPABASE_ORIGIN);
  });

  it('still allows the local, data: and blob: image sources the app relies on', () => {
    const imgSrc = directive('img-src');
    // blob: is the camera scanner's video frame capture; data: is inline SVG.
    expect(imgSrc).toEqual(expect.arrayContaining(["'self'", 'data:', 'blob:']));
  });

  it('allows REST, RPC and realtime to the Supabase host', () => {
    const connectSrc = directive('connect-src');
    expect(connectSrc).toContain(SUPABASE_ORIGIN);
    expect(connectSrc).toContain(`wss://${SUPABASE_ORIGIN.replace('https://', '')}`);
  });

  it('does not weaken img-src to a wildcard', () => {
    expect(directive('img-src')).not.toContain('*');
  });

  // `src/index.css` opens with an `@import` of Google Fonts, which fetches a
  // stylesheet from fonts.googleapis.com and the faces themselves from
  // fonts.gstatic.com. `style-src 'self'` blocked the first and the absence of
  // `font-src` sent the second to `default-src 'self'`, so PRODUCTION rendered
  // every heading in a fallback serif while localhost — which is sent no CSP at
  // all — looked correct. Same shape of bug as the avatar one above.
  it('allows the Google Fonts stylesheet index.css imports', () => {
    expect(directive('style-src')).toContain('https://fonts.googleapis.com');
  });

  it('allows the font files that stylesheet points at', () => {
    // Declared at all: without a font-src the fetch falls back to default-src.
    expect(directive('font-src')).toContain('https://fonts.gstatic.com');
    expect(directive('font-src')).toContain("'self'");
  });
});
