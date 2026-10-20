/**
 * @file Drives the "Confirm it's you" dialog through an emailed link, the way
 * a signed-in person does: "Email me a link", then the link opened in another tab,
 * which posts `step_up_confirmed` on the shared auth channel.
 */
import { screen, waitFor, within } from '@testing-library/react'
import type { UserEvent } from '@testing-library/user-event'
import { http } from 'msw'
import { expect } from 'vitest'
import { useAuthStore } from '@/states/auth.store'
import { ok, testUser } from '@/tests/mocks/handlers'
import { freshlyConfirmedToken } from '@/tests/mocks/jwt'
import { server } from '@/tests/mocks/server'

/** The wait view's body, which says the link went out. */
export const STEP_UP_EMAIL_WAIT = 'Check your email. Open the link in this browser to continue.'

/**
 * Asks for a link in the open step-up dialog and confirms it from another
 * tab, then waits for the dialog to close. The refresh that follows answers a
 * token whose `auth_time` is now, and `/profile` answers the signed-in user,
 * so a role set on the store survives the refresh.
 * @param user - The test's user-event instance.
 * @param dialog - The open step-up dialog; found by its name when omitted.
 * @returns The access token the refresh brought, which the retry carries.
 */
export async function confirmStepUp(user: UserEvent, dialog?: HTMLElement): Promise<string> {
  const stepUp = dialog ?? (await screen.findByRole('dialog', { name: 'Confirm it’s you' }))
  const accessToken = freshlyConfirmedToken()
  server.use(
    http.post('/api/v1/auth/refresh', () => ok({ accessToken }, 'Session refreshed.')),
    http.get('/api/v1/profile', () =>
      ok(useAuthStore.getState().user ?? testUser, 'Profile retrieved.')
    )
  )
  await user.click(within(stepUp).getByRole('button', { name: 'Email me a link' }))
  await within(stepUp).findByText(STEP_UP_EMAIL_WAIT)
  const otherTab = new BroadcastChannel('auth')
  try {
    otherTab.postMessage({ type: 'step_up_confirmed' })
    await waitFor(() => expect(stepUp.isConnected).toBe(false))
  } finally {
    otherTab.close()
  }
  return accessToken
}

/**
 * Dismisses the open step-up dialog from its first view, with Escape.
 * @param user - The test's user-event instance.
 */
export async function dismissStepUp(user: UserEvent): Promise<void> {
  const stepUp = await screen.findByRole('dialog', { name: 'Confirm it’s you' })
  await within(stepUp).findByRole('button', { name: 'Email me a link' })
  await user.keyboard('{Escape}')
  await waitFor(() => expect(stepUp.isConnected).toBe(false))
}
