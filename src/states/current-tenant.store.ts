import { useEffect } from 'react'
import { create } from 'zustand'
import { useAuthStore } from '@/states/auth.store'

const STORAGE_PREFIX = 'last-tenant:'

/** The slug saved for `userId`, or null when none is saved or storage is blocked. */
export function readRememberedTenant(userId: string): string | null {
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${userId}`)
  } catch {
    return null
  }
}

/** The last tenant each user opened, by user id, and the action that records it. */
interface CurrentTenantState {
  remembered: Record<string, string>
  remember: (userId: string, slug: string) => void
}

/**
 * The last tenant each user opened, so Settings › Workspace has a tenant on
 * pages without a `$slug`. Keyed by user id, so a second account signed in on
 * the same browser starts with none. Saved to `localStorage` when allowed; with
 * storage blocked it lasts for this session only.
 */
export const useCurrentTenantStore = create<CurrentTenantState>()((set) => ({
  remembered: {},
  remember: (userId, slug) => {
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${userId}`, slug)
    } catch {
      // Storage may be blocked (private mode): remembered for this session only.
    }
    set((state) => ({ remembered: { ...state.remembered, [userId]: slug } }))
  },
}))

/** Records `slug` as the signed-in user's current tenant once its layout has loaded it. */
export function useRememberTenant(slug: string, loaded: boolean): void {
  const userId = useAuthStore((s) => s.user?.id)
  const remember = useCurrentTenantStore((s) => s.remember)
  useEffect(() => {
    if (loaded && userId) remember(userId, slug)
  }, [loaded, userId, slug, remember])
}
