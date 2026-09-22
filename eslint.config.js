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
  { ignores: ['dist', 'src/routeTree.gen.ts', 'coverage'] },
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
    // `cn(...inputs: ClassValue[])` forwards a rest parameter into
    // twMerge(clsx(inputs)) — the plugin's no-custom-classname rule
    // pattern-matches the identifier itself as if it were a literal
    // classname and flags "inputs". False positive on the forwarding
    // parameter, not a real class string.
    files: ['src/lib/utils.ts'],
    rules: { 'tailwindcss/no-custom-classname': 'off' },
  },
  {
    // Root-level flat configs (eslint.config.js, prettier.config.js,
    // vite.config.ts, vitest.config.ts) sit outside tsconfig.app.json's
    // "src" include, so the type-aware project cannot parse them and every
    // typed rule from recommendedTypeChecked throws
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
    files: ['eslint.config.js', 'prettier.config.js', 'vite.config.ts', 'vitest.config.ts'],
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
      // This project uses `.test.`, never `.spec.`, and tests are
      // co-located beside their subject rather than collected under a
      // parallel `__tests__/` tree. A custom `errorMessage` is required here:
      // without it, check-file validates the map's VALUES as glob patterns
      // too (see its README), and free text like this fails that check.
      'check-file/filename-blocklist': [
        'error',
        {
          '**/*.spec.{ts,tsx}': '*.test.{ts,tsx}',
          '**/__tests__/**': '*.test.{ts,tsx}',
        },
        {
          errorMessage:
            'This project uses `.test.` filenames, co-located beside their subject — not `.spec.` and not a `__tests__/` folder.',
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
  {
    // Exempt from the suffix rule above, and scoped ONLY to the suffix
    // directories: `auth.store.test.ts` sits beside `auth.store.ts` and
    // does not itself end in `.store`, so it needs an exemption — but a
    // test file anywhere else (e.g. src/http, which has no suffix rule)
    // must keep the plain KEBAB_CASE check from block 1. A blanket
    // `**/*.test.{ts,tsx}` exemption (fix-round-1 finding) let
    // `src/lib/BadName.test.ts` pass with zero errors.
    files: ['src/{states,queries,schemas,types,hooks}/**/*.test.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: { 'check-file/filename-naming-convention': 'off' },
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
      '@typescript-eslint/only-throw-error': [
        'error',
        { allow: [{ from: 'lib', name: 'Response' }] },
      ],
    },
  },
  prettier
)
