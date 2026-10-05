/**
 * @file A stand-in for posthog-js's default export, for `vi.mock('posthog-js')`.
 * It records every call in order and keeps just enough state (distinct id,
 * identified or not, consent, registered properties and groups) for the
 * facade's decisions to be observable.
 */
import { vi } from 'vitest'
import { parseRuntimeConfig } from '@/configs/runtime-config'
import { analyticsConfigFrom, type AnalyticsConfig } from '@/observability/analytics/config'

/**
 * An analytics configuration from raw run-time values, keyed by container
 * name (`POSTHOG_KEY`, `ANALYTICS_CONSENT_MODE`, …), as the image would pass them.
 * @param raw - The values; unset keys take their defaults.
 * @returns The analytics configuration.
 */
export function analyticsConfigFor(raw: Record<string, string> = {}): AnalyticsConfig {
  return analyticsConfigFrom(parseRuntimeConfig(raw).config)
}

type Consent = 'granted' | 'denied' | 'pending'

/** What `init` received, and the instance it handed to `loaded`. */
export interface FakePosthogSdk {
  /** `method(args…)` per call, in order, starting after `init`. */
  calls: string[]
  initKey: string | undefined
  initOptions: Record<string, unknown> | undefined
  distinctId: string
  userState: 'anonymous' | 'identified'
  consent: Consent
  sessionId: string
  windowId: string
  /** What `register` and `group` persisted; `reset` clears it, as posthog-js does. */
  properties: Record<string, unknown>
}

export const sdk: FakePosthogSdk = {
  calls: [],
  initKey: undefined,
  initOptions: undefined,
  distinctId: 'anon-1',
  userState: 'anonymous',
  consent: 'pending',
  sessionId: '01a0fc35-b7fe-7546-a76f-fea28a1f3cbe',
  windowId: '01a0fc35-b7fe-7546-a76f-fea28a1f3cbf',
  properties: {},
}

/** Restores the fake to a fresh, anonymous, never-initialised SDK. */
export function resetFakePosthog(): void {
  sdk.calls = []
  sdk.initKey = undefined
  sdk.initOptions = undefined
  sdk.distinctId = 'anon-1'
  sdk.userState = 'anonymous'
  sdk.consent = 'pending'
  sdk.properties = {}
}

function record(name: string, ...args: unknown[]): void {
  sdk.calls.push(`${name}(${args.map((arg) => JSON.stringify(arg)).join(', ')})`)
}

export const instance = {
  register: vi.fn((properties: Record<string, unknown>) => {
    record('register', properties)
    sdk.properties = { ...sdk.properties, ...properties }
  }),
  unregister: vi.fn((name: string) => {
    record('unregister', name)
    const rest = { ...sdk.properties }
    delete rest[name]
    sdk.properties = rest
  }),
  capture: vi.fn((event: string, properties: unknown) => record('capture', event, properties)),
  identify: vi.fn((id: string) => {
    record('identify', id)
    sdk.distinctId = id
    sdk.userState = 'identified'
  }),
  group: vi.fn((type: string, key: string) => {
    record('group', type, key)
    const groups = (sdk.properties.$groups as Record<string, string> | undefined) ?? {}
    sdk.properties = { ...sdk.properties, $groups: { ...groups, [type]: key } }
  }),
  resetGroups: vi.fn(() => {
    record('resetGroups')
    sdk.properties = { ...sdk.properties, $groups: {} }
  }),
  reset: vi.fn(() => {
    record('reset')
    sdk.distinctId = 'anon-2'
    sdk.userState = 'anonymous'
    sdk.consent = 'pending'
    sdk.properties = {}
  }),
  opt_in_capturing: vi.fn(() => {
    record('opt_in_capturing')
    sdk.consent = 'granted'
  }),
  opt_out_capturing: vi.fn(() => {
    record('opt_out_capturing')
    sdk.consent = 'denied'
  }),
  has_opted_out_capturing: vi.fn(() => sdk.consent === 'denied'),
  get_explicit_consent_status: vi.fn(() => sdk.consent),
  get_property: vi.fn((name: string) =>
    name === '$user_state' ? sdk.userState : sdk.properties[name]
  ),
  get_distinct_id: vi.fn(() => sdk.distinctId),
  get_session_id: vi.fn(() => sdk.sessionId),
  sessionManager: {
    checkAndGetSessionAndWindowId: vi.fn(() => ({
      sessionId: sdk.sessionId,
      windowId: sdk.windowId,
    })),
  },
}

export const posthogDefault = {
  init: vi.fn((key: string, options: Record<string, unknown>) => {
    sdk.initKey = key
    sdk.initOptions = options
    const loaded = options.loaded as (loadedInstance: typeof instance) => void
    loaded(instance)
    return instance
  }),
}
