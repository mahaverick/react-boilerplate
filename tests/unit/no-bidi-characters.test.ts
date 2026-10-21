import { describe, expect, it } from 'vite-plus/test'
// A static import rather than the glob below: Vite's import.meta.glob leaves the calling file out of its results, so this is how the scan covers itself.
import ownSource from './no-bidi-characters.test.ts?raw'

const BIDI_OVERRIDE = /[\u{202A}-\u{202E}\u{2066}-\u{2069}]/u

// Vite reads each file as a string, so this needs no Node types. The globs are relative to the repo root.
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
    // Not vacuous: the globs found files under src and tests.
    expect(paths).toContain('/tests/unit/schemas/safe-text.schemas.test.ts')
    expect(paths).toContain('/src/main.tsx')
    const allSources: Record<string, string> = {
      ...SOURCES,
      'tests/unit/no-bidi-characters.test.ts': ownSource,
    }
    const offenders = Object.keys(allSources).filter((path) =>
      BIDI_OVERRIDE.test(allSources[path] ?? '')
    )
    expect(offenders).toEqual([])
  })
})
