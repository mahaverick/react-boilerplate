/**
 * @file Endpoint specs for the page capture: `'GET /tenants/:slug'` names one
 * API route relative to `/api/v1`. A `:name` segment matches any one segment;
 * every other segment matches only itself, and the segment count must be equal,
 * so `/tenants/:slug` never matches `/tenants/acme/flags`. Free of Playwright
 * imports so the unit suite can test it.
 */

/** The path every API request starts with, in dev and behind nginx. */
export const API_PREFIX = '/api/v1'

/** A parsed endpoint spec: the HTTP method and the path segments after the prefix. */
export interface Endpoint {
  method: string
  segments: readonly string[]
}

/**
 * Parses `'METHOD /path/:param'`.
 * @param spec - The endpoint as the manifest writes it.
 * @returns The method, upper-cased, and the path segments.
 * @throws When the spec is not `METHOD /path`.
 */
export function parseEndpoint(spec: string): Endpoint {
  const [, method, path] = /^([A-Za-z]+) (\/\S*)$/.exec(spec) ?? []
  if (!method || !path) throw new Error(`endpoint spec must be "METHOD /path", got "${spec}"`)
  return { method: method.toUpperCase(), segments: path.split('/').filter(Boolean) }
}

/**
 * Whether a request is the endpoint's: the same method, the API prefix, then
 * the same number of segments, each literal one equal.
 * @param endpoint - A parsed spec.
 * @param method - The request's method.
 * @param url - The request's absolute URL.
 * @returns True when the request is for the endpoint.
 */
export function matchesEndpoint(endpoint: Endpoint, method: string, url: string): boolean {
  if (method.toUpperCase() !== endpoint.method) return false
  const { pathname } = new URL(url)
  if (!pathname.startsWith(`${API_PREFIX}/`)) return false
  const segments = pathname.slice(API_PREFIX.length).split('/').filter(Boolean)
  return (
    segments.length === endpoint.segments.length &&
    endpoint.segments.every(
      (expected, index) => expected.startsWith(':') || expected === segments[index]
    )
  )
}
