/** The apps a row is shared with, besides react. */
export type App = 'apex' | 'expo'

/** The shape of `shared-core.json`. */
export interface Manifest {
  /** Shared source files and the apps that hold them. */
  files: Record<string, App[]>
  /** Shared tests, fixtures and test support, and the apps that hold them. */
  tests: Record<string, App[]>
  /** Per-app modules a shared file may import, with the exports it may take. */
  ports: Record<string, string[]>
  /** Per-app modules only a shared test may import, with their exports. */
  testPorts: Record<string, string[]>
  /** Specifiers a shared test may import although the check would refuse them. */
  exemptions: Record<string, string[]>
}

/** One problem, printed as `file:line: reason`. */
export interface Finding {
  file: string
  line: number
  reason: string
}

/**
 * Check every row shared with expo and, with `app`, every row shared with that
 * app too, under the same rules.
 */
export declare function checkShared(options?: {
  root?: string
  manifest?: string
  app?: string
  docs?: string
}): Finding[]
