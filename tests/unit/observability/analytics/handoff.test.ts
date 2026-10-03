import { http, HttpResponse } from 'msw'
import { PostHog } from 'posthog-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONSUMED_HANDOFFS_KEY,
  isPersistedIdentified,
  MAX_CONSUMED_HANDOFFS,
  readHandoff,
  stripHandoffParams,
} from '@/observability/analytics/handoff'
import { server } from '@/tests/mocks/server'

const SITE = 'https://www.example.com'
const DID = '01a0fc35-b7ee-7b93-b550-d8a7f98e30be'
const SID = '01a0fc35-b7fe-7546-a76f-fea28a1f3cbe'
const OTHER_DID = '01a0fc35-b7ee-7b93-b550-d8a7f98e30bf'

function search(params: Record<string, string>) {
  return { search: `?${new URLSearchParams(params).toString()}` }
}

describe('readHandoff', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('accepts an allowlisted referrer with a UUID id and session, nobody identified', () => {
    expect(
      readHandoff(search({ ph_did: DID, ph_sid: SID }), `${SITE}/pricing`, [SITE], false)
    ).toEqual({ bootstrap: { distinctID: DID, sessionID: SID } })
  })

  it('accepts the id alone when the session id is missing or not a UUID', () => {
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], false)).toEqual({
      bootstrap: { distinctID: DID },
    })
    expect(
      readHandoff(search({ ph_did: OTHER_DID, ph_sid: 'nope' }), `${SITE}/`, [SITE], false)
    ).toEqual({ bootstrap: { distinctID: OTHER_DID } })
  })

  it.each([
    ['someone is already identified', search({ ph_did: DID }), `${SITE}/`, [SITE], true],
    [
      'the referrer is not allowlisted',
      search({ ph_did: DID }),
      'https://evil.example/',
      [SITE],
      false,
    ],
    [
      'the referrer is a lookalike subdomain',
      search({ ph_did: DID }),
      'https://www.example.com.evil.example/',
      [SITE],
      false,
    ],
    ['there is no referrer', search({ ph_did: DID }), '', [SITE], false],
    ['nothing is allowlisted', search({ ph_did: DID }), `${SITE}/`, [], false],
    [
      'the id is not a UUID',
      search({ ph_did: 'pii-probe@example.test' }),
      `${SITE}/`,
      [SITE],
      false,
    ],
    ['there is no id', search({ ph_sid: SID }), `${SITE}/`, [SITE], false],
  ])('ignores the handoff when %s', (_case, location, referrer, allowlist, isIdentified) => {
    expect(readHandoff(location, referrer, allowlist, isIdentified)).toEqual({})
  })

  it('accepts an id once: the same id handed off again is refused', () => {
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], false)).toEqual({
      bootstrap: { distinctID: DID },
    })
    expect(readHandoff(search({ ph_did: DID, ph_sid: SID }), `${SITE}/`, [SITE], false)).toEqual({})
    expect(JSON.parse(window.localStorage.getItem(CONSUMED_HANDOFFS_KEY) ?? '[]')).toEqual([DID])
  })

  it('records only accepted ids, so a refused one can still be accepted later', () => {
    expect(readHandoff(search({ ph_did: DID }), 'https://evil.example/', [SITE], false)).toEqual({})
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], true)).toEqual({})
    expect(window.localStorage.getItem(CONSUMED_HANDOFFS_KEY)).toBeNull()
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], false)).toEqual({
      bootstrap: { distinctID: DID },
    })
  })

  it(`remembers the last ${MAX_CONSUMED_HANDOFFS} ids and forgets the oldest`, () => {
    const ids = Array.from(
      { length: MAX_CONSUMED_HANDOFFS + 1 },
      (_, index) => `01a0fc35-b7ee-7b93-b550-${index.toString(16).padStart(12, '0')}`
    )
    for (const id of ids) {
      expect(readHandoff(search({ ph_did: id }), `${SITE}/`, [SITE], false)).toEqual({
        bootstrap: { distinctID: id },
      })
    }
    const consumed: unknown = JSON.parse(window.localStorage.getItem(CONSUMED_HANDOFFS_KEY) ?? '[]')
    expect(consumed).toHaveLength(MAX_CONSUMED_HANDOFFS)
    expect(consumed).toEqual(ids.slice(1))
    expect(readHandoff(search({ ph_did: ids[1] ?? '' }), `${SITE}/`, [SITE], false)).toEqual({})
  })

  it('ignores a stored value that is not a list of ids', () => {
    window.localStorage.setItem(CONSUMED_HANDOFFS_KEY, JSON.stringify({ not: 'a list' }))
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], false)).toEqual({
      bootstrap: { distinctID: DID },
    })
  })

  it.each([
    ['the list cannot be read', 'getItem'],
    ['the id cannot be recorded', 'setItem'],
  ] as const)('refuses the handoff when %s', (_case, method) => {
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error('storage blocked')
    })
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], false)).toEqual({})
  })

  it('refuses the handoff when the stored list is not JSON', () => {
    window.localStorage.setItem(CONSUMED_HANDOFFS_KEY, '{not json')
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], false)).toEqual({})
  })
})

