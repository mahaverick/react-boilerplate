export declare const FAKE_FLAGS_PROJECT_KEY: 'phc_test_key_not_real'
export declare const FAKE_FLAGS_SECURE_KEY: 'phs_test_key_not_real'
export interface FakeFlagValues {
  example_beta_page: 'on' | 'off'
  example_cta_experiment: 'control' | 'bold'
}
export interface FakeFlagsRequest {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string | null
}
export interface FakeFlagsAnswer {
  status: number
  headers: Record<string, string>
  body: string
}
export interface FakeFlags {
  handle(request: FakeFlagsRequest): FakeFlagsAnswer
  values(): FakeFlagValues
}
export interface RunningFakeFlags {
  url: string
  port: number
  values(): FakeFlagValues
  close(): Promise<void>
}
export declare function createFakeFlags(options?: {
  projectKey?: string
  secureKey?: string
}): FakeFlags
export declare function startFakeFlags(options?: {
  port?: number
  projectKey?: string
  secureKey?: string
}): Promise<RunningFakeFlags>
