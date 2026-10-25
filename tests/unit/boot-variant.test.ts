// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vite-plus/test'

/**
 * public/boot-variant.js: its auth path list is every page that renders the
 * auth layout, and the script marks <html> for exactly those paths. The list
 * is shared with the sibling app, so a path only the sibling has is allowed.
 */

const ROOT = path.resolve(import.meta.dirname, '../..')
const PAGES = path.join(ROOT, 'src/pages')
const SCRIPT = readFileSync(path.join(ROOT, 'public/boot-variant.js'), 'utf8')

/**
 * Listed auth paths that only one of the two apps has: apex's `/no-access` and
 * `/auth/confirm`, and react's `/welcome` and `/pricing`.
 */
const SIBLING_ONLY = new Set(['/no-access', '/auth/confirm', '/welcome', '/pricing'])

/**
 * Retired password paths that redirect to `/login` before they render, so
 * they paint the sign-in card from the first frame without a route that
 * imports the auth layout.
 */
const REDIRECTS_TO_SIGN_IN = new Set([
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
])

/** The array literal assigned to `BOOT_AUTH_PATHS` in the script. */
function listedPaths(): string[] {
  const literal = /var BOOT_AUTH_PATHS = (\[[^\]]*\])/.exec(SCRIPT)?.[1]
  expect(literal, 'boot-variant.js declares BOOT_AUTH_PATHS').toBeDefined()
  return [...(literal ?? '').matchAll(/'([^']+)'/g)].flatMap((match) => match[1] ?? [])
}

/** The modules a route imports to draw the auth layout: the layout, or the invitation pages' card that wraps it. */
const AUTH_LAYOUT_IMPORTS = [
  "from '@/components/layouts/auth-layout'",
  "from '@/components/features/invitations/invitation-parts'",
]

/**
 * Every route file under src/pages that imports the auth layout, directly or
 * through `invitation-parts`, as the paths it serves.
 */
function authLayoutPaths(): string[] {
  const files = readdirSync(PAGES, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.tsx')
  )
  return files.flatMap((file) => {
    const source = readFileSync(path.join(PAGES, file), 'utf8')
    if (!AUTH_LAYOUT_IMPORTS.some((specifier) => source.includes(specifier))) return []
    if (file === '_auth.tsx') {
      return readdirSync(path.join(PAGES, '_auth')).map(
        (child) => `/${child.replace(/\.tsx$/, '')}`
      )
    }
    return [`/${file.replace(/\.tsx$/, '').replaceAll(path.sep, '/')}`]
  })
}

/** Runs the script for `pathname` and returns the `data-boot` it set, if any. */
function variantFor(pathname: string): string | undefined {
  const attributes = new Map<string, string>()
  runInNewContext(SCRIPT, {
    window: { location: { pathname } },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => attributes.set(name, value),
      },
    },
  })
  return attributes.get('data-boot')
}

describe('boot-variant.js', () => {
  it('lists every page that renders the auth layout', () => {
    expect(listedPaths()).toEqual(expect.arrayContaining(authLayoutPaths()))
  })

  it('lists nothing else but the sibling app’s auth pages', () => {
    const own = new Set(authLayoutPaths())
    expect(
      listedPaths().filter(
        (p) => !own.has(p) && !SIBLING_ONLY.has(p) && !REDIRECTS_TO_SIGN_IN.has(p)
      )
    ).toEqual([])
  })

  it.each(listedPaths())('marks %s as an auth page', (pathname) => {
    expect(variantFor(pathname)).toBe('auth')
    expect(variantFor(`${pathname}/`)).toBe('auth')
  })

  it.each(['/auth/link', '/welcome', '/auth/confirm', '/invitations/confirm'])(
    'marks %s as an auth page',
    (pathname) => {
      expect(variantFor(pathname)).toBe('auth')
    }
  )

  it('marks a trailing-slash /auth/link/ too', () => {
    expect(variantFor('/auth/link/')).toBe('auth')
  })

  it.each(['/', '/dashboard', '/tenants/acme', '/login-help', '/settings/account/security'])(
    'leaves %s on the app shell',
    (pathname) => {
      expect(variantFor(pathname)).toBeUndefined()
    }
  )
})
