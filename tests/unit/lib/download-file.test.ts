/**
 * @file Covers `downloadFile`, the one way to save a file the API answers behind
 * the Bearer token (a plain `<a href>` would carry no token). Shared with apex.
 */
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vite-plus/test'
import { codeFrom } from '@/lib/api-error'
import { documentFilename, downloadFile, filenameFrom } from '@/lib/download-file'
import { fail } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

const PATH = '/billing/documents/doc-1/pdf'
const URL_PATH = '/api/v1/billing/documents/doc-1/pdf'

/** A PDF answer, with the given Content-Disposition when there is one. */
const pdf = (disposition?: string) =>
  new HttpResponse('%PDF-1.4', {
    headers: {
      'content-type': 'application/pdf',
      ...(disposition ? { 'content-disposition': disposition } : {}),
    },
  })

describe('downloadFile', () => {
  let createObjectURL: MockInstance<typeof URL.createObjectURL>
  let revokeObjectURL: MockInstance<typeof URL.revokeObjectURL>
  let clicked: HTMLAnchorElement[]
  let attachedOnClick: boolean[]
  let revokers: Array<() => void>

  beforeEach(() => {
    // jsdom ships neither method, so give spyOn something to wrap; restoreAllMocks puts the originals back.
    for (const name of ['createObjectURL', 'revokeObjectURL']) {
      if (!(name in URL)) {
        Object.defineProperty(URL, name, { value: () => '', configurable: true, writable: true })
      }
    }
    createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe')
    revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    clicked = []
    attachedOnClick = []
    revokers = []
    // Hold the 1 s revoke timer so a test fires it by hand, with no real wait and no fake timers touching MSW.
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      handler: () => void,
      delay?: number,
      ...args: unknown[]
    ) => {
      if (delay === 1000) {
        revokers.push(handler)
        return 0
      }
      return realSetTimeout(handler, delay, ...args)
    }) as typeof setTimeout)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this)
      attachedOnClick.push(document.body.contains(this))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('saves under the name the API sends, resolves it and revokes the URL', async () => {
    server.use(http.get(URL_PATH, () => pdf('attachment; filename="INV-26-27-00001.pdf"')))
    const result = await downloadFile(PATH, 'fallback.pdf')
    expect(result).toEqual({ filename: 'INV-26-27-00001.pdf' })
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.download).toBe('INV-26-27-00001.pdf')
    expect(clicked[0]?.href).toBe('blob:probe')
    expect(attachedOnClick).toEqual([true])
    expect(document.body.contains(clicked[0] ?? null)).toBe(false)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(revokers).toHaveLength(1)
    revokers[0]?.()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe')
  })

  it('sends options.params in the query string', async () => {
    let seen: string | null = null
    server.use(
      http.get(URL_PATH, ({ request }) => {
        seen = new URL(request.url).searchParams.get('period')
        return pdf('attachment; filename="export.csv"')
      })
    )
    await downloadFile(PATH, 'fallback.csv', { params: { period: '2026-09' } })
    expect(seen).toBe('2026-09')
  })

  it('falls back when the header names a path', async () => {
    server.use(http.get(URL_PATH, () => pdf('attachment; filename="../x.pdf"')))
    const result = await downloadFile(PATH, 'fallback.pdf')
    expect(result).toEqual({ filename: 'fallback.pdf' })
    expect(clicked[0]?.download).toBe('fallback.pdf')
  })

  it('falls back when there is no header', async () => {
    server.use(http.get(URL_PATH, () => pdf()))
    expect(await downloadFile(PATH, 'fallback.pdf')).toEqual({ filename: 'fallback.pdf' })
  })

  it('revokes the URL and propagates the error when the click throws', async () => {
    server.use(http.get(URL_PATH, () => pdf('attachment; filename="a.pdf"')))
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('click blocked')
    })
    await expect(downloadFile(PATH, 'fallback.pdf')).rejects.toThrow('click blocked')
    expect(document.body.querySelector('a[download]')).toBeNull()
    expect(revokers).toHaveLength(1)
    revokers[0]?.()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe')
  })

  it('rejects with the decoded error and clicks nothing on a 404', async () => {
    server.use(http.get(URL_PATH, () => fail('Not found', 404, 'tax_document_not_found')))
    const error = await downloadFile(PATH, 'fallback.pdf').then(
      () => null,
      (e: unknown) => e
    )
    expect(codeFrom(error)).toBe('tax_document_not_found')
    expect(clicked).toHaveLength(0)
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})

describe('filenameFrom', () => {
  it('reads a safe quoted name', () => {
    expect(filenameFrom('attachment; filename="a_b-1.pdf"', 'f.pdf')).toBe('a_b-1.pdf')
  })

  it.each([
    undefined,
    '',
    'attachment',
    'attachment; filename="a b.pdf"',
    'attachment; filename="../x.pdf"',
  ])('falls back for %j', (value) => {
    expect(filenameFrom(value, 'f.pdf')).toBe('f.pdf')
  })

  it.each(['.', '..', '...'])('falls back for the dot-only name %j', (name) => {
    expect(filenameFrom(`attachment; filename="${name}"`, 'f.pdf')).toBe('f.pdf')
  })

  it('falls back for a name over 100 characters', () => {
    expect(filenameFrom(`attachment; filename="${'a'.repeat(101)}"`, 'f.pdf')).toBe('f.pdf')
  })
})

describe('documentFilename', () => {
  it('replaces slashes and adds .pdf', () => {
    expect(documentFilename('CN/26-27/00002')).toBe('CN-26-27-00002.pdf')
    expect(documentFilename('INV/26-27/00001')).toBe('INV-26-27-00001.pdf')
  })
})
