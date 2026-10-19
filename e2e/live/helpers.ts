/**
 * @file Helpers for the `live` e2e project: accounts and tenants made through a
 * real express's API and Mailpit, signed in by emailed link through the API or
 * the UI, and a guarded restart of the express under test.
 */
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, type Page } from '@playwright/test'
import type { MembershipRole } from '@/constants/roles'
import {
  cwdFromLsofFields,
  formatPidFile,
  grantDirPlan,
  isPidHeld,
  parsePidFile,
  parsePsLine,
  respawnOptions,
  restartedPidFile,
  restartPlan,
  stopInside,
  stopListenersIn,
  stopTargets,
  supervisorsToStop,
  type ProcessInfo,
  type RecordedServer,
  type Supervisor,
} from '../../scripts/api-restart-guard.mjs'
import { mailedLink } from '../capture/mailpit'
import { settle } from '../timing'

const execFile = promisify(execFileCallback)

/** Where the express under test listens: `E2E_API_ORIGIN`, default :4040. */
export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4040'

/**
 * A unique e2e address per call. Express mails one address at most one
 * sign-in link a minute (`SIGN_IN_LINK_MAIL_COOLDOWN`) and ten a day
 * (`SIGN_IN_LINK_RECIPIENT_DAILY_LIMIT`), answering 202 either way, so a fixed
 * address would leave reruns waiting on links that never arrive. The per-IP
 * limiter (ten link requests per fifteen minutes) holds whatever the address;
 * `RATE_LIMIT_SCALE` on the API under test widens it.
 */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`
}

/** `fetch`, resolved to the status and the parsed JSON body, which is `null` when the body is not JSON. */
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown }
}

/** A session the API issued: its access token and the refresh cookie it set. */
interface LiveSession {
  accessToken: string
  refreshCookie: { name: string; value: string; path: string }
}

/**
 * The session `createUser` signed each address in with, kept for one browser:
 * `logIn` hands its refresh cookie to a page once, since the cookie rotates on
 * its first use and a second holder would be refused.
 */
const keptSessions = new Map<string, { session: LiveSession; used: boolean }>()

/**
 * Express's default `SIGN_IN_LINK_MAIL_COOLDOWN` (one minute), with a second
 * of margin: inside it, a second link request to the same address is
 * answered 202 and mails nothing.
 */
const MAIL_COOLDOWN_MS = 61_000

/** When these helpers last asked for a link to each address. */
const lastLinkRequest = new Map<string, number>()

/**
 * Waits out the mail cooldown for `email` when these helpers asked for a link
 * to it less than a minute ago, then records this request's time.
 * @returns The time to pass to `mailedLink` as `since`.
 */
async function linkRequestSlot(email: string): Promise<number> {
  const last = lastLinkRequest.get(email)
  const wait = last === undefined ? 0 : last + MAIL_COOLDOWN_MS - Date.now()
  if (wait > 0) await settle(wait, 'express mails one sign-in link per address per minute')
  const since = Date.now()
  lastLinkRequest.set(email, since)
  return since
}

/** What a 429 from `/auth/link/request` means here: express allows ten per fifteen minutes per IP. */
const RATE_LIMITED = 'sign-in link rate limit hit: set RATE_LIMIT_SCALE on the API under test'

/**
 * Asks the API to mail `email` a sign-in link, as the sign-in page does.
 * @returns The time to pass to `mailedLink` as `since`.
 * @throws On a 429, naming `RATE_LIMIT_SCALE`, and on any answer but 202.
 */
export async function requestSignInLink(email: string): Promise<number> {
  const since = await linkRequestSlot(email)
  const requested = await json(`${API_ORIGIN}/api/v1/auth/link/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, app: 'web' }),
  })
  if (requested.status === 429) throw new Error(RATE_LIMITED)
  if (requested.status !== 202) {
    throw new Error(`link request failed: ${requested.status} ${JSON.stringify(requested.body)}`)
  }
  return since
}

/**
 * The refresh cookie in a response's `Set-Cookie` headers, or `null`.
 * @param headers - The response headers.
 */
