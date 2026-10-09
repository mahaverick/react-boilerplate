// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * docker/check-image.sh's release checks, run through its `--check-bundle`
 * entry point on fixture bundles, without Docker.
 */

const SCRIPT = path.resolve(import.meta.dirname, '../../../docker/check-image.sh')
const RELEASE = '0123abcd'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'check-image-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function checkBundle(bundle: string, release = RELEASE) {
  const file = path.join(dir, 'bundle.js')
  writeFileSync(file, bundle)
  return spawnSync('bash', [SCRIPT, '--check-bundle', file, release], { encoding: 'utf8' })
}

/** posthog-js's own read of the id, present in every bundle. */
const POSTHOG_JS_READ = 'r=function(){let e=globalThis._posthogReleaseId;return e}();'

describe('docker/check-image.sh --check-bundle', () => {
  it.each([
    ['backticks', `o,release:\`${RELEASE}\`,environment:x`],
    ['double quotes', `o,release:"${RELEASE}",environment:x`],
    ['single quotes', `o,release:'${RELEASE}',environment:x`],
  ])('passes a bundle with the release at its define site, in %s', (_label, define) => {
    const result = checkBundle(`${define}${POSTHOG_JS_READ}`)
    expect(result.stdout).toBe('')
    expect(result.status).toBe(0)
  })

  it('fails a bundle whose only copy of the release is an unrelated literal', () => {
    const result = checkBundle(
      `var e={env:"dev"};release:__APP_RELEASE__;${POSTHOG_JS_READ}`,
      'dev'
    )
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      'FAIL: the release "dev" is not in the bundle where the build defines it'
    )
  })

  it.each([
    ['minified', '_posthogReleaseId=e._posthogReleaseId||"r1";'],
    ['spaced', 'globalThis._posthogReleaseId = globalThis._posthogReleaseId || "r1";'],
    ['bracketed', 'e["_posthogReleaseId"]="r1";'],
  ])('fails a bundle with an injected release id, %s', (_label, inject) => {
    const result = checkBundle(`release:"${RELEASE}";${inject}`)
    expect(result.status).toBe(1)
    expect(result.stdout).toContain(
      'FAIL: a chunk carries an injected release id: inject must stay release-less'
    )
  })

  it('passes a comparison with the id, which assigns nothing', () => {
    const result = checkBundle(`release:"${RELEASE}";if(e._posthogReleaseId===t)x()`)
    expect(result.status).toBe(0)
  })
})
