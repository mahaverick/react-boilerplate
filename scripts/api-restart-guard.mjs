/**
 * @file The rules for e2e's `restartApi`: it stops the express listening on
 * the API port and starts `pnpm dev` again, so it refuses a developer's own
 * server, port and checkout, and stops only processes inside the worktree.
 */

/** The port a developer's own express listens on, which a restart never touches. */
const DEV_API_PORT = '4040'

/**
 * The explicit port of an http(s) origin, or `null` for any other origin: a
 * port-less origin would aim the restart at :80 or :443, not at an express this
 * run started.
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
 * @returns Resolves once the port is free after SIGTERM, or once SIGKILL has been sent.
 * @throws {Error} When a listener is outside `dir`, before any signal of that round.
 */
export async function stopListenersIn({ port, dir, listeningPids, cwdOf, signal, freedWithin }) {
  /**
   * Sends signal `name` to every listener on the port, after checking that all of them run inside `dir`.
   * @param name - The signal to send.
   * @throws {Error} Before signalling anyone, when a listener is outside `dir`.
   */
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
 * The pid a restart recorded in its pid file, or `null` when the text holds no
 * pid above 1: an empty, partly written or hand-edited file names nothing to stop.
 * @param text - The pid file's contents, or `null` when there is no file.
 * @returns The pid, or `null`.
 */
export function parseRecordedPid(text) {
  const trimmed = text?.trim() ?? ''
  if (!/^\d+$/.test(trimmed)) return null
  const pid = Number(trimmed)
  return pid > 1 ? pid : null
}

/**
 * The server an earlier restart left running, which this restart stops before
 * it records its own, so a second run never orphans the first one's server.
 * `null`, so the file is only replaced, when the file names no pid, the
 * process is gone, or the pid now belongs to a process outside `dir` or whose
 * working directory cannot be read.
 * @param input - The recorded text, the worktree and the process reads, injected.
 * @param input.recorded - The pid file's contents, or `null` when there is no file.
 * @param input.dir - The checked, resolved worktree.
 * @param input.isAlive - Whether a pid is running.
 * @param input.cwdOf - A pid's working directory, or `null` when unknown.
 * @returns The pid, which leads its process group, or `null`.
 */
export async function recordedServerToStop({ recorded, dir, isAlive, cwdOf }) {
  const pid = parseRecordedPid(recorded)
  if (pid === null || !isAlive(pid)) return null
  return isWithin(await cwdOf(pid), dir) ? pid : null
}

/**
 * Whether a command line is `tsx watch`, the supervisor `pnpm dev` runs: its
 * child holds the port, and it outlives that child doing nothing.
 * @param command - The full command line, as `ps -o command=` prints it.
 * @returns `true` for `tsx watch`, by binary or by its `tsx/dist/cli.mjs`.
 */
export function isTsxWatch(command) {
  return /(^|[\s/])tsx(\/dist\/cli\.mjs)?\s+watch(\s|$)/.test(command ?? '')
}

/**
 * The `tsx watch` supervisors of the listeners about to be stopped, read
 * before the stop: once a listener exits its parent pid is gone. A parent is
 * one only when it runs `tsx watch` inside `dir`, so a shell or any other
 * process that started a listener is never stopped. Init (pid 1) never is.
 * @param input - The listeners, the worktree and the process reads, injected.
 * @param input.pids - The listener pids.
 * @param input.dir - The checked, resolved worktree.
 * @param input.parentOf - A pid's parent pid, or `null` when unknown.
 * @param input.commandOf - A pid's command line, or `null` when unknown.
 * @param input.cwdOf - A pid's working directory, or `null` when unknown.
 * @returns The supervisor pids, each once.
 */
export async function supervisorsToStop({ pids, dir, parentOf, commandOf, cwdOf }) {
  const supervisors = []
  for (const pid of pids) {
    const parent = await parentOf(pid)
    if (parent === null || parent <= 1 || supervisors.includes(parent) || pids.includes(parent)) {
      continue
    }
    if (!isTsxWatch(await commandOf(parent))) continue
    if (isWithin(await cwdOf(parent), dir)) supervisors.push(parent)
  }
  return supervisors
}

/**
 * Stops processes, or whole process groups, that run inside `dir`: SIGTERM,
 * then SIGKILL for any still alive after 3 s. Before each signal it reads the
 * target's working directory again (a group's, through its leader) and skips
 * one that is gone, outside `dir` or unreadable, so a reused pid is never hit.
 * @param input - The targets, the worktree and the process operations, injected.
 * @param input.targets - Each `{ pid, group }`; `group` signals `-pid`, the whole group.
 * @param input.dir - The checked, resolved worktree.
 * @param input.isAlive - Whether a target (`pid`, or `-pid` for a group) is running.
 * @param input.cwdOf - A pid's working directory, or `null` when unknown.
 * @param input.signal - Sends a signal to a pid, or to a group as `-pid`.
 * @param input.goneWithin - Whether none of the given targets is alive within a time, in ms.
 * @returns Resolves once every target is gone after SIGTERM, or once SIGKILL has been sent.
 */
export async function stopInside({ targets, dir, isAlive, cwdOf, signal, goneWithin }) {
  /**
   * What a target is signalled as.
   * @param target - A `{ pid, group }` target.
   * @returns `-pid` for a group, otherwise the pid.
   */
  const idOf = (target) => (target.group ? -target.pid : target.pid)
  /**
   * Sends `name` to every target still alive and inside `dir`.
   * @param name - The signal to send.
   * @returns The ids signalled.
   */
  const signalInside = async (name) => {
    const signalled = []
    for (const target of targets) {
      if (!isAlive(idOf(target))) continue
      if (!isWithin(await cwdOf(target.pid), dir)) continue
      signal(idOf(target), name)
      signalled.push(idOf(target))
    }
    return signalled
  }
  const termed = await signalInside('SIGTERM')
  if (termed.length === 0 || (await goneWithin(termed, 3000))) return
  await signalInside('SIGKILL')
}
