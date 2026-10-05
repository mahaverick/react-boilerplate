/**
 * @file A counter of the calls that change who an event belongs to. It is its
 * own module so the entry-chunk error listener can read it without importing
 * the analytics facade; the facade bumps it and re-exports `identityEpoch`.
 */
let epoch = 0

/**
 * A number that changes, at the moment of the call and not when the SDK gets
 * to the queued command, whenever the user, the tenant group or the tab's
 * standing changes: sign-in, sign-out, a forgotten identity, a tenant group
 * set or cleared, a supersession. A caller that read it when something
 * happened and finds it unchanged later knows the identity read since still
 * belongs to that moment.
 * @returns The current epoch.
 */
export function identityEpoch(): number {
  return epoch
}

/** Marks that who an event belongs to just changed. */
export function bumpIdentityEpoch(): void {
  epoch += 1
}
