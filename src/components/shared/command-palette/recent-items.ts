/**
 * @file The palette's recent tenants and users: per user, in `localStorage`
 * under `palette.recent.v1:<userId>`, at most five of each kind, newest
 * first. An entry holds the item's kind, id, the label its page shows and when
 * it was opened, and nothing else. Every read and write survives blocked
 * storage, and a read drops any entry that fails the schema. A change of the
 * signed-in user deletes the last user's list, and a signed-in user's lists
 * are the only ones kept (`installRecentItems`).
 */
import { useMemo, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { useAuthStore } from '@/states/auth.store'
import type { RecentEntry, RecentKind } from './palette-types'
import { RECENT_KEY_PREFIX } from './recent-keys'

/** The most entries kept of each kind. */
export const RECENT_LIMIT = 5

/** The longest label or detail kept; a longer one is cut. */
const MAX_TEXT = 200

/**
 * One stored entry. Unknown keys are dropped, and a bad entry fails alone.
 * `at` is a `z.custom` and the lengths are checked after parsing, so the
 * schema uses no zod class or check the entry chunk does not already carry.
 */
const entrySchema = z.object({
  kind: z.enum(['tenant', 'user']),
  id: z.string(),
  label: z.string(),
  detail: z.string().optional(),
  at: z.custom<number>((value) => typeof value === 'number' && Number.isFinite(value)),
})

/** Whether every text in an entry is within `MAX_TEXT`, and its id is not blank. */
function withinLimits(entry: RecentEntry): boolean {
  return (
    entry.id !== '' &&
    [entry.id, entry.label, entry.detail ?? ''].every((text) => text.length <= MAX_TEXT)
  )
}

/** The key a user's list is kept under. */
function keyFor(userId: string): string {
  return `${RECENT_KEY_PREFIX}${userId}`
}

/** The stored text for a user, or null when there is none or storage is blocked. */
function readRaw(userId: string | undefined): string | null {
  if (!userId) return null
  try {
    return localStorage.getItem(keyFor(userId))
  } catch {
    return null
  }
}

/** Newest first, one entry per kind and id, at most `RECENT_LIMIT` of each kind. */
function normalize(entries: readonly RecentEntry[]): RecentEntry[] {
  const seen = new Set<string>()
  const counts: Record<RecentKind, number> = { tenant: 0, user: 0 }
  return [...entries]
    .sort((a, b) => b.at - a.at)
    .filter((entry) => {
      const key = `${entry.kind}:${entry.id}`
      if (seen.has(key) || counts[entry.kind] >= RECENT_LIMIT) return false
      seen.add(key)
      counts[entry.kind] += 1
      return true
    })
}

/** The entries in a stored text; malformed JSON is none, and each bad entry is dropped. */
function parse(raw: string | null): RecentEntry[] {
  if (raw === null) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  return normalize(
    value.flatMap((item: unknown) => {
      const result = entrySchema.safeParse(item)
      return result.success && withinLimits(result.data) ? [result.data] : []
    })
  )
}

/** Components reading the recents, told after each write here. */
const listeners = new Set<() => void>()

/** Tells every reader to read again. */
function notify(): void {
  for (const listener of listeners) listener()
}

/** Stores a user's list; blocked storage keeps nothing. */
function write(userId: string, entries: readonly RecentEntry[]): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(entries))
  } catch {
    // Storage may be blocked (private mode): the palette then has no recents.
  }
  notify()
}

/** Deletes one key; blocked storage has nothing to delete. */
function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // Nothing was stored.
  }
}

/** Deletes every recents key but `userId`'s. */
function removeOthers(userId: string): void {
  const keep = keyFor(userId)
  const stale: string[] = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key?.startsWith(RECENT_KEY_PREFIX) && key !== keep) stale.push(key)
    }
  } catch {
    return
  }
  for (const key of stale) remove(key)
}

/**
 * Puts an item at the front of a user's list, replacing an older entry for it.
 * @param userId - The signed-in user.
 * @param item - The kind, id and the label (and detail) its page shows.
 */
export function recordRecent(
  userId: string,
  item: { kind: RecentKind; id: string; label: string; detail?: string }
): void {
  const entry: RecentEntry = {
    kind: item.kind,
    id: item.id,
    label: item.label.slice(0, MAX_TEXT),
    ...(item.detail === undefined ? {} : { detail: item.detail.slice(0, MAX_TEXT) }),
    at: 0,
  }
  const others = parse(readRaw(userId)).filter(
    (old) => !(old.kind === item.kind && old.id === item.id)
  )
  // Never earlier than a stored entry, so a clock that stepped back cannot rank it last.
  entry.at = Math.max(Date.now(), ...others.map((old) => old.at + 1))
  write(userId, normalize([entry, ...others]))
}

/**
 * Removes one item from a user's list, as when its page answers 404.
 * @param userId - The signed-in user.
 * @param kind - The item's kind.
 * @param id - The item's id.
 */
export function forgetRecent(userId: string, kind: RecentKind, id: string): void {
  const entries = parse(readRaw(userId))
  const kept = entries.filter((entry) => !(entry.kind === kind && entry.id === id))
  if (kept.length !== entries.length) write(userId, kept)
}

/** Subscribes a reader to this module's writes and to other tabs' (`storage`). */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

/** The signed-in user's recent items, newest first; none when signed out. */
export function useRecentItems(): RecentEntry[] {
  const userId = useAuthStore((state) => state.user?.id)
  const raw = useSyncExternalStore(subscribe, () => readRaw(userId))
  return useMemo(() => parse(raw), [raw])
}

/** The uninstaller while installed. */
let uninstall: (() => void) | null = null

/**
 * Keeps the stored recents to the signed-in user's own. When the auth
 * store's user changes from A to anyone else or to no one, A's list is
 * deleted; while B is signed in, every other user's list is deleted, on
 * install and on each change. Idempotent; returns the cleanup.
 */
export function installRecentItems(): () => void {
  if (uninstall) return uninstall
  const signedIn = useAuthStore.getState().user?.id
  if (signedIn) removeOthers(signedIn)
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    const before = previous.user?.id
    const after = state.user?.id
    if (before === after) return
    if (before) remove(keyFor(before))
    if (after) removeOthers(after)
    notify()
  })
  uninstall = () => {
    unsubscribe()
    uninstall = null
  }
  return uninstall
}
