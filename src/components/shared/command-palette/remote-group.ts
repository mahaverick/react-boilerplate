import { isRoleDenied } from '@/lib/role-denied'
import type { PaletteCommand, PaletteGroupId, RemoteGroup } from './palette-types'

/** The parts of a `useQuery` result a search group reads. */
export interface RemoteQuery<T> {
  data: T | undefined
  isFetching: boolean
  /** True when `data` belongs to an earlier key (`placeholderData`). */
  isPlaceholderData?: boolean
  isError: boolean
  error: unknown
  refetch: () => unknown
}

/**
 * One API search as a palette group. Its rows show only for the term they
 * were fetched for, unless a background refetch of that same term is the only thing fetching, so Enter never acts on an
 * older term's list. A failure is reported only once `term` is what is
 * typed, and a role refusal (`isRoleDenied`) never.
 * @param input - The group, whether this search runs at all for the caller,
 *   the typed and debounced terms, the query, and how its data becomes rows.
 * @returns The group, with `searching`, `failed` and `retry`.
 */
export function remoteGroup<T>({
  id,
  label,
  enabled,
  current,
  term,
  query,
  toCommands,
}: {
  id: PaletteGroupId
  label?: string
  /** False when the caller may not search this at all (not staff). */
  enabled: boolean
  current: string
  term: string
  query: RemoteQuery<T>
  toCommands: (data: T) => readonly PaletteCommand[]
}): RemoteGroup {
  const active = enabled && current !== ''
  const settled = !query.isFetching || (query.data !== undefined && !query.isPlaceholderData)
  const fresh = term === current && settled
  const commands = active && fresh && query.data !== undefined ? toCommands(query.data) : []
  return {
    group: { id, label, commands },
    searching: active && (term !== current || !settled),
    failed: active && fresh && query.isError && !isRoleDenied(query.error),
    retry: () => void query.refetch(),
  }
}
