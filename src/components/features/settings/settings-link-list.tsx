import { IconChevronRight } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { useId } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SETTINGS_SECTIONS, type SettingsGroup, type SettingsSection } from '@/constants/settings'
import { useWorkspaceSlug } from '@/hooks/use-workspace-slug'

/** One row: the section's icon, label and description, and a chevron. */
function Row({ section }: { section: SettingsSection }) {
  return (
    <>
      <section.Icon aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      <span className="grid flex-1 gap-0.5">
        <span className="font-medium">{section.label}</span>
        <span className="text-sm text-muted-foreground">{section.description}</span>
      </span>
      <IconChevronRight aria-hidden="true" className="size-4 text-muted-foreground" />
    </>
  )
}

/**
 * One group of the landing page: a card titled after the group, each section
 * a link. Workspace links go to the tenant `useWorkspaceSlug` resolves; with
 * none, the group says to choose a tenant first and offers no links: each
 * row is plain text described by that hint.
 */
export function SettingsLinkList({ group }: { group: SettingsGroup }) {
  const slug = useWorkspaceSlug()
  const sections = SETTINGS_SECTIONS.filter((section) => section.group === group.id)
  const headingId = `settings-group-${group.id}`
  const hintId = useId()
  const needsTenant = group.id === 'workspace' && slug === null
  const rowClass = 'flex items-center gap-3 rounded-md px-2 py-3 hover:bg-muted/50'
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
        <ul className="grid divide-y">
          {sections.map((section) => (
            <li key={section.to}>
              {section.group === 'account' ? (
                <Link to={section.to} className={rowClass}>
                  <Row section={section} />
                </Link>
              ) : slug !== null ? (
                <Link to={section.to} params={{ slug }} className={rowClass}>
                  <Row section={section} />
                </Link>
              ) : (
                <span className={`${rowClass} opacity-60`} aria-describedby={hintId}>
                  <Row section={section} />
                </span>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
