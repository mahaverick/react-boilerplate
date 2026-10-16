/**
 * @file The type-level contract of a list's route search: each URL key has its
 * own type and no other key is allowed. The checks run in `pnpm typecheck`
 * (`tests/` is in tsconfig.app.json); each `@ts-expect-error` fails it if the
 * line under it starts to compile.
 */
import { linkOptions } from '@tanstack/react-router'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { analyticsKey } from '@/observability/telemetry'
import { invitationsList, membersList, myTenantsList } from '@/queries/tenant.queries'
import { booleanFilter, defineList, listFilter } from '@/schemas/list.schemas'

const prefixed = defineList({
  sorts: ['name', '-created'],
  filters: { status: listFilter(['active', 'inactive']), verified: booleanFilter() },
  table: analyticsKey('type_probe'),
  prefix: 'probe',
})

describe('a list route’s search type', () => {
  it('types each field on its own', () => {
    /** The Tenants route's search. */
    type Search = z.output<typeof myTenantsList.schema>
    expectTypeOf<Search['sort']>().toEqualTypeOf<'name' | '-joined' | undefined>()
    expectTypeOf<Search['limit']>().toEqualTypeOf<20 | 50 | 100 | undefined>()
    expectTypeOf<Search['direction']>().toEqualTypeOf<'next' | 'prev' | undefined>()
    expectTypeOf<Search['role']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Search['search']>().toEqualTypeOf<string | undefined>()
    /** The prefixed probe list's search. */
    type Probe = z.output<typeof prefixed.schema>
    expectTypeOf<Probe['probeVerified']>().toEqualTypeOf<boolean | undefined>()
    expectTypeOf<Probe['probeStatus']>().toEqualTypeOf<string | undefined>()
    expectTypeOf<Probe['probeSort']>().toEqualTypeOf<'name' | '-created' | undefined>()
    expectTypeOf<Probe>().not.toHaveProperty('sort')
    expect(prefixed.urlKey('verified')).toBe('probeVerified')
  })

  it('keeps a second list’s prefixed keys on the first list’s route', () => {
    /** The members route's search. */
    type Search = z.output<typeof membersList.schema>
    expectTypeOf<Search['invitationsSort']>().toEqualTypeOf<'-created' | 'email' | undefined>()
    expectTypeOf<Search['sort']>().toEqualTypeOf<
      'name' | 'email' | 'role' | '-joined' | undefined
    >()
    expectTypeOf<z.output<typeof invitationsList.schema>>().not.toHaveProperty('sort')
    expect(membersList.urlKey('sort')).toBe('sort')
  })

  it('accepts the real keys on a list route and refuses any other', () => {
    expect(
      linkOptions({ to: '/tenants', search: { search: 'acme', sort: '-joined', limit: 50 } })
    ).toBeTruthy()
    expect(
      linkOptions({
        to: '/settings/workspace/$slug/members',
        params: { slug: 'acme' },
        search: { role: 'owner', invitationsSort: 'email' },
      })
    ).toBeTruthy()
    // @ts-expect-error a key no list on the route has
    linkOptions({ to: '/tenants', search: { typo: 1 } })
    // @ts-expect-error a sort outside the whitelist
    linkOptions({ to: '/tenants', search: { sort: 'nope' } })
    // @ts-expect-error a page size the API does not offer
    linkOptions({ to: '/tenants', search: { limit: 7 } })
    linkOptions({
      to: '/settings/workspace/$slug/members',
      params: { slug: 'acme' },
      // @ts-expect-error the members list has no Status filter
      search: { status: 'x' },
    })
  })
})
