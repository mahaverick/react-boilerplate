import { http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { bootstrapSession } from '@/router'
import { useAuthStore } from '@/states/auth.store'
import { fail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

describe('session bootstrap', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
  })

  it('restores a session from the refresh cookie', async () => {
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.isBootstrapped).toBe(true)
  })

  it('settles as signed-out when there is no valid cookie', async () => {
    server.use(http.post('/api/v1/auth/refresh', () => fail('Unauthorized', 401)))
    await bootstrapSession()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    // The critical assertion: bootstrapped must be TRUE even on failure, or
    // a guard waiting on it would hang forever instead of redirecting.
    expect(s.isBootstrapped).toBe(true)
  })

  it('runs the refresh only once across concurrent callers', async () => {
    let refreshCount = 0
    server.use(
      http.post('/api/v1/auth/refresh', () => {
        refreshCount += 1
        return HttpResponseOk()
      })
    )
    await Promise.all([bootstrapSession(), bootstrapSession(), bootstrapSession()])
    expect(refreshCount).toBe(1)
  })
})

function HttpResponseOk() {
  return new Response(
    JSON.stringify({
      success: true,
      message: 'Token refreshed.',
      statusCode: 200,
      data: { accessToken: 'fresh-token' },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}
