/** One drift rule: a skip marker, or a rewrite of our lines or the registry's. */
export type Rule =
  { side: 'skip' } | { side: 'ours' | 'theirs'; pattern: RegExp; replacement: string }
/** Our changed lines and the registry's. */
export interface Change {
  ours: string[]
  theirs: string[]
}
export const SHADCN: string
export function parseRules(markdown: string): Map<string, Rule[]>
export function hasSection(output: string, target: string): boolean
export function changedLines(output: string, target?: string): Change
export function unrecorded(change: Change, rules: Rule[]): Change
