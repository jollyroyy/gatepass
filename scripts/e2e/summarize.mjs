// Compress a Playwright JSON report into a failure list a human (or an agent)
// can read without opening the HTML report.
//
// `npx playwright test --reporter=line` prints the titles of failures but not
// their messages; the HTML report has both but is 5MB of JavaScript. This is the
// middle: one line per failing test, plus the first three lines of its error.
import fs from 'node:fs';

const file = process.argv[2] ?? 'test-results/results.json';
if (!fs.existsSync(file)) {
  console.error(`No report at ${file}. Run: npx playwright test --reporter=json`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(file, 'utf8'));

const rows = [];
const walk = (suite, trail = []) => {
  const here = suite.title ? [...trail, suite.title] : trail;
  for (const spec of suite.specs ?? []) {
    for (const t of spec.tests ?? []) {
      const last = t.results?.[t.results.length - 1];
      rows.push({
        file: spec.file,
        line: spec.line,
        title: [...here, spec.title].join(' › '),
        status: t.status,          // expected | unexpected | flaky | skipped
        error: last?.error?.message ?? '',
      });
    }
  }
  for (const child of suite.suites ?? []) walk(child, here);
};
for (const s of report.suites ?? []) walk(s);

const by = (s) => rows.filter((r) => r.status === s);
const failed = by('unexpected');
const flaky = by('flaky');

console.log(`total ${rows.length}  passed ${by('expected').length}  failed ${failed.length}  flaky ${flaky.length}  skipped ${by('skipped').length}`);

const strip = (s) => s.replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 4).join('\n      ');
for (const r of failed) {
  console.log(`\nFAIL ${r.file}:${r.line}\n  ${r.title}\n      ${strip(r.error)}`);
}
for (const r of flaky) console.log(`\nFLAKY ${r.file}:${r.line}  ${r.title}`);
