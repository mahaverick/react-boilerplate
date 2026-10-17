import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  check,
  checkFile,
  diffLines,
  expectedManifest,
  formatDrift,
  parseRules,
  PLACEHOLDER_REASON,
  refresh,
  unrecorded,
  viewContent,
  type Cli,
  type Rule,
} from '../../scripts/ui-drift.mjs'

const SCRIPT = path.resolve(import.meta.dirname, '../../scripts/ui-drift.mjs')

const RECORD = `
### *

\`\`\`ui-drift
ours: s/(<Icon[A-Z]\\w*[^<]*?) aria-hidden="true"/$1/g
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

/**
 * A record of one hunk block.
 * @param heading - The section's file.
 * @param body - The block's lines.
 * @returns The markdown.
 */
const hunkRecord = (heading: string, body: string) =>
  `### ${heading}\n\n\`\`\`ui-drift-hunk\n${body}\n\`\`\`\n`

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

  it('reads an anchor: a context line or at:', () => {
    const rules = parseRules(hunkRecord('a.tsx', 'reason: r\nat: 7\n  before\n+added'))
    expect(rules.get('a.tsx')).toEqual([
      { side: 'hunk', reason: 'r', at: 7, context: ' before', theirs: [], ours: ['added'] },
    ])
  })

  it('rejects a hunk without a reason, under *, or with a line that is not - or +', () => {
    expect(() => parseRules(hunkRecord('tabs.tsx', '-a\n+b'))).toThrow(/cannot read hunk line/)
    expect(() => parseRules(hunkRecord('tabs.tsx', 'reason:   '))).toThrow(/cannot read hunk line/)
    expect(() => parseRules(hunkRecord('*', 'reason: everywhere\n-a'))).toThrow(/not to \*/)
    expect(() => parseRules(hunkRecord('tabs.tsx', 'reason: x\n-a\n b'))).toThrow(
      /cannot read hunk line/
    )
    expect(() => parseRules('### tabs.tsx\n\n```ui-drift-hunk\n```\n')).toThrow(/no reason/)
  })

  it('rejects the printed placeholder, or any <…>-only reason, as a reason', () => {
    for (const reason of [PLACEHOLDER_REASON, '<todo>', '<>'])
      expect(() => parseRules(hunkRecord('tabs.tsx', `reason: ${reason}\n-a\n+b`))).toThrow(
        /cannot read hunk line/
      )
  })

  it('rejects a hunk that only adds lines and has no anchor', () => {
    expect(() => parseRules(hunkRecord('alert.tsx', 'reason: variants\n+  warning: "x",'))).toThrow(
      /only adds lines/
    )
  })

  it('rejects a rewrite it cannot read', () => {
    expect(() => parseRules('### a.tsx\n\n```ui-drift\nours: a -> b\n```\n')).toThrow(
      /cannot read rule/
    )
  })
})

describe('viewContent', () => {
  const FILE = 'src/components/ui/field.tsx'
  /**
   * CLI output with a dependency's section, then the target's.
   * @param lines - The target section's body lines.
   * @param count - The line count its header claims.
   * @param header - The target section's path.
   * @returns The output.
   */
  const view = (lines: string[], count = lines.length, header = FILE) =>
    [
      '┌ shadcn add field (dry run)',
      '│',
      '├ src/components/ui/separator.tsx (overwrite) 1 lines',
      '│ ┌──────',
      '│ │ separator',
      '│ └──────',
      `├ ${header} (overwrite) ${String(count)} lines`,
      '│ ┌──────',
      ...lines,
      '│ └──────',
      '└ Run without --dry-run to apply.',
    ].join('\n')

  it("reads only the target's section, an empty line with or without its space", () => {
    expect(viewContent(view(['│ │ import x', '│ │ ', '│ │   y', '│ │']), FILE)).toBe(
      'import x\n\n  y\n'
    )
  })

  it('matches the exact path, not a file of the same name elsewhere', () => {
    expect(viewContent(view(['│ │ a'], 1, 'src/components/other/field.tsx'), FILE)).toBeNull()
  })

  it('returns null for a missing section, a short or long section, or an unknown line', () => {
    expect(viewContent(view(['│ │ a']), 'src/components/ui/dialog.tsx')).toBeNull()
    expect(viewContent(view(['│ │ a'], 2), FILE)).toBeNull()
    expect(viewContent(view(['│ │ a', '│ │ b', '│ │ c'], 2), FILE)).toBeNull()
    expect(viewContent(view(['│ │ a', 'stray']), FILE)).toBeNull()
    expect(viewContent('Something went wrong', FILE)).toBeNull()
  })
})