describe('stripHandoffParams', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/')
  })

  it('removes both parameters and keeps everything else', () => {
    window.history.replaceState({ kept: 1 }, '', `/tenants?tab=a&ph_did=${DID}&ph_sid=${SID}#h`)
    stripHandoffParams()
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
      '/tenants?tab=a#h'
    )
    expect(window.history.state).toEqual({ kept: 1 })
  })

  it('leaves the history entry alone when there is nothing to strip', () => {
    window.history.replaceState(null, '', '/tenants?tab=a')
    const before = window.history.length
    stripHandoffParams()
    expect(window.location.search).toBe('?tab=a')
    expect(window.history.length).toBe(before)
  })
})

describe('isPersistedIdentified, against the pinned posthog-js', () => {
  afterEach(() => {
    window.localStorage.clear()
    for (const cookie of document.cookie.split('; ')) {
      document.cookie = `${cookie.split('=')[0]}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`
    }
  })

  it('is false with nothing stored, true once identified, false again after reset', async () => {
    server.use(http.all('http://localhost:3000/api/v1/collect/*', () => HttpResponse.json({})))
    const key = 'phc_test_key_not_real'
    expect(isPersistedIdentified(key)).toBe(false)

    const instance = new PostHog().init(
      key,
      {
        api_host: 'http://localhost:3000/api/v1/collect',
        defaults: '2026-08-30',
        persistence: 'localStorage+cookie',
        disable_session_recording: true,
        before_send: () => null,
      },
      'handoff-test'
    )
    expect(isPersistedIdentified(key)).toBe(false)

    instance?.identify('user-1')
    await expect.poll(() => isPersistedIdentified(key)).toBe(true)

    instance?.reset()
    await expect.poll(() => isPersistedIdentified(key)).toBe(false)
  })

  it('reads the cookie when localStorage holds nothing', () => {
    document.cookie = `ph_phc_test_key_not_real_posthog=${encodeURIComponent(JSON.stringify({ $user_state: 'identified' }))}; path=/`
    expect(isPersistedIdentified('phc_test_key_not_real')).toBe(true)
  })

  it('reads the configured persistence name instead of the key-derived one', () => {
    window.localStorage.setItem('ph_ph_apex', JSON.stringify({ $user_state: 'identified' }))
    expect(isPersistedIdentified('phc_test_key_not_real', 'ph_apex')).toBe(true)
    expect(isPersistedIdentified('phc_test_key_not_real')).toBe(false)
    window.localStorage.clear()
    window.localStorage.setItem(
      'ph_phc_test_key_not_real_posthog',
      JSON.stringify({ $user_state: 'identified' })
    )
    expect(isPersistedIdentified('phc_test_key_not_real', 'ph_apex')).toBe(false)
  })

  it('is false for unreadable stored state', () => {
    window.localStorage.setItem('ph_phc_test_key_not_real_posthog', '{not json')
    expect(isPersistedIdentified('phc_test_key_not_real')).toBe(false)
  })
})
