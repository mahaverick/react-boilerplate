import { describe, expect, it } from 'vitest'
import {
  checkFile,
  diffLines,
  formatDrift,
  parseRules,
  unrecorded,
  viewContent,
  type Rule,
} from '../../scripts/ui-drift.mjs'

const RECORD = `
### *

\`\`\`ui-drift
ours: s/ aria-hidden="true"//
ours: s/^"use client"$//
\`\`\`

### form.tsx

\`\`\`ui-drift
skip
\`\`\`

### tabs.tsx

\`\`\`ui-drift-hunk
reason: the panel keeps a focus ring
-      className={cn("flex-1 text-sm outline-none", className)}
+      className={cn(
+        "flex-1 rounded-md text-sm outline-none",
+        className
+      )}
\`\`\`
`

const THEIRS = [
  'function TabsContent({ className, ...props }) {',
  '  return (',
  '    <Panel',
  '      className={cn("flex-1 text-sm outline-none", className)}',
  '      {...props}',
  '    />',
  '  )',
  '}',
  '',
].join('\n')

const OURS = [
  '"use client"',
  '',
  'function TabsContent({ className, ...props }) {',
  '  return (',
  '    <Panel',
  '      className={cn(',
  '        "flex-1 rounded-md text-sm outline-none",',
  '        className',
  '      )}',
  '      {...props}',
  '    />',
  '  )',
  '}',
  '',
].join('\n')

/**
 * The global and per-file rules for one file of a record.
 * @param record - The record's markdown.
 * @param file - The vendored file's name.
 * @returns The rules `checkFile` takes.
 */
const rulesFor = (record: string, file: string): Rule[] => {
  const rules = parseRules(record)
  return [...(rules.get('*') ?? []), ...(rules.get(file) ?? [])]
}

describe('parseRules', () => {
  it('reads the global block, skip markers and recorded hunks', () => {
    const rules = parseRules(RECORD)
    expect(rules.get('*')).toHaveLength(2)
    expect(rules.get('form.tsx')).toEqual([{ side: 'skip' }])
    expect(rules.get('tabs.tsx')).toEqual([
      {
        side: 'hunk',
        reason: 'the panel keeps a focus ring',
        theirs: ['      className={cn("flex-1 text-sm outline-none", className)}'],
        ours: [
          '      className={cn(',
          '        "flex-1 rounded-md text-sm outline-none",',
          '        className',
          '      )}',
        ],
      },
    ])
  })

  it('rejects a hunk without a reason, under *, or with a line that is not - or +', () => {
    /**
     * A record of one hunk block.
     * @param heading - The section's file.
     * @param body - The block's lines.
     * @returns The markdown.
     */
    const hunk = (heading: string, body: string) =>
      `### ${heading}\n\n\`\`\`ui-drift-hunk\n${body}\n\`\`\`\n`
    expect(() => parseRules(hunk('tabs.tsx', '-a\n+b'))).toThrow(/cannot read hunk line/)
    expect(() => parseRules(hunk('tabs.tsx', 'reason:   '))).toThrow(/cannot read hunk line/)
    expect(() => parseRules(hunk('*', 'reason: everywhere\n-a'))).toThrow(/not to \*/)
    expect(() => parseRules(hunk('tabs.tsx', 'reason: x\n a'))).toThrow(/cannot read hunk line/)
    expect(() => parseRules('### tabs.tsx\n\n```ui-drift-hunk\n```\n')).toThrow(/no reason/)
  })

  it('rejects a rewrite it cannot read', () => {
    expect(() => parseRules('### a.tsx\n\n```ui-drift\nours: a -> b\n```\n')).toThrow(
      /cannot read rule/
    )
  })
})

describe('viewContent', () => {
  /**
   * CLI output with a dependency's section, then the target's.
   * @param lines - The target section's body lines.
   * @param count - The line count its header claims.
   * @returns The output.
   */
  const view = (lines: string[], count = lines.length) =>
    [
      '┌ shadcn add field (dry run)',
      '│',
      '├ src/components/ui/separator.tsx (overwrite) 1 lines',
      '│ ┌──────',
      '│ │ separator',
      '│ └──────',
      `├ src/components/ui/field.tsx (overwrite) ${String(count)} lines`,
      '│ ┌──────',
      ...lines,
      '│ └──────',
      '└ Run without --dry-run to apply.',
    ].join('\n')

  it("reads only the target's section, an empty line with or without its space", () => {
    expect(viewContent(view(['│ │ import x', '│ │ ', '│ │   y', '│ │']), 'field')).toBe(
      'import x\n\n  y\n'
    )
  })

  it('returns null for a missing section, a short section or an unknown line', () => {
    expect(viewContent(view(['│ │ a']), 'dialog')).toBeNull()
    expect(viewContent(view(['│ │ a'], 2), 'field')).toBeNull()
    expect(viewContent(view(['│ │ a', 'stray']), 'field')).toBeNull()
    expect(viewContent('Something went wrong', 'field')).toBeNull()
  })
})