describe('diffLines', () => {
  it('finds no hunk in identical files', () => {
    expect(diffLines(['a', 'b'], ['a', 'b'])).toEqual([])
  })

  it('groups consecutive changes into hunks, numbered by registry line, with context', () => {
    expect(diffLines(['a', 'b', '', 'c', 'd'], ['x', 'a', 'B', '', 'c'])).toEqual([
      { at: 1, theirs: [], ours: ['x'] },
      { at: 2, context: 'a', theirs: ['b'], ours: ['B'] },
      { at: 5, context: 'c', theirs: ['d'], ours: [] },
    ])
  })
})

describe('unrecorded', () => {
  const rules = rulesFor(RECORD, 'dialog.tsx')

  it('drops lines a rule explains, and blank lines', () => {
    const change = {
      ours: ['"use client"', '', '  <IconX className="size-4" aria-hidden="true" />'],
      theirs: ['  <IconX className="size-4" />'],
    }
    expect(unrecorded(change, rules)).toEqual({ ours: [], theirs: [] })
  })

  it('keeps a change no rule explains, as it is in the files', () => {
    const change = { ours: ['  <div aria-hidden="true">'], theirs: ['  <div className="p-6">'] }
    expect(unrecorded(change, rules)).toEqual(change)
  })
})

describe("the record's * rules", () => {
  const record = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../docs/ui-local-edits.md'),
    'utf8'
  )
  const rules = parseRules(record).get('*') ?? []
  /**
   * Whether the `*` rules explain one changed line.
   * @param theirs - The registry's line.
   * @param ours - Ours.
   * @returns True when nothing is left.
   */
  const explained = (theirs: string, ours: string) => {
    const left = unrecorded({ theirs: [theirs], ours: [ours] }, rules)
    return left.ours.length === 0 && left.theirs.length === 0
  }

  it('explain aria-hidden on a Tabler icon, never on another element', () => {
    expect(explained('  <IconDots />', '  <IconDots aria-hidden="true" />')).toBe(true)
    expect(
      explained('      <Button size="icon">', '      <Button aria-hidden="true" size="icon">')
    ).toBe(false)
    expect(explained('<IconX /><Button>', '<IconX /><Button aria-hidden="true">')).toBe(false)
  })

  it('explain the transition lists in use, never another list', () => {
    expect(
      explained(
        '"inline-flex transition-all"',
        '"inline-flex transition-[color,background-color,border-color,box-shadow]"'
      )
    ).toBe(true)
    expect(
      explained('"inline-flex transition-all"', '"inline-flex transition-[width,height,margin]"')
    ).toBe(false)
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
        context: '    <Panel',
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
    expect(result.drift).toEqual([
      {
        at: 2,
        context: 'function TabsContent({ className, ...props }) {',
        theirs: ['  return ('],
        ours: ['  return  ('],
      },
    ])
    expect(result.stale).toEqual([])
  })

  it('reports a recorded hunk that matches no change', () => {
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
    const ours = OURS.replace(
      '      {...props}',
      '      {...props}\n      <IconX aria-hidden="true" />'
    )
    const theirs = THEIRS.replace('      {...props}', '      {...props}\n      <IconX />')
    expect(checkFile(ours, theirs, rules)).toEqual({ drift: [], stale: [] })
  })

  describe('an add-only hunk', () => {
    const theirs = [
      'const variants = {',
      '  default: "a",',
      '}',
      'const defaults = {',
      '}',
      '',
    ].join('\n')
    const ours = [
      'const variants = {',
      '  default: "a",',
      '  warning: "w",',
      '}',
      'const defaults = {',
      '}',
      '',
    ].join('\n')
    const moved = [
      'const variants = {',
      '  default: "a",',
      '}',
      'const defaults = {',
      '  warning: "w",',
      '}',
      '',
    ].join('\n')

    it('is anchored by its context line, so moving it fails', () => {
      const record = rulesFor(
        hunkRecord('a.tsx', 'reason: warning\n   default: "a",\n+  warning: "w",'),
        'a.tsx'
      )
      expect(checkFile(ours, theirs, record)).toEqual({ drift: [], stale: [] })
      const result = checkFile(moved, theirs, record)
      expect(result.drift).toEqual([
        { at: 5, context: 'const defaults = {', theirs: [], ours: ['  warning: "w",'] },
      ])
      expect(result.stale).toHaveLength(1)
    })

    it('is anchored by at:, so moving it fails', () => {
      const record = rulesFor(
        hunkRecord('a.tsx', 'reason: warning\nat: 3\n+  warning: "w",'),
        'a.tsx'
      )
      expect(checkFile(ours, theirs, record)).toEqual({ drift: [], stale: [] })
      expect(checkFile(moved, theirs, record).drift).toHaveLength(1)
    })
  })
})

