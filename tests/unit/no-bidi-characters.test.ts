import { describe, expect, it } from 'vitest'

const BIDI_OVERRIDE = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/u

// Vite reads each file as a string, so this needs no Node types. The globs are
// relative to the repo root.
const SOURCES: Record<string, string> = import.meta.glob(
  ['/src/**/*.{ts,tsx,css}', '/tests/**/*.{ts,tsx}', '/e2e/**/*.{ts,tsx,html}', '/index.html'],
  { query: '?raw', import: 'default', eager: true }
)

describe('raw bidi characters', () => {
  it('the pattern matches each of the nine code points', () => {
    const codePoints = [
      0x20_2a, 0x20_2b, 0x20_2c, 0x20_2d, 0x20_2e, 0x20_66, 0x20_67, 0x20_68, 0x20_69,
    ]
    for (const codePoint of codePoints) {
      expect(BIDI_OVERRIDE.test(String.fromCodePoint(codePoint))).toBe(true)
    }
  })

  it('appear in no file under src, tests or e2e', () => {
    const paths = Object.keys(SOURCES)
    // Not vacuous: the globs really found files under each of the three
    // directories. Vite's import.meta.glob never matches the file that calls
    // it, so this asserts a sibling test file rather than its own path.
    expect(paths).toContain('/tests/unit/schemas/safe-text.schemas.test.ts')
    expect(paths).toContain('/src/main.tsx')
    const offenders = paths.filter((path) => BIDI_OVERRIDE.test(SOURCES[path] ?? ''))
    expect(offenders).toEqual([])
  })
})
