import { describe, expect, it } from 'vitest'

// Tabler, unlike Lucide, does not add `aria-hidden` on its own. The glob is relative to the repo root.
const UI_SOURCES = import.meta.glob<string>('/src/components/ui/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * Finds the JSX elements whose tag starts with `Icon` and carry no `aria-hidden`.
 * An element runs to the first `>` outside a `{...}` expression, so multi-line
 * elements and `className={cn('a', 'b')}` props are both read whole.
 * @param source - The file's text.
 * @returns The 1-based line of each offending tag.
 */
function iconsMissingAriaHidden(source: string): number[] {
  const lines: number[] = []
  for (const match of source.matchAll(/<Icon[A-Za-z0-9]*(?=[\s/>])/g)) {
    let depth = 0
    let end = match.index
    for (; end < source.length; end += 1) {
      const char = source[end]
      if (char === '{') depth += 1
      else if (char === '}') depth -= 1
      else if (char === '>' && depth === 0) break
    }
    if (!/\baria-hidden\b/.test(source.slice(match.index, end))) {
      lines.push(source.slice(0, match.index).split('\n').length)
    }
  }
  return lines
}

describe('vendored ui Tabler icons', () => {
  it('the scan reads multi-line elements and flags a bare icon', () => {
    expect(
      iconsMissingAriaHidden('<IconX />\n<IconDots\n/>\n<IconCheck aria-hidden="true" />')
    ).toEqual([1, 2])
    expect(
      iconsMissingAriaHidden('<IconX\n  className={cn("a", "b")}\n  aria-hidden="true"\n/>')
    ).toEqual([])
  })

  it('finds the vendored files and icons in them', () => {
    expect(Object.keys(UI_SOURCES)).toContain('/src/components/ui/dialog.tsx')
    expect(Object.values(UI_SOURCES).some((source) => /<Icon[A-Za-z]/.test(source))).toBe(true)
  })

  it('every icon carries aria-hidden', () => {
    const offenders = Object.entries(UI_SOURCES).flatMap(([path, source]) =>
      iconsMissingAriaHidden(source).map((line) => `${path.slice(1)}:${line}`)
    )
    expect(offenders).toEqual([])
  })
})
