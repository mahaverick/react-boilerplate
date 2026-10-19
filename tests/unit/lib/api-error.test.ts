import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import {
  codeFrom,
  fieldErrorsFrom,
  formErrorsFrom,
  messageFrom,
  READ_ONLY_MODE_MESSAGE,
  retryAfterSecondsFrom,
  statusFrom,
} from '@/lib/api-error'
import type { ApiErrorBody } from '@/types/api.types'

/** An Axios error whose response carries `body`, as the API's error envelope arrives. */
function axiosErrorWith(body: ApiErrorBody): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError(body.message, String(body.statusCode), config, null, {
    data: body,
    status: body.statusCode,
    statusText: 'Error',
    headers: {},
    config,
  })
}

const VALIDATION_FAILURE = axiosErrorWith({
  success: false,
  message: 'Validation failed.',
  statusCode: 422,
  // The backend's shape: `z.flattenError`'s field errors, plus `formErrors` when there are any.
  errors: {
    email: ['Enter a valid email address.'],
    formErrors: ['Change at least one field before you save.'],
  },
  requestId: 'req-1',
})

describe('api-error', () => {
  it('uses the server message when there is one', () => {
    expect(messageFrom(VALIDATION_FAILURE)).toBe('Validation failed.')
  })

  it('falls back for anything that is not an API error', () => {
    expect(messageFrom(new Error('boom'))).toBe(
      'We couldn’t complete that. Refresh the page, then try again.'
    )
    expect(messageFrom(undefined)).toBe(
      'We couldn’t complete that. Refresh the page, then try again.'
    )
  })

  it('says the server was not reached when no response arrived, with a next step', () => {
    expect(messageFrom(new AxiosError('Network Error', 'ERR_NETWORK'))).toBe(
      'We couldn’t reach the server. Check your connection, then try again.'
    )
  })

  it('keeps the reserved formErrors key out of the field errors', () => {
    // `formErrors` is the one key in `errors` that is not a field name; left in, it would render against an input called "formErrors".
    expect(fieldErrorsFrom(VALIDATION_FAILURE)).toEqual({
      email: ['Enter a valid email address.'],
    })
    expect(fieldErrorsFrom(VALIDATION_FAILURE)).not.toHaveProperty('formErrors')
  })

  it('returns the schema-level issues separately, for form-level display', () => {
    expect(formErrorsFrom(VALIDATION_FAILURE)).toEqual([
      'Change at least one field before you save.',
    ])
  })

  it('reports the response status, and undefined when there was no response', () => {
    // `useTenant` turns a 404 into a not-found VALUE; a network failure must stay an error, or a dropped connection would render "no such tenant".
    expect(statusFrom(VALIDATION_FAILURE)).toBe(422)
    expect(statusFrom(new AxiosError('Network Error'))).toBeUndefined()
    expect(statusFrom(new Error('boom'))).toBeUndefined()
  })

  it('returns empty collections when the body carries no validator detail', () => {
    const plain = axiosErrorWith({
      success: false,
      message: 'Authentication required',
      statusCode: 401,
      requestId: 'req-2',
    })
    expect(fieldErrorsFrom(plain)).toEqual({})
    expect(formErrorsFrom(plain)).toEqual([])
    expect(formErrorsFrom(new Error('boom'))).toEqual([])
  })

  it('reads the machine-readable code, and undefined when there is none', () => {
    const conflict = axiosErrorWith({
      success: false,
      message: 'That person is already a member of this workspace. No invitation was sent.',
      statusCode: 409,
      code: 'already_member',
      requestId: 'req-3',
    })
    expect(codeFrom(conflict)).toBe('already_member')
    expect(codeFrom(VALIDATION_FAILURE)).toBeUndefined()
    expect(codeFrom(new AxiosError('Network Error'))).toBeUndefined()
    expect(codeFrom(new Error('boom'))).toBeUndefined()
  })

  it('says changes are paused for a read-only refusal, not the owner’s notice', () => {
    const refusal = axiosErrorWith({
      success: false,
      message: 'Upgrading the database. Back by 11:00.',
      statusCode: 503,
      code: 'READ_ONLY_MODE',
      requestId: 'req-4',
    })
    expect(READ_ONLY_MODE_MESSAGE).toBe('Changes are paused during maintenance.')
    expect(messageFrom(refusal)).toBe(READ_ONLY_MODE_MESSAGE)
  })

  it('keeps the server message for a full-maintenance refusal', () => {
    const refusal = axiosErrorWith({
      success: false,
      message: 'Upgrading the database. Back by 11:00.',
      statusCode: 503,
      code: 'MAINTENANCE_MODE',
      requestId: 'req-5',
    })
    expect(messageFrom(refusal)).toBe('Upgrading the database. Back by 11:00.')
  })
})

describe('retryAfterSecondsFrom', () => {
  /** An Axios error whose response carries the given headers. */
  function errorWithHeaders(headers: Record<string, string>): AxiosError {
    const config = { headers: new AxiosHeaders() }
    return new AxiosError('Too many requests', '429', config, null, {
      data: null,
      status: 429,
      statusText: 'Too Many Requests',
      headers,
      config,
    })
  }

  /** An HTTP-date `seconds` from now. */
  function httpDate(seconds: number): string {
    return new Date(Date.now() + seconds * 1_000).toUTCString()
  }

  it.each([
    ['42', 42],
    ['0', 1],
  ])('reads Retry-After %s', (value, expected) => {
    expect(retryAfterSecondsFrom(errorWithHeaders({ 'retry-after': value }))).toBe(expected)
  })

  it('reads Retry-After as an HTTP date', () => {
    const seconds = retryAfterSecondsFrom(errorWithHeaders({ 'retry-after': httpDate(90) }))
    // The date has whole-second resolution, so the answer is 90 less the truncated part.
    expect(seconds).toBeGreaterThanOrEqual(89)
    expect(seconds).toBeLessThanOrEqual(90)
  })

  it('answers at least 1 for a date in the past', () => {
    expect(retryAfterSecondsFrom(errorWithHeaders({ 'retry-after': httpDate(-30) }))).toBe(1)
  })

  it('answers null without a response or header', () => {
    expect(retryAfterSecondsFrom(new AxiosError('Network Error'))).toBeNull()
    expect(retryAfterSecondsFrom(errorWithHeaders({}))).toBeNull()
    expect(retryAfterSecondsFrom(new Error('boom'))).toBeNull()
  })

  it('answers null for a header it cannot parse', () => {
    expect(retryAfterSecondsFrom(errorWithHeaders({ 'retry-after': 'soon' }))).toBeNull()
    expect(retryAfterSecondsFrom(errorWithHeaders({ 'retry-after': '-5' }))).toBeNull()
  })

  it.each(['1.5', '1e3', '+5', '1.5.2', 'abc 12', '12 Mar', 'Mar 12 2030'])(
    'answers null for the non-integer %s',
    (value) => {
      expect(retryAfterSecondsFrom(errorWithHeaders({ 'retry-after': value }))).toBeNull()
    }
  )
})
