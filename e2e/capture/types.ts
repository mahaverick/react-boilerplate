/**
 * @file The capture manifest's types. A manifest is keyed by the router's
 * `FileRoutesByFullPath`, so a route missing from it fails `pnpm typecheck:e2e`.
 */

/** A doc page under docs/pages/ that a route's shots belong to. */
type Area = string

/** One API response replaced by a canned success, for an empty state. */
export interface Stub {
  /** `'GET /notifications'`, relative to /api/v1. */
  endpoint: string
  /** The envelope's `data`; the envelope itself is added. */
  data: unknown
}

/** One region of a page that loads from its own requests. */
export interface Section {
  name: string
  /** The requests the section waits on, as endpoint specs. */
  endpoints: readonly string[]
}

/** How a route is captured. */
export type RouteCapture =
  | { kind: 'redirect'; to: string }
  | { kind: 'layout'; note: string }
  | {
      kind: 'page'
      area: Area
      /** The file-name stem for this route's shots: `tenant-members`. */
      shot: string
      /** The URL to open; `{name}` is replaced from `Seed.params`. */
      url: string
      /** Which seeded session opens it: a key of `Seed.sessions`, or `'anonymous'`. */
      as: string
      sections: readonly Section[]
      /** How to show the empty state: another URL, or stubbed responses. */
      empty?: { url: string } | { stubs: readonly Stub[] }
      /** Also shoot the default state in dark mode and at 390×844. */
      responsive?: boolean
      /**
       * Also shoot the default URL as a session whose role sees less: a key of
       * `Seed.sessions`. `note` goes into that shot's record.
       */
      roleDenied?: { as: string; note?: string }
      /** Named variants of the default shot: `<shot>--state-<name>.jpg`. */
      states?: readonly CaptureState[]
      /** Shown in the report next to the shots, for the doc writer. */
      note?: string
    }

/**
 * One named variant of a page's default shot, such as the billing page in its
 * past-due state: the page as another session or at another URL, with some
 * responses stubbed.
 */
export interface CaptureState {
  /** The file-name suffix: `past-due` makes `<shot>--state-past-due.jpg`. */
  name: string
  /** Which seeded session opens it; the page's `as` when absent. */
  as?: string
  /** The URL to open, with `{name}` placeholders; the page's `url` when absent. */
  url?: string
  /** Responses replaced by canned successes; none when absent. */
  stubs?: readonly Stub[]
  /** Goes into the shot's record, for the doc writer. */
  note?: string
}

/** The accounts and ids a run uses. */
export interface Seed {
  /** Session name → account email. */
  sessions: Record<string, string>
  /** URL placeholder → value: `{ slug: 'e2e-…' }`. */
  params: Record<string, string>
}

/** What the loading shot found on screen. */
export type LoadingUi = 'skeleton' | 'spinner' | 'shell' | 'none'

/** One screenshot and what was seen while taking it. */
export interface ShotRecord {
  route: string
  state:
    | 'default'
    | 'loading'
    | 'error'
    | 'empty'
    | 'dark'
    | 'mobile'
    | 'role-denied'
    | `state-${string}`
  /** Path under docs/pages/, e.g. `img/tenants/tenants--loading.jpg`. */
  file: string
  requestedUrl: string
  finalUrl: string
  /** Every /api/v1 request the page made, as `METHOD /path status`. */
  requests: string[]
  loadingUi?: LoadingUi
  /** Whether a `role=alert` element appeared within 10 s. */
  errorUi?: 'alert' | 'none'
  /** The manifest's `roleDenied.note` or `states[].note`, on those shots. */
  note?: string
  /** Milliseconds from navigation to the shot. */
  ms: number
}

/** One in-app navigation the capture shoots while the target is still loading. */
export interface NavigationCapture {
  area: Area
  /** The file-name stem: `<shot>--nav-route.jpg` and `<shot>--nav-sections.jpg`. */
  shot: string
  /** Which seeded session navigates: a key of `Seed.sessions`. */
  as: string
  /** The page it starts on; `{name}` is replaced from `Seed.params`. */
  from: string
  /** The link it clicks: the one whose accessible name starts with this, then ends or continues after a space. */
  link: string
  /** The pending template the route shot must show: `PageSkeleton`'s variant, and whether it is the nested one. */
  template: { variant: 'list' | 'detail' | 'dashboard' | 'settings'; nested: boolean }
  /** The target's section requests, held for the sections shot. */
  endpoints: readonly string[]
}

/** A boot frame, and the moment it marks if any. */
export interface BootFrame {
  file: string
  ms: number
  /** The moments the frame marks: `first-paint`, `shell`, `first-content` or `ready`, joined by `+` when one frame marks several. */
  label?: string
}
