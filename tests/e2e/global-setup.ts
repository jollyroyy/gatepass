import { execFileSync as run } from 'node:child_process';

/**
 * Setup output goes to STDERR, never stdout.
 *
 * `npx playwright test --reporter=json` writes the report to STDOUT, and a
 * single `console.log` from global setup lands above it — so the file is no
 * longer JSON and every downstream reader fails to parse it, twice in this
 * campaign before anyone noticed.
 */
const say = (m: string): void => { process.stderr.write(`${m}
`); };
const execFileSync = (cmd: string, args: string[]): void => {
  process.stderr.write(run(cmd, args, { encoding: 'utf8' }));
};

/**
 * Provision the e2e cast before any spec runs.
 *
 * Seeding is idempotent and cheap, and running it every time is what makes the
 * suite runnable from a cold checkout. It also EVICTS the four sitting approval
 * office holders (a seat is a singleton, 049) — `npm run e2e:restore` puts them
 * back from the snapshot it takes.
 */
export default function globalSetup(): void {
  if (process.env.E2E_SKIP_SEED === '1') {
    say('[e2e] E2E_SKIP_SEED=1 — using the cast as it stands');
  } else {
    execFileSync(process.execPath, ['scripts/e2e/seed.mjs']);
  }

  // ALWAYS, seeding skipped or not. An approval office is a singleton seat and
  // anything else touching this shared project can take one back mid-campaign —
  // it happened, and the symptom was fifty-two tests failing on "sign in as
  // secHead" with nothing pointing at the cause.
  execFileSync(process.execPath, ['scripts/e2e/ensure-ladder.mjs']);
}
