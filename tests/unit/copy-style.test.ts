/**
 * @file Every string the app renders follows the copy rules: no banned
 * phrasing (vague failure words, weasel, peacock and filler words, jargon)
 * and no sentence over 30 words. The scan parses `src/` with the TypeScript
 * compiler and collects what a person can read: JSX text (one string per
 * element, so a sentence split by `<Pii>` is read whole), and every string or
 * template literal outside the positions that never render (imports, class
 * names, routes, keys, comparisons, `console` and `new Error` arguments). A
 * literal counts as copy when it holds two words, or is one capitalised word.
 * express-boilerplate's `tests/unit/copy-style.test.ts` holds the same list.
 *
 * "couldn't" passes only when another sentence follows it in the same
 * string: the next step ("We couldn't load it. Select Try again."), the rule
 * express's test applies. "could not" is banned everywhere. Where the
 * frontends differ from express, on purpose: "Too many attempts" and "how
 * many" are counts, not hedges, so `many` after "too" or "how" passes.
 *
 * Out of scope, by design: `src/components/ui/` (vendored), the generated
 * route tree, and `src/lib/chunk-load-error.ts` and `src/observability/errors/`,
 * whose strings are the browsers' own error messages and the scrubber's
 * patterns: matched, never shown.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { copyStyleRoots, describe, expect, it, repoRoot } from '@/tests/support/runner'

/**
 * Paths from the repo root that hold no copy a person reads: vendored
 * components, the generated route tree, and the browser error messages and
 * scrub patterns that code matches against, never shows.
 */
const NOT_COPY = [
  'src/components/ui/',
  'src/routeTree.gen.ts',
  'src/lib/chunk-load-error.ts',
  'src/observability/errors/',
]

/**
 * Phrasings the copy rules ban, matched case-insensitively on whole words.
 * `most` is allowed in "at most 100", which is a limit, not a hedge; `many`
 * in "too many" and "how many", which are counts.
 */
const BANNED: readonly RegExp[] = [
  // Vague failure words.
  /\bcould not\b/i,
  /\bunable to\b/i,
  /\binvalid\b/i,
  /\bsomething went wrong\b/i,
  /\ban error occurred\b/i,
  /\bfailed to\b/i,
  /\boops\b/i,
  // Weasel words.
  /\bnearly\b/i,
  /\bsignificant(?:ly)?\b/i,
  /\bgenerally\b/i,
  /\busually\b/i,
  /\boften\b/i,
  /\bsome\b/i,
  /\bseveral\b/i,
  /(?<!\b(?:too|how) )\bmany\b/i,
  /(?<!\bat )\bmost\b/i,
  /\bvery\b/i,
  /\bmight\b/i,
  /\bvarious\b/i,
  /\ba lot\b/i,
  /\bquickly\b/i,
  /\beasily\b/i,
  /\bshortly\b/i,
  /\bsoon\b/i,
  /\blater\b/i,
  /\bexperts say\b/i,
  /\bresearch shows\b/i,
  // Filler, hype and peacock words.
  /\bplease\b/i,
  /\bsuccessfully\b/i,
  /\bwas able to\b/i,
  /\bin order to\b/i,
  /\bcurrently\b/i,
  /\bsimply\b/i,
  /\bjust\b/i,
  /\bseamless(?:ly)?\b/i,
  /\bexciting\b/i,
  /\boutstanding\b/i,
  /\binnovative\b/i,
  /\bworld-class\b/i,
  /\bpowerful\b/i,
  /\bbest-in-class\b/i,
  // Jargon a person should never read.
  /\btokens?\b/i,
  /\bmagic link\b/i,
  /\bstep-up\b/i,
  /\bUUID\b/,
  /\bNUL\b/,
]

/** The longest sentence the rules allow, in words. */
const MAX_SENTENCE_WORDS = 30

