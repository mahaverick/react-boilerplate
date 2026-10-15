/**
 * @file Reads tokens out of Mailpit, for invitations the capture seeds.
 */
import { expect } from '@playwright/test'

const MAILPIT_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? 'http://localhost:8025'

/**
 * Polls Mailpit (15 s) for the newest email to `email` holding a link whose
 * path contains `path`, and returns its `token` or `invitation` query value.
 * @param email - The recipient.
 * @param path - e.g. `/invitations/accept` or `/register`.
 */
export async function mailedToken(email: string, path: string): Promise<string> {
  let token = ''
  await expect
    .poll(
      async () => {
        const search = await fetch(
          `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
        )
        const found = (await search.json()) as { messages?: { ID: string }[] }
        for (const { ID } of found.messages ?? []) {
          const message = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${ID}`)
          const body = (await message.json()) as { Text?: string }
          for (const href of (body.Text ?? '').match(/https?:\/\/[^\s"'<>]+/g) ?? []) {
            const url = new URL(href)
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
