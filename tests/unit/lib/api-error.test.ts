import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { codeFrom, fieldErrorsFrom, formErrorsFrom, messageFrom, statusFrom } from '@/lib/api-error'
import type { ApiErrorBody } from '@/types/api.types'

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
  // Exactly the shape the backend builds from z.flattenError:
  // {...fieldErrors, ...(formErrors.length > 0 && { formErrors })}.
  errors: {
    email: ['Enter a valid email address.'],
    formErrors: ['Passwords do not match.'],
  },
  requestId: 'req-1',
})

describe('api-error', () => {
  it('uses the server message when there is one', () => {
    expect(messageFrom(VALIDATION_FAILURE)).toBe('Validation failed.')
  })

  it('falls back for anything that is not an API error', () => {
    expect(messageFrom(new Error('boom'))).toBe('Something went wrong. Please try again.')
    expect(messageFrom(undefined)).toBe('Something went wrong. Please try again.')
  })

  it('keeps the reserved formErrors key out of the field errors', () => {
    // The load-bearing assertion: `formErrors` is the ONE key in `errors`
    // that is not a field name. Left in, it would render an error against an
    // input called "formErrors", which no form has.
    expect(fieldErrorsFrom(VALIDATION_FAILURE)).toEqual({
      email: ['Enter a valid email address.'],
    })
    expect(fieldErrorsFrom(VALIDATION_FAILURE)).not.toHaveProperty('formErrors')
  })

  it('returns the schema-level issues separately, for form-level display', () => {
    expect(formErrorsFrom(VALIDATION_FAILURE)).toEqual(['Passwords do not match.'])
  })

  it('reports the response status, and undefined when there was no response', () => {
    // `useTenant` turns a 404 into a not-found VALUE; a network failure must
    // stay an error, or a dropped connection would render "no such tenant".
    expect(statusFrom(VALIDATION_FAILURE)).toBe(422)
    expect(statusFrom(new AxiosError('Network Error'))).toBeUndefined()
    expect(statusFrom(new Error('boom'))).toBeUndefined()
  })

  it('returns empty collections when the body carries no validator detail', () => {
    const plain = axiosErrorWith({
      success: false,
      message: 'Invalid email or password.',
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
      message: 'That person is already a member.',
      statusCode: 409,
      code: 'already_member',
      requestId: 'req-3',
    })
    expect(codeFrom(conflict)).toBe('already_member')
    expect(codeFrom(VALIDATION_FAILURE)).toBeUndefined()
    expect(codeFrom(new AxiosError('Network Error'))).toBeUndefined()
    expect(codeFrom(new Error('boom'))).toBeUndefined()
  })
})
