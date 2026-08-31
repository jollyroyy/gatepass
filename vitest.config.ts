import { defineConfig } from 'vitest/config';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],

    // tests/e2e/** belongs to PLAYWRIGHT, not to vitest. Both runners name their
    // files `*.spec.ts`, and vitest's default `include` would otherwise pick up
    // the browser specs, import `@playwright/test` inside jsdom and fail the
    // gate (`npm run check`) with errors that have nothing to do with the app.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],

    // THE SUITE WAS FLAKY UNDER ITS OWN PARALLELISM, not because of anything a
    // spec asserts. Vitest defaults to one worker per logical CPU (16 here) and
    // each one stands up its own jsdom; the run's own summary showed ~600s of
    // cumulative `environment` time against ~160s of actual test time. A starved
    // worker then blows the DEFAULT 5s `testTimeout` inside a `waitFor`, so one
    // to four specs failed per run and a different set each time — every one of
    // them passing 5/5 when run alone.
    //
    // Two changes, and both are needed: fewer workers so no worker is starved,
    // and a ceiling high enough that a slow scheduling slice is not read as a
    // component that never rendered. 20s is long for a unit test and that is the
    // point — it is a DEADLOCK detector, not a performance budget. A spec that
    // genuinely hangs still fails; one that merely waited its turn does not.
    maxWorkers: '50%',
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
