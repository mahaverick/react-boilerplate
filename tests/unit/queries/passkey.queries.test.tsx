import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { passkeyKeys, usePasskeyConfig, usePasskeys } from '@/queries/passkey.queries'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('passkey queries', () => {
  let client: QueryClient

  /** Provides the per-test `client` to the hook under test. */
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('reads the config without a bearer', async () => {
    let authorization: string | null = 'unset'
    server.use(
      http.get('/api/v1/auth/passkeys/config', ({ request }) => {
        authorization = request.headers.get('authorization')
        return ok({ mode: 'required', rpId: 'example.test' })
      })
    )
    const { result } = renderHook(() => usePasskeyConfig(), { wrapper })
    await waitFor(() =>
      expect(result.current.data).toEqual({ mode: 'required', rpId: 'example.test' })
    )
    expect(authorization).toBeNull()
    expect(client.getQueryData(passkeyKeys.config)).toEqual({
      mode: 'required',
      rpId: 'example.test',
    })
  })

  it('reads a 404 as off', async () => {
    server.use(http.get('/api/v1/auth/passkeys/config', () => fail('Route not found.', 404)))
    const { result } = renderHook(() => usePasskeyConfig(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ mode: 'off', rpId: '' }))
  })

  it('reads a network failure as off', async () => {
    server.use(http.get('/api/v1/auth/passkeys/config', () => HttpResponse.error()))
    const { result } = renderHook(() => usePasskeyConfig(), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual({ mode: 'off', rpId: '' }))
    expect(result.current.isError).toBe(false)
  })

  it('reads the list only when enabled', async () => {
    const off = renderHook(() => usePasskeys(false), { wrapper })
    expect(off.result.current.fetchStatus).toBe('idle')
    server.use(http.get('/api/v1/auth/passkeys', () => ok({ passkeys: [], userHandle: 'HANDLE' })))
    const on = renderHook(() => usePasskeys(true), { wrapper })
    await waitFor(() =>
      expect(on.result.current.data).toEqual({ passkeys: [], userHandle: 'HANDLE' })
    )
  })
})
