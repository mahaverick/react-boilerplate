/**
 * @file Covers `decodeBlobErrorBody`, the first response interceptor. A request
 * made with `responseType: 'blob'` gets its error body as a Blob. The decoder
 * parses a JSON Blob body in place, so the later interceptors and
 * `codeFrom` / `messageFrom` see what a JSON request would.
 *
 * jsdom behaviour: with MSW answering a 404 JSON body to
 * `apiClient.get(url, { responseType: 'blob' })`, `error.response.data` is a real
 * `Blob` (`[object Blob]`) with `type` `application/json`, and `Blob.text()` works.
 * So the guard is `instanceof Blob` plus a `json` type, tested here directly. The
 * real-browser path is covered by the download spec (e2e) and the live walk.
 */
import axios from 'axios'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { installInterceptors } from '@/http/interceptors'
import { resetSessionForTests } from '@/http/session'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { ACCESS_TOKEN_EXPIRED } from '@/types/api.types'

const URL_PATH = '/api/v1/blob-probe'

/** A fresh axios client with the real interceptors installed. */
function makeClient() {
  const client = axios.create({ baseURL: '/api/v1', withCredentials: true })
  installInterceptors(client)
  return client
}

/** A blob request, as the document download makes it. */
const getBlob = () => makeClient().get('/blob-probe', { responseType: 'blob' })

describe('decodeBlobErrorBody', () => {
  beforeEach(() => {
    resetSessionForTests()
    useAuthStore.setState({
      accessToken: null,
      user: null,
      isAuthenticated: false,
      isBootstrapped: false,
    })
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('refreshes once and replays a blob request whose 401 is ACCESS_TOKEN_EXPIRED', async () => {
    useAuthStore.getState().login('stale-token', testUser)
    const logout = vi.spyOn(useAuthStore.getState(), 'logout')
    let calls = 0
    server.use(
      http.get(URL_PATH, () => {
        calls += 1
        if (calls === 1) return fail('Expired', 401, ACCESS_TOKEN_EXPIRED)
        return new HttpResponse('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
      })
    )

    const response = await getBlob()

    expect(calls).toBe(2)
    expect(response.data).toBeInstanceOf(Blob)
    expect(logout).not.toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('signs out on a blob request whose 401 is INVALID_TOKEN and carried a token', async () => {
    useAuthStore.getState().login('tok', testUser)
    server.use(http.get(URL_PATH, () => fail('Bad token', 401, 'INVALID_TOKEN')))

    const error = await getBlob().catch((e: unknown) => e)

    expect(codeFrom(error)).toBe('INVALID_TOKEN')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('exposes a JSON error body to codeFrom and messageFrom', async () => {
    server.use(http.get(URL_PATH, () => fail('M', 404, 'tax_document_not_found')))

    const error = await getBlob().catch((e: unknown) => e)

    expect(codeFrom(error)).toBe('tax_document_not_found')
    expect(messageFrom(error)).toBe('M')
  })

  it('rejects a non-JSON blob body untouched', async () => {
    server.use(
      http.get(URL_PATH, () =>
        HttpResponse.text('<html>boom</html>', {
          status: 500,
          headers: { 'content-type': 'text/html' },
        })
      )
    )

    const error = (await getBlob().catch((e: unknown) => e)) as {
      response: { data: unknown; status: number }
    }

    expect(error.response.status).toBe(500)
    expect(error.response.data).toBeInstanceOf(Blob)
    expect(await (error.response.data as Blob).text()).toBe('<html>boom</html>')
  })

  it('rejects a JSON blob that will not parse, body unchanged', async () => {
    server.use(
      http.get(URL_PATH, () =>
        HttpResponse.text('{not json', {
          status: 500,
          headers: { 'content-type': 'application/json' },
        })
      )
    )

    const error = (await getBlob().catch((e: unknown) => e)) as { response: { data: unknown } }

    expect(error.response.data).toBeInstanceOf(Blob)
    expect(await (error.response.data as Blob).text()).toBe('{not json')
  })

  it('leaves a successful blob response alone', async () => {
    server.use(http.get(URL_PATH, () => ok({})))
    // A 200 JSON blob is a success: the decoder only touches rejections.
    const response = await getBlob()
    expect(response.data).toBeInstanceOf(Blob)
  })
})
