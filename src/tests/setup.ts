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

// `onUnhandledRequest: 'error'` is deliberate: a test that hits an unmocked
// URL should fail loudly, not silently pass against a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
