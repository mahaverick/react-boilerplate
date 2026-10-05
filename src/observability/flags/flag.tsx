import type { ReactNode } from 'react'
import { useFlagValue } from './flag-hooks'
import type { BooleanClientFlagKey, ClientVariantOf, MultivariateClientFlagKey } from './flag-types'

/** A boolean flag: the children render while it is on. */
interface BooleanFlagProps {
  name: BooleanClientFlagKey
  variant?: undefined
  children: ReactNode
}

/** A multivariate flag: the children render while it is at `variant`. */
interface VariantFlagProps<K extends MultivariateClientFlagKey> {
  name: K
  variant: ClientVariantOf<K>
  children: ReactNode
}

/** A boolean flag's name alone, or a multivariate flag's name with a variant. */
export type FlagProps = BooleanFlagProps | VariantFlagProps<MultivariateClientFlagKey>

/**
 * Renders its children only when a boolean flag is on, or when a
 * multivariate flag is at `variant`. Renders nothing for the fallback while
 * the flags load, and reports an experiment's exposure like `useVariant`.
 */
export function Flag(props: FlagProps) {
  const value = useFlagValue(props.name)
  const isShown = props.variant === undefined ? value === true : value === props.variant
  return isShown ? props.children : null
}
