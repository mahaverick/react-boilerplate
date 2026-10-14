#!/usr/bin/env node
/**
 * @file `E2E_FLAGS_SET_CMD` for `e2e/live/flags.test.ts`:
 * `scripts/e2e-flags-set.mjs <flag-key> <value>` sets one flag in the fake
 * flags host (`e2e/helpers/fake-flags.mjs`, `pnpm e2e:fake-flags`) on
 * 127.0.0.1:`E2E_FAKE_FLAGS_PORT` (default 4064). It exits 0 once the fake
 * answers 2xx, 1 on any other answer or none, and 2 on missing arguments. The
 * test runs it with `execFile` and no shell, so the file is committed
 * executable and carries its own shebang.
 */
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Sets one flag in the fake flags host.
 * @param input - Where the fake listens and what to set.
 * @param input.origin - The fake's origin, such as `http://127.0.0.1:4064`.
 * @param input.key - The flag key.
 * @param input.value - `on`/`off` for `example_beta_page`, `control`/`bold` for `example_cta_experiment`.
 * @param input.fetchImpl - `fetch`, injected so a test can answer without a socket.
 * @returns Resolves once the fake answered 2xx.
 * @throws {Error} Naming the status and the fake's answer, for any other answer.
 */
export async function setFakeFlag({ origin, key, value, fetchImpl = fetch }) {
  const response = await fetchImpl(`${origin}/__flags`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, value }),
  })
  if (response.ok) return
  const text = await response.text()
  throw new Error(`fake flags host answered ${response.status} to ${key}=${value}: ${text}`)
}

/**
 * Whether this file is the process's entry script. Compared by real path: a
 * check that missed a symlinked path would exit 0 having set nothing. An entry
 * path that does not resolve is not this file.
 * @returns True when run as the script.
 */
function isMain() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

/**
 * Sets the flag named on the command line, and sets the exit code.
 * @returns Resolves once the exit code is set.
 */
async function main() {
  const [key, value] = process.argv.slice(2)
  if (key === undefined || value === undefined) {
    console.error('usage: scripts/e2e-flags-set.mjs <flag-key> <value>')
    process.exitCode = 2
    return
  }
  const origin = `http://127.0.0.1:${process.env.E2E_FAKE_FLAGS_PORT ?? 4064}`
  try {
    await setFakeFlag({ origin, key, value })
    console.log(`${key}=${value}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

if (isMain()) await main()
