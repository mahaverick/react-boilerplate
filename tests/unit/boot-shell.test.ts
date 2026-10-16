// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * index.html's boot shell: its inline colour copies match globals.css in both
 * themes, so the first paint is the theme the app then draws, and the inline
 * CSS plus markup stays small enough to cost the first paint nothing.
 */

const ROOT = path.resolve(import.meta.dirname, '../..')
const HTML = readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const CSS = readFileSync(path.join(ROOT, 'src/styles/globals.css'), 'utf8')

/** The colours the shell paints with; each must equal globals.css's value in both themes. */
const COLOURS = ['background', 'card', 'muted', 'border', 'sidebar', 'sidebar-border'] as const

/** The inline budget, in bytes after whitespace runs are collapsed (prettier's indentation is not the budget's concern). */
const BUDGET_BYTES = 4096

/** The text of `<style id="<id>">…</style>` in index.html. */
function styleBlock(id: string): string {
  const match = new RegExp(`<style id="${id}">([\\s\\S]*?)</style>`).exec(HTML)
  expect(match, `index.html has <style id="${id}">`).not.toBeNull()
  return match?.[1] ?? ''
}

/** The `--name: value` declarations of the first `<selector> { … }` rule in `css`. */
function declarations(css: string, selector: ':root' | '.dark'): Map<string, string> {
  const escaped = selector.replace('.', '\\.')
  const body = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? ''
  const pairs = [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)]
  return new Map(pairs.map((pair) => [pair[1] ?? '', (pair[2] ?? '').trim()]))
}

/** `#root`'s markup in index.html. */
function rootMarkup(): string {
  const match = /<div id="root">([\s\S]*?)<\/div>\s*<script type="module"/.exec(HTML)
  expect(match, 'index.html has #root before the module script').not.toBeNull()
  return match?.[1] ?? ''
}

describe('the boot shell', () => {
  it.each([':root', '.dark'] as const)(
    'copies every colour it paints from globals.css (%s)',
    (selector) => {
      const inline = declarations(styleBlock('boot-tokens'), selector)
      const source = declarations(CSS, selector)
      for (const name of COLOURS) {
        expect(inline.get(name), `--${name} in index.html ${selector}`).toBeDefined()
        expect(inline.get(name), `--${name} matches globals.css ${selector}`).toBe(source.get(name))
      }
    }
  )

  it('paints only colours it copied', () => {
    const used = [...styleBlock('boot-shell').matchAll(/var\(--([\w-]+)\)/g)].map((m) => m[1])
    const declared = new Set(declarations(styleBlock('boot-tokens'), ':root').keys())
    expect(used.filter((name) => !declared.has(name ?? ''))).toEqual([])
  })

  it('sizes its boxes as border-box, as the stylesheet does, so the dev shell does not resize when it lands', () => {
    expect(styleBlock('boot-shell')).toMatch(/\.boot-shell \*\s*\{\s*box-sizing:\s*border-box/)
  })

  it('stays within the inline budget', () => {
    const shipped = [styleBlock('boot-tokens'), styleBlock('boot-shell'), rootMarkup()]
      .join('')
      .replace(/\s+/g, ' ')
    expect(new TextEncoder().encode(shipped).length).toBeLessThan(BUDGET_BYTES)
  })

  it('announces itself as loading without the router pending screen’s label', () => {
    const markup = rootMarkup()
    expect(markup).toMatch(/<div class="boot-shell" role="status">/)
    expect(markup).toContain('<span class="boot-sr">Loading…</span>')
    expect(markup).not.toContain('aria-label="Loading"')
  })
})
