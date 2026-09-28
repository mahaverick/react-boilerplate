import '@/lib/zod-jitless'
import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { toast } from 'sonner'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { server } from '@/tests/mocks/server'

expect.extend(toHaveNoViolations)

/**
 * How long `findBy*` and `waitFor` may wait. Testing Library's default is one
 * second, and vitest's `testTimeout` does not govern it. This suite spawns a
 * worker per test file, and a `findBy*` that starts while workers are still
 * standing up can outlast one second under full-suite contention.
 * `testTimeout` in vitest.config.ts stays the larger, so a hung test fails
 * on its own assertion rather than being cut off mid-wait.
 */
configure({ asyncUtilTimeout: 5_000 })

declare module 'vitest' {
  /**
   * Augments vitest's `Matchers` so `toHaveNoViolations()` type-checks in
   * `tests/unit/a11y.test.tsx`; `@types/jest-axe` augments `jest.Matchers`,
   * which this project has no `jest` global for. Both type parameters repeat
   * vitest's own declaration exactly — declaration merging rejects an
   * interface whose parameters differ at all, so `T` cannot be dropped even
   * though this matcher takes no subject type. `T` is not narrowed to axe's
   * result type: `@types/jest-axe` declares its own `AxeResults` locally
   * rather than exporting it, and axe-core's identically named type is a
   * different declaration, so a `T extends AxeResults` guard would resolve
   * to `never` at both call sites.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- required by declaration merging, unused by this matcher's signature
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R
  }
}

/**
 * jsdom ships no `window.matchMedia`. `__root` renders sonner's `<Toaster>`
 * on every route, and sonner calls it UNGUARDED in an effect
 * (`window.matchMedia('(prefers-color-scheme: dark)')`), so any test that
 * mounts the real route tree renders sonner's error boundary instead of the
 * page. A permissive stub is the whole fix: every query is false except a
 * `max-width` one, which answers from `window.innerWidth`, so a test picks
 * the viewport `useIsMobile` reports by setting the width. A test that cares
 * about another query overrides the stub locally, as theme.store.test.ts
 * does.
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
 * jsdom defines `window.scrollTo` but only as a "Not implemented" stub that
 * logs through its virtual console and does nothing. TanStack Router calls it
 * on every navigation (router-core's scroll-restoration resets the window to
 * the top), so every test that mounts the route tree prints one console line
 * per navigation, burying real warnings. Replacing it with a silent no-op
 * loses no behaviour: jsdom has no layout, so there is never a scroll
 * position to change. Unconditional, unlike matchMedia above, because the
 * property exists; a `!window.scrollTo` guard would never fire.
 */
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}

/**
 * `useNotificationStream()` reads the stream over `fetch`, so the idle case
 * is handled by the default `/notifications/stream` handler in
 * `tests/mocks/handlers.ts` (a body that never enqueues and never closes),
 * the same way the two `/notifications` defaults already handle the bell.
 * `onUnhandledRequest: 'error'` is deliberate: a test that hits an unmocked
 * URL fails loudly, not silently passes against a real network.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
/**
 * Sonner's toast store is module-global and outlives each test's `<Toaster>`:
 * a toast still active when its Toaster unmounts is replayed into the next
 * test's Toaster for a fresh 4s. Unmount first, so no Toaster is subscribed,
 * then dismiss every active toast. RTL's own cleanup runs after this hook and
 * finds nothing left to unmount.
 */
afterEach(() => {
  cleanup()
  toast.dismiss()
  server.resetHandlers()
})
afterAll(() => server.close())