describe('formatDrift', () => {
  it('prints a block that, given a reason and pasted into the record, explains the drift', () => {
    const [hunk] = checkFile(OURS, THEIRS, rulesFor(RECORD, 'dialog.tsx')).drift
    if (!hunk) throw new Error('expected drift')
    const printed = formatDrift('dialog.tsx', hunk)
    expect(printed[0]).toMatch(/^dialog\.tsx: unrecorded drift at registry line 4\./)
    const block = printed.slice(1).join('\n')
    const record = `${RECORD}\n### dialog.tsx\n\n${block}\n`
    expect(() => parseRules(record)).toThrow(/cannot read hunk line/)
    const filled = `${RECORD}\n### dialog.tsx\n\n${block.replace(PLACEHOLDER_REASON, 'a reason')}\n`
    expect(checkFile(OURS, THEIRS, rulesFor(filled, 'dialog.tsx'))).toEqual({
      drift: [],
      stale: [],
    })
  })

  it('anchors a hunk at the top of the file with at:', () => {
    expect(formatDrift('a.tsx', { at: 1, theirs: [], ours: ['x'] })).toContain('at: 1')
  })
})

const PANEL_RECORD = `### *

\`\`\`ui-drift
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

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A repo tree the check passes on: tabs.tsx with its recorded hunk, a skipped
 * form.tsx, its snapshot and a manifest matching package.json and components.json.
 * @returns The tree's root.
 */
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-drift-'))
  roots.push(root)
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ devDependencies: { shadcn: '4.21.4' } }),
    'components.json': JSON.stringify({ style: 'base-vega', iconLibrary: 'tabler' }),
    'docs/ui-local-edits.md': PANEL_RECORD,
    'src/components/ui/tabs.tsx': OURS,
    'src/components/ui/form.tsx': 'export {}\n',
    'scripts/ui-registry/tabs.tsx': THEIRS,
    'scripts/ui-registry/manifest.json': JSON.stringify({
      shadcn: '4.21.4',
      style: 'base-vega',
      iconLibrary: 'tabler',
    }),
  }
  for (const [file, content] of Object.entries(files)) write(root, file, content)
  return root
}

/**
 * Writes one file under a fixture root.
 * @param root - The root.
 * @param file - The path under it.
 * @param content - The text.
 */
const write = (root: string, file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
  fs.writeFileSync(path.join(root, file), content)
}

describe('check', () => {
  it('passes the fixture, skipping form.tsx', () => {
    expect(check(fixture())).toEqual({
      passed: ['form.tsx: ours (skipped)', 'tabs.tsx: ok'],
      problems: [],
    })
  })

  it('fails when package.json pins another shadcn than the snapshot was taken with', () => {
    const root = fixture()
    write(root, 'package.json', JSON.stringify({ devDependencies: { shadcn: '4.22.0' } }))
    expect(check(root).problems).toEqual([
      expect.stringMatching(/manifest\.json: shadcn is 4\.21\.4, the repo has 4\.22\.0/),
    ])
  })

  it("fails when components.json's style or icon library moves", () => {
    const root = fixture()
    write(root, 'components.json', JSON.stringify({ style: 'base-nova', iconLibrary: 'lucide' }))
    expect(check(root).problems).toEqual([
      expect.stringMatching(/style is base-vega, the repo has base-nova/),
      expect.stringMatching(/iconLibrary is tabler, the repo has lucide/),
    ])
  })

  it('fails on a missing manifest', () => {
    const root = fixture()
    fs.rmSync(path.join(root, 'scripts/ui-registry/manifest.json'))
    expect(check(root).problems).toHaveLength(3)
  })

  it('fails on a vendored file without a snapshot', () => {
    const root = fixture()
    write(root, 'src/components/ui/kbd.tsx', 'export {}\n')
    expect(check(root).problems).toEqual([
      'kbd.tsx: no registry snapshot; run pnpm ui:drift:refresh',
    ])
  })

  it('fails on a snapshot without a vendored file', () => {
    const root = fixture()
    write(root, 'scripts/ui-registry/kbd.tsx', 'export {}\n')
    expect(check(root).problems).toEqual([
      expect.stringMatching(/ui-registry\/kbd\.tsx: no vendored file/),
    ])
  })

  it('fails on a heading that names no vendored file, rewrites only or hunks', () => {
    const root = fixture()
    write(
      root,
      'docs/ui-local-edits.md',
      `${PANEL_RECORD}\n### avatr.tsx\n\n\`\`\`ui-drift\nours: s/a/b/\n\`\`\`\n`
    )
    expect(check(root).problems).toEqual([expect.stringMatching(/### avatr\.tsx names no file/)])
  })

  it('fails on a skipped file that records hunks', () => {
    const root = fixture()
    write(
      root,
      'docs/ui-local-edits.md',
      `${PANEL_RECORD}\n${hunkRecord('form.tsx', 'reason: r\n-a\n+b')}`
    )
    expect(check(root).problems).toEqual([
      expect.stringMatching(/form\.tsx is skipped but records hunks/),
    ])
  })

  it('fails on a .ts file or a directory in the ui directory', () => {
    const root = fixture()
    write(root, 'src/components/ui/helper.ts', 'export {}\n')
    write(root, 'src/components/ui/sub/evil.tsx', 'export {}\n')
    expect(check(root).problems).toEqual([
      expect.stringMatching(/ui\/helper\.ts: not a top-level \.tsx file/),
      expect.stringMatching(/ui\/sub: not a top-level \.tsx file/),
    ])
  })

  it('fails on drift, printing the block to record', () => {
    const root = fixture()
    write(
      root,
      'src/components/ui/tabs.tsx',
      OURS.replace('  )\n}', '  )\n}\nexport { TabsContent }')
    )
    const { problems } = check(root)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/^tabs\.tsx: unrecorded drift at registry line 9\./)
  })

  it('fails on a directory an interrupted refresh left', () => {
    const root = fixture()
    fs.mkdirSync(path.join(root, 'scripts/ui-registry.next-abc123'))
    fs.mkdirSync(path.join(root, 'scripts/ui-registry.previous'))
    expect(check(root).problems).toEqual([
      'scripts/ui-registry.next-abc123: left by an interrupted refresh; delete it',
      'scripts/ui-registry.previous: left by an interrupted refresh; delete it',
    ])
  })

  it('fails when the shadcn devDependency is a range, not an exact version', () => {
    const root = fixture()
    write(root, 'package.json', JSON.stringify({ devDependencies: { shadcn: '^4.21.4' } }))
    expect(check(root).problems[0]).toMatch(
      /^package\.json: devDependencies\.shadcn is \^4\.21\.4; pin it exactly/
    )
  })

  it('reports an unreadable record as one line and exits 1', () => {
    const root = fixture()
    write(
      root,
      'docs/ui-local-edits.md',
      PANEL_RECORD.replace('reason: the panel keeps a focus ring', `reason: ${PLACEHOLDER_REASON}`)
    )
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe(
      `ui:drift: docs/ui-local-edits.md: cannot read hunk line "reason: ${PLACEHOLDER_REASON}" under tabs.tsx\n`
    )
  })

  it('exits 0 when the tree passes and 1 when it does not', () => {
    const root = fixture()
    /**
     * Runs the script in the fixture.
     * @returns Its result.
     */
    const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' })
    expect(run().status).toBe(0)
    write(root, 'src/components/ui/tabs.tsx', THEIRS)
    const failed = run()
    expect(failed.status).toBe(1)
    expect(failed.stdout).toMatch(/recorded hunk "the panel keeps a focus ring" matches no change/)
  })
})

