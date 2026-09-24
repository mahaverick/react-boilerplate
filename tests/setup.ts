import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'
import { toHaveNoViolations } from 'jest-axe'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { server } from '@/tests/mocks/server'

expect.extend(toHaveNoViolations)

/**
 * How long `findBy*` and `waitFor` may wait. Testing Library's default is
 * ONE SECOND, and it is its own budget — vitest's `testTimeout` does not
 * govern it, so raising that alone would have changed nothing here.
 *
 * One second is not honest for this suite. It spawns a worker per test file —
 * dozens of them, at ~870ms of spawn plus jsdom environment each, both figures
 * the runner prints on every run — and a `findBy*` that starts while the machine
 * is still standing those up is racing the runner rather than the code. That
 * is measured, not supposed: three tests across `$slug.members` and
 * `tenants/index` failed on one full run in four, passed alone, and passed on
 * three reruns. CI is always cold, so it would have surfaced there.
 *
 * Five seconds, and `testTimeout` in vitest.config.ts is raised to 20s so a
 * test that genuinely hangs still fails on its own assertion rather than
 * being cut off mid-wait. Raised here rather than papered over with `retry`,
 * which would have hidden the next real race as effectively as this one.
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
// page. A permissive, always-false stub is the whole fix; a test that cares
// about a specific query overrides it locally, as theme.store.test.ts does.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
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
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
