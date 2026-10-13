import { createFileRoute } from '@tanstack/react-router'
import { SettingsLinkList } from '@/components/features/settings/settings-link-list'
import { pageTitle } from '@/constants/app'
import { SETTINGS_GROUPS } from '@/constants/settings'

/** The Settings landing page: one card per group. */
export const Route = createFileRoute('/_app/settings/')({
  head: () => ({ meta: [{ title: pageTitle('Settings') }] }),
  component: SettingsIndex,
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
