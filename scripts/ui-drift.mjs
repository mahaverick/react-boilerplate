#!/usr/bin/env node
/**
 * @file `pnpm ui:drift`: compares every vendored `src/components/ui/*.tsx`
 * with its registry snapshot in scripts/ui-registry/ and prints, per file,
 * `ok` or each change the record (docs/ui-local-edits.md) does not explain.
 * It reads only the repo, so CI runs it. `pnpm ui:drift:refresh` rewrites
 * the snapshot from the registry through the installed `shadcn` devDependency,
 * which needs the network.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const UI_DIR = 'src/components/ui'
const SNAPSHOT_DIR = 'scripts/ui-registry'
const MANIFEST = `${SNAPSHOT_DIR}/manifest.json`
const RECORD = 'docs/ui-local-edits.md'

/** The reason `formatDrift` prints, which the record must replace with a real one. */
export const PLACEHOLDER_REASON = '<why we differ>'

/** A record (docs/ui-local-edits.md) the check cannot read: reported as one line, not a stack. */
export class RecordError extends Error {
  name = 'RecordError'
}

const REWRITE = /^(ours|theirs):\s*s\/((?:\\\/|[^/])*)\/((?:\\\/|[^/])*)\/(g?)\s*$/

/**
 * The drift rules in the record: per `### <file>` heading (`*` for every
 * file), the lines of its ```ui-drift blocks and each ```ui-drift-hunk block.
 * `skip` marks a file that is ours; `ours: s/<re>/<to>/` rewrites our lines
 * and `theirs: s/<re>/<to>/` the registry's before they are compared. A hunk
 * block starts with `reason: <text>`, may give `at: <registry line>` and one
 * ` <line>` context line (the nearest non-blank registry line before it),
 * then lists the registry's lines as `-<line>` and ours as `+<line>`. A hunk
 * that only adds lines needs the context line or `at:`, or it would match
 * the same lines added anywhere.
 * @param markdown - docs/ui-local-edits.md.
 * @returns File name to rules.
 */
export function parseRules(markdown) {
  const rules = new Map()
  let file = null
  let block = null
  let hunk = null
  /**
   * Adds one rule under the current heading.
   * @param rule - The rule.
   */
  const add = (rule) => {
    if (!file) throw new RecordError(`${RECORD}: a ui-drift block before any ### heading`)
    rules.set(file, [...(rules.get(file) ?? []), rule])
  }
  /**
   * Fails a hunk line the format does not allow.
   * @param line - The line.
   */
  const unreadable = (line) => {
    throw new RecordError(`${RECORD}: cannot read hunk line "${line}" under ${file}`)
  }
  for (const line of markdown.split('\n')) {
    if (!block) {
      const heading = /^###\s+`?([*\w.-]+)`?\s*$/.exec(line)
      if (heading) file = heading[1] ?? null
      const fence = /^```(ui-drift|ui-drift-hunk)\s*$/.exec(line)
      if (fence) block = fence[1]
      if (block === 'ui-drift-hunk') hunk = { side: 'hunk', reason: '', theirs: [], ours: [] }
      continue
    }
    if (/^```\s*$/.test(line)) {
      if (hunk) {
        if (!hunk.reason) throw new RecordError(`${RECORD}: a hunk under ${file} has no reason`)
        if (file === '*') throw new RecordError(`${RECORD}: a hunk belongs to one file, not to *`)
        if (hunk.theirs.length === 0 && hunk.context === undefined && hunk.at === undefined)
          throw new RecordError(
            `${RECORD}: a hunk under ${file} only adds lines; give it its context line or at:`
          )
        add(hunk)
      }
      block = null
      hunk = null
      continue
    }
    if (hunk) {
      const changed = hunk.theirs.length + hunk.ours.length > 0
      const reason = /^reason:\s*(\S.*)$/.exec(line)
      const at = /^at:\s*(\d+)\s*$/.exec(line)
      if (!hunk.reason) {
        const text = (reason?.[1] ?? '').trim()
        if (!reason || /^<[^>]*>$/.test(text)) unreadable(line)
        hunk.reason = text
      } else if (at && !changed && hunk.at === undefined) hunk.at = Number(at[1])
      else if (line.startsWith(' ') && !changed && hunk.context === undefined)
        hunk.context = line.slice(1)
      else if (line.startsWith('-') || line.startsWith('+'))
        (line.startsWith('-') ? hunk.theirs : hunk.ours).push(line.slice(1))
      else unreadable(line)
      continue
    }
    if (line.trim() === '') continue
    if (line.trim() === 'skip') {
      add({ side: 'skip' })
      continue
    }
    const rule = REWRITE.exec(line.trim())
    if (!rule) throw new RecordError(`${RECORD}: cannot read rule "${line.trim()}" under ${file}`)
    add({
      side: rule[1],
      pattern: new RegExp((rule[2] ?? '').replaceAll('\\/', '/'), rule[4]),
      replacement: (rule[3] ?? '').replaceAll('\\/', '/'),
    })
  }
  return rules
}

