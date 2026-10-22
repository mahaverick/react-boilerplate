// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vite-plus/test'
import {
  createFakeFlags,
  FAKE_FLAGS_PROJECT_KEY,
  FAKE_FLAGS_SECURE_KEY,
  type FakeFlags,
  type FakeFlagsAnswer,
  type FakeFlagsRequest,
} from '../../e2e/helpers/fake-flags.mjs'

/** The definitions URL with express's `?token=`. */
const DEFINITIONS_URL = `/flags/definitions?token=${FAKE_FLAGS_PROJECT_KEY}`
/** The bearer express sends. */
const BEARER = `Bearer ${FAKE_FLAGS_SECURE_KEY}`

/**
 * One flag as express's own test definitions build it
 * (express-boilerplate tests/helpers/flag-definitions.ts `flagDefinition`).
 */
function definition(
  id: number,
  key: string,
  active: boolean,
  filters: Record<string, unknown>
): Record<string, unknown> {
  return {
    id,
    key,
    name: key,
    team_id: 1,
    version: 1,
    active,
    deleted: false,
    ensure_experience_continuity: false,
    has_experiment: false,
    evaluation_runtime: 'all',
    bucketing_identifier: 'distinct_id',
    evaluation_contexts: [],
    filters,
  }
}

/** `example_beta_page`: tenant-aggregated (group index 0), 100 % rollout. */
const BETA_FILTERS = {
  aggregation_group_type_index: 0,
  groups: [{ aggregation_group_type_index: 0, properties: [], rollout_percentage: 100 }],
}

/** `example_cta_experiment`: person-aggregated, everyone forced to `variant` at 100 %. */
function ctaFilters(variant: 'control' | 'bold'): Record<string, unknown> {
  return {
    aggregation_group_type_index: null,
    groups: [
      { aggregation_group_type_index: null, properties: [], rollout_percentage: 100, variant },
    ],
    multivariate: {
      variants: [
        { key: 'control', rollout_percentage: 50 },
        { key: 'bold', rollout_percentage: 50 },
      ],
    },
  }
}

/** The whole body, in the shape express's `parseDefinitionsResponse` reads. */
function body(isBetaOn: boolean, variant: 'control' | 'bold'): Record<string, unknown> {
  return {
    flags: [
      definition(1, 'example_beta_page', isBetaOn, BETA_FILTERS),
      definition(2, 'example_cta_experiment', true, ctaFilters(variant)),
    ],
    group_type_mapping: { '0': 'tenant' },
    cohorts: {},
    property_matching_version: 1,
    minimal_flag_called_events: false,
  }
}

/** A request to `fake`: a definitions GET with express's credentials, unless `request` says otherwise. */
function send(fake: FakeFlags, request: Partial<FakeFlagsRequest> = {}): FakeFlagsAnswer {
  return fake.handle({
    method: 'GET',
    url: DEFINITIONS_URL,
    headers: { authorization: BEARER },
    body: '',
    ...request,
  })
}

