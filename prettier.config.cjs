/** @type {import('prettier').Config} */
module.exports = {
  endOfLine: "lf",
  semi: false,
  singleQuote: false,
  tabWidth: 2,
  printWidth: 100,
  bracketSameLine: true,
  trailingComma: "es5",
  arrowParens: "always",
  bracketSpacing: true,
  importOrder: [
    "^(react/(.*)$)|^(react$)",
    "<THIRD_PARTY_MODULES>",
    "",
    "<BUILTIN_MODULES>",
    "",
    "^types$",
    "^@/types/(.*)$",
    "^@/services/(.*)$",
    "^@/contexts/(.*)$",
    "",
    "^@/routes/(.*)$",
    "^@/redux/(.*)$",
    "^@/configs/(.*)$",
    "^@/utils/(.*)$",
    "^@/hooks/(.*)$",
    "^@/components/ui/(.*)$",
    "^@/components/(.*)$",
    "^@/pages/(.*)$",
    "^@/assets/(.*)$",
    "^@/styles/(.*)$",
    "",
    "^[./]",
  ],
  importOrderSeparation: false,
  importOrderSortSpecifiers: true,
  importOrderBuiltinModulesToTop: true,
  importOrderParserPlugins: ["typescript", "jsx", "decorators-legacy"],
  importOrderMergeDuplicateImports: true,
  importOrderCombineTypeAndValueImports: true,
  plugins: ["@ianvs/prettier-plugin-sort-imports", "prettier-plugin-tailwindcss"],
}
