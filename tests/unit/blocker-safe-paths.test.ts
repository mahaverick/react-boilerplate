import { describe, expect, it } from 'vite-plus/test'

/**
 * In dev, Vite serves every source file at its own URL (`/src/...`), so a
 * content blocker that matches the path drops a static import and the whole
 * module graph fails to load. Each entry is a generic EasyPrivacy rule shape.
 */
const BLOCKER_TRIGGERS: readonly RegExp[] = [
  // EasyPrivacy `/analytics/?event=`, `/analytics/analytics.js` and hundreds more.
  /\/analytics\//,
  // EasyPrivacy `/adobe-analytics.js`, `.v4.analytics.`.
  /analytics\./,
  // EasyPrivacy `/tracking/digitaldata.js`, `/tracking/cookies?`.
  /\/tracking\//,
  // EasyPrivacy `/track.v2.js`, `/track.srv.`.
  /\/track\./,
  // EasyPrivacy `/pixel-tracker.js`, `/pixel.*/track/*`.
  /\/pixel/,
  // EasyPrivacy `/beacon.js`, `/beacon/affiliates`.
  /\/beacon/,
  // EasyPrivacy `/analytics/event`, which blocked `analytics/events.ts` in dev.
  /\/(?:analytics|telemetry|tracking|metrics|stats)\/events?[./]/,
]

// Keys only: the scan needs the paths, not the contents. The glob is relative to the repo root.
const SOURCE_PATHS = Object.keys(import.meta.glob('/src/**/*'))

/**
 * Lists the triggers a path matches.
 * @param path - A root-relative path, as the dev server serves it.
 * @returns The matching patterns.
 */
function triggersFor(path: string): RegExp[] {
  return BLOCKER_TRIGGERS.filter((trigger) => trigger.test(path.toLowerCase()))
}

describe('source paths a content blocker would drop', () => {
  it('each trigger catches a path that was once blocked or is listed', () => {
    const blocked = [
      '/src/observability/analytics/events.ts',
      '/src/observability/route-analytics.ts',
      '/src/lib/tracking/index.ts',
      '/src/lib/track.ts',
      '/src/lib/pixel.ts',
      '/src/lib/beacon.ts',
      '/src/observability/telemetry/events.ts',
    ]
    for (const [index, path] of blocked.entries()) {
      expect(BLOCKER_TRIGGERS[index]?.test(path)).toBe(true)
    }
  })

  it('appear nowhere under src', () => {
    // Not vacuous: the glob found the files the dev server serves.
    expect(SOURCE_PATHS).toContain('/src/main.tsx')
    expect(SOURCE_PATHS).toContain('/src/observability/telemetry/event-registry.ts')
    const offenders = SOURCE_PATHS.filter((path) => triggersFor(path).length > 0)
    expect(offenders).toEqual([])
  })
})
