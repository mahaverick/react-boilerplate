/**
 * @file Covers `downloadFile`, the one way to save a file the API answers behind
 * the Bearer token (a plain `<a href>` would carry no token). Shared with apex.
 */
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
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
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let clicked: HTMLAnchorElement[]

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:probe')
    revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    clicked = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('saves under the name the API sends, resolves it and revokes the URL', async () => {
    server.use(http.get(URL_PATH, () => pdf('attachment; filename="INV-26-27-00001.pdf"')))
    const result = await downloadFile(PATH, 'fallback.pdf')
    expect(result).toEqual({ filename: 'INV-26-27-00001.pdf' })
    expect(clicked).toHaveLength(1)
    expect(clicked[0]?.download).toBe('INV-26-27-00001.pdf')
    expect(clicked[0]?.href).toBe('blob:probe')
    await vi.waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:probe'))
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
