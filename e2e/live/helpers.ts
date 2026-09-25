import { execFile as execFileCallback, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, type Page } from '@playwright/test'
import type { MembershipRole } from '@/constants/roles'

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
      if (link?.[1]) return link[1]
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
 * Signs an EXISTING, verified account in through the real UI, leaving the
 * browser with a real session and a real refresh cookie.
 */
export async function logIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).not.toHaveURL(/login/, { timeout: 15_000 })
}

/** Registers, verifies and signs in through the real UI. */
export async function signIn(page: Page, email: string): Promise<void> {
  await createVerifiedUser(email)
  await logIn(page, email)
}

/**
 * An access token straight from the API, for requests the browser cannot
 * make for us: the SPA's token lives in memory only (CLAUDE.md).
 */
export async function apiLogin(email: string): Promise<string> {
  const response = await json(`${API_ORIGIN}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const token = (response.body as { data?: { accessToken?: string } } | null)?.data?.accessToken
  if (response.status !== 200 || !token) {
    throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return token
}

/** One authenticated API call, answered with its status and parsed body. */
export async function apiRequest(
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ status: number; body: unknown }> {
  return json(`${API_ORIGIN}/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

/** Creates a tenant owned by the token's user. */
export async function createTenant(
  token: string,
  tenant: { name: string; slug: string }
): Promise<void> {
  const created = await apiRequest(token, 'POST', '/tenants', tenant)
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`create tenant failed: ${created.status} ${JSON.stringify(created.body)}`)
  }
}

/**
 * Gives a verified account a platform role through express's own bootstrap
 * script: the supported way in, and audited as `platform.member.granted`.
 * Must run BEFORE that account signs in: the role arrives with the session.
 */
export async function grantPlatformRole(email: string, role: MembershipRole): Promise<void> {
  await execFile('pnpm', ['platform:grant', email, role], { cwd: API_DIR, timeout: 60_000 })
}

/** A slug no earlier run has taken: lowercase, hyphenated, 3 to 100 characters. */
export function freshSlug(): string {
  return `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}