describe('refresh', () => {
  /**
   * A CLI double: a version, and a `--view` printout of each file's content.
   * @param version - What `--version` prints.
   * @param files - The registry file per component name.
   * @returns The calls refresh makes.
   */
  const fakeCli = (version: string, files: Record<string, string>): Cli => ({
    version: () => version,
    view: (name, file) => {
      const lines = (files[name] ?? '').split('\n')
      return [
        `┌ shadcn add ${name} (dry run)`,
        `├ ${file} (overwrite) ${String(lines.length)} lines`,
        '│ ┌──────',
        ...lines.map((line) => `│ │ ${line}`),
        '│ └──────',
      ].join('\n')
    },
  })

  it('writes each compared file and the manifest, skips form.tsx and removes orphans', () => {
    const root = fixture()
    write(root, 'scripts/ui-registry/old.tsx', 'export {}\n')
    expect(refresh(root, fakeCli('4.21.4', { tabs: 'registry tabs\n' }))).toEqual(['tabs.tsx'])
    const dir = path.join(root, 'scripts/ui-registry')
    expect(fs.readdirSync(dir).sort()).toEqual(['manifest.json', 'tabs.tsx'])
    expect(fs.readFileSync(path.join(dir, 'tabs.tsx'), 'utf8')).toBe('registry tabs\n')
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))).toEqual(
      expectedManifest(root)
    )
    expect(fs.readdirSync(path.join(root, 'scripts'))).toEqual(['ui-registry'])
  })

  it('refuses an installed CLI other than the pinned one, leaving the snapshot as it was', () => {
    const root = fixture()
    expect(() => refresh(root, fakeCli('4.22.0', { tabs: 'x\n' }))).toThrow(
      /installed shadcn is 4\.22\.0/
    )
    expect(check(root).problems).toEqual([])
  })

  it('leaves the old snapshot whole when one file cannot be read', () => {
    const root = fixture()
    write(root, 'src/components/ui/kbd.tsx', 'export {}\n')
    write(root, 'scripts/ui-registry/kbd.tsx', 'old kbd\n')
    const cli = fakeCli('4.21.4', { kbd: 'new kbd\n', tabs: 'new tabs\n' })
    const broken: Cli = {
      ...cli,
      view: (name, file) => (name === 'tabs' ? 'Something went wrong' : cli.view(name, file)),
    }
    expect(() => refresh(root, broken)).toThrow(/tabs\.tsx: unreadable CLI output/)
    expect(fs.readFileSync(path.join(root, 'scripts/ui-registry/kbd.tsx'), 'utf8')).toBe(
      'old kbd\n'
    )
    expect(fs.readdirSync(path.join(root, 'scripts'))).toEqual(['ui-registry'])
  })
})
