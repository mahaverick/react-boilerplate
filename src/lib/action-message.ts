import { messageFrom } from '@/lib/api-error'

/**
 * The sentence a failed account action shows: the server's message as it
 * arrives. This is the one seam for that text, so an app that words action
 * failures differently changes it here and nowhere else.
 * @param error - The rejection from the request.
 * @returns The message to show the user.
 */
export function actionMessageFrom(error: unknown): string {
  return messageFrom(error)
}
