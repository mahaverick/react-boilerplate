import { http } from 'msw'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const SETUP_REFUSAL = 'Create a passkey to continue. Every account here needs one.'

/**
 * Answers the first read this app's signed-in shell makes (`GET /api/v1/tenants`)
 * with the required-mode refusal until `state.created` flips, then with an empty
 * list. Per app: each shell reads a different endpoint first.
 * @param state - `created` flips when the test's passkey is created.
 */
export function refuseShellUntilCreated(state: { created: boolean }) {
  server.use(
    http.get('/api/v1/tenants', () =>
      state.created
        ? ok({ items: [], nextCursor: null, hasMore: false }, 'ok')
        : fail(SETUP_REFUSAL, 403, 'PASSKEY_SETUP_REQUIRED')
    )
  )
}
