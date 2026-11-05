#!/usr/bin/env node
/**
 * @file The check-shared check: every file `shared-core.json` shares with
 * expo (and, with `--app`, with that app too) uses no browser-only global and
 * imports only another shared file, a declared export of a declared port, or
 * an npm package that is not banned. A shared test also takes its runner only
 * from the runner port, uses no `vi` and no `import.meta`, and imports neither
 * `node:fs` (or `fs`), `msw` nor anything under `@/components`.
 * With `--docs`, the docs table (`Path | apex | expo`) must list exactly the
 * manifest's files and tests, with the same apps.
 *
 * Usage: node scripts/check-shared.mjs [--manifest <path>] [--root <dir>]
 * [--app <name>] [--docs <ARCHITECTURE.md>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

/** The app every check covers: expo shares the most and has no browser. */
const BASE_APP = 'expo'

/** Globals only a browser has. */
const BANNED_GLOBALS = new Set([
  'window',
  'document',
  'location',
  'navigator',
  'localStorage',
  'sessionStorage',
])

/** `import.meta` properties a shared test may not read either; a shared file may read only `url`. */
const BANNED_META = new Set(['env', 'dirname'])

/** Free names through which a property reaches the global object. */
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window'])

/** Packages only one platform has. */
const BANNED_PACKAGES = [
  'posthog-js',
  'posthog-react-native',
  '@tanstack/react-router',
  '@simplewebauthn/browser',
  'react-native',
  '@tabler/icons-react',
]

/** Runner packages a shared test reaches only through the runner port. */
const RUNNER_PACKAGES = ['vite-plus/test', 'vitest', '@jest/globals']

/** Packages a shared test may not import, unless the manifest exempts it. */
const TEST_BANNED_PACKAGES = ['node:fs', 'fs', 'msw']

/** The specifier prefix of the web-only components. */
const COMPONENTS = '@/components'

/** Files the TypeScript parser reads; any other row (shell, JSON) is skipped. */
const CODE_FILE = /\.(?:[cm]?[jt]s|tsx|jsx)$/

/** Suffixes tried, in order, when an import names no extension. */
const RESOLVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.mjs',
  '.js',
  '.json',
  '/index.ts',
  '/index.tsx',
]

/**
 * Whether a specifier is a package or one of its subpaths.
 * @param specifier - The import specifier.
 * @param name - The package name.
 * @returns True when it names the package.
 */
function isPackage(specifier, name) {
  return specifier === name || specifier.startsWith(`${name}/`)
}

/**
 * The repo-relative path an `@/`, `@/tests/` or relative specifier names,
 * before any extension is tried.
 * @param specifier - The import specifier.
 * @param importer - The importing file, repo-relative.
 * @returns The path, or null for a package.
 */
function localTarget(specifier, importer) {
  if (specifier.startsWith('@/tests/')) return `tests/${specifier.slice('@/tests/'.length)}`
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier))
  }
  return null
}

/**
 * The line a node starts on, from 1.
 * @param source - The parsed file.
 * @param node - The node.
 * @returns Its line.
 */
function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
}

/**
 * The names a binding (identifier or destructuring pattern) declares.
 * @param name - The binding name.
 * @returns The names.
 */
function bindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
  )
}

/**
 * The names a list of statements declares at its own level, `var` hoisting
 * aside.
 * @param statements - The statements.
 * @returns The names.
 */
function statementNames(statements) {
  const names = []
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        names.push(...bindingNames(declaration.name))
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text)
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause
      if (clause.name) names.push(clause.name.text)
      const bindings = clause.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) names.push(bindings.name.text)
      if (bindings && ts.isNamedImports(bindings)) {
        names.push(...bindings.elements.map((element) => element.name.text))
      }
    }
  }
  return names
}

/**
 * The names a scope node declares for the code inside it.
 * @param node - A possible scope.
 * @returns The names, empty when the node opens no scope.
 */
function scopeNames(node) {
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
    return statementNames(node.statements)
  }
  if (ts.isCaseBlock(node))
    return node.clauses.flatMap((clause) => statementNames(clause.statements))
  if (ts.isFunctionLike(node)) {
    const names = node.parameters.flatMap((parameter) => bindingNames(parameter.name))
    if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
      names.push(node.name.text)
    }
    return names
  }
  if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)) {
    const initializer = node.initializer
    return initializer && ts.isVariableDeclarationList(initializer)
      ? initializer.declarations.flatMap((declaration) => bindingNames(declaration.name))
      : []
  }
  if (ts.isCatchClause(node) && node.variableDeclaration) {
    return bindingNames(node.variableDeclaration.name)
  }
  return []
}

