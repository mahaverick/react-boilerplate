import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'jest-axe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConsentBanner } from '@/components/features/analytics/consent-banner'
import {
  getAnalyticsConsent,
  initAnalytics,
  resetAnalyticsForTests,
} from '@/observability/analytics/analytics'
import { analyticsConfigFor, resetFakePosthog, sdk } from '@/tests/mocks/posthog'

vi.mock('posthog-js', async () => {
  const { posthogDefault } = await import('@/tests/mocks/posthog')
  return { default: posthogDefault }
})

const REQUIRED = analyticsConfigFor({
  POSTHOG_KEY: 'phc_test_key_not_real',
  ANALYTICS_CONSENT_MODE: 'required',
})

describe('ConsentBanner', () => {
  beforeEach(() => {
    resetAnalyticsForTests()
    resetFakePosthog()
  })

  it('stays hidden until posthog-js has loaded, then asks', async () => {
    render(<ConsentBanner mode="required" />)
    expect(screen.queryByRole('region', { name: 'Analytics consent' })).not.toBeInTheDocument()
    await act(() => initAnalytics(REQUIRED))
    expect(screen.getByRole('region', { name: 'Analytics consent' })).toBeInTheDocument()
    expect(await axe(document.body)).toHaveNoViolations()
  })

  it('accept opts in and goes away', async () => {
    await initAnalytics(REQUIRED)
    render(<ConsentBanner mode="required" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Accept' }))
    expect(getAnalyticsConsent()).toBe('granted')
    expect(sdk.calls).toContain('opt_in_capturing()')
    expect(screen.queryByRole('region', { name: 'Analytics consent' })).not.toBeInTheDocument()
  })

  it('decline opts out and goes away', async () => {
    await initAnalytics(REQUIRED)
    render(<ConsentBanner mode="required" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Decline' }))
    expect(getAnalyticsConsent()).toBe('denied')
    expect(screen.queryByRole('region', { name: 'Analytics consent' })).not.toBeInTheDocument()
  })

  it('never shows once this browser has answered', async () => {
    sdk.consent = 'granted'
    await initAnalytics(REQUIRED)
    render(<ConsentBanner mode="required" />)
    expect(screen.queryByRole('region', { name: 'Analytics consent' })).not.toBeInTheDocument()
  })

  it('never shows outside required mode', async () => {
    await initAnalytics(analyticsConfigFor({ POSTHOG_KEY: 'phc_test_key_not_real' }))
    render(<ConsentBanner mode="opt_out" />)
    expect(screen.queryByRole('region', { name: 'Analytics consent' })).not.toBeInTheDocument()
  })

  it('renders nothing with this page’s run-time configuration, which has no key', () => {
    const { container } = render(<ConsentBanner />)
    expect(container).toBeEmptyDOMElement()
  })
})
