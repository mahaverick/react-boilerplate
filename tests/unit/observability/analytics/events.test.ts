import { describe, expect, expectTypeOf, it } from 'vitest'
import { track } from '@/observability/analytics/analytics'
import {
  analyticsKey,
  REGISTRY_HAS_NO_FREE_STRINGS,
  type AnalyticsKey,
  type BrowserEvent,
  type BrowserEventProps,
} from '@/observability/analytics/events'

/**
 * Compile-time contract of the registry, checked by `pnpm typecheck` (tests/
 * is in tsconfig.app.json). Each `@ts-expect-error` fails the typecheck if the
 * line under it starts compiling. The calls never run: `track` is inert here.
 */
describe('the browser event registry', () => {
  it('brands a literal key and keeps its value', () => {
    const key = analyticsKey('onboarding_open_settings')
    expectTypeOf(key).toEqualTypeOf<AnalyticsKey>()
    expect(key).toBe('onboarding_open_settings')
  })

  it('refuses a key that could carry user input', () => {
    const typed = 'onboarding_open_settings' as string
    // @ts-expect-error a `string` is not a literal
    analyticsKey(typed)
    // @ts-expect-error an address
    analyticsKey('pii-probe@example.test')
    // @ts-expect-error a sentence
    analyticsKey('open settings')
    // @ts-expect-error uppercase
    analyticsKey('Open_settings')
    // @ts-expect-error a URL
    analyticsKey('/tenants/acme?tab=x')
  })

  it('lists exactly the events this app can send', () => {
    expectTypeOf<BrowserEvent>().toEqualTypeOf<
      | 'tenant_switched'
      | 'onboarding_checklist_opened'
      | 'feature_cta_clicked'
      | 'table_filtered'
      | 'table_exported'
      | 'maintenance_page_viewed'
    >()
    expect(REGISTRY_HAS_NO_FREE_STRINGS).toBe(true)
  })

  it('types each event’s properties', () => {
    expectTypeOf<BrowserEventProps['feature_cta_clicked']>().toEqualTypeOf<{ cta: AnalyticsKey }>()
    expectTypeOf<BrowserEventProps['table_filtered']>().toEqualTypeOf<{ table: AnalyticsKey }>()
    expectTypeOf<BrowserEventProps['maintenance_page_viewed']>().toEqualTypeOf<{
      mode: 'full' | 'read_only'
    }>()

    const calls = () => {
      track('tenant_switched')
      track('onboarding_checklist_opened', { required_done: 1, required_total: 2 })
      track('feature_cta_clicked', { cta: analyticsKey('onboarding_open_members') })
      track('table_filtered', { table: analyticsKey('activity') })
      track('maintenance_page_viewed', { mode: 'full' })
      // @ts-expect-error off is not a maintenance period
      track('maintenance_page_viewed', { mode: 'off' })
      // @ts-expect-error a filter value where the list's key belongs
      track('table_filtered', { table: 'pii-probe@example.test' })
      // @ts-expect-error an unregistered event
      track('user_clicked_somewhere')
      // @ts-expect-error a free string where a key belongs
      track('feature_cta_clicked', { cta: 'open members' })
      // @ts-expect-error a property the event does not have
      track('feature_cta_clicked', { cta: analyticsKey('x'), email: 'pii-probe@example.test' })
      // @ts-expect-error properties on an event that has none
      track('tenant_switched', { tenant_name: 'Acme' })
      // @ts-expect-error a missing property
      track('onboarding_checklist_opened', { required_done: 1 })
    }
    expect(typeof calls).toBe('function')
  })
})
