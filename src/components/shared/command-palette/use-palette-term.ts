import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cleanSearch } from '@/schemas/list-request.schemas'
import { useCommandPaletteStore } from '@/states/command-palette.store'
import { LIST_SEARCH_DEBOUNCE_MS } from '@/types/list.types'

/** The palette's typed term, cleaned, and the same term once typing has paused. */
export interface PaletteTerm {
  /** What is typed now, as `cleanSearch` leaves it. */
  current: string
  /** `current` once it has stood for `LIST_SEARCH_DEBOUNCE_MS`. */
  term: string
  /** Whether a search for `term` should run: it is not blank and is what is typed. */
  ready: boolean
}

/** The term a palette search asks the API for, and whether to ask. */
export function usePaletteTerm(): PaletteTerm {
  const query = useCommandPaletteStore((state) => state.query)
  const current = cleanSearch(query)
  const term = useDebouncedValue(current, LIST_SEARCH_DEBOUNCE_MS)
  return { current, term, ready: term !== '' && term === current }
}
