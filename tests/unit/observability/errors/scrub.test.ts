import { describe, expect, it } from 'vitest'
import { SCRUB_VALUE_MAX, scrubText, TRUNCATION_MARKER } from '@/observability/errors/scrub'
import vectors from '@/tests/fixtures/error-scrub-vectors.json'

describe('scrubText vectors', () => {
  it.each(vectors.map((vector) => [vector.rule, vector.input, vector.expected] as const))(
    '%s: %s',
    (_rule, input, expected) => {
      expect(scrubText(input)).toBe(expected)
    }
  )

  it('covers every rule', () => {
    expect(new Set(vectors.map((vector) => vector.rule))).toEqual(
      new Set([
        'postgres',
        'query',
        'jwt',
        'bearer',
        'posthog-key',
        'email',
        'secret',
        'path',
        'cap',
      ])
    )
  })

  it('gives the same text when applied twice', () => {
    for (const { input } of vectors) {
      const once = scrubText(input)
      expect(scrubText(once)).toBe(once)
    }
  })
})

describe('scrubText', () => {
  it('cuts a long text to the cap, marker included', () => {
    const scrubbed = scrubText('word '.repeat(400))
    expect(scrubbed).toHaveLength(SCRUB_VALUE_MAX)
    expect(scrubbed.endsWith(TRUNCATION_MARKER)).toBe(true)
  })

  it('keeps a text of exactly the cap whole', () => {
    const text = 'a b '.repeat(SCRUB_VALUE_MAX / 4)
    expect(scrubText(text)).toBe(text)
  })

  it('never keeps half of a secret cut at the scan limit', () => {
    const text = `${'A'.repeat(3600)} ${'x '.repeat(240)}${'ab'.repeat(20)} tail`
    const scrubbed = scrubText(text)
    expect(scrubbed.startsWith('[secret] x x')).toBe(true)
    expect(scrubbed).not.toContain('abab')
    expect(scrubbed.endsWith(TRUNCATION_MARKER)).toBe(true)
  })

  it('keeps a production frame URL whole', () => {
    const frame = `${location.origin}/assets/route-error-boundary-component-DH5dBeoM.js`
    expect(scrubText(frame)).toBe(frame)
  })
})