function refreshCookieFrom(headers: Headers): LiveSession['refreshCookie'] | null {
  for (const cookie of headers.getSetCookie()) {
    const [pair = '', ...attributes] = cookie.split(';').map((part) => part.trim())
    const split = pair.indexOf('=')
    const name = pair.slice(0, split)
    if (split < 1 || name !== 'refreshToken') continue
    const path = attributes.find((attribute) => /^path=/i.test(attribute))?.slice(5) ?? '/'
    return { name, value: pair.slice(split + 1), path }
  }
  return null
}

/**
 * Posts a mailed link's token, with the link's address, to the endpoint that
 * spends it, as the page that opens the link does.
 * @param endpoint - `/auth/link/verify` or `/invitations/confirm`, under /api/v1.
 * @param link - The mailed link.
 * @returns The session it signed in.
 */
async function spendLink(endpoint: string, link: URL): Promise<LiveSession> {
  const response = await fetch(`${API_ORIGIN}/api/v1${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: link.searchParams.get('token'),
      email: link.searchParams.get('email') ?? undefined,
    }),
  })
  const body = (await response.json().catch(() => null)) as {
    data?: { accessToken?: string }
  } | null
  const accessToken = body?.data?.accessToken
  const refreshCookie = refreshCookieFrom(response.headers)
  if (response.status !== 200 || !accessToken || !refreshCookie) {
    throw new Error(`${endpoint} failed: ${response.status} ${JSON.stringify(body)}`)
  }
  return { accessToken, refreshCookie }
}

/**
 * Signs `email` in through the API the way a person does: request a link,
 * read it from Mailpit, post its token. The click creates the account when
 * the address has none. The session is kept, unused, for `logIn` and
 * `apiLogin`. Mailpit is a required part of this stack: the link only exists
 * in the email.
 */
export async function createUser(email: string): Promise<LiveSession> {
  const since = await requestSignInLink(email)
  const session = await spendLink('/auth/link/verify', await mailedLink(email, '/auth/link', since))
  keptSessions.set(email, { session, used: false })
  return session
}

/**
 * Joins `email`'s existing account to an invitation the way the accept page
 * does when it is signed out: the verify answers 202 and mails a confirmation
 * link, which is then followed. The confirm signs the account in, and that
 * session replaces any kept one.
 * @param email - The invited address, which already has an account.
 * @param invitationToken - The token from the invitation email.
 * @returns The session the confirmation signed in.
 */
export async function joinByConfirmation(
  email: string,
  invitationToken: string
): Promise<LiveSession> {
  const since = Date.now()
  const verified = await json(`${API_ORIGIN}/api/v1/invitations/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: invitationToken }),
  })
  if (verified.status !== 202) {
    throw new Error(
      `invitation verify did not ask to confirm: ${verified.status} ${JSON.stringify(verified.body)}`
    )
  }
  const session = await spendLink(
    '/invitations/confirm',
    await mailedLink(email, '/invitations/confirm', since)
  )
  keptSessions.set(email, { session, used: false })
  return session
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

/** Polls until the API answers its readiness probe, failing after `timeoutMs`. */
export async function waitForApi(timeoutMs = 60_000): Promise<void> {
  await expect
    .poll(apiIsReady, {
      message: `API at ${API_ORIGIN} did not become ready within ${timeoutMs}ms`,
      intervals: [500],
      timeout: timeoutMs,
    })
    .toBe(true)
}

/**
 * Every pid listening on `port`. `-sTCP:LISTEN` is load-bearing: without it
 * lsof also lists clients with an open socket to the port, and the Vite dev
 * server proxying /api is one. Killing that takes the whole run down.
 */
async function listeningPids(port: string): Promise<number[]> {
  const { stdout } = await execFile('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN']).catch(() => ({
    stdout: '',
  }))
  return stdout.split('\n').filter(Boolean).map(Number)
}

/** Sends `signal` to each pid, ignoring one that has already exited. */
function signalAll(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {
      /* already gone */
    }
  }
}

/** Whether `port` has no listener within `timeoutMs`. */
async function portFreedWithin(port: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while ((await listeningPids(port)).length > 0) {
    if (Date.now() >= deadline) return false
    await settle(100, 'poll interval')
  }
  return true
}

/** Whether every pid, or `-pid` group, in `ids` has exited within `timeoutMs`. */
async function processesGoneWithin(ids: number[], timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (ids.some(isAlive)) {
    if (Date.now() >= deadline) return false
    await settle(100, 'poll interval')
  }
  return true
}

