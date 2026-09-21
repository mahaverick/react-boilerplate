import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
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
  prettier
)
