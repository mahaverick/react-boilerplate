import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { delay, http } from 'msw'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { resetSessionForTests } from '@/http/session'
import { useAuthProviders } from '@/queries/auth.queries'
import { useTenantBeta } from '@/queries/beta.queries'
import { useInvitationPreview } from '@/queries/invitation.queries'
import { usePreferences } from '@/queries/notification.queries'
import { tenantOnboardingQueryOptions } from '@/queries/onboarding.queries'
import { useProfile } from '@/queries/profile.queries'
import { useTenantSettings } from '@/queries/tenant-forms.queries'
import {
  ownersQueryOptions,
  tenantQueryOptions,
  tenantsQueryOptions,
} from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import { server } from '@/tests/mocks/server'

let client: QueryClient

/** A provider around the suite's `client`. */
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  resetSessionForTests()
  // No `user`, so `useProfile` has no initial data and goes to the wire.
  useAuthStore.setState({
    accessToken: 'access-token',
    user: null,
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

/** Each read, the request it sends, and a hook that starts it. */
const READS: [name: string, method: 'get' | 'post', path: string, start: () => unknown][] = [
  [
    'the invitation preview',
    'post',
    '/api/v1/invitations/preview',
    () => useInvitationPreview('t'),
  ],
  [
    'the onboarding checklist',
    'get',
    '/api/v1/tenants/acme/onboarding',
    () => useQuery(tenantOnboardingQueryOptions('acme')),
  ],
  ['the profile', 'get', '/api/v1/profile', () => useProfile()],
  ['the beta features', 'get', '/api/v1/tenants/acme/beta', () => useTenantBeta('acme')],
  ['the sign-in methods', 'get', '/api/v1/auth/providers', () => useAuthProviders()],
  ['the tenant settings', 'get', '/api/v1/tenants/acme/settings', () => useTenantSettings('acme')],
  [
    'the notification preferences',
    'get',
    '/api/v1/notifications/preferences',
    () => usePreferences(),
  ],
  ['the tenant list', 'get', '/api/v1/tenants', () => useQuery(tenantsQueryOptions())],
  ['one tenant', 'get', '/api/v1/tenants/acme', () => useQuery(tenantQueryOptions('acme'))],
  ['the owners', 'get', '/api/v1/tenants/acme/members', () => useQuery(ownersQueryOptions('acme'))],
]

describe('query cancellation', () => {
  it.each(READS)(
    'aborts %s on the wire when the query is cancelled',
    async (_name, method, path, start) => {
      let started = false
      server.use(
        http[method](path, () => {
          started = true
          return delay('infinite')
        })
      )
      const abort = vi.spyOn(XMLHttpRequest.prototype, 'abort')
      try {
        const { unmount } = renderHook(start, { wrapper })
        await waitFor(() => expect(started).toBe(true))
        expect(abort).not.toHaveBeenCalled()
        await client.cancelQueries()
        expect(abort).toHaveBeenCalledTimes(1)
        unmount()
      } finally {
        abort.mockRestore()
      }
    }
  )
})
