import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { http } from 'msw'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsSection } from '@/components/features/profile/analytics-section'
import { resetSessionForTests } from '@/http/session'
import * as analytics from '@/observability/analytics'
import { useAuthStore } from '@/states/auth.store'
import { fail, testUser } from '@/tests/mocks/handlers'
import { analyticsConfigFor } from '@/tests/mocks/posthog'
import { server } from '@/tests/mocks/server'
import type { User } from '@/types/api.types'

const OPT_OUT = analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' })
const REQUIRED = analyticsConfigFor({
  POSTHOG_KEY: 'phc_test_key_not_real',
  ANALYTICS_CONSENT_MODE: 'required',
})

function renderSection(user: User, config = OPT_OUT) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AnalyticsSection user={user} config={config} />
    </QueryClientProvider>
  )
}

describe('AnalyticsSection', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: 'token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it.each([
    ['no key', analyticsConfigFor()],
    [
      'consent mode off',
      analyticsConfigFor({
        POSTHOG_KEY: 'phc_test_key_not_real',
        ANALYTICS_CONSENT_MODE: 'off',
      }),
    ],
  ])('renders nothing with %s', (_case, config) => {
    const { container } = renderSection(testUser, config)
    expect(container).toBeEmptyDOMElement()
  })

  it('is on for a user who has not opted out, and turning it off patches the profile', async () => {
    const success = vi.spyOn(toast, 'success')
    let body: unknown
    server.use(
      http.patch('/api/v1/profile', async ({ request }) => {
        body = await request.json()
        return Response.json({
          success: true,
          message: 'Profile updated.',
          statusCode: 200,
          data: { ...testUser, analyticsOptOut: true },
        })
      })
    )
    renderSection(testUser)

    const toggle = screen.getByRole('switch', { name: 'Share usage analytics' })
    expect(toggle).toBeChecked()
    expect(toggle).toHaveAccessibleDescription(/stops this in your browser/)
    expect(await axe(document.body)).toHaveNoViolations()
    await userEvent.setup().click(toggle)

    await waitFor(() => expect(body).toEqual({ analyticsOptOut: true }))
    await waitFor(() => expect(useAuthStore.getState().user?.analyticsOptOut).toBe(true))
    expect(success).toHaveBeenCalledWith('Usage analytics off.')
  })

  it('is off for an opted-out user; turning it on in required mode also grants consent', async () => {
    const grant = vi.spyOn(analytics, 'grantAnalyticsConsent')
    renderSection({ ...testUser, analyticsOptOut: true }, REQUIRED)

    const toggle = screen.getByRole('switch', { name: 'Share usage analytics' })
    expect(toggle).not.toBeChecked()
    await userEvent.setup().click(toggle)

    await waitFor(() => expect(grant).toHaveBeenCalledTimes(1))
  })

  it('turning it on in opt_out mode leaves consent to the preference alone', async () => {
    const grant = vi.spyOn(analytics, 'grantAnalyticsConsent')
    const success = vi.spyOn(toast, 'success')
    renderSection({ ...testUser, analyticsOptOut: true })
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Share usage analytics' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Usage analytics on.'))
    expect(grant).not.toHaveBeenCalled()
  })

  it('says so when the change fails', async () => {
    const error = vi.spyOn(toast, 'error')
    server.use(http.patch('/api/v1/profile', () => fail('Something broke.', 500)))
    renderSection(testUser)
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Share usage analytics' }))
    await waitFor(() => expect(error).toHaveBeenCalledTimes(1))
    expect(useAuthStore.getState().user?.analyticsOptOut).toBe(false)
  })
})
