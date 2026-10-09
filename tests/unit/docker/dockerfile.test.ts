// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The Dockerfile's layer order, read from the file: an ARG is part of every
 * later RUN's cache key, so where it is declared decides what a change to it
 * rebuilds.
 */

const LINES = readFileSync(path.resolve(import.meta.dirname, '../../../Dockerfile'), 'utf8').split(
  '\n'
)

/**
 * The index of the one line starting with `prefix`.
 * @param prefix - The start of the line.
 * @returns Its zero-based line index.
 */
function lineOf(prefix: string): number {
  const found = LINES.flatMap((line, index) => (line.startsWith(prefix) ? [index] : []))
  expect(found, `one line starts with ${prefix}`).toHaveLength(1)
  return found[0]!
}

describe('Dockerfile', () => {
  it.each(['ARG POSTHOG_SOURCEMAP_PROJECTS', 'ARG POSTHOG_CLI_HOST'])(
    'declares %s after the build and inject, so changing it re-runs only the upload and the map deletion',
    (arg) => {
      const declared = lineOf(arg)
      expect(declared).toBeGreaterThan(lineOf('RUN pnpm build'))
      expect(declared).toBeGreaterThan(lineOf('    pnpm exec posthog-cli sourcemap inject'))
      expect(declared).toBeLessThan(lineOf('    sh docker/upload-sourcemaps.sh'))
      const stageEnd = LINES.findIndex(
        (line, index) => index > declared && line.startsWith('FROM ')
      )
      const laterRuns = LINES.slice(declared, stageEnd).filter((line) => line.startsWith('RUN '))
      expect(laterRuns).toEqual([
        'RUN --mount=type=secret,id=posthog_cli_token,required=false \\',
        "RUN find dist -name '*.map' -delete",
      ])
    }
  )
})