/** JSX attributes whose value is never shown: styling, routing, keys and wiring. */
const SILENT_ATTRIBUTE =
  /^(?:className|class|style|href|to|hash|search|params|id|type|data-.*|role|variant|size|key|name|htmlFor|autoComplete|inputMode|side|align|method|rel|target|src|srcSet|form|mode|action|value|defaultValue|pattern|accept|lang|dir|orientation|testId|icon|tone|slot|render|as|aria-controls|aria-describedby|aria-labelledby|aria-hidden|aria-live|aria-current)$/

/** Calls whose arguments are never shown: class names, logs and module paths. */
const SILENT_CALL =
  /^(?:cn|cva|console\.\w+|import|require|matchMedia|window\.matchMedia|querySelector|querySelectorAll|\w+\.querySelector(?:All)?|\w+\.closest|\w+\.matches)$/

/** A literal made only of class names, which a `cn` helper or a variable may carry. */
const CLASS_LIST = /^[\w:/[\]().%!&>*~@#=,-]+(?: [\w:/[\]().%!&>*~@#=,-]+)*$/

/** Tailwind's prefixes, which mark a class list apart from a short sentence. */
const TAILWIND =
  /(?:^|\s)!?(?:[\w-]+:)*(?:flex|grid|text-|bg-|p[xytblrse]?-|m[xytblrse]?-|w-|h-|gap-|rounded|border|items-|justify-|size-|sr-only|hidden|block|inline|font-|shrink|grow|min-|max-|overflow|truncate|absolute|relative|fixed|sticky|top-|left-|right-|bottom-|inset-|z-|opacity|transition|cursor|ring|shadow|space-|col-|row-|leading|tracking|animate-|duration-|ease-|outline|fill-|stroke-|self-|place-|order-|underline|whitespace|break-|select-|pointer-|has-|group|peer|data-|aria-|not-|wrap-|line-clamp)/

/** One piece of copy and where it came from. */
interface Copy {
  where: string
  text: string
}

/**
 * The text of a string or template literal, each `${…}` read as the word X.
 * @param node - Any node.
 * @returns The text, or undefined when the node is not a literal.
 */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `X${span.literal.text}`).join('')
  }
  return undefined
}

/**
 * An element's children read as one string: text as written, a literal child
 * as its text, and any other child (an element, an expression) as the word X.
 * @param children - The element's children.
 * @returns The text, and whether any of it was written as JSX text.
 */
function jsxChildrenText(children: ts.NodeArray<ts.JsxChild>): {
  text: string
  hasText: boolean
} {
  let hasText = false
  const parts = children.map((child) => {
    if (ts.isJsxText(child)) {
      if (child.text.trim() !== '') hasText = true
      return child.text
    }
    if (ts.isJsxExpression(child)) {
      if (child.expression === undefined) return ''
      const literal = literalText(child.expression)
      if (literal !== undefined) {
        hasText = true
        return literal
      }
    }
    return 'X'
  })
  return { text: parts.join(''), hasText }
}

/**
 * Whether a literal sits where its value is code, never shown: an import, a
 * type, a key, a comparison, a silent attribute or a silent call's argument.
 * @param node - A string or template literal.
 * @returns True when the literal is not copy.
 */
