export declare function explicitPortOf(origin: string): string | null
export declare function restartPlan(input: {
  origin: string
  allowRestart: string | undefined
  apiDir: string | undefined
  mainCheckout: string
  realpath: (path: string) => string
  isFile: (path: string) => boolean
}): { refusal: string } | { port: string; dir: string }
export declare function cwdFromLsofFields(output: string): string | null
export declare function isWithin(cwd: string | null, dir: string): boolean
export declare function stopListenersIn(input: {
  port: string
  dir: string
  listeningPids: (port: string) => Promise<number[]>
  cwdOf: (pid: number) => Promise<string | null>
  signal: (pid: number, name: 'SIGTERM' | 'SIGKILL') => void
  freedWithin: (ms: number) => Promise<boolean>
}): Promise<void>
export declare function respawnOptions(
  dir: string,
  port: string,
  env: Record<string, string | undefined>
): {
  cwd: string
  detached: true
  stdio: 'ignore'
  env: Record<string, string | undefined>
}
export declare function restartedPidFile(tmpdir: string, port: string): string
export declare function parseRecordedPid(text: string | null): number | null
export declare function recordedServerToStop(input: {
  recorded: string | null
  dir: string
  isAlive: (pid: number) => boolean
  cwdOf: (pid: number) => Promise<string | null>
}): Promise<number | null>
export declare function isTsxWatch(command: string | null): boolean
export declare function supervisorsToStop(input: {
  pids: number[]
  dir: string
  parentOf: (pid: number) => Promise<number | null>
  commandOf: (pid: number) => Promise<string | null>
  cwdOf: (pid: number) => Promise<string | null>
}): Promise<number[]>
export declare function stopInside(input: {
  targets: { pid: number; group: boolean }[]
  dir: string
  isAlive: (id: number) => boolean
  cwdOf: (pid: number) => Promise<string | null>
  signal: (id: number, name: 'SIGTERM' | 'SIGKILL') => void
  goneWithin: (ids: number[], ms: number) => Promise<boolean>
}): Promise<void>
