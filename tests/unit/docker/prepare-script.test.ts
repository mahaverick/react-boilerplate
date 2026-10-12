// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * docker/05-prepare.sh, run by `sh` as the image's entrypoint runs it.
 * docker/check-image.sh runs the same script inside the image, under BusyBox,
 * against a longer list of refused values.
 */

const SCRIPT = path.resolve(import.meta.dirname, '../../../docker/05-prepare.sh')
/** Unique, so finding it anywhere in the output means the refused value was printed. */
const PROBE = 'PII_PROBE_VALUE'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'prepare-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Runs the script with `API_UPSTREAM` and only PATH besides, rendering under a temporary directory. */
function runScript(upstream: string) {
  return spawnSync('sh', [SCRIPT], {
    env: {
      PATH: process.env.PATH ?? '',
      NGINX_ENVSUBST_OUTPUT_DIR: path.join(dir, 'out'),
      API_UPSTREAM: upstream,
    },
    encoding: 'utf8',
  })
}

describe('docker/05-prepare.sh', () => {
  it('refuses a path and never prints the value', () => {
    const result = runScript(`http://api:4040/${PROBE}`)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '05-prepare.sh: API_UPSTREAM must be scheme://host[:port] with no path'
    )
    expect(result.stderr).not.toContain(PROBE)
    expect(result.stdout).not.toContain(PROBE)
  })

  it.each(['http://api:4040', 'https://api.example.com'])('accepts %s', (upstream) => {
    const result = runScript(upstream)
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(path.join(dir, 'out'))).toBe(true)
  })
})
