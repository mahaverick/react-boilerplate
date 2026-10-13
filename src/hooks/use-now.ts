import { useSyncExternalStore } from 'react'

/** How often the shared clock moves: fine enough for "minutes ago", coarse enough to be free. */
export const NOW_TICK_MS = 30_000

let now = Date.now()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | undefined

/** Joins the shared clock, starting it for the first reader and stopping it after the last. */
function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (timer === undefined) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const listener of listeners) listener()
    }, NOW_TICK_MS)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
  }
}

/**
 * The clock's last reading, stable between ticks as `useSyncExternalStore`
 * requires. A first render may see an old reading; `subscribe` refreshes it,
 * and React re-checks the snapshot after subscribing, so it re-renders at once.
 */
function getSnapshot(): number {
  return now
}

/**
 * The current time, re-rendering the reader every {@link NOW_TICK_MS}. One
 * interval serves every reader, so a list of relative times costs one timer.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
