#!/usr/bin/env node
/**
 * @file `pnpm ui:drift`: compares every vendored `src/components/ui/*.tsx`
 * with its registry snapshot in scripts/ui-registry/ and prints, per file,
 * `ok` or each change the record (docs/ui-local-edits.md) does not explain.
 * It reads only the repo, so CI runs it. `pnpm ui:drift:refresh` rewrites
 * the snapshot from the registry through the pinned CLI, which needs the
 * network.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The CLI the registry is read through, pinned so a CLI release cannot move the baseline. */
export const SHADCN = 'shadcn@4.21.4'

const UI_DIR = 'src/components/ui'
const SNAPSHOT_DIR = 'scripts/ui-registry'
const MANIFEST = `${SNAPSHOT_DIR}/manifest.json`
const RECORD = 'docs/ui-local-edits.md'

const REWRITE = /^(ours|theirs):\s*s\/((?:\\\/|[^/])*)\/((?:\\\/|[^/])*)\/(g?)\s*$/

/**
 * The drift rules in the record: per `### <file>` heading (`*` for every
 * file), the lines of its ```ui-drift blocks and each ```ui-drift-hunk block.
 * `skip` marks a file that is ours; `ours: s/<re>/<to>/` rewrites our lines
 * and `theirs: s/<re>/<to>/` the registry's before they are compared. A hunk
 * block starts with `reason: <text>`, then lists the registry's lines as
 * `-<line>` and ours as `+<line>`.
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
    if (!file) throw new Error(`${RECORD}: a ui-drift block before any ### heading`)
    rules.set(file, [...(rules.get(file) ?? []), rule])
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
        if (!hunk.reason) throw new Error(`${RECORD}: a hunk under ${file} has no reason`)
        if (file === '*') throw new Error(`${RECORD}: a hunk belongs to one file, not to *`)
        add(hunk)
      }
      block = null
      hunk = null
      continue
    }
    if (hunk) {
      const reason = /^reason:\s*(\S.*)$/.exec(line)
      if (!hunk.reason && reason) hunk.reason = (reason[1] ?? '').trim()
      else if (hunk.reason && (line.startsWith('-') || line.startsWith('+')))
        (line.startsWith('-') ? hunk.theirs : hunk.ours).push(line.slice(1))
      else throw new Error(`${RECORD}: cannot read hunk line "${line}" under ${file}`)
      continue
    }
    if (line.trim() === '') continue
    if (line.trim() === 'skip') {
      add({ side: 'skip' })
      continue
    }
    const rule = REWRITE.exec(line.trim())
    if (!rule) throw new Error(`${RECORD}: cannot read rule "${line.trim()}" under ${file}`)
    add({
      side: rule[1],
      pattern: new RegExp((rule[2] ?? '').replaceAll('\\/', '/'), rule[4]),
      replacement: (rule[3] ?? '').replaceAll('\\/', '/'),
    })
  }
  return rules
}

/**
 * The file `shadcn add <target> --view <path>` prints, or null when the
 * output has no `├ …/<target>.tsx (…) N lines` section or the section does not
 * hold N lines: output in a format this script does not read must not become
 * a snapshot.
 * @param output - The CLI's stdout.
 * @param target - Component name, e.g. `field`.
 * @returns The file's text.
 */
export function viewContent(output, target) {
  let expected = null
  let lines = null
  for (const line of output.split('\n')) {
    const section = /^├ (\S+) \([^)]*\) (\d+) lines$/.exec(line)
    if (section) {
      if (lines) break
      if ((section[1] ?? '').endsWith(`/${target}.tsx`)) expected = Number(section[2])
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
 * always give the same hunks).
 * @param theirs - The registry file's lines.
 * @param ours - The vendored file's lines.
 * @returns Each hunk: its first registry line (1-based), the registry's lines and ours.
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
      open = { at: i + 1, theirs: [], ours: [] }
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
 * leave must equal one recorded hunk, and each recorded hunk must explain one.
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
        !used.has(index) && sameLines(rule.theirs, left.theirs) && sameLines(rule.ours, left.ours)
    )
    if (match === -1) drift.push({ at: hunk.at, ...left })
    else used.add(match)
  }
  return { drift, stale: recorded.filter((_, index) => !used.has(index)) }
}

/**
 * The report for one unexplained hunk, ending in the block that records it.
 * @param file - The vendored file's name, e.g. `tabs.tsx`.
 * @param hunk - From `checkFile`.
 * @returns The lines to print.
 */