/**
 * Whether an identifier is a name rather than a reference to a variable: a
 * property, key, member, label or declaration name.
 * @param node - The identifier.
 * @returns True when it reads no variable.
 */
function isNameSide(node) {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node
  if (ts.isQualifiedName(parent)) return parent.right === node
  if (ts.isBindingElement(parent)) return parent.propertyName === node || parent.name === node
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isJsxAttribute(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isTypeParameterDeclaration(parent)
  ) {
    return parent.name === node
  }
  if (ts.isImportSpecifier(parent)) return true
  if (ts.isExportSpecifier(parent)) {
    // A local `export { x }` reads x; a re-export `from` a module or an `as` alias does not.
    return (
      Boolean(parent.parent.parent.moduleSpecifier) ||
      (parent.propertyName !== undefined && parent.name === node)
    )
  }
  if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) {
    return parent.label === node
  }
  return false
}

/**
 * Whether an identifier reads a variable that no enclosing scope declares.
 * @param node - The identifier.
 * @returns True when it can only be a global.
 */
function isGlobalReference(node) {
  if (isNameSide(node)) return false
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (scopeNames(scope).includes(node.text)) return false
  }
  return true
}

/**
 * The first name of a possibly qualified name: `A` for `A.B.C`.
 * @param name - The name.
 * @returns Its leftmost identifier's text.
 */
function leftmostName(name) {
  return ts.isQualifiedName(name) ? leftmostName(name.left) : name.text
}

/**
 * The property a member access names, when it is written literally.
 * @param node - A property or element access.
 * @returns The property name, or null when it is computed.
 */
function accessedName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text
  }
  return null
}

/**
 * Each import a file makes: static, type-only, re-export, dynamic, type-level
 * `import('x').T`, `require('x')` and `import x = require('x')`.
 * @param source - The parsed file.
 * @returns The specifier, its node, and the names it takes (null when it
 *   takes the whole module, as a namespace, `export *` or `import()` does).
 */
function importsOf(source) {
  const found = []
  /**
   * Collect from one node and its children.
   * @param node - The node.
   */
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      let names = []
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause
        if (clause?.name) names.push('default')
        const bindings = clause?.namedBindings
        if (bindings && ts.isNamespaceImport(bindings)) names = null
        else if (bindings) {
          names.push(...bindings.elements.map((e) => (e.propertyName ?? e.name).text))
        }
      } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        names = node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text)
      } else {
        names = null
      }
      found.push({ specifier: node.moduleSpecifier.text, node, names })
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, node, names: null })
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push({
        specifier: node.argument.literal.text,
        node,
        names: node.qualifier ? [leftmostName(node.qualifier)] : null,
      })
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ specifier: node.arguments[0].text, node, names: null })
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      found.push({ specifier: node.moduleReference.expression.text, node, names: null })
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/**
 * Read and validate the manifest.
 * @param file - Its absolute path.
 * @returns The manifest, every section present.
 */
function readManifest(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  return {
    files: raw.files ?? {},
    tests: raw.tests ?? {},
    ports: raw.ports ?? {},
    testPorts: raw.testPorts ?? {},
    exemptions: raw.exemptions ?? {},
  }
}

/**
 * The findings for one shared file or test.
 * @param context - The check's state.
 * @param context.root - The repo root.
 * @param context.manifest - The manifest.
 * @param context.apps - The apps checked.
 * @param context.manifestName - The manifest's repo-relative path, for reports.
 * @param context.manifestText - The manifest's text, for line numbers.
 * @param file - The row's path.
 * @param isTest - Whether the row is under `tests`.
 * @returns The findings.
 */
