/**
 * @file The runner port: the only module a shared test takes its test
 * functions from, so the same test runs under Vitest here and in apex, and
 * under Jest in expo, which writes its own copy of this file.
 */
import path from 'node:path'

export { afterEach, beforeEach, describe, expect, it, test } from 'vite-plus/test'

/** The repo's absolute path. */
export const repoRoot = path.resolve(import.meta.dirname, '../..')

/**
 * The directories `copy-style.test.ts` scans, relative to `repoRoot`. Expo adds
 * `src/components/ui`, which it writes itself.
 */
export const copyStyleRoots: readonly string[] = ['src']
