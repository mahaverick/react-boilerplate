import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const ROOT = path.resolve(import.meta.dirname, '../..')
const DOCS = path.join(ROOT, 'docs/pages')
const IMG = path.join(DOCS, 'img')
/** The inventory's screenshot budget. */
const MAX_IMG_BYTES = 10 * 1024 * 1024

/** The full paths in the generated route tree's `FileRoutesByFullPath`. */
function routePaths(): string[] {
  const tree = readFileSync(path.join(ROOT, 'src/routeTree.gen.ts'), 'utf8')
  const block = /export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/.exec(tree)?.[1] ?? ''
  return [...block.matchAll(/'([^']+)':/g)].flatMap((match) => match[1] ?? [])
}

/** Every file under `dir`, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  )
}

describe('docs/pages', () => {
  const markdown = filesUnder(DOCS)
    .filter((file) => file.endsWith('.md'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')

  it('lists every route of the route tree in README.md', () => {
    const readme = readFileSync(path.join(DOCS, 'README.md'), 'utf8')
    const paths = routePaths()
    expect(paths.length).toBeGreaterThan(10)
    expect(paths.filter((route) => !readme.includes(`\`${route}\``))).toEqual([])
  })

  it('links every screenshot from some page doc', () => {
    const orphans = filesUnder(IMG)
      .map((file) => path.relative(DOCS, file))
      .filter((file) => !markdown.includes(file))
    expect(orphans).toEqual([])
  })

  it(`keeps the screenshots under ${MAX_IMG_BYTES} bytes`, () => {
    const total = filesUnder(IMG).reduce((sum, file) => sum + statSync(file).size, 0)
    expect(total).toBeLessThanOrEqual(MAX_IMG_BYTES)
  })
})
