import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  /** vite.config.ts's `define`, which this standalone config does not inherit. */
  define: { __APP_RELEASE__: JSON.stringify('test') },
  resolve: {
    /** `@/tests` first: aliases match in order, and `@` would resolve `@/tests/…` into src/. */
    alias: [
      { find: '@/tests', replacement: path.resolve(import.meta.dirname, './tests') },
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    /**
     * Explicit, because Vitest's default glob would also collect the e2e
     * `*.test.ts` files and run Playwright specs under jsdom.
     */
    include: ['tests/**/*.test.{ts,tsx}'],
    // Node's BroadcastChannel crosses worker_threads, so 'threads' lets test files hear each other.
    pool: 'forks',
    /**
     * Headroom over Vitest's 5s default: each test file gets its own worker and
     * jsdom, and on a cold CI machine a file that renders the whole route tree
     * can spend most of 5s before its first assertion. It must stay well above
     * `asyncUtilTimeout` in tests/setup.ts, which bounds `findBy*`/`waitFor`.
     * There is no `retry`: it would hide a race from the report, not fix it.
     */
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      /**
       * Excludes the generated route tree, the mount-only entry, the dev-only
       * devtools and the vendored shadcn files, by name: form.tsx and sonner.tsx
       * in ui/ are ours and measured.
       */
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/components/dev/devtools.tsx',
        'src/components/ui/{alert-dialog,avatar,badge,breadcrumb,button,card,combobox,dialog,dropdown-menu}.tsx',
        'src/components/ui/{input,input-group,label,select,separator,sheet,sidebar,skeleton,switch}.tsx',
        'src/components/ui/{table,tabs,textarea,tooltip}.tsx',
      ],
      /** About seven points under the measured baseline, so a drop fails CI. */
      thresholds: { statements: 88, branches: 82, functions: 86, lines: 89 },
    },
  },
})