function checkRow(context, file, isTest) {
  const { root, manifest, apps } = context
  const absolute = path.join(root, file)
  if (!fs.existsSync(absolute)) {
    return [
      {
        file: context.manifestName,
        line: lineOfText(context.manifestText, `"${file}"`),
        reason: `${file} does not exist`,
      },
    ]
  }
  if (!CODE_FILE.test(file)) return []
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(absolute, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : undefined
  )
  const rowApps = (isTest ? manifest.tests : manifest.files)[file].filter((app) =>
    apps.includes(app)
  )
  const exempt = new Set(manifest.exemptions[file] ?? [])
  const findings = []
  /**
   * Record a finding at a node.
   * @param node - Where.
   * @param reason - What is wrong.
   */
  const report = (node, reason) => findings.push({ file, line: lineOf(source, node), reason })

  for (const { specifier, node, names } of importsOf(source)) {
    const reason = importProblem({ manifest, rowApps, isTest, exempt }, file, specifier, names)
    for (const message of reason) report(node, message)
  }

  /**
   * Check one node for a banned global or `import.meta` use, then its children.
   * @param node - The node.
   */
  const visit = (node) => {
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      const isAccess =
        (ts.isPropertyAccessExpression(node.parent) || ts.isElementAccessExpression(node.parent)) &&
        node.parent.expression === node
      const property = isAccess ? accessedName(node.parent) : null
      if (isTest) {
        report(
          node,
          property && BANNED_META.has(property)
            ? `uses import.meta.${property}`
            : 'uses import.meta, which a shared test may not'
        )
      } else if (property === null) {
        report(node, 'uses import.meta')
      } else if (ts.isElementAccessExpression(node.parent)) {
        report(node, `uses import.meta['${property}']`)
      } else if (property !== 'url') {
        report(node, `uses import.meta.${property}`)
      }
    } else if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text) &&
      isGlobalReference(node.expression) &&
      BANNED_GLOBALS.has(accessedName(node) ?? '')
    ) {
      report(node, `uses the browser global ${accessedName(node)}`)
    } else if (ts.isIdentifier(node) && isGlobalReference(node)) {
      if (BANNED_GLOBALS.has(node.text)) report(node, `uses the browser global ${node.text}`)
      else if (isTest && node.text === 'vi') report(node, 'uses vi, which a shared test may not')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return findings
}

/**
 * What is wrong with one import, if anything.
 * @param context - The row's state.
 * @param context.manifest - The manifest.
 * @param context.rowApps - The checked apps this row is shared with.
 * @param context.isTest - Whether the row is a test.
 * @param context.exempt - Specifiers the manifest exempts for this row.
 * @param importer - The importing file.
 * @param specifier - The import specifier.
 * @param names - The names it takes, or null for the whole module.
 * @returns The problems, empty when the import is allowed.
 */
function importProblem({ manifest, rowApps, isTest, exempt }, importer, specifier, names) {
  if (exempt.has(specifier)) return []
  if (specifier === COMPONENTS || specifier.startsWith(`${COMPONENTS}/`)) {
    return [`imports ${specifier}, which is banned in a shared file`]
  }
  const target = localTarget(specifier, importer)
  if (target === null) {
    if (BANNED_PACKAGES.some((name) => isPackage(specifier, name))) {
      return [`imports ${specifier}, which is banned in a shared file`]
    }
    if (isTest && RUNNER_PACKAGES.some((name) => isPackage(specifier, name))) {
      return [`imports ${specifier}; a shared test takes its runner from @/tests/support/runner`]
    }
    if (isTest && TEST_BANNED_PACKAGES.some((name) => isPackage(specifier, name))) {
      return [`imports ${specifier}, which a shared test may not`]
    }
    return []
  }
  if (target.startsWith('src/components/')) {
    return [`imports ${specifier}, which is banned in a shared file`]
  }
  const candidates = RESOLVE_SUFFIXES.map((suffix) => `${target}${suffix}`)
  const shared = { ...manifest.files, ...(isTest ? manifest.tests : {}) }
  const ports = { ...manifest.ports, ...(isTest ? manifest.testPorts : {}) }
  const sharedHit = candidates.find((candidate) =>
    rowApps.every((app) => shared[candidate]?.includes(app))
  )
  if (sharedHit) return []
  const portHit = candidates.find((candidate) => ports[candidate])
  if (portHit) {
    if (names === null) {
      return [`imports the whole port ${portHit}; import its declared exports by name`]
    }
    return names
      .filter((name) => !ports[portHit].includes(name))
      .map((name) => `imports ${name} from the port ${portHit}, which does not declare it`)
  }
  const sharedRow = candidates.find((candidate) => shared[candidate])
  if (!sharedRow) return [`imports ${specifier}, which is neither shared nor a port`]
  const missing = rowApps.filter((app) => !shared[sharedRow].includes(app))
  return [`imports ${specifier}, which is not shared with ${missing.join(' and ')}`]
}

/**
 * The 1-based line of the first occurrence of a needle.
 * @param text - The text.
 * @param needle - What to find.
 * @returns The line, or 1 when it is absent.
 */
function lineOfText(text, needle) {
  const index = text.indexOf(needle)
  return index === -1 ? 1 : text.slice(0, index).split('\n').length
}

/**
 * The cells of a markdown table row, trimmed.
 * @param line - The row.
 * @returns The cells.
 */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * Whether a docs table cell marks the app: anything but empty, `-`, `—` or
 * `no`.
 * @param cell - The cell's text.
 * @returns True when the app holds the file.
 */
