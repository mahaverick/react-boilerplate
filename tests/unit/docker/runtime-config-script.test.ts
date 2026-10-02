// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseRuntimeConfig, RUNTIME_CONFIG_KEYS } from '@/configs/runtime-config'

/**
 * docker/10-runtime-config.sh, run by `sh` as the image's entrypoint runs it.
 * Its output is evaluated as the browser would and handed to the bundle's own
 * parser, so the script and src/configs/runtime-config.ts are checked
 * against each other. docker/check-image.sh runs the same script inside the
 * image, under BusyBox.
 */

const SCRIPT = path.resolve(import.meta.dirname, '../../../docker/10-runtime-config.sh')
const KEY = 'phc_test_key_not_real'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'runtime-config-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function runScript(env: Record<string, string>) {
  return spawnSync('sh', [SCRIPT], {
    env: { PATH: process.env.PATH ?? '', RUNTIME_CONFIG_DIR: path.join(dir, 'runtime'), ...env },
    encoding: 'utf8',
  })
}

/** What `window.__APP_CONFIG__` is after the browser runs the written file. */
function evaluate(): Record<string, unknown> {
  const window: { __APP_CONFIG__?: Record<string, unknown> } = {}
  runInNewContext(readFileSync(path.join(dir, 'runtime', 'runtime-config.js'), 'utf8'), { window })
  return window.__APP_CONFIG__ ?? {}
}

describe('docker/10-runtime-config.sh', () => {
  it('writes every setting, frozen, for the bundle to read', () => {
    const result = runScript({
      POSTHOG_KEY: KEY,
      POSTHOG_UI_HOST: 'https://eu.posthog.com',
      ANALYTICS_CONSENT_MODE: 'required',
      ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com,https://blog.example.com:8443',
      APP_ENVIRONMENT: 'staging',
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    const written = evaluate()
    expect(Object.isFrozen(written)).toBe(true)
    expect(written).toEqual({
      POSTHOG_KEY: KEY,
      POSTHOG_UI_HOST: 'https://eu.posthog.com',
      ANALYTICS_CONSENT_MODE: 'required',
      ANALYTICS_HANDOFF_ORIGINS: 'https://www.example.com,https://blog.example.com:8443',
      APP_ENVIRONMENT: 'staging',
    })
    expect(parseRuntimeConfig(written)).toEqual({
      config: {
        posthogKey: KEY,
        posthogUiHost: 'https://eu.posthog.com',
        analyticsConsentMode: 'required',
        analyticsHandoffOrigins: ['https://www.example.com', 'https://blog.example.com:8443'],
        appEnvironment: 'staging',
      },
      invalid: [],
    })
  })

  it('writes empty strings when nothing is set, which the bundle reads as inert', () => {
    const result = runScript({})
    expect(result.status).toBe(0)
    const written = evaluate()
    expect(Object.keys(written)).toEqual([...RUNTIME_CONFIG_KEYS])
    expect(Object.values(written).every((value) => value === '')).toBe(true)
    expect(parseRuntimeConfig(written).config.posthogKey).toBeUndefined()
  })

  it.each([
    ['POSTHOG_KEY', 'pii-probe@example.test'],
    ['POSTHOG_KEY', `${KEY}";alert(1);"`],
    ['POSTHOG_KEY', `${KEY}\nphc_test_key_not_real_second_line`],
    ['POSTHOG_UI_HOST', 'https://probe.example.test/path'],
    ['POSTHOG_UI_HOST', 'http://probe.example.test'],
    ['ANALYTICS_CONSENT_MODE', 'probe-mode'],
    ['ANALYTICS_HANDOFF_ORIGINS', 'https://probe.example.test, https://b.example.test'],
    ['ANALYTICS_HANDOFF_ORIGINS', 'https://probe.example.test/</script>'],
    ['APP_ENVIRONMENT', 'Probe-Env'],
  ])('refuses %s, naming it and never its value', (name, value) => {
    const result = runScript({ [name]: value })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`10-runtime-config.sh: ${name} must be`)
    for (const line of value.split('\n')) expect(result.stderr).not.toContain(line)
    expect(() => readFileSync(path.join(dir, 'runtime', 'runtime-config.js'))).toThrow()
  })
})
