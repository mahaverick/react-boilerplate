module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:import/typescript',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:tailwindcss/recommended',
    'prettier',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh','import', 'tailwindcss', 'prettier'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    'no-console': 'warn', // Warns on console.log usage
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], // Warns when declared variables are not used
  },
  settings: {
    react: {
      version: 'detect',
    },
    'import/resolver': {
      node: {},
      typescript: {},
    },
  },
}
