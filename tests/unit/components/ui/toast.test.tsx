import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Toast,
  Toaster,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  useToastManager,
} from '@/components/ui/toast'
import { toast, toastManager } from '@/lib/toast'
import { PII_CLASS_NAME } from '@/observability/telemetry'

/** The toast region Base UI renders, which every toast sits in. */
function region(): HTMLElement {
  return screen.getByRole('region', { name: 'Status messages' })
}

/** The toast whose title is `title`: Base UI names each toast's dialog by its title. */
async function findToast(title: string): Promise<HTMLElement> {
  return within(region()).findByRole('dialog', { name: title })
}

/** Renders each queued toast with a caller's `className`, through the same root as `<Toaster>`. */
function ExtraClassList() {
  const { toasts } = useToastManager()
  return toasts.map((item) => (
    <Toast key={item.id} toast={item} className="extra">
      <ToastTitle />
    </Toast>
  ))
}

describe('Toaster', () => {
  it.each([
    ['success', 'text-success'],
    ['error', 'text-destructive'],
    ['warning', 'text-warning-strong'],
  ] as const)(
    'renders a %s toast with its title, description and icon',
    async (type, iconClass) => {
      render(<Toaster />)
      act(() => toast[type](`A ${type} title`, { description: `A ${type} description` }))

      const item = await findToast(`A ${type} title`)
      expect(item).toHaveAccessibleDescription(`A ${type} description`)
      expect(item).toHaveAttribute('data-type', type)
      expect(region()).toHaveAttribute('aria-live', 'polite')
      expect(item.querySelector('[data-slot="toast-icon"] svg')).toHaveClass(iconClass)
    }
  )

  it('masks every toast for analytics', async () => {
    render(<Toaster />)
    act(() => toast.success('Invited ada@example.com'))

    expect(await findToast('Invited ada@example.com')).toHaveClass(...PII_CLASS_NAME.split(' '))
  })

  // A caller's className used to replace the masking classes, unmasking every toast.
  it('keeps the mask when a caller passes its own className', async () => {
    render(
      <ToastProvider toastManager={toastManager}>
        <ToastViewport aria-label="Status messages">
          <ExtraClassList />
        </ToastViewport>
      </ToastProvider>
    )
    act(() => toast.success('Removed grace@example.com'))

    const item = await findToast('Removed grace@example.com')
    expect(item).toHaveClass('extra', ...PII_CLASS_NAME.split(' '))
  })

  it('closes a toast from its labelled close button', async () => {
    const user = userEvent.setup()
    render(<Toaster />)
    act(() => toast.error('Could not save.'))

    const item = await findToast('Could not save.')
    // Base UI hides the close button from assistive tech until the stack expands on hover or focus.
    await user.hover(item)
    await user.click(within(item).getByRole('button', { name: 'Close toast' }))

    await waitFor(() => expect(item).not.toBeInTheDocument())
  })

  it('renders an action button that runs its handler and closes the toast', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Toaster />)
    act(() => toast.warning('The email was not sent.', { action: { label: 'Resend', onClick } }))

    const item = await findToast('The email was not sent.')
    await user.hover(item)
    await user.click(within(item).getByRole('button', { name: 'Resend' }))

    expect(onClick).toHaveBeenCalledOnce()
    await waitFor(() => expect(item).not.toBeInTheDocument())
  })

  it('closes only its own toast when an action toast has an id', async () => {
    const user = userEvent.setup()
    render(<Toaster />)
    act(() => {
      toast.success('Saved.')
      toast.warning('Not sent.', { id: 'mail', action: { label: 'Retry', onClick: () => {} } })
    })

    const item = await findToast('Not sent.')
    await user.hover(item)
    await user.click(within(item).getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(item).not.toBeInTheDocument())
    expect(await findToast('Saved.')).toBeInTheDocument()
  })

  it('updates the shown toast in place when a raise repeats its id', async () => {
    render(<Toaster />)
    act(() => toast.error('Changes are paused.', { id: 'read-only' }))
    await findToast('Changes are paused.')

    act(() => toast.error('Still paused.', { id: 'read-only', description: 'Try again soon.' }))

    const item = await findToast('Still paused.')
    expect(item).toHaveAccessibleDescription('Try again soon.')
    expect(within(region()).getAllByRole('dialog')).toHaveLength(1)
    expect(within(region()).queryByText('Changes are paused.')).toBeNull()
  })
})
