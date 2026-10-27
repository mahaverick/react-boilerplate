import { apiClient } from '@/http/client'

/** A name safe to hand to `<a download>`: no path, no spaces, at most 100 characters, not only dots. */
const SAFE_FILENAME = /^(?!\.+$)[A-Za-z0-9._-]{1,100}$/

/**
 * The `filename="…"` of a Content-Disposition header, or `fallback` when the
 * header is missing or the name is not plain. The header comes off the wire, so
 * a name with a path in it is never trusted.
 */
export function filenameFrom(contentDisposition: string | undefined, fallback: string): string {
  const name = contentDisposition?.match(/filename="([^"]*)"/)?.[1]
  return name !== undefined && SAFE_FILENAME.test(name) ? name : fallback
}

/** The file name of a tax document: `INV/26-27/00001` becomes `INV-26-27-00001.pdf`. */
export function documentFilename(number: string): string {
  return `${number.replaceAll('/', '-')}.pdf`
}

/**
 * Saves a file the API answers behind the Bearer token. A plain `<a href>`
 * would carry no token, so the bytes are fetched through `apiClient` and handed
 * to the browser as an object URL. Resolves the name it saved under. Rejects
 * with the axios error unchanged (the interceptor has decoded a JSON error
 * body); it shows no toast, the caller does.
 */
export async function downloadFile(
  path: string,
  fallbackName: string,
  options?: { params?: Record<string, string> }
): Promise<{ filename: string }> {
  const response = await apiClient.get<Blob>(path, {
    params: options?.params,
    responseType: 'blob',
  })
  const filename = filenameFrom(
    response.headers['content-disposition'] as string | undefined,
    fallbackName
  )
  const url = URL.createObjectURL(response.data)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
    }
  } finally {
    // Safari and Firefox start the download asynchronously and fail if the URL is revoked at once.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return { filename }
}
