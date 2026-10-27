import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { TaxDetailsCard } from '@/components/features/billing/tax-details-card'
import { toast } from '@/lib/toast'
import { tenantBillingQueryOptions } from '@/queries/billing.queries'
import { taxKeys } from '@/queries/tax.queries'
import {
  GSTIN_CHECKSUM_MESSAGE,
  gstinStateMismatchMessage,
  PINCODE_MESSAGE,
  STATE_REQUIRED_MESSAGE,
  STATE_UNKNOWN_MESSAGE,
  SEZ_NEEDS_GSTIN_MESSAGE,
  TAX_DETAILS_SAVED_MESSAGE,
  TAX_DETAILS_UNCHANGED_MESSAGE,
} from '@/schemas/tax-details.schemas'
import { testTaxDetails } from '@/tests/fixtures/tax'
import { fail, ok } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import {
  TAX_DETAILS_VERSION_CONFLICT,
  TAX_DOCUMENTS_DISABLED,
  type TaxDetails,
} from '@/types/tax.types'

const DETAILS_URL = '/api/v1/tenants/acme/billing/tax-details'
const BILLING_URL = '/api/v1/tenants/acme/billing'
const CONFLICT_MESSAGE =
  'Someone changed these tax details since you opened them. Reload to see them, then save again.'
const DISABLED_WRITE_MESSAGE =
  "Tax documents are off, so tax details and credit notes can't change. Issued documents stay available to download."
const LOAD_FAILED = 'Tax details didn’t load. Try again.'

let client: QueryClient

/** A 400 in the house validation envelope, with `errors` keyed by field. */
function invalid(errors: Record<string, string[]>) {
  return HttpResponse.json(
    {
      success: false,
      message: 'Validation failed.',
      statusCode: 400,
      errors,
      requestId: 'test-request-id',
    },
    { status: 400 }
  )
}

/** Answers the details GET with `details`. */
function serveDetails(details: TaxDetails | null) {
  server.use(http.get(DETAILS_URL, () => ok(details, 'Tax details retrieved.')))
}

/**
 * Records each PATCH body and answers with `respond`, by default the saved
 * details merged from the body.
 */
function capturePatches(respond?: (body: Record<string, unknown>) => Response) {
  const bodies: Array<Record<string, unknown>> = []
  server.use(
    http.patch(DETAILS_URL, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      bodies.push(body)
      if (respond) return respond(body)
      return ok(
        testTaxDetails({ version: 4, city: (body.city as string | undefined) ?? 'Bengaluru' }),
        TAX_DETAILS_SAVED_MESSAGE
      )
    })
  )
  return bodies
}

/** Keeps the billing view observed, as the Billing page does, so its invalidation refetches. */
function BillingObserver() {
  useQuery(tenantBillingQueryOptions('acme'))
  return null
}

/** Renders the card for tenant `acme`. */
function renderCard({ editable = true, observeBilling = false } = {}) {
  return render(
    <QueryClientProvider client={client}>
      {observeBilling && <BillingObserver />}
      <TaxDetailsCard slug="acme" editable={editable} />
    </QueryClientProvider>
  )
}

/** The card's Save button. */
function saveButton() {
  return screen.getByRole('button', { name: 'Save tax details' })
}

