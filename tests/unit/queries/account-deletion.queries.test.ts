/**
 * @file Covers the account-deletion queries against a stub axios adapter, so
 * the suite needs no mock server and runs the same under any runner.
 */
import { QueryClient } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { apiClient } from '@/http/client'
import {
  accountDeletionKeys,
  deletionRequestQueryOptions,
} from '@/queries/account-deletion.queries'
import { useAuthStore } from '@/states/auth.store'
import { afterEach, beforeEach, describe, expect, it } from '@/tests/support/runner'

/** The adapter `apiClient` had before each test. */
const realAdapter = apiClient.defaults.adapter

/** Answers every request with an express success envelope holding `data`. */
function answering(data: unknown): AxiosAdapter {
  return (config) =>
    Promise.resolve({
      data: { success: true, message: 'OK', statusCode: 200, data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
}

beforeEach(() => {
  useAuthStore.setState({
    accessToken: 'access-token',
    isAuthenticated: true,
    isBootstrapped: true,
  })
})

afterEach(() => {
  apiClient.defaults.adapter = realAdapter
  useAuthStore.setState({ accessToken: null, isAuthenticated: false })
})

describe('deletionRequestQueryOptions', () => {
  it('reads null when no request is open', async () => {
    apiClient.defaults.adapter = answering({ request: null })

    const request = await new QueryClient().fetchQuery(deletionRequestQueryOptions())

    expect(request).toBeNull()
  })

  it('reads the open request out of the API’s wrapper', async () => {
    const open = { requestedAt: '2026-11-01T00:00:00.000Z', dueAt: '2026-12-01T00:00:00.000Z' }
    apiClient.defaults.adapter = answering({ request: open })

    const request = await new QueryClient().fetchQuery(deletionRequestQueryOptions())

    expect(request).toEqual(open)
  })

  it('is cached under the deletion-request key', () => {
    expect(deletionRequestQueryOptions().queryKey).toEqual(accountDeletionKeys.request)
  })
})
