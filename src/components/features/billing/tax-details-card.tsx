import '@/lib/zod-jitless'
import { useForm } from '@tanstack/react-form'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { LoadError } from '@/components/features/load-error'
import { BusyButton } from '@/components/shared/busy-button'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import { FormFieldsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useChangedFields } from '@/hooks/use-changed-fields'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors, type ServerErrors } from '@/hooks/use-server-errors'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { GST_STATES, stateOf } from '@/lib/gst'
import { toast } from '@/lib/toast'
import { billingKeys } from '@/queries/billing.queries'
import { taxDetailsQueryOptions, useSaveTaxDetails } from '@/queries/tax.queries'
import {
  TAX_DETAILS_SAVED_MESSAGE,
  TAX_DETAILS_UNCHANGED_MESSAGE,
  taxDetailsFieldsSchema,
  taxDetailsForm,
  taxDetailsRuleIssues,
  valuesFrom,
  type TaxDetailsValues,
} from '@/schemas/tax-details.schemas'
import {
  TAX_DETAILS_VERSION_CONFLICT,
  TAX_DOCUMENTS_DISABLED,
  type TaxDetails,
  type TaxDetailsPatch,
} from '@/types/tax.types'

/** What the card says when the details, or Reload's refetch of them, failed. */
const LOAD_FAILED = 'Tax details didn’t load. Try again.'

/** The form fields, plus the button bar, that the skeleton stands in for. */
const FORM_FIELD_COUNT = 8

/** One message for one field, as the schema or the cross-field rules report it. */
interface FieldIssue {
  path: PropertyKey | undefined
  message: string
}

/**
 * Puts each issue under its field, as the server's field errors would be, so
 * the field's next change clears it.
 * @param serverErrors - The form's errors.
 * @param issues - The issues to show.
 */
function showIssues(serverErrors: ServerErrors, issues: FieldIssue[]) {
  const byField = new Map<string, string[]>()
  for (const { path, message } of issues) {
    const field = String(path)
    byField.set(field, [...(byField.get(field) ?? []), message])
  }
  serverErrors.reset()
  for (const [field, messages] of byField) serverErrors.setFieldError(field, messages)
}

/** A state as the select and the summary show it, such as `Karnataka (29)`. */
function stateLabel(code: string): string {
  const state = stateOf(code)
  return state === undefined ? code : `${state.name} (${code})`
}

/**
 * The editable form. Only the fields the owner changed are checked and sent,
 * with the `version` of the details the baseline froze from, so a background
 * refetch moves neither. A first save checks and sends every field. The
 * cross-field rules run on the stored values with the changes laid over them.
 * A version conflict offers Reload, which drops what was typed and starts over
 * from the server's details. The State select clears its own server error,
 * since Base UI's Select raises no native change. The SEZ checkbox's toggle
 * does reach `<Form onChange>` (a native change on its hidden input, measured
 * under jsdom), and it clears its own error as well, so the rule holds either way.
 */
