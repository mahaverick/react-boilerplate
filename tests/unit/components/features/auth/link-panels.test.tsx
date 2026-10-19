import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  SigningInStatus,
  SwitchAccountPanel,
  VerifyFailedPanel,
} from '@/components/features/auth/link-panels'
import { Pii } from '@/components/shared/pii'
import { PII_CLASS_NAME } from '@/observability/telemetry'

const CURRENT = 'grace@example.test'
const TARGET = 'ada@example.test'

/** Renders the switch panel with no-op handlers unless the test passes its own. */
function renderSwitch(props: Partial<Parameters<typeof SwitchAccountPanel>[0]> = {}) {
  const onContinue = vi.fn()
  const onStay = vi.fn()
  render(
    <SwitchAccountPanel
      kind="link"
      currentEmail={CURRENT}
      targetEmail={TARGET}
      continuing={false}
      onContinue={onContinue}
      onStay={onStay}
      {...props}
    />
  )
  return { onContinue, onStay }
}

describe('SigningInStatus', () => {
  it('announces the label once, beside a hidden spinner', () => {
    render(<SigningInStatus label="Signing you in…" />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Signing you in…')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('names the address being signed in, masked', () => {
    render(<SigningInStatus label="Signing you in…" email={TARGET} />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(`Signing you in…This link is for ${TARGET}.`)
    const address = screen.getByText(TARGET)
    expect(status).toContainElement(address)
    expect(address).toHaveClass(PII_CLASS_NAME)
  })

  it('takes a label that names the address inline, masked, in the one live region', () => {
    render(
      <SigningInStatus
        label={
          <>
            Joining Acme as <Pii>{TARGET}</Pii>…
          </>
        }
      />
    )

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(`Joining Acme as ${TARGET}…`)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByText(TARGET)).toHaveClass(PII_CLASS_NAME)
    expect(status).not.toHaveTextContent('This link is for')
  })
})

describe('SwitchAccountPanel', () => {
  it('words a link switch and an invitation switch as the spec quotes', () => {
    renderSwitch()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent === `You’re signed in as ${CURRENT}. This link is for ${TARGET}.`
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Continue as ${TARGET}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Stay signed in as ${CURRENT}` })).toBeInTheDocument()

    cleanup()
    renderSwitch({ kind: 'invitation' })
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            `This invitation is for ${TARGET}. You’re signed in as ${CURRENT}.`
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Continue as ${TARGET}` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('masks both addresses', () => {
    renderSwitch()

    const current = screen.getAllByText(CURRENT)
    const target = screen.getAllByText(TARGET)
    // Once in the sentence and once in each button.
    expect(current).toHaveLength(2)
    expect(target).toHaveLength(2)
    for (const address of [...current, ...target]) expect(address).toHaveClass(PII_CLASS_NAME)
  })

  it('calls onContinue and onStay', async () => {
    const user = userEvent.setup()
    const { onContinue, onStay } = renderSwitch()

    await user.click(screen.getByRole('button', { name: `Continue as ${TARGET}` }))
    expect(onContinue).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: `Stay signed in as ${CURRENT}` }))
    expect(onStay).toHaveBeenCalledTimes(1)
  })

  it('shows the switch running and holds both buttons', async () => {
    const user = userEvent.setup()
    const { onContinue, onStay } = renderSwitch({ continuing: true })

    const busy = screen.getByRole('button', { name: 'Signing out…' })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    await user.click(busy)
    await user.click(screen.getByRole('button', { name: `Stay signed in as ${CURRENT}` }))
    expect(onContinue).not.toHaveBeenCalled()
    expect(onStay).not.toHaveBeenCalled()
  })

  it('falls back to another account without a target', () => {
    renderSwitch({ targetEmail: null })
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            `You’re signed in as ${CURRENT}. This link is for another account.`
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with this link' })).toBeInTheDocument()

    cleanup()
    renderSwitch({ kind: 'invitation', targetEmail: null })
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            `This invitation is for another account. You’re signed in as ${CURRENT}.`
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue with this link' })).toBeInTheDocument()
  })
})

describe('VerifyFailedPanel', () => {
  it('shows the message and retries', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(
      <VerifyFailedPanel message="Too many requests." retrying={false} onRetry={onRetry} />
    )

    expect(screen.getByRole('alert')).toHaveTextContent('Too many requests.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<VerifyFailedPanel message="Too many requests." retrying onRetry={onRetry} />)
    expect(screen.getByRole('button', { name: 'Trying again…' })).toHaveAttribute(
      'aria-busy',
      'true'
    )
  })
})
