// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  cwdFromLsofFields,
  explicitPortOf,
  isWithin,
  respawnOptions,
  restartedPidFile,
  restartPlan,
  stopListenersIn,
} from '../../scripts/api-restart-guard.mjs'

const MAIN = '/work/express-boilerplate'
const WORKTREE = '/work/express-sse'
const CLONE = '/work/express-clone'
const LINK_TO_MAIN = '/work/link-to-main'
const LINK_TO_WORKTREE = '/work/link-to-sse'

/** A file system with the main checkout, a worktree, a standalone clone and links to both. */
const fs = {
  realpath: (path: string): string => {
    const real: Record<string, string> = {
      [MAIN]: MAIN,
      '../express-boilerplate': MAIN,
      [LINK_TO_MAIN]: MAIN,
      [WORKTREE]: WORKTREE,
      [LINK_TO_WORKTREE]: WORKTREE,
      [CLONE]: CLONE,
    }
    const found = real[path]
    if (found === undefined) throw new Error(`ENOENT: ${path}`)
    return found
  },
  isFile: (path: string): boolean => path === `${WORKTREE}/.git`,
}

/** The plan for an environment that passes every rule unless `overrides` breaks one. */
function plan(overrides: { origin?: string; allowRestart?: string; apiDir?: string }) {
  return restartPlan({
    origin: 'http://localhost:4999',
    allowRestart: '1',
    apiDir: WORKTREE,
    mainCheckout: '../express-boilerplate',
    ...fs,
    ...overrides,
  })
}

/** The refusal in a plan, or `null` when it may run. */
function refusalOf(result: ReturnType<typeof plan>): string | null {
  return 'refusal' in result ? result.refusal : null
}

describe('explicitPortOf', () => {
  it.each([
    ['http://localhost:4999', '4999'],
    ['https://api.example.test:8443', '8443'],
    ['http://localhost:4040/api', '4040'],
  ])('reads %s as port %s', (origin, port) => {
    expect(explicitPortOf(origin)).toBe(port)
  })

  it.each([
    'http://localhost',
    'https://api.example.test',
    'localhost:4999',
    'ftp://localhost:4999',
    'not a url',
  ])('reads no port from %s', (origin) => {
    expect(explicitPortOf(origin)).toBeNull()
  })
})

describe('restartPlan', () => {
  it('lets an opted-in restart of a worktree on another port run, in the resolved worktree', () => {
    expect(plan({})).toEqual({ port: '4999', dir: WORKTREE })
    expect(plan({ apiDir: LINK_TO_WORKTREE })).toEqual({ port: '4999', dir: WORKTREE })
  })

  it.each(['http://localhost', 'https://localhost', 'localhost:4999'])(
    'refuses %s, an origin without an http(s) scheme and an explicit port',
    (origin) => {
      expect(refusalOf(plan({ origin }))).toMatch(/http\(s\) with an explicit port/)
    }
  )

  it('refuses port 4040 even when opted in', () => {
    expect(refusalOf(plan({ origin: 'http://localhost:4040' }))).toMatch(
      /:4040, the dev server's port/
    )
  })

  it.each([undefined, '', '0', 'true'])('refuses E2E_ALLOW_API_RESTART=%s', (allowRestart) => {
    expect(refusalOf(plan({ allowRestart }))).toMatch(/set E2E_ALLOW_API_RESTART=1/)
  })

  it.each([undefined, ''])('refuses an E2E_API_DIR of %j', (apiDir) => {
    expect(refusalOf(plan({ apiDir }))).toMatch(/set it to the git worktree/)
  })

  it.each([MAIN, '../express-boilerplate', LINK_TO_MAIN])(
    'refuses the main express checkout, reached as %s',
    (apiDir) => {
      expect(refusalOf(plan({ apiDir }))).toMatch(
        /never starts pnpm dev in the main express checkout/
      )
    }
  )

  it('refuses a standalone clone, whose .git is a directory', () => {
    expect(refusalOf(plan({ apiDir: CLONE }))).toMatch(/has no \.git file/)
  })

  it('refuses a directory that does not exist', () => {
    expect(refusalOf(plan({ apiDir: '/work/missing' }))).toMatch(/does not exist/)
  })
})