function TaxDetailsForm({
  slug,
  details,
  onReload,
}: {
  slug: string
  details: TaxDetails | null
  onReload: () => Promise<{ data?: TaxDetails | null; isError: boolean }>
}) {
  const saveDetails = useSaveTaxDetails(slug)
  const serverErrors = useServerErrors()
  const [frozen, setFrozen] = useState<{ details: TaxDetails | null } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  const source = frozen === null ? details : frozen.details
  const version = source?.version ?? null

  const changed = useChangedFields(
    taxDetailsFieldsSchema,
    taxDetailsForm(details),
    serverErrors,
    TAX_DETAILS_UNCHANGED_MESSAGE
  )
  const { baseline, changes, changedBody, rebase } = changed

  /** Freezes the version with the baseline, from the details loaded when the form is first touched. */
  function freezeVersion() {
    setFrozen((current) => current ?? { details })
  }

  const form = useForm({
    defaultValues: baseline,
    validators: { onSubmit: changes },
    listeners: {
      onChange: () => {
        freezeVersion()
        changed.listeners.onChange()
      },
      onBlur: () => {
        freezeVersion()
        changed.listeners.onBlur()
      },
      onSubmit: () => {
        freezeVersion()
        changed.listeners.onSubmit()
      },
    },
    onSubmit: async ({ value }) => {
      let patch: TaxDetailsPatch
      if (source === null) {
        const parsed = taxDetailsFieldsSchema.safeParse(value)
        if (!parsed.success) {
          showIssues(
            serverErrors,
            parsed.error.issues.map((issue) => ({ path: issue.path[0], message: issue.message }))
          )
          return
        }
        const every = new Set(Object.keys(parsed.data) as Array<keyof TaxDetailsValues>)
        const issues = taxDetailsRuleIssues(parsed.data, every)
        if (issues.length > 0) {
          showIssues(serverErrors, issues)
          return
        }
        patch = { version: null, ...parsed.data }
      } else {
        const body = changedBody(value)
        if (!body) return
        const merged: TaxDetailsValues = { ...valuesFrom(source), ...body }
        const issues = taxDetailsRuleIssues(
          merged,
          new Set(Object.keys(body) as Array<keyof TaxDetailsValues>)
        )
        if (issues.length > 0) {
          showIssues(serverErrors, issues)
          return
        }
        patch = { version, ...body }
      }

      serverErrors.reset()
      try {
        const saved = await saveDetails.mutateAsync(patch)
        startFrom(saved)
        toast.success(TAX_DETAILS_SAVED_MESSAGE)
      } catch (error) {
        const status = statusFrom(error)
        const code = codeFrom(error)
        if (status === 409 && code === TAX_DETAILS_VERSION_CONFLICT) {
          serverErrors.setFormErrors([messageFrom(error)])
          setConflict(true)
          return
        }
        if (status === 404 && code === TAX_DOCUMENTS_DISABLED) {
          serverErrors.setFormErrors([messageFrom(error)])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  /** Makes `next` the details the form edits: its baseline, its values and its version. */
  function startFrom(next: TaxDetails | null) {
    const values = taxDetailsForm(next)
    rebase(values)
    form.reset(values)
    setFrozen({ details: next })
    setConflict(false)
  }

  /** Refetches the details and starts over from them, or says they didn't load. */
  async function reload() {
    setReloading(true)
    try {
      const result = await onReload()
      if (result.isError || result.data === undefined) {
        serverErrors.setFormErrors([LOAD_FAILED])
        return
      }
      startFrom(result.data)
      serverErrors.reset()
    } finally {
      setReloading(false)
    }
  }

  return (
    <Form form={form} serverErrors={serverErrors}>
      <FormField form={form} name="gstin">
        {(field) => (
          <FormItem>
            <FormLabel>GSTIN (optional)</FormLabel>
            <FormControl>
              <Input
                autoComplete="off"
                spellCheck={false}
                maxLength={20}
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>
              Your 15-character Goods and Services Tax Identification Number. Leave it empty if your
              business isn&apos;t registered for GST. You still get tax invoices.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="legalName">
        {(field) => (
          <FormItem>
            <FormLabel>Legal name</FormLabel>
            <FormControl>
              <Input
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>The business name printed on your tax invoices.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <p className="text-sm text-muted-foreground">
        With a GSTIN, enter the address, city, PIN code and state from your GST registration.
        Without one, they&apos;re optional.
      </p>

      {(
        [
          ['addressLine1', 'Address line 1'],
          ['addressLine2', 'Address line 2 (optional)'],
          ['city', 'City'],
        ] as const
      ).map(([name, label]) => (
        <FormField key={name} form={form} name={name}>
          {(field) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Input
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
      ))}

      <FormField form={form} name="pincode">
        {(field) => (
          <FormItem>
            <FormLabel>PIN code</FormLabel>
            <FormControl>
              <Input
                inputMode="numeric"
                maxLength={6}
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="stateCode">
        {(field) => (
          <FormItem>
            <FormLabel>State</FormLabel>
            <Select
              value={fieldValue(field.state.value) === '' ? null : fieldValue(field.state.value)}
              onValueChange={(value: string | null) => {
                if (value === null) return
                field.handleChange(value)
                serverErrors.clearField('stateCode')
              }}
            >
              <FormControl>
                <SelectTrigger className="w-full" onBlur={field.handleBlur}>
                  <SelectValue placeholder="Choose a state">
                    {(value: string | null) =>
                      value === null ? 'Choose a state' : stateLabel(value)
                    }
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {GST_STATES.map((state) => (
                  <SelectItem key={state.code} value={state.code}>
                    {state.name} ({state.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="isSez">
        {(field) => (
          <FormItem>
            <div className="flex items-center gap-2">
              <FormControl>
                <Checkbox
                  checked={field.state.value === true}
                  onBlur={field.handleBlur}
                  onCheckedChange={(checked: boolean) => {
                    field.handleChange(checked)
                    serverErrors.clearField('isSez')
                  }}
                />
              </FormControl>
              <FormLabel>Special Economic Zone (SEZ) unit</FormLabel>
            </div>
            <FormDescription>
              Tick this if your GSTIN belongs to an SEZ unit. Our team issues tax invoices for SEZ
              units by hand, so they don&apos;t appear in Invoices.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormError />

      <div className="flex flex-wrap gap-2">
        <BusyButton busy={saveDetails.isPending} busyLabel="Saving…" type="submit">
          Save tax details
        </BusyButton>
        {conflict && (
          <Button
            type="button"
            variant="outline"
            disabled={reloading}
            onClick={() => void reload()}
          >
            Reload
          </Button>
        )}
      </div>
    </Form>
  )
}

/** The stored details as text, for a workspace whose tax documents are off. */
function TaxDetailsSummary({ details }: { details: TaxDetails | null }) {
  if (details === null) return <EmptyState size="compact" title="No tax details on file." />
  const address = [
    details.addressLine1,
    details.addressLine2,
    details.city,
    details.pincode,
  ].filter((line): line is string => line !== null)
  return (
    <dl className="grid gap-4">
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">GSTIN</dt>
        {details.gstin === null ? <dd>None</dd> : <Pii as="dd">{details.gstin}</Pii>}
      </div>
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">Legal name</dt>
        <Pii as="dd">{details.legalName}</Pii>
      </div>
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">Address</dt>
        {address.length === 0 ? (
          <dd>None</dd>
        ) : (
          <Pii as="dd">
            {address.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </Pii>
        )}
      </div>
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">State</dt>
        <dd>
          {details.state.name} ({details.state.code})
        </dd>
      </div>
      <div className="grid gap-1">
        <dt className="text-sm text-muted-foreground">SEZ unit</dt>
        <dd>{details.isSez ? 'Yes' : 'No'}</dd>
      </div>
    </dl>
  )
}

/**
 * Billing's "Tax details" card for an owner with member access: the buyer
 * details printed on tax invoices. Editable while tax documents are on, and
 * read-only when they are off and the workspace has documents. A 404
 * `tax_documents_disabled` renders nothing and refetches the billing view,
 * whose flags then move or remove the card.
 */
export function TaxDetailsCard({ slug, editable }: { slug: string; editable: boolean }) {
  const queryClient = useQueryClient()
  const details = useQuery(taxDetailsQueryOptions(slug, { enabled: true }))
  const disabled =
    details.isError &&
    statusFrom(details.error) === 404 &&
    codeFrom(details.error) === TAX_DOCUMENTS_DISABLED

  useEffect(() => {
    if (disabled)
      void queryClient.invalidateQueries({ queryKey: billingKeys.billing(slug), exact: true })
  }, [disabled, queryClient, slug])

  if (disabled) return null

  let body
  if (details.isPending) body = <FormFieldsSkeleton fields={FORM_FIELD_COUNT} />
  else if (details.data === undefined) {
    body = <LoadError message={LOAD_FAILED} onRetry={() => void details.refetch()} />
  } else if (editable) {
    body = <TaxDetailsForm slug={slug} details={details.data} onReload={() => details.refetch()} />
  } else body = <TaxDetailsSummary details={details.data} />

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Tax details</h2>
        </CardTitle>
        <CardDescription>
          {editable
            ? "We print these details on your tax invoices. Changes apply to invoices issued from now on. Issued invoices don't change."
            : 'We no longer issue tax invoices. Your issued invoices and credit notes stay available to download.'}
        </CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  )
}
