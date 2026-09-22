import '@testing-library/jest-dom/vitest'
import { toHaveNoViolations } from 'jest-axe'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { server } from '@/tests/mocks/server'

expect.extend(toHaveNoViolations)

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
