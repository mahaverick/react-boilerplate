/**
 * @file Reads mailed links out of Mailpit: the sign-in and confirmation links
 * the live helpers follow, and the invitation tokens the capture seeds.
 * Shared with apex byte for byte, so it imports nothing of either app's.
 */
import { expect } from '@playwright/test'

const MAILPIT_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? 'http://localhost:8025'

/**
 * How far Mailpit's clock (the container's) may run behind the caller's.
 * Docker Desktop's VM lags after the host sleeps, and an exact comparison
 * would skip a fresh mail. 30 s is safe because two mails to one address with
 * the same link path are at least the 60 s mail cooldown apart, so the
 * allowance never reaches back to the previous link. Callers keep that gap:
 * express enforces it per address for sign-in links and per invitation for
 * confirm links, and the live helpers wait it out before asking again.
 */
const CLOCK_SKEW_MS = 30_000

/** One row of Mailpit's search: the message id and when Mailpit received it. */
interface MailpitSummary {
  ID: string
  Created: string
}

/**
 * Every message to `email`, newest first, as Mailpit's search lists them.
 * @param email - The recipient.
 */
async function messagesTo(email: string): Promise<MailpitSummary[]> {
  const search = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
  )
  const found = (await search.json()) as { messages?: MailpitSummary[] }
  return found.messages ?? []
}

/**
 * The links in a message's plain-text body, in order.
 * @param id - The Mailpit message id.
 */
async function linksIn(id: string): Promise<URL[]> {
  const message = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${id}`)
  const body = (await message.json()) as { Text?: string }
  return ((body.Text ?? '').match(/https?:\/\/[^\s"'<>]+/g) ?? []).map((href) => new URL(href))
}

/**
 * Polls Mailpit (15 s) for the newest message to `email` that Mailpit received
 * at or after `since` (less `CLOCK_SKEW_MS`) and whose text holds a link to
 * `path`, and returns that link, query included. Take `since` before the request that sends the mail.
 * A Mailpit that is down fails at once, with its own error.
 * @param email - The recipient.
 * @param path - The link's exact path, e.g. `/auth/link` or `/invitations/confirm`.
 * @param since - Epoch ms; older messages are ignored.
 * @throws When no such link arrives: the address's mail cooldown makes a second request inside it send nothing.
 */
export async function mailedLink(email: string, path: string, since: number): Promise<URL> {
  // Held in an object: the poll's closure writes them, which narrowing would not see on a bare `let`.
  const found: { link: URL | null; mailpitError: Error | null } = { link: null, mailpitError: null }
  /** Whether the link has arrived; a Mailpit failure is kept, so it is not mistaken for no mail. */
  const poll = async () => {
    try {
      for (const { ID, Created } of await messagesTo(email)) {
        if (Date.parse(Created) < since - CLOCK_SKEW_MS) continue
        found.link = (await linksIn(ID)).find((url) => url.pathname === path) ?? null
        if (found.link) return true
      }
      return false
    } catch (error) {
      found.mailpitError = error instanceof Error ? error : new Error(String(error))
      throw error
    }
  }
  try {
    await expect.poll(poll, { intervals: [500], timeout: 15_000 }).toBe(true)
  } catch (error) {
    if (found.mailpitError) throw found.mailpitError
    throw new Error(
      `no ${path} link mailed to ${email} since ${new Date(since).toISOString()}: a second request inside the mail cooldown sends nothing`,
      { cause: error }
    )
  }
  if (!found.link) throw new Error(`no ${path} link mailed to ${email}`)
  return found.link
}

/**
 * Polls Mailpit (15 s) for the newest email to `email` holding a link whose
 * path contains `path`, and returns its `token` or `invitation` query value.
 * @param email - The recipient.
 * @param path - e.g. `/invitations/accept`.
 */
export async function mailedToken(email: string, path: string): Promise<string> {
  let token = ''
  await expect
    .poll(
      async () => {
        for (const { ID } of await messagesTo(email)) {
          for (const url of await linksIn(ID)) {
            if (!url.pathname.includes(path)) continue
            token = url.searchParams.get('token') ?? url.searchParams.get('invitation') ?? ''
            if (token) return token
          }
        }
        return ''
      },
      { message: `no ${path} link mailed to ${email}`, intervals: [500], timeout: 15_000 }
    )
    .not.toBe('')
  return token
}
