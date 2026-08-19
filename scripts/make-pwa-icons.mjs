/* Generates the home-screen icon set in public/icons from the brand mark.
 *
 * Run by hand — it is deliberately NOT part of `npm run build`:
 *
 *     node scripts/make-pwa-icons.mjs
 *
 * Its input changes only when the brand mark does, and putting a native image
 * codec between a developer and a deployable bundle buys nothing the four
 * committed PNGs do not already give.
 *
 * IT DRAWS THE FAVICON'S OWN GEOMETRY, IT DOES NOT SCALE THE FAVICON FILE.
 * public/favicon.svg is a 32px drawing: its plate corner is `rx="6"` and the
 * mark sits at `scale(0.76)`, both chosen for a 16px browser tab. A home-screen
 * icon is read at 192px on a wallpaper, and the three variants below each need
 * DIFFERENT framing of the same mark — so the mark is one shared string and the
 * plate and the scale are arguments. Keep DIAMOND in step with favicon.svg;
 * they are one drawing rendered at two sizes, not two drawings.
 *
 * THE MASKABLE ICON IS A DIFFERENT PICTURE, NOT THE SAME ONE RESIZED. Android
 * crops it to whatever shape the launcher uses — circle, squircle, teardrop —
 * and only the centre 80% of the canvas is guaranteed to survive. So it is
 * full-bleed with the mark pulled well inside that safe circle, while the `any`
 * variant keeps its own rounded corners because nothing is going to add them.
 * iOS rounds apple-touch-icon itself and renders transparency as BLACK, so that
 * one is square, full-bleed and has no alpha channel at all.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/icons');

/** The plate, and the splash ground in the manifest. One value, written once. */
const GROUND = '#16161A';

/* The Quest Mall diamond, in the favicon's own 32-unit space. Four triangles
 * lit from the top plus a hairline, so the mark reads as a solid object rather
 * than a flat outline at 48px on a launcher. */
const DIAMOND = `
  <defs>
    <linearGradient id="lit" x1="16" y1="1" x2="16" y2="31" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#EBD9B4" />
      <stop offset="55%" stop-color="#D0AD68" />
      <stop offset="100%" stop-color="#C6A15B" />
    </linearGradient>
    <linearGradient id="shade" x1="16" y1="1" x2="16" y2="31" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#C6A15B" />
      <stop offset="100%" stop-color="#8A6C32" />
    </linearGradient>
  </defs>`;

const FACES = `
    <path d="M16 1.6 16 16 2.2 16Z" fill="url(#lit)" />
    <path d="M16 1.6 29.8 16 16 16Z" fill="url(#shade)" opacity="0.82" />
    <path d="M2.2 16 16 16 16 30.4Z" fill="url(#shade)" opacity="0.62" />
    <path d="M29.8 16 16 30.4 16 16Z" fill="url(#lit)" opacity="0.9" />
    <path d="M2.2 16H29.8" fill="none" stroke="${GROUND}" stroke-opacity="0.28" stroke-width="0.7" />
    <!-- fill="none" is load-bearing on BOTH strokes above and below. An SVG path
         with no fill attribute fills BLACK, and this one is the whole outline of
         the diamond — so without it the last path paints over all four gold faces
         and the mark renders as a black diamond with a gold edge. That is exactly
         what favicon.svg did until 2026-08-19; at 16px in a browser tab nobody
         had cause to look. -->
    <path d="M16 1.6 29.8 16 16 30.4 2.2 16Z" fill="none" stroke="#EBD9B4" stroke-opacity="0.45"
          stroke-width="0.9" stroke-linejoin="round" />`;

/**
 * @param size   pixels square
 * @param scale  the mark's size as a fraction of the 32-unit plate
 * @param radius corner radius in the same 32 units; 0 is full-bleed square
 */
function icon(size, scale, radius) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
      ${DIAMOND}
      <rect width="32" height="32" rx="${radius}" fill="${GROUND}" />
      <g transform="translate(16 16) scale(${scale}) translate(-16 -16)">${FACES}</g>
    </svg>`,
  );
}

async function write(name, svg, { opaque = false } = {}) {
  const path = resolve(OUT, name);
  // flatten() drops the alpha channel outright rather than compositing onto it;
  // that is what iOS needs, and it is wrong for the other three, which keep
  // their transparent corners.
  const pipeline = sharp(svg).png({ compressionLevel: 9 });
  await writeFile(path, await (opaque ? pipeline.flatten({ background: GROUND }) : pipeline).toBuffer());
  const { width, channels } = await sharp(path).metadata();
  console.log(`public/icons/${name}  ${width}x${width}  ${channels === 3 ? 'opaque' : 'alpha'}`);
}

await mkdir(OUT, { recursive: true });
await write('icon-192.png', icon(192, 0.82, 6));
await write('icon-512.png', icon(512, 0.82, 6));
// 0.78 keeps the diamond's corners at 0.34 of the canvas from the centre, well
// inside the 0.40 the safe circle guarantees.
await write('icon-maskable-512.png', icon(512, 0.78, 0));
await write('apple-touch-icon-180.png', icon(180, 0.82, 0), { opaque: true });
