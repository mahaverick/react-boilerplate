import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { clientSettingsKeys, useClientSettings } from '@/queries/client-settings.queries'
import { testClientSettings } from '@/tests/fixtures/client-settings'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const ROUTE = '/api/v1/status/client-settings'

describe('client settings query', () => {
  let client: QueryClient

  /** Provides the per-test `client` to the hook under test. */
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('reads the settings without a bearer and holds them for an hour', async () => {
    let authorization: string | null = 'unset'
    server.use(
      http.get(ROUTE, ({ request }) => {
        authorization = request.headers.get('authorization')
        return ok(testClientSettings, 'Client settings retrieved.')
      })
    )
    const { result } = renderHook(() => useClientSettings(), { wrapper })
    await waitFor(() => expect(result.current).toEqual(testClientSettings))
    expect(authorization).toBeNull()
    expect(client.getQueryCache().find({ queryKey: clientSettingsKeys.all })?.isStale()).toBe(false)
  })

  it('answers undefined for an API without the route, so the copy states no figure', async () => {
    server.use(http.get(ROUTE, () => fail('Route not found.', 404)))
    const { result } = renderHook(() => useClientSettings(), { wrapper })
    await waitFor(() =>
      expect(client.getQueryState(clientSettingsKeys.all)?.status).toBe('success')
    )
    expect(result.current).toBeUndefined()
  })

  it('answers undefined after a network failure', async () => {
    server.use(http.get(ROUTE, () => HttpResponse.error()))
    const { result } = renderHook(() => useClientSettings(), { wrapper })
    await waitFor(() => expect(client.getQueryState(clientSettingsKeys.all)?.status).toBe('error'))
    expect(result.current).toBeUndefined()
  })

  it('answers undefined for a body that is not the settings', async () => {
    server.use(http.get(ROUTE, () => ok({ signInLinkTtlSeconds: '15m' })))
    const { result } = renderHook(() => useClientSettings(), { wrapper })
    await waitFor(() =>
      expect(client.getQueryState(clientSettingsKeys.all)?.status).toBe('success')
    )
    expect(result.current).toBeUndefined()
  })
})
