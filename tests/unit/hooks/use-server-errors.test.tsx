import { useForm } from '@tanstack/react-form'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { toast } from 'sonner'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { READ_ONLY_TOAST_ID } from '@/constants/maintenance-mode'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'

/** A 400 carrying detail for one field and one schema-level issue. */
function validationFailure(): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Validation failed.', '400', config, null, {
    data: {
      success: false,
      message: 'Validation failed.',
      statusCode: 400,
      errors: { email: ['Already taken.'], formErrors: ['Those two do not go together.'] },
      requestId: 'test-request-id',
    },
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config,
  })
}

/** A refusal carrying only a message: no `errors` map at all. */
function plainFailure(message: string, status: number): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError(message, String(status), config, null, {
    data: { success: false, message, statusCode: status, requestId: 'test-request-id' },
    status,
    statusText: 'Error',
    headers: {},
    config,
  })
}

/** A 400 naming a field the form may not render. */
function failureNaming(field: string): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Validation failed.', '400', config, null, {
    data: {
      success: false,
      message: 'Validation failed.',
      statusCode: 400,
      errors: { [field]: ['Not allowed.'] },
      requestId: 'test-request-id',
    },
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config,
  })
}

/** A 400 whose detail is all field-level. */
function fieldOnlyFailure(): AxiosError {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Validation failed.', '400', config, null, {
    data: {
      success: false,
      message: 'Validation failed.',
      statusCode: 400,
      errors: { email: ['Already taken.'] },
      requestId: 'test-request-id',
    },
    status: 400,
    statusText: 'Bad Request',
    headers: {},
    config,
  })
}

/**
 * A form with nothing behind it, so the bridge itself is the subject rather
 * than a page's copy. `options` turns on the shapes that `<Form>` has to cope
 * with: a page that forgets `<FormError>`, a control that names itself, and a
 * page that passes its own handlers.
 */
function Fixture({
  withFormError = true,
  controlName,
  failure = validationFailure,
  onChange,
  onSubmit,
}: {
  withFormError?: boolean
  controlName?: string
  /** What the submit fails with; `null` makes it succeed. */
  failure?: (() => AxiosError) | null
  onChange?: () => void
  onSubmit?: () => void
}) {
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { email: '', nickname: '' },
    onSubmit: async () => {
      // A request's worth of delay, so the capture lands in a promise continuation, as it does on every page.
      await Promise.resolve()
      if (failure) serverErrors.capture(failure())
    },
  })

  return (
    <Form
      form={form}
      serverErrors={serverErrors}
      onChange={onChange}
      onSubmit={onSubmit}
      aria-label="fixture"
    >
      <FormField form={form} name="email">
        {(field) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input
                name={controlName}
                value={fieldValue(field.state.value)}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="nickname">
        {(field) => (
          <FormItem>
            <FormLabel>Nickname</FormLabel>
            <FormControl>
              <Input
                value={fieldValue(field.state.value)}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      {withFormError && <FormError />}
      <button type="submit">Save</button>
    </Form>
  )
}

async function submit() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  return user
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the server-error bridge in <Form>', () => {
  it('shows a captured field error and clears it when that field changes', async () => {
    render(<Fixture />)
    const user = await submit()

    expect(await screen.findByText('Already taken.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'a')
    await waitFor(() => {
      expect(screen.queryByText('Already taken.')).not.toBeInTheDocument()
    })
  })

  it('warns in dev when form-level errors have nowhere to render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Fixture withFormError={false} />)
    await submit()

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('<FormError>'),
        expect.arrayContaining(['Those two do not go together.'])
      )
    })
    // The detail really is invisible — that is what the warning is for.
    expect(screen.queryByText('Those two do not go together.')).not.toBeInTheDocument()
  })

  it('stays quiet when <FormError> is mounted, and renders the messages', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Fixture />)
    await submit()

    expect(await screen.findByText('Those two do not go together.')).toBeInTheDocument()
    expect(warn).not.toHaveBeenCalled()
  })

  it("overrides a control's own name, so clearing targets the right field", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Fixture controlName="explicit" />)
    const user = await submit()

    expect(await screen.findByText('Already taken.')).toBeInTheDocument()
    // Left to itself, the change event would carry name="explicit" and clear nothing — the error would sit there while the user retyped the address.
    expect(screen.getByLabelText('Email')).toHaveAttribute('name', 'email')
    await user.type(screen.getByLabelText('Email'), 'a')
    await waitFor(() => {
      expect(screen.queryByText('Already taken.')).not.toBeInTheDocument()
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('explicit'))
  })

  it("runs a page's own onChange and onSubmit without losing its own", async () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    render(<Fixture onChange={onChange} onSubmit={onSubmit} />)
    const user = await submit()

    // Both of the bridge's jobs still happen: submission ran (it is what captured the error) and clearing still works.
    expect(onSubmit).toHaveBeenCalled()
    expect(await screen.findByText('Already taken.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'a')
    expect(onChange).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText('Already taken.')).not.toBeInTheDocument()
    })
  })

  it('ties a field message to its control without making it a live region', async () => {
    render(<Fixture />)
    await submit()

    const message = await screen.findByText('Already taken.')
    expect(message).not.toHaveAttribute('role')
    expect(message.id).not.toBe('')
    const email = screen.getByLabelText('Email')
    expect(email).toHaveAttribute('aria-describedby', message.id)
    expect(email).toHaveAttribute('aria-invalid', 'true')
    // The form-level message stays the live region.
    expect(
      screen.getByText('Those two do not go together.').closest('[role="alert"]')
    ).not.toBeNull()
  })

  it('warns in dev when a server error names a field the form does not render', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Fixture failure={() => failureNaming('phone')} />)
    await submit()

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('phone'), ['phone'])
    })
  })

  it('stays quiet when every field a server error names is rendered', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<Fixture failure={fieldOnlyFailure} />)
    await submit()

    expect(await screen.findByText('Already taken.')).toBeInTheDocument()
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('focus after submit', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('moves focus to the first field a server error names, described by its message', async () => {
    // The frame fires at once: the worst case, a frame that arrives before React's own scheduled render. Only a committed error can be found then.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    render(<Fixture failure={fieldOnlyFailure} />)
    await submit()

    const email = screen.getByLabelText('Email')
    await waitFor(() => expect(email).toHaveFocus())
    const message = screen.getByText('Already taken.')
    expect(email).toHaveAttribute('aria-describedby', message.id)
  })

  it('leaves focus where it was after a successful submit', async () => {
    render(<Fixture failure={null} />)
    await submit()

    // Two frames: the focus step runs one frame after the submit settles.
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
    await act(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))))
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus()
  })
})

