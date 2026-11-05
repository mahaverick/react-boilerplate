/**
 * @file Pins the client ↔ session import cycle when `@/http/client` loads
 * first: the modules are re-imported fresh in that order, and the first
 * `ensureSession()` must reach the client without a `ReferenceError`.
 */
import { describe, expect, it, vi } from 'vite-plus/test'
import { stubSessionAdapter } from '@/tests/fixtures/session-adapter'

describe('load order: client, then session', () => {
  it('refreshes without a ReferenceError', async () => {
    vi.resetModules()
    const { apiClient } = await import('@/http/client')
    const session = await import('@/http/session')
    apiClient.defaults.adapter = stubSessionAdapter()

    await expect(session.ensureSession()).resolves.toBe('fresh-token')
  })
})
