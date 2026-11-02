import { queryOptions, useQuery } from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { statusFrom } from '@/lib/api-error'
import type { ApiSuccess, ClientSettings } from '@/types/api.types'

/** The key of the client settings read. */
export const clientSettingsKeys = {
  all: ['client-settings'],
} as const

/** Whether a value is a positive, finite number of seconds. */
function isSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** Whether a body holds every client setting in its expected shape. */
function isClientSettings(value: unknown): value is ClientSettings {
  if (typeof value !== 'object' || value === null) return false
  const settings = value as Record<string, unknown>
  return (
    isSeconds(settings.signInLinkTtlSeconds) &&
    isSeconds(settings.stepUpLinkTtlSeconds) &&
    isSeconds(settings.invitationTtlSeconds) &&
    typeof settings.supportEmail === 'string' &&
    settings.supportEmail.includes('@')
  )
}

/**
 * Query options for `GET /status/client-settings`: the link lifetimes and the
 * support address the copy states. The request is public: no bearer, no
 * refresh retry. They change only with a deployment, so a read holds for an
 * hour. A 404 (an API from before the route) or a body of another shape
 * resolves to null and holds as long; any other failure rejects, so the next
 * reader asks again.
 */
export function clientSettingsQueryOptions() {
  return queryOptions({
    queryKey: clientSettingsKeys.all,
    staleTime: 60 * 60_000,
    queryFn: async ({ signal }): Promise<ClientSettings | null> => {
      try {
        const settings = unwrap(
          await apiClient.get<ApiSuccess<unknown>>('/status/client-settings', {
            signal,
            skipAuthRetry: true,
            headers: { Authorization: false },
          })
        )
        return isClientSettings(settings) ? settings : null
      } catch (error) {
        if (statusFrom(error) === 404) return null
        throw error
      }
    },
  })
}

/**
 * The client settings, or undefined while they load, after a failure, and
 * from an API without the route. Copy that states a lifetime or the support
 * address leaves the figure out while this is undefined, never a guess.
 */
export function useClientSettings(): ClientSettings | undefined {
  return useQuery(clientSettingsQueryOptions()).data ?? undefined
}
