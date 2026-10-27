import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import { apiClient, unwrap } from '@/http/client'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { documentFilename, downloadFile } from '@/lib/download-file'
import { billingKeys } from '@/queries/billing.queries'
import type { ApiSuccess } from '@/types/api.types'
import type { ListPage } from '@/types/list.types'
import {
  TAX_DETAILS_VERSION_CONFLICT,
  TAX_DOCUMENTS_DISABLED,
  type TaxDetails,
  type TaxDetailsPatch,
  type TaxDocumentRef,
  type TaxDocumentView,
} from '@/types/tax.types'

/**
 * The tax query keys. Both sit under `billingKeys.billing(slug)`, so
 * `invalidateBilling` and `dropTenantCache` already cover them.
 */
export const taxKeys = {
  details: (slug: string) => ['tenants', slug, 'billing', 'tax-details'] as const,
  documents: (slug: string) => ['tenants', slug, 'billing', 'tax-documents'] as const,
}

/**
 * `GET /tenants/:slug/billing/tax-details`: the buyer details printed on
 * documents, or `null` when none are saved. Never retried. A 404
 * `tax_documents_disabled` rejects; the card handles it.
 * @param slug - The tenant.
 * @param options - `enabled: false` asks nothing.
 */
export function taxDetailsQueryOptions(slug: string, { enabled }: { enabled: boolean }) {
  return queryOptions({
    queryKey: taxKeys.details(slug),
    queryFn: async ({ signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<TaxDetails | null>>(`/tenants/${slug}/billing/tax-details`, {
          signal,
        })
      ),
    retry: false,
    enabled,
  })
}

/**
 * `GET /tenants/:slug/billing/tax-documents`, one cursor page at a time, at
 * the default sort and limit. Paged by `nextCursor` as `invoicesQueryOptions`
 * pages the invoices.
 * @param slug - The tenant.
 */
export function taxDocumentsQueryOptions(slug: string) {
  return infiniteQueryOptions({
    queryKey: taxKeys.documents(slug),
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await apiClient.get<ApiSuccess<ListPage<TaxDocumentView>>>(
          `/tenants/${slug}/billing/tax-documents`,
          { params: pageParam === null ? {} : { cursor: pageParam }, signal }
        )
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.page.hasNext ? last.page.nextCursor : null),
  })
}

/**
 * Saves the buyer details: `PATCH /billing/tax-details` with the changed
 * fields plus `version`. The answer is stored as the details. A 409 version
 * conflict refetches the details; a 404 `tax_documents_disabled` refetches the
 * billing view alone (exact, so the details and invoices under it do not
 * refetch into another 404) and the flags turn the card read-only or remove it.
 * @param slug - The tenant.
 */
export function useSaveTaxDetails(slug: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (patch: TaxDetailsPatch) =>
      unwrap(
        await apiClient.patch<ApiSuccess<TaxDetails>>(`/tenants/${slug}/billing/tax-details`, patch)
      ),
    onSuccess: (saved) => {
      queryClient.setQueryData(taxKeys.details(slug), saved)
    },
    onError: (error) => {
      if (statusFrom(error) === 409 && codeFrom(error) === TAX_DETAILS_VERSION_CONFLICT) {
        void queryClient.invalidateQueries({ queryKey: taxKeys.details(slug) })
      } else if (statusFrom(error) === 404 && codeFrom(error) === TAX_DOCUMENTS_DISABLED) {
        void queryClient.invalidateQueries({ queryKey: billingKeys.billing(slug), exact: true })
      }
    },
  })
}

/**
 * Saves a tax document's PDF. Rejects with the axios error; the caller shows
 * the toast.
 * @param slug - The tenant.
 * @param doc - The document to save.
 */
export async function downloadTaxDocument(slug: string, doc: TaxDocumentRef): Promise<void> {
  await downloadFile(
    `/tenants/${slug}/billing/tax-documents/${doc.id}/pdf`,
    documentFilename(doc.number)
  )
}
