import { messageFrom, retryAfterSecondsFrom, statusFrom } from '@/lib/api-error'

/**
 * What a link page's Try again panel says after a verify failed for a reason
 * that may pass. A rate limit names its wait, from `Retry-After`, as "Too many
 * {attempts}. Try again in 42 seconds." (in minutes from 120 s up); anything
 * else says what the server or the network did. Shared with apex byte for
 * byte, for both apps' link pages.
 * @param error - The failed request's error.
 * @param attempts - What was attempted too often, such as "sign-in attempts".
 */
export function retryableFailureMessage(error: unknown, attempts: string): string {
  const wait = statusFrom(error) === 429 ? retryAfterSecondsFrom(error) : null
  if (wait === null) return messageFrom(error)
  const after = wait < 120 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`
  return `Too many ${attempts}. Try again in ${after}.`
}
