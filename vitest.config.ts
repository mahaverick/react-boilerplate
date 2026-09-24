import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // `@/tests` first: an alias list matches in order, and `@` would otherwise
    // claim `@/tests/mocks/server` and resolve it into src/.
    alias: [
      { find: '@/tests', replacement: path.resolve(import.meta.dirname, './tests') },
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
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
    // of their own — see `asyncUtilTimeout` in tests/setup.ts, which is
    // the half that was actually producing the intermittent failures. Both
    // are needed, and this one must stay comfortably the larger.
    // Every Vitest test lives under tests/ — none in src/, which eslint
    // enforces. Explicit rather than Vitest's default `**/*.{test,spec}.*`,
    // which would also collect `e2e/**/*.test.ts` and run Playwright specs
    // under jsdom: the two runners share a filename convention and must not
    // share files.
    include: ['tests/**/*.test.{ts,tsx}'],
    // Node's BroadcastChannel crosses worker_threads, so 'threads' lets test files hear each other.
    pool: 'forks',
    testTimeout: 20_000,
    // Deliberately NOT `retry`. A retry would have made the observed failures
    // disappear from the report while leaving the race in place, and the next
    // thing it hid would be a real one.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Excludes the generated route tree, the mount-only entry and vendored shadcn.
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/routeTree.gen.ts', 'src/main.tsx', 'src/components/ui/**'],
      // A few points under the measured baseline, so a drop fails CI.
      thresholds: { statements: 88, branches: 82, functions: 86, lines: 89 },
    },
  },
})
