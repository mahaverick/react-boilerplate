import { QueryClient } from '@tanstack/react-query'
import type { AnyRouter } from '@tanstack/react-router'
import axios, { AxiosError, type AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { finishPasskeySetup, installPasskeySetupInterceptor } from '@/lib/passkey-setup'
import { useAuthStore } from '@/states/auth.store'
import { usePasskeySetupStore } from '@/states/passkey-setup.store'
import { testUser } from '@/tests/mocks/handlers'

/** A client whose every request is refused with `status` and `code`. */
function clientRefusing(status: number, code: string) {
  /** Refuses the request the way the API would. */
  const adapter: AxiosAdapter = (config) =>
    Promise.reject(
      new AxiosError('refused', String(status), config, null, {
        status,
        statusText: '',
        headers: {},
        config,
        data: { success: false, message: 'Create a passkey to continue.', code },
      })
    )
  return axios.create({ adapter })
}

describe('installPasskeySetupInterceptor', () => {
  let uninstall: () => void

  beforeEach(() => {
    usePasskeySetupStore.setState({ required: false, message: null })
    useAuthStore.setState({ accessToken: 't', user: testUser, isAuthenticated: true })
  })

  afterEach(() => {
    uninstall()
  })

  it('a 403 PASSKEY_SETUP_REQUIRED sets the flag and still rejects; another 403 does not', async () => {
    const client = clientRefusing(403, 'FORBIDDEN')
    uninstall = installPasskeySetupInterceptor(client)
    await expect(client.get('/x')).rejects.toBeInstanceOf(AxiosError)
    expect(usePasskeySetupStore.getState().required).toBe(false)

    const refused = clientRefusing(403, 'PASSKEY_SETUP_REQUIRED')
    const off = installPasskeySetupInterceptor(refused)
    await expect(refused.get('/x')).rejects.toBeInstanceOf(AxiosError)
    expect(usePasskeySetupStore.getState().required).toBe(true)
    expect(usePasskeySetupStore.getState().message).toBe('Create a passkey to continue.')
    off()
  })

  it('does not set the flag for the same code on another status', async () => {
    const client = clientRefusing(401, 'PASSKEY_SETUP_REQUIRED')
    uninstall = installPasskeySetupInterceptor(client)
    await expect(client.get('/x')).rejects.toBeInstanceOf(AxiosError)
    expect(usePasskeySetupStore.getState().required).toBe(false)
  })

  it('resets the flag when the user signs out or switches, and not on sign-in', () => {
    uninstall = installPasskeySetupInterceptor(axios.create())
    usePasskeySetupStore.getState().setRequired(true, 'Create one.')

    // Same user, new token: stays.
    useAuthStore.getState().setToken('t2')
    expect(usePasskeySetupStore.getState().required).toBe(true)

    useAuthStore.getState().logout()
    expect(usePasskeySetupStore.getState().required).toBe(false)
    expect(usePasskeySetupStore.getState().message).toBeNull()

    // Sign-in (null to a user) does not reset.
    usePasskeySetupStore.getState().setRequired(true, 'Create one.')
    useAuthStore.getState().login('t3', testUser)
    expect(usePasskeySetupStore.getState().required).toBe(true)

    // A switch resets.
    useAuthStore.getState().login('t4', { ...testUser, id: 'someone-else' })
    expect(usePasskeySetupStore.getState().required).toBe(false)
  })

  it('stops listening once uninstalled', () => {
    installPasskeySetupInterceptor(axios.create())()
    usePasskeySetupStore.getState().setRequired(true, null)
    useAuthStore.getState().logout()
    expect(usePasskeySetupStore.getState().required).toBe(true)
    uninstall = () => undefined
  })
})

describe('finishPasskeySetup', () => {
  it('clears the flag, then invalidates the router and every query, in that order', async () => {
    usePasskeySetupStore.setState({ required: true, message: 'm' })
    const order: string[] = []
    const router = {
      invalidate: vi.fn(() => {
        order.push(`router:${String(usePasskeySetupStore.getState().required)}`)
        return Promise.resolve()
      }),
    } as unknown as AnyRouter
    const queryClient = new QueryClient()
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(() => {
      order.push('queries')
      return Promise.resolve()
    })
    await finishPasskeySetup(router, queryClient)
    expect(order).toEqual(['router:false', 'queries'])
    expect(usePasskeySetupStore.getState().message).toBeNull()
  })
})
