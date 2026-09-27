/**
 * A deliberate real-time wait, for the rare case no condition can replace:
 * a negative check with no barrier event, a poll interval, injected latency.
 * `reason` names what cannot be observed instead; a blank one rejects, and
 * an empty literal fails typecheck.
 *
 * This file and `e2e/timing.ts` are the only files the lint ban on bare
 * sleeps exempts.
 */
export async function settle<R extends string>(
  ms: number,
  reason: R & (R extends '' ? never : unknown)
): Promise<void> {
  if (reason.trim() === '') {
    throw new Error('settle() needs a reason: name what the wait stands in for')
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
