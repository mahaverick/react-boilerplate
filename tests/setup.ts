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

// The matcher registered above, told to the type system. `@types/jest-axe`
// augments `jest.Matchers`, which this project does not have — vitest keeps its
// own `Matchers` interface — so without this every `toHaveNoViolations()` call
// in `tests/unit/a11y.test.tsx` is a TS2339 and an eslint `no-unsafe-call`.
//
// Both type parameters have to repeat vitest's own declaration EXACTLY,
// constraints and defaults included (see `interface Matchers` in
// vitest/dist/chunks/config.*.d.ts) — declaration merging rejects an interface
// whose parameters differ at all, so `T` cannot simply be dropped here even
// though this matcher takes no subject type. Hence the disable: the parameter
// is required by the merge and unusable by the signature.
//
// It is NOT narrowed to axe's result type. `@types/jest-axe` declares its own
// `AxeResults` locally rather than exporting it, and axe-core's identically
// named type is a different declaration — a `T extends AxeResults` guard
// resolves to `never` at both call sites.
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toHaveNoViolations(): R
  }
}

// jsdom ships no `window.matchMedia`. `__root` renders sonner's <Toaster> on
// every route, and sonner calls it UNGUARDED in an effect
// (`window.matchMedia('(prefers-color-scheme: dark)')`), so any test that
// mounts the real route tree renders sonner's error boundary instead of the
// page. A permissive stub is the whole fix. Every query is false except a
// `max-width` one, which answers from `window.innerWidth`, so a test picks the
// viewport `useIsMobile` reports by setting the width. A test that cares about
// another query overrides the stub locally, as theme.store.test.ts does.
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

// jsdom defines `window.scrollTo` but only as a "Not implemented" stub that
// logs through its virtual console and does nothing. TanStack Router calls it
// on every navigation (router-core's scroll-restoration resets the window to
// the top), so every test that mounts the route tree printed one line per
// navigation — 133 on a full run — burying real warnings. Replacing it with a
// silent no-op loses no behaviour: jsdom has no layout, so there was never a
// scroll position to change. Unconditional, unlike matchMedia above, because
// the property exists; a `!window.scrollTo` guard would never fire.
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
}

// `useNotificationStream()` used to open an `EventSource`, which jsdom does
// not ship, and needed a global idle stub here for exactly that reason. It
// now reads the stream over `fetch` instead — real traffic as far as msw is
// concerned — so the idle case is handled by the default `/notifications/
// stream` handler in `tests/mocks/handlers.ts` (a body that never enqueues
// and never closes), the same way the two `/notifications` defaults already
// handle the bell. Nothing here needs a stub of its own any more.
//
// `onUnhandledRequest: 'error'` is deliberate: a test that hits an unmocked
// URL should fail loudly, not silently pass against a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
// Sonner's toast store is module-global and outlives each test's <Toaster>: a
// toast still active when its Toaster unmounts is replayed into the next
// test's Toaster for a fresh 4s. Unmount first, so no Toaster is subscribed,
// then dismiss every active toast. RTL's own cleanup runs after this hook and
// finds nothing left to unmount.
afterEach(() => {
  cleanup()
  toast.dismiss()
  server.resetHandlers()
})
afterAll(() => server.close())
