import { describe, expect, it } from 'vitest'

// The glob is relative to the repo root; vendored shadcn output is the registry's copy, not ours.
const SOURCES = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx}', '!/src/components/ui/**', '!/src/routeTree.gen.ts'],
  { query: '?raw', import: 'default', eager: true }
)

/**
 * Phrasings the copy rules retire: passive "could not be …", the vague
 * "Something went wrong", and the hedge "This is not a sign". Each says what
 * failed without naming who or what to do next. Then the filler that adds
 * no fact ("successfully", "was able to", "in order to", "currently"), the
 * vague "shortly", and the peacock words that praise instead of naming the
 * mechanism.
 */
const RETIRED: readonly RegExp[] = [
  /\b[Cc]ould not (?:load|open|copy|be (?:loaded|shown|refreshed))\b/,
  /\bSomething went wrong\b/,
  /\bThis is not a sign\b/,
  /\b(?:successfully|currently|shortly|(?:was|were) able to|in order to|please note)\b/i,
  /\b(?:simply|seamless(?:ly)?|exciting|outstanding|innovative|world-class|powerful|best-in-class)\b/i,
]

/**
 * Finds the retired phrasings outside comments. A line that is a `//`
 * comment or part of a JSDoc block is skipped, since only what renders is copy.
 * @param source - The file's text.
 * @returns Each offending line, trimmed.
 */
function retiredPhrasings(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !/^(?:\/\/|\/\*|\*)/.test(line))
    .filter((line) => RETIRED.some((pattern) => pattern.test(line)))
}

describe('user-facing copy', () => {
  it('the scan flags a retired phrasing in code and skips it in a comment', () => {
    expect(
      retiredPhrasings(
        [
          "const A = 'Tenants could not be loaded'",
          '// it could not load',
          ' * could not open',
          "const B = 'Invitation successfully sent.'",
          "const C = 'We were able to save it.'",
          "const D = 'Select Save in order to keep it.'",
          "const E = 'Maintenance is currently on.'",
          "const F = 'It appears shortly.'",
          "const G = 'A powerful, seamless sign-in.'",
          '// simply a comment',
        ].join('\n')
      )
    ).toEqual([
      "const A = 'Tenants could not be loaded'",
      "const B = 'Invitation successfully sent.'",
      "const C = 'We were able to save it.'",
      "const D = 'Select Save in order to keep it.'",
      "const E = 'Maintenance is currently on.'",
      "const F = 'It appears shortly.'",
      "const G = 'A powerful, seamless sign-in.'",
    ])
  })

  it('uses none of the retired phrasings', () => {
    const offending = Object.entries(SOURCES).flatMap(([path, source]) =>
      retiredPhrasings(source).map((line) => `${path}: ${line}`)
    )
    expect(offending).toEqual([])
  })
})
