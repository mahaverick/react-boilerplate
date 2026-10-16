import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { SettingsPending } from '@/components/shared/pending-templates'
import { pageTitle } from '@/constants/app'
import { SETTINGS_DESCRIPTION, settingsActiveSection } from '@/constants/settings'

/** The Settings area's layout: a heading named after the active section, then the page. */
export const Route = createFileRoute('/_app/settings')({
  head: () => ({ meta: [{ title: pageTitle('Settings') }] }),
  staticData: { crumb: 'Settings' },
  component: SettingsLayout,
  pendingComponent: SettingsPending,
})

/**
 * The page's `h1` comes from the active section in `SETTINGS_SECTIONS`, so
 * each settings page's own cards start at `h2`. The landing page has none.
 */
function SettingsLayout() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const section = settingsActiveSection(pathname)
  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold lg:text-3xl">{section?.label ?? 'Settings'}</h1>
        <p className="text-sm text-muted-foreground">
          {section?.description ?? SETTINGS_DESCRIPTION}
        </p>
      </header>
      <Outlet />
    </div>
  )
}
