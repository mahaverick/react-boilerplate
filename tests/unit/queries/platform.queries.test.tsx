import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { usePlatformTenantSearch } from '@/queries/platform.queries'
import { useAuthStore } from '@/states/auth.store'
import { fail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('usePlatformTenantSearch', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    // `retry: 1` like the router's client, with no delay, so the hook's own
    // retry rule is what decides.
    client = new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  // A non-staff caller gets a 404 here; asking again changes nothing, the
  // same reason `usePlatformAuditLog` does not retry one either.
  it('does not retry a 404', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return fail('Not found', 404)
      })
    )

    const { result } = renderHook(() => usePlatformTenantSearch('', { enabled: true }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(1)
  })

  it('retries any other failure once', async () => {
    let calls = 0
    server.use(
      http.get('/api/v1/platform/tenants', () => {
        calls += 1
        return fail('Something went wrong.', 500)
      })
    )

    const { result } = renderHook(() => usePlatformTenantSearch('', { enabled: true }), {
      wrapper,
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(calls).toBe(2)
  })
})
