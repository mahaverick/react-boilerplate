import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vite-plus/test'
import {
  authTimeOf,
  isNewConfirmation,
  isReauthRequired,
  sentWithCurrentToken,
} from '@/lib/step-up'
import { useAuthStore } from '@/states/auth.store'
import { testJwt } from '@/tests/mocks/jwt'
import { REAUTH_REQUIRED } from '@/types/api.types'

/** An Axios error carrying express's error envelope with `status` and an optional `code`. */
function axiosFailure(status: number, code?: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, message: 'x', statusCode: status, code, requestId: 'r' },
  })
}

describe('isReauthRequired', () => {
  it('is true only for a 401 carrying REAUTH_REQUIRED', () => {
    expect(isReauthRequired(axiosFailure(401, REAUTH_REQUIRED))).toBe(true)
    expect(isReauthRequired(axiosFailure(401))).toBe(false)
    expect(isReauthRequired(axiosFailure(403, REAUTH_REQUIRED))).toBe(false)
    expect(isReauthRequired(new Error('boom'))).toBe(false)
  })
})

describe('sentWithCurrentToken', () => {
  /** A REAUTH_REQUIRED refusal of a request that carried `token`. */
  function refusedWith(token: string): AxiosError {
    const error = axiosFailure(401, REAUTH_REQUIRED)
    error.config?.headers.set('Authorization', `Bearer ${token}`)
    return error
  }

  it('is true when the refused request carried the token the store holds', () => {
    useAuthStore.setState({ accessToken: 'tok' })
    expect(sentWithCurrentToken(refusedWith('tok'))).toBe(true)
  })

  it('is false once another confirmation has swapped a newer token in', () => {
    useAuthStore.setState({ accessToken: 'newer' })
    expect(sentWithCurrentToken(refusedWith('tok'))).toBe(false)
  })

  it('is true for anything it cannot compare', () => {
    expect(sentWithCurrentToken(new Error('boom'))).toBe(true)
  })
})

/** A token whose payload segment is `payload`, base64url-encoded as is. */
function withPayload(payload: string): string {
  return `h.${btoa(payload).replace(/=+$/, '')}.s`
}

describe('authTimeOf', () => {
  it.each([
    ['no token', null],
    ['a token that is not a JWT', 'old-token'],
    ['a payload that is not base64', 'a.!!!.c'],
    ['a null payload', withPayload('null')],
    ['an array payload', withPayload('[]')],
    ['a payload without the claim', withPayload('{}')],
    ['a string claim', withPayload('{"auth_time":"1"}')],
    ['a payload that is not JSON', withPayload('{auth_time:1')],
  ])('is null for %s', (_, token) => {
    expect(authTimeOf(token)).toBeNull()
  })

  it('reads the claim in seconds', () => {
    expect(authTimeOf(testJwt({ auth_time: 1 }))).toBe(1)
    expect(authTimeOf(testJwt({ sub: 'u', auth_time: 1_760_000_000 }))).toBe(1_760_000_000)
  })
})

describe('isNewConfirmation', () => {
  it.each([
    [null, null, false],
    [null, 5, true],
    [5, null, false],
    [5, 5, false],
    [5, 4, false],
    [5, 6, true],
  ] as const)('before %s, after %s: %s', (before, after, expected) => {
    expect(isNewConfirmation(before, after)).toBe(expected)
  })
})
