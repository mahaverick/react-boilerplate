import { expect, test, type APIRequestContext } from '@playwright/test'
import { requireServedApp, SECURITY_HEADERS } from './csp'

/**
 * The production image's response headers, on the responses it serves without
 * a backend. Tagged `@no-api`, so CI runs it against the container with
 * nothing behind `/api`. `/api/` responses are left out: with a live API they
 * also carry express's own security headers.
 */

test.beforeAll(requireServedApp)

/** The entry chunk index.html names: a real, content-hashed asset. */
async function entryChunk(request: APIRequestContext): Promise<string> {
  const html = await (await request.get('/')).text()
  const chunk = /\/assets\/index-[\w-]+\.js/.exec(html)?.[0]
  if (!chunk) throw new Error('index.html names no /assets/index-*.js entry chunk')
  return chunk
}

test(
  'pages and assets carry every security header, and no nginx version',
  { tag: '@no-api' },
  async ({ request }) => {
    const paths = ['/', '/dashboard', await entryChunk(request), '/theme-init.js']
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
  'the theme script is served as JavaScript and never cached',
  { tag: '@no-api' },
  async ({ request }) => {
    const response = await request.get('/theme-init.js')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toBe('application/javascript')
    expect(response.headers()['cache-control']).toBe('no-store')
  }
)
