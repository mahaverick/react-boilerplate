/** A recorded hunk: its reason, optional anchors, the registry's lines and ours. */
export interface HunkRule {
  side: 'hunk'
  reason: string
  at?: number
  context?: string
  theirs: string[]
  ours: string[]
}
/** One drift rule: a skip marker, a rewrite of our lines or the registry's, or a recorded hunk. */
export type Rule =
  { side: 'skip' } | { side: 'ours' | 'theirs'; pattern: RegExp; replacement: string } | HunkRule
/** A hunk's registry lines and ours. */
export interface Change {
  ours: string[]
  theirs: string[]
}
/** A hunk of the diff from the registry to ours: its first registry line (1-based) and context. */
export interface Hunk extends Change {
  at: number
  context?: string
}
/** What the snapshot must have been taken with. */
export interface Manifest {
  shadcn: string | null
  style: string | null
  iconLibrary: string | null
}
/** The CLI calls refresh makes. */
export interface Cli {
  version: () => string
  view: (name: string, file: string) => string
}
export const PLACEHOLDER_REASON: string
/** A record the check cannot read. */
export class RecordError extends Error {}
export function parseRules(markdown: string): Map<string, Rule[]>
export function viewContent(output: string, file: string): string | null
export function diffLines(theirs: string[], ours: string[]): Hunk[]
export function unrecorded(change: Change, rules: Rule[]): Change
export function checkFile(
  ours: string,
  theirs: string,
  rules: Rule[]
): { drift: Hunk[]; stale: HunkRule[] }
export function formatDrift(file: string, hunk: Hunk): string[]
export function expectedManifest(root: string): Manifest
export function refresh(root: string, cli?: Cli): string[]
export function check(root: string): { passed: string[]; problems: string[] }