describe('cwdFromLsofFields', () => {
  it('reads the n field', () => {
    expect(cwdFromLsofFields(`p4321\nfcwd\nn${WORKTREE}/src\n`)).toBe(`${WORKTREE}/src`)
  })

  it('reads nothing from empty output', () => {
    expect(cwdFromLsofFields('')).toBeNull()
  })
})

describe('isWithin', () => {
  it.each([
    [WORKTREE, true],
    [`${WORKTREE}/src`, true],
    [`${WORKTREE}-other`, false],
    [MAIN, false],
    [null, false],
  ])('places %s inside the worktree: %s', (cwd, inside) => {
    expect(isWithin(cwd, WORKTREE)).toBe(inside)
  })
})

describe('stopListenersIn', () => {
  /** Process operations over a port held by `listeners` (pid → cwd); the port frees when `freed`. */
  function processes(listeners: Record<number, string | null>, freed: boolean) {
    return {
      listeningPids: vi.fn(() => Promise.resolve(Object.keys(listeners).map(Number))),
      cwdOf: vi.fn((pid: number) => Promise.resolve(listeners[pid] ?? null)),
      signal: vi.fn<(pid: number, name: 'SIGTERM' | 'SIGKILL') => void>(),
      freedWithin: vi.fn(() => Promise.resolve(freed)),
    }
  }

  it('sends SIGTERM to every listener in the worktree, and stops there once the port frees', async () => {
    const ops = processes({ 11: WORKTREE, 12: `${WORKTREE}/node_modules/.bin` }, true)
    await stopListenersIn({ port: '4999', dir: WORKTREE, ...ops })
    expect(ops.signal.mock.calls).toEqual([
      [11, 'SIGTERM'],
      [12, 'SIGTERM'],
    ])
  })

  it('sends SIGKILL to listeners in the worktree that outlast SIGTERM', async () => {
    const ops = processes({ 11: WORKTREE }, false)
    await stopListenersIn({ port: '4999', dir: WORKTREE, ...ops })
    expect(ops.signal.mock.calls).toEqual([
      [11, 'SIGTERM'],
      [11, 'SIGKILL'],
    ])
  })

  it.each([
    ['in another checkout', MAIN],
    ['beside the worktree', `${WORKTREE}-other`],
    ['with an unreadable cwd', null],
  ])('signals nothing when a listener runs %s', async (_where, cwd) => {
    const ops = processes({ 11: WORKTREE, 12: cwd }, true)
    await expect(stopListenersIn({ port: '4999', dir: WORKTREE, ...ops })).rejects.toThrow(
      /will not stop :4999: 12 .* runs outside/
    )
    expect(ops.signal).not.toHaveBeenCalled()
  })

  it('sends no SIGKILL when a listener outside the worktree appears after SIGTERM', async () => {
    const ops = processes({ 11: WORKTREE }, false)
    ops.listeningPids.mockResolvedValueOnce([11]).mockResolvedValueOnce([21])
    ops.cwdOf.mockImplementation((pid: number) => Promise.resolve(pid === 11 ? WORKTREE : MAIN))
    await expect(stopListenersIn({ port: '4999', dir: WORKTREE, ...ops })).rejects.toThrow(
      /21 \(\/work\/express-boilerplate\) runs outside/
    )
    expect(ops.signal.mock.calls).toEqual([[11, 'SIGTERM']])
  })
})

describe('respawnOptions', () => {
  it('binds the respawn to the checked port in the resolved worktree, whatever the environment says', () => {
    const options = respawnOptions(WORKTREE, '4999', { APP_PORT: '4040', PATH: '/bin' })
    expect(options).toEqual({
      cwd: WORKTREE,
      detached: true,
      stdio: 'ignore',
      env: { APP_PORT: '4999', PATH: '/bin' },
    })
  })
})

describe('restartedPidFile', () => {
  it('names one file per port in the temporary directory', () => {
    expect(restartedPidFile('/tmp/t', '4999')).toBe('/tmp/t/react-e2e-restarted-api-4999.pid')
  })
})
