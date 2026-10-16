import { describe, expect, it } from 'vitest'
import { analyticsKey } from '@/observability/telemetry'
import {
  booleanFilter,
  cleanSearch,
  dayFilter,
  defineList,
  filterUrlValue,
  idFilter,
  listFilter,
  listRequest,
  listValues,
} from '@/schemas/list.schemas'

const list = defineList({
  sorts: ['name', 'created', '-created'],
  filters: {
    status: listFilter(['active', 'inactive', 'deleted']),
    verified: booleanFilter(),
    tenant: idFilter(),
    from: dayFilter(),
  },
  table: analyticsKey('test_items'),
})

const TENANT = '00000000-0000-4000-8000-000000000001'

describe('defineList schema', () => {
  it('keeps every valid field', () => {
    expect(
      list.schema.parse({
        search: 'acme',
        sort: '-created',
        cursor: 'abc',
        direction: 'prev',
        limit: 50,
        hidden: 'status',
        status: 'active,deleted',
        verified: true,
        tenant: TENANT,
        from: '2026-10-01',
      })
    ).toEqual({
      search: 'acme',
      sort: '-created',
      cursor: 'abc',
      direction: 'prev',
      limit: 50,
      hidden: 'status',
      status: 'active,deleted',
      verified: true,
      tenant: TENANT,
      from: '2026-10-01',
    })
  })

  it('drops each malformed field rather than failing the page', () => {
    expect(
      list.schema.parse({
        sort: 'email',
        cursor: 'x'.repeat(4097),
        direction: 'sideways',
        limit: 37,
        status: 'bogus',
        verified: 'yes',
        tenant: 'not-a-uuid',
        from: 'yesterday',
      })
    ).toEqual({})
  })

  it('drops an empty cursor, so no request ever carries `cursor=`', () => {
    expect(list.schema.parse({ cursor: '' })).toEqual({})
    expect(listRequest(list, listValues(list, { cursor: '' }))).toEqual({})
  })

  it('reads the limit the router parsed as a number, and only the offered sizes', () => {
    expect(list.schema.parse({ limit: 100 })).toEqual({ limit: 100 })
    expect(list.schema.parse({ limit: '100' })).toEqual({})
  })

  it('takes a numeric-looking search back as text', () => {
    expect(list.schema.parse({ search: 2026 })).toEqual({ search: '2026' })
  })

  it('keeps the known values of a comma list, once each, in order', () => {
    expect(list.schema.parse({ status: 'deleted,bogus,active,deleted' })).toEqual({
      status: 'deleted,active',
    })
  })
})

describe('two lists on one route', () => {
  const second = defineList({
    sorts: ['-created', 'email'],
    filters: { role: listFilter(['owner', 'admin']) },
    table: analyticsKey('test_invitations'),
    prefix: 'invitations',
  })
  const first = defineList({
    sorts: ['name', 'email'],
    filters: { role: listFilter(['owner', 'admin', 'viewer']) },
    table: analyticsKey('test_members'),
    also: [second],
  })

  it('keeps both lists’ params apart under one schema', () => {
    expect(
      first.schema.parse({
        search: 'grace',
        role: 'viewer',
        invitationsSearch: 'ada',
        invitationsSort: 'email',
        invitationsRole: 'viewer,owner',
      })
    ).toEqual({
      search: 'grace',
      role: 'viewer',
      invitationsSearch: 'ada',
      invitationsSort: 'email',
      invitationsRole: 'owner',
    })
  })

  it('reads each list’s values from its own keys', () => {
    const search = { search: 'grace', invitationsSearch: 'ada' }
    expect(listValues(first, search).search).toBe('grace')
    expect(listValues(second, search).search).toBe('ada')
  })

  it('builds the request under the API’s names', () => {
    const values = listValues(second, { invitationsSearch: 'ada', invitationsRole: 'owner' })
    expect(listRequest(second, values)).toEqual({ search: 'ada', role: 'owner' })
  })
})

describe('listRequest', () => {
  it('sends nothing for the default view', () => {
    expect(listRequest(list, listValues(list, {}))).toEqual({})
  })

  it('leaves out the default sort and page size, and sends direction only with a cursor', () => {
    expect(listRequest(list, listValues(list, { sort: 'name', limit: 20 }))).toEqual({})
    expect(listRequest(list, listValues(list, { direction: 'prev' }))).toEqual({})
    expect(
      listRequest(list, listValues(list, { cursor: 'c2', direction: 'prev', limit: 50 }))
    ).toEqual({ cursor: 'c2', direction: 'prev', limit: 50 })
    expect(listRequest(list, listValues(list, { cursor: 'c2' }))).toEqual({ cursor: 'c2' })
  })

  it('sends each filter as the API takes it', () => {
    const values = listValues(list, {
      search: '  acme ',
      status: 'active,deleted',
      verified: false,
      tenant: TENANT,
    })
    expect(listRequest(list, values)).toEqual({
      search: 'acme',
      status: 'active,deleted',
      verified: false,
      tenant: TENANT,
    })
  })
})

describe('search text', () => {
  it('trims, strips NUL and cuts to 100 characters', () => {
    expect(cleanSearch('  acme \0corp ')).toBe('acme corp')
    expect(cleanSearch('a'.repeat(101))).toHaveLength(100)
    expect(cleanSearch(`${'a'.repeat(99)}   b`)).toBe('a'.repeat(99))
    expect(cleanSearch(' \0 \0')).toBe('')
  })

  it('sends a request the API accepts for a blank, NUL-only or over-long search', () => {
    for (const blank of ['', '   ', ' \0 ']) {
      expect(listRequest(list, listValues(list, { search: blank }))).toEqual({})
    }
    const long = listRequest(list, listValues(list, { search: `  ${'a'.repeat(101)}` }))
    expect(long).toEqual({ search: 'a'.repeat(100) })
    expect(listRequest(list, listValues(list, { search: 'a\0b' }))).toEqual({ search: 'ab' })
  })
})

describe('filterUrlValue', () => {
  it('writes a comma list, one id, and a yes/no only when exactly one is picked', () => {
    expect(filterUrlValue(listFilter(['a', 'b']), ['a', 'b'])).toBe('a,b')
    expect(filterUrlValue(listFilter(['a', 'b']), [])).toBeUndefined()
    expect(filterUrlValue(idFilter(), [TENANT])).toBe(TENANT)
    expect(filterUrlValue(booleanFilter(), ['true'])).toBe(true)
    expect(filterUrlValue(booleanFilter(), ['false'])).toBe(false)
    expect(filterUrlValue(booleanFilter(), ['true', 'false'])).toBeUndefined()
  })
})
