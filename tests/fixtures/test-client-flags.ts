/**
 * @file A stand-in for an app's `CLIENT_FLAGS`, for
 * `vi.mock('@/observability/flags/flag-keys', …)`. The flags module's tests
 * run against these keys, never an app's own slice, so the same test files
 * pass in an app whose slice is empty. `test_exp_01`…`test_exp_12` exist for
 * the exposure batch cap.
 */
import type { ClientFlagDefinition } from '@/observability/flags/flag-types'

const BATCH_EXPERIMENTS: Record<string, ClientFlagDefinition> = Object.fromEntries(
  Array.from({ length: 12 }, (_, index) => [
    `test_exp_${String(index + 1).padStart(2, '0')}`,
    { kind: 'multivariate', variants: ['control', 'test'], fallback: 'control', experiment: true },
  ])
)

/** The test registry slice: a boolean flag, an experiment and a plain multivariate flag. */
export const TEST_CLIENT_FLAGS: Readonly<Record<string, ClientFlagDefinition>> = {
  test_bool: { kind: 'boolean', fallback: false, experiment: false },
  test_exp: {
    kind: 'multivariate',
    variants: ['control', 'bold', 'calm'],
    fallback: 'control',
    experiment: true,
  },
  test_plain: { kind: 'multivariate', variants: ['a', 'b'], fallback: 'a', experiment: false },
  ...BATCH_EXPERIMENTS,
}

/**
 * A key of the test slice, typed as the app's own key type. The cast goes
 * through `unknown`, so it is legal whatever that type is, an empty slice's
 * `never` included.
 * @param key - A key of `TEST_CLIENT_FLAGS`.
 * @returns The same key.
 */
export function testFlagKey<T>(key: string): T {
  return key as unknown as T
}
