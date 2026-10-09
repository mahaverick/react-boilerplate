export declare const DEV_API_PORT: string
export declare function portOf(origin: string): string
export declare function restartRefusal(input: {
  origin: string
  allowRestart: string | undefined
  apiDir: string | undefined
  mainCheckout: string
  realpath: (path: string) => string
  isFile: (path: string) => boolean
}): string | null
export declare function respawnOptions(
  apiDir: string,
  port: string,
  env: Record<string, string | undefined>
): {
  cwd: string
  detached: true
  stdio: 'ignore'
  env: Record<string, string | undefined>
}