describe('setFieldError', () => {
  it('adds to what capture set in the same tick, and clears like any other', () => {
    const { result } = renderHook(() => useServerErrors())

    // A capture and a hand-set field message in one tick, before React renders in between.
    act(() => {
      result.current.capture(validationFailure())
      result.current.setFieldError('nickname', ['Taken by a member.'])
    })
    expect(result.current.fieldErrors).toEqual({
      email: ['Already taken.'],
      nickname: ['Taken by a member.'],
    })

    act(() => {
      result.current.clearField('nickname')
    })
    expect(result.current.fieldErrors).toEqual({ email: ['Already taken.'] })
  })
})

describe('capture', () => {
  it('shows the message at form level when the response names no field', () => {
    const { result } = renderHook(() => useServerErrors())

    act(() => {
      result.current.capture(plainFailure('Too many attempts. Please try again later.', 429))
    })

    expect(result.current.formErrors).toEqual(['Too many attempts. Please try again later.'])
    expect(result.current.fieldErrors).toEqual({})
  })

  it('falls back to the generic message when no response arrived', () => {
    const { result } = renderHook(() => useServerErrors())

    act(() => {
      result.current.capture(new Error('Network Error'))
    })

    expect(result.current.formErrors).toEqual(['Something went wrong. Please try again.'])
  })

  it('leaves the envelope message out when the response carries field detail', () => {
    const { result } = renderHook(() => useServerErrors())

    act(() => {
      result.current.capture(fieldOnlyFailure())
    })

    expect(result.current.formErrors).toEqual([])
    expect(result.current.fieldErrors).toEqual({ email: ['Already taken.'] })
  })
  it('toasts a read-only refusal once, and puts nothing on the form', () => {
    const toastError = vi.spyOn(toast, 'error')
    const { result } = renderHook(() => useServerErrors())
    const config = { headers: new AxiosHeaders() }
    const refusal = () =>
      new AxiosError('Service Unavailable', '503', config, null, {
        data: {
          success: false,
          message: 'Upgrading the database.',
          statusCode: 503,
          code: 'READ_ONLY_MODE',
          requestId: 'test-request-id',
        },
        status: 503,
        statusText: 'Service Unavailable',
        headers: {},
        config,
      })

    act(() => {
      result.current.capture(refusal())
      result.current.capture(refusal())
    })

    expect(result.current.formErrors).toEqual([])
    expect(result.current.fieldErrors).toEqual({})
    expect(toastError).toHaveBeenCalledWith('Changes are paused during maintenance.', {
      id: READ_ONLY_TOAST_ID,
    })
    expect(new Set(toastError.mock.calls.map(([, options]) => options?.id))).toEqual(
      new Set([READ_ONLY_TOAST_ID])
    )
  })
})

describe('setFormErrors', () => {
  it('replaces the form-level messages, and reset drops them', () => {
    const { result } = renderHook(() => useServerErrors())

    act(() => {
      result.current.setFormErrors(['Someone got there first.'])
    })
    expect(result.current.formErrors).toEqual(['Someone got there first.'])

    act(() => {
      result.current.reset()
    })
    expect(result.current.formErrors).toEqual([])
  })
})
