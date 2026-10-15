import { describe, expect, it } from 'vitest'
import { changedLines, parseRules, unrecorded } from '../../scripts/ui-drift.mjs'

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

\`\`\`ui-drift
theirs: s/"flex-1 text-sm outline-none"/"flex-1 rounded-md text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring\\/50"/
\`\`\`
`

const OUTPUT = [
  '│ │ --- a/src/components/ui/dialog.tsx',
  '│ │ +++ b/src/components/ui/dialog.tsx',
  '│ │ @@ -1,4 +1,4 @@',
  '│ │ -"use client"',
  '│ │ -            <IconX aria-hidden="true" />',
  '│ │ +            <IconX />',
  '│ │  unchanged line',
].join('\n')

describe('parseRules', () => {
  it('reads the global block, skip markers and per-file rules', () => {
    const rules = parseRules(RECORD)
    expect(rules.get('*')).toHaveLength(2)
    expect(rules.get('form.tsx')).toEqual([{ side: 'skip' }])
    expect(rules.get('tabs.tsx')?.[0]?.side).toBe('theirs')
  })
})

describe('changedLines', () => {
  it('splits a CLI diff into our lines and the registry lines, without headers', () => {
    expect(changedLines(OUTPUT)).toEqual({
      ours: ['"use client"', '            <IconX aria-hidden="true" />'],
      theirs: ['            <IconX />'],
    })
  })
})

describe('changedLines with a target', () => {
  it('reads only the target component section, not its dependencies', () => {
    const output = [
      '├ src/components/ui/separator.tsx (overwrite)',
      '│ │ +"use client"',
      '├ src/components/ui/field.tsx (overwrite)',
      '│ │ -"use client"',
    ].join('\n')
    expect(changedLines(output, 'field')).toEqual({ ours: ['"use client"'], theirs: [] })
  })
})

describe('unrecorded', () => {
  it('drops changes the rules explain', () => {
    const rules = [...(parseRules(RECORD).get('*') ?? [])]
    expect(unrecorded(changedLines(OUTPUT), rules)).toEqual({ ours: [], theirs: [] })
  })

  it('keeps a change no rule explains', () => {
    const rules = [...(parseRules(RECORD).get('*') ?? [])]
    const change = { ours: ['  <div className="p-4">'], theirs: ['  <div className="p-6">'] }
    expect(unrecorded(change, rules)).toEqual(change)
  })
})
