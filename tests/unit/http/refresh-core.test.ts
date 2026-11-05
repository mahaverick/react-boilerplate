/**
 * @file Covers the refresh core both transports share. Every request goes to
 * a stub axios adapter, so the suite needs no mock server and runs the same
 * under any runner.
 */
import axios, {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios'
import { NoRefreshTokenError, SessionIdentityChangedError } from '@/http/auth-verdict'
import {
  createRefreshCore,
  type RefreshCoreOptions,
  type RefreshTokenStore,
} from '@/http/refresh-core'
import { useAuthStore } from '@/states/auth.store'
import { beforeEach, describe, expect, it } from '@/tests/support/runner'
import type { User } from '@/types/api.types'

/** The user the stub's `/profile` answers with unless a test says otherwise. */
const ALICE: User = {
  id: '00000000-0000-4000-8000-00000000a11c',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  platformRole: null,
  analyticsOptOut: false,
}

/** A second person, for the identity-change case. */
const BOB: User = { ...ALICE, id: '00000000-0000-4000-8000-000000000b0b', email: 'bob@example.com' }

/** One request the stub adapter saw. */
interface SeenRequest {
  method: string
  url: string
  body: unknown
  authorization: string | null
}

/** How the stub answers one request: a body, a status, or a dropped connection. */
type Answer = { data: unknown } | { status: number } | 'network-error'

/** The success envelope every express answer arrives in. */
function envelope(data: unknown) {
  return { success: true, message: 'OK', statusCode: 200, data }
}

/**
 * A stub adapter that records every request and answers each by `route`.
 * A custom adapter skips axios's `validateStatus`, so a 4xx is thrown here,
 * as the built-in adapters do.
 */
function stubAdapter(route: (request: SeenRequest) => Answer | Promise<Answer>) {
  const seen: SeenRequest[] = []
  /** Answers one request. */
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const request: SeenRequest = {
      method: (config.method ?? 'get').toUpperCase(),
      url: config.url ?? '',
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      authorization: (config.headers.get('Authorization') as string | undefined) ?? null,
    }
    seen.push(request)
    const answer = await route(request)
    if (answer === 'network-error') {
      throw new AxiosError('Network Error', 'ERR_NETWORK', config, {})
    }
    const response: AxiosResponse = {
      data: 'data' in answer ? answer.data : { success: false, message: 'Failed' },
      status: 'status' in answer ? answer.status : 200,
      statusText: 'OK',
      headers: {},
      config,
    }
    if (response.status >= 400) {
      throw new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, response)
    }
    return response
  }
  return { adapter, seen }
}

/** The default route: a refresh answers as express does for `transport`, and `/profile` with Alice. */
function expressRoute(transport: 'cookie' | 'body', profile: User = ALICE) {
  return (request: SeenRequest): Answer => {
    if (request.url === '/auth/refresh') {
      return {
        data: envelope(
          transport === 'body'
            ? {
                accessToken: 'fresh-token',
                refreshToken: 'rotated-refresh',
                refreshTokenExpiresAt: '2026-12-01T00:00:00.000Z',
              }
            : { accessToken: 'fresh-token' }
        ),
      }
    }
    if (request.url === '/profile') return { data: envelope(profile) }
    return { status: 404 }
  }
}

/** An in-memory refresh-token store that records every write and clear. */
function memoryStore(initial: string | null) {
  const log: string[] = []
  let token = initial
  const store: RefreshTokenStore = {
    read() {
      return Promise.resolve(token)
    },
    async write(next) {
      await Promise.resolve()
      token = next
      log.push(`write:${next}`)
    },
    clear() {
      token = null
      log.push('clear')
      return Promise.resolve()
    },
  }
  return { store, log, current: () => token }
}

/** A core over a client whose adapter is `adapter`, with `extra` options on top. */
function coreWith(
  adapter: AxiosAdapter,
  transport: 'cookie' | 'body',
  extra: Partial<RefreshCoreOptions> = {}
) {
  const client = axios.create({ baseURL: '/api/v1', adapter })
  return createRefreshCore({ client, transport, ...extra })
}

/** The refresh POSTs among `seen`. */
function refreshPosts(seen: SeenRequest[]) {
  return seen.filter((request) => request.url === '/auth/refresh')
}

