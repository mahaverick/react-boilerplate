/**
 * @file Whether a tab is still waiting on "Confirm it's you". The waiting tab
 * holds a shared Web Lock for as long as it waits, and the confirm page asks
 * the browser whether that lock is held. A lock dies with its tab, so a
 * closed tab can never look like it is still waiting, and no message, timer
 * or reply is needed.
 */

/** The Web Lock a tab holds, shared, while its "Confirm it's you" dialog waits. */
export const STEP_UP_WAIT_LOCK = 'step-up-wait'

/** Whether this browser has Web Locks; jsdom and some embedded browsers do not. */
function hasWebLocks(): boolean {
  return typeof navigator !== 'undefined' && 'locks' in navigator
}

/**
 * Holds the step-up wait lock until the returned function runs. Shared, so
 * two waiting tabs never queue behind each other. Release is safe to call more
 * than once, and before the browser has granted the lock.
 * @returns The release; a no-op without Web Locks.
 */
export function holdStepUpWait(): () => void {
  if (!hasWebLocks()) return () => {}
  /** Lets go of the lock; set to the held promise's resolver just below. */
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  // A refused request leaves nothing held, which the confirm page reads as no tab waiting.
  navigator.locks.request(STEP_UP_WAIT_LOCK, { mode: 'shared' }, () => held).catch(() => {})
  return release
}

/** How long the confirm page waits for the browser's lock answer before it says it cannot tell. */
export const STEP_UP_WAIT_QUERY_TIMEOUT_MS = 1_000

/**
 * Whether any tab of this app holds the step-up wait lock now.
 * @returns null without Web Locks, when the browser refuses the query, or when
 * it has not answered within `STEP_UP_WAIT_QUERY_TIMEOUT_MS`.
 */
export async function isStepUpWaitHeld(): Promise<boolean | null> {
  if (!hasWebLocks()) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  // A lock manager that never answers must not hold the confirm page on its verifying frame.
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STEP_UP_WAIT_QUERY_TIMEOUT_MS)
  })
  try {
    const answer = navigator.locks
      .query()
      .then(({ held = [] }) => held.some((lock) => lock.name === STEP_UP_WAIT_LOCK))
    return await Promise.race([answer, timeout])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
