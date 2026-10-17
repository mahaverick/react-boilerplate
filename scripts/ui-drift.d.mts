/** One drift rule: a skip marker, a rewrite of our lines or the registry's, or a recorded hunk. */
export type Rule =
  | { side: 'skip' }
  | { side: 'ours' | 'theirs'; pattern: RegExp; replacement: string }
  | { side: 'hunk'; reason: string; theirs: string[]; ours: string[] }
/** A hunk's registry lines and ours. */
export interface Change {
  ours: string[]
  theirs: string[]
}
/** A hunk of the diff from the registry to ours, `at` its first registry line (1-based). */
export interface Hunk extends Change {
  at: number
}
export const SHADCN: string
export function parseRules(markdown: string): Map<string, Rule[]>
export function viewContent(output: string, target: string): string | null
export function diffLines(theirs: string[], ours: string[]): Hunk[]
export function unrecorded(change: Change, rules: Rule[]): Change
export function checkFile(
  ours: string,
  theirs: string,
  rules: Rule[]
): { drift: Hunk[]; stale: Extract<Rule, { side: 'hunk' }>[] }
export function formatDrift(file: string, hunk: Hunk): string[]
