import { createFileRoute } from '@tanstack/react-router'
import { SettingsRouteError } from '@/components/features/route-error'
import { SettingsLinkList } from '@/components/features/settings/settings-link-list'
import { pageTitle } from '@/constants/app'
import { SETTINGS_GROUPS } from '@/constants/settings'

/** The Settings landing page: one card per group. */
export const Route = createFileRoute('/_app/settings/')({
  head: () => ({ meta: [{ title: pageTitle('Settings') }] }),
  component: SettingsIndex,
  /** Kept out of a lazy chunk, as the router's default error screen is: a failed fetch could not load it. */
  codeSplitGroupings: [['component']],
  errorComponent: SettingsRouteError,
})

/** One `SettingsLinkList` per group, in config order. */
function SettingsIndex() {
  return (
    <div className="grid gap-6">
      {SETTINGS_GROUPS.map((group) => (
        <SettingsLinkList key={group.id} group={group} />
      ))}
    </div>
  )
}
