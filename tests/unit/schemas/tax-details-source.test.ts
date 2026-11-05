/**
 * @file The tax-details schema's source holds no raw non-ASCII character, so
 * `TAX_TEXT_PATTERN` reads the same in every editor and diff. It reads the
 * file from disk, so it stays per app rather than in the shared schema test.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'

describe('tax-details.schemas.ts source', () => {
  it('keeps TAX_TEXT_PATTERN free of raw non-ASCII characters', () => {
    const source = readFileSync('src/schemas/tax-details.schemas.ts', 'utf8')
    expect(source).toContain('export const TAX_TEXT_PATTERN')
    expect([...source].every((char) => char.charCodeAt(0) < 128)).toBe(true)
  })
})
