// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { portOf, respawnOptions, restartRefusal } from '../../scripts/api-restart-guard.mjs'

const MAIN = '/work/express-boilerplate'
const WORKTREE = '/work/express-sse'
const CLONE = '/work/express-clone'
const LINK_TO_MAIN = '/work/link-to-main'

/** A file system with the main checkout, a worktree, a standalone clone and a link to main. */
const fs = {
  realpath: (path: string): string => {
    const real: Record<string, string> = {
      [MAIN]: MAIN,
      '../express-boilerplate': MAIN,
      [LINK_TO_MAIN]: MAIN,
      [WORKTREE]: WORKTREE,
      [CLONE]: CLONE,
    }
    const found = real[path]
    if (found === undefined) throw new Error(`ENOENT: ${path}`)
    return found
  },
  isFile: (path: string): boolean => path === `${WORKTREE}/.git`,
}

/** The refusal for an environment that passes every rule unless `overrides` breaks one. */
function refusal(overrides: { origin?: string; allowRestart?: string; apiDir?: string }) {
  return restartRefusal({
    origin: 'http://localhost:4999',
    allowRestart: '1',
    apiDir: WORKTREE,
    mainCheckout: '../express-boilerplate',
    ...fs,
    ...overrides,
  })
}

describe('restartRefusal', () => {
  it('lets an opted-in restart of a worktree on another port run', () => {
    expect(refusal({})).toBeNull()
  })

  it('refuses port 4040 even when opted in', () => {
    expect(refusal({ origin: 'http://localhost:4040' })).toMatch(/:4040, the dev server's port/)
  })

  it.each([undefined, '', '0', 'true'])('refuses E2E_ALLOW_API_RESTART=%s', (allowRestart) => {
    expect(refusal({ allowRestart })).toMatch(/set E2E_ALLOW_API_RESTART=1/)
  })

  it.each([undefined, ''])('refuses an E2E_API_DIR of %j', (apiDir) => {
    expect(refusal({ apiDir })).toMatch(/set it to the git worktree/)
  })

  it.each([MAIN, '../express-boilerplate', LINK_TO_MAIN])(
    'refuses the main express checkout, reached as %s',
    (apiDir) => {
      expect(refusal({ apiDir })).toMatch(/never starts pnpm dev in the main express checkout/)
    }
  )

  it('refuses a standalone clone, whose .git is a directory', () => {
    expect(refusal({ apiDir: CLONE })).toMatch(/has no \.git file/)
  })

  it('refuses a directory that does not exist', () => {
    expect(refusal({ apiDir: '/work/missing' })).toMatch(/does not exist/)
  })
})

describe('respawnOptions', () => {
  it('binds the respawn to the checked port, whatever the environment says', () => {
    const options = respawnOptions(WORKTREE, '4999', { APP_PORT: '4040', PATH: '/bin' })
    expect(options).toEqual({
      cwd: WORKTREE,
      detached: true,
      stdio: 'ignore',
      env: { APP_PORT: '4999', PATH: '/bin' },
    })
  })
})

describe('portOf', () => {
  it.each([
    ['http://localhost:4999', '4999'],
    ['http://localhost', '80'],
    ['https://api.example.test', '443'],
  ])('reads %s as port %s', (origin, port) => {
    expect(portOf(origin)).toBe(port)
  })
})
