import { IconArrowLeft } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { ROUTES } from '@/constants/routes'
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, settingsActiveSection } from '@/constants/settings'
import { useWorkspaceSlug } from '@/hooks/use-workspace-slug'

/**
 * The sidebar's content on settings pages, after Pulse's settings nav: Back
 * to app, then one labelled group per `SETTINGS_GROUPS` entry. Workspace items
 * link to the tenant `useWorkspaceSlug` resolves; with none they are disabled
 * buttons and the group says to choose a tenant first. Every item names
 * itself in a tooltip while the sidebar is collapsed to icons, and every link
 * closes the mobile drawer.
 *
 * A disabled item is `aria-disabled`, not `disabled`, so it stays focusable
 * and its tooltip still opens; it overrides the button's
 * `aria-disabled:pointer-events-none` so hovering opens the tooltip too,
 * without the hover and press highlight of a live item, and it has no action
 * to activate.
 */
export function NavSettings({ pathname }: { pathname: string }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const slug = useWorkspaceSlug()
  const active = settingsActiveSection(pathname)
  /** Closes the drawer after a tap on a phone. */
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  return (
    <nav aria-label="Settings">
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Back to app"
              render={<Link to={ROUTES.dashboard} onClick={close} />}
            >
              <IconArrowLeft aria-hidden="true" />
              <span>Back to app</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      {SETTINGS_GROUPS.map((group) => (
        <SidebarGroup key={group.id}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          {group.id === 'workspace' && slug === null && (
            <p className="px-2 pb-1 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
              Choose a tenant first.
            </p>
          )}
          <SidebarMenu>
            {SETTINGS_SECTIONS.filter((section) => section.group === group.id).map((section) => {
              const isActive = active?.to === section.to
              const icon = <section.Icon aria-hidden="true" />
              if (section.group === 'workspace' && slug === null) {
                return (
                  <SidebarMenuItem key={section.to}>
                    <SidebarMenuButton
                      tooltip="Choose a tenant first."
                      aria-disabled="true"
                      className="aria-disabled:pointer-events-auto aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent aria-disabled:hover:text-sidebar-foreground aria-disabled:active:bg-transparent aria-disabled:active:text-sidebar-foreground"
                    >
                      {icon}
                      <span>{section.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              }
              const link =
                section.group === 'workspace' ? (
                  <Link to={section.to} params={{ slug: slug ?? '' }} onClick={close} />
                ) : (
                  <Link to={section.to} onClick={close} />
                )
              return (
                <SidebarMenuItem key={section.to}>
                  <SidebarMenuButton tooltip={section.label} isActive={isActive} render={link}>
                    {icon}
                    <span>{section.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </nav>
  )
}
