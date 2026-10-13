import { createFileRoute } from '@tanstack/react-router'
import { PreferencesCard } from '@/components/features/notifications/preferences-card'
import { SettingsRouteError } from '@/components/features/route-error'
import { pageTitle } from '@/constants/app'

/** Settings › Notifications: how each kind of notification reaches the user. */
export const Route = createFileRoute('/_app/settings/account/notifications')({
  head: () => ({ meta: [{ title: pageTitle('Notifications') }] }),
  staticData: { crumb: 'Notifications' },
  component: PreferencesCard,
  /**
   * Kept out of a lazy chunk, as the router's default error screen is: a failed
   * fetch could not load it. Splitting it would also pull the error listener
   * out of the entry chunk (pnpm check:bundle).
   */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
})
