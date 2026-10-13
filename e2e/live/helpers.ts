/**
 * @file Helpers for the `live` e2e project: accounts and tenants made through a
 * real express's API and Mailpit, a sign-in through the UI, and a guarded
 * restart of the express under test.
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
} from '../../scripts/api-restart-guard.mjs'
import { settle } from '../timing'

const execFile = promisify(execFileCallback)

/** Where the express under test listens: `E2E_API_ORIGIN`, default :4040. */
export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? 'http://localhost:4040'
const MAILPIT_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? 'http://localhost:8025'
const API_DIR = process.env.E2E_API_DIR ?? '../express-boilerplate'

/** The password every e2e account uses. Long enough for the register schema. */
export const PASSWORD = 'a very long passphrase for e2e'

/**
 * A unique e2e address per call, because the login limiter is keyed `ip:email`
 * (`rate-limit.constants.ts:loginRateLimitKey`) at five attempts per fifteen
 * minutes. A fixed address would rate-limit reruns for the rest of the window,
 * which reads as a broken test rather than a spent bucket.
 */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@example.com`
}

/** `fetch`, resolved to the status and the parsed JSON body, which is `null` when the body is not JSON. */
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown }
}

/**
 * Registers an account through the API and verifies it, so the browser can sign in.
 *
 * Verification is required: `/auth/register` answers 202 with "If that address
 * can be registered…" and login stays 401 until the address is verified. The
 * link only exists in the email, so Mailpit is a required part of this stack.
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

  // Both fields: express answers a body that fails `verifyEmailSchema` with the same "Invalid or expired verification token" a bad token gets, so omitting the password looks like a dead token.
  const verified = await json(`${API_ORIGIN}/api/v1/auth/verify-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, password: PASSWORD }),
  })
  if (verified.status !== 200) {
    throw new Error(`verify failed: ${verified.status} ${JSON.stringify(verified.body)}`)
  }
}

/** The token in the newest verification email to `email`, or '' while none has arrived. */
async function verificationTokenInMailpit(email: string): Promise<string> {
  const search = await fetch(
    `${MAILPIT_ORIGIN}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`
  )
  const found = (await search.json()) as { messages?: { ID: string }[] }
  const id = found.messages?.[0]?.ID
  if (!id) return ''
  const message = await fetch(`${MAILPIT_ORIGIN}/api/v1/message/${id}`)
  const body = (await message.json()) as { Text?: string; HTML?: string }
  return /[?&]token=([a-f0-9]+)/i.exec(`${body.Text ?? ''}${body.HTML ?? ''}`)?.[1] ?? ''
}

/**
 * Polls Mailpit for the verification link and returns its token. A Mailpit that
 * is down fails at once: `expect.poll` does not retry a callback that throws.
 */
async function verificationTokenFor(email: string): Promise<string> {
  let token = ''
  await expect
    .poll(
      async () => {
        token = await verificationTokenInMailpit(email)
        return token
      },
      {
        message: `no verification email arrived for ${email} — is mailpit up on ${MAILPIT_ORIGIN}?`,
        intervals: [500],
        timeout: 15_000,
      }
    )
    .not.toBe('')
  return token
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
 * A pid's parent pid, or `null` when the process is gone.
 * @param pid - The process.
 * @returns The parent pid, or `null`.
 */
async function parentOf(pid: number): Promise<number | null> {
  const { stdout } = await execFile('ps', ['-o', 'ppid=', '-p', String(pid)]).catch(() => ({
    stdout: '',
  }))
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
  const { stdout } = await execFile('ps', [
    '-o',
    'pid=,pgid=,tty=,lstart=,command=',
    '-p',
    String(pid),
  ]).catch(() => ({ stdout: '' }))
  const ps = parsePsLine(stdout.split('\n')[0] ?? '')
  if (ps?.pid !== pid) return null
  return { ...ps, cwd: await cwdOf(pid) }
}

/**
 * The processes now in process group `pgid`, read from every process's group
 * (`ps -g` means different things on macOS and Linux).
 * @param pgid - The group.
 * @returns Each member, its leader included while alive.
 */
async function groupMembers(pgid: number): Promise<ProcessInfo[]> {
  const { stdout } = await execFile('ps', ['-axo', 'pid=,pgid=']).catch(() => ({ stdout: '' }))
  const pids = stdout
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
 * @param supervisors - The `tsx watch` pids read before the listeners stopped.
 * @param recorded - The pid file's server, or `null`.
 * @param dir - The checked, resolved worktree.
 */
async function stopLeftovers(
  supervisors: number[],
  recorded: RecordedServer | null,
  dir: string
): Promise<void> {
  /**
   * Stops what `stopTargets` chooses from `pids` and the recorded group as it is now.
   * @param pids - The supervisor pids to include.
   */
  const stopNow = async (pids: number[]) => {
    const targets = stopTargets({
      supervisors: pids,
      recorded,
      leader: recorded === null ? null : await infoOf(recorded.pid),
      members: recorded === null ? [] : await groupMembers(recorded.pid),
      dir,
    })
    await stopInside({
      targets,
      recorded,
      dir,
      infoOf,
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
 * Signs an existing, verified account in through the UI, leaving the browser
 * with a real session and refresh cookie.
 *
 * The fields are matched by their exact label, never `/email/i`: with the
 * TanStack Router devtools open the dev server also renders route-match
 * buttons labelled "Open match details for /verify-email" (and likewise for
 * forgot-password and reset-password against `/password/i`), so a loose pattern
 * matches several elements and Playwright's strict mode throws.
 */
export async function logIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: /sign in|log in/i }).click()
  await expect(page).not.toHaveURL(/login/, { timeout: 15_000 })
}

/** Registers and verifies an account through the API, then signs it in through the UI. */
export async function signIn(page: Page, email: string): Promise<void> {
  await createVerifiedUser(email)
  await logIn(page, email)
}

/** An access token straight from the API, for requests made outside the browser: the SPA's token lives in memory only. */
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
 * Gives a verified account a platform role by running express's own bootstrap
 * script in `E2E_API_DIR`, the supported way in, audited as
 * `platform.member.granted`. It must run before the account signs in: the role
 * arrives with the session.
 */
export async function grantPlatformRole(email: string, role: MembershipRole): Promise<void> {
  await execFile('pnpm', ['platform:grant', email, role], { cwd: API_DIR, timeout: 60_000 })
}

/** A slug no earlier run has taken: lowercase, hyphenated, 3 to 100 characters. */
export function freshSlug(): string {
  return `e2e-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`
}
