// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { checkShared, type Finding, type Manifest } from '../../../scripts/check-shared.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A temporary repo holding `files` and a `shared-core.json` built from `manifest`.
 * @param files - Repo-relative path to contents.
 * @param manifest - The manifest's sections; missing ones are empty.
 * @returns The repo root.
 */
function tree(files: Record<string, string>, manifest: Partial<Manifest>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'check-shared-'))
  roots.push(root)
  const full: Manifest = {
    files: {},
    tests: {},
    ports: {},
    testPorts: {},
    exemptions: {},
    ...manifest,
  }
  for (const [relative, text] of Object.entries({
    ...files,
    'shared-core.json': JSON.stringify(full, null, 2),
  })) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    writeFileSync(path.join(root, relative), text)
  }
  return root
}

/**
 * The check's findings for one shared file, as `path:line: reason` strings.
 * @param text - The shared file's contents.
 * @param extra - Other files in the repo.
 * @param manifest - More manifest sections.
 * @returns The findings.
 */
function checkOne(
  text: string,
  extra: Record<string, string> = {},
  manifest: Partial<Manifest> = {}
): string[] {
  const root = tree(
    { 'src/lib/shared.ts': text, ...extra },
    { ...manifest, files: { 'src/lib/shared.ts': ['expo'], ...manifest.files } }
  )
  return checkShared({ root }).map(format)
}

/**
 * One finding as the CLI prints it.
 * @param finding - The finding.
 * @returns `path:line: reason`.
 */
function format(finding: Finding): string {
  return `${finding.file}:${finding.line}: ${finding.reason}`
}

/** A test port that re-exports the runner functions. */
const RUNNER_PORT = {
  'tests/support/runner.ts': ['describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach'],
}

