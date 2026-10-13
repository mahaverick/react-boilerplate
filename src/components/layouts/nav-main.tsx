import { IconChevronRight, type TablerIcon } from '@tabler/icons-react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/components/ui/sidebar'

/** One link under a collapsible group. */
interface NavSubItem {
  to: LinkProps['to']
  label: string
}

/**
 * One entry of the primary navigation. With `items` it is a collapsible
 * group whose own row only toggles; without, it is a link to `to`.
 */
export interface NavMainItem {
  to: LinkProps['to']
  label: string
  Icon: TablerIcon
  items?: readonly NavSubItem[]
}

/** Whether `to` is the current location or one of its ancestors. */
function isActive(pathname: string, to: LinkProps['to']): boolean {
  return typeof to === 'string' && (pathname === to || pathname.startsWith(`${to}/`))
}

/**
 * The sidebar's primary navigation, after shadcn's sidebar-07 `NavMain`. It
 * sits in its own `nav` landmark, since `Sidebar` renders plain divs. A flat
 * item renders as the anchor itself, so it is keyboard-reachable and opens in
 * a new tab; only an item with sub-items becomes a collapsible group, open
 * while one of its links is current. Each top-level row names itself in a
 * tooltip, shown only while the sidebar is collapsed to icons. The highlight
 * reads `pathname`, so a deep page keeps its section lit.
 */
export function NavMain({ items, pathname }: { items: readonly NavMainItem[]; pathname: string }) {
  return (
    <nav aria-label="Main">
      <SidebarGroup>
        <SidebarGroupLabel>Navigation</SidebarGroupLabel>
        <SidebarMenu>
          {items.map(({ to, label, Icon, items: subItems }) =>
            subItems && subItems.length > 0 ? (
              <Collapsible
                key={label}
                defaultOpen={subItems.some((sub) => isActive(pathname, sub.to))}
                className="group/collapsible"
                render={<SidebarMenuItem />}
              >
                <CollapsibleTrigger render={<SidebarMenuButton tooltip={label} />}>
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  <IconChevronRight
                    aria-hidden="true"
                    className="ml-auto transition-transform duration-200 group-data-open/collapsible:rotate-90"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    {subItems.map((sub) => (
                      <SidebarMenuSubItem key={sub.label}>
                        <SidebarMenuSubButton
                          isActive={isActive(pathname, sub.to)}
                          render={<Link to={sub.to} />}
                        >
                          <span>{sub.label}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  tooltip={label}
                  isActive={isActive(pathname, to)}
                  render={<Link to={to} />}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          )}
        </SidebarMenu>
      </SidebarGroup>
    </nav>
  )
}
