import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import * as tenantQueries from '@/queries/tenant.queries'
import {
  tenantKeys,
  useInvitations,
  useInviteMember,
  useMyRole,
  useResendInvitation,
  useRevokeInvitation,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, tenantDetail, testInvitation, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('tenant invitation queries', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  /** Seeds the three keys a mutation might touch, so each test can see which one it did. */
  function seedCache() {
    client.setQueryData(tenantKeys.invitations('acme'), [testInvitation])
    client.setQueryData(tenantKeys.members('acme'), [])
    client.setQueryData(tenantKeys.list, [])
  }

  function isInvalidated(key: readonly unknown[]) {
    return client.getQueryState(key)?.isInvalidated
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('lists pending invitations under their own key', async () => {
    server.use(
      http.get('/api/v1/tenants/acme/invitations', () =>
        ok([testInvitation], 'Invitations retrieved.')
      )
    )

    const { result } = renderHook(() => useInvitations('acme'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([testInvitation])
    expect(tenantKeys.invitations('acme')).toEqual(['tenants', 'acme', 'invitations'])
  })

  it('posts the invite body and invalidates the invitations list alone', async () => {
    let body: unknown
    server.use(
      http.post('/api/v1/tenants/acme/invitations', async ({ request }) => {
        body = await request.json()
        return ok(null, 'If that address can be invited, an invitation has been sent.', 202)
      })
    )
    seedCache()

    const { result } = renderHook(() => useInviteMember('acme'), { wrapper })
    result.current.mutate({ email: 'new@b.com', role: 'viewer' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toEqual({ email: 'new@b.com', role: 'viewer' })
    // The 202 is `data: null` for every address: nothing to hand back.
    expect(result.current.data).toBeNull()
    expect(isInvalidated(tenantKeys.invitations('acme'))).toBe(true)
    expect(isInvalidated(tenantKeys.members('acme'))).toBe(false)
    expect(isInvalidated(tenantKeys.list)).toBe(false)
  })

  it('refreshes the list when a racing invite for the same address won', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('An invitation for this address was just created.', 409, 'invitation_conflict')
      )
    )
    seedCache()

    const { result } = renderHook(() => useInviteMember('acme'), { wrapper })
    result.current.mutate({ email: 'new@b.com', role: 'viewer' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(tenantKeys.invitations('acme'))).toBe(true)
    expect(isInvalidated(tenantKeys.members('acme'))).toBe(false)
  })

  it('does not invalidate anything when the address is already a member', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations', () =>
        fail('That person is already a member.', 409, 'already_member')
      )
    )
    seedCache()

    const { result } = renderHook(() => useInviteMember('acme'), { wrapper })
    result.current.mutate({ email: 'a@b.com', role: 'viewer' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(tenantKeys.invitations('acme'))).toBe(false)
  })

  it('resends by id and refreshes the list', async () => {
    let resent = 0
    server.use(
      http.post('/api/v1/tenants/acme/invitations/inv-1/resend', () => {
        resent += 1
        return ok(null, 'Invitation resent.', 202)
      })
    )
    seedCache()

    const { result } = renderHook(() => useResendInvitation('acme'), { wrapper })
    result.current.mutate('inv-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(resent).toBe(1)
    expect(isInvalidated(tenantKeys.invitations('acme'))).toBe(true)
    expect(isInvalidated(tenantKeys.members('acme'))).toBe(false)
  })

  it('resends with no body, so no Content-Type header either', async () => {
    let body: string | undefined
    let contentType: string | null = 'unset'
    server.use(
      http.post('/api/v1/tenants/acme/invitations/inv-1/resend', async ({ request }) => {
        body = await request.text()
        contentType = request.headers.get('content-type')
        return ok(null, 'Invitation resent.', 202)
      })
    )

    const { result } = renderHook(() => useResendInvitation('acme'), { wrapper })
    result.current.mutate('inv-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(body).toBe('')
    expect(contentType).toBeNull()
  })

  it('refreshes the list after a resend 404, because the row is gone', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/invitations/inv-1/resend', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    seedCache()

    const { result } = renderHook(() => useResendInvitation('acme'), { wrapper })
    result.current.mutate('inv-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(tenantKeys.invitations('acme'))).toBe(true)
  })

  it('revokes with DELETE and refreshes the list', async () => {
    let method: string | undefined
    server.use(
      http.delete('/api/v1/tenants/acme/invitations/inv-1', ({ request }) => {
        method = request.method
        return ok(null, 'Invitation revoked.')
      })
    )
    seedCache()

    const { result } = renderHook(() => useRevokeInvitation('acme'), { wrapper })
    result.current.mutate('inv-1')

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(method).toBe('DELETE')
    // Unwrapped like its siblings: the envelope's `data`, not the AxiosResponse.
    expect(result.current.data).toBeNull()
    expect(isInvalidated(tenantKeys.invitations('acme'))).toBe(true)
    expect(isInvalidated(tenantKeys.list)).toBe(false)
  })

  it('refreshes the list after a revoke 404, because the row is gone', async () => {
    server.use(
      http.delete('/api/v1/tenants/acme/invitations/inv-1', () =>
        fail('Invitation not found.', 404, 'invitation_not_found')
      )
    )
    seedCache()

    const { result } = renderHook(() => useRevokeInvitation('acme'), { wrapper })
    result.current.mutate('inv-1')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(tenantKeys.invitations('acme'))).toBe(true)
  })

  it('no longer offers direct add', () => {
    // POST /tenants/:slug/members is gone from the API.
    expect('useAddMember' in tenantQueries).toBe(false)
  })
})

const DETAIL_TENANT = {
  id: 't1',
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  logo: null,
  website: null,
  lifecycleState: 'active',
  deletedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('useMyRole', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  // Under platform access the caller has no membership, so the tenant LIST
  // does not carry this tenant at all: the role has to come from the detail.
  it('reads the effective role and the access path from GET /tenants/:slug', async () => {
    let listCalls = 0
    server.use(
      http.get('/api/v1/tenants', () => {
        listCalls += 1
        return ok([], 'Tenants retrieved.')
      }),
      http.get('/api/v1/tenants/acme', () =>
        ok(tenantDetail(DETAIL_TENANT, 'viewer', 'platform'), 'Tenant retrieved.')
      )
    )

    const { result } = renderHook(() => useMyRole('acme'), { wrapper })

    await waitFor(() => expect(result.current.role).toBe('viewer'))
    expect(result.current.access).toBe('platform')
    expect(result.current.isPending).toBe(false)
    expect(result.current.isError).toBe(false)
    expect(listCalls).toBe(0)
  })

  it('is pending, not errored, while the tenant is in flight', () => {
    server.use(http.get('/api/v1/tenants/acme', async () => delay('infinite')))

    const { result } = renderHook(() => useMyRole('acme'), { wrapper })

    expect(result.current.isPending).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.role).toBeUndefined()
  })

  // A 404 is a VALUE (`null`), so this is "settled, and no role here".
  it('settles with no role after a 404', async () => {
    server.use(http.get('/api/v1/tenants/acme', () => fail('Tenant not found', 404)))

    const { result } = renderHook(() => useMyRole('acme'), { wrapper })

    await waitFor(() => expect(result.current.isPending).toBe(false))
    expect(result.current.isError).toBe(false)
    expect(result.current.role).toBeUndefined()
  })

  it('reports a failure, and its retry refetches the tenant', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/tenants/acme', () => {
        calls += 1
        return fail('Something went wrong.', 500)
      })
    )

    const { result } = renderHook(() => useMyRole('acme'), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    const before = calls
    result.current.retry()
    await waitFor(() => expect(calls).toBeGreaterThan(before))
  })
})
