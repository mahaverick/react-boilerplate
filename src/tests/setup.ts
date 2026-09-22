import '@testing-library/jest-dom/vitest'
import { toHaveNoViolations } from 'jest-axe'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { server } from '@/tests/mocks/server'

expect.extend(toHaveNoViolations)

// The matcher registered above, told to the type system. `@types/jest-axe`
// augments `jest.Matchers`, which this project does not have — vitest keeps its
// own `Matchers` interface — so without this every `toHaveNoViolations()` call
// in `src/tests/a11y.test.tsx` is a TS2339 and an eslint `no-unsafe-call`.
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

// jsdom ships no `EventSource` either, and `AppLayout` opens one through
// `useNotificationStream()` on every authenticated render — so without this
// every test that mounts the app shell dies with a ReferenceError before it
// renders anything. A no-op that merely satisfies the surface the hook uses
// is the whole fix: the hook only ever constructs, listens and closes, and a
// stub that never dispatches leaves the connection permanently idle, which is
// exactly what a test that is not about the stream wants.
//
// Assigned to `globalThis` rather than stubbed with `vi.stubGlobal`, because
// use-notifications.test.tsx installs a richer mock with `vi.stubGlobal` and
// calls `vi.unstubAllGlobals()` afterwards — which restores whatever was here
// BEFORE, and that has to be this no-op rather than `undefined`.
class IdleEventSource implements Pick<EventSource, 'close' | 'addEventListener'> {
  constructor(public url: string) {}
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}
globalThis.EventSource = IdleEventSource as unknown as typeof EventSource

// `onUnhandledRequest: 'error'` is deliberate: a test that hits an unmocked
// URL should fail loudly, not silently pass against a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
