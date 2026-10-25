import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'

/** axe-core's browser build, injected into the page under test. */
const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

/** What an axe run found: each violation as `rule: targets`, and the ids of the rules that passed. */
export interface AxeFindings {
  violations: string[]
  passes: string[]
}

/**
 * Runs every axe rule in the page, over `selector`'s first match or the whole
 * document. In a real browser, unlike jsdom, axe evaluates the page-level
 * rules and colour contrast; this checks the light theme only, and the
 * `contrast` project checks both.
 * @param page - A page that has rendered what is under test.
 * @param selector - Narrows the run to one element, such as an open dialog.
 * @returns The violations and the passed rules.
 */
export async function runAxe(page: Page, selector?: string): Promise<AxeFindings> {
  await page.addScriptTag({ path: AXE_PATH })
  return page.evaluate(async (scope) => {
    /** The slice of axe's run result this reads. */
    type AxeRun = {
      violations: { id: string; nodes: { target: string[] }[] }[]
      passes: { id: string }[]
    }
    const axe = (
      window as unknown as {
        axe: { run: (context: Element | Document, options: unknown) => Promise<AxeRun> }
      }
    ).axe
    const context = scope === undefined ? document : document.querySelector(scope)
    if (context === null) throw new Error(`axe: nothing matches ${String(scope)}`)
    const run = await axe.run(context, {})
    return {
      violations: run.violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`
      ),
      passes: run.passes.map((pass) => pass.id),
    }
  }, selector)
}
