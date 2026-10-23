/**
 * @file The production image's response headers, on the responses it serves
 * without a backend. Tagged `@no-api`, so CI runs it against the container with
 * nothing behind `/api`. `/api/` responses are left out: with a live API they
 * carry express's own security headers instead.
 */
import { expect, test, type APIRequestContext } from '@playwright/test'
import { requireServedApp, SECURITY_HEADERS } from './csp'

test.beforeEach(requireServedApp)

/** The path of the entry chunk index.html names: a real, content-hashed asset. */
async function entryChunk(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/')).text()
  const chunk = /\/assets\/index-[\w-]+\.js/.exec(html)?.[0]
  if (!chunk) throw new Error('index.html names no /assets/index-*.js entry chunk')
  return chunk
}

test(
  'pages, assets and a 404 carry every security header, and no nginx version',
  { tag: '@no-api' },
  async ({ request }) => {
    const paths = [
      '/',
      '/dashboard',
      await entryChunk(request),
      '/theme-init.js',
      '/boot-variant.js',
      '/favicon.svg',
      '/assets/does-not-exist.js',
    ]
    for (const path of paths) {
      const headers = (await request.get(path)).headers()
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(headers[name], `${name} on ${path}`).toBe(value)
      }
      expect(headers.server, `server on ${path}`).toBe('nginx')
    }
  }
)

test(
  'a missing asset is a 404 no cache keeps, and a real one is immutable',
  { tag: '@no-api' },
  async ({ request }) => {
    const missing = await request.get('/assets/does-not-exist.js')
    expect(missing.status()).toBe(404)
    expect(await missing.text()).not.toContain('<div id="root">')
    expect(missing.headers()['cache-control']).toBeUndefined()

    const real = await request.get(await entryChunk(request))
    expect(real.status()).toBe(200)
    expect(real.headers()['cache-control']).toBe('public, max-age=31536000, immutable')
  }
)

test(
  'the theme script is served as JavaScript and never cached',
  { tag: '@no-api' },
  async ({ request }) => {
    const response = await request.get('/theme-init.js')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/javascript')
    expect(response.headers()['cache-control']).toBe('no-store')
  }
)

test(
  'the boot variant script is served as JavaScript and never cached',
  { tag: '@no-api' },
  async ({ request }) => {
    const response = await request.get('/boot-variant.js')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/javascript')
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(await response.text()).toContain('var BOOT_AUTH_PATHS = [')
  }
)

test('the favicon is served as SVG and never cached', { tag: '@no-api' }, async ({ request }) => {
  const response = await request.get('/favicon.svg')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toBe('image/svg+xml')
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(await response.text()).toContain('<svg')

  const html = await (await request.get('/')).text()
  expect(html).toMatch(/<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"\s*\/?>/)
})

test(
  'the theme script is loaded by a plain, blocking script tag',
  { tag: '@no-api' },
  async ({ request }) => {
    // Pinned against the served HTML: `type="module"`, `async` or `defer` would let the page paint before the theme class is set, and `script-src 'self'` allows all three.
    const html = await (await request.get('/')).text()
    expect(html).toContain('<script src="/theme-init.js"></script>')
    expect(html).toContain('<script src="/boot-variant.js"></script>')
  }
)

test(
  'a source map is a 404 under /assets and anywhere else, with the security headers',
  { tag: '@no-api' },
  async ({ request }) => {
    const entry = await entryChunk(request)
    for (const path of [
      `${entry}.map`,
      '/assets/index-abc.js.map',
      '/assets/missing.MAP',
      '/main.js.map',
    ]) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
      expect(response.headers()['x-content-type-options'], path).toBe('nosniff')
    }
  }
)