/** Opens the State select and picks the option with `name`. */
async function chooseState(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('combobox', { name: 'State' }))
  await user.click(await screen.findByRole('option', { name }))
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('TaxDetailsCard, editable', () => {
  it('shows the editable description', async () => {
    serveDetails(testTaxDetails())
    renderCard()
    expect(
      await screen.findByText(
        "We print these details on your tax invoices. Changes apply to invoices issued from now on. Issued invoices don't change."
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Tax details' })).toBeInTheDocument()
  })

  it('creates the details on a first save, asking for a state first', async () => {
    serveDetails(null)
    const bodies = capturePatches(() =>
      ok(testTaxDetails({ gstin: null, legalName: 'Acme Traders' }), TAX_DETAILS_SAVED_MESSAGE)
    )
    const user = userEvent.setup()
    renderCard()

    const gstin = await screen.findByRole('textbox', { name: 'GSTIN (optional)' })
    expect(gstin).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'Legal name' })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('')
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveTextContent('Choose a state')

    await user.type(screen.getByRole('textbox', { name: 'Legal name' }), 'Acme Traders')
    await user.click(saveButton())
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'State' })).toHaveAccessibleDescription(
        STATE_REQUIRED_MESSAGE
      )
    )
    expect(bodies).toHaveLength(0)

    await chooseState(user, 'Karnataka (29)')
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({
      version: null,
      gstin: null,
      legalName: 'Acme Traders',
      addressLine1: null,
      addressLine2: null,
      city: null,
      pincode: null,
      stateCode: '29',
      isSez: false,
    })
  })

  it('shows the stored details and sends only the changed city with the version', async () => {
    serveDetails(testTaxDetails())
    const bodies = capturePatches()
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    expect(screen.getByRole('textbox', { name: 'GSTIN (optional)' })).toHaveValue('29ABCDE1234F1ZW')
    expect(screen.getByRole('textbox', { name: 'Legal name' })).toHaveValue(
      'Acme Traders Private Limited'
    )
    expect(screen.getByRole('textbox', { name: 'Address line 1' })).toHaveValue('12 MG Road')
    expect(screen.getByRole('textbox', { name: 'Address line 2 (optional)' })).toHaveValue('')
    expect(city).toHaveValue('Bengaluru')
    expect(screen.getByRole('textbox', { name: 'PIN code' })).toHaveValue('560001')
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveTextContent('Karnataka (29)')
    expect(
      screen.getByRole('checkbox', { name: 'Special Economic Zone (SEZ) unit' })
    ).toHaveAttribute('aria-checked', 'false')

    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ version: 3, city: 'Mysuru' })
  })

  it('lets a stored GSTIN that today’s check refuses stand while another field is corrected', async () => {
    serveDetails(testTaxDetails({ gstin: '29ABCDE1234F1ZX' }))
    const bodies = capturePatches()
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ version: 3, city: 'Mysuru' })
  })

  it('asks for a change, and sends nothing, when nothing changed', async () => {
    serveDetails(testTaxDetails())
    const bodies = capturePatches()
    const user = userEvent.setup()
    renderCard()

    await screen.findByRole('textbox', { name: 'City' })
    await user.click(saveButton())
    expect(await screen.findByText(TAX_DETAILS_UNCHANGED_MESSAGE)).toBeInTheDocument()
    expect(bodies).toHaveLength(0)
  })

  it('refuses a GSTIN with a bad check character under GSTIN', async () => {
    serveDetails(testTaxDetails())
    const bodies = capturePatches()
    const user = userEvent.setup()
    renderCard()

    const gstin = await screen.findByRole('textbox', { name: 'GSTIN (optional)' })
    expect(gstin).toHaveAttribute('autocomplete', 'off')
    expect(gstin).toHaveAttribute('spellcheck', 'false')
    expect(gstin).toHaveAttribute('maxlength', '20')
    await user.clear(gstin)
    await user.type(gstin, '29ABCDE1234F1ZX')
    await user.click(saveButton())
    await waitFor(() => expect(gstin).toHaveAccessibleDescription(GSTIN_CHECKSUM_MESSAGE))
    expect(bodies).toHaveLength(0)
  })

  it('puts a GSTIN-state mismatch under State, and saves once the state matches', async () => {
    serveDetails(testTaxDetails())
    const bodies = capturePatches()
    const user = userEvent.setup()
    renderCard()

    const gstin = await screen.findByRole('textbox', { name: 'GSTIN (optional)' })
    await user.clear(gstin)
    await user.type(gstin, '27ABCDE1234F1Z0')
    await user.click(saveButton())
    const state = screen.getByRole('combobox', { name: 'State' })
    await waitFor(() =>
      expect(state).toHaveAccessibleDescription(gstinStateMismatchMessage('Maharashtra'))
    )
    expect(bodies).toHaveLength(0)

    await chooseState(user, 'Maharashtra (27)')
    expect(state).not.toHaveAccessibleDescription(gstinStateMismatchMessage('Maharashtra'))
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ version: 3, gstin: '27ABCDE1234F1Z0', stateCode: '27' })
  })

  it('drops a server error on State as soon as another state is chosen', async () => {
    serveDetails(testTaxDetails())
    capturePatches(() => invalid({ stateCode: [STATE_UNKNOWN_MESSAGE] }))
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    const state = screen.getByRole('combobox', { name: 'State' })
    await waitFor(() => expect(state).toHaveAccessibleDescription(STATE_UNKNOWN_MESSAGE))

    await chooseState(user, 'Kerala (32)')
    expect(screen.queryByText(STATE_UNKNOWN_MESSAGE)).not.toBeInTheDocument()
  })

  it('drops a server error on SEZ unit as soon as the box is ticked', async () => {
    serveDetails(testTaxDetails())
    capturePatches(() => invalid({ isSez: [SEZ_NEEDS_GSTIN_MESSAGE] }))
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    const message = await screen.findByText(SEZ_NEEDS_GSTIN_MESSAGE)

    const sez = screen.getByRole('checkbox', { name: 'Special Economic Zone (SEZ) unit' })
    // The visible control carries the error wiring, not Base UI's hidden input.
    expect(sez.tagName).toBe('SPAN')
    expect(sez).toHaveAttribute('aria-invalid', 'true')
    expect(sez.getAttribute('aria-describedby')).toBe(message.id)
    expect(sez).toHaveAccessibleDescription(SEZ_NEEDS_GSTIN_MESSAGE)

    await user.click(sez)
    expect(sez).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByText(SEZ_NEEDS_GSTIN_MESSAGE)).not.toBeInTheDocument()
    expect(sez).toHaveAttribute('aria-invalid', 'false')
  })

  it('puts a server error on PIN code under PIN code', async () => {
    serveDetails(testTaxDetails())
    capturePatches(() => invalid({ pincode: [PINCODE_MESSAGE] }))
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'PIN code' })).toHaveAccessibleDescription(
        PINCODE_MESSAGE
      )
    )
  })

  it('shows the server’s unchanged-save refusal at form level', async () => {
    serveDetails(testTaxDetails())
    capturePatches(() => fail(TAX_DETAILS_UNCHANGED_MESSAGE, 400))
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(TAX_DETAILS_UNCHANGED_MESSAGE)
  })

  it('confirms a save with the saved message', async () => {
    serveDetails(testTaxDetails())
    capturePatches()
    const success = vi.spyOn(toast, 'success')
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    await waitFor(() => expect(success).toHaveBeenCalledTimes(1))
    expect(success).toHaveBeenCalledWith(TAX_DETAILS_SAVED_MESSAGE)
    expect(city).toHaveValue('Mysuru')
  })

  it('diffs the next save against what was just saved, at the saved version', async () => {
    serveDetails(testTaxDetails())
    const bodies = capturePatches()
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))

    const pincode = screen.getByRole('textbox', { name: 'PIN code' })
    await user.clear(pincode)
    await user.type(pincode, '570001')
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual({ version: 4, pincode: '570001' })
  })

  it('keeps the version it started editing when the details refetch mid-edit', async () => {
    let current = testTaxDetails()
    server.use(http.get(DETAILS_URL, () => ok(current, 'Tax details retrieved.')))
    const bodies = capturePatches()
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    current = testTaxDetails({ pincode: '560002', version: 9 })
    await client.refetchQueries({ queryKey: taxKeys.details('acme') })
    expect(client.getQueryData(taxKeys.details('acme'))).toEqual(current)
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ version: 3, city: 'Mysuru' })
  })

  it('offers Reload on a version conflict, and saves at the reloaded version', async () => {
    let current = testTaxDetails()
    server.use(http.get(DETAILS_URL, () => ok(current, 'Tax details retrieved.')))
    let conflicted = false
    const bodies = capturePatches((body) => {
      if (!conflicted) {
        conflicted = true
        current = testTaxDetails({ city: 'Hubballi', version: 4 })
        return fail(CONFLICT_MESSAGE, 409, TAX_DETAILS_VERSION_CONFLICT)
      }
      return ok(testTaxDetails({ city: 'Hubballi', pincode: body.pincode as string, version: 5 }))
    })
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(CONFLICT_MESSAGE)

    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(city).toHaveValue('Hubballi'))
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()

    const pincode = screen.getByRole('textbox', { name: 'PIN code' })
    await user.clear(pincode)
    await user.type(pincode, '580020')
    await user.click(saveButton())
    await waitFor(() => expect(bodies).toHaveLength(2))
    expect(bodies[1]).toEqual({ version: 4, pincode: '580020' })
  })

  it('drops Reload with its message when the owner saves again', async () => {
    serveDetails(testTaxDetails())
    let calls = 0
    capturePatches(() => {
      calls += 1
      return calls === 1
        ? fail(CONFLICT_MESSAGE, 409, TAX_DETAILS_VERSION_CONFLICT)
        : invalid({ pincode: [PINCODE_MESSAGE] })
    })
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    await screen.findByRole('button', { name: 'Reload' })

    await user.click(saveButton())
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'PIN code' })).toHaveAccessibleDescription(
        PINCODE_MESSAGE
      )
    )
    expect(screen.queryByText(CONFLICT_MESSAGE)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument()
  })

  it('says the details didn’t load when Reload’s refetch fails', async () => {
    let failGet = false
    server.use(
      http.get(DETAILS_URL, () =>
        failGet ? fail('Internal error.', 500) : ok(testTaxDetails(), 'Tax details retrieved.')
      )
    )
    capturePatches(() => {
      failGet = true
      return fail(CONFLICT_MESSAGE, 409, TAX_DETAILS_VERSION_CONFLICT)
    })
    const user = userEvent.setup()
    renderCard()

    const city = await screen.findByRole('textbox', { name: 'City' })
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    await screen.findByRole('button', { name: 'Reload' })
    await user.click(screen.getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(LOAD_FAILED))
  })

  it('shows the server’s message and refetches billing when tax documents turned off', async () => {
    serveDetails(testTaxDetails())
    let billingCalls = 0
    server.use(
      http.get(BILLING_URL, () => {
        billingCalls += 1
        return fail('Not found.', 404)
      })
    )
    capturePatches(() => fail(DISABLED_WRITE_MESSAGE, 404, TAX_DOCUMENTS_DISABLED))
    const user = userEvent.setup()
    renderCard({ observeBilling: true })

    const city = await screen.findByRole('textbox', { name: 'City' })
    await waitFor(() => expect(billingCalls).toBe(1))
    await user.clear(city)
    await user.type(city, 'Mysuru')
    await user.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(DISABLED_WRITE_MESSAGE)
    await waitFor(() => expect(billingCalls).toBe(2))
  })

  it('lists every state, as name and code, with no empty choice', async () => {
    serveDetails(testTaxDetails())
    const user = userEvent.setup()
    renderCard()

    await user.click(await screen.findByRole('combobox', { name: 'State' }))
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(37)
    for (const option of options) expect(option.textContent).toMatch(/^.+ \(\d{2}\)$/)
  })

  it('gives PIN code a numeric keyboard and a 6-character limit', async () => {
    serveDetails(testTaxDetails())
    renderCard()
    const pincode = await screen.findByRole('textbox', { name: 'PIN code' })
    expect(pincode).toHaveAttribute('inputmode', 'numeric')
    expect(pincode).toHaveAttribute('maxlength', '6')
  })
})

