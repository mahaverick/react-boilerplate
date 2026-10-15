import { IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item'
import { SETTINGS_SECTIONS, type SettingsGroup, type SettingsSection } from '@/constants/settings'
import { useCurrentTenantSlug } from '@/hooks/use-current-tenant-slug'

/** One row's parts: the section's icon, label and description, and a chevron when it links. */
function Row({ section, links = true }: { section: SettingsSection; links?: boolean }) {
  return (
    <>
      <ItemMedia>
        <section.Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="line-clamp-none">{section.label}</ItemTitle>
        <ItemDescription className="line-clamp-none">{section.description}</ItemDescription>
      </ItemContent>
      {links && <IconChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />}
    </>
  )
}

/**
 * One group of the landing page: a card titled after the group, each section
 * a link. Workspace links go to the tenant `useCurrentTenantSlug` reads from the URL; with
 * none, the group says to choose a tenant first and offers no links: each
 * row is plain text described by that hint, in muted text with no chevron
 * rather than dimmed, which would fail contrast.
 */
export function SettingsLinkList({ group }: { group: SettingsGroup }) {
  const slug = useCurrentTenantSlug()
  const sections = SETTINGS_SECTIONS.filter((section) => section.group === group.id)
  const headingId = `settings-group-${group.id}`
  const hintId = useId()
  const needsTenant = group.id === 'workspace' && slug === null
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle>
          <h2 id={headingId}>{group.label}</h2>
        </CardTitle>
        <CardDescription>{group.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {needsTenant && (
          <p id={hintId} className="pb-2 text-sm">
            Choose a tenant first.
          </p>
        )}
        <ItemGroup className="gap-0 divide-y has-data-[size=sm]:gap-0">
          {sections.map((section) => (
            <div key={section.to} role="listitem">
              {section.group === 'account' ? (
                <Item size="sm" render={<Link to={section.to} />}>
                  <Row section={section} />
                </Item>
              ) : slug !== null ? (
                <Item size="sm" render={<Link to={section.to} params={{ slug }} />}>
                  <Row section={section} />
                </Item>
              ) : (
                <Item
                  size="sm"
                  className="cursor-not-allowed text-muted-foreground"
                  aria-describedby={hintId}
                >
                  <Row section={section} links={false} />
                </Item>
              )}
            </div>
          ))}
        </ItemGroup>
      </CardContent>
    </Card>
  )
}
