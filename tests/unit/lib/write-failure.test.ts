import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'
import { markRefusedAfterConfirm } from '@/lib/step-up'
import { writeFailureMessage } from '@/lib/write-failure'

/** An Axios error carrying express's error envelope. */
function apiError(status: number, message: string, code: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError(message, 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: '',
    headers: {},
    config,
    data: { success: false, message, statusCode: status, code, requestId: 'r' },
  })
}

describe('writeFailureMessage', () => {
  it('maps a dismissed REAUTH_REQUIRED to "Confirm it’s you to continue."', () => {
    const error = apiError(401, 'Sign in again.', 'REAUTH_REQUIRED')
    expect(writeFailureMessage(error)).toBe('Confirm it’s you to continue.')
  })

  it('says the confirmation did not take when the retry was refused again', () => {
    const error = apiError(401, 'Sign in again.', 'REAUTH_REQUIRED')
    markRefusedAfterConfirm(error)
    expect(writeFailureMessage(error)).toBe('We couldn’t confirm it’s you. Try the action again.')
  })

  it('shows any other failure as the server sent it', () => {
    expect(writeFailureMessage(apiError(403, 'You can’t do that.', 'FORBIDDEN'))).toBe(
      'You can’t do that.'
    )
  })
})
