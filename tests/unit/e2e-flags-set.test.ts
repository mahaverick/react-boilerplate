// @vitest-environment node
import { execFile as execFileCallback } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'
import { startFakeFlags, type RunningFakeFlags } from '../../e2e/helpers/fake-flags.mjs'
import { setFakeFlag } from '../../scripts/e2e-flags-set.mjs'

/**
 * scripts/e2e-flags-set.mjs, run as e2e/live/flags.test.ts runs it: the file
 * itself, with no shell, against a real fake flags host. The child process's
 * requests are its own, so the MSW server in tests/setup.ts never sees them.
 */
const SCRIPT = path.resolve(import.meta.dirname, '../../scripts/e2e-flags-set.mjs')

const execFile = promisify(execFileCallback)

/** Runs the script with `args` against the fake on `port`. */
function runScript(args: string[], port: number): Promise<{ stdout: string; stderr: string }> {
  return execFile(SCRIPT, args, { env: { ...process.env, E2E_FAKE_FLAGS_PORT: String(port) } })
}

let fake: RunningFakeFlags

beforeEach(async () => {
  fake = await startFakeFlags({ port: 0 })
})

afterEach(async () => {
  await fake.close()
})

describe('scripts/e2e-flags-set.mjs', () => {
  it('is committed executable, since execFile runs it with no shell', () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0)
  })

  it('sets a flag in the fake and exits 0', async () => {
    const { stdout } = await runScript(['example_beta_page', 'on'], fake.port)

    expect(stdout).toContain('example_beta_page=on')
    expect(fake.values()).toEqual({ example_beta_page: 'on', example_cta_experiment: 'control' })
  })

  it('exits 1, naming the status, when the fake refuses the value', async () => {
    await expect(runScript(['example_beta_page', 'bold'], fake.port)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('400') as string,
    })
    expect(fake.values().example_beta_page).toBe('off')
  })

  it('exits 1 when nothing listens on the port', async () => {
    const { port } = fake
    await fake.close()

    await expect(runScript(['example_beta_page', 'on'], port)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringMatching(
        new RegExp(`ECONNREFUSED.*127\\.0\\.0\\.1:${port}|127\\.0\\.0\\.1:${port}.*ECONNREFUSED`)
      ) as string,
    })
  })

  it('exits 2 with its usage when the value is missing', async () => {
    await expect(runScript(['example_beta_page'], fake.port)).rejects.toMatchObject({
      code: 2,
      stderr: expect.stringContaining('usage') as string,
    })
  })
})

describe('setFakeFlag', () => {
  it('rejects with the status and the body of a non-2xx answer', async () => {
    /** A fetch answering 500 without a socket. */
    const failing = (): Promise<Response> =>
      Promise.resolve(new Response('upstream broke', { status: 500 }))

    await expect(
      setFakeFlag({
        origin: 'http://127.0.0.1:1',
        key: 'example_beta_page',
        value: 'on',
        fetchImpl: failing,
      })
    ).rejects.toThrow('fake flags host answered 500 to example_beta_page=on: upstream broke')
  })
})