export function formatDrift(file, hunk) {
  return [
    `${file}: unrecorded drift at registry line ${hunk.at}. If intended, record it under ### ${file}:`,
    '```ui-drift-hunk',
    'reason: <why we differ>',
    ...hunk.theirs.map((line) => `-${line}`),
    ...hunk.ours.map((line) => `+${line}`),
    '```',
  ]
}

/**
 * The record and the vendored files.
 * @returns Rules per file and the vendored file names, sorted.
 */
function vendored() {
  const record = parseRules(fs.readFileSync(RECORD, 'utf8'))
  const files = fs
    .readdirSync(UI_DIR)
    .filter((entry) => entry.endsWith('.tsx'))
    .sort()
  return { record, files }
}

/**
 * Whether a file's section marks it as ours.
 * @param record - From `parseRules`.
 * @param file - The vendored file's name.
 * @returns True when skipped.
 */
const skipped = (record, file) => (record.get(file) ?? []).some((rule) => rule.side === 'skip')

/** Rewrites scripts/ui-registry/ from the registry through the pinned CLI. */
function refresh() {
  const { record, files } = vendored()
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true })
  const wanted = new Set()
  for (const entry of files) {
    if (skipped(record, entry)) continue
    const name = path.basename(entry, '.tsx')
    const output = execFileSync(
      'pnpm',
      ['dlx', SHADCN, 'add', name, '--view', `${UI_DIR}/${entry}`],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const content = viewContent(output, name)
    if (content === null) throw new Error(`${entry}: unreadable CLI output:\n${output}`)
    fs.writeFileSync(`${SNAPSHOT_DIR}/${entry}`, content)
    wanted.add(entry)
    console.log(`${entry}: snapshot written`)
  }
  for (const entry of fs.readdirSync(SNAPSHOT_DIR))
    if (entry.endsWith('.tsx') && !wanted.has(entry)) {
      fs.rmSync(`${SNAPSHOT_DIR}/${entry}`)
      console.log(`${entry}: snapshot removed`)
    }
  fs.writeFileSync(MANIFEST, `${JSON.stringify({ cli: SHADCN }, null, 2)}\n`)
}

/** Checks every vendored file against its snapshot and exits 1 on any problem. */
function check() {
  const { record, files } = vendored()
  const global = record.get('*') ?? []
  let problems = 0
  /**
   * Prints one problem and counts it.
   * @param lines - What to print.
   */
  const fail = (...lines) => {
    problems += 1
    for (const line of lines) console.log(line)
  }
  const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : {}
  if (manifest.cli !== SHADCN)
    fail(
      `${MANIFEST}: taken with ${manifest.cli ?? 'nothing'}, not ${SHADCN}; run pnpm ui:drift:refresh`
    )
  const checked = new Set()
  for (const entry of files) {
    if (skipped(record, entry)) {
      console.log(`${entry}: ours (skipped)`)
      continue
    }
    checked.add(entry)
    const snapshot = `${SNAPSHOT_DIR}/${entry}`
    if (!fs.existsSync(snapshot)) {
      fail(`${entry}: no registry snapshot; run pnpm ui:drift:refresh`)
      continue
    }
    const { drift, stale } = checkFile(
      fs.readFileSync(`${UI_DIR}/${entry}`, 'utf8'),
      fs.readFileSync(snapshot, 'utf8'),
      [...global, ...(record.get(entry) ?? [])]
    )
    for (const hunk of drift) fail(...formatDrift(entry, hunk))
    for (const hunk of stale)
      fail(
        `${entry}: recorded hunk "${hunk.reason}" matches no change; update it or remove it in ${RECORD}`
      )
    if (drift.length === 0 && stale.length === 0) console.log(`${entry}: ok`)
  }
  const snapshots = fs.existsSync(SNAPSHOT_DIR) ? fs.readdirSync(SNAPSHOT_DIR).sort() : []
  for (const entry of snapshots)
    if (entry.endsWith('.tsx') && !checked.has(entry))
      fail(`${SNAPSHOT_DIR}/${entry}: no vendored file to compare; run pnpm ui:drift:refresh`)
  for (const [entry, rules] of record)
    if (rules.some((rule) => rule.side === 'hunk') && !checked.has(entry))
      fail(`${RECORD}: ### ${entry} records hunks, but no compared file has that name`)
  process.exitCode = problems > 0 ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.includes('--refresh')) refresh()
  else check()
}