describe('createRefreshCore', () => {
  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('shares one refresh between concurrent callers', async () => {
    const { adapter, seen } = stubAdapter(expressRoute('cookie'))
    const core = coreWith(adapter, 'cookie')

    const tokens = await Promise.all([
      core.ensureSession(),
      core.ensureSession(),
      core.ensureSession(),
    ])

    expect(tokens).toEqual(['fresh-token', 'fresh-token', 'fresh-token'])
    expect(refreshPosts(seen)).toHaveLength(1)
    expect(useAuthStore.getState().user).toEqual(ALICE)
    expect(useAuthStore.getState().accessToken).toBe('fresh-token')
  })

  it('starts a new refresh once the last one has settled', async () => {
    const { adapter, seen } = stubAdapter(expressRoute('cookie'))
    const core = coreWith(adapter, 'cookie')

    await core.ensureSession()
    await core.ensureSession()

    expect(refreshPosts(seen)).toHaveLength(2)
  })

  it('fetches the profile with the new bearer token', async () => {
    const { adapter, seen } = stubAdapter(expressRoute('cookie'))
    await coreWith(adapter, 'cookie').ensureSession()

    const profile = seen.find((request) => request.url === '/profile')
    expect(profile?.authorization).toBe('Bearer fresh-token')
  })

  it('runs the refresh inside the lock it is given', async () => {
    const events: string[] = []
    const { adapter } = stubAdapter((request) => {
      events.push(request.url)
      return expressRoute('cookie')(request)
    })
    const core = coreWith(adapter, 'cookie', {
      lock: async (run) => {
        events.push('lock:start')
        const result = await run()
        events.push('lock:end')
        return result
      },
    })

    await Promise.all([core.ensureSession(), core.ensureSession()])

    expect(events).toEqual(['lock:start', '/auth/refresh', '/profile', 'lock:end'])
  })

  it('body: two concurrent callers send one POST and both see the stored token', async () => {
    const { adapter, seen } = stubAdapter(expressRoute('body'))
    const tokens = memoryStore('stored-refresh')
    const core = coreWith(adapter, 'body', { tokenStore: tokens.store })

    const results = await Promise.all([core.ensureSession(), core.ensureSession()])

    expect(results).toEqual(['fresh-token', 'fresh-token'])
    const posts = refreshPosts(seen)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toEqual({ refreshToken: 'stored-refresh' })
    expect(tokens.current()).toBe('rotated-refresh')
  })

  it('body: stores the new token before resolving', async () => {
    let storedWhenProfileAsked: string | null = 'unset'
    const tokens = memoryStore('stored-refresh')
    const { adapter } = stubAdapter(async (request) => {
      if (request.url === '/profile') storedWhenProfileAsked = await tokens.store.read()
      return expressRoute('body')(request)
    })

    await coreWith(adapter, 'body', { tokenStore: tokens.store }).ensureSession()

    expect(storedWhenProfileAsked).toBe('rotated-refresh')
    expect(tokens.log).toEqual(['write:rotated-refresh'])
  })

  it('body: rejects with NoRefreshTokenError and sends nothing when no token is stored', async () => {
    const { adapter, seen } = stubAdapter(expressRoute('body'))
    const tokens = memoryStore(null)

    await expect(
      coreWith(adapter, 'body', { tokenStore: tokens.store }).ensureSession()
    ).rejects.toBeInstanceOf(NoRefreshTokenError)

    expect(seen).toHaveLength(0)
  })

  it('body: retries once at once on a network error, with the same token', async () => {
    let attempts = 0
    const { adapter, seen } = stubAdapter((request) => {
      if (request.url === '/auth/refresh') {
        attempts += 1
        if (attempts === 1) return 'network-error'
      }
      return expressRoute('body')(request)
    })
    const tokens = memoryStore('stored-refresh')

    const token = await coreWith(adapter, 'body', { tokenStore: tokens.store }).ensureSession()

    expect(token).toBe('fresh-token')
    expect(refreshPosts(seen).map((request) => request.body)).toEqual([
      { refreshToken: 'stored-refresh' },
      { refreshToken: 'stored-refresh' },
    ])
  })

  it('body: gives up after the one retry', async () => {
    const { adapter, seen } = stubAdapter(() => 'network-error')
    const tokens = memoryStore('stored-refresh')

    await expect(
      coreWith(adapter, 'body', { tokenStore: tokens.store }).ensureSession()
    ).rejects.toBeInstanceOf(AxiosError)

    expect(refreshPosts(seen)).toHaveLength(2)
    expect(tokens.current()).toBe('stored-refresh')
  })

  it('body: clears the store on a 401', async () => {
    const { adapter } = stubAdapter((request) =>
      request.url === '/auth/refresh' ? { status: 401 } : expressRoute('body')(request)
    )
    const tokens = memoryStore('stored-refresh')

    await expect(
      coreWith(adapter, 'body', { tokenStore: tokens.store }).ensureSession()
    ).rejects.toBeInstanceOf(AxiosError)

    expect(tokens.log).toEqual(['clear'])
    expect(tokens.current()).toBeNull()
  })

  it('body: keeps the store on a 503', async () => {
    const { adapter } = stubAdapter((request) =>
      request.url === '/auth/refresh' ? { status: 503 } : expressRoute('body')(request)
    )
    const tokens = memoryStore('stored-refresh')

    await expect(
      coreWith(adapter, 'body', { tokenStore: tokens.store }).ensureSession()
    ).rejects.toBeInstanceOf(AxiosError)

    expect(tokens.log).toEqual([])
  })

  it('cookie: posts no body and does not retry on a network error', async () => {
    const { adapter, seen } = stubAdapter(() => 'network-error')

    await expect(coreWith(adapter, 'cookie').ensureSession()).rejects.toBeInstanceOf(AxiosError)

    const posts = refreshPosts(seen)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.body).toBeUndefined()
  })

  it('throws SessionIdentityChangedError when the profile is another user', async () => {
    useAuthStore.getState().login('stale', ALICE)
    const calls: string[] = []
    const { adapter } = stubAdapter(expressRoute('cookie', BOB))
    const core = coreWith(adapter, 'cookie', {
      onIdentityChanged: () => calls.push(`identity:${String(useAuthStore.getState().user?.id)}`),
      onSignedOut: () => calls.push('signedOut'),
    })

    await expect(core.ensureSession()).rejects.toBeInstanceOf(SessionIdentityChangedError)

    // Called before logout(), so the hook still sees the signed-in user.
    expect(calls).toEqual([`identity:${ALICE.id}`])
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('calls onSignedOut only when a user was signed in', async () => {
    let signedOut = 0
    const { adapter } = stubAdapter((request) =>
      request.url === '/auth/refresh' ? { status: 401 } : expressRoute('cookie')(request)
    )
    const core = coreWith(adapter, 'cookie', { onSignedOut: () => (signedOut += 1) })

    await expect(core.ensureSession()).rejects.toBeInstanceOf(AxiosError)
    expect(signedOut).toBe(0)

    useAuthStore.getState().login('stale', ALICE)
    await expect(core.ensureSession()).rejects.toBeInstanceOf(AxiosError)
    expect(signedOut).toBe(1)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('leaves the store alone on a failure that is not a verdict', async () => {
    useAuthStore.getState().login('live', ALICE)
    let signedOut = 0
    const { adapter } = stubAdapter((request) =>
      request.url === '/auth/refresh' ? { status: 502 } : expressRoute('cookie')(request)
    )

    await expect(
      coreWith(adapter, 'cookie', { onSignedOut: () => (signedOut += 1) }).ensureSession()
    ).rejects.toBeInstanceOf(AxiosError)

    expect(signedOut).toBe(0)
    expect(useAuthStore.getState().accessToken).toBe('live')
  })

  it('reset drops the in-flight refresh', async () => {
    /** Lets the first refresh answer; replaced by the gate's resolver. */
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { adapter, seen } = stubAdapter(async (request) => {
      if (request.url === '/auth/refresh' && refreshPosts(seen).length === 1) await gate
      return expressRoute('cookie')(request)
    })
    const core = coreWith(adapter, 'cookie')

    const first = core.ensureSession()
    core.reset()
    const second = core.ensureSession()
    release()

    await Promise.all([first, second])
    expect(refreshPosts(seen)).toHaveLength(2)
  })
})
