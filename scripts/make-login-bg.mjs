// Turns the raw Quest Mall night-aerial photo into the login page background
// (public/login-bg.jpg): cropped so the lit gold-and-blue facade survives on
// the right two-thirds (a white sign-in card sits dead centre over the login
// form, so the composition must not depend on the middle of the frame), then
// given an HDR / tone-mapped look.
//
// The "HDR" read comes mostly from local contrast, not saturation: a heavily
// blurred, inverted copy of the image is composited back over the original
// with 'soft-light' blending. That lifts shadow detail and holds highlights
// the way real tone-mapping does, instead of just cranking global contrast
// (which would blow out the facade's blue/gold lighting).
//
// Re-run after replacing the source photo, or after tuning the constants below:
//
//   node scripts/make-login-bg.mjs      (or: npm run build:login-bg)
//
// SOURCE and OUTPUT are absolute paths so this is safe to run from anywhere.
// OUTPUT must stay under 900 KB (it's served to every visitor on every page
// load of the login screen) — if a source photo change pushes it over, this
// script steps JPEG quality down automatically and reports what it settled on.
import sharp from 'sharp';
import { statSync } from 'node:fs';

const SOURCE = 'C:\\Users\\ASUS\\Downloads\\quest_mall_image.jpg';
const OUTPUT = 'C:\\Users\\ASUS\\Desktop\\gatepass\\public\\login-bg.jpg';

// Final output size: 16:10, cropped from the right so the faceted, lit facade
// (right side of the source) is retained on the right two-thirds instead of
// landing under the centred login card, while the dark building on the left
// gets cropped away rather than kept at equal weight.
//
// NOTE on why this isn't a single resize() call: the source photo is only
// 1887x765 (a wide ~2.47:1 crop, not a high-res original). A single
// `.resize({width: 2560, height: 1600, fit: 'cover', position: 'right',
// withoutEnlargement: true})` needs to upscale ~2.1x to cover height 1600
// before it can crop — `withoutEnlargement` blocks that upscale entirely, so
// sharp silently falls back to returning the source untouched (no crop, no
// resize, wrong aspect ratio). That failure mode is worse than a modest
// upscale, so instead: (1) crop to the 16:10 region at the source's native
// resolution — no upscale needed for this step, since we crop width, not
// height — then (2) upscale that crop once, deliberately, with a
// quality-preserving kernel, to a real-world final size.
const OUT_WIDTH = 1920;
const OUT_HEIGHT = 1200;

// In the actual source photo (1887x765), the dark building occupies roughly
// the left 48% (x=0..~900) and the lit faceted facade roughly the middle
// (x=~900..~1650), with only a sliver of street-level signage/tower after
// that before the frame edge at x=1887. A plain `position: 'right'` crop
// takes the rightmost window (offset = srcWidth - cropWidth), which was
// verified visually to land the facade dead-centre in the output — the
// building/facade transition point ended up left-of-centre, not at centre.
// CROP_LEFT_FRACTION is the left edge of the crop window, as a fraction of
// source width, tuned so the building/facade transition sits at the crop's
// horizontal centre instead: everything left of centre reads as the calmer
// dark building, everything right of centre is the facade — satisfying
// "must not be dead-centre, ideally reads on the right two-thirds" without
// cropping off so much of the facade's right edge (tower + video screens)
// that it looks truncated.
const CROP_LEFT_FRACTION = 0.153;

const MAX_BYTES = 900 * 1024;
const QUALITY_STEPS = [86, 82, 78, 74, 70];

async function render(quality) {
  const meta = await sharp(SOURCE).metadata();
  console.log(`Source: ${meta.width}x${meta.height}`);

  const targetAspect = OUT_WIDTH / OUT_HEIGHT;
  const cropHeight = meta.height;
  const cropWidth = Math.round(cropHeight * targetAspect);
  const cropLeft = Math.max(0, Math.min(meta.width - cropWidth, Math.round(meta.width * CROP_LEFT_FRACTION)));

  // Crop-only pass via extract(): a custom left offset, not sharp's built-in
  // position:'right', because the built-in "rightmost window" placement put
  // the facade dead-centre (see CROP_LEFT_FRACTION comment above). Full
  // source height, so this is a pure horizontal crop — no upscale here.
  const croppedBuffer = await sharp(SOURCE)
    .extract({ left: cropLeft, top: 0, width: cropWidth, height: cropHeight })
    .toBuffer();

  const croppedMeta = await sharp(croppedBuffer).metadata();
  console.log(`Cropped (native res): ${croppedMeta.width}x${croppedMeta.height}`);

  // Deliberate upscale to the final publish size, with a quality kernel.
  const baseBuffer = await sharp(croppedBuffer)
    .resize({ width: OUT_WIDTH, height: OUT_HEIGHT, fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .toBuffer();

  const baseMeta = await sharp(baseBuffer).metadata();
  console.log(`Upscaled to final: ${baseMeta.width}x${baseMeta.height}`);

  // Local-contrast overlay: blur + negate, composited back with soft-light.
  const overlay = await sharp(baseBuffer)
    .blur(50)
    .negate({ alpha: false })
    .toBuffer();

  const out = await sharp(baseBuffer)
    .composite([{ input: overlay, blend: 'soft-light' }])
    .modulate({ saturation: 1.22, brightness: 1.03 })
    .linear(1.12, -12)
    .sharpen({ sigma: 1.0 })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toBuffer();

  return out;
}

let chosenQuality = null;
let finalBuffer = null;

for (const quality of QUALITY_STEPS) {
  const buf = await render(quality);
  console.log(`quality=${quality} -> ${(buf.length / 1024).toFixed(1)} KB`);
  if (buf.length <= MAX_BYTES) {
    chosenQuality = quality;
    finalBuffer = buf;
    break;
  }
}

if (!finalBuffer) {
  console.error(`Could not get under ${MAX_BYTES / 1024} KB even at quality=${QUALITY_STEPS.at(-1)}. Not writing output.`);
  process.exit(1);
}

const { writeFileSync } = await import('node:fs');
writeFileSync(OUTPUT, finalBuffer);
const finalStat = statSync(OUTPUT);
console.log(`Wrote ${OUTPUT}`);
console.log(`Final: quality=${chosenQuality}, ${(finalStat.size / 1024).toFixed(1)} KB`);
