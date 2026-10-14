import '@/lib/zod-jitless'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { createElement } from 'react'
import { afterAll, afterEach, beforeAll, expect, vi } from 'vitest'
import { toast } from '@/lib/toast'
import { server } from '@/tests/mocks/server'

expect.extend(toHaveNoViolations)

/**
 * How long `findBy*` and `waitFor` may wait. Testing Library's default is one second and
 * vitest's `testTimeout` does not govern it. A `findBy*` that starts while the suite's
 * per-file workers are still standing up can outlast one second under full-suite contention.
 * `testTimeout` in vitest.config.ts stays the larger (20 s), so a hung test fails on its own
 * assertion rather than being cut off mid-wait.
 */
configure({ asyncUtilTimeout: 5_000 })

/**
 * Every `<Toaster>` in the unit tests keeps its toasts for 60 s instead of
 * Base UI's 5 s, longer than any test runs (`testTimeout` is 20 s), so no
 * assertion can pass or fail on the auto-dismiss racing it. A toast still
 * closes through its close button, an action or `toast.dismiss`. A test that
 * needs the timer passes its own `timeout`. This also reaches the Toaster that
 * `ToastHost` imports lazily.
 */
vi.mock('@/components/ui/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/toast')>()
  return {
    ...actual,
    Toaster: (props: Parameters<typeof actual.Toaster>[0]) =>
      createElement(actual.Toaster, { timeout: 60_000, ...props }),
  }
})

declare module 'vitest' {
  /**
   * Augments vitest's `Matchers` so `toHaveNoViolations()` type-checks in
   * `tests/unit/a11y.test.tsx`; `@types/jest-axe` augments `jest.Matchers`, which this
   * project has no `jest` global for. Both type parameters repeat vitest's own declaration
   * exactly: declaration merging rejects an interface whose parameters differ at all, so
   * `T` cannot be dropped even though this matcher takes no subject type.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by declaration merging, unused by this matcher's signature
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R
  }
}

/**
 * jsdom ships no `window.matchMedia`. `useIsMobile` and `AppLayout`'s system-theme effect
 * call it unguarded, so a test that mounts the real route tree would throw instead of
 * rendering the page. Every query is false except a `max-width` one, which answers from
 * `window.innerWidth`, so a test picks the viewport `useIsMobile` reports by setting the
 * width. A test about another query overrides the stub locally, as theme.store.test.ts does.
 */
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    get matches() {
      const maxWidth = /max-width:\s*(\d+)px/.exec(query)
      return maxWidth ? window.innerWidth <= Number(maxWidth[1]) : false
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

/**
 * jsdom defines `window.scrollTo` only as a "Not implemented" stub that logs through its
 * virtual console. TanStack Router's scroll restoration calls it on every navigation, so
 * every test that mounts the route tree would print a console line per navigation, burying
 * real warnings. jsdom has no layout, so a silent no-op loses nothing. Unconditional,
 * unlike matchMedia above, because the property exists and a `!window.scrollTo` guard
 * would never fire.
 */
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}

/**
 * `onUnhandledRequest: 'error'` is deliberate: a test that hits an unmocked URL fails
 * loudly instead of passing against a real network. The notification stream's idle case is
 * the default `/notifications/stream` handler in `tests/mocks/handlers.ts`.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
/**
 * `@/lib/toast` queues a toast raised while no `<Toaster>` is mounted, and the queue is
 * module-global: a test that toasts without a Toaster would hand its toast to the next
 * test's Toaster. Unmount first, so no Toaster is subscribed, then dismiss, which empties
 * the queue.
 */
afterEach(() => {
  cleanup()
  toast.dismiss()
  server.resetHandlers()
})
afterAll(() => server.close())
