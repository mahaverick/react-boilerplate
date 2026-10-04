import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  currentRouteId,
  ERROR_BUFFER_LIMIT,
  installErrorListeners,
  noteError,
  resetErrorListenForTests,
  RETHROW_WINDOW_MS,
  rootErrorOptions,
  setErrorRouteSource,
} from '@/observability/errors/listen'
import { report } from '@/observability/errors/report'

vi.mock('@/observability/errors/report', () => ({ report: vi.fn() }))

const reported = vi.mocked(report)

beforeEach(() => {
  resetErrorListenForTests()
  reported.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('noteError', () => {
  it('buffers errors until the reporter loads, then hands them over in order', async () => {
    const first = new Error('first')
    const second = new Error('second')
    noteError(first, 'window', false)
    noteError(second, 'router', true)
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(2)
    })
    expect(reported.mock.calls).toEqual([
      [first, 'window', false, expect.any(Number)],
      [second, 'router', true, expect.any(Number)],
    ])
  })

  it('hands a buffered error over with the time it was noted, and a later one without', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      const noted = Date.now()
      noteError(new Error('buffered'), 'window', false)
      vi.useRealTimers()
      await vi.waitFor(() => {
        expect(reported).toHaveBeenCalledTimes(1)
      })
      expect(reported.mock.calls[0]?.[3]).toBe(noted)
      noteError(new Error('direct'), 'window', false)
      expect(reported.mock.calls[1]).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports straight away once the reporter has loaded', async () => {
    noteError(new Error('loads it'), 'window', false)
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(1)
    })
    const later = new Error('later')
    noteError(later, 'rejection', false)
    expect(reported).toHaveBeenLastCalledWith(later, 'rejection', false)
  })

  it('notes the same error object once, whichever source sees it first', async () => {
    const error = new Error('twice')
    noteError(error, 'react', true)
    noteError(error, 'router', true)
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(1)
    })
    expect(reported).toHaveBeenCalledWith(error, 'react', true, expect.any(Number))
  })

  it('notes a re-throw of the same crash once: a new object with the same name, message and stack', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const first = new TypeError('name.trim is not a function')
      const again = Object.assign(new TypeError(first.message), { stack: first.stack })
      noteError(first, 'react', true)
      noteError(again, 'react', true)
      noteError(Object.assign(new TypeError(first.message), { stack: 'elsewhere' }), 'react', true)
      noteError(Object.assign(new RangeError(first.message), { stack: first.stack }), 'react', true)
      vi.setSystemTime(Date.now() + RETHROW_WINDOW_MS - 1)
      noteError(
        Object.assign(new TypeError(first.message), { stack: first.stack }),
        'window',
        false
      )
      await vi.waitFor(() => {
        expect(reported).toHaveBeenCalledTimes(3)
      })
      expect(reported.mock.calls.map(([error]) => error)).not.toContain(again)

      vi.setSystemTime(Date.now() + 1)
      const later = Object.assign(new TypeError(first.message), { stack: first.stack })
      noteError(later, 'react', true)
      expect(reported).toHaveBeenCalledTimes(4)
      expect(reported).toHaveBeenLastCalledWith(later, 'react', true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never merges errors without a stack', async () => {
    noteError(Object.assign(new Error('bare'), { stack: undefined }), 'window', false)
    noteError(Object.assign(new Error('bare'), { stack: undefined }), 'window', false)
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps at most the buffer limit before the reporter loads', async () => {
    for (let index = 0; index < ERROR_BUFFER_LIMIT + 5; index += 1) {
      noteError(new Error(`error ${String(index)}`), 'window', false)
    }
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(ERROR_BUFFER_LIMIT)
    })
  })

  it('passes a thrown string or other primitive through', async () => {
    noteError('a string', 'rejection', false)
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledWith('a string', 'rejection', false, expect.any(Number))
    })
  })

  it('never throws, even when the reporter does', async () => {
    noteError(new Error('loads it'), 'window', false)
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(1)
    })
    reported.mockImplementationOnce(() => {
      throw new Error('reporter broke')
    })
    expect(() => {
      noteError(new Error('next'), 'window', false)
    }).not.toThrow()
  })
})

