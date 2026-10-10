/**
 * @file The rules for e2e's `restartApi`: it stops the express listening on
 * the API port and starts `pnpm dev` again, so it refuses a developer's own
 * server, port and checkout, and stops only processes inside the worktree.
 */

/** The port a developer's own express listens on, which a restart never touches. */
const DEV_API_PORT = '4040'

/**
 * The explicit port of an http(s) origin, or `null` for any other origin: a
 * port-less origin would aim the restart at :80 or :443, which some other
 * program holds.
 * @param origin - The API origin, such as `http://localhost:4999`.
 * @returns The port, as a string, or `null`.
 */
export function explicitPortOf(origin) {
  let url
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.port === '' ? null : url.port
}

/**
 * What a restart may do, or why it is refused. Refused for an origin that is
 * not http(s) with an explicit port; for port 4040; without
 * `E2E_ALLOW_API_RESTART=1`; without an `E2E_API_DIR`; when that directory is
 * missing or is the main express checkout; and when it is not a git worktree
 * (its `.git` is not a file), which also refuses a standalone clone.
 * @param input - The environment and the two file-system reads it needs.
 * @param input.origin - `E2E_API_ORIGIN`.
 * @param input.allowRestart - `E2E_ALLOW_API_RESTART`.
 * @param input.apiDir - `E2E_API_DIR`.
 * @param input.mainCheckout - The default sibling checkout's path.
 * @param input.realpath - Resolves a path's symlinks; throws when it does not exist.
 * @param input.isFile - Whether a path is a regular file.
 * @returns `{ refusal }` naming what to change, or the checked `{ port, dir }`, `dir` resolved.
 */
export function restartPlan({ origin, allowRestart, apiDir, mainCheckout, realpath, isFile }) {
  const port = explicitPortOf(origin)
  if (port === null) {
    return {
      refusal: `restartApi needs E2E_API_ORIGIN as http(s) with an explicit port, got ${origin}`,
    }
  }
  if (port === DEV_API_PORT) {
    return {
      refusal: `restartApi kills whatever listens on :${port}, the dev server's port: point E2E_API_ORIGIN at an express you started on another port`,
    }
  }
  if (allowRestart !== '1') {
    return {
      refusal: `restartApi kills whatever listens on :${port} and starts pnpm dev in E2E_API_DIR: set E2E_ALLOW_API_RESTART=1 for an express you started`,
    }
  }
  if (!apiDir) {
    return {
      refusal:
        'restartApi starts pnpm dev in E2E_API_DIR: set it to the git worktree of the express you started',
    }
  }
  const dir = realpathOrNull(realpath, apiDir)
  if (dir === null) {
    return { refusal: `restartApi starts pnpm dev in E2E_API_DIR, and ${apiDir} does not exist` }
  }
  if (dir === realpathOrNull(realpath, mainCheckout)) {
    return {
      refusal: `restartApi never starts pnpm dev in the main express checkout (${dir}): set E2E_API_DIR to a git worktree`,
    }
  }
  if (!isFile(`${dir}/.git`)) {
    return {
      refusal: `restartApi starts pnpm dev only in a git worktree, and ${dir} has no .git file: use git worktree add`,
    }
  }
  return { port, dir }
}

/**
 * A path with its symlinks resolved, or `null` when it does not exist.
 * @param realpath - Resolves a path's symlinks; throws when it does not exist.
 * @param target - The path.
 * @returns The resolved path, or `null`.
 */
function realpathOrNull(realpath, target) {
  try {
    return realpath(target)
  } catch {
    return null
  }
}

/**
 * The working directory in `lsof -a -p <pid> -d cwd -Fn` output.
 * @param output - lsof's field output.
 * @returns The path after the `n` field, or `null` when there is none.
 */
export function cwdFromLsofFields(output) {
  const line = output.split('\n').find((field) => field.startsWith('n'))
  return line === undefined ? null : line.slice(1)
}

/**
 * Whether `cwd` is `dir` or inside it.
 * @param cwd - A process's working directory, or `null` when unknown.
 * @param dir - The resolved worktree.
 * @returns `true` only for a known directory at or under `dir`.
 */
export function isWithin(cwd, dir) {
  return cwd !== null && (cwd === dir || cwd.startsWith(`${dir}/`))
}

/**
 * Stops the listeners on `port`, all of which must run in `dir`: SIGTERM,
 * then SIGKILL for any still listening after 3 s. Before each signal it
 * checks every listener's working directory and refuses, signalling nothing,
 * when one is outside `dir` or cannot be read.
 * @param input - The port, the worktree and the process operations, injected.
 * @param input.port - The checked port.
 * @param input.dir - The checked, resolved worktree.
 * @param input.listeningPids - Every pid listening on a port.
 * @param input.cwdOf - A pid's working directory, or `null` when unknown.
 * @param input.signal - Sends a signal to a pid.
 * @param input.freedWithin - Whether the port has no listener within a time, in ms.
 * @returns Resolves once SIGKILL has been sent, if it was needed.
 * @throws {Error} When a listener is outside `dir`, before any signal of that round.
 */
export async function stopListenersIn({ port, dir, listeningPids, cwdOf, signal, freedWithin }) {
  const signalAllInside = async (name) => {
    const pids = await listeningPids(port)
    const outside = []
    for (const pid of pids) {
      const cwd = await cwdOf(pid)
      if (!isWithin(cwd, dir)) outside.push(`${pid} (${cwd ?? 'cwd unknown'})`)
    }
    if (outside.length > 0) {
      throw new Error(
        `restartApi will not stop :${port}: ${outside.join(', ')} ${outside.length === 1 ? 'runs' : 'run'} outside ${dir}`
      )
    }
    for (const pid of pids) signal(pid, name)
  }
  await signalAllInside('SIGTERM')
  if (await freedWithin(3000)) return
  await signalAllInside('SIGKILL')
}

/**
 * How the restart spawns `pnpm dev`: in the resolved worktree, detached, and
 * with `APP_PORT` set to the guarded port, so the new server binds the port
 * that was checked rather than its checkout's `.env` port (4040 by default).
 * @param dir - The checked, resolved worktree.
 * @param port - The checked port.
 * @param env - The environment to extend.
 * @returns The `spawn` options.
 */
export function respawnOptions(dir, port, env) {
  return { cwd: dir, detached: true, stdio: 'ignore', env: { ...env, APP_PORT: port } }
}

/**
 * Where a restart records the process group of the server it started, which
 * the restart leaves running, detached: `kill -TERM -<pid>` stops it.
 * @param tmpdir - The system temporary directory.
 * @param port - The checked port.
 * @returns The pid file's path.
 */
export function restartedPidFile(tmpdir, port) {
  return `${tmpdir}/react-e2e-restarted-api-${port}.pid`
}

/**
 * Deletes the pid file an earlier restart on this origin's port left, so a
 * run that fails before it starts a server leaves no stale pid to kill.
 * @param origin - `E2E_API_ORIGIN`.
 * @param tmpdir - The system temporary directory.
 * @param remove - Deletes a file, doing nothing when it is missing.
 */
export function forgetRestartedServer(origin, tmpdir, remove) {
  const port = explicitPortOf(origin)
  if (port !== null) remove(restartedPidFile(tmpdir, port))
}