/**
 * The file `shadcn add <name> --view <file>` prints, or null when the output
 * has no `├ <file> (…) N lines` section or the section does not hold N lines:
 * output in a format this script does not read must not become a snapshot.
 * @param output - The CLI's stdout.
 * @param file - The exact path, e.g. `src/components/ui/field.tsx`.
 * @returns The file's text.
 */
export function viewContent(output, file) {
  let expected = null
  let lines = null
  for (const line of output.split('\n')) {
    const section = /^├ (\S+) \([^)]*\) (\d+) lines$/.exec(line)
    if (section) {
      if (lines) break
      if (section[1] === file) expected = Number(section[2])
      continue
    }
    if (expected === null) continue
    if (/^│ ┌/.test(line)) lines = []
    else if (/^│ └/.test(line)) break
    else if (lines) {
      const content = /^│ │ ?(.*)$/.exec(line)
      if (!content) return null
      lines.push(content[1] ?? '')
    }
  }
  if (!lines || lines.length !== expected) return null
  return lines.join('\n')
}

/**
 * The changes from the registry's lines to ours, as hunks of consecutive
 * changed lines (a longest-common-subsequence diff, so the same two files
 * always give the same hunks). Each hunk carries its context: the nearest
 * non-blank registry line before it.
 * @param theirs - The registry file's lines.
 * @param ours - The vendored file's lines.
 * @returns Each hunk: its first registry line (1-based), context, the registry's lines and ours.
 */
export function diffLines(theirs, ours) {
  const width = ours.length + 1
  const common = new Uint32Array((theirs.length + 1) * width)
  for (let i = theirs.length - 1; i >= 0; i -= 1)
    for (let j = ours.length - 1; j >= 0; j -= 1)
      common[i * width + j] =
        theirs[i] === ours[j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0)
  const hunks = []
  let open = null
  let i = 0
  let j = 0
  while (i < theirs.length || j < ours.length) {
    if (i < theirs.length && j < ours.length && theirs[i] === ours[j]) {
      open = null
      i += 1
      j += 1
      continue
    }
    if (!open) {
      const context = theirs.slice(0, i).findLast((line) => line.trim() !== '')
      open = { at: i + 1, ...(context === undefined ? {} : { context }), theirs: [], ours: [] }
      hunks.push(open)
    }
    const dropTheirs =
      j >= ours.length ||
      (i < theirs.length && (common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0))
    if (dropTheirs) {
      open.theirs.push(theirs[i] ?? '')
      i += 1
    } else {
      open.ours.push(ours[j] ?? '')
      j += 1
    }
  }
  return hunks
}

/**
 * The lines of one hunk the line rules leave: a blank line, a line a rule
 * turns blank, or a line that then equals a line on the other side, is
 * explained.
 * @param change - The registry's lines and ours.
 * @param rules - The global and per-file rules for this file.
 * @returns The unexplained lines, as they are in the files.
 */
