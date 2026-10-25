import { describe, expect, expectTypeOf, it } from 'vite-plus/test'
import { entitlementAnalyticsKey } from '@/lib/entitlement-key'
import {
  analyticsKey,
  REGISTRY_HAS_NO_FREE_STRINGS,
  type AnalyticsKey,
  type BrowserEvent,
  type BrowserEventProps,
} from '@/observability/telemetry/event-registry'
import { track } from '@/observability/telemetry/telemetry'

/**
 * Compile-time contract of the registry, checked by `pnpm typecheck` (tests/ is in
 * tsconfig.app.json). Each `@ts-expect-error` fails the typecheck if the line under it
 * starts compiling. The calls never run: `track` is inert here.
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
      | 'table_sorted'
      | 'table_paged'
      | 'table_exported'
      | 'command_palette_opened'
      | 'command_palette_action_run'
      | 'maintenance_page_viewed'
      | 'sign_in_link_requested'
      | 'sign_in_completed'
      | 'passkey_prompt_cancelled'
      | 'pricing_viewed'
      | 'billing_page_viewed'
      | 'upgrade_prompt_viewed'
      | 'upgrade_clicked'
      | 'interval_selected'
      | 'checkout_opened'
      | 'checkout_dismissed'
      | 'checkout_failed'
      | 'checkout_pending'
      | 'checkout_succeeded'
      | 'cancel_started'
      | 'cancel_confirmed'
      | 'trial_explainer_viewed'
      | 'trial_summary_viewed'
      | 'banner_dismissed'
      | 'upgrade_requested_ui'
    >()
    expect(REGISTRY_HAS_NO_FREE_STRINGS).toBe(true)
  })

  it('types the sign-in events', () => {
    // The calls never run: `track` is inert here.
    track('sign_in_link_requested')
    track('sign_in_completed', { method: 'link' })
    track('sign_in_completed', { method: 'google' })
    // @ts-expect-error a free string is no method
    track('sign_in_completed', { method: 'a@b.test' })
    track('sign_in_completed', { method: 'passkey' })
    expectTypeOf<BrowserEventProps['sign_in_completed']>().toEqualTypeOf<{
      method: 'link' | 'google' | 'passkey'
    }>()
  })

  it('types passkey_prompt_cancelled by ceremony', () => {
    track('passkey_prompt_cancelled', { ceremony: 'confirm' })
    // @ts-expect-error a free string is no ceremony
    track('passkey_prompt_cancelled', { ceremony: 'a@b.test' })
    expectTypeOf<BrowserEventProps['passkey_prompt_cancelled']>().toEqualTypeOf<{
      ceremony: 'sign_in' | 'create' | 'confirm'
    }>()
  })

  it('accepts the fixed `default` as table_sorted’s sort, for the default order no column owns', () => {
    const props: BrowserEventProps['table_sorted'] = {
      table: analyticsKey('test_items'),
      sort: analyticsKey('default'),
      direction: 'default',
    }
    expect(props.sort).toBe('default')
  })

  it('types each event’s properties', () => {
    expectTypeOf<BrowserEventProps['feature_cta_clicked']>().toEqualTypeOf<{ cta: AnalyticsKey }>()
    expectTypeOf<BrowserEventProps['table_filtered']>().toEqualTypeOf<{ table: AnalyticsKey }>()
    expectTypeOf<BrowserEventProps['table_sorted']>().toEqualTypeOf<{
      table: AnalyticsKey
      sort: AnalyticsKey
      direction: 'asc' | 'desc' | 'default'
    }>()
    expectTypeOf<BrowserEventProps['table_paged']>().toEqualTypeOf<{
      table: AnalyticsKey
      direction: 'next' | 'prev'
    }>()
    expectTypeOf<BrowserEventProps['command_palette_action_run']>().toEqualTypeOf<{
      action: AnalyticsKey
    }>()
    expectTypeOf<BrowserEventProps['maintenance_page_viewed']>().toEqualTypeOf<{
      mode: 'full' | 'read_only'
    }>()

    /** Typecheck-only calls: each `@ts-expect-error` below must stay an error. They are never invoked. */
    const calls = () => {
      track('tenant_switched')
      track('onboarding_checklist_opened', { required_done: 1, required_total: 2 })
      track('feature_cta_clicked', { cta: analyticsKey('onboarding_open_members') })
      track('table_filtered', { table: analyticsKey('activity') })
      track('command_palette_opened')
      track('command_palette_action_run', { action: analyticsKey('open_page') })
      // @ts-expect-error the typed search term where the item's kind belongs
      track('command_palette_action_run', { action: 'pii-probe' })
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

  it('types the billing events and maps entitlement keys', () => {
    track('upgrade_clicked', { surface: 'limit', key: entitlementAnalyticsKey('members') })
    track('upgrade_prompt_viewed', { surface: 'feature' })
    track('checkout_opened', { interval: 'year', purpose: 'switch' })
    track('checkout_failed', { failure_code: 'script_blocked' })
    track('checkout_pending')
    track('cancel_started')
    // @ts-expect-error not an upgrade surface
    track('upgrade_clicked', { surface: 'nope' })
    // @ts-expect-error a free string is not an analytics key
    track('upgrade_clicked', { surface: 'limit', key: 'members' })
    // @ts-expect-error not a failure code
    track('checkout_failed', { failure_code: 'other' })
    // @ts-expect-error a pending checkout carries no failure code
    track('checkout_pending', { failure_code: 'confirm_failed' })
    expect(entitlementAnalyticsKey('members')).toBe('members')
    expect(entitlementAnalyticsKey('advanced_example')).toBe('advanced_example')
    expect(entitlementAnalyticsKey('someone@example.test')).toBe('other')
  })
})
