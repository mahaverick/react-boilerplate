import { createFileRoute, Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { ActivityList } from '@/components/features/activity/activity-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { pageTitle } from '@/constants/app'
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS, isAuditAction } from '@/constants/audit-actions'
import { canViewPlatformActivity } from '@/constants/roles'
import { PLATFORM_TENANT_SLUG, ROUTES } from '@/constants/routes'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { statusFrom } from '@/lib/api-error'
import { cn } from '@/lib/utils'
import {
  flattenAuditPages,
  usePlatformAuditLog,
  type PlatformAuditFilters,
} from '@/queries/audit.queries'
import {
  flattenTenantPages,
  SEARCH_DEBOUNCE_MS,
  usePlatformTenantSearch,
} from '@/queries/platform.queries'
import { memberName, useMembers } from '@/queries/tenant.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformTenantRow } from '@/types/api.types'

export const Route = createFileRoute('/_app/platform/activity')({
  head: () => ({ meta: [{ title: pageTitle('Platform activity') }] }),
  staticData: { crumb: 'Platform activity' },
  component: PlatformActivityPage,
})

/** The select value meaning "no filter". */
const ANY = 'any'

/**
 * The same panel for "not staff", "staff below admin" and the API's own 404,
 * matching the API: the page never confirms it exists to someone it refuses.
 */
function PlatformNotFound() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h1>Page not available</h1>
        </CardTitle>
        <CardDescription>
          This page does not exist, or it is not available to your account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Link to={ROUTES.dashboard} className="text-sm underline underline-offset-4">
          Back to the dashboard
        </Link>
      </CardContent>
    </Card>
  )
}

/**
 * A tenant picker over the platform search, the same one the switcher uses,
 * run only while open. The popup is named and holds the search box, so Base UI
 * makes it a `dialog`, which axe's `region` rule exempts. The vendored trigger
 * and clear icon buttons are off because they carry no accessible name; the
 * Clear button beside the trigger has one. The status line stays mounted and
 * only its text changes, so the live region announces it; while a new term
 * loads over listed results it says "Searching…".
 */