export function unrecorded(change, rules) {
  /**
   * A line after every rule of one side has rewritten it.
   * @param side - `ours` or `theirs`.
   * @param line - The changed line.
   * @returns The rewritten line.
   */
  const rewrite = (side, line) =>
    rules
      .filter((rule) => rule.side === side)
      .reduce((text, rule) => text.replace(rule.pattern, rule.replacement), line)
  /**
   * Whether a line is still to be explained. A blank line carries no
   * behaviour (a removed `"use client"` takes the blank line after it along).
   * @param entry - A line and its rewrite.
   * @returns False when the line is, or a rule made it, blank.
   */
  const kept = (entry) => entry.text.trim() !== ''
  const open = change.ours.map((line) => ({ line, text: rewrite('ours', line) })).filter(kept)
  const leftTheirs = change.theirs
    .map((line) => ({ line, text: rewrite('theirs', line) }))
    .filter(kept)
    .filter((entry) => {
      const index = open.findIndex((candidate) => candidate.text === entry.text)
      if (index === -1) return true
      open.splice(index, 1)
      return false
    })
  return { ours: open.map((entry) => entry.line), theirs: leftTheirs.map((entry) => entry.line) }
}

/**
 * Whether two line lists are the same, line for line.
 * @param left - One list.
 * @param right - The other.
 * @returns True when equal.
 */
const sameLines = (left, right) =>
  left.length === right.length && left.every((line, index) => line === right[index])

/**
 * One vendored file against its registry snapshot: each hunk the line rules
 * leave must equal one recorded hunk (its lines, and its context and `at:`
 * where the record gives them), and each recorded hunk must explain one.
 * @param ours - The vendored file's text.
 * @param theirs - The snapshot's text.
 * @param rules - The global and per-file rules for this file.
 * @returns The unexplained hunks, and the recorded hunks that explained none.
 */
export function checkFile(ours, theirs, rules) {
  const recorded = rules.filter((rule) => rule.side === 'hunk')
  const used = new Set()
  const drift = []
  for (const hunk of diffLines(theirs.split('\n'), ours.split('\n'))) {
    const left = unrecorded(hunk, rules)
    if (left.ours.length === 0 && left.theirs.length === 0) continue
    const match = recorded.findIndex(
      (rule, index) =>
        !used.has(index) &&
        sameLines(rule.theirs, left.theirs) &&
        sameLines(rule.ours, left.ours) &&
        (rule.context === undefined || rule.context === hunk.context) &&
        (rule.at === undefined || rule.at === hunk.at)
    )
    const anchor = hunk.context === undefined ? {} : { context: hunk.context }
    if (match === -1) drift.push({ at: hunk.at, ...anchor, ...left })
    else used.add(match)
  }
  return { drift, stale: recorded.filter((_, index) => !used.has(index)) }
}

/**
 * The report for one unexplained hunk, ending in the block that records it,
 * anchored by its context line (or `at:` when nothing precedes it).
 * @param file - The vendored file's name, e.g. `tabs.tsx`.
 * @param hunk - From `checkFile`.
 * @returns The lines to print.
 */
export function formatDrift(file, hunk) {
  return [
    `${file}: unrecorded drift at registry line ${String(hunk.at)}. If intended, record it under ### ${file}, with a real reason:`,
    '```ui-drift-hunk',
    `reason: ${PLACEHOLDER_REASON}`,
    hunk.context === undefined ? `at: ${String(hunk.at)}` : ` ${hunk.context}`,
    ...hunk.theirs.map((line) => `-${line}`),
    ...hunk.ours.map((line) => `+${line}`),
    '```',
  ]
}

/**
 * Reads a JSON file under the root, or null when it is absent.
 * @param root - The repo root.
 * @param file - The path under it.
 * @returns The parsed value.
 */
const readJson = (root, file) => {
  const full = path.join(root, file)
  return fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8')) : null
}

