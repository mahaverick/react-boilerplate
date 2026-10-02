// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { parseRuntimeConfig, RUNTIME_CONFIG_KEYS } from '@/configs/runtime-config'
import {
  renderRuntimeConfig,
  RUNTIME_CONFIG_NAMES,
  runtimeConfigPlugin,
} from '../../scripts/runtime-config-plugin.mjs'

/** What `window.__APP_CONFIG__` is after the browser runs `source`. */
function evaluate(source: string): Record<string, unknown> {
  const window: { __APP_CONFIG__?: Record<string, unknown> } = {}
  runInNewContext(source, { window })
  return window.__APP_CONFIG__ ?? {}
}

describe('the dev server’s /runtime-config.js', () => {
  it('names the same settings as the bundle', () => {
    expect([...RUNTIME_CONFIG_NAMES]).toEqual([...RUNTIME_CONFIG_KEYS])
  })

  it('renders each VITE_ setting under its container name, frozen, and nothing else', () => {
    const written = evaluate(
      renderRuntimeConfig({
        VITE_POSTHOG_KEY: 'phc_test_key_not_real',
        VITE_APP_ENVIRONMENT: 'development',
        VITE_OTHER: 'not a setting',
        MODE: 'development',
      })
    )
    expect(Object.isFrozen(written)).toBe(true)
    expect(written).toEqual({
      POSTHOG_KEY: 'phc_test_key_not_real',
      POSTHOG_UI_HOST: '',
      ANALYTICS_CONSENT_MODE: '',
      ANALYTICS_HANDOFF_ORIGINS: '',
      APP_ENVIRONMENT: 'development',
    })
    expect(parseRuntimeConfig(written).config.posthogKey).toBe('phc_test_key_not_real')
  })

  it('escapes a value as a JSON string, so a stray quote cannot end the script', () => {
    const written = evaluate(renderRuntimeConfig({ VITE_APP_ENVIRONMENT: '"});alert(1);({"' }))
    expect(written.APP_ENVIRONMENT).toBe('"});alert(1);({"')
  })

  it('serves the rendered file, uncached, on the dev and the preview server', () => {
    const plugin = runtimeConfigPlugin() as unknown as {
      configResolved: (config: { env: Record<string, unknown> }) => void
      configureServer: (server: unknown) => void
      configurePreviewServer: (server: unknown) => void
    }
    plugin.configResolved({ env: { VITE_POSTHOG_KEY: 'phc_test_key_not_real' } })
    for (const configure of [plugin.configureServer, plugin.configurePreviewServer]) {
      const use = vi.fn()
      configure({ middlewares: { use } })
      expect(use).toHaveBeenCalledWith('/runtime-config.js', expect.any(Function))
      const handler = use.mock.calls[0]?.[1] as (request: unknown, response: unknown) => void
      const response = { setHeader: vi.fn(), end: vi.fn() }
      handler({}, response)
      expect(response.setHeader).toHaveBeenCalledWith('Content-Type', 'application/javascript')
      expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
      const body = response.end.mock.calls[0]?.[0] as string
      expect(evaluate(body).POSTHOG_KEY).toBe('phc_test_key_not_real')
    }
  })
})
