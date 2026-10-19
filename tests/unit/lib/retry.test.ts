import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { READ_ONLY_MODE_MESSAGE } from '@/lib/api-error'
import { retryableFailureMessage } from '@/lib/retry'

/** An Axios error with this status, envelope and headers, as the API's error arrives. */
function errorWith(status: number, headers: Record<string, string> = {}, code?: string) {
  const config = { headers: new AxiosHeaders() }
  const message = 'Too many attempts. Try again in 15 minutes.'
  return new AxiosError(message, String(status), config, null, {
    data: { success: false, message, statusCode: status, ...(code ? { code } : {}) },
    status,
    statusText: 'Error',
    headers,
    config,
  })
}

describe('retryableFailureMessage', () => {
  it.each([
    ['1', 'Too many sign-in attempts. Try again in 1 second.'],
    ['42', 'Too many sign-in attempts. Try again in 42 seconds.'],
    ['119', 'Too many sign-in attempts. Try again in 119 seconds.'],
    ['120', 'Too many sign-in attempts. Try again in 2 minutes.'],
    ['121', 'Too many sign-in attempts. Try again in 3 minutes.'],
  ])('names the wait of a 429 with Retry-After %s', (retryAfter, expected) => {
    expect(
      retryableFailureMessage(errorWith(429, { 'retry-after': retryAfter }), 'sign-in attempts')
    ).toBe(expected)
  })

  it('names what was attempted', () => {
    expect(retryableFailureMessage(errorWith(429, { 'retry-after': '5' }), 'attempts')).toBe(
      'Too many attempts. Try again in 5 seconds.'
    )
  })

  it("keeps the server's message for a 429 without Retry-After", () => {
    expect(retryableFailureMessage(errorWith(429), 'attempts')).toBe(
      'Too many attempts. Try again in 15 minutes.'
    )
  })

  it('ignores Retry-After on anything but a 429', () => {
    expect(
      retryableFailureMessage(errorWith(503, { 'retry-after': '30' }, 'READ_ONLY_MODE'), 'attempts')
    ).toBe(READ_ONLY_MODE_MESSAGE)
  })

  it('says the network failed when there was no response', () => {
    const error = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(retryableFailureMessage(error, 'attempts')).toBe(
      'We couldn’t reach the server. Check your connection, then try again.'
    )
  })
})
