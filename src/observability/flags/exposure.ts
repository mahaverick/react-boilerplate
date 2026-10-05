/**
 * @file Experiment exposure, reported to express, which re-evaluates each key
 * and records `$feature_flag_called` itself, only for a user who matched a
 * release condition or is in the holdout: the browser sends keys, never
 * values. Reports are batched, deduped per tab session and independent of
 * analytics consent; a failed report is dropped, never retried.
 */
import { apiClient } from '@/http/client'
import { flagScopeId } from './flag-query'
import { flagsPathFor, type FlagScope } from './flag-scope'
import type { ClientFlagKey } from './flag-types'

/** How long reports gather before one POST per scope carries them. */
export const EXPOSURE_BATCH_MS = 50

/** The most keys one exposure POST carries; the endpoint refuses more. */
export const MAX_EXPOSURE_KEYS = 10

/** The `sessionStorage` key prefix marking a scope, key and value as reported. */
export const EXPOSURE_DEDUPE_PREFIX = 'ph_flag_exp:'

interface PendingBatch {
  scope: FlagScope
  keys: Set<string>
}

/** Reported marks, kept here too so a tab without `sessionStorage` still dedupes. */
const reported = new Set<string>()
const pending = new Map<string, PendingBatch>()
let flushTimer: ReturnType<typeof setTimeout> | null = null

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function isReported(mark: string): boolean {
  if (reported.has(mark)) return true
  try {
    const store = sessionStore()
    return store !== null && store.getItem(mark) !== null
  } catch {
    return false
  }
}

function markReported(mark: string): void {
  reported.add(mark)
  try {
    sessionStore()?.setItem(mark, '1')
  } catch {
    // Storage is best effort: the in-memory mark still dedupes this tab.
  }
}

function flush(): void {
  flushTimer = null
  const batches = [...pending.values()]
  pending.clear()
  for (const { scope, keys } of batches) {
    const all = [...keys]
    for (let start = 0; start < all.length; start += MAX_EXPOSURE_KEYS) {
      apiClient
        .post(`${flagsPathFor(scope)}/exposures`, {
          keys: all.slice(start, start + MAX_EXPOSURE_KEYS),
        })
        .catch(() => undefined)
    }
  }
}

/**
 * Reports that the page used an experiment flag's value. The first report of
 * a scope, key and value in this tab session joins a batch sent
 * `EXPOSURE_BATCH_MS` later; every later one is dropped.
 * @param scope - The scope the value was read in, which picks the endpoint.
 * @param key - An experiment flag.
 * @param value - The value the page used, part of the dedupe mark only.
 */
export function reportExposure(
  scope: FlagScope,
  key: ClientFlagKey,
  value: boolean | string
): void {
  const scopeId = flagScopeId(scope)
  const name: string = key
  const mark = `${EXPOSURE_DEDUPE_PREFIX}${scopeId}:${name}:${String(value)}`
  if (isReported(mark)) return
  markReported(mark)
  const batch = pending.get(scopeId) ?? { scope, keys: new Set<string>() }
  batch.keys.add(name)
  pending.set(scopeId, batch)
  flushTimer ??= setTimeout(flush, EXPOSURE_BATCH_MS)
}

/** Forgets every reported mark, so the next person in this tab reports afresh. */
export function clearExposureDedupe(): void {
  reported.clear()
  const store = sessionStore()
  if (!store) return
  try {
    const marks: string[] = []
    for (let index = 0; index < store.length; index += 1) {
      const name = store.key(index)
      if (name?.startsWith(EXPOSURE_DEDUPE_PREFIX)) marks.push(name)
    }
    for (const name of marks) store.removeItem(name)
  } catch {
    // Storage is best effort: the in-memory marks are already gone.
  }
}

/** Test-only: drop the pending batch, its timer and every mark. */
export function resetExposureForTests(): void {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = null
  pending.clear()
  clearExposureDedupe()
}
