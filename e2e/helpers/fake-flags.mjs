/**
 * @file A stand-in for PostHog's `GET /flags/definitions`, so
 * `e2e/live/flags.test.ts` runs against a real express: express fetches it
 * every 30 s, and `scripts/e2e-flags-set.mjs` changes a flag through
 * `POST /__flags`. The body is the shape express parses
 * (express-boilerplate `src/validators/flag-definition.validators.ts`), built
 * as express's own test definitions are (`tests/helpers/flag-definitions.ts`):
 * `tenant` at group index 0, every flag hash-free (100 % rollout, a condition
 * variant), so no answer depends on which user or tenant asks. express's
 * schema cannot be imported here, so the nightly flags test is the contract
 * check: it fails when express refuses this body. With this host as
 * `POSTHOG_HOST`, express's analytics drain (`/batch/`) and the paths its
 * `/api/v1/collect` proxy forwards land here too, and are accepted and
 * discarded. Run it with `pnpm e2e:fake-flags`.
 */
import { realpathSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

/** The `POSTHOG_PROJECT_KEY` express must send as `?token=`. */
export const FAKE_FLAGS_PROJECT_KEY = 'phc_test_key_not_real'

/** The `POSTHOG_FEATURE_FLAGS_KEY` express must send as its bearer key. */
export const FAKE_FLAGS_SECURE_KEY = 'phs_test_key_not_real'

/** The port the script listens on unless `E2E_FAKE_FLAGS_PORT` names another. */
const DEFAULT_PORT = 4064

/** The values `POST /__flags` accepts for each flag. */
const ALLOWED_VALUES = {
  example_beta_page: ['on', 'off'],
  example_cta_experiment: ['control', 'bold'],
}

/** express's drain path and the browser ingest paths its proxy forwards: answered 200 and discarded. */
const INGEST_PATHS = new Set(['/e/', '/i/v0/e/', '/s/', '/batch/', '/flags/', '/decide/'])

/** The most body bytes kept; a larger `POST /__flags` body is refused. */
const MAX_BODY_BYTES = 4096

/**
 * One flag as PostHog sends it, with the defaults express's test definitions use.
 * @param id - The flag id.
 * @param key - The flag key.
 * @param active - Whether the flag is on in PostHog.
 * @param filters - The flag's `filters`.
 * @returns The definition.
 */
function definition(id, key, active, filters) {
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

/**
 * The definitions body for the current values: `example_beta_page` is
 * tenant-scoped, so it aggregates on group index 0, which
 * `group_type_mapping` names `tenant`; off is `active: false`.
 * `example_cta_experiment` is user-scoped and always active, its one
 * condition forcing every user to the set variant.
 * @param values - The current flag values.
 * @returns The body express parses.
 */
function definitionsBody(values) {
  return {
    flags: [
      definition(1, 'example_beta_page', values.example_beta_page === 'on', {
        aggregation_group_type_index: 0,
        groups: [{ aggregation_group_type_index: 0, properties: [], rollout_percentage: 100 }],
      }),
      definition(2, 'example_cta_experiment', true, {
        aggregation_group_type_index: null,
        groups: [
          {
            aggregation_group_type_index: null,
            properties: [],
            rollout_percentage: 100,
            variant: values.example_cta_experiment,
          },
        ],
        multivariate: {
          variants: [
            { key: 'control', rollout_percentage: 50 },
            { key: 'bold', rollout_percentage: 50 },
          ],
        },
      }),
    ],
    group_type_mapping: { 0: 'tenant' },
    cohorts: {},
    property_matching_version: 1,
    minimal_flag_called_events: false,
  }
}

/**
 * A JSON answer.
 * @param status - The status code.
 * @param value - The body, serialised.
 * @returns The answer.
 */
function jsonAnswer(status, value) {
  return { status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) }
}

/**
 * A body parsed as JSON.
 * @param text - The body, or null when it was over `MAX_BODY_BYTES`.
 * @returns The value, or undefined when there is none or it is not JSON.
 */
function parsedJson(text) {
  if (text === null) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * A fake flags host's state and its request handler, with no socket, so a
 * unit test drives it directly. Both flags start off.
 * @param options - The credentials express must present.
 * @param options.projectKey - The expected `?token=`.
 * @param options.secureKey - The expected bearer key.
 * @returns `handle`, which answers one request, and `values`, a copy of the current values.
 */
export function createFakeFlags({
  projectKey = FAKE_FLAGS_PROJECT_KEY,
  secureKey = FAKE_FLAGS_SECURE_KEY,
} = {}) {
  const state = {
    version: 1,
    values: { example_beta_page: 'off', example_cta_experiment: 'control' },
  }

  /**
   * The current weak ETag, which every set changes.
   * @returns The ETag header value.
   */
  const currentEtag = () => `W/"fake-flags-${state.version}"`

  /**
   * Answers a definitions fetch: 401 without express's credentials, 304 to
   * the exact current ETag, else the body.
   * @param url - The parsed request URL.
   * @param headers - The request headers, lowercased.
   * @returns The answer.
   */
  const definitionsAnswer = (url, headers) => {
    if (
      url.searchParams.get('token') !== projectKey ||
      headers.authorization !== `Bearer ${secureKey}`
    ) {
      return jsonAnswer(401, {
        type: 'authentication_error',
        detail: 'fake flags host: wrong token or bearer key',
      })
    }
    const etag = currentEtag()
    if (headers['if-none-match'] === etag) return { status: 304, headers: { etag }, body: '' }
    return {
      status: 200,
      headers: { 'content-type': 'application/json', etag },
      body: JSON.stringify(definitionsBody(state.values)),
    }
  }

  /**
   * Sets one flag from a `{ "key", "value" }` body and changes the ETag; 400 for anything else.
   * @param text - The request body, or null when it was over `MAX_BODY_BYTES`.
   * @returns The answer.
   */
  const setAnswer = (text) => {
    const input = parsedJson(text)
    if (typeof input !== 'object' || input === null) {
      return jsonAnswer(400, {
        error: `expected a JSON object {"key","value"} of at most ${MAX_BODY_BYTES} bytes`,
      })
    }
    const { key, value } = input
    if (typeof key !== 'string' || !Object.hasOwn(ALLOWED_VALUES, key)) {
      return jsonAnswer(400, {
        error: `unknown flag ${JSON.stringify(key)}: expected ${Object.keys(ALLOWED_VALUES).join(' or ')}`,
      })
    }
    const allowed = ALLOWED_VALUES[key]
    if (!allowed.includes(value)) {
      return jsonAnswer(400, {
        error: `${key} takes ${allowed.join(' or ')}, not ${JSON.stringify(value)}`,
      })
    }
    state.values[key] = value
    state.version += 1
    return jsonAnswer(200, { key, value, etag: currentEtag() })
  }

  /**
   * Answers one request.
   * @param request - The method, the URL as received (path and query), the lowercased headers and the body.
   * @returns The status, headers and body to send.
   */
  const handle = ({ method, url, headers, body }) => {
    const parsed = new URL(url, 'http://127.0.0.1')
    if (parsed.pathname === '/flags/definitions') {
      return method === 'GET'
        ? definitionsAnswer(parsed, headers)
        : jsonAnswer(405, { error: 'GET only' })
    }
    if (parsed.pathname === '/__flags') {
      return method === 'POST' ? setAnswer(body) : jsonAnswer(405, { error: 'POST only' })
    }
    if (INGEST_PATHS.has(parsed.pathname)) return jsonAnswer(200, { status: 1 })
    return jsonAnswer(404, { error: `the fake flags host has no ${parsed.pathname}` })
  }

  return { handle, values: () => ({ ...state.values }) }
}

/**
 * Reads a request body to its end, keeping at most `MAX_BODY_BYTES`.
 * @param request - The incoming request.
 * @returns The body as text, or null when it was larger.
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const read = { bytes: 0 }
    request.on('data', (chunk) => {
      read.bytes += chunk.length
      if (read.bytes <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    request.on('end', () => {
      resolve(read.bytes <= MAX_BODY_BYTES ? Buffer.concat(chunks).toString('utf8') : null)
    })
    request.on('error', reject)
  })
}

/**
 * Starts a fake flags host on 127.0.0.1.
 * @param options - Where to listen and which credentials to expect.
 * @param options.port - The port; 0 picks a free one. Defaults to 4064.
 * @param options.projectKey - The expected `?token=`.
 * @param options.secureKey - The expected bearer key.
 * @returns Resolves with its URL, its port, its current values and an idempotent `close`.
 */
export function startFakeFlags({ port = DEFAULT_PORT, ...credentials } = {}) {
  const fake = createFakeFlags(credentials)
  const server = createServer((request, response) => {
    readBody(request).then(
      (body) => {
        const answer = fake.handle({
          method: request.method ?? 'GET',
          url: request.url ?? '/',
          headers: request.headers,
          body,
        })
        response.writeHead(answer.status, answer.headers)
        response.end(answer.body)
      },
      () => {
        response.writeHead(400)
        response.end()
      }
    )
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const bound = server.address().port
      resolve({
        url: `http://127.0.0.1:${bound}`,
        port: bound,
        values: fake.values,
        close: () =>
          new Promise((closed) => {
            if (!server.listening) {
              closed()
              return
            }
            server.close(() => closed())
            server.closeAllConnections()
          }),
      })
    })
  })
}

/**
 * Whether this file is the process's entry script. Compared by real path, so a
 * symlinked checkout still starts the server; an entry path that does not
 * resolve is not this file.
 * @returns True when run as `node e2e/helpers/fake-flags.mjs`.
 */
function isMain() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isMain()) {
  const fake = await startFakeFlags({
    port: Number(process.env.E2E_FAKE_FLAGS_PORT ?? DEFAULT_PORT),
  })
  console.log(
    `fake flags host on ${fake.url}: POSTHOG_HOST=${fake.url} POSTHOG_PROJECT_KEY=${FAKE_FLAGS_PROJECT_KEY} POSTHOG_FEATURE_FLAGS_KEY=${FAKE_FLAGS_SECURE_KEY}`
  )
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      fake.close().then(
        () => process.exit(0),
        () => process.exit(1)
      )
    })
  }
}
