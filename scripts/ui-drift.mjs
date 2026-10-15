#!/usr/bin/env node
/**
 * @file `pnpm ui:drift`: compares every vendored `src/components/ui/*.tsx`
 * with the shadcn registry and prints, per file, `ok` or the lines our
 * recorded edits (docs/ui-local-edits.md) do not explain. It needs the
 * network, so it is a local check, not part of CI.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The CLI the registry is read through, pinned so a CLI release cannot move the baseline. */
export const SHADCN = 'shadcn@4.21.4'

/**
 * The drift rules in the record: per `### <file>` heading (`*` for every
 * file), the lines of its ```ui-drift block. `skip` marks a file that is ours;
 * `ours: s/<re>/<to>/` rewrites our lines and `theirs: s/<re>/<to>/` the
 * registry's before they are compared.
 * @param markdown - docs/ui-local-edits.md.
 * @returns File name to rules.
 */
export function parseRules(markdown) {
  const rules = new Map()
  let file = null
  let inBlock = false
  for (const line of markdown.split('\n')) {
    if (!inBlock) {
      const heading = /^###\s+`?([*\w.-]+)`?\s*$/.exec(line)
      if (heading) file = heading[1] ?? null
      if (/^```ui-drift\s*$/.test(line)) inBlock = true
      continue
    }
    if (/^```\s*$/.test(line)) {
      inBlock = false
      continue
    }
    if (!file || line.trim() === '') continue
    const list = rules.get(file) ?? []
    if (line.trim() === 'skip') list.push({ side: 'skip' })
    else {
      const rule = /^(ours|theirs):\s*s\/((?:\\\/|[^/])*)\/((?:\\\/|[^/])*)\/(g?)\s*$/.exec(
        line.trim()
      )
      if (!rule)
        throw new Error(`ui-local-edits.md: cannot read rule "${line.trim()}" under ${file}`)
      list.push({
        side: rule[1],
        pattern: new RegExp(rule[2].replaceAll('\\/', '/'), rule[4]),
        replacement: rule[3].replaceAll('\\/', '/'),
      })
    }
    rules.set(file, list)
  }
  return rules
}

/**
 * The changed lines of `shadcn add <name> --diff` output: `-` lines are ours,
 * `+` lines the registry's; file headers and context are dropped. The CLI
 * also diffs the components a component depends on, so with `target` only the
 * section of `<target>.tsx` is read; each dependency is checked on its own.
 * @param output - The CLI's stdout.
 * @param [target] - Component name, e.g. `field`; omitted reads every section.
 * @returns The two sides.
 */
export function changedLines(output, target) {
  const ours = []
  const theirs = []
  let inTarget = target === undefined
  for (const line of output.split('\n')) {
    const section = /^├ (\S+)/.exec(line)
    if (section) {
      inTarget = target === undefined || (section[1] ?? '').endsWith(`/${target}.tsx`)
      continue
    }
    if (!inTarget) continue
    const match = /^│ │ ([+-])(.*)$/.exec(line)
    if (!match || /^(?:---|\+\+\+) [ab]\//.test(`${match[1]}${match[2]}`)) continue
    ;(match[1] === '-' ? ours : theirs).push(match[2])
  }
  return { ours, theirs }
}

/**
 * The changed lines left once the rules have rewritten both sides: a line
 * that becomes empty, or that now equals a line on the other side, is
 * explained.
 * @param change - From `changedLines`.
 * @param rules - The global and per-file rules for this file.
 * @returns The unexplained lines.
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
  const open = change.ours
    .map((line) => ({ line, text: rewrite('ours', line) }))
    .filter((entry) => entry.text.trim() !== '')
  const leftTheirs = change.theirs
    .map((line) => ({ line, text: rewrite('theirs', line) }))
    .filter((entry) => {
      if (entry.text.trim() === '') return false
      const index = open.findIndex((candidate) => candidate.text === entry.text)
      if (index === -1) return true
      open.splice(index, 1)
      return false
    })
  return { ours: open.map((entry) => entry.line), theirs: leftTheirs.map((entry) => entry.line) }
}

/** Runs the check over src/components/ui and exits 1 when any file has unrecorded drift. */
function main() {
  const record = parseRules(fs.readFileSync('docs/ui-local-edits.md', 'utf8'))
  const global = record.get('*') ?? []
  let drifted = 0
  for (const entry of fs.readdirSync('src/components/ui').sort()) {
    if (!entry.endsWith('.tsx')) continue
    const own = record.get(entry) ?? []
    if (own.some((rule) => rule.side === 'skip')) {
      console.log(`${entry}: ours (skipped)`)
      continue
    }
    const output = execFileSync(
      'pnpm',
      ['dlx', SHADCN, 'add', path.basename(entry, '.tsx'), '--diff'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
    const left = unrecorded(changedLines(output, path.basename(entry, '.tsx')), [...global, ...own])
    if (left.ours.length === 0 && left.theirs.length === 0) {
      console.log(`${entry}: ok`)
      continue
    }
    drifted += 1
    console.log(`${entry}: unrecorded drift`)
    for (const line of left.ours) console.log(`  - ${line}`)
    for (const line of left.theirs) console.log(`  + ${line}`)
  }
  process.exitCode = drifted > 0 ? 1 : 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()
