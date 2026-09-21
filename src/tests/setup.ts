import '@testing-library/jest-dom/vitest'
import { toHaveNoViolations } from 'jest-axe'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import { server } from '@/tests/mocks/server'

expect.extend(toHaveNoViolations)

// `onUnhandledRequest: 'error'` is deliberate: a test that hits an unmocked
// URL should fail loudly, not silently pass against a real network.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