describe('TaxDetailsCard, loading and failures', () => {
  it('holds the form’s place while the details load', () => {
    server.use(http.get(DETAILS_URL, () => new Promise<Response>(() => {})))
    const { container } = renderCard()
    expect(container.querySelectorAll('[data-slot="field-skeleton"]').length).toBeGreaterThan(0)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('renders nothing and refetches billing when tax documents are off', async () => {
    server.use(
      http.get(DETAILS_URL, () =>
        fail(
          'Tax documents are off, and this workspace has none to download.',
          404,
          TAX_DOCUMENTS_DISABLED
        )
      )
    )
    let billingCalls = 0
    server.use(
      http.get(BILLING_URL, () => {
        billingCalls += 1
        return fail('Not found.', 404)
      })
    )
    renderCard({ observeBilling: true })
    await waitFor(() => expect(billingCalls).toBe(2))
    expect(screen.queryByRole('heading', { name: 'Tax details' })).not.toBeInTheDocument()
  })

  it('says the details didn’t load, and Try again asks again', async () => {
    let calls = 0
    server.use(
      http.get(DETAILS_URL, () => {
        calls += 1
        return calls === 1
          ? fail('Internal error.', 500)
          : ok(testTaxDetails(), 'Tax details retrieved.')
      })
    )
    const user = userEvent.setup()
    renderCard()
    expect(await screen.findByRole('alert')).toHaveTextContent(LOAD_FAILED)
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('textbox', { name: 'City' })).toHaveValue('Bengaluru')
  })
})

describe('TaxDetailsCard, read-only', () => {
  it('shows the details as text, masked for analytics, with nothing to edit', async () => {
    serveDetails(testTaxDetails({ addressLine2: 'Ashok Nagar' }))
    renderCard({ editable: false })

    expect(
      await screen.findByText(
        'We no longer issue tax invoices. Your issued invoices and credit notes stay available to download.'
      )
    ).toBeInTheDocument()
    const gstin = await screen.findByText('29ABCDE1234F1ZW')
    expect(gstin.closest('.ph-sensitive.ph-mask')).not.toBeNull()
    expect(
      screen.getByText('Acme Traders Private Limited').closest('.ph-sensitive.ph-mask')
    ).not.toBeNull()
    for (const line of ['12 MG Road', 'Ashok Nagar', 'Bengaluru', '560001']) {
      expect(screen.getByText(line).closest('.ph-sensitive.ph-mask')).not.toBeNull()
    }
    const list = gstin.closest('dl')
    expect(list).not.toBeNull()
    expect(within(list as HTMLElement).getByText('Karnataka (29)')).toBeInTheDocument()
    expect(within(list as HTMLElement).getByText('No')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save tax details' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('reads None for a missing GSTIN and address, and Yes for an SEZ unit', async () => {
    serveDetails(
      testTaxDetails({
        gstin: null,
        addressLine1: null,
        city: null,
        pincode: null,
        isSez: true,
      })
    )
    renderCard({ editable: false })
    await screen.findByText('Acme Traders Private Limited')
    expect(screen.getAllByText('None')).toHaveLength(2)
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })

  it('says there are no details on file', async () => {
    serveDetails(null)
    renderCard({ editable: false })
    expect(await screen.findByText('No tax details on file.')).toBeInTheDocument()
  })
})
