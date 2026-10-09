// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * docker/nginx.main.conf's connection sizing, read from the file the image
 * ships. nginx running out of connections stops answering pages and API calls
 * too, so it must hold every stream the API behind it accepts before refusing.
 */

const CONF = readFileSync(
  path.resolve(import.meta.dirname, '../../../docker/nginx.main.conf'),
  'utf8'
)

/** express's default `SSE_MAX_STREAMS_TOTAL`, the streams one API process holds. */
const API_STREAMS_PER_PROCESS = 2000
/** Connection slots left for pages, API calls and keep-alives beside the streams. */
const HEADROOM = 1024

/**
 * The one numeric value of directive `name`.
 * @param name - The nginx directive.
 * @returns Its value.
 */
function directive(name: string): number {
  const matches = [...CONF.matchAll(new RegExp(`^\\s*${name}\\s+(\\d+)\\s*;`, 'gm'))]
  expect(matches, `${name} is set exactly once`).toHaveLength(1)
  return Number(matches[0]![1])
}

describe('docker/nginx.main.conf', () => {
  it('holds one API process of streams, two connections each, in one worker, with headroom', () => {
    expect(directive('worker_connections')).toBeGreaterThanOrEqual(
      2 * API_STREAMS_PER_PROCESS + HEADROOM
    )
  })

  it('allows two file descriptors for every connection slot', () => {
    expect(directive('worker_rlimit_nofile')).toBeGreaterThanOrEqual(
      2 * directive('worker_connections')
    )
  })
})
