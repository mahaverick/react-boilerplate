import { describe, expect, it } from 'vite-plus/test'
import { MAX_REDIRECT_LENGTH, safeRedirect } from '@/lib/safe-redirect'

describe('safeRedirect', () => {
  it('accepts an absolute same-origin path', () => {
    expect(safeRedirect('/dashboard')).toBe('/dashboard')
    expect(safeRedirect('/tenants/acme?tab=members')).toBe('/tenants/acme?tab=members')
  })

  it('keeps the query and hash, which a redirect target may carry', () => {
    expect(safeRedirect('/dashboard?next=1')).toBe('/dashboard?next=1')
    expect(safeRedirect('/dashboard#section')).toBe('/dashboard#section')
  })

  it('keeps a same-origin path with its query and hash', () => {
    expect(safeRedirect('/tenants/acme/members?tenant=acme&tab=2#x')).toBe(
      '/tenants/acme/members?tenant=acme&tab=2#x'
    )
  })

  it.each([
    '//evil.test',
    '/\\evil.test',
    'https://evil.test',
    'javascript:alert(1)',
    '/..//evil.test',
    'relative',
  ])('refuses %s', (input) => {
    expect(safeRedirect(input)).toBeNull()
  })

  it('answers null for nothing', () => {
    expect(safeRedirect(undefined)).toBeNull()
    expect(safeRedirect(null)).toBeNull()
    expect(safeRedirect('')).toBeNull()
  })

  // Express refuses a backslash anywhere; the URL parser keeps one in the query and the hash.
  it.each(['/x?a=\\b', '/x#\\y'])('refuses %s', (input) => {
    expect(safeRedirect(input)).toBeNull()
  })

  /**
   * Each of these starts with exactly one slash, so a `^/(?![/\\])`-shaped test passes it,
   * yet the URL standard resolves it off-origin: the first four because the parser strips
   * ASCII tab, LF and CR, leaving "//", the last three because dot segments collapse to "//".
   * All are typeable into the URL bar as %09, %0A, %0D and ..%2F%2F.
   */
  it.each([
    ['tab', '/\t/evil.example'],
    ['line feed', '/\n/evil.example'],
    ['carriage return', '/\r/evil.example'],
    ['tab then backslash', '/\t\\evil.example'],
    ['double dot segment', '/..//evil.example'],
    ['single dot segment', '/.//evil.example'],
    ['dot segments below the root', '/a/../..//evil.example'],
  ])('rejects the %s bypass', (_label, input) => {
    expect(safeRedirect(input)).toBeNull()
  })

  it('refuses a control character or DEL anywhere', () => {
    expect(safeRedirect('/x?a=\u0001')).toBeNull()
    expect(safeRedirect('/x\u007f')).toBeNull()
  })

  it('refuses a path longer than MAX_REDIRECT_LENGTH', () => {
    expect(MAX_REDIRECT_LENGTH).toBe(2048)
    expect(safeRedirect('/' + 'a'.repeat(MAX_REDIRECT_LENGTH))).toBeNull()
    expect(safeRedirect('/' + 'a'.repeat(MAX_REDIRECT_LENGTH - 1))).not.toBeNull()
  })
})
