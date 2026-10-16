import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Loads a fresh `pending-templates` whose page-skeleton chunk is the one `chunk` returns. */
async function loadModule(chunk: () => Promise<unknown>) {
  vi.resetModules()
  vi.doMock('@/components/shared/page-skeleton', chunk as never)
  return import('@/components/shared/pending-templates')
}

describe('the startup preload', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })
  afterEach(() => {
    vi.doUnmock('@/components/shared/page-skeleton')
    vi.resetModules()
  })

  it('has loaded every template, with no preload call from the caller, once templatesReady settles', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const actual = await vi.importActual<typeof import('@/components/shared/page-skeleton')>(
      '@/components/shared/page-skeleton'
    )
    const templates = await loadModule(async () => {
      await gate
      return actual
    })
    let ready = false
    void templates.templatesReady.then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)

    release()
    await templates.templatesReady

    // No Suspense boundary and no preload call here: a template that was not loaded by startup would throw.
    const { SettingsPagePending, DetailPending } = templates
    render(
      <>
        <SettingsPagePending />
        <DetailPending />
      </>
    )
    expect(screen.getAllByRole('status', { name: 'Loading' })).toHaveLength(2)
  })

  it('retries a template that failed to load once before settling, and settles when it fails twice', async () => {
    const calls: Record<string, number> = {}
    vi.resetModules()
    vi.doMock('@tanstack/react-router', () => ({
      /** A wrapper whose preload fails the first time, and always for ListPending. */
      lazyRouteComponent: (_load: unknown, name: string) => {
        /** A stand-in route component. */
        const wrapper = () => null
        /** Counts the call, then fails or loads. */
        wrapper.preload = () => {
          calls[name] = (calls[name] ?? 0) + 1
          return name === 'ListPending' || calls[name] === 1
            ? Promise.reject(new Error('chunk failed'))
            : Promise.resolve()
        }
        return wrapper
      },
    }))
    const templates = await import('@/components/shared/pending-templates')
    await expect(templates.templatesReady).resolves.toBeUndefined()
    expect(calls['DetailPending']).toBe(2)
    expect(calls['ListPending']).toBe(2)
    vi.doUnmock('@tanstack/react-router')
  })

  it('stops waiting for a template whose chunk never settles after TEMPLATES_WAIT_MS', async () => {
    vi.resetModules()
    vi.doMock('@tanstack/react-router', () => ({
      /** A wrapper whose preload never settles. */
      lazyRouteComponent: () => {
        /** A stand-in route component. */
        const wrapper = () => null
        wrapper.preload = () => new Promise<void>(() => undefined)
        return wrapper
      },
    }))
    const templates = await import('@/components/shared/pending-templates')
    vi.useFakeTimers()
    let done = false
    void templates.waitForTemplates().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(templates.TEMPLATES_WAIT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    vi.useRealTimers()
    vi.doUnmock('@tanstack/react-router')
  })
})
