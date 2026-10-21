import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

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

  it('imports a template whose first import failed a second time, then renders it without suspending', async () => {
    const actualRouter =
      await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
    const actualSkeleton = await vi.importActual<
      typeof import('@/components/shared/page-skeleton')
    >('@/components/shared/page-skeleton')
    const imports: Record<string, number> = {}
    vi.resetModules()
    vi.doMock('@tanstack/react-router', () => ({
      ...actualRouter,
      /** The real wrapper, over an importer that fails the first time each template asks. */
      lazyRouteComponent: (_importer: unknown, name: string) =>
        actualRouter.lazyRouteComponent(() => {
          imports[name] = (imports[name] ?? 0) + 1
          return imports[name] === 1
            ? Promise.reject(new Error('chunk failed'))
            : Promise.resolve(actualSkeleton)
        }, name as 'ListPending'),
    }))
    const templates = await import('@/components/shared/pending-templates')
    await templates.templatesReady

    expect(imports['DetailPending']).toBe(2)
    expect(imports['ListPending']).toBe(2)
    // No Suspense boundary: a template that had not loaded would throw here.
    render(<templates.DetailPending />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
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
