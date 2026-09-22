import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, type Page } from '@playwright/test'

const execFile = promisify(execFileCallback)

export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4040'
export const MAILPIT_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? 'http://localhost:8025'
export const API_DIR = process.env.E2E_API_DIR ?? '../express-boilerplate'

/** The password every e2e account uses. Long enough for the register schema. */
export const PASSWORD = 'a very long passphrase for e2e'

/**
 * A fresh address per run, because the login limiter is keyed `ip:email`
 * (`rate-limit.middleware.ts:loginRateLimitKey`) at five attempts per fifteen
 * minutes. A fixed address would pass once and then rate-limit every rerun
 * for the rest of the window, which reads as a broken test rather than a
 * spent bucket.
 */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`
}

async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown }
}

/**
 * Registers an account and verifies it, so the browser can sign in.
 *
 * Verification is NOT optional here: `/auth/register` answers 202 with
 * "If that address can be registered…" and login stays 401 until the address
 * is verified. The link only exists in the email, so mailpit is a required
 * part of this stack rather than a convenience.
 */
export async function createVerifiedUser(email: string): Promise<void> {
  const registered = await json(`${API_ORIGIN}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (registered.status !== 202 && registered.status !== 201) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`)
  }

  const token = await verificationTokenFor(email)

  // BOTH fields. `verifyEmailSchema` requires `token` AND `password`, and the
  // controller deliberately rethrows a validation failure as the same
  // "Invalid or expired verification token" a bad token gets — so omitting
  // the password looks exactly like a dead token and tells you nothing.
  const verified = await json(`${API_ORIGIN}/api/v1/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: PASSWORD }),
  })
  if (verified.status !== 200) {
    throw new Error(`verify failed: ${verified.status} ${JSON.stringify(verified.body)}`)
  }
}

/** Polls mailpit for the verification link and returns its token. */
async function verificationTokenFor(email: string): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const search = await fetch(
      `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
    )
    const found = (await search.json()) as { messages?: { ID: string }[] }
    const id = found.messages?.[0]?.ID
    if (id) {
      const message = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${id}`)
      const body = (await message.json()) as { Text?: string; HTML?: string }
      const link = /[?&]token=([a-f0-9]+)/i.exec(`${body.Text ?? ''}${body.HTML ?? ''}`)
      if (link) return link[1]
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `no verification email arrived for ${email} — is mailpit up on ${MAILPIT_ORIGIN}?`
  )
}

/** Whether the API answers its readiness probe. */
export async function apiIsReady(): Promise<boolean> {
  try {
    const response = await fetch(`${API_ORIGIN}/health/ready`, {
      signal: AbortSignal.timeout(2000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function waitForApi(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await apiIsReady()) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`API at ${API_ORIGIN} did not become ready within ${timeoutMs}ms`)
}

/**
 * Stops whatever is listening on the API port, then starts a new one.
 *
 * Kills by PORT rather than by a pid this process spawned, because the API is
 * normally started by hand (`pnpm dev` in express-boilerplate) and the SSE
 * test has to be able to restart THAT. `tsx watch` spawns a child, so the
 * whole process group goes.
 */
export async function restartApi(): Promise<void> {
  const port = new URL(API_ORIGIN).port || '80'

  // Kill EVERY pid holding the port, not just the process group of the one we
  // find first. `pnpm dev` is `tsx watch`, which spawns the real server as a
  // CHILD: SIGTERM to the parent's group left that child listening, the server
  // never went down, and "reconnects after a restart" was measuring a stream
  // that was never interrupted. SIGTERM first so it can close cleanly, then
  // SIGKILL whatever is still there.
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    // `-sTCP:LISTEN` is load-bearing: without it lsof also lists CLIENTS with
    // an open socket to this port, and the Vite dev server proxying /api is
    // one of them. Killing that takes the whole run down with it.
    const { stdout } = await execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).catch(() => ({
      stdout: '',
    }))
    const pids = stdout.split('\n').filter(Boolean).map(Number)
    if (pids.length === 0) break
    for (const pid of pids) {
      try {
        process.kill(pid, signal)
      } catch {
        /* already gone */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, signal === 'SIGTERM' ? 3000 : 1000))
  }

  // Confirm it actually went down, or "reconnects after a restart" passes
  // against a server that never stopped — which is exactly what happened the
  // first time this was written.
  const downBy = Date.now() + 15_000
  while (Date.now() < downBy) {
    if (!(await apiIsReady())) break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (await apiIsReady()) throw new Error('API did not stop; the restart test would be vacuous')

  spawn('pnpm', ['dev'], { cwd: API_DIR, detached: true, stdio: 'ignore' }).unref()
  await waitForApi()
}

/**
 * Registers, verifies and signs in through the real UI, leaving the browser
 * with a real session and a real refresh cookie.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await createVerifiedUser(email)
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).not.toHaveURL(/login/, { timeout: 15_000 })
}