function isSilentPosition(node: ts.Node): boolean {
  const parent = node.parent
  if (
    ts.isImportDeclaration(parent) ||
    ts.isExportDeclaration(parent) ||
    ts.isExternalModuleReference(parent) ||
    ts.isLiteralTypeNode(parent) ||
    ts.isCaseClause(parent) ||
    ts.isElementAccessExpression(parent)
  ) {
    return true
  }
  if (
    (ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  ) {
    return true
  }
  if (ts.isBinaryExpression(parent)) {
    const operator = parent.operatorToken.kind
    return (
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      operator === ts.SyntaxKind.EqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsToken ||
      operator === ts.SyntaxKind.InKeyword
    )
  }
  if (
    ts.isJsxAttribute(parent) ||
    (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent))
  ) {
    const attribute = ts.isJsxAttribute(parent) ? parent : (parent.parent as ts.JsxAttribute)
    return SILENT_ATTRIBUTE.test(attribute.name.getText())
  }
  // Up through conditionals, `??`, arrays and parentheses to the call or `new` that takes it.
  let holder: ts.Node = parent
  while (
    ts.isConditionalExpression(holder) ||
    ts.isParenthesizedExpression(holder) ||
    ts.isArrayLiteralExpression(holder) ||
    (ts.isBinaryExpression(holder) && holder.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
  ) {
    holder = holder.parent
  }
  if (ts.isNewExpression(holder)) return holder.expression.getText().endsWith('Error')
  if (ts.isCallExpression(holder)) {
    return (
      holder.expression.kind === ts.SyntaxKind.ImportKeyword ||
      SILENT_CALL.test(holder.expression.getText())
    )
  }
  return false
}

/**
 * Whether a literal's text reads as copy: two words, or one capitalised word,
 * and not a list of class names.
 * @param text - The literal's text.
 * @returns True for copy.
 */
function readsAsCopy(text: string): boolean {
  const words = /[A-Za-z].*\s.*[A-Za-z]/.test(text) || /^[A-Z][a-z]+$/.test(text)
  return words && !(CLASS_LIST.test(text) && TAILWIND.test(text))
}

/**
 * The copy one source file renders.
 * @param relative - The file's path from the repo root.
 * @param source - The file's text.
 * @returns Each piece of copy, with its line.
 */
function copyInSource(relative: string, source: string): Copy[] {
  const file = ts.createSourceFile(
    relative,
    source,
    ts.ScriptTarget.Latest,
    true,
    relative.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const found: Copy[] = []
  /**
   * Record one piece of copy.
   * @param node - Where it starts.
   * @param raw - Its text, before whitespace is collapsed.
   */
  const add = (node: ts.Node, raw: string): void => {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (text === '') return
    const { line } = file.getLineAndCharacterOfPosition(node.getStart())
    found.push({ where: `${relative}:${String(line + 1)}`, text })
  }
  /**
   * Collect the copy at `node`, then at its children.
   * @param node - The node to check.
   */
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const { text, hasText } = jsxChildrenText(node.children)
      if (hasText) add(node, text)
    }
    const literal = literalText(node)
    if (literal !== undefined) {
      const isJsxChild = ts.isJsxExpression(node.parent) && !ts.isJsxAttribute(node.parent.parent)
      if (!isJsxChild && !isSilentPosition(node) && readsAsCopy(literal)) add(node, literal)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/**
 * Every `.ts` and `.tsx` file under a directory, as paths from the repo root.
 * A `NOT_COPY` path is skipped only when it lies below the root the walk
 * started from, so a root that names it on purpose is still read.
 * @param directory - Where to start, from the repo root.
 * @param root - The scan root the walk started from.
 * @returns The paths.
 */
function sourceFiles(directory: string, root = directory): string[] {
  const skips = NOT_COPY.filter(
    (skipped) => skipped.startsWith(`${root}/`) && skipped !== `${root}/`
  )
  return readdirSync(path.join(repoRoot, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`
    if (skips.some((skipped) => `${relative}/`.startsWith(skipped))) return []
    if (entry.isDirectory()) return sourceFiles(relative, root)
    return /\.tsx?$/.test(entry.name) ? [relative] : []
  })
}

/**
 * Every piece of copy under the scan roots.
 * @returns Each piece of copy.
 */
function sourceCopy(): Copy[] {
  return copyStyleRoots
    .flatMap((root) => sourceFiles(root))
    .flatMap((relative) =>
      copyInSource(relative, readFileSync(path.join(repoRoot, relative), 'utf8'))
    )
}

/**
 * Whether "couldn't" is left without a next step: it is in the string's last
 * sentence, so no sentence follows it.
 * @param sentences - The string's sentences, in order.
 * @returns True when the last sentence holds it.
 */
function couldntWithoutNextStep(sentences: readonly string[]): boolean {
  return /\bcouldn[’']t\b/i.test(sentences.at(-1) ?? '')
}

/**
 * What breaks the rules in one piece of copy.
 * @param text - The copy.
 * @returns Each problem, or none.
 */
function problemsIn(text: string): string[] {
  const banned = BANNED.filter((pattern) => pattern.test(text)).map(
    (pattern) => `banned ${pattern.source}`
  )
  const sentences = text.split(/(?<=[.!?…])\s+/).filter((sentence) => sentence.trim() !== '')
  const long = sentences
    .filter((sentence) => sentence.trim().split(/\s+/).length > MAX_SENTENCE_WORDS)
    .map((sentence) => `over ${String(MAX_SENTENCE_WORDS)} words: ${sentence}`)
  const couldnt = couldntWithoutNextStep(sentences) ? ['couldn’t with no next step'] : []
  return [...banned, ...long, ...couldnt]
}

/**
 * Each piece of copy that breaks a rule, as `where: problem — text`.
 * @param copy - The copy to check.
 * @returns The offenders.
 */
function offenders(copy: readonly Copy[]): string[] {
  return copy.flatMap(({ where, text }) =>
    problemsIn(text).map((problem) => `${where}: ${problem} — ${text}`)
  )
}

describe('user-facing copy', () => {
  it('flags banned phrasings and long sentences, and allows a limit or a count', () => {
    expect(problemsIn('Could not load the list.')).toHaveLength(1)
    expect(problemsIn('Your access token expired.')).toHaveLength(1)
    expect(problemsIn('It appears shortly.')).toHaveLength(1)
    expect(problemsIn('Open the most recent email.')).toHaveLength(1)
    expect(problemsIn('Name must be at most 100 characters.')).toEqual([])
    expect(problemsIn('Too many attempts. Try again in 30 seconds.')).toEqual([])
    expect(problemsIn('See how many invitations went out.')).toEqual([])
    expect(problemsIn(`${'word '.repeat(30)}end.`)).toHaveLength(1)
    expect(problemsIn(`${'word '.repeat(29)}end.`)).toEqual([])
  })

  it('allows couldn’t only when another sentence follows it', () => {
    expect(problemsIn('We couldn’t load your passkeys.')).toHaveLength(1)
    expect(problemsIn('Select Save. We couldn’t save it.')).toHaveLength(1)
    expect(problemsIn('We couldn’t load your passkeys. Select Try again to load them.')).toEqual([])
    expect(problemsIn('We couldn’t sign you in')).toHaveLength(1)
  })

  it('collects rendered text and literals, and skips code positions', () => {
    const probe = [
      "import { a } from 'probe module path'",
      "const NOTE = 'Probe constant.'",
      'const LIMIT = `Probe at most ${max} items.`',
      "console.warn('Probe log line.')",
      "throw new Error('Probe developer error.')",
      "if (mode === 'probe compared value') run()",
      "const css = cn('flex items-center gap-2', 'text-sm')",
      '// Probe comment.',
      'export const View = () => (',
      '  <p className="mt-2 text-muted-foreground" title="Probe title.">',
      '    We sent the link to <Pii>{email}</Pii>. It expires in 15 minutes.',
      '    <Button aria-label={`Probe label ${name}`}>Try again</Button>',
      '  </p>',
      ')',
    ].join('\n')
    expect(copyInSource('src/probe.tsx', probe).map((copy) => copy.text)).toEqual([
      'Probe constant.',
      'Probe at most X items.',
      'We sent the link to X. It expires in 15 minutes. X',
      'Probe title.',
      'Try again',
      'Probe label X',
    ])
  })

  it('finds the copy it guards', () => {
    const texts = sourceCopy().map((copy) => copy.text)
    expect(texts.length).toBeGreaterThan(500)
    expect(texts).toContain('Try again')
    expect(texts).toContain('Check your inbox')
  })

  it('breaks no copy rule', () => {
    expect(offenders(sourceCopy())).toEqual([])
  })
})
