import { useEffect, useState } from 'react'

/** How often the countdown moves: once a second, the finest a "0:42" clock shows. */
export const COUNTDOWN_TICK_MS = 1_000

/** Whole seconds until `until`, rounded up; 0 for a past time or one that is not a number. */
function secondsUntil(until: number | null): number {
  if (until === null || !Number.isFinite(until)) return 0
  return Math.max(0, Math.ceil((until - Date.now()) / COUNTDOWN_TICK_MS))
}

/**
 * The whole seconds left until the epoch-ms `until`, rounded up, and 0 for
 * `null` or a time that has passed. It re-renders every second only while
 * time is left, so a finished countdown holds no timer.
 * @param until - The epoch-ms time the countdown ends, or `null` for none.
 */
export function useCountdown(until: number | null): number {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (secondsUntil(until) === 0) return
    const timer = setInterval(() => {
      setTick((tick) => tick + 1)
      if (secondsUntil(until) === 0) clearInterval(timer)
    }, COUNTDOWN_TICK_MS)
    return () => {
      clearInterval(timer)
    }
  }, [until])

  return secondsUntil(until)
}
