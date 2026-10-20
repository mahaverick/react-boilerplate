import { IconBuilding } from '@tabler/icons-react'
import { createFileRoute, useLocation } from '@tanstack/react-router'
import { useEffect, useRef, type Ref } from 'react'
import { CreateTenantForm } from '@/components/features/tenant/create-tenant-form'
import { MyTenantsTable } from '@/components/features/tenant/my-tenants-table'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { pageTitle } from '@/constants/app'
import { toast } from '@/lib/toast'
import { myTenantsList, myTenantsListOptions } from '@/queries/tenant.queries'

/** The caller's tenant list and the form to create another. */
export const Route = createFileRoute('/_app/tenants/')({
  validateSearch: myTenantsList.schema,
  staticData: { crumb: 'Tenants' },
  head: () => ({ meta: [{ title: pageTitle('Tenants') }] }),
  component: TenantsPage,
})

/** The create form's element id: `/tenants#create` opens the page on it. */
const CREATE_FORM_ID = 'create'

/** What the list says when it did not load: a claim about the request, not the account. */
const TENANTS_ERROR = 'We couldn’t load your tenants, so none are listed. Try again to load them.'

/** The create card around the shared form: a new tenant is announced and the form cleared for another. */
function CreateTenantCard({ cardRef }: { cardRef: Ref<HTMLDivElement> }) {
  return (
    <Card ref={cardRef} id={CREATE_FORM_ID}>
      <CardHeader>
        <CardTitle>
          <h2>Create a tenant</h2>
        </CardTitle>
        <CardDescription>You become its owner. The slug cannot be changed later.</CardDescription>
      </CardHeader>
      <CardContent>
        <CreateTenantForm
          submitLabel="Create tenant"
          busyLabel="Creating…"
          onCreated={(tenant) => {
            toast.success(`${tenant.name} created.`)
          }}
        />
      </CardContent>
    </Card>
  )
}

/**
 * The tenant list and the create form. The list's loading, error and empty
 * states are `DataTable`'s: a failed load is never the empty state, since the
 * two render alike and an empty state would invite the reader to create a
 * duplicate.
 */
function TenantsPage() {
  const list = useListSearch(myTenantsList)
  const tenants = useListQuery(list, myTenantsListOptions)
  const createCard = useRef<HTMLDivElement>(null)

  /** Brings the create form into view and puts the cursor in its first field. */
  const showCreateForm = () => {
    createCard.current?.scrollIntoView({ block: 'center' })
    createCard.current?.querySelector('input')?.focus()
  }

  // Each arrival on `#create` (the palette's Create a tenant) shows the form, a repeat arrival included.
  const arrival = useLocation({
    select: (location) => (location.hash === CREATE_FORM_ID ? location.state.key : undefined),
  })
  useEffect(() => {
    if (arrival !== undefined) showCreateForm()
  }, [arrival])

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>Tenants</h1>
          </CardTitle>
          <CardDescription>Every organization this account belongs to.</CardDescription>
        </CardHeader>
        <CardContent>
          <MyTenantsTable
            query={tenants}
            errorMessage={TENANTS_ERROR}
            empty={
              <EmptyState
                icon={<IconBuilding aria-hidden="true" />}
                title="You do not belong to any tenants yet."
                description="Create one below."
                action={
                  <Button variant="outline" size="sm" onClick={showCreateForm}>
                    Create a tenant
                  </Button>
                }
              />
            }
          />
        </CardContent>
      </Card>
      <CreateTenantCard cardRef={createCard} />
    </div>
  )
}
