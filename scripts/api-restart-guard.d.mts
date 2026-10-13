export declare function explicitPortOf(origin: string): string | null
export declare function restartPlan(input: {
  origin: string
  allowRestart: string | undefined
  apiDir: string | undefined
  mainCheckout: string
  realpath: (path: string) => string
  isFile: (path: string) => boolean
}): { refusal: string } | { port: string; dir: string }
export declare function apiDirPlan(input: {
  apiDir: string | undefined
  mainCheckout: string
  realpath: (path: string) => string
  isFile: (path: string) => boolean
  who: string
  does: string
}): { refusal: string } | { dir: string }
export declare function grantDirPlan(input: {
  apiDir: string | undefined
  realpath: (path: string) => string
  readJson: (path: string) => { scripts?: unknown } | null
}): { refusal: string } | { dir: string }
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
export interface PsProcess {
  pid: number
  pgid: number
  tty: string
  lstart: string
  command: string
}
export interface ProcessInfo extends PsProcess {
  cwd: string | null
}
export interface RecordedServer {
  pid: number
  lstart: string
}
export interface StopTarget {
  id: number
  pid: number
  kind: 'supervisor' | 'leader' | 'member'
  lstart: string
}
export interface Supervisor {
  pid: number
  lstart: string
}
export declare function parsePsLine(line: string | null): PsProcess | null
export declare function formatPidFile(pid: number, lstart: string | null): string
export declare function parsePidFile(text: string | null): RecordedServer | null
export declare function isTsxWatch(command: string | null): boolean
export declare function isPnpmDev(command: string | null): boolean
export declare function isTsxServer(command: string | null): boolean
export declare function isShell(command: string | null): boolean
export declare function hasNoTty(tty: string | null): boolean
export declare function isSupervisor(info: ProcessInfo | null, dir: string): boolean
export declare function isRecordedLeader(
  info: ProcessInfo | null,
  recorded: RecordedServer,
  dir: string
): boolean
export declare function isRecordedMember(
  info: ProcessInfo | null,
  recorded: RecordedServer,
  dir: string
): boolean
export declare function supervisorsToStop(input: {
  pids: number[]
  dir: string
  parentOf: (pid: number) => Promise<number | null>
  infoOf: (pid: number) => Promise<ProcessInfo | null>
}): Promise<Supervisor[]>
export declare function isPidHeld(pid: number, kill: (pid: number, signal: 0) => unknown): boolean
export declare function stopTargets(input: {
  supervisors: Supervisor[]
  recorded: RecordedServer | null
  leader: ProcessInfo | null
  held: boolean
  members: ProcessInfo[]
  dir: string
}): StopTarget[]
export declare function isStillTarget(
  target: StopTarget,
  info: ProcessInfo | null,
  recorded: RecordedServer | null,
  dir: string,
  held: boolean
): boolean
export declare function stopInside(input: {
  targets: StopTarget[]
  recorded: RecordedServer | null
  dir: string
  infoOf: (pid: number) => Promise<ProcessInfo | null>
  pidHeld: (pid: number) => boolean
  signal: (id: number, name: 'SIGTERM' | 'SIGKILL') => void
  goneWithin: (ids: number[], ms: number) => Promise<boolean>
}): Promise<void>
