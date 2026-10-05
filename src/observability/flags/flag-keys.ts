/**
 * @file This app's slice of the express flag registry
 * (`src/constants/flags.constants.ts`): every entry with `client: true` and
 * `react` in `apps`, mirrored by hand. express-boilerplate's "Adding a flag"
 * recipe keeps the two in step; README "Feature flags" says what to copy.
 */
import type { ClientFlagDefinition } from './flag-types'

export type {
  BooleanClientFlagKey,
  ClientFlagKey,
  ClientVariantOf,
  MultivariateClientFlagKey,
} from './flag-types'

/** The flags this app reads, keyed by their registry key. */
export const CLIENT_FLAGS = {
  example_beta_page: { kind: 'boolean', fallback: false, experiment: false },
  example_cta_experiment: {
    kind: 'multivariate',
    variants: ['control', 'bold'],
    fallback: 'control',
    experiment: true,
  },
} as const satisfies Readonly<Record<string, ClientFlagDefinition>>
