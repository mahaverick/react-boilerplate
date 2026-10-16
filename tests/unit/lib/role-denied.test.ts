import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { isRoleDenied } from '@/lib/role-denied'

/** An axios failure that answered `status`. */
function answered(status: number) {
  return new AxiosError('failed', undefined, undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  })
}

describe('isRoleDenied', () => {
  it('reads a 403 as the role being refused', () => {
    expect(isRoleDenied(answered(403))).toBe(true)
  })

  it.each([401, 404, 500])('reads a %i as something else', (status) => {
    expect(isRoleDenied(answered(status))).toBe(false)
  })

  it('reads a request that got no answer as something else', () => {
    expect(isRoleDenied(new Error('offline'))).toBe(false)
  })
})
