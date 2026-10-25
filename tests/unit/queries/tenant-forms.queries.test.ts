import { QueryClient } from '@tanstack/react-query'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { billingTimeZone } from '@/queries/tenant-forms.queries'
import { useAuthStore } from '@/states/auth.store'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const SETTINGS = '/api/v1/tenants/acme/settings'

beforeEach(() => {
  resetSessionForTests()
  useAuthStore.setState({
    accessToken: 'access-token',
    user: testUser,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

describe('billingTimeZone', () => {
  it('reads the tenant’s time zone from its settings', async () => {
    server.use(
      http.get(SETTINGS, () =>
        ok(
          {
            tenantId: TENANT_ID,
            timezone: 'Asia/Kolkata',
            locale: 'en',
            metadata: null,
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          'Settings retrieved.'
        )
      )
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await expect(billingTimeZone(client, 'acme')).resolves.toBe('Asia/Kolkata')
  })

  it('falls back to UTC, as the server does, when the settings cannot be read', async () => {
    let reads = 0
    server.use(
      http.get(SETTINGS, () => {
        reads += 1
        return fail('Server error.', 500)
      })
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } })
    await expect(billingTimeZone(client, 'acme')).resolves.toBe('UTC')
    // The helper asks once: a toast waits on it.
    expect(reads).toBe(1)
  })
})
