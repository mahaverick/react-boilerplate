import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import {
  useCompleteOnboardingStep,
  useDismissOnboarding,
  useTenantOnboarding,
  useUndismissOnboarding,
} from '@/queries/onboarding.queries'
import { tenantKeys } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testOnboarding, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('onboarding queries', () => {
  let client: QueryClient

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
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

  it('keys the checklist under the tenant prefix', () => {
    expect(tenantKeys.onboarding('acme')).toEqual(['tenants', 'acme', 'onboarding'])
  })

  it('reads the checklist from GET /tenants/:slug/onboarding', async () => {
    const served = testOnboarding({}, ['configure_settings'])
    server.use(http.get('/api/v1/tenants/acme/onboarding', () => ok(served, 'Onboarding.')))

    const { result } = renderHook(() => useTenantOnboarding('acme'), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(served)
    expect(client.getQueryData(tenantKeys.onboarding('acme'))).toEqual(served)
  })

  it.each([
    [
      'mark done',
      '/api/v1/tenants/acme/onboarding/steps/read_getting_started/complete',
      () => {
        const { result } = renderHook(() => useCompleteOnboardingStep('acme'), { wrapper })
        result.current.mutate('read_getting_started')
        return result
      },
    ],
    [
      'dismiss',
      '/api/v1/tenants/acme/onboarding/dismiss',
      () => {
        const { result } = renderHook(() => useDismissOnboarding('acme'), { wrapper })
        result.current.mutate()
        return result
      },
    ],
    [
      'undismiss',
      '/api/v1/tenants/acme/onboarding/undismiss',
      () => {
        const { result } = renderHook(() => useUndismissOnboarding('acme'), { wrapper })
        result.current.mutate()
        return result
      },
    ],
  ])('%s posts with no body and refetches the checklist', async (_name, path, start) => {
    let contentType: string | null = 'unset'
    server.use(
      http.post(path, ({ request }) => {
        contentType = request.headers.get('content-type')
        return ok(testOnboarding(), 'Done.')
      })
    )
    client.setQueryData(tenantKeys.onboarding('acme'), testOnboarding())
    client.setQueryData(tenantKeys.members('acme'), [])

    const result = start()

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(contentType).toBeNull()
    expect(isInvalidated(tenantKeys.onboarding('acme'))).toBe(true)
    expect(isInvalidated(tenantKeys.members('acme'))).toBe(false)
  })

  it.each([
    ['not_manual', 'This step completes on its own.'],
    ['not_tracked', 'Onboarding is not tracked for this tenant.'],
  ])('refetches the checklist after a 409 %s, since the card was stale', async (code, message) => {
    server.use(
      http.post('/api/v1/tenants/acme/onboarding/steps/:key/complete', () =>
        fail(message, 409, code)
      )
    )
    client.setQueryData(tenantKeys.onboarding('acme'), testOnboarding())

    const { result } = renderHook(() => useCompleteOnboardingStep('acme'), { wrapper })
    result.current.mutate('configure_settings')

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(tenantKeys.onboarding('acme'))).toBe(true)
  })

  it('refetches the checklist after a 409 dismiss_state', async () => {
    server.use(
      http.post('/api/v1/tenants/acme/onboarding/dismiss', () =>
        fail('Getting started is already dismissed.', 409, 'dismiss_state')
      )
    )
    client.setQueryData(tenantKeys.onboarding('acme'), testOnboarding())

    const { result } = renderHook(() => useDismissOnboarding('acme'), { wrapper })
    result.current.mutate()

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(tenantKeys.onboarding('acme'))).toBe(true)
  })
})
