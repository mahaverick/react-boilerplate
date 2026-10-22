/**
 * Rules Oxlint cannot run yet (docs/lint-deferred.md). No type information: typed rules run in Oxlint.
 */
import tanstackRouter from '@tanstack/eslint-plugin-router'
import checkFile from 'eslint-plugin-check-file'
import jsdoc from 'eslint-plugin-jsdoc'
import tailwindcss from 'eslint-plugin-tailwindcss'
import tseslint from 'typescript-eslint'
import { commentStyleRule } from './scripts/comment-style.mjs'

const SLEEP_MESSAGE =
  'Wait on a condition, not a duration: findBy*/waitFor/vi.waitFor, expect.poll or a web-first assertion in e2e, fake timers, or settle(ms, reason) from @/tests/fixtures/timing (e2e: ./timing) when nothing can be observed.'
const NETWORKIDLE_MESSAGE =
  "networkidle waits on every request the page makes, including ones this test does not care about. Assert what the page renders (a heading's toBeVisible) or wait for the one response that matters."

/**
 * Every named function, method and class; inline callbacks and constructors
 * are exempt by construction.
 */
const NAMED_FUNCTIONS = [
  'FunctionDeclaration',
  'TSDeclareFunction',
  'ClassDeclaration',
  'MethodDefinition:not([kind="constructor"]):not([value.body=null])',
  'TSAbstractMethodDefinition',
  'VariableDeclarator > ArrowFunctionExpression',
  'VariableDeclarator > FunctionExpression',
  'PropertyDefinition > ArrowFunctionExpression',
]
/** Named functions plus interfaces, type aliases and exported consts. */
const JSDOC_CONTEXTS = [
  ...NAMED_FUNCTIONS,
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'ExportNamedDeclaration[declaration.type="VariableDeclaration"]',
]

const TAILWIND_RULES = {
  'tailwindcss/enforces-canonical-classname': 'warn',
  'tailwindcss/enforces-shorthand': 'warn',
  'tailwindcss/no-contradicting-classname': 'error',
  'tailwindcss/no-custom-classname': 'warn',
  'tailwindcss/no-unnecessary-arbitrary-value': 'warn',
}

export default tseslint.config(
  {
    ignores: [
      'dist',
      'src/routeTree.gen.ts',
      'coverage',
      'public/mockServiceWorker.js',
      'test-results',
      'playwright-report',
      'scripts/ui-registry',
    ],
  },
  { files: ['**/*.{ts,tsx,mts,cts}'], languageOptions: { parser: tseslint.parser } },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/!(form).tsx'],
    plugins: { tailwindcss },
    settings: { tailwindcss: { cssConfigPath: './src/styles/globals.css' } },
    rules: TAILWIND_RULES,
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
     * The Vitest suite's filename rules. Its typed and react-hooks rules run in
     * Oxlint, and the Tailwind block covers src/ only.
     */
    files: ['tests/**/*.{ts,tsx}'],
    plugins: { 'check-file': checkFile },
    rules: {
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
    },
  },
  ...tanstackRouter.configs['flat/recommended'],
  {
    /**
     * Comment style is enforced; see CLAUDE.md. The `.d.mts` files under
     * scripts/ and e2e/ are listed separately because the brace glob does not reach
     * them, and their JSDoc must be checked too.
     */
    files: ['**/*.{ts,tsx,js,mjs}', 'scripts/**/*.d.mts', 'e2e/**/*.d.mts'],
    ignores: ['src/components/ui/!(form).tsx'],
    plugins: { local: { rules: { 'comment-style': commentStyleRule } } },
    rules: { 'local/comment-style': 'error' },
  },
  {
    // Every named function, method and class carries a JSDoc purpose line; tags only where they add what types cannot.
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: false,
          require: { FunctionDeclaration: false },
          contexts: JSDOC_CONTEXTS,
          checkConstructors: false,
          // lint-staged runs eslint --fix, and this fixer inserts blank stubs.
          enableFixer: false,
        },
      ],
      'jsdoc/require-description': ['error', { contexts: JSDOC_CONTEXTS }],
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/no-types': 'error',
    },
  },
  {
    // .d.mts mirrors its .mjs exports; a second JSDoc copy would drift.
    files: ['scripts/**/*.d.mts', 'e2e/**/*.d.mts'],
    rules: { 'jsdoc/require-jsdoc': 'off' },
  },
  {
    // Vendored shadcn/Base UI output stays as upstream ships it.
    files: ['src/components/ui/!(form).tsx'],
    rules: { 'jsdoc/require-jsdoc': 'off', 'jsdoc/require-description': 'off' },
  }
)
