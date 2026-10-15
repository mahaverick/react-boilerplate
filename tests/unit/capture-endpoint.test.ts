import { describe, expect, it } from 'vitest'
import { matchesEndpoint, parseEndpoint } from '../../e2e/capture/endpoint'

describe('parseEndpoint', () => {
  it('splits the method from the path segments', () => {
    expect(parseEndpoint('GET /tenants/:slug/members')).toEqual({
      method: 'GET',
      segments: ['tenants', ':slug', 'members'],
    })
  })

  it('rejects a spec without a method or a leading slash', () => {
    expect(() => parseEndpoint('/tenants')).toThrow(/METHOD \/path/)
    expect(() => parseEndpoint('GET tenants')).toThrow(/METHOD \/path/)
  })
})

describe('matchesEndpoint', () => {
  const detail = parseEndpoint('GET /tenants/:slug')

  it('matches the same method, prefix and segment count, ignoring the query', () => {
    expect(matchesEndpoint(detail, 'GET', 'http://localhost:5173/api/v1/tenants/acme?x=1')).toBe(
      true
    )
  })

  it('does not match a deeper path', () => {
    expect(matchesEndpoint(detail, 'GET', 'http://localhost:5173/api/v1/tenants/acme/flags')).toBe(
      false
    )
    expect(
      matchesEndpoint(detail, 'GET', 'http://localhost:5173/api/v1/tenants/platform/members')
    ).toBe(false)
  })

  it('does not match another method or a path outside the API prefix', () => {
    expect(matchesEndpoint(detail, 'POST', 'http://localhost:5173/api/v1/tenants/acme')).toBe(false)
    expect(matchesEndpoint(detail, 'GET', 'http://localhost:5173/tenants/acme')).toBe(false)
  })

  it('matches a literal segment only literally', () => {
    const members = parseEndpoint('GET /tenants/platform/members')
    expect(matchesEndpoint(members, 'GET', 'http://x/api/v1/tenants/platform/members')).toBe(true)
    expect(matchesEndpoint(members, 'GET', 'http://x/api/v1/tenants/acme/members')).toBe(false)
  })

  it('compares the method case-insensitively', () => {
    expect(matchesEndpoint(detail, 'get', 'http://x/api/v1/tenants/acme')).toBe(true)
  })
})
