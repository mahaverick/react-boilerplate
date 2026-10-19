import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSignedInElsewhere } from '@/hooks/use-signed-in-elsewhere'
import { ensureSession, resetSessionForTests, subscribeAuthMessage } from '@/http/session'
import { useAuthStore } from '@/states/auth.store'
import { testUser } from '@/tests/mocks/handlers'

vi.mock('@/http/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/http/session')>()),
  ensureSession: vi.fn(),
}))

beforeEach(() => {
  resetSessionForTests()
  vi.mocked(ensureSession).mockReset()
  useAuthStore.setState({
    accessToken: null,
    user: null,
    isAuthenticated: false,
    isBootstrapped: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A page that listens while `listening`, with `onSignedIn` as its handler. */
function Listener({ listening, onSignedIn }: { listening: boolean; onSignedIn: () => void }) {
  useSignedInElsewhere(listening, onSignedIn)
  return <p>Waiting</p>
}

/** Renders a page listening for another tab's confirm, with `onSignedIn` as its handler. */
function renderListener(onSignedIn = vi.fn(), listening = true) {
  const view = render(<Listener listening={listening} onSignedIn={onSignedIn} />)
  return {
    onSignedIn,
    setListening: (next: boolean) =>
      view.rerender(<Listener listening={next} onSignedIn={onSignedIn} />),
  }
}

/** Posts `signed_in` as another tab would. */
function postFromAnotherTab() {
  const otherTab = new BroadcastChannel('auth')
  otherTab.postMessage({ type: 'signed_in' })
  otherTab.close()
}

/**
 * Posts `signed_in` from another tab and waits until a listener registered
 * after the page's has heard it: the channel delivers in order, so by then
 * the page has made its choice.
 */
async function postAndWait() {
  const heard = vi.fn()
  const stop = subscribeAuthMessage('signed_in', heard)
  postFromAnotherTab()
  await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1))
  stop()
}

/** A session restore that settles only when the test calls `restore`. */
function heldRestore() {
  let resolveRestore: ((token: string) => void) | null = null
  const restored = new Promise<string>((resolve) => {
    resolveRestore = resolve
  })
  return { restored, restore: (token: string) => resolveRestore?.(token) }
}

describe('useSignedInElsewhere', () => {
  it('restores the session once for a burst of messages, then calls onSignedIn', async () => {
    const order: string[] = []
    vi.mocked(ensureSession).mockImplementation(() => {
      order.push('ensureSession')
      return Promise.resolve('access-token')
    })
    const { onSignedIn } = renderListener(vi.fn(() => order.push('onSignedIn')))

    postFromAnotherTab()
    postFromAnotherTab()

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
    expect(ensureSession).toHaveBeenCalledOnce()
    expect(order).toEqual(['ensureSession', 'onSignedIn'])
  })

  it('stays put when the restore fails, and tries again on the next message', async () => {
    vi.mocked(ensureSession).mockRejectedValueOnce(new Error('refresh failed'))
    vi.mocked(ensureSession).mockResolvedValueOnce('access-token')
    const { onSignedIn } = renderListener()

    await postAndWait()
    await vi.waitFor(() => expect(ensureSession).toHaveBeenCalledOnce())
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(screen.getByText('Waiting')).toBeVisible()

    postFromAnotherTab()
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
    expect(ensureSession).toHaveBeenCalledTimes(2)
  })

  it('ignores it in a tab that is already signed in', async () => {
    const { onSignedIn } = renderListener()
    useAuthStore.getState().login('access-token', testUser)

    await postAndWait()

    expect(ensureSession).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('does not move on when the restore settles after unmount', async () => {
    const { restored, restore } = heldRestore()
    vi.mocked(ensureSession).mockReturnValue(restored)
    const { onSignedIn } = renderListener()

    postFromAnotherTab()
    await vi.waitFor(() => expect(ensureSession).toHaveBeenCalledOnce())
    cleanup()
    // Settling the restore is the barrier: its then-callbacks run inside this act.
    await act(async () => {
      restore('access-token')
      await restored
    })

    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('does not listen while no link is out', async () => {
    const { onSignedIn } = renderListener(vi.fn(), false)

    await postAndWait()

    expect(ensureSession).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('stops listening once listening turns off', async () => {
    const { onSignedIn, setListening } = renderListener()
    setListening(false)

    await postAndWait()

    expect(ensureSession).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('stops listening once unmounted', async () => {
    const { onSignedIn } = renderListener()
    cleanup()

    await postAndWait()

    expect(ensureSession).not.toHaveBeenCalled()
    expect(onSignedIn).not.toHaveBeenCalled()
  })
})
