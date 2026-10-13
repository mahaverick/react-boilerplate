// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  apiDirPlan,
  cwdFromLsofFields,
  explicitPortOf,
  formatPidFile,
  grantDirPlan,
  hasNoTty,
  isPnpmDev,
  isRecordedLeader,
  isRecordedMember,
  isShell,
  isStillTarget,
  isSupervisor,
  isTsxServer,
  isTsxWatch,
  isWithin,
  parsePidFile,
  parsePsLine,
  respawnOptions,
  restartedPidFile,
  restartPlan,
  stopInside,
  stopListenersIn,
  stopTargets,
  supervisorsToStop,
  type ProcessInfo,
} from '../../scripts/api-restart-guard.mjs'

const MAIN = '/work/express-boilerplate'
const WORKTREE = '/work/express-sse'
const CLONE = '/work/express-clone'
const LINK_TO_MAIN = '/work/link-to-main'
const LINK_TO_WORKTREE = '/work/link-to-sse'
/** A directory holding the main checkout, itself a worktree, so only the ancestor rule refuses it. */
const ANCESTOR = '/work'
/** The main checkout spelled in another case, which a native realpath maps to its true case. */
const MAIN_OTHER_CASE = '/WORK/Express-Boilerplate'

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
      [ANCESTOR]: ANCESTOR,
      [MAIN_OTHER_CASE]: MAIN,
    }
    const found = real[path]
    if (found === undefined) throw new Error(`ENOENT: ${path}`)
    return found
  },
  isFile: (path: string): boolean => path === `${WORKTREE}/.git` || path === `${ANCESTOR}/.git`,
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

  it.each([MAIN, '../express-boilerplate', LINK_TO_MAIN, MAIN_OTHER_CASE])(
    'refuses the main express checkout, reached as %s',
    (apiDir) => {
      expect(refusalOf(plan({ apiDir }))).toMatch(
        /never starts pnpm dev in the main express checkout/
      )
    }
  )

  it('refuses a worktree that holds the main checkout', () => {
    expect(refusalOf(plan({ apiDir: ANCESTOR }))).toMatch(/holds the main express checkout/)
  })

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

  it('reads nothing from output without an n field', () => {
    expect(cwdFromLsofFields('p123\nfcwd\n')).toBeNull()
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

  it.each([
    ['its parent', '/work'],
    ['a string prefix of it', MAIN],
  ])('does not place %s inside a sibling worktree', (_case, cwd) => {
    expect(isWithin(cwd, `${MAIN}-sse`)).toBe(false)
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

describe('apiDirPlan', () => {
  /** The plan for a helper named in the refusal. */
  function dirPlan(apiDir: string | undefined) {
    return apiDirPlan({
      apiDir,
      mainCheckout: '../express-boilerplate',
      ...fs,
      who: 'grantPlatformRole',
      does: 'runs pnpm platform:grant',
    })
  }

  it('resolves a worktree', () => {
    expect(dirPlan(LINK_TO_WORKTREE)).toEqual({ dir: WORKTREE })
  })

  it.each([
    [undefined, /grantPlatformRole runs pnpm platform:grant in E2E_API_DIR: set it/],
    ['', /set it to the git worktree/],
    [MAIN, /never runs pnpm platform:grant in the main express checkout/],
    [MAIN_OTHER_CASE, /in the main express checkout/],
    [ANCESTOR, /holds the main express checkout/],
    [CLONE, /has no \.git file/],
    ['/work/missing', /does not exist/],
  ])('refuses %j, naming the helper', (apiDir, refusal) => {
    const result = dirPlan(apiDir)
    expect('refusal' in result ? result.refusal : null).toMatch(refusal)
  })
})

describe('grantDirPlan', () => {
  /** package.json contents by directory: express has the grant script, the clone a different one. */
  const packages: Record<string, { scripts?: unknown }> = {
    [`${MAIN}/package.json`]: { scripts: { 'platform:grant': 'tsx grant.ts' } },
    [`${WORKTREE}/package.json`]: { scripts: { 'platform:grant': 'tsx grant.ts' } },
    [`${CLONE}/package.json`]: { scripts: { dev: 'vite' } },
    [`${ANCESTOR}/package.json`]: {},
  }

  /** The plan for `apiDir` over that file system. */
  function grantPlan(apiDir: string | undefined) {
    return grantDirPlan({
      apiDir,
      realpath: fs.realpath,
      readJson: (path) => packages[path] ?? null,
    })
  }

  it.each([
    [MAIN, MAIN],
    ['../express-boilerplate', MAIN],
    [MAIN_OTHER_CASE, MAIN],
    [LINK_TO_WORKTREE, WORKTREE],
  ])('runs in %s, the main checkout included, resolved to %s', (apiDir, dir) => {
    expect(grantPlan(apiDir)).toEqual({ dir })
  })

  it.each([
    [undefined, /E2E_API_DIR, which is unset: set it to the express checkout whose database/],
    ['', /which is unset/],
    ['/work/missing', /does not exist/],
    [CLONE, /has no platform:grant script/],
    [ANCESTOR, /has no platform:grant script/],
    [LINK_TO_MAIN.replace('main', 'nowhere'), /does not exist/],
  ])('refuses %j', (apiDir, refusal) => {
    const result = grantPlan(apiDir)
    expect('refusal' in result ? result.refusal : null).toMatch(refusal)
  })

  it('refuses a directory without a package.json', () => {
    const result = grantDirPlan({ apiDir: WORKTREE, realpath: fs.realpath, readJson: () => null })
    expect('refusal' in result ? result.refusal : null).toMatch(/has no platform:grant script/)
  })
})

const LSTART = 'Tue Oct 13 09:05:01 2026'
const PNPM_DEV = 'node /home/u/.nvm/versions/node/v24.17.0/bin/pnpm dev'
const TSX_WATCH =
  'node /w/node_modules/.bin/../tsx/dist/cli.mjs watch --env-file-if-exists=.env src/index.ts'
const TSX_SERVER =
  'node --require /w/node_modules/.pnpm/tsx@4/node_modules/tsx/dist/preflight.cjs --import file:///w/node_modules/.pnpm/tsx@4/node_modules/tsx/dist/loader.mjs src/index.ts'

/** A process inside the worktree with no terminal, unless `overrides` changes that. */
function proc(overrides: Partial<ProcessInfo> & { pid: number }): ProcessInfo {
  return {
    pgid: overrides.pid,
    tty: '??',
    lstart: LSTART,
    command: PNPM_DEV,
    cwd: WORKTREE,
    ...overrides,
  }
}

const RECORDED = { pid: 40, lstart: LSTART }

describe('parsePsLine', () => {
  it('reads pid, group, terminal, start time and command', () => {
    expect(parsePsLine(`  97134 97134 ??       Tue Oct 13 09:05:01 2026     ${PNPM_DEV}`)).toEqual({
      pid: 97134,
      pgid: 97134,
      tty: '??',
      lstart: LSTART,
      command: PNPM_DEV,
    })
  })

  it('normalises the padded single-digit day, so a later read compares equal', () => {
    expect(parsePsLine('5 5 ?  Sat Oct  3 08:00:00 2026 /sbin/init')?.lstart).toBe(
      'Sat Oct 3 08:00:00 2026'
    )
  })

  it.each([null, '', 'garbage', 'x 5 ?? Sat Oct 3 08:00:00 2026 cmd'])(
    'reads nothing from %j',
    (line) => {
      expect(parsePsLine(line)).toBeNull()
    }
  )
})

describe('pid file', () => {
  it('round-trips the pid and start time', () => {
    expect(parsePidFile(formatPidFile(4321, LSTART))).toEqual({ pid: 4321, lstart: LSTART })
  })

  it('puts the pid alone on the first line, for the runbook kill', () => {
    expect(formatPidFile(4321, LSTART).split('\n')[0]).toBe('4321')
  })

  it.each([
    ['no file', null],
    ['an empty file', ''],
    ['a pid without a start time, which cannot be told from a reused pid', formatPidFile(41, null)],
    ['text that is not a pid', `12ab\n${LSTART}\n`],
    ['a negative number', `-12\n${LSTART}\n`],
    ['init', `1\n${LSTART}\n`],
  ])('names nothing to stop for %s', (_case, text) => {
    expect(parsePidFile(text)).toBeNull()
  })
})

describe('command matchers', () => {
  it.each([TSX_WATCH, 'tsx watch src/index.ts', '/w/node_modules/.bin/tsx watch src/index.ts'])(
    'isTsxWatch recognises %s',
    (command) => {
      expect(isTsxWatch(command)).toBe(true)
    }
  )

  it.each(['/bin/zsh -c pnpm dev', PNPM_DEV, TSX_SERVER, 'tsx src/index.ts', 'notsx watch', null])(
    'isTsxWatch rejects %j',
    (command) => {
      expect(isTsxWatch(command)).toBe(false)
    }
  )

  it.each([PNPM_DEV, '/home/u/.cache/node/corepack/v1/pnpm/12.4.1/pnpm-native dev', 'pnpm dev'])(
    'isPnpmDev recognises %s',
    (command) => {
      expect(isPnpmDev(command)).toBe(true)
    }
  )

  it.each(['pnpm test', 'pnpm devtools', 'vim pnpm', TSX_WATCH, null])(
    'isPnpmDev rejects %j',
    (command) => {
      expect(isPnpmDev(command)).toBe(false)
    }
  )

  it('isTsxServer recognises the server tsx runs, and not its watcher', () => {
    expect(isTsxServer(TSX_SERVER)).toBe(true)
    expect(isTsxServer(TSX_WATCH)).toBe(false)
  })

  it.each(['-zsh', '/bin/zsh -c source x', 'bash', '/usr/local/bin/fish', 'sh -c "pnpm dev"'])(
    'isShell recognises %s',
    (command) => {
      expect(isShell(command)).toBe(true)
    }
  )

  it.each([PNPM_DEV, TSX_WATCH, 'vim src/index.ts'])('isShell rejects %s', (command) => {
    expect(isShell(command)).toBe(false)
  })

  it.each([
    ['??', true],
    ['?', true],
    ['ttys000', false],
    ['pts/1', false],
    [null, false],
  ])('hasNoTty(%j) is %s', (tty, none) => {
    expect(hasNoTty(tty)).toBe(none)
  })
})

describe('isRecordedLeader', () => {
  it('accepts the recorded pnpm dev: same pid and start time, its own group, no terminal', () => {
    expect(isRecordedLeader(proc({ pid: 40 }), RECORDED, WORKTREE)).toBe(true)
  })

  it.each([
    ['gone', null],
    ['a reused pid with another start time', proc({ pid: 40, lstart: 'Tue Oct 13 10:00:00 2026' })],
    ['a shell in the worktree', proc({ pid: 40, command: '-zsh' })],
    ['a shell running pnpm dev', proc({ pid: 40, command: '/bin/zsh -c pnpm dev' })],
    ['a process with a terminal', proc({ pid: 40, tty: 'ttys000' })],
    ['not its group leader', proc({ pid: 40, pgid: 39 })],
    ['another command', proc({ pid: 40, command: 'vim src/index.ts' })],
    ['outside the worktree', proc({ pid: 40, cwd: MAIN })],
    ['beside the worktree', proc({ pid: 40, cwd: `${WORKTREE}-other` })],
    ['with an unreadable cwd', proc({ pid: 40, cwd: null })],
    ['another pid', proc({ pid: 41 })],
  ])('refuses %s', (_case, info) => {
    expect(isRecordedLeader(info, RECORDED, WORKTREE)).toBe(false)
  })
})

describe('isRecordedMember', () => {
  it.each([
    ['pnpm-native', '/c/pnpm/12.4.1/pnpm-native dev'],
    ['tsx watch', TSX_WATCH],
    ['the server', TSX_SERVER],
  ])('accepts %s left in the recorded group', (_case, command) => {
    expect(isRecordedMember(proc({ pid: 42, pgid: 40, command }), RECORDED, WORKTREE)).toBe(true)
  })

  it.each([
    ['gone', null],
    ['the leader itself', proc({ pid: 40, pgid: 40 })],
    ['in another group', proc({ pid: 42, pgid: 41, command: TSX_WATCH })],
    ['a shell in the group', proc({ pid: 42, pgid: 40, command: '-zsh' })],
    ['with a terminal', proc({ pid: 42, pgid: 40, command: TSX_WATCH, tty: 'ttys001' })],
    ['another command', proc({ pid: 42, pgid: 40, command: 'vim x' })],
    ['outside the worktree', proc({ pid: 42, pgid: 40, command: TSX_WATCH, cwd: MAIN })],
  ])('refuses %s', (_case, info) => {
    expect(isRecordedMember(info, RECORDED, WORKTREE)).toBe(false)
  })
})

describe('isSupervisor', () => {
  it('accepts a tsx watch inside the worktree, whatever its terminal', () => {
    expect(isSupervisor(proc({ pid: 10, command: TSX_WATCH, tty: 'ttys000' }), WORKTREE)).toBe(true)
  })

  it.each([
    ['gone', null],
    ['a shell', proc({ pid: 10, command: '/bin/zsh' })],
    ['pnpm', proc({ pid: 10 })],
    ['in another checkout', proc({ pid: 10, command: TSX_WATCH, cwd: MAIN })],
    ['beside the worktree', proc({ pid: 10, command: TSX_WATCH, cwd: `${WORKTREE}-other` })],
    ['with an unreadable cwd', proc({ pid: 10, command: TSX_WATCH, cwd: null })],
  ])('refuses %s', (_case, info) => {
    expect(isSupervisor(info, WORKTREE)).toBe(false)
  })
})

describe('supervisorsToStop', () => {
  /** The supervisors of `pids` over a parent map and a process table. */
  function supervisors(
    pids: number[],
    parents: Record<number, number | null>,
    table: Record<number, ProcessInfo>
  ) {
    return supervisorsToStop({
      pids,
      dir: WORKTREE,
      parentOf: (pid) => Promise.resolve(parents[pid] ?? null),
      infoOf: (pid) => Promise.resolve(table[pid] ?? null),
    })
  }

  it('names the tsx watch inside the worktree that started each listener, once', async () => {
    const found = await supervisors(
      [11, 12],
      { 11: 10, 12: 10 },
      {
        10: proc({ pid: 10, command: TSX_WATCH, tty: 'ttys000' }),
      }
    )
    expect(found).toEqual([10])
  })

  it.each([
    ['a shell', proc({ pid: 10, command: '/bin/zsh' })],
    ['a tsx watch in another checkout', proc({ pid: 10, command: TSX_WATCH, cwd: MAIN })],
    ['a tsx watch with an unreadable cwd', proc({ pid: 10, command: TSX_WATCH, cwd: null })],
  ])('leaves alone a parent that is %s', async (_case, parent) => {
    await expect(supervisors([11], { 11: 10 }, { 10: parent })).resolves.toEqual([])
  })

  it('leaves alone a parent that is gone', async () => {
    await expect(supervisors([11], { 11: 10 }, {})).resolves.toEqual([])
  })

  it('never names init, an unknown parent, or another listener', async () => {
    const found = await supervisors(
      [11, 12, 13],
      { 11: 1, 12: null, 13: 11 },
      {
        11: proc({ pid: 11, command: TSX_WATCH }),
      }
    )
    expect(found).toEqual([])
  })
})

describe('stopTargets', () => {
  const LEADER = proc({ pid: 40 })
  const WATCH = proc({ pid: 42, pgid: 40, command: TSX_WATCH })

  it('stops supervisors by pid and nothing else without a pid file', () => {
    expect(
      stopTargets({ supervisors: [10], recorded: null, leader: null, members: [], dir: WORKTREE })
    ).toEqual([{ id: 10, pid: 10, kind: 'supervisor' }])
  })

  it('stops the recorded server by group while its leader is still the recorded one', () => {
    expect(
      stopTargets({
        supervisors: [10],
        recorded: RECORDED,
        leader: LEADER,
        members: [LEADER, WATCH],
        dir: WORKTREE,
      })
    ).toEqual([
      { id: 10, pid: 10, kind: 'supervisor' },
      { id: -40, pid: 40, kind: 'leader' },
    ])
  })

  it('stops the survivors by pid once the leader is gone, each once', () => {
    expect(
      stopTargets({
        supervisors: [42],
        recorded: RECORDED,
        leader: null,
        members: [WATCH, proc({ pid: 43, pgid: 40, command: TSX_SERVER })],
        dir: WORKTREE,
      })
    ).toEqual([
      { id: 42, pid: 42, kind: 'supervisor' },
      { id: 43, pid: 43, kind: 'member' },
    ])
  })

  it.each([
    ['a reused pid with another start time', proc({ pid: 40, lstart: 'Tue Oct 13 10:00:00 2026' })],
    ['a shell', proc({ pid: 40, command: '-zsh', tty: 'ttys000' })],
  ])('never signals the group of %s, and stops only verified members', (_case, leader) => {
    expect(
      stopTargets({
        supervisors: [],
        recorded: RECORDED,
        leader,
        members: [leader, proc({ pid: 44, pgid: 40, command: 'vim x', tty: 'ttys000' })],
        dir: WORKTREE,
      })
    ).toEqual([])
  })
})

describe('isStillTarget', () => {
  it('re-checks a supervisor as a tsx watch, a leader against the pid file, and a member against the group', () => {
    expect(
      isStillTarget(
        { id: 10, pid: 10, kind: 'supervisor' },
        proc({ pid: 10, command: TSX_WATCH }),
        null,
        WORKTREE
      )
    ).toBe(true)
    expect(
      isStillTarget({ id: -40, pid: 40, kind: 'leader' }, proc({ pid: 40 }), RECORDED, WORKTREE)
    ).toBe(true)
    expect(
      isStillTarget(
        { id: 42, pid: 42, kind: 'member' },
        proc({ pid: 42, pgid: 40, command: TSX_WATCH }),
        RECORDED,
        WORKTREE
      )
    ).toBe(true)
  })

  it('refuses a leader or member without a pid file', () => {
    expect(
      isStillTarget({ id: -40, pid: 40, kind: 'leader' }, proc({ pid: 40 }), null, WORKTREE)
    ).toBe(false)
  })
})

describe('stopInside', () => {
  const SUPERVISOR = { id: 10, pid: 10, kind: 'supervisor' as const }
  const LEADER = { id: -40, pid: 40, kind: 'leader' as const }

  /** Process operations over `table`; the targets exit after SIGTERM when `exits`. */
  function processes(table: Record<number, ProcessInfo>, exits: boolean) {
    return {
      infoOf: vi.fn((pid: number) => Promise.resolve(table[pid] ?? null)),
      signal: vi.fn<(id: number, name: 'SIGTERM' | 'SIGKILL') => void>(),
      goneWithin: vi.fn(() => Promise.resolve(exits)),
    }
  }

  it('sends SIGTERM to a supervisor by pid and the recorded server by group, and stops there once they exit', async () => {
    const ops = processes(
      { 10: proc({ pid: 10, command: TSX_WATCH }), 40: proc({ pid: 40 }) },
      true
    )
    await stopInside({ targets: [SUPERVISOR, LEADER], recorded: RECORDED, dir: WORKTREE, ...ops })
    expect(ops.signal.mock.calls).toEqual([
      [10, 'SIGTERM'],
      [-40, 'SIGTERM'],
    ])
    expect(ops.goneWithin).toHaveBeenCalledWith([10, -40], 3000)
  })

  it('sends SIGKILL to a target that outlasts SIGTERM', async () => {
    const ops = processes({ 40: proc({ pid: 40 }) }, false)
    await stopInside({ targets: [LEADER], recorded: RECORDED, dir: WORKTREE, ...ops })
    expect(ops.signal.mock.calls).toEqual([
      [-40, 'SIGTERM'],
      [-40, 'SIGKILL'],
    ])
  })

  it.each([
    ['in another checkout', MAIN],
    ['beside the worktree', `${WORKTREE}-other`],
    ['with an unreadable cwd', null],
  ])('signals nothing to a supervisor that runs %s', async (_where, cwd) => {
    const ops = processes({ 10: proc({ pid: 10, command: TSX_WATCH, cwd }) }, false)
    await stopInside({ targets: [SUPERVISOR], recorded: null, dir: WORKTREE, ...ops })
    expect(ops.signal).not.toHaveBeenCalled()
    expect(ops.goneWithin).not.toHaveBeenCalled()
  })

  it('signals nothing to a target already gone', async () => {
    const ops = processes({}, true)
    await stopInside({ targets: [LEADER], recorded: RECORDED, dir: WORKTREE, ...ops })
    expect(ops.signal).not.toHaveBeenCalled()
  })

  it('sends no signal to a supervisor whose command changed between the read and the signal', async () => {
    const ops = processes({ 10: proc({ pid: 10, command: 'vim src/index.ts' }) }, false)
    await stopInside({ targets: [SUPERVISOR], recorded: null, dir: WORKTREE, ...ops })
    expect(ops.signal).not.toHaveBeenCalled()
  })

  it('sends no SIGKILL to a pid that was reused after SIGTERM', async () => {
    const ops = processes({ 40: proc({ pid: 40 }) }, false)
    ops.infoOf
      .mockResolvedValueOnce(proc({ pid: 40 }))
      .mockResolvedValueOnce(proc({ pid: 40, lstart: 'Tue Oct 13 10:00:00 2026', tty: 'ttys000' }))
    await stopInside({ targets: [LEADER], recorded: RECORDED, dir: WORKTREE, ...ops })
    expect(ops.signal.mock.calls).toEqual([[-40, 'SIGTERM']])
  })
})