/**
 * What the snapshot must have been taken with: the `shadcn` devDependency in
 * package.json, and `components.json`'s style and icon library.
 * @param root - The repo root.
 * @returns The manifest the snapshot directory must hold.
 */
export function expectedManifest(root) {
  const pkg = readJson(root, 'package.json')
  const components = readJson(root, 'components.json')
  return {
    shadcn: pkg?.devDependencies?.shadcn ?? null,
    style: components?.style ?? null,
    iconLibrary: components?.iconLibrary ?? null,
  }
}

/**
 * The record, the compared `.tsx` files and the entries the check cannot
 * compare (anything in the ui directory that is not a top-level `.tsx` file).
 * @param root - The repo root.
 * @returns Rules per file, file names and foreign entries, sorted.
 */
function vendored(root) {
  const record = parseRules(fs.readFileSync(path.join(root, RECORD), 'utf8'))
  const entries = fs.readdirSync(path.join(root, UI_DIR), { withFileTypes: true })
  /**
   * Whether an entry is a file the check compares.
   * @param entry - A directory entry.
   * @returns True for a top-level `.tsx` file.
   */
  const isTsx = (entry) => entry.isFile() && entry.name.endsWith('.tsx')
  return {
    record,
    files: entries
      .filter(isTsx)
      .map((entry) => entry.name)
      .sort(),
    foreign: entries
      .filter((entry) => !isTsx(entry))
      .map((entry) => entry.name)
      .sort(),
  }
}

/**
 * Whether a file's section marks it as ours.
 * @param record - From `parseRules`.
 * @param file - The vendored file's name.
 * @returns True when skipped.
 */
const skipped = (record, file) => (record.get(file) ?? []).some((rule) => rule.side === 'skip')

/**
 * The installed CLI, run from the repo root: lockfile-verified, never a download.
 * @param root - The repo root.
 * @returns The two calls refresh makes.
 */
