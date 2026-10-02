import { http, HttpResponse } from 'msw'
import { PostHog } from 'posthog-js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isPersistedIdentified,
  readHandoff,
  stripHandoffParams,
} from '@/observability/analytics/handoff'
import { server } from '@/tests/mocks/server'

const SITE = 'https://www.example.com'
const DID = '01a0fc35-b7ee-7b93-b550-d8a7f98e30be'
const SID = '01a0fc35-b7fe-7546-a76f-fea28a1f3cbe'

function search(params: Record<string, string>) {
  return { search: `?${new URLSearchParams(params).toString()}` }
}

describe('readHandoff', () => {
  it('accepts an allowlisted referrer with a UUID id and session, nobody identified', () => {
    expect(
      readHandoff(search({ ph_did: DID, ph_sid: SID }), `${SITE}/pricing`, [SITE], false)
    ).toEqual({ bootstrap: { distinctID: DID, sessionID: SID } })
  })

  it('accepts the id alone when the session id is missing or not a UUID', () => {
    expect(readHandoff(search({ ph_did: DID }), `${SITE}/`, [SITE], false)).toEqual({
      bootstrap: { distinctID: DID },
    })
    expect(readHandoff(search({ ph_did: DID, ph_sid: 'nope' }), `${SITE}/`, [SITE], false)).toEqual(
      { bootstrap: { distinctID: DID } }
    )
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

  it('is false for unreadable stored state', () => {
    window.localStorage.setItem('ph_phc_test_key_not_real_posthog', '{not json')
    expect(isPersistedIdentified('phc_test_key_not_real')).toBe(false)
  })
})