describe('installErrorListeners', () => {
  it('notes window errors, error events without an error, and unhandled rejections, once each', async () => {
    installErrorListeners()
    installErrorListeners()
    const thrown = new Error('uncaught')
    window.dispatchEvent(new ErrorEvent('error', { error: thrown, message: 'uncaught' }))
    const opaque = new ErrorEvent('error', { message: 'Script error.' })
    window.dispatchEvent(opaque)
    const reason = new Error('rejected')
    const rejection = new Event('unhandledrejection') as PromiseRejectionEvent
    Object.defineProperty(rejection, 'reason', { value: reason })
    window.dispatchEvent(rejection)

    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(3)
    })
    expect(reported.mock.calls).toEqual([
      [thrown, 'window', false, expect.any(Number)],
      [opaque, 'window', false, expect.any(Number)],
      [reason, 'rejection', false, expect.any(Number)],
    ])
  })
})

describe('rootErrorOptions', () => {
  it('notes uncaught errors as unhandled and caught ones as handled, and still logs both', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const uncaught = new Error('uncaught render')
    const caught = new Error('caught render')
    rootErrorOptions.onUncaughtError(uncaught)
    rootErrorOptions.onCaughtError(caught)
    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalledTimes(2)
    })
    expect(reported.mock.calls).toEqual([
      [uncaught, 'react', false, expect.any(Number)],
      [caught, 'react', true, expect.any(Number)],
    ])
    expect(log.mock.calls).toEqual([[uncaught], [caught]])
  })
})

describe('the route source', () => {
  it('reads the registered route id, and nothing when unregistered or throwing', () => {
    expect(currentRouteId()).toBeUndefined()
    setErrorRouteSource(() => '/_app/dashboard')
    expect(currentRouteId()).toBe('/_app/dashboard')
    setErrorRouteSource(() => {
      throw new Error('router gone')
    })
    expect(currentRouteId()).toBeUndefined()
  })
})

describe('a crashed route tree the router re-renders', () => {
  it('is one crash: the re-render after the router canonicalises the URL is not noted again', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    function CrashingLayout(): never {
      throw new TypeError('name.trim is not a function')
    }
    const rootRoute = createRootRoute({ component: Outlet })
    const layoutRoute = createRoute({
      getParentRoute: () => rootRoute,
      id: '_app',
      component: CrashingLayout,
      errorComponent: () => createElement('h1', null, 'Something went wrong'),
    })
    const pageRoute = createRoute({
      getParentRoute: () => layoutRoute,
      path: '/overview',
      // A search default: `/overview` is not canonical, so the router replaces it with `?range=7d` on mount.
      validateSearch: z.object({ range: z.enum(['7d', '30d']).default('7d').catch('7d') }),
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([layoutRoute.addChildren([pageRoute])]),
      history: createMemoryHistory({ initialEntries: ['/overview'] }),
    })
    // As main.tsx: the first load, then the mount (whose canonicalising replace loads again).
    await router.load()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container, rootErrorOptions)
    act(() => {
      root.render(createElement(RouterProvider, { router }))
    })
    await vi.waitFor(() => {
      expect(router.state.location.search).toEqual({ range: '7d' })
    })

    await vi.waitFor(() => {
      expect(reported).toHaveBeenCalled()
    })
    // The replaced match reset the error boundary, so React caught a second, new error object…
    const caught = log.mock.calls
      .map(([error]: unknown[]) => error)
      .filter((error) => error instanceof TypeError)
    expect(caught).toHaveLength(2)
    expect(caught[0]).not.toBe(caught[1])
    // …and error tracking noted only the first.
    expect(reported).toHaveBeenCalledTimes(1)
    expect(reported).toHaveBeenCalledWith(caught[0], 'react', true, expect.any(Number))
    act(() => {
      root.unmount()
    })
    container.remove()
  })
})