describe('checkShared', () => {
  it('refuses window in a shared file', () => {
    expect(checkOne('export const width = 1\nexport const w = window.innerWidth\n')).toEqual([
      'src/lib/shared.ts:2: uses the browser global window',
    ])
  })

  it('allows window inside a comment or a string', () => {
    expect(
      checkOne('// window.location is the browser’s\n/** window */\nexport const s = "window"\n')
    ).toEqual([])
  })

  it('allows location as a property name or a destructured key', () => {
    const text = [
      'interface Moved { location?: string }',
      'export const a = (e: { headers: { location: string } }) => e.headers.location',
      'export const b = { location: 1 }',
      'export const c = ({ location }: Moved) => location',
      'export const d = (m: Moved) => { const { location: where } = m; return where }',
      'export type E = Moved',
    ].join('\n')
    expect(checkOne(text)).toEqual([])
  })

  it('allows a parameter or local variable named location', () => {
    const text = [
      'export function f(location: string) { return location }',
      'export function g() { const location = 1; return location }',
      'export function h() { return { location } }',
    ].join('\n')
    expect(checkOne(text)).toEqual(['src/lib/shared.ts:3: uses the browser global location'])
  })

  it('refuses import.meta.env', () => {
    expect(checkOne('export const dev = import.meta.env.DEV\n')).toEqual([
      'src/lib/shared.ts:1: uses import.meta.env',
    ])
  })

  it('refuses a banned package', () => {
    expect(
      checkOne("import posthog from 'posthog-js'\nimport { x } from '@tanstack/react-router'\n")
    ).toEqual([
      'src/lib/shared.ts:1: imports posthog-js, which is banned in a shared file',
      'src/lib/shared.ts:2: imports @tanstack/react-router, which is banned in a shared file',
    ])
  })

  it('refuses an @/components import', () => {
    expect(
      checkOne("import { Button } from '@/components/ui/button'\n", {
        'src/components/ui/button.tsx': 'export const Button = 1\n',
      })
    ).toEqual([
      'src/lib/shared.ts:1: imports @/components/ui/button, which is banned in a shared file',
    ])
  })

  it('refuses an import of a file that is neither shared nor a port', () => {
    const extra = {
      'src/lib/other.ts': 'export const other = 1\n',
      'src/lib/also.ts': 'export const also = 1\n',
      'src/observability/telemetry/index.ts': 'export const track = 1\n',
    }
    const text = [
      "import { other } from '@/lib/other'",
      "import { also } from './also'",
      "import { track } from '@/observability/telemetry'",
      'export const all = [other, also, track]',
    ].join('\n')
    expect(
      checkOne(text, extra, {
        files: { 'src/lib/also.ts': ['expo'] },
        ports: { 'src/observability/telemetry/index.ts': ['track'] },
      })
    ).toEqual(['src/lib/shared.ts:1: imports @/lib/other, which is neither shared nor a port'])
  })

  it('refuses an export a port does not declare', () => {
    const text = [
      "import { apiClient, type Secret, refresh } from '@/http/client'",
      'export const all: Secret = [apiClient, refresh]',
    ].join('\n')
    expect(
      checkOne(
        text,
        { 'src/http/client.ts': 'export const apiClient = 1\n' },
        { ports: { 'src/http/client.ts': ['apiClient', 'unwrap'] } }
      )
    ).toEqual([
      'src/lib/shared.ts:1: imports Secret from the port src/http/client.ts, which does not declare it',
      'src/lib/shared.ts:1: imports refresh from the port src/http/client.ts, which does not declare it',
    ])
  })

  it('refuses vi in a shared test', () => {
    const root = tree(
      {
        'tests/unit/a.test.ts': [
          "import { expect, it } from '@/tests/support/runner'",
          "it('a', () => { const spy = vi.fn(); expect(spy).toBeDefined() })",
        ].join('\n'),
        'tests/support/runner.ts': '',
      },
      { tests: { 'tests/unit/a.test.ts': ['expo'] }, testPorts: RUNNER_PORT }
    )
    expect(checkShared({ root }).map(format)).toEqual([
      'tests/unit/a.test.ts:2: uses vi, which a shared test may not',
    ])
  })

  it('refuses node:fs in a shared test unless exempt', () => {
    const text = "import { readFileSync } from 'node:fs'\nexport const r = readFileSync\n"
    const root = tree(
      { 'tests/unit/a.test.ts': text, 'tests/unit/b.test.ts': text },
      {
        tests: { 'tests/unit/a.test.ts': ['expo'], 'tests/unit/b.test.ts': ['expo'] },
        exemptions: { 'tests/unit/b.test.ts': ['node:fs'] },
      }
    )
    expect(checkShared({ root }).map(format)).toEqual([
      'tests/unit/a.test.ts:1: imports node:fs, which a shared test may not',
    ])
  })

  it('refuses a shared test importing vite-plus/test directly', () => {
    const root = tree(
      { 'tests/unit/a.test.ts': "import { it } from 'vite-plus/test'\nit('a', () => {})\n" },
      { tests: { 'tests/unit/a.test.ts': ['expo'] } }
    )
    expect(checkShared({ root }).map(format)).toEqual([
      'tests/unit/a.test.ts:1: imports vite-plus/test; a shared test takes its runner from @/tests/support/runner',
    ])
  })

  it('reports a manifest path missing from the docs table, and a table row missing from the manifest', () => {
    const docs = [
      '# Architecture',
      '',
      '| Path | apex | expo |',
      '| --- | --- | --- |',
      '| `src/lib/shared.ts` | yes | yes |',
      '| `src/lib/gone.ts` | | yes |',
      '',
    ].join('\n')
    const root = tree(
      {
        'src/lib/shared.ts': 'export const a = 1\n',
        'src/lib/more.ts': 'export const b = 1\n',
        'ARCHITECTURE.md': docs,
      },
      { files: { 'src/lib/shared.ts': ['apex', 'expo'], 'src/lib/more.ts': ['expo'] } }
    )
    expect(checkShared({ root, docs: 'ARCHITECTURE.md' }).map(format)).toEqual([
      'ARCHITECTURE.md:3: src/lib/more.ts is in shared-core.json but not in the table',
      'ARCHITECTURE.md:6: src/lib/gone.ts is in the table but not in shared-core.json',
    ])
  })
})
