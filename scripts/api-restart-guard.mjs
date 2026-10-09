/**
 * @file The rules for e2e's `restartApi`, as pure functions: it kills
 * whatever listens on the API port and starts `pnpm dev` in a checkout, so
 * it refuses a developer's own server and checkout.
 */

/** The port a developer's own express listens on, which a restart never touches. */
export const DEV_API_PORT = '4040'

/**
 * The port an origin names, with the scheme's default when it names none.
 * @param origin - The API origin, such as `http://localhost:4999`.
 * @returns The port, as a string.
 */
export function portOf(origin) {
  const url = new URL(origin)
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

/**
 * Why a restart would be refused, or `null` when it may run. Refused when the
 * port is 4040; without `E2E_ALLOW_API_RESTART=1`; without an `E2E_API_DIR`;
 * when that directory is the main express checkout; and when it is not a git
 * worktree (its `.git` is not a file), which also refuses a standalone clone.
 * @param input - The environment and the two file-system reads it needs.
 * @param input.origin - `E2E_API_ORIGIN`.
 * @param input.allowRestart - `E2E_ALLOW_API_RESTART`.
 * @param input.apiDir - `E2E_API_DIR`.
 * @param input.mainCheckout - The default sibling checkout's path.
 * @param input.realpath - Resolves a path's symlinks; throws when it does not exist.
 * @param input.isFile - Whether a path is a regular file.
 * @returns The refusal, naming what to change, or `null`.
 */
export function restartRefusal({ origin, allowRestart, apiDir, mainCheckout, realpath, isFile }) {
  const port = portOf(origin)
  if (port === DEV_API_PORT) {
    return `restartApi kills whatever listens on :${port}, the dev server's port: point E2E_API_ORIGIN at an express you started on another port`
  }
  if (allowRestart !== '1') {
    return `restartApi kills whatever listens on :${port} and starts pnpm dev in E2E_API_DIR: set E2E_ALLOW_API_RESTART=1 for an express you started`
  }
  if (!apiDir) {
    return 'restartApi starts pnpm dev in E2E_API_DIR: set it to the git worktree of the express you started'
  }
  let dir
  try {
    dir = realpath(apiDir)
  } catch {
    return `restartApi starts pnpm dev in E2E_API_DIR, and ${apiDir} does not exist`
  }
  if (dir === realpathOrNull(realpath, mainCheckout)) {
    return `restartApi never starts pnpm dev in the main express checkout (${dir}): set E2E_API_DIR to a git worktree`
  }
  if (!isFile(`${dir}/.git`)) {
    return `restartApi starts pnpm dev only in a git worktree, and ${dir} has no .git file: use git worktree add`
  }
  return null
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
 * How the restart spawns `pnpm dev`: in the guarded directory, detached, and
 * with `APP_PORT` set to the guarded port, so the new server binds the port
 * that was checked rather than its checkout's `.env` port (4040 by default).
 * @param apiDir - The checked `E2E_API_DIR`.
 * @param port - The checked port.
 * @param env - The environment to extend.
 * @returns The `spawn` options.
 */
export function respawnOptions(apiDir, port, env) {
  return { cwd: apiDir, detached: true, stdio: 'ignore', env: { ...env, APP_PORT: port } }
}
