import { AxiosError, AxiosHeaders } from 'axios'
import {
  isAuthVerdict,
  NoRefreshTokenError,
  SessionIdentityChangedError,
} from '@/http/auth-verdict'
import { describe, expect, it } from '@/tests/support/runner'

/** An Axios error whose response has `status`, as a failed request arrives. */
function axiosErrorWithStatus(status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, {
    data: { success: false, message: 'Failed', statusCode: status },
    status,
    statusText: 'Error',
    headers: {},
    config,
  })
}

describe('isAuthVerdict', () => {
  it('NoRefreshTokenError is a verdict', () => {
    expect(isAuthVerdict(new NoRefreshTokenError())).toBe(true)
  })

  it('a 500 is not a verdict', () => {
    expect(isAuthVerdict(axiosErrorWithStatus(500))).toBe(false)
  })

  it('a 401 is a verdict', () => {
    expect(isAuthVerdict(axiosErrorWithStatus(401))).toBe(true)
  })

  it('SessionIdentityChangedError is a verdict', () => {
    expect(isAuthVerdict(new SessionIdentityChangedError())).toBe(true)
  })

  it('a plain error is not a verdict', () => {
    expect(isAuthVerdict(new Error('bug'))).toBe(false)
  })
})