describe('diffLines', () => {
  it('finds no hunk in identical files', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('groups consecutive changes into hunks, numbered by registry line', () => {
    expect(diffLines(['a', 'b', 'c', 'd'], ['x', 'a', 'B', 'c'])).toEqual([
      { at: 1, theirs: [], ours: ['x'] },
      { at: 2, theirs: ['b'], ours: ['B'] },
      { at: 4, theirs: ['d'], ours: [] },
    ])
  })
})

describe('unrecorded', () => {
  const rules = rulesFor(RECORD, 'dialog.tsx')

  it('drops lines a rule explains, and blank lines', () => {
    const change = {
      ours: ['"use client"', '', '  <IconX aria-hidden="true" />'],
      theirs: ['  <IconX />'],
    }
    expect(unrecorded(change, rules)).toEqual({ ours: [], theirs: [] })
  })

  it('keeps a change no rule explains, as it is in the files', () => {
    const change = { ours: ['  <div aria-hidden="true">'], theirs: ['  <div className="p-6">'] }
    expect(unrecorded(change, rules)).toEqual(change)
  })
})

describe('checkFile', () => {
  const rules = rulesFor(RECORD, 'tabs.tsx')

  it('accepts the registry file plus exactly its recorded edits', () => {
    expect(checkFile(OURS, THEIRS, rules)).toEqual({ drift: [], stale: [] })
  })

  it('fails a one-character change inside a recorded hunk, and its hunk goes stale', () => {
    const result = checkFile(OURS.replace('rounded-md', 'rounded-lg'), THEIRS, rules)
    expect(result.drift).toEqual([
      {
        at: 4,
        theirs: ['      className={cn("flex-1 text-sm outline-none", className)}'],
        ours: [
          '      className={cn(',
          '        "flex-1 rounded-lg text-sm outline-none",',
          '        className',
          '      )}',
        ],
      },
    ])
    expect(result.stale.map((hunk) => hunk.reason)).toEqual(['the panel keeps a focus ring'])
  })

  it('fails a change outside the recorded hunks', () => {
    const result = checkFile(OURS.replace('  return (', '  return  ('), THEIRS, rules)
    expect(result.drift).toEqual([{ at: 2, theirs: ['  return ('], ours: ['  return  ('] }])
    expect(result.stale).toEqual([])
  })

  it('reports a recorded hunk that matches nothing', () => {
    const result = checkFile(THEIRS, THEIRS, rules)
    expect(result.drift).toEqual([])
    expect(result.stale).toHaveLength(1)
  })

  it('lets one recorded hunk explain one hunk only', () => {
    const twice = `${THEIRS}${THEIRS}`
    const result = checkFile(`${OURS}${OURS.replace('"use client"\n\n', '')}`, twice, rules)
    expect(result.drift).toHaveLength(1)
    expect(result.stale).toEqual([])
  })

  it('matches a hunk on what the line rules leave of it', () => {
    const ours = OURS.replace('    <Panel', '    <Panel aria-hidden="true"')
    expect(checkFile(ours, THEIRS, rules)).toEqual({ drift: [], stale: [] })
  })
})

describe('formatDrift', () => {
  it('prints a block that, given a reason and pasted into the record, explains the drift', () => {
    const [hunk] = checkFile(OURS, THEIRS, rulesFor(RECORD, 'dialog.tsx')).drift
    if (!hunk) throw new Error('expected drift')
    const printed = formatDrift('dialog.tsx', hunk)
    expect(printed[0]).toBe(
      'dialog.tsx: unrecorded drift at registry line 4. If intended, record it under ### dialog.tsx:'
    )
    const block = printed.slice(1).join('\n').replace('<why we differ>', 'a reason')
    const record = `${RECORD}\n### dialog.tsx\n\n${block}\n`
    expect(checkFile(OURS, THEIRS, rulesFor(record, 'dialog.tsx'))).toEqual({
      drift: [],
      stale: [],
    })
  })
})
