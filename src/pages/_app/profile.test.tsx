import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetSessionForTests } from '@/http/session'
import { queryClient } from '@/router'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/states/auth.store'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'

function renderProfile() {
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/profile'] }),
  })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

describe('profile page', () => {
  beforeEach(() => {
    resetSessionForTests()
    queryClient.clear()
    useAuthStore.setState({
      accessToken: 'access-token',
      user: testUser,
      isAuthenticated: true,
      isBootstrapped: true,
    })
  })

  it('shows email and member-since as read-only facts', async () => {
    renderProfile()

    expect(await screen.findByText(testUser.email)).toBeInTheDocument()
    // Computed with the same formatter rather than hard-coded: a UTC midnight
    // renders as the previous day in a US-timezone runner.
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(
      new Date(testUser.createdAt)
    )
    expect(screen.getByText(expected)).toBeInTheDocument()
    // Neither has an endpoint, so neither has UI.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/google/i)).not.toBeInTheDocument()
  })

  it('sends only the trimmed first and last name', async () => {
    let body: unknown
    server.use(
      http.patch('/api/v1/profile', async ({ request }) => {
        body = await request.json()
        return ok({ ...testUser, firstName: 'Ada', lastName: 'Lovelace' }, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    const first = await screen.findByLabelText('First name')
    await user.clear(first)
    await user.type(first, '  Ada  ')
    const last = screen.getByLabelText('Last name')
    await user.clear(last)
    await user.type(last, 'Lovelace')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(body).toEqual({ firstName: 'Ada', lastName: 'Lovelace' })
    })
    // The layout reads the user off the store, so the store has to move too.
    await waitFor(() => {
      expect(useAuthStore.getState().user?.firstName).toBe('Ada')
    })
  })

  it('refuses to submit an empty name without touching the network', async () => {
    let called = false
    server.use(
      http.patch('/api/v1/profile', () => {
        called = true
        return ok(testUser, 'Profile updated.')
      })
    )
    const user = userEvent.setup()
    renderProfile()

    await user.clear(await screen.findByLabelText('First name'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('First name is required.')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it("renders the server's field errors inline and clears one when it changes", async () => {
    server.use(
      http.patch('/api/v1/profile', () =>
        HttpResponse.json(
          {
            success: false,
            message: 'Validation failed.',
            statusCode: 422,
            errors: { firstName: ['That name is not allowed.'] },
            requestId: 'test-request-id',
          },
          { status: 422 }
        )
      )
    )
    const user = userEvent.setup()
    renderProfile()

    await user.click(await screen.findByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('That name is not allowed.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('First name'), 'a')
    await waitFor(() => {
      expect(screen.queryByText('That name is not allowed.')).not.toBeInTheDocument()
    })
  })

  it('leaves the form usable when the request fails outright', async () => {
    server.use(http.patch('/api/v1/profile', () => fail('Something broke.', 500)))
    const user = userEvent.setup()
    renderProfile()

    await user.click(await screen.findByRole('button', { name: 'Save changes' }))

    // Still on the page, still editable — the failure is announced by a toast,
    // not by losing the user's typing.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    })
    expect(screen.getByLabelText('First name')).toHaveValue('A')
  })
})