/** Sets `key` to `value` through `POST /__flags`. */
function set(fake: FakeFlags, key: string, value: string): FakeFlagsAnswer {
  return fake.handle({
    method: 'POST',
    url: '/__flags',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
}

/** An answer's body, parsed. */
function json(answer: FakeFlagsAnswer): unknown {
  return JSON.parse(answer.body)
}

let fake: FakeFlags

beforeEach(() => {
  fake = createFakeFlags()
})

describe('GET /flags/definitions', () => {
  it('serves both test flags off at first, in the shape express parses', () => {
    const answer = send(fake)

    expect(answer.status).toBe(200)
    expect(answer.headers['content-type']).toBe('application/json')
    expect(answer.headers.etag).toMatch(/^W\/"fake-flags-\d+"$/)
    expect(json(answer)).toEqual(body(false, 'control'))
    expect(fake.values()).toEqual({ example_beta_page: 'off', example_cta_experiment: 'control' })
  })

  it.each([
    { name: 'a wrong token', request: { url: '/flags/definitions?token=phc_wrong' } },
    { name: 'no token', request: { url: '/flags/definitions' } },
    { name: 'a wrong bearer key', request: { headers: { authorization: 'Bearer phs_wrong' } } },
    { name: 'no Authorization header', request: { headers: {} } },
  ])('answers 401 to $name', ({ request }) => {
    expect(send(fake, request).status).toBe(401)
  })

  it('answers 304 only to the exact ETag it sent, weak prefix included', () => {
    const etag = send(fake).headers.etag ?? ''

    const same = send(fake, { headers: { authorization: BEARER, 'if-none-match': etag } })
    expect(same).toEqual({ status: 304, headers: { etag }, body: '' })

    const stripped = etag.replace(/^W\//, '')
    expect(
      send(fake, { headers: { authorization: BEARER, 'if-none-match': stripped } }).status
    ).toBe(200)
    expect(
      send(fake, { headers: { authorization: BEARER, 'if-none-match': 'W/"other"' } }).status
    ).toBe(200)
  })

  it('answers 405 to any method but GET', () => {
    expect(send(fake, { method: 'POST' }).status).toBe(405)
  })
})

describe('POST /__flags', () => {
  it('turns example_beta_page on and off, with a new ETag each time', () => {
    const before = send(fake).headers.etag ?? ''

    const on = set(fake, 'example_beta_page', 'on')
    expect(on.status).toBe(200)
    const afterOn = send(fake)
    expect(json(afterOn)).toEqual(body(true, 'control'))
    expect(afterOn.headers.etag).not.toBe(before)
    expect(json(on)).toEqual({ key: 'example_beta_page', value: 'on', etag: afterOn.headers.etag })
    // express's stored ETag is now stale, so its next conditional fetch must get the new body.
    expect(send(fake, { headers: { authorization: BEARER, 'if-none-match': before } }).status).toBe(
      200
    )

    expect(set(fake, 'example_beta_page', 'off').status).toBe(200)
    const afterOff = send(fake)
    expect(json(afterOff)).toEqual(body(false, 'control'))
    expect(afterOff.headers.etag).not.toBe(afterOn.headers.etag)
  })

  it('forces example_cta_experiment to the variant set, at 100 % rollout', () => {
    expect(set(fake, 'example_cta_experiment', 'bold').status).toBe(200)
    expect(json(send(fake))).toEqual(body(false, 'bold'))
    expect(set(fake, 'example_cta_experiment', 'control').status).toBe(200)
    expect(json(send(fake))).toEqual(body(false, 'control'))
  })

  it('changes the ETag even when the value is already set', () => {
    const before = send(fake).headers.etag
    expect(set(fake, 'example_beta_page', 'off').status).toBe(200)
    expect(send(fake).headers.etag).not.toBe(before)
  })

  it.each([
    { name: 'an unknown key', body: JSON.stringify({ key: 'nope', value: 'on' }) },
    {
      name: 'a variant for the boolean',
      body: JSON.stringify({ key: 'example_beta_page', value: 'bold' }),
    },
    {
      name: 'on for the experiment',
      body: JSON.stringify({ key: 'example_cta_experiment', value: 'on' }),
    },
    { name: 'a key that is not a string', body: JSON.stringify({ key: 7, value: 'on' }) },
    { name: 'a body that is not JSON', body: 'example_beta_page=on' },
    { name: 'a JSON string', body: '"example_beta_page"' },
    { name: 'a JSON null', body: 'null' },
    { name: 'a body over 4096 bytes', body: null },
  ])('answers 400 to $name and changes nothing', ({ body: requestBody }) => {
    const before = send(fake).headers.etag

    const answer = fake.handle({
      method: 'POST',
      url: '/__flags',
      headers: { 'content-type': 'application/json' },
      body: requestBody,
    })

    expect(answer.status).toBe(400)
    expect(json(answer)).toHaveProperty('error', expect.any(String))
    expect(fake.values()).toEqual({ example_beta_page: 'off', example_cta_experiment: 'control' })
    expect(send(fake).headers.etag).toBe(before)
  })

  it('answers 405 to any method but POST', () => {
    expect(fake.handle({ method: 'GET', url: '/__flags', headers: {}, body: '' }).status).toBe(405)
  })
})

describe('everything else', () => {
  it.each(['/batch/', '/e/', '/i/v0/e/', '/s/?compression=gzip-js', '/flags/?v=2', '/decide/'])(
    'accepts and discards a POST to the ingest path %s',
    (url) => {
      const answer = fake.handle({ method: 'POST', url, headers: {}, body: '{"api_key":"x"}' })
      expect(answer.status).toBe(200)
      expect(json(answer)).toEqual({ status: 1 })
    }
  )

  it('answers 404 to any other path, such as the assets host’s /static/', () => {
    expect(
      fake.handle({ method: 'GET', url: '/static/array.js', headers: {}, body: '' }).status
    ).toBe(404)
  })
})