const installedCli = (root) => ({
  version: () =>
    execFileSync('pnpm', ['exec', 'shadcn', '--version'], { cwd: root, encoding: 'utf8' }).trim(),
  view: (name, file) =>
    execFileSync('pnpm', ['exec', 'shadcn', 'add', name, '--view', file], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
})

/**
 * Retakes scripts/ui-registry/ from the registry. Every file is written to a
 * fresh directory first, and the directory replaces the old one only when
 * all of them, and the manifest, are written.
 * @param root - The repo root.
 * @param [cli] - The CLI calls; the installed `shadcn` by default.
 * @returns The snapshot files written.
 */
export function refresh(root, cli = installedCli(root)) {
  const { record, files } = vendored(root)
  const manifest = expectedManifest(root)
  const installed = cli.version()
  if (installed !== manifest.shadcn)
    throw new Error(
      `the installed shadcn is ${installed}, package.json pins ${String(manifest.shadcn)}; run pnpm install`
    )
  const target = path.join(root, SNAPSHOT_DIR)
  const next = fs.mkdtempSync(`${target}.next-`)
  // mkdtemp creates the directory 0700; the snapshot is ordinary repo content.
  fs.chmodSync(next, 0o755)
  try {
    const written = []
    for (const entry of files) {
      if (skipped(record, entry)) continue
      const file = `${UI_DIR}/${entry}`
      const output = cli.view(path.basename(entry, '.tsx'), file)
      const content = viewContent(output, file)
      if (content === null) throw new Error(`${entry}: unreadable CLI output:\n${output}`)
      fs.writeFileSync(path.join(next, entry), content)
      written.push(entry)
    }
    fs.writeFileSync(path.join(next, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    const previous = `${target}.previous`
    fs.rmSync(previous, { recursive: true, force: true })
    if (fs.existsSync(target)) fs.renameSync(target, previous)
    fs.renameSync(next, target)
    fs.rmSync(previous, { recursive: true, force: true })
    return written
  } finally {
    fs.rmSync(next, { recursive: true, force: true })
  }
}

/**
 * Checks every vendored file against its snapshot.
 * @param root - The repo root.
 * @returns One line per file that passed or is skipped, and one entry per problem.
 */
export function check(root) {
  const { record, files, foreign } = vendored(root)
  const global = record.get('*') ?? []
  const passed = []
  const problems = []
  const manifest = readJson(root, MANIFEST) ?? {}
  const expected = expectedManifest(root)
  if (!/^\d+\.\d+\.\d+$/.test(String(expected.shadcn)))
    problems.push(
      `package.json: devDependencies.shadcn is ${String(expected.shadcn)}; pin it exactly (e.g. 4.21.4), since the snapshot is taken with that version`
    )
  for (const [key, value] of Object.entries(expected))
    if (manifest[key] !== value)
      problems.push(
        `${MANIFEST}: ${key} is ${String(manifest[key] ?? 'missing')}, the repo has ${String(value)}; run pnpm ui:drift:refresh`
      )
  for (const entry of foreign)
    problems.push(`${UI_DIR}/${entry}: not a top-level .tsx file, so ui:drift cannot compare it`)
  const compared = new Set()
  for (const entry of files) {
    if (skipped(record, entry)) {
      passed.push(`${entry}: ours (skipped)`)
      if ((record.get(entry) ?? []).some((rule) => rule.side === 'hunk'))
        problems.push(`${RECORD}: ### ${entry} is skipped but records hunks`)
      continue
    }
    compared.add(entry)
    const snapshot = path.join(root, SNAPSHOT_DIR, entry)
    if (!fs.existsSync(snapshot)) {
      problems.push(`${entry}: no registry snapshot; run pnpm ui:drift:refresh`)
      continue
    }
    const { drift, stale } = checkFile(
      fs.readFileSync(path.join(root, UI_DIR, entry), 'utf8'),
      fs.readFileSync(snapshot, 'utf8'),
      [...global, ...(record.get(entry) ?? [])]
    )
    for (const hunk of drift) problems.push(formatDrift(entry, hunk).join('\n'))
    for (const hunk of stale)
      problems.push(
        `${entry}: recorded hunk "${hunk.reason}" matches no change; update it or remove it in ${RECORD}`
      )
    if (drift.length === 0 && stale.length === 0) passed.push(`${entry}: ok`)
  }
  const scripts = path.join(root, path.dirname(SNAPSHOT_DIR))
  const leftover = new RegExp(`^${path.basename(SNAPSHOT_DIR)}\\.(?:next-.*|previous)$`)
  for (const entry of fs.existsSync(scripts) ? fs.readdirSync(scripts).sort() : [])
    if (leftover.test(entry))
      problems.push(`scripts/${entry}: left by an interrupted refresh; delete it`)
  const snapshotDir = path.join(root, SNAPSHOT_DIR)
  const snapshots = fs.existsSync(snapshotDir) ? fs.readdirSync(snapshotDir).sort() : []
  for (const entry of snapshots)
    if (entry !== 'manifest.json' && !compared.has(entry))
      problems.push(
        `${SNAPSHOT_DIR}/${entry}: no vendored file to compare; run pnpm ui:drift:refresh`
      )
  for (const heading of record.keys())
    if (heading !== '*' && !files.includes(heading))
      problems.push(`${RECORD}: ### ${heading} names no file in ${UI_DIR}`)
  return { passed, problems }
}

/**
 * The command line: `--refresh` retakes the snapshot, otherwise the check
 * runs and the exit code is 1 on any problem.
 */
function main() {
  const root = process.cwd()
  if (process.argv.includes('--refresh')) {
    for (const entry of refresh(root)) console.log(`${entry}: snapshot written`)
    return
  }
  const { passed, problems } = check(root)
  for (const line of passed) console.log(line)
  for (const problem of problems) console.log(problem)
  process.exitCode = problems.length > 0 ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main()
  } catch (error) {
    if (!(error instanceof RecordError)) throw error
    console.error(`ui:drift: ${error.message}`)
    process.exitCode = 1
  }
}
