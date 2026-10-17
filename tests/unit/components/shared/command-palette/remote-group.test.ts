import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'
import { remoteGroup, type RemoteQuery } from '@/components/shared/command-palette/remote-group'
import { isRoleDenied } from '@/lib/role-denied'
import { analyticsKey } from '@/observability/telemetry'

/** A failed request with `status`, as axios rejects it. */
function failure(status: number): AxiosError {
  return new AxiosError('failed', undefined, undefined, undefined, { status } as AxiosResponse)
}

/** The status this app reads as a role refusal: react's tenant routes answer 403, apex's platform routes 404. */
const REFUSAL_STATUS = [403, 404].find((status) => isRoleDenied(failure(status))) ?? 403

/** A query in the given state, with rows `['a']` unless `data` says otherwise. */
function query(state: Partial<RemoteQuery<string[]>> = {}): RemoteQuery<string[]> {
  return { data: ['a'], isFetching: false, isError: false, error: null, refetch: vi.fn(), ...state }
}

/** One row per string. */
const toCommands = (data: string[]): PaletteCommand[] =>
  data.map((id) => ({
    id,
    label: id,
    action: analyticsKey('open_tenant'),
    timing: 'immediate',
    run: () => {},
  }))

describe('remoteGroup', () => {
  it('shows the rows for the term they were fetched for', () => {
    const group = remoteGroup({
      id: 'tenants',
      enabled: true,
      current: 'ac',
      term: 'ac',
      query: query(),
      toCommands,
    })
    expect(group.group.commands.map((command) => command.id)).toEqual(['a'])
    expect(group).toMatchObject({ searching: false, failed: false })
  })

  it.each([
    ['the term is still settling', { current: 'acm', term: 'ac', state: {} }],
    ['the request is in flight', { current: 'ac', term: 'ac', state: { isFetching: true } }],
  ])('hides the rows and says it is searching while %s', (_label, { current, term, state }) => {
    const group = remoteGroup({
      id: 'tenants',
      enabled: true,
      current,
      term,
      query: query(state),
      toCommands,
    })
    expect(group.group.commands).toEqual([])
    expect(group.searching).toBe(true)
  })

  it('reports a failure only for the typed term, and never a role refusal', () => {
    const failed = query({ data: undefined, isError: true, error: failure(500) })
    expect(
      remoteGroup({
        id: 'tenants',
        enabled: true,
        current: 'ac',
        term: 'ac',
        query: failed,
        toCommands,
      }).failed
    ).toBe(true)
    expect(
      remoteGroup({
        id: 'tenants',
        enabled: true,
        current: 'acm',
        term: 'ac',
        query: failed,
        toCommands,
      }).failed
    ).toBe(false)
    const refused = query({ data: undefined, isError: true, error: failure(REFUSAL_STATUS) })
    expect(
      remoteGroup({
        id: 'tenants',
        enabled: true,
        current: 'ac',
        term: 'ac',
        query: refused,
        toCommands,
      }).failed
    ).toBe(false)
  })

  it('does nothing for a blank term or a caller who may not search', () => {
    for (const input of [
      { enabled: true, current: '', term: '' },
      { enabled: false, current: 'ac', term: 'ac' },
    ]) {
      const group = remoteGroup({ id: 'users', ...input, query: query(), toCommands })
      expect(group).toMatchObject({ searching: false, failed: false })
      expect(group.group.commands).toEqual([])
    }
  })

  it('asks again through the query', () => {
    const asked = query()
    remoteGroup({
      id: 'users',
      enabled: true,
      current: 'ac',
      term: 'ac',
      query: asked,
      toCommands,
    }).retry()
    expect(asked.refetch).toHaveBeenCalledTimes(1)
  })
})
