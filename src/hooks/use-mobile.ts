import { useSyncExternalStore } from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/** Subscribes to changes of the mobile media query, for `useSyncExternalStore`. */
function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(MOBILE_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/** Whether the viewport is mobile right now. */
function getSnapshot(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches
}

/** The snapshot where there is no window: not mobile, so the desktop layout. */
function getServerSnapshot(): boolean {
  return false
}

/**
 * Whether the viewport is below the `md` breakpoint.
 *
 * Read during render, so the first render already has the right layout. Not
 * vendored: `shadcn add sidebar` ships its own `use-mobile.ts`, which renders
 * the desktop layout first; keep this one if a re-add offers to overwrite it.
 */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
