import { describe, expect, it } from 'vitest'
import { isChunkLoadError } from '@/lib/chunk-load-error'

describe('isChunkLoadError', () => {
  it.each([
    [
      'Chromium',
      'Failed to fetch dynamically imported module: https://app.test/assets/login-a1b2.js',
    ],
    ['Firefox', 'error loading dynamically imported module: https://app.test/assets/login-a1b2.js'],
    ['Safari', 'Importing a module script failed.'],
  ])('recognises the %s message', (_browser, message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  it('ignores any other error', () => {
    expect(isChunkLoadError(new Error('Request failed with status code 500'))).toBe(false)
  })

  it('ignores a value that is not an Error, even with a matching text', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
