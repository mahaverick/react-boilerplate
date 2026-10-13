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
  const checked = apiDirPlan({
    apiDir,
    mainCheckout,
    realpath,
    isFile,
    who: 'restartApi',
    does: 'starts pnpm dev',
  })
  return 'refusal' in checked ? checked : { port, dir: checked.dir }
}

/**
 * The express worktree a helper may run a command in, or why it refuses: without
 * an `E2E_API_DIR`; when that directory is missing, is the main express checkout
 * or holds it; and when it is not a git worktree (its `.git` is not a file),
 * which also refuses a standalone clone.
 * @param input - The directory, the main checkout and the two file-system reads.
 * @param input.apiDir - `E2E_API_DIR`.
 * @param input.mainCheckout - The default sibling checkout's path.
 * @param input.realpath - Resolves a path to its true, case-correct form; throws when it does not exist.
 * @param input.isFile - Whether a path is a regular file.
 * @param input.who - The helper's name, for the refusal.
 * @param input.does - What it would do in the directory, for the refusal.
 * @returns `{ refusal }` naming what to change, or the resolved `{ dir }`.
 */
export function apiDirPlan({ apiDir, mainCheckout, realpath, isFile, who, does }) {
  if (!apiDir) {
    return {
      refusal: `${who} ${does} in E2E_API_DIR: set it to the git worktree of the express under test`,
    }
  }
  const dir = realpathOrNull(realpath, apiDir)
  if (dir === null) {
    return { refusal: `${who} ${does} in E2E_API_DIR, and ${apiDir} does not exist` }
  }
  const main = realpathOrNull(realpath, mainCheckout)
  if (dir === main) {
    return {
      refusal: `${who} never ${does} in the main express checkout (${dir}): set E2E_API_DIR to a git worktree`,
    }
  }
  if (main !== null && isWithin(main, dir)) {
    return {
      refusal: `${who} never ${does} in ${dir}, which holds the main express checkout: set E2E_API_DIR to a git worktree`,
    }
  }
  if (!isFile(`${dir}/.git`)) {
    return {
      refusal: `${who} ${does} only in a git worktree, and ${dir} has no .git file: use git worktree add`,
    }
  }
  return { dir }
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
 * One process as `ps -o pid=,pgid=,tty=,lstart=,command=` prints it, its five
 * `lstart` words joined by single spaces: a single-digit day prints padded
 * (`Oct  3`), and a pid file's start time must compare equal to a later read.
 * @param line - One line of that output.
 * @returns `{ pid, pgid, tty, lstart, command }`, or `null` for a line that is not one.
 */
export function parsePsLine(line) {
  const words = (line ?? '').trim().split(/\s+/)
  if (words.length < 9) return null
  const [pid, pgid, tty, ...rest] = words
  if (!/^\d+$/.test(pid) || !/^\d+$/.test(pgid)) return null
  return {
    pid: Number(pid),
    pgid: Number(pgid),
    tty,
    lstart: rest.slice(0, 5).join(' '),
    command: rest.slice(5).join(' '),
  }
}

/**
 * The pid file's contents: the server's pid, then its start time, so a later
 * restart can tell that server from another process that reused its pid. The
 * first line alone is what `kill -TERM -"$(head -n 1 "$PID_FILE")"` reads.
 * @param pid - The started server's pid, which leads its process group.
 * @param lstart - Its start time, as `parsePsLine` gives it, or `null` when unknown.
 * @returns The text to write.
 */
export function formatPidFile(pid, lstart) {
  return lstart === null ? `${pid}\n` : `${pid}\n${lstart}\n`
}

/**
 * The server a pid file records, or `null` when the text names no pid above 1
 * with a start time: without one, nothing tells that server from a process that
 * reused its pid, so a restart only replaces the file.
 * @param text - The pid file's contents, or `null` when there is no file.
 * @returns `{ pid, lstart }`, or `null`.
 */
export function parsePidFile(text) {
  const [first = '', second = ''] = (text ?? '').split('\n')
  const lstart = second.trim().split(/\s+/).join(' ')
  if (!/^\d+$/.test(first.trim()) || lstart === '') return null
  const pid = Number(first.trim())
  return pid > 1 ? { pid, lstart } : null
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
 * Whether a command line is `pnpm dev`, as pnpm's node entry or its native binary.
 * @param command - The full command line.
 * @returns `true` for `pnpm dev` or `pnpm-native dev`.
 */
export function isPnpmDev(command) {
  return /(^|[\s/])pnpm(-native|\.c?js)?\s+dev(\s|$)/.test(command ?? '')
}

/**
 * Whether a command line is the server `tsx watch` runs: node with tsx's loader.
 * @param command - The full command line.
 * @returns `true` for a node process tsx started.
 */
export function isTsxServer(command) {
  return /\/tsx\/dist\/(preflight\.cjs|loader\.mjs)(\s|$)/.test(command ?? '')
}

/** Shells, which a restart never signals, whatever their working directory. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'tcsh', 'csh'])

/**
 * Whether a command line is a shell: a login shell (`-zsh`) or one run by name.
 * @param command - The full command line.
 * @returns `true` for a shell.
 */
export function isShell(command) {
  const first = (command ?? '').trim().split(/\s+/)[0] ?? ''
  if (first.startsWith('-')) return true
  return SHELLS.has(first.slice(first.lastIndexOf('/') + 1))
}

/**
 * Whether a `ps -o tty=` value means no controlling terminal: `??` on macOS,
 * `?` on Linux. A server spawned detached has none; a shell, and every job it
 * starts, has one.
 * @param tty - The tty column, or `null` when unknown.
 * @returns `true` only for a known absent terminal.
 */
export function hasNoTty(tty) {
  return tty === '??' || tty === '?'
}

/**
 * Whether a process may be signalled at all: known, inside `dir`, not a shell.
 * @param info - The process, from `parsePsLine` plus its `cwd`, or `null` when gone.
 * @param dir - The checked, resolved worktree.
 * @returns `true` when every base check holds.
 */
function isOurs(info, dir) {
  return info !== null && isWithin(info.cwd, dir) && !isShell(info.command)
}

/**
 * Whether a process is a `tsx watch` supervisor inside the worktree.
 * @param info - The process with its `cwd`, or `null` when gone.
 * @param dir - The checked, resolved worktree.
 * @returns `true` when it may be stopped as a supervisor.
 */
export function isSupervisor(info, dir) {
  return isOurs(info, dir) && isTsxWatch(info.command)
}

/**
 * Whether a process is the very server a pid file recorded: the same pid and
 * start time, `pnpm dev`, the leader of its own group, and with no terminal.
 * @param info - The process with its `cwd`, or `null` when gone.
 * @param recorded - The pid file's `{ pid, lstart }`.
 * @param dir - The checked, resolved worktree.
 * @returns `true` when its group may be stopped.
 */
export function isRecordedLeader(info, recorded, dir) {
  return (
    isOurs(info, dir) &&
    info.pid === recorded.pid &&
    info.lstart === recorded.lstart &&
    info.pgid === info.pid &&
    hasNoTty(info.tty) &&
    isPnpmDev(info.command)
  )
}

/**
 * Whether a process is a survivor of the recorded server's group once its
 * leader has exited: in that group, with no terminal, and one of the processes
 * `pnpm dev` starts (pnpm, `tsx watch`, or the server tsx runs).
 * @param info - The process with its `cwd`, or `null` when gone.
 * @param recorded - The pid file's `{ pid, lstart }`.
 * @param dir - The checked, resolved worktree.
 * @returns `true` when it may be stopped by pid.
 */
export function isRecordedMember(info, recorded, dir) {
  return (
    isOurs(info, dir) &&
    info.pid !== recorded.pid &&
    info.pgid === recorded.pid &&
    hasNoTty(info.tty) &&
    (isPnpmDev(info.command) || isTsxWatch(info.command) || isTsxServer(info.command))
  )
}

/**
 * The `tsx watch` supervisors of the listeners about to be stopped, read
 * before the stop: once a listener exits its parent pid is gone. Init (pid 1)
 * and another listener never are.
 * @param input - The listeners, the worktree and the process reads, injected.
 * @param input.pids - The listener pids.
 * @param input.dir - The checked, resolved worktree.
 * @param input.parentOf - A pid's parent pid, or `null` when unknown.
 * @param input.infoOf - A pid's process with its `cwd`, or `null` when gone.
 * @returns The supervisor pids, each once.
 */
export async function supervisorsToStop({ pids, dir, parentOf, infoOf }) {
  const supervisors = []
  for (const pid of pids) {
    const parent = await parentOf(pid)
    if (parent === null || parent <= 1 || supervisors.includes(parent) || pids.includes(parent)) {
      continue
    }
    if (isSupervisor(await infoOf(parent), dir)) supervisors.push(parent)
  }
  return supervisors
}

/**
 * What a restart stops besides the listeners: each supervisor by pid; the
 * recorded server's whole group (`-pid`) while its leader is still the
 * recorded server; and otherwise each member of that group that passes
 * `isRecordedMember`, by pid. A supervisor that is also a member appears once.
 * @param input - What was read, as processes with their `cwd`.
 * @param input.supervisors - The supervisor pids.
 * @param input.recorded - The pid file's `{ pid, lstart }`, or `null`.
 * @param input.leader - The process now at the recorded pid, or `null` when gone.
 * @param input.members - The processes now in the recorded pid's group.
 * @param input.dir - The checked, resolved worktree.
 * @returns Each `{ id, pid, kind }`: `id` is what is signalled, `pid` whose identity is re-checked.
 */
export function stopTargets({ supervisors, recorded, leader, members, dir }) {
  const targets = supervisors.map((pid) => ({ id: pid, pid, kind: 'supervisor' }))
  if (recorded === null) return targets
  if (isRecordedLeader(leader, recorded, dir)) {
    return [...targets, { id: -recorded.pid, pid: recorded.pid, kind: 'leader' }]
  }
  for (const member of members) {
    if (!isRecordedMember(member, recorded, dir)) continue
    if (targets.some((target) => target.pid === member.pid)) continue
    targets.push({ id: member.pid, pid: member.pid, kind: 'member' })
  }
  return targets
}

/**
 * Whether a target is still the process it was chosen as.
 * @param target - A `stopTargets` entry.
 * @param info - The process now at `target.pid`, with its `cwd`, or `null` when gone.
 * @param recorded - The pid file's `{ pid, lstart }`, or `null`.
 * @param dir - The checked, resolved worktree.
 * @returns `true` when it may be signalled now.
 */
export function isStillTarget(target, info, recorded, dir) {
  if (target.kind === 'supervisor') return isSupervisor(info, dir)
  if (recorded === null) return false
  return target.kind === 'leader'
    ? isRecordedLeader(info, recorded, dir)
    : isRecordedMember(info, recorded, dir)
}

/**
 * Stops `stopTargets`' targets: SIGTERM, then SIGKILL for any still alive
 * after 3 s. Immediately before each signal it reads the target again and skips
 * one that is gone or is no longer the process it was chosen as.
 * @param input - The targets, what they were chosen against and the process operations, injected.
 * @param input.targets - The `stopTargets` entries.
 * @param input.recorded - The pid file's `{ pid, lstart }`, or `null`.
 * @param input.dir - The checked, resolved worktree.
 * @param input.infoOf - A pid's process with its `cwd`, or `null` when gone.
 * @param input.signal - Sends a signal to a pid, or to a group as `-pid`.
 * @param input.goneWithin - Whether none of the given ids is alive within a time, in ms.
 * @returns Resolves once every target is gone after SIGTERM, or once SIGKILL has been sent.
 */
export async function stopInside({ targets, recorded, dir, infoOf, signal, goneWithin }) {
  /**
   * Sends `name` to every target that is still what it was chosen as.
   * @param name - The signal to send.
   * @returns The ids signalled.
   */
  const signalStill = async (name) => {
    const signalled = []
    for (const target of targets) {
      if (!isStillTarget(target, await infoOf(target.pid), recorded, dir)) continue
      signal(target.id, name)
      signalled.push(target.id)
    }
    return signalled
  }
  const termed = await signalStill('SIGTERM')
  if (termed.length === 0 || (await goneWithin(termed, 3000))) return
  await signalStill('SIGKILL')
}
