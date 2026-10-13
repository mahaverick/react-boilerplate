// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  cwdFromLsofFields,
  explicitPortOf,
  isTsxWatch,
  isWithin,
  parseRecordedPid,
  recordedServerToStop,
  respawnOptions,
  restartedPidFile,
  restartPlan,
  stopInside,
  stopListenersIn,
  supervisorsToStop,
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

describe('parseRecordedPid', () => {
  it('reads a pid, ignoring surrounding whitespace', () => {
    expect(parseRecordedPid('4321\n')).toBe(4321)
  })

  it.each([
    ['no file', null],
    ['an empty file', ''],
    ['text that is not a pid', '12ab'],
    ['a negative number', '-12'],
    ['init', '1'],
    ['zero', '0'],
  ])('names nothing for %s', (_case, text) => {
    expect(parseRecordedPid(text)).toBeNull()
  })
})

describe('recordedServerToStop', () => {
  /** The decision for a recorded `text` over processes `alive` (pid → cwd). */
  function decide(text: string | null, alive: Record<number, string | null>) {
    return recordedServerToStop({
      recorded: text,
      dir: WORKTREE,
      isAlive: (pid) => pid in alive,
      cwdOf: (pid) => Promise.resolve(alive[pid] ?? null),
    })
  }

  it('stops the recorded server while it is alive inside the worktree', async () => {
    await expect(decide('41', { 41: WORKTREE })).resolves.toBe(41)
  })

  it('only replaces the file when the recorded server is gone', async () => {
    await expect(decide('41', {})).resolves.toBeNull()
  })

  it.each([
    ['in another checkout', MAIN],
    ['beside the worktree', `${WORKTREE}-other`],
    ['with an unreadable cwd', null],
  ])('leaves a reused pid alone when it runs %s', async (_where, cwd) => {
    await expect(decide('41', { 41: cwd })).resolves.toBeNull()
  })

  it('stops nothing without a pid file', async () => {
    await expect(decide(null, { 41: WORKTREE })).resolves.toBeNull()
  })
})

describe('isTsxWatch', () => {
  it.each([
    'node /w/node_modules/.bin/../tsx/dist/cli.mjs watch --env-file-if-exists=.env src/index.ts',
    'tsx watch src/index.ts',
    '/w/node_modules/.bin/tsx watch src/index.ts',
  ])('recognises %s', (command) => {
    expect(isTsxWatch(command)).toBe(true)
  })

  it.each([
    ['a shell', '/bin/zsh -c pnpm dev'],
    ['pnpm itself', 'node /usr/local/bin/pnpm dev'],
    ['the server tsx started', 'node --require /w/tsx/dist/preflight.cjs src/index.ts'],
    ['tsx without watch', 'tsx src/index.ts'],
    ['a watcher of another name', 'notsx watch'],
    ['an unknown command', null],
  ])('rejects %s', (_case, command) => {
    expect(isTsxWatch(command)).toBe(false)
  })
})

describe('supervisorsToStop', () => {
  const TSX_WATCH = 'node /w/node_modules/tsx/dist/cli.mjs watch src/index.ts'

  /** The supervisors of `pids` over a process table (pid → parent, command, cwd). */
  function supervisors(
    pids: number[],
    table: Record<number, { parent: number | null; command?: string; cwd?: string | null }>
  ) {
    return supervisorsToStop({
      pids,
      dir: WORKTREE,
      parentOf: (pid) => Promise.resolve(table[pid]?.parent ?? null),
      commandOf: (pid) => Promise.resolve(table[pid]?.command ?? null),
      cwdOf: (pid) => Promise.resolve(table[pid]?.cwd ?? null),
    })
  }

  it('names the tsx watch inside the worktree that started each listener, once', async () => {
    const found = await supervisors([11, 12], {
      11: { parent: 10 },
      12: { parent: 10 },
      10: { parent: 9, command: TSX_WATCH, cwd: WORKTREE },
    })
    expect(found).toEqual([10])
  })

  it.each([
    ['a shell', { parent: 9, command: '/bin/zsh', cwd: WORKTREE }],
    ['a tsx watch in another checkout', { parent: 9, command: TSX_WATCH, cwd: MAIN }],
    ['a tsx watch with an unreadable cwd', { parent: 9, command: TSX_WATCH, cwd: null }],
    ['a process that is gone', { parent: 9 }],
  ])('leaves alone a parent that is %s', async (_case, parent) => {
    await expect(supervisors([11], { 11: { parent: 10 }, 10: parent })).resolves.toEqual([])
  })

  it('never names init, an unknown parent, or another listener', async () => {
    const found = await supervisors([11, 12, 13], {
      11: { parent: 1 },
      12: { parent: null },
      13: { parent: 11, command: TSX_WATCH, cwd: WORKTREE },
    })
    expect(found).toEqual([])
  })
})

describe('stopInside', () => {
  /** Process operations over `alive` (pid → cwd); the targets exit after SIGTERM when `exits`. */
  function processes(alive: Record<number, string | null>, exits: boolean) {
    return {
      isAlive: vi.fn((id: number) => Math.abs(id) in alive),
      cwdOf: vi.fn((pid: number) => Promise.resolve(alive[pid] ?? null)),
      signal: vi.fn<(id: number, name: 'SIGTERM' | 'SIGKILL') => void>(),
      goneWithin: vi.fn(() => Promise.resolve(exits)),
    }
  }

  it('sends SIGTERM to a supervisor by pid and a recorded server by group, and stops there once they exit', async () => {
    const ops = processes({ 10: WORKTREE, 40: WORKTREE }, true)
    await stopInside({
      targets: [
        { pid: 10, group: false },
        { pid: 40, group: true },
      ],
      dir: WORKTREE,
      ...ops,
    })
    expect(ops.signal.mock.calls).toEqual([
      [10, 'SIGTERM'],
      [-40, 'SIGTERM'],
    ])
    expect(ops.goneWithin).toHaveBeenCalledWith([10, -40], 3000)
  })

  it('sends SIGKILL to a target that outlasts SIGTERM', async () => {
    const ops = processes({ 40: WORKTREE }, false)
    await stopInside({ targets: [{ pid: 40, group: true }], dir: WORKTREE, ...ops })
    expect(ops.signal.mock.calls).toEqual([
      [-40, 'SIGTERM'],
      [-40, 'SIGKILL'],
    ])
  })

  it.each([
    ['in another checkout', MAIN],
    ['with an unreadable cwd', null],
  ])('signals nothing to a target that runs %s', async (_where, cwd) => {
    const ops = processes({ 10: cwd }, false)
    await stopInside({ targets: [{ pid: 10, group: false }], dir: WORKTREE, ...ops })
    expect(ops.signal).not.toHaveBeenCalled()
    expect(ops.goneWithin).not.toHaveBeenCalled()
  })

  it('signals nothing to a target already gone', async () => {
    const ops = processes({}, true)
    await stopInside({ targets: [{ pid: 40, group: true }], dir: WORKTREE, ...ops })
    expect(ops.signal).not.toHaveBeenCalled()
  })

  it('sends no SIGKILL to a pid that moved outside the worktree after SIGTERM', async () => {
    const ops = processes({ 10: WORKTREE }, false)
    ops.cwdOf.mockResolvedValueOnce(WORKTREE).mockResolvedValueOnce(MAIN)
    await stopInside({ targets: [{ pid: 10, group: false }], dir: WORKTREE, ...ops })
    expect(ops.signal.mock.calls).toEqual([[10, 'SIGTERM']])
  })
})