function isMarked(cell) {
  return cell !== undefined && !['', '-', '—', 'no'].includes(cell.toLowerCase())
}

/**
 * The findings from comparing the docs table with the manifest. The table is
 * the first whose header starts `Path` and has `apex` and `expo` columns; each
 * row's path is its first cell, in backticks.
 * @param context - The check's state.
 * @param context.root - The repo root.
 * @param context.manifest - The manifest.
 * @param context.manifestName - The manifest's repo-relative path, for reports.
 * @param docs - The docs file, repo-relative.
 * @returns The findings.
 */
function checkDocs({ root, manifest, manifestName }, docs) {
  const lines = fs.readFileSync(path.join(root, docs), 'utf8').split('\n')
  const headerIndex = lines.findIndex((line) => {
    const header = line.trim().startsWith('|') ? cells(line).map((c) => c.toLowerCase()) : []
    return header[0] === 'path' && header.includes('apex') && header.includes('expo')
  })
  if (headerIndex === -1) {
    return [{ file: docs, line: 1, reason: 'has no table with Path, apex and expo columns' }]
  }
  const header = cells(lines[headerIndex]).map((c) => c.toLowerCase())
  const columns = { apex: header.indexOf('apex'), expo: header.indexOf('expo') }
  const table = new Map()
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith('|')) break
    const row = cells(lines[index])
    const rowPath = row[0].replace(/^`|`$/g, '')
    const rowApps = Object.keys(columns).filter((app) => isMarked(row[columns[app]]))
    table.set(rowPath, { line: index + 1, apps: rowApps })
  }
  const listed = { ...manifest.files, ...manifest.tests }
  const findings = []
  for (const [file, apps] of Object.entries(listed)) {
    const row = table.get(file)
    if (!row) {
      findings.push({
        file: docs,
        line: headerIndex + 1,
        reason: `${file} is in ${manifestName} but not in the table`,
      })
    } else {
      const expected = Object.keys(columns).filter((app) => apps.includes(app))
      if (expected.join() !== row.apps.join()) {
        findings.push({
          file: docs,
          line: row.line,
          reason: `${file} lists ${row.apps.join(', ') || 'no app'}, and ${manifestName} lists ${expected.join(', ') || 'no app'}`,
        })
      }
    }
  }
  for (const [file, row] of table) {
    if (!(file in listed)) {
      findings.push({
        file: docs,
        line: row.line,
        reason: `${file} is in the table but not in ${manifestName}`,
      })
    }
  }
  return findings.sort((a, b) => a.line - b.line)
}

/**
 * Check the shared files and tests.
 * @param options - What to check.
 * @param options.root - The repo root (default: the working directory).
 * @param options.manifest - The manifest, relative to `root` (default `shared-core.json`).
 * @param options.app - Another app whose rows are checked too.
 * @param options.docs - A docs file, relative to `root`, whose table must match.
 * @returns The findings, empty when clean.
 */
export function checkShared({
  root = process.cwd(),
  manifest: manifestName = 'shared-core.json',
  app,
  docs,
} = {}) {
  const manifestPath = path.resolve(root, manifestName)
  const manifest = readManifest(manifestPath)
  const apps = app && app !== BASE_APP ? [BASE_APP, app] : [BASE_APP]
  const context = {
    root,
    manifest,
    apps,
    manifestName: path.relative(root, manifestPath) || manifestName,
    manifestText: fs.readFileSync(manifestPath, 'utf8'),
  }
  const findings = []
  for (const [isTest, section] of [
    [false, manifest.files],
    [true, manifest.tests],
  ]) {
    for (const [file, rowApps] of Object.entries(section)) {
      if (rowApps.some((rowApp) => apps.includes(rowApp))) {
        findings.push(...checkRow(context, file, isTest))
      }
    }
  }
  if (docs) findings.push(...checkDocs(context, docs))
  return findings
}

/**
 * The CLI's options from its arguments.
 * @param argv - The arguments after the script.
 * @returns The options.
 */
function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!['--manifest', '--root', '--app', '--docs'].includes(flag) || value === undefined) {
      throw new Error(`check-shared: unknown or incomplete argument ${flag}`)
    }
    options[flag.slice(2)] = value
  }
  return options
}

/** Print each finding and exit 1 when there is any; print nothing when clean. */
function main() {
  const findings = checkShared(parseArguments(process.argv.slice(2)))
  if (findings.length > 0) {
    console.error(findings.map((f) => `${f.file}:${f.line}: ${f.reason}`).join('\n'))
    // exitCode, not exit(): exit() drops stderr still queued for a pipe.
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
