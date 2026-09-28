import js from '@eslint/js'
import tanstackRouter from '@tanstack/eslint-plugin-router'
import prettier from 'eslint-config-prettier'
import checkFile from 'eslint-plugin-check-file'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tailwindcss from 'eslint-plugin-tailwindcss'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { commentStyleRule } from './scripts/comment-style.mjs'

const SLEEP_MESSAGE =
  'Wait on a condition, not a duration: findBy*/waitFor/vi.waitFor, expect.poll or a web-first assertion in e2e, fake timers, or settle(ms, reason) from @/tests/fixtures/timing (e2e: ./timing) when nothing can be observed.'
const NETWORKIDLE_MESSAGE =
  "networkidle waits on every request the page makes, including ones this test does not care about. Assert what the page renders (a heading's toBeVisible) or wait for the one response that matters."

export default tseslint.config(
  {
    ignores: [
      'dist',
      'src/routeTree.gen.ts',
      'coverage',
      'public/mockServiceWorker.js',
      'test-results',
      'playwright-report',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  tailwindcss.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**'],
    settings: { tailwindcss: { cssConfigPath: './src/styles/globals.css' } },
    rules: { 'tailwindcss/classnames-order': 'off' },
  },
  {
    /**
     * Root-level configs get no type information (only the src/, tests/ and e2e/
     * blocks set typed parser options), so typed rules throw on them: they are
     * linted syntactically only, and listed by name so this block never covers
     * a file under src/. The tailwind rules are off because the plugin's own
     * `files` glob matches them, and without `cssConfigPath` (scoped to src/)
     * it falls back to 'src/style.css' and throws ENOENT.
     */
    files: [
      'eslint.config.js',
      'prettier.config.js',
      'vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'commitlint.config.js',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-canonical-classname': 'off',
      'tailwindcss/enforces-negative-arbitrary-values': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/important-modifier-suffix': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
    },
  },
  {
    /**
     * The pre-paint theme script: a classic browser script served as-is from
     * public/, outside every tsconfig, so it is linted syntactically only. The
     * tailwind rules are off for the reason given on the root-config block.
     */
    files: ['public/theme-init.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.browser, sourceType: 'script' },
    rules: {
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-canonical-classname': 'off',
      'tailwindcss/enforces-negative-arbitrary-values': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/important-modifier-suffix': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
    },
  },
  {
    /** Node scripts sit outside every tsconfig, so they are linted syntactically only. */
    files: ['scripts/**/*.mjs', 'scripts/**/*.d.mts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    /**
     * The e2e suite and its fixture harness, with typed linting: e2e/tsconfig.json
     * lets `projectService` find these files. The tailwind rules are off for the
     * reason given on the root-config block.
     */
    files: ['e2e/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-canonical-classname': 'off',
      'tailwindcss/enforces-negative-arbitrary-values': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/important-modifier-suffix': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
    },
  },
  {
    /**
     * File and folder naming and placement. `src/pages/**` is exempt through the
     * `!(pages)` glob segment: TanStack Router's file routes need names like
     * `__root.tsx`, `_auth.tsx` and `$slug.members.tsx`, which are not kebab-case.
     */
    files: ['src/!(pages)/**/*.{ts,tsx}', 'src/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
      /** `ignoreMiddleExtensions` checks `auth` in `auth.store.ts`; the suffix block checks the rest. */
      'check-file/filename-naming-convention': [
        'error',
        {
          'src/!(pages)/**/*.{ts,tsx}': 'KEBAB_CASE',
          'src/*.{ts,tsx}': 'KEBAB_CASE',
        },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': ['error', { 'src/!(pages)/**/': 'KEBAB_CASE' }],
      /** A suffixed file can only live in its matching directory. */
      'check-file/folder-match-with-fex': [
        'error',
        {
          '**/*.store.ts': 'src/states/**',
          '**/*.queries.ts': 'src/queries/**',
          '**/*.schemas.ts': 'src/schemas/**',
          '**/*.types.ts': 'src/types/**',
        },
      ],
    },
  },
  {
    /**
     * No test file lives under src/, including src/pages/: unit tests go in
     * tests/unit/, mirroring the src/ path of their subject, so src/ holds
     * shipped code only and no test lands in the router's routes directory. The
     * custom `errorMessage` is required: without it, check-file validates the
     * map's values as glob patterns, and free text fails that.
     */
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-blocklist': [
        'error',
        {
          '**/*.{test,spec}.{ts,tsx}': 'tests/unit/**/*.test.{ts,tsx}',
          '**/__tests__/**': 'tests/unit/**/*.test.{ts,tsx}',
          'src/tests/**': 'tests/**',
        },
        {
          errorMessage:
            '`{{ target }}` is a test file under src/. Tests live in tests/unit/, mirroring the src/ path of the subject, e.g. src/http/session.ts → tests/unit/http/session.test.ts.',
        },
      ],
    },
  },
  {
    /**
     * The Vitest suite, with typed linting (tsconfig.app.json includes tests/)
     * and the same react-hooks rules as src/, since tests render components and
     * call hooks. The tailwind rules are off for the reason given on the
     * root-config block.
     */
    files: ['tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { 'react-hooks': reactHooks, 'check-file': checkFile },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-canonical-classname': 'off',
      'tailwindcss/enforces-negative-arbitrary-values': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/important-modifier-suffix': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
      /** `.test.`, never `.spec.`, and no `__tests__/` folders. */
      'check-file/filename-blocklist': [
        'error',
        {
          '**/*.spec.{ts,tsx}': '*.test.{ts,tsx}',
          '**/__tests__/**': '*.test.{ts,tsx}',
        },
        {
          errorMessage:
            'This project uses `.test.` filenames under tests/unit/ — not `.spec.` and not a `__tests__/` folder.',
        },
      ],
    },
  },
  {
    /**
     * The suffix of a suffixed file. No `ignoreMiddleExtensions`, so
     * `auth.store.ts` is checked as `auth.store`. This block replaces the naming
     * block's `filename-naming-convention` for these directories (the last
     * matching config wins; options do not merge), so each prefix is the
     * plugin's own KEBAB_CASE body, not a `+([a-z0-9-])` class, which would pass
     * `123`, `-auth`, `auth-` and `au--th`.
     */
    files: [
      'src/states/**/*.ts',
      'src/queries/**/*.ts',
      'src/schemas/**/*.ts',
      'src/types/**/*.ts',
      'src/hooks/**/*.{ts,tsx}',
    ],
    plugins: { 'check-file': checkFile },
    rules: {
      'check-file/filename-naming-convention': [
        'error',
        {
          'src/states/**/*.ts': '+([a-z])*([a-z0-9])*(-+([a-z0-9])).store',
          'src/queries/**/*.ts': '+([a-z])*([a-z0-9])*(-+([a-z0-9])).queries',
          'src/schemas/**/*.ts': '+([a-z])*([a-z0-9])*(-+([a-z0-9])).schemas',
          'src/types/**/*.ts': '+([a-z])*([a-z0-9])*(-+([a-z0-9])).types',
          'src/hooks/**/*.{ts,tsx}': 'use-+([a-z])*([a-z0-9])*(-+([a-z0-9]))',
        },
      ],
    },
  },
  {
    /** One import path for the class merger in our own code; vendored shadcn files keep theirs. */
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    ignores: ['src/lib/utils.ts', 'src/components/ui/!(form|sonner).tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'cn', message: "Import `cn` from '@/lib/utils'." }] },
      ],
    },
  },
  {
    /**
     * A test waits on a condition, never on a duration (see CLAUDE.md). The two
     * timing.ts files are exempt because they implement the deliberate waits.
     * `no-restricted-imports` repeats the `cn` entry: a later block's options
     * replace an earlier block's, they do not merge.
     */
    files: ['tests/**/*.{ts,tsx}', 'e2e/**/*.{ts,tsx}'],
    ignores: ['tests/fixtures/timing.ts', 'e2e/timing.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Promise'] CallExpression[callee.name='setTimeout']",
          message: SLEEP_MESSAGE,
        },
        { selector: "CallExpression[callee.name='sleep']", message: SLEEP_MESSAGE },
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message: SLEEP_MESSAGE,
        },
        {
          selector: "Property[key.name='waitUntil'][value.value='networkidle']",
          message: NETWORKIDLE_MESSAGE,
        },
        {
          selector:
            "CallExpression[callee.property.name='waitForLoadState'] > Literal[value='networkidle']",
          message: NETWORKIDLE_MESSAGE,
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'cn', message: "Import `cn` from '@/lib/utils'." },
            { name: 'node:timers/promises', importNames: ['setTimeout'], message: SLEEP_MESSAGE },
            { name: 'timers/promises', importNames: ['setTimeout'], message: SLEEP_MESSAGE },
          ],
        },
      ],
    },
  },
  ...tanstackRouter.configs['flat/recommended'],
  {
    /**
     * Vendored shadcn output: linting it churns the diff on every upstream
     * re-add, and its class strings are upstream's. This block must come after
     * tailwindcss.configs.recommended, whose own `files` glob is not stopped by
     * the `ignores` on the settings block.
     */
    files: ['src/components/ui/**'],
    rules: {
      /** Vendored components export a `cva` variants object beside the component. */
      'react-refresh/only-export-components': 'off',
      'tailwindcss/classnames-order': 'off',
      'tailwindcss/enforces-canonical-classname': 'off',
      'tailwindcss/enforces-negative-arbitrary-values': 'off',
      'tailwindcss/enforces-shorthand': 'off',
      'tailwindcss/important-modifier-suffix': 'off',
      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/no-contradicting-classname': 'off',
      'tailwindcss/no-custom-classname': 'off',
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
    },
  },
  {
    /**
     * Route files. TanStack Router's `redirect()` returns a `Response` that a
     * `beforeLoad` guard throws, so `only-throw-error` allows the lib `Response`
     * type; a thrown string or plain object still errors.
     */
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      /** A file route exports both `Route` and its component, by the router's contract. */
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'lib', name: 'Response' }] },
      ],
    },
  },
  {
    /**
     * The two hand-written files under src/components/ui/: sonner.tsx (the
     * registry one imports next-themes) and form.tsx. The rules the vendored
     * block turns off come back on at the plugin's recommended severities;
     * `classnames-order` stays off because prettier-plugin-tailwindcss owns
     * ordering. `settings` is repeated because the block that sets
     * `cssConfigPath` ignores this directory, and without it the plugin throws
     * ENOENT on 'src/style.css'.
     */
    files: ['src/components/ui/sonner.tsx', 'src/components/ui/form.tsx'],
    settings: { tailwindcss: { cssConfigPath: './src/styles/globals.css' } },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'tailwindcss/enforces-canonical-classname': 'warn',
      'tailwindcss/enforces-negative-arbitrary-values': 'warn',
      'tailwindcss/enforces-shorthand': 'warn',
      'tailwindcss/important-modifier-suffix': 'warn',
      'tailwindcss/no-arbitrary-value': 'off',
      'tailwindcss/no-contradicting-classname': 'error',
      /** `toaster` is sonner's own class, the hook its stylesheet targets. */
      'tailwindcss/no-custom-classname': ['warn', { whitelist: ['toaster'] }],
      'tailwindcss/no-unnecessary-arbitrary-value': 'warn',
    },
  },
  {
    /**
     * Comment style is enforced; see CLAUDE.md. The `.d.mts` files under
     * scripts/ are listed separately because the brace glob does not reach
     * them, and their JSDoc must be checked too.
     */
    files: ['**/*.{ts,tsx,js,mjs}', 'scripts/**/*.d.mts'],
    ignores: ['src/components/ui/!(form|sonner).tsx'],
    plugins: { local: { rules: { 'comment-style': commentStyleRule } } },
    rules: { 'local/comment-style': 'error' },
  },
  prettier
)
