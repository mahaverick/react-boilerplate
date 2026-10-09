// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * docker/upload-sourcemaps.sh, run by `sh` as the image's build stage runs
 * it, against a stand-in posthog-cli that records each run's arguments and
 * environment, prints `CLI_OUTPUT` when set, and exits with the code its
 * test chose. It runs in a temporary directory whose `dist` holds one source
 * map, as the build stage's does after inject.
 */

const SCRIPT = path.resolve(import.meta.dirname, '../../../docker/upload-sourcemaps.sh')
const TOKEN = 'phx_test_key_not_real'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'upload-sourcemaps-'))
  writeFileSync(
    path.join(dir, 'posthog-cli'),
    [
      '#!/bin/sh',
      'printf "%s|%s|%s|%s\\n" "$*" "$POSTHOG_CLI_ENV_ID" "$POSTHOG_CLI_TOKEN" "$POSTHOG_CLI_HOST" >> "$CLI_LOG"',
      '[ -n "$CLI_OUTPUT" ] && printf "%s\\n" "$CLI_OUTPUT"',
      'case ",$FAIL_PROJECTS," in *",$POSTHOG_CLI_ENV_ID,"*) exit 1 ;; esac',
      'exit 0',
      '',
    ].join('\n')
  )
  chmodSync(path.join(dir, 'posthog-cli'), 0o755)
  mkdirSync(path.join(dir, 'dist', 'assets'), { recursive: true })
  writeFileSync(path.join(dir, 'dist', 'assets', 'index-abc.js.map'), '{}')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function runScript(env: Record<string, string>, token: string | null = TOKEN) {
  const tokenFile = path.join(dir, 'token')
  if (token !== null) writeFileSync(tokenFile, token)
  return spawnSync('sh', [SCRIPT], {
    cwd: dir,
    env: {
      PATH: process.env.PATH ?? '',
      POSTHOG_CLI: path.join(dir, 'posthog-cli'),
      POSTHOG_CLI_TOKEN_FILE: tokenFile,
      CLI_LOG: path.join(dir, 'cli.log'),
      ...env,
    },
    encoding: 'utf8',
  })
}

/** Each posthog-cli run: its arguments, project, token and host. */
function cliRuns(): string[][] {
  try {
    return readFileSync(path.join(dir, 'cli.log'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('|'))
  } catch {
    return []
  }
}

describe('docker/upload-sourcemaps.sh', () => {
  it('skips the upload, successfully, when no project is configured', () => {
    const result = runScript({}, null)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('sourcemaps: not configured, skipping upload\n')
    expect(cliRuns()).toEqual([])
  })

  it('uploads to each project in turn, with the token and host, and no release flags', () => {
    const result = runScript(
      { POSTHOG_SOURCEMAP_PROJECTS: '101, 202', POSTHOG_CLI_HOST: 'https://eu.posthog.com' },
      `${TOKEN}\n`
    )
    expect(result.status).toBe(0)
    expect(cliRuns()).toEqual([
      ['sourcemap upload --directory dist', '101', TOKEN, 'https://eu.posthog.com'],
      ['sourcemap upload --directory dist', '202', TOKEN, 'https://eu.posthog.com'],
    ])
    expect(result.stdout).toBe(
      'sourcemaps: uploaded to project 101\nsourcemaps: uploaded to project 202\n'
    )
    expect(`${result.stdout}${result.stderr}`).not.toContain(TOKEN)
  })

  it.each([',', ' , ,', ',\n'])('treats %j as no projects configured', (projects) => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: projects }, null)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('sourcemaps: not configured, skipping upload\n')
    expect(cliRuns()).toEqual([])
  })

  it('ignores an empty entry between projects', () => {
    runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101,,202' })
    expect(cliRuns().map((run) => run[1])).toEqual(['101', '202'])
  })

  it.each(['http://us.posthog.com', 'us.posthog.com'])('refuses the host %s', (host) => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101', POSTHOG_CLI_HOST: host })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('POSTHOG_CLI_HOST must start with https://')
    expect(cliRuns()).toEqual([])
  })

  it('defaults the host to PostHog US', () => {
    runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101' })
    expect(cliRuns()[0]?.[3]).toBe('https://us.posthog.com')
  })

  it.each([
    ['missing', null],
    ['empty', ''],
  ])('fails when projects are set and the token secret is %s', (_label, token) => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101' }, token)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('the posthog_cli_token secret is missing or empty')
    expect(cliRuns()).toEqual([])
  })

  it('fails on the first failed upload and uploads nothing after it', () => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101,202,303', FAIL_PROJECTS: '202' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('sourcemaps: upload to project 202 failed')
    expect(cliRuns().map((run) => run[1])).toEqual(['101', '202'])
  })

  it('prints the CLI output and passes when no chunk was skipped as too large', () => {
    const summary = 'Uploaded 3 chunks, skipped 1 already present, skipped 0 too large'
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101', CLI_OUTPUT: summary })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${summary}\nsourcemaps: uploaded to project 101\n`)
  })

  it.each([
    'Uploaded 3 chunks, skipped 0 already present, skipped 2 too large',
    'chunk assets/index-abc.js is too large (6 MB), skipping it',
    'Skipping assets/index-abc.js: too large',
    'WARN chunk assets/index-D9fA2.js is too large, skipping',
  ])('fails the build when the CLI says it skipped a chunk as too large: %s', (output) => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101,202', CLI_OUTPUT: output })
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('sourcemaps: uploaded to project 101')
    expect(result.stderr).toContain('posthog-cli skipped chunks as too large for project 101')
    expect(cliRuns().map((run) => run[1])).toEqual(['101'])
  })

  it('fails the build, before uploading anything, when there is no source map to upload', () => {
    rmSync(path.join(dir, 'dist', 'assets', 'index-abc.js.map'))
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('sourcemaps: no source maps under dist to upload')
    expect(cliRuns()).toEqual([])
  })

  it.each([
    'Uploaded 0 chunks',
    'No source maps found in dist',
    'Uploaded 0 chunks, skipped 0 already present',
    'Uploaded 0 chunks, 0 already uploaded',
    'Uploaded 0 chunks, already uploaded 0',
    'Uploaded 0 of 12 chunks (none already present)',
    'Found 74 existing source map files\nUploaded 0 chunks',
    'Uploaded 00 chunks',
  ])('fails the build when the CLI uploaded nothing: %s', (output) => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101,202', CLI_OUTPUT: output })
    expect(result.status).toBe(1)
    expect(result.stdout).not.toContain('sourcemaps: uploaded to project 101')
    expect(result.stderr).toContain('posthog-cli uploaded no source maps to project 101')
    expect(cliRuns().map((run) => run[1])).toEqual(['101'])
  })

  it.each([
    'Uploaded 0 chunks, 12 already uploaded',
    'Uploaded 0 chunks, skipped 3 already present',
    'No source maps found to upload: 7 already exist',
    'uploaded 0, skipped 5 existing',
  ])('passes a re-run that finds every source map already uploaded: %s', (output) => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101,202', CLI_OUTPUT: output })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('sourcemaps: uploaded to project 202')
    expect(cliRuns().map((run) => run[1])).toEqual(['101', '202'])
  })

  it('refuses a project id that is not digits, before uploading anything', () => {
    const result = runScript({ POSTHOG_SOURCEMAP_PROJECTS: '101,abc' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('a project id is digits only, got: abc')
    expect(cliRuns()).toEqual([])
  })
})
