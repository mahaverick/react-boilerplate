// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from '@/tests/support/runner'

/**
 * docker/15-app-links.sh, run by `sh` as the image's entrypoint runs it. The
 * files it writes are parsed as JSON, as the iOS and Android verifiers read
 * them. docker/check-image.sh runs the same script inside the image, under
 * BusyBox, and fetches the files through nginx.
 */

const SCRIPT = path.resolve(import.meta.dirname, '../../../docker/15-app-links.sh')
const IOS_ID = 'ABCDE12345.com.example.app'
const OTHER_IOS_ID = 'ZYXWV98765.com.example.beta'
const FINGERPRINT = Array.from({ length: 32 }, (_, i) =>
  (i * 7 + 16).toString(16).toUpperCase()
).join(':')
const OTHER_FINGERPRINT = Array.from({ length: 32 }, () => 'AB').join(':')
/** Unique, so finding it anywhere in the output means the refused value was printed. */
const PROBE = 'PII_PROBE_VALUE'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'app-links-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The path of a written file under the temporary `RUNTIME_CONFIG_DIR`. */
function written(name: string): string {
  return path.join(dir, 'runtime', 'well-known', name)
}

/** Runs the script with `env` and only PATH besides, writing under a temporary `RUNTIME_CONFIG_DIR`. */
function runScript(env: Record<string, string>) {
  return spawnSync('sh', [SCRIPT], {
    env: { PATH: process.env.PATH ?? '', RUNTIME_CONFIG_DIR: path.join(dir, 'runtime'), ...env },
    encoding: 'utf8',
  })
}

/** A written file, parsed. */
function readJson(name: string): unknown {
  return JSON.parse(readFileSync(written(name), 'utf8'))
}

describe('docker/15-app-links.sh', () => {
  it('writes both files for valid values', () => {
    const result = runScript({
      IOS_APP_IDS: `${IOS_ID},${OTHER_IOS_ID}`,
      ANDROID_APP_LINKS: `com.example.app:${FINGERPRINT}`,
    })
    expect(result.status, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    const ids = [IOS_ID, OTHER_IOS_ID]
    expect(readJson('apple-app-site-association')).toEqual({
      applinks: {
        details: [
          {
            appIDs: ids,
            components: [
              { '/': '/auth/link' },
              { '/': '/auth/confirm' },
              { '/': '/invitations/accept' },
              { '/': '/invitations/confirm' },
              { '/': '/settings/account/security' },
              { '/': '/tenants/*' },
            ],
          },
        ],
      },
      webcredentials: { apps: ids },
    })
    expect(readJson('assetlinks.json')).toEqual([
      {
        relation: [
          'delegate_permission/common.handle_all_urls',
          'delegate_permission/common.get_login_creds',
        ],
        target: {
          namespace: 'android_app',
          package_name: 'com.example.app',
          sha256_cert_fingerprints: [FINGERPRINT],
        },
      },
    ])
  })

  it('writes one assetlinks statement per entry, both relations each', () => {
    const result = runScript({
      ANDROID_APP_LINKS: `com.example.app:${FINGERPRINT},com.example.beta:${OTHER_FINGERPRINT}`,
    })
    expect(result.status, result.stderr).toBe(0)
    const statements = readJson('assetlinks.json') as {
      relation: string[]
      target: { package_name: string; sha256_cert_fingerprints: string[] }
    }[]
    expect(statements.map((s) => s.target.package_name)).toEqual([
      'com.example.app',
      'com.example.beta',
    ])
    expect(statements.map((s) => s.target.sha256_cert_fingerprints)).toEqual([
      [FINGERPRINT],
      [OTHER_FINGERPRINT],
    ])
    for (const statement of statements) {
      expect(statement.relation).toEqual([
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ])
    }
    expect(existsSync(written('apple-app-site-association'))).toBe(false)
  })

  it('exits 1 naming IOS_APP_IDS for a lowercase team id, and never prints the value', () => {
    const result = runScript({ IOS_APP_IDS: `abcde12345.com.example.app${PROBE}` })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('15-app-links.sh: IOS_APP_IDS must be')
    expect(result.stderr.trim().split('\n')).toHaveLength(1)
    expect(result.stderr).not.toContain(PROBE)
    expect(existsSync(written('apple-app-site-association'))).toBe(false)
  })

  it('exits 1 naming ANDROID_APP_LINKS for a short fingerprint', () => {
    const result = runScript({ ANDROID_APP_LINKS: 'com.example.app:AB:CD' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('15-app-links.sh: ANDROID_APP_LINKS must be')
    expect(existsSync(written('assetlinks.json'))).toBe(false)
  })

  it.each([
    ['a trailing comma', `${IOS_ID},`],
    ['a space', `${IOS_ID}, ${OTHER_IOS_ID}`],
    ['a newline', `${IOS_ID}\n${OTHER_IOS_ID}`],
    ['a quote', `${IOS_ID}"`],
  ])('refuses IOS_APP_IDS with %s', (_label, value) => {
    const result = runScript({ IOS_APP_IDS: value })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('15-app-links.sh: IOS_APP_IDS must be')
  })

  it('writes nothing when one variable is valid and the other is not', () => {
    const result = runScript({ IOS_APP_IDS: IOS_ID, ANDROID_APP_LINKS: 'nonsense' })
    expect(result.status).toBe(1)
    expect(existsSync(written('apple-app-site-association'))).toBe(false)
  })

  it('writes nothing and removes a stale file when a variable is unset or empty', () => {
    mkdirSync(path.dirname(written('assetlinks.json')), { recursive: true })
    writeFileSync(written('apple-app-site-association'), '{}')
    writeFileSync(written('assetlinks.json'), '[]')
    const result = runScript({ IOS_APP_IDS: '' })
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(written('apple-app-site-association'))).toBe(false)
    expect(existsSync(written('assetlinks.json'))).toBe(false)
  })

  it('succeeds with both unset, leaving no file', () => {
    const result = runScript({})
    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(written('apple-app-site-association'))).toBe(false)
    expect(existsSync(written('assetlinks.json'))).toBe(false)
  })
})