/** The file-system reads the guard needs: `realpathSync.native`, which returns a path's true case, so a case variant of the main checkout's path still matches it. */
const GUARD_FS = {
  mainCheckout: path.resolve('../express-boilerplate'),
  realpath: (target: string) => realpathSync.native(target),
  isFile: (target: string) => {
    try {
      return statSync(target).isFile()
    } catch {
      return false
    }
  },
}

/**
 * What `restartApi` may do here, or why it refuses: `restartPlan` from
 * `scripts/api-restart-guard.mjs`, applied to this process's environment and
 * file system.
 * @returns `{ refusal }`, or the checked port and resolved worktree.
 */
function apiRestartPlan(): { refusal: string } | { port: string; dir: string } {
  return restartPlan({
    origin: API_ORIGIN,
    allowRestart: process.env.E2E_ALLOW_API_RESTART,
    apiDir: process.env.E2E_API_DIR,
    ...GUARD_FS,
  })
}

/**
 * Why `restartApi` would refuse to run here, or `null` when it may.
 * @returns The refusal, naming what to change, or `null`.
 */
export function apiRestartRefusal(): string | null {
  const plan = apiRestartPlan()
  return 'refusal' in plan ? plan.refusal : null
}

/**
 * A process's working directory, read with lsof, or `null` when unreadable.
 * @param pid - The process.
 * @returns Its working directory, or `null`.
 */
async function cwdOf(pid: number): Promise<string | null> {
  const { stdout } = await execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).catch(
    () => ({ stdout: '' })
  )
  return cwdFromLsofFields(stdout)
}

/**
 * Runs `ps` in the C locale, so `lstart` is always five words (`Tue Oct 13
 * 09:05:01 2026`) and `parsePsLine` finds the command where it expects it.
 * @param args - The `ps` arguments.
 * @returns Its stdout, or '' when it fails.
 */
async function ps(args: string[]): Promise<string> {
  const { stdout } = await execFile('ps', args, { env: { ...process.env, LC_ALL: 'C' } }).catch(
    () => ({ stdout: '' })
  )
  return stdout
}

/**
 * A pid's parent pid, or `null` when the process is gone.
 * @param pid - The process.
 * @returns The parent pid, or `null`.
 */
async function parentOf(pid: number): Promise<number | null> {
  const stdout = await ps(['-o', 'ppid=', '-p', String(pid)])
  const parent = Number(stdout.trim())
  return stdout.trim() !== '' && Number.isInteger(parent) && parent > 0 ? parent : null
}

/**
 * A process as the guard identifies it: pid, group, terminal, start time,
 * command line and working directory.
 * @param pid - The process.
 * @returns The process, or `null` when it is gone or unreadable.
 */
async function infoOf(pid: number): Promise<ProcessInfo | null> {
  const stdout = await ps(['-o', 'pid=,pgid=,tty=,lstart=,command=', '-p', String(pid)])
  const line = parsePsLine(stdout.split('\n')[0] ?? '')
  if (line?.pid !== pid) return null
  return { ...line, cwd: await cwdOf(pid) }
}

/**
 * The processes now in process group `pgid`, read from every process's group
 * (`ps -g` means different things on macOS and Linux).
 * @param pgid - The group.
 * @returns Each member, its leader included while alive.
 */
async function groupMembers(pgid: number): Promise<ProcessInfo[]> {
  const pids = (await ps(['-axo', 'pid=,pgid=']))
    .split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([pid, group]) => group === pgid && pid !== undefined && pid > 1)
    .map(([pid]) => pid as number)
  const members = await Promise.all(pids.map(infoOf))
  return members.filter((member) => member !== null)
}

/**
 * Whether a pid, or a process group given as `-pid`, has a live process.
 * @param id - The pid, or the negated group id.
 * @returns `true` while it can be signalled.
 */
