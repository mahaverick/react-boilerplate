import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    // Vitest's own default is 5s, and this suite spawns ONE WORKER PER TEST
    // FILE — dozens of them — at roughly 870ms of spawn + jsdom environment
    // each; the runner prints both figures on every run, so read them there
    // rather than from a number written here that rots the next time a test
    // file is added. On a cold CI machine, where
    // nothing is warm and the workers contend, a file that renders the whole
    // route tree can spend most of a 5s budget before its first assertion.
    // 20s is not a licence for a slow test; it is headroom so a test fails
    // for its own reasons rather than for the runner's.
    //
    // It does NOT govern `findBy*`/`waitFor`, which have a separate 1s budget
    // of their own — see `asyncUtilTimeout` in src/tests/setup.ts, which is
    // the half that was actually producing the intermittent failures. Both
    // are needed, and this one must stay comfortably the larger.
    // Vitest's default `include` is `**/*.{test,spec}.?(c|m)[jt]s?(x)`, which
    // would collect `e2e/**/*.test.ts` and run Playwright specs under jsdom.
    // The e2e suite is `pnpm test:e2e`; these two runners share a filename
    // convention and must not share files.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    testTimeout: 20_000,
    // Deliberately NOT `retry`. A retry would have made the observed failures
    // disappear from the report while leaving the race in place, and the next
    // thing it hid would be a real one.
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
})