function TenantFilter({
  value,
  onChange,
}: {
  value: PlatformTenantRow | null
  onChange: (tenant: PlatformTenantRow | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const term = useDebouncedValue(query, SEARCH_DEBOUNCE_MS)
  const search = usePlatformTenantSearch(term, { enabled: open })
  const items = flattenTenantPages(search.data)
  const isRefreshing = search.isPlaceholderData && items.length > 0

  return (
    <div className="flex items-center gap-1">
      <Combobox<PlatformTenantRow>
        items={items}
        filter={null}
        value={value}
        open={open}
        onOpenChange={setOpen}
        onValueChange={(tenant) => onChange(tenant)}
        inputValue={query}
        onInputValueChange={(next) => setQuery(next)}
        itemToStringLabel={(tenant) => tenant.name}
        isItemEqualToValue={(a, b) => a.id === b.id}
      >
        <ComboboxTrigger
          render={
            <Button
              variant="outline"
              className="w-56 justify-between font-normal"
              aria-label={`Filter by tenant. Current: ${value?.name ?? 'Any tenant'}`}
            />
          }
        >
          <span className="truncate">{value?.name ?? 'Any tenant'}</span>
        </ComboboxTrigger>
        <ComboboxContent aria-label="Filter by tenant">
          <ComboboxInput
            showTrigger={false}
            aria-label="Search tenants"
            placeholder="Search tenants"
          />
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={cn('text-sm text-muted-foreground', isRefreshing && 'px-2 py-1.5')}
          >
            {isRefreshing ? 'Searching…' : null}
          </p>
          <ComboboxEmpty>
            {search.isPending || search.isPlaceholderData
              ? 'Searching…'
              : search.isError
                ? 'Tenants could not be loaded'
                : 'No tenants match'}
          </ComboboxEmpty>
          <ComboboxList>
            {(tenant: PlatformTenantRow) => (
              <ComboboxItem key={tenant.id} value={tenant}>
                {tenant.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      {value && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Clear the tenant filter"
          onClick={() => {
            onChange(null)
            setQuery('')
          }}
        >
          Clear
        </Button>
      )}
    </div>
  )
}

/**
 * Every tenant's activity, with tenant, action, actor and staff-only filters;
 * the actor filter offers the platform tenant's members. A 404 from the log
 * (the viewer was demoted since the profile loaded) gets the not-found panel.
 */
function PlatformActivity() {
  const staffOnlyId = useId()
  const [tenant, setTenant] = useState<PlatformTenantRow | null>(null)
  const [action, setAction] = useState(ANY)
  const [actor, setActor] = useState(ANY)
  const [staffOnly, setStaffOnly] = useState(false)
  const staff = useMembers(PLATFORM_TENANT_SLUG)
  const filters: PlatformAuditFilters = {
    tenantId: tenant?.id,
    action: isAuditAction(action) ? action : undefined,
    actorUserId: actor === ANY ? undefined : actor,
    access: staffOnly ? 'platform' : undefined,
  }
  const log = usePlatformAuditLog(filters)
  const isFiltered = tenant !== null || action !== ANY || actor !== ANY || staffOnly

  function actorLabel(value: string): string {
    if (value === ANY) return 'Anyone'
    const match = staff.data?.find((member) => member.user.id === value)
    return match ? memberName(match) : 'A staff member'
  }

  if (log.isError && statusFrom(log.error) === 404) return <PlatformNotFound />

  return (
    <div className="grid max-w-4xl gap-4 xl:max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Platform activity</h1>
          </CardTitle>
          <CardDescription>
            Every change and every staff visit, across all tenants, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <TenantFilter value={tenant} onChange={setTenant} />
            <Select
              value={action}
              onValueChange={(value: string | null) => setAction(value ?? ANY)}
            >
              <SelectTrigger aria-label="Filter by action" className="w-52">
                <SelectValue>
                  {(value: string) =>
                    isAuditAction(value) ? AUDIT_ACTION_LABELS[value] : 'All actions'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All actions</SelectItem>
                {AUDIT_ACTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {AUDIT_ACTION_LABELS[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actor} onValueChange={(value: string | null) => setActor(value ?? ANY)}>
              <SelectTrigger aria-label="Filter by who acted" className="w-52">
                <SelectValue>{(value: string) => actorLabel(value)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Anyone</SelectItem>
                {(staff.data ?? []).map((member) => (
                  <SelectItem key={member.user.id} value={member.user.id}>
                    {memberName(member)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                id={staffOnlyId}
                checked={staffOnly}
                onCheckedChange={(checked) => setStaffOnly(checked)}
              />
              <Label htmlFor={staffOnlyId} className="text-sm font-normal">
                Staff only
              </Label>
            </div>
          </div>
          <ActivityList
            entries={flattenAuditPages(log.data)}
            isPending={log.isPending}
            isError={log.isError}
            onRetry={() => void log.refetch()}
            hasNextPage={log.hasNextPage}
            isFetchingNextPage={log.isFetchingNextPage}
            isFetchNextPageError={log.isFetchNextPageError}
            onLoadMore={() => void log.fetchNextPage()}
            emptyMessage={
              isFiltered ? 'Nothing matches these filters.' : 'Nothing has happened yet.'
            }
            renderTenant={(entry) => (
              <Link
                to="/tenants/$slug"
                params={{ slug: entry.tenant.slug }}
                className="font-medium underline underline-offset-4"
              >
                {entry.tenant.name}
              </Link>
            )}
          />
        </CardContent>
      </Card>
    </div>
  )
}

/** Below platform admin the API answers 404, so the page says the same without asking. */
function PlatformActivityPage() {
  const platformRole = useAuthStore((state) => state.user?.platformRole)
  return canViewPlatformActivity(platformRole) ? <PlatformActivity /> : <PlatformNotFound />
}
