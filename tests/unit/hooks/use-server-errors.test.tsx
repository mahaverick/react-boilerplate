import { useForm } from '@tanstack/react-form'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
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

/**
 * A form with nothing behind it, so the bridge itself is the subject rather
 * than a page's copy. `options` turns on the shapes that `<Form>` has to cope
 * with: a page that forgets `<FormError>`, a control that names itself, and a
 * page that passes its own handlers.
 */
function Fixture({
  withFormError = true,
  controlName,
  onChange,
  onSubmit,
}: {
  withFormError?: boolean
  controlName?: string
  onChange?: () => void
  onSubmit?: () => void
}) {
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { email: '', nickname: '' },
    onSubmit: () => {
      serverErrors.capture(validationFailure())
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
    // Left to itself, the change event would carry name="explicit" and clear
    // nothing — the error would sit there while the user retyped the address.
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

    // Both of the bridge's jobs still happen: submission ran (it is what
    // captured the error) and clearing still works.
    expect(onSubmit).toHaveBeenCalled()
    expect(await screen.findByText('Already taken.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'a')
    expect(onChange).toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText('Already taken.')).not.toBeInTheDocument()
    })
  })
})

describe('setFieldError', () => {
  it('adds to what capture set in the same tick, and clears like any other', () => {
    const { result } = renderHook(() => useServerErrors())

    // The invite form does exactly this: capture the 409, then put its
    // message on the email field, before React renders in between.
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
