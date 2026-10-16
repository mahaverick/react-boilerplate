import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { TenantSettingsCard } from '@/components/features/tenant/tenant-settings-card'
import { tenantKeys } from '@/queries/tenant.queries'
import { queryClient } from '@/router'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const SETTINGS = {
  tenantId: TENANT_ID,
  timezone: 'Europe/London',
  locale: 'en',
  metadata: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('TenantSettingsCard', () => {
  beforeEach(() => {
    queryClient.clear()
  })

  it('holds the form’s place while the role loads, even once the settings are in', async () => {
    server.use(
      http.get('/api/v1/tenants/acme', () => new Promise<Response>(() => {})),
      http.get('/api/v1/tenants/acme/settings', () => ok(SETTINGS, 'Settings retrieved.'))
    )
    render(
      <QueryClientProvider client={queryClient}>
        <TenantSettingsCard slug="acme" />
      </QueryClientProvider>
    )
    await waitFor(() => expect(queryClient.getQueryData(tenantKeys.settings('acme'))).toBeDefined())
    const card = screen
      .getByRole('heading', { level: 2, name: 'Settings' })
      .closest('[data-slot="card"]')
    // Three label-and-input pairs and the button bar.
    expect(card?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(7)
    expect(screen.queryByRole('textbox', { name: 'Timezone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
