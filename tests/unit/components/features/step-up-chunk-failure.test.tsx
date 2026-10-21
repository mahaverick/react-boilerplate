import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StepUpProvider } from '@/components/features/step-up/step-up-provider'
import { useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { apiClient } from '@/http/client'
import { useAuthStore } from '@/states/auth.store'
import { fail, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { REAUTH_REQUIRED } from '@/types/api.types'

// The lazy dialog chunk fails to load, as after a deploy removed it.
vi.mock('@/components/features/step-up/step-up-dialog', () => {
  throw new Error('Failed to fetch dynamically imported module')
})

/** Runs two guarded actions at once and shows how each ended and whether the step-up still waits. */
function Harness() {
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const [outcomes, setOutcomes] = useState<string[]>([])
  /** Runs one refused action and records that it failed. */
  const start = (name: string) =>
    stepUp
      .run(() => apiClient.post('/danger', {}))
      .catch(() => setOutcomes((current) => [...current, `${name} failed`]))
  return (
    <>
      <button
        type="button"
        onClick={() => {
          void start('first')
          void start('second')
        }}
      >
        Do both
      </button>
      <p>waiting: {String(waiting)}</p>
      <p>{outcomes.join(', ')}</p>
    </>
  )
}

describe('StepUpProvider when the dialog chunk fails to load', () => {
  it('rejects every waiter and stops waiting, so buttons are not left disabled', async () => {
    useAuthStore.setState({
      accessToken: 'old-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
    server.use(
      http.post('/api/v1/danger', () => fail('Recent sign-in required', 401, REAUTH_REQUIRED))
    )
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StepUpProvider>
          <Harness />
        </StepUpProvider>
      </QueryClientProvider>
    )
    await user.click(screen.getByRole('button', { name: 'Do both' }))

    expect(await screen.findByText('first failed, second failed')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('waiting: false')).toBeInTheDocument())
  })
})