function isAlive(id: number): boolean {
  try {
    process.kill(id, 0)
    return true
  } catch (error) {
    // EPERM: alive, but another user's; never ours to stop, yet not gone either.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Whether a process holds `pid`: `isPidHeld` over `process.kill`, so a failed
 * `ps` read never counts as an absent holder.
 * @param pid - The pid.
 * @returns `true` unless the probe answers ESRCH.
 */
function pidHeld(pid: number): boolean {
  return isPidHeld(pid, (target, signal) => process.kill(target, signal))
}

/** The pid file's contents, or `null` when there is none. */
function readPidFile(file: string): string | null {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * Stops the listeners' supervisors and the server a pid file recorded, each
 * only while `stopTargets` and `stopInside` still identify it. Then it sweeps the
 * recorded group once more by pid: when SIGTERM ends the leader before its
 * `tsx watch`, the group signal can no longer reach the survivors.
 * @param supervisors - The `tsx watch` processes read before the listeners stopped.
 * @param recorded - The pid file's server, or `null`.
 * @param dir - The checked, resolved worktree.
 */
async function stopLeftovers(
  supervisors: Supervisor[],
  recorded: RecordedServer | null,
  dir: string
): Promise<void> {
  /**
   * Stops what `stopTargets` chooses from `pids` and the recorded group as it is now.
   * @param included - The supervisors to include.
   */
  const stopNow = async (included: Supervisor[]) => {
    const targets = stopTargets({
      supervisors: included,
      recorded,
      leader: recorded === null ? null : await infoOf(recorded.pid),
      held: recorded !== null && pidHeld(recorded.pid),
      members: recorded === null ? [] : await groupMembers(recorded.pid),
      dir,
    })
    await stopInside({
      targets,
      recorded,
      dir,
      infoOf,
      pidHeld,
      signal: (id, name) => {
        signalAll([id], name)
      },
      goneWithin: (ids, ms) => processesGoneWithin(ids, ms),
    })
  }
  await stopNow(supervisors)
  if (recorded !== null) await stopNow([])
}

/**
 * Stops whatever is listening on the API port, then starts a new one.
 *
 * Finds the server by port rather than by a pid this process spawned, because
 * the API is started outside the test run and the SSE test has to restart that
 * one; it stops only listeners running inside the checked worktree. Refuses, by
 * throwing, unless `apiRestartRefusal` allows it. It also stops what would be
 * left behind with nothing to do: each listener's `tsx watch` supervisor, and
 * the server an earlier restart recorded in the pid file, each only while the
 * guard still identifies it (`stopTargets` in `scripts/api-restart-guard.mjs`).
 * The replacement server starts in the resolved worktree with `APP_PORT` set
 * to the checked port, so it never falls back to its `.env` port (4040 by
 * default). It stays running, detached; its pid, which is also its process
 * group, and its start time replace the pid file
 * `restartedPidFile(os.tmpdir(), port)`. Returns the listener pids before the
 * stop and after the replacement is ready, so a caller can tell a real restart
 * from none.
 */
export async function restartApi(): Promise<{ stoppedPids: number[]; startedPids: number[] }> {
  const plan = apiRestartPlan()
  if ('refusal' in plan) throw new Error(plan.refusal)
  const { port, dir } = plan
  const pidFile = restartedPidFile(tmpdir(), port)
  const recorded = parsePidFile(readPidFile(pidFile))
  const stoppedPids = await listeningPids(port)
  // Read before the stop: once a listener exits, its parent pid is gone.
  const supervisors = await supervisorsToStop({ pids: stoppedPids, dir, parentOf, infoOf })

  // Stop every pid holding the port, not one process group: `pnpm dev` is `tsx watch`, whose child is the real server and would keep listening, so a "reconnects after a restart" test would measure a stream never interrupted.
  await stopListenersIn({
    port,
    dir,
    listeningPids,
    cwdOf,
    signal: (pid, name) => {
      signalAll([pid], name)
    },
    freedWithin: (ms) => portFreedWithin(port, ms),
  })
  await expect
    .poll(() => listeningPids(port), {
      message: `something still listens on :${port} after SIGKILL`,
      intervals: [100],
      timeout: 5000,
    })
    .toEqual([])

  // A `tsx watch` whose child was killed stays alive doing nothing, and a second run would otherwise orphan the first one's server.
  await stopLeftovers(supervisors, recorded, dir)
  rmSync(pidFile, { force: true })

  // Without this check, "reconnects after a restart" passes against a server that never stopped.
  await expect
    .poll(apiIsReady, {
      message: 'API did not stop; the restart test would be vacuous',
      intervals: [250],
      timeout: 15_000,
    })
    .toBe(false)

  const server = spawn('pnpm', ['dev'], respawnOptions(dir, port, process.env))
  if (server.pid !== undefined) {
    const started = await infoOf(server.pid)
    writeFileSync(pidFile, formatPidFile(server.pid, started?.lstart ?? null))
  }
  server.unref()
  await waitForApi()
  return { stoppedPids, startedPids: await listeningPids(port) }
}

/**
 * Signs in through the sign-in page and the mailed link, as a person does:
 * fill Email, ask for the link, wait for "Check your inbox", then open the
 * link. Lands wherever the link page sends the account, which is never
 * `/login` or `/auth/link`.
 *
 * The field is matched by its exact label, never `/email/i`: with the
 * TanStack Router devtools open the dev server also renders route-match
 * buttons labelled with route paths, so a loose pattern matches several
 * elements and Playwright's strict mode throws.
 */
async function signInThroughPage(page: Page, email: string): Promise<void> {
  const since = await linkRequestSlot(email)
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  const requested = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/v1/auth/link/request'
  )
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  if ((await requested).status() === 429) throw new Error(RATE_LIMITED)
  await expect(page.getByRole('heading', { name: 'Check your inbox', level: 1 })).toBeVisible()
  const link = await mailedLink(email, '/auth/link', since)
  await page.goto(`${link.pathname}${link.search}`)
  await expect(page).not.toHaveURL(/\/(login|auth\/link)(\?|$)/, { timeout: 15_000 })
}

/**
 * Signs `email` in on `page`, leaving the browser with a real session and
 * refresh cookie. While `createUser`'s session for the address is unused, its
 * refresh cookie goes into the page's context and the page opens the
 * dashboard, which restores the session; the session is then used. Otherwise
 * it signs in through the page and a newly mailed link, waiting out the
 * address's mail cooldown first.
 */
export async function logIn(page: Page, email: string): Promise<void> {
  const kept = keptSessions.get(email)
  if (!kept || kept.used) {
    await signInThroughPage(page, email)
    return
  }
  kept.used = true
  // The origin is the page's own, which may be the dev server or the production image.
  await page.goto('/login')
  const { hostname } = new URL(page.url())
  const { name, value, path } = kept.session.refreshCookie
  await page
    .context()
    .addCookies([{ name, value, domain: hostname, path, httpOnly: true, sameSite: 'Strict' }])
  await page.goto('/dashboard')
  await expect(page).not.toHaveURL(/\/(login|auth\/link)(\?|$)/, { timeout: 15_000 })
}

/** Signs a fresh address in through the page and its mailed link, which creates the account and lands on /welcome. */
export async function signIn(page: Page, email: string): Promise<void> {
  await signInThroughPage(page, email)
  await expect(page).toHaveURL(/\/welcome$/)
}

/**
 * An access token straight from the API, for requests made outside the
 * browser: the SPA's token lives in memory only. It is the kept session's,
 * or a new `createUser` sign-in's when the address has none.
 */
export async function apiLogin(email: string): Promise<string> {
  const kept = keptSessions.get(email)
  return (kept?.session ?? (await createUser(email))).accessToken
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
 * Gives a verified account a platform role by running express's own bootstrap
 * script in `E2E_API_DIR`, the supported way in, audited as
 * `platform.member.granted`. It must run before the account signs in: the role
 * arrives with the session. `E2E_API_DIR` has no default: it throws, through
 * `grantDirPlan`, when that is unset, missing, or not an express checkout. Any
 * checkout named explicitly will do, the main one included, since the grant
 * signals nothing; only `restartApi` requires a separate worktree.
 */
export async function grantPlatformRole(email: string, role: MembershipRole): Promise<void> {
  const checked = grantDirPlan({
    apiDir: process.env.E2E_API_DIR,
    realpath: GUARD_FS.realpath,
    readJson: (file) => {
      try {
        return JSON.parse(readFileSync(file, 'utf8')) as { scripts?: unknown }
      } catch {
        return null
      }
    },
  })
  if ('refusal' in checked) throw new Error(checked.refusal)
  await execFile('pnpm', ['platform:grant', email, role], { cwd: checked.dir, timeout: 60_000 })
}

/** A slug no earlier run has taken: lowercase, hyphenated, 3 to 100 characters. */
export function freshSlug(): string {
  return `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}
