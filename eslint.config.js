import js from '@eslint/js'
import tanstackRouter from '@tanstack/eslint-plugin-router'
import prettier from 'eslint-config-prettier'
import checkFile from 'eslint-plugin-check-file'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tailwindcss from 'eslint-plugin-tailwindcss'
import globals from 'globals'
import tseslint from 'typescript-eslint'

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
    // Root-level flat configs (eslint.config.js, prettier.config.js,
    // vite.config.ts, vitest.config.ts, commitlint.config.js) sit outside
    // tsconfig.app.json's "src" include, so the type-aware project cannot
    // parse them and every typed rule from recommendedTypeChecked throws
    // "parserOptions set to generate type information" on them. Lint them
    // syntactically only. Listed explicitly rather than widened, so this
    // never accidentally covers a file under src/.
    //
    // tailwindcss.configs.recommended's own `files` glob
    // ("**/*.ts"/"**/*.js"/...) also matches these same root files, and
    // without the `cssConfigPath` set below (deliberately scoped to
    // src/**/*.{ts,tsx} only) the plugin falls back to its default
    // 'src/style.css' path and throws ENOENT. Its rules are turned off here
    // for the same reason the type-checked rules are.
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
    // The pre-paint theme script: a classic browser script served as-is from
    // public/, outside every tsconfig, so it is linted syntactically only.
    // The tailwind rules are off for the reason given on the e2e block below.
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
    // The e2e suite and its fixture harness. Typed linting rather than the
    // `disableTypeChecked` used for the root configs above: `e2e/tsconfig.json`
    // exists precisely so `projectService` can find these files, so the
    // type-aware rules work here and there is no reason to give them up.
    //
    // The tailwind rules are off for the same reason they are off on the root
    // configs: the plugin's own `files` glob matches `**/*.ts`, and
    // `cssConfigPath` is scoped to `src/**/*.{ts,tsx}`, so without this the
    // plugin falls back to its default 'src/style.css' and throws ENOENT.
    //
    // `check-file`'s rules below are all scoped to `src/**`, so nothing here
    // needs exempting from them — but note Playwright's default spec glob is
    // `*.spec.ts`, which `filename-blocklist` would reject. `playwright.config.ts`
    // sets `testMatch: '**/*.test.ts'` to stay inside the repo's convention.
    // That config file itself is a root-level flat config and is linted with
    // the others above, not here.
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
  // File/folder naming, placement and test-file conventions. `src/pages/**`
  // is exempt everywhere below via the `!(pages)` glob segment — TanStack
  // Router's file-based routing requires names like `__root.tsx`, `_auth.tsx`
  // and `$slug.members.tsx`, which violate kebab-case by design. Task 4
  // creates that directory; these rules must not error before it exists and
  // must not flag its contents once it does.
  {
    files: ['src/!(pages)/**/*.{ts,tsx}', 'src/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
      // ignoreMiddleExtensions: true so a suffixed file like `auth.store.ts`
      // validates the base word `auth` here, not `auth.store` (which would
      // fail KEBAB_CASE on the dot). The suffix itself is checked below.
      'check-file/filename-naming-convention': [
        'error',
        {
          'src/!(pages)/**/*.{ts,tsx}': 'KEBAB_CASE',
          'src/*.{ts,tsx}': 'KEBAB_CASE',
        },
        { ignoreMiddleExtensions: true },
      ],
      'check-file/folder-naming-convention': ['error', { 'src/!(pages)/**/': 'KEBAB_CASE' }],
      // Placement: a suffixed file can only live in its matching directory.
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
    // Test placement. No test file lives under src/: unit tests go in
    // tests/unit/, mirroring the src/ path of their subject
    // (src/http/session.ts → tests/unit/http/session.test.ts); cross-cutting
    // suites (a11y) sit at tests/unit/ and support code in tests/{mocks,fixtures}.
    // Keeps src/ to shipped code only, matches express-boilerplate's layout,
    // and keeps test files out of TanStack Router's src/pages/ routes directory.
    //
    // Covers src/pages/ too, unlike the naming rules above. A custom
    // `errorMessage` is required: without it, check-file validates the map's
    // VALUES as glob patterns too (see its README), and free text fails that.
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
    // The Vitest suite under tests/. Typed linting via projectService —
    // tsconfig.app.json includes tests/ — with the same react-hooks rules as
    // src/ (tests render components and call hooks). Tailwind rules are off
    // for the reason given on the e2e block above.
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
      // `.test.`, never `.spec.`, and no `__tests__/` folders.
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
    // The suffix itself, checked separately from the base KEBAB_CASE rule
    // above (a second, more specific `filename-naming-convention` block, per
    // the naming-conventions table). No `ignoreMiddleExtensions` here: only
    // the outer `.ts`/`.tsx` extension is stripped, so `auth.store.ts` is
    // checked as `auth.store` against the pattern below.
    //
    // The prefix is the plugin's own KEBAB_CASE body
    // (`+([a-z])*([a-z0-9])*(-+([a-z0-9]))`, from
    // node_modules/eslint-plugin-check-file/dist/index.cjs), not a bare
    // `+([a-z0-9-])` charset class. A charset class allows a leading digit,
    // a leading/trailing hyphen and doubled hyphens — `123`, `-auth`,
    // `auth-` and `au--th` are all valid `+([a-z0-9-])` but none is
    // KEBAB_CASE. Fix-round-1 finding: `pnpm exec eslint src/states` exited
    // 0 on `123.store.ts`, `-auth.store.ts`, `auth-.store.ts` and
    // `au--th.store.ts` before this change, because block 2 REPLACES block
    // 1's filename-naming-convention entry for these directories rather
    // than merging with it (same rule key, last matching config object
    // wins), so block 1's real KEBAB_CASE check never ran on them either.
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
  ...tanstackRouter.configs['flat/recommended'],
  {
    // Vendored shadcn output. Linting it churns the diff on every upstream
    // re-add, and its class strings are upstream's to own, not ours.
    // This block must come AFTER tailwindcss.configs.recommended: that config
    // carries its own `files` glob, so the earlier `ignores` on the settings
    // block below it does not stop its rules applying here.
    files: ['src/components/ui/**', 'src/hooks/use-mobile.ts'],
    rules: {
      // Vendored components export a `cva` variants object beside the
      // component (badge, button, sidebar, tabs). Restructuring upstream's
      // files to satisfy a dev-server ergonomics rule is not worth the churn.
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
    // `src/hooks/use-mobile.ts` is vendored too — `shadcn add sidebar` emits it,
    // and it lands outside `src/components/ui/` only because components.json's
    // `hooks` alias points elsewhere. It trips `react-hooks/set-state-in-effect`
    // (it seeds its state with a setState in the effect body). Upstream's call,
    // not ours: patching it churns on every re-add, which is the same reason the
    // directory above is excluded. Re-review if we ever adopt the file as ours.
    files: ['src/hooks/use-mobile.ts'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    // TanStack Router's `redirect()` returns `Response & { options }` — a value
    // the router is designed to have THROWN out of a `beforeLoad`, which is how
    // every guard in src/pages works. `only-throw-error` sees a non-Error and
    // objects. Allowing the lib `Response` type keeps the rule's real job (a
    // thrown string or plain object still errors) while permitting the one
    // framework idiom the guards are built on.
    files: ['src/pages/**/*.{ts,tsx}'],
    rules: {
      // Every TanStack file route exports both `Route` and its component from
      // one file — that IS the file-route contract, so the rule is a false
      // positive on every route file this project will ever have.
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'lib', name: 'Response' }] },
      ],
    },
  },
  {
    // The files under src/components/ui/ that are OURS, not upstream's:
    // sonner.tsx (hand-written, because the registry one imports next-themes)
    // and form.tsx (hand-written in Task 5). The vendored block above turns
    // these rules off for the whole directory; this turns them back on for our
    // two files, at the severities eslint-plugin-tailwindcss's own recommended
    // config uses. `classnames-order` stays off to match the rest of src/ --
    // prettier-plugin-tailwindcss owns ordering. `settings` is repeated because
    // the block that sets cssConfigPath deliberately ignores this directory,
    // and without it the plugin falls back to 'src/style.css' and throws ENOENT.
    // form.tsx is listed before it exists so Task 5's file is covered the
    // moment it lands rather than silently escaping.
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
      // `toaster` is sonner's OWN class, the hook its stylesheet targets — a
      // real third-party classname, which is exactly what this option is for.
      'tailwindcss/no-custom-classname': ['warn', { whitelist: ['toaster'] }],
      'tailwindcss/no-unnecessary-arbitrary-value': 'warn',
    },
  },
  prettier
)
