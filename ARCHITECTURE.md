# Architecture

How the app is put together: what runs at boot, how a route gets its data,
where state lives, and how the HTTP layer, the notification stream,
observability, maintenance mode and the container fit around it. What each
part defends against is in [SECURITY.md](SECURITY.md); how to run, configure
and deploy it is in [README.md](README.md).

## Layout of `src/`

```
src/
  components/
    dev/        TanStack devtools, development builds only
    features/   composed, app-specific pieces
    layouts/    the signed-out shell and the signed-in shell
    shared/     app-wide pieces that are not shadcn output (<Pii>)
    ui/         vendored shadcn output, plus the hand-written form.tsx and sonner.tsx
  configs/      the run-time configuration (getRuntimeConfig)
  constants/    routes and the API prefix, roles, maintenance-mode constants
  hooks/        use-* hooks, the notification stream among them
  http/         the axios client, its interceptors, the session, the SSE parser, trace ids
  lib/          small helpers, and the maintenance-mode interceptor and recovery
  observability/
    analytics/  the PostHog facade: lazy posthog-js, typed events, masking, handoff
    errors/     error tracking: the entry-chunk listener and the lazy reporter
    flags/      flag reads, gating, exposure and $feature/* registration
  pages/        TanStack Router file routes
  queries/      TanStack Query options and mutations, one file per resource
  schemas/      Zod schemas that mirror the API's validators
  states/       Zustand stores
  styles/       globals.css and the design tokens
  types/        API envelope and shared response types
```

`src/routeTree.gen.ts` is generated from `src/pages/` by the TanStack Router
plugin in `vite.config.ts`, which also splits each route's component into
its own chunk (`autoCodeSplitting`).

## Boot

`index.html` loads two blocking scripts in its `<head>`, then the bundle:

1. `public/theme-init.js` sets the `dark` class from `localStorage` before
   the first paint.
2. `/runtime-config.js` sets `window.__APP_CONFIG__`
   ([run-time config](#the-container-and-run-time-config)).
3. `src/main.tsx`, the module entry. `#root` holds a static splash until
   React's first commit replaces it.

`src/main.tsx` runs in this order:

- **`@/lib/zod-jitless` is the first import**, before any module builds a
  Zod schema: Zod's JIT probe would trip the CSP
  ([CSP and headers](SECURITY.md#csp-and-headers)). `tests/setup.ts` and
  `e2e/harness/harness.tsx` import it first for the same reason.
- **`@/observability/errors/install` is the second**, so the window `error`
  and `unhandledrejection` listeners exist before the rest of the app's
  modules evaluate.
- **Importing `@/router` builds the app.** At module evaluation,
  `src/router.tsx` installs the maintenance-mode response interceptor on
  `apiClient`, creates the `QueryClient` (queries fresh for 30 seconds, one
  retry), creates the router and subscribes page-view analytics, the flag
  scope reset, the `$feature/*` sync and the error reporter's route source to
  it.
- **`router.load()` runs before React mounts.** The root route's
  `beforeLoad` awaits `bootstrapSession()`, so the first match is resolved
  against a settled session. React mounts in the load's `finally`, whether
  it resolved or rejected: mounting earlier would blank the splash, because
  `createRoot().render()` clears `#root` and the router renders nothing until
  it has a match.
- **`initAnalytics()` runs after that first load**, so the identity the
  session restore queued is applied before posthog-js sends anything.

`bootstrapSession()` runs once per page load. It installs the cross-tab
logout listener and the analytics identity subscription, then calls
`ensureSession()`. Whether the refresh succeeds or fails, the store is
marked bootstrapped. A load that ends with no user drops any person
posthog-js still holds from an earlier visit, and the `$feature/*`
properties with it, unless the refresh failed without an auth verdict and
another open tab answers that it is signed in as that person. The access
token is memory-only, so every page load starts signed out and restores the
session this way ([Token storage and refresh](SECURITY.md#token-storage-and-refresh)).

The root route's component renders the page inside `MaintenanceGate`, plus
the toaster and the analytics consent banner. Beside the router,
`src/main.tsx` mounts the TanStack Query and Router devtools, which load only
in development; a production build drops them.

## Routing and data loading

Routes are files under `src/pages/`; `__root.tsx`, `_auth.tsx` and
`$slug.members.tsx` follow TanStack Router's naming, not the kebab-case rule
the rest of `src/` follows.

| Route group                                                                 | Guard                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/_app` (dashboard, notifications, profile, tenants and every tenant tab)   | Not signed in: redirect to `/login?redirect=<href>`. Its loader warms the page's flags.                    |
| `/_auth` (login, register, forgot-password)                                 | Signed in: redirect to the dashboard.                                                                      |
| `/`                                                                         | Redirects in `beforeLoad`: signed in to the dashboard, anyone else to `/login`.                            |
| `/auth/callback`, `/reset-password`, `/verify-email`, `/invitations/accept` | None. The OAuth callback sits outside `_auth`, whose guard would bounce the visitor it has just signed in. |
| `/$`                                                                        | None. The splat route renders `RouteNotFound` inside its own `<main>`.                                     |

Both layout guards stand down while maintenance is `full`
([Maintenance mode](#maintenance-mode)). The guards read the auth store
directly, and that is sound because the root route's `beforeLoad` has
already awaited the session restore; a guard in a `useEffect` would see an
empty store on every reload and redirect wrongly.

**Loaders warm the query cache; components read it.** A loader calls
`queryClient.ensureQueryData(...)` with the same options a component's
`useQuery` uses, so the page renders from the cache. Two loaders do this:

- `/_app` reads the flags of the page the shell is entered on. It does not
  run again for a navigation that stays in the shell.
- `/_app/tenants/$slug` reads the tenant's detail and, for a navigation that
  commits, the tenant's flags in parallel; a hover preload reads the detail
  only. `preloadStaleTime: 0` with a blocking stale reload makes the commit
  run the loader again after a preload, before the page renders. A 404 on
  the detail resolves to `null`, and the layout reads the tenant list to
  choose between the suspended panel and the not-found panel; any other
  failure reaches the route's own error component.

Links preload on intent (`defaultPreload: 'intent'`). The pending component
waits 300 ms before it shows and then stays at least 300 ms. The error,
not-found and pending components are imported statically in
`src/router.tsx`: when a chunk cannot be fetched, a lazy error screen could
not load either. `RouteError` recognises a failed chunk load
(`src/lib/chunk-load-error.ts`) and offers a reload, the only way to pick up
a new deploy's file names; any other error offers a retry that re-runs the
loaders.

**A flag-gated page** calls `requireClientFlag` in its `beforeLoad`, which
throws `notFound()` unless the flag has the opening value
(`src/pages/_app/tenants/$slug.beta.tsx` is the worked example). It hides
the page only; the API route behind it is what refuses
([Threat model](SECURITY.md#threat-model-for-a-browser-client)).

**Breadcrumbs** come from each route's `staticData.crumb`, a string or a
function of the match's params, typed by the module augmentation in
`src/router.tsx`. `AppLayout` builds the trail from the matches and inserts
the list pages a detail page sits under in the reader's mind but not in the
route tree.

**Queries** live in `src/queries/`, one file per resource. Each exports a
key factory and its hooks; `unwrap` (`src/http/client.ts`) returns the
`data` of the API's success envelope. Keys nest by prefix, so invalidating a
prefix refetches everything under it: `['tenants']` is a prefix of every
tenant's detail, members, settings, invitations and onboarding, and a
mutation that means the list alone passes `exact: true`. Failed requests
are read with the helpers in `src/lib/api-error.ts`, and a form maps the
API's field errors onto its inputs through `useServerErrors`.

## State

| What                                  | Where                                  | Persisted                                                     |
| ------------------------------------- | -------------------------------------- | ------------------------------------------------------------- |
| Access token, user, bootstrapped flag | `src/states/auth.store.ts`             | No: memory only                                               |
| Maintenance mode, message, start time | `src/states/maintenance-mode.store.ts` | No: each load starts at `off` and learns it from the API      |
| Sidebar collapsed                     | `src/states/sidebar.store.ts`          | No                                                            |
| Theme (`light`, `dark`, `system`)     | `src/states/theme.store.ts`            | `localStorage` key `theme`, read pre-paint by `theme-init.js` |
| Everything the API returns            | The TanStack Query cache               | No                                                            |
| Form state                            | TanStack Form, per form                | No                                                            |

Code outside React reads and writes the stores through `getState()`, as the
interceptors and route guards do, or subscribes to them: the session module
follows the auth store's user to keep analytics and the flag caches in step,
and the maintenance recovery follows the mode. The auth store's user is the
profile the session restore or the sign-in loaded; the maintenance store
holds what the API last said about the mode, from any of its three sources.

## The HTTP layer and session

Every REST call goes through `apiClient` (`src/http/client.ts`): an axios
instance whose base is the relative `API_PREFIX`, `/api/v1`, with
credentials sent and a 30-second timeout. The timeout exists because axios
has none by default, and a request that never answers would leave its
mutation pending and its button disabled.

**The prefix is fixed and same-origin.** It is written once, in
`src/constants/routes.ts`; the axios base, the notification stream's URL
and the Google OAuth anchor derive from it, and the analytics proxy path
repeats it. The development server proxies `/api` to the API
(`vite.config.ts`) and the container's nginx does the same, so the app only
ever calls the origin that served it. nginx's locations for the stream and
the analytics proxy hardcode `/api/v1`, so moving the prefix means changing
`API_PREFIX` and `nginx.conf` in one change, plus the `/api/` location and
the Vite proxy for a prefix outside `/api`. There is no environment variable
for it: one that moved only the axios base would leave the stream, the
OAuth anchor and nginx on the old prefix.

**Interceptors**, installed by `installInterceptors` and, for maintenance
mode, from `src/router.tsx`. The two request interceptors are independent of
each other; the response interceptors run in the order they are registered,
so the maintenance reader sees what the other two pass on:

| Direction | Order | Interceptor                   | Does                                                                                                                   |
| --------- | ----- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Request   | –     | Bearer token                  | Adds `Authorization: Bearer` from the auth store when the request has none.                                            |
| Request   | –     | Trace headers                 | On a same-origin request under the prefix: a fresh `traceparent`, and the analytics session id when one may be linked. |
| Response  | 1     | 401 handling                  | Refreshes and replays once on an expired token; signs out on a verdict; leaves `REAUTH_REQUIRED` to the caller.        |
| Response  | 2     | `rejectMalformedJsonResponse` | Rejects a 2xx whose body is not a JSON object, such as an HTML page from a misrouted proxy.                            |
| Response  | 3     | Maintenance mode              | Reads the `Maintenance-Mode` header and a maintenance 503 into the store; never changes the outcome.                   |

A replay goes through the whole chain again. The rules each step enforces,
and why, are in [Sign-out rules](SECURITY.md#sign-out-rules).

`traceparent` values come from `src/http/traceparent.ts`: random ids from
`crypto.getRandomValues`, flagged sampled. There is no tracing SDK in the
browser; the header only lets the API's span join a trace the browser chose.

**The session** (`src/http/session.ts`):

- `ensureSession()` is the single entry to a refresh. Callers in a tab share
  one in-flight promise, and tabs queue on the `auth-refresh` Web Lock.
- `refreshSession()` posts `/auth/refresh`, then loads `/profile` with the
  new token, since the refresh returns only a token. A profile whose id
  differs from the tab's user fails the refresh with
  `SessionIdentityChangedError`.
- `isAuthVerdict()` is the one test of whether a failure may end a session.
- `redirectToLogin()` is the one place a dead session navigates, to
  `/login?redirect=…`.
- The `auth` BroadcastChannel carries sign-outs between tabs.
- `installAnalyticsIdentity()` subscribes to the auth store: a change of
  user resets analytics and drops every cached flag value and exposure mark
  before the next user is identified.

Why each of these holds, and what breaks if it does not, is in
[Token storage and refresh](SECURITY.md#token-storage-and-refresh) and
[Sign-out rules](SECURITY.md#sign-out-rules).

## Realtime

The notification inbox follows the API's server-sent event stream at
`/api/v1/notifications/stream`. Two pieces:

- **`src/http/sse.ts`** parses frames out of a `fetch` response body, doing
  the framing `EventSource` would (why `fetch`:
  [Token storage and refresh](SECURITY.md#token-storage-and-refresh)). It
  keeps the unfinished tail between reads, accepts CRLF separators, skips
  comment lines (the API's keep-alive pings), and throws past its buffer
  limit, which ends that connection and sends it into the reconnect path.
- **`useNotificationStream`** (`src/hooks/use-notifications.ts`) owns the
  connection for as long as there is an access token. It is mounted once,
  in `AppLayout`'s body: two mounts would open two connections, and below
  the `md` breakpoint the sidebar renders into a sheet whose content
  unmounts while it is closed.

The hook's connection cycle:

- **Connect** with the token in a header and, on a reconnect, the last
  event id seen as `Last-Event-ID`, so the API can replay what was missed.
  Each accepted connect refetches the notification list, which also covers
  the first connect.
- **A `notification` frame** refetches the list and resets the backoff. The
  backoff resets on nothing else: a server that accepts and then closes
  with no frames would otherwise pin retries at one second, each of them a
  refresh that rotates the cookie.
- **A dropped stream or a 401** waits the backoff (1 second, doubling to 30
  seconds), then calls `ensureSession()`. When the refresh returns the same
  token, the hook reconnects; a new token re-runs the effect, which owns that
  reconnect. An auth verdict sends the user to `/login`; any other refresh
  failure is retried.
- **Any other refusal** (a 503 at the API's stream capacity, a 429 over the
  per-user cap) says nothing about the session, so it reconnects with the
  same token and no refresh, after the longer of the backoff and the
  response's `Retry-After` (capped at five minutes, plus up to 20 % jitter).
- **A token change or unmount** cancels the timer and aborts the request.

Each open stream holds two connections in nginx, the browser's and the one
to the API, for as long as its tab is open; `docker/nginx.main.conf` sizes
`worker_connections` for that. The stream's `location` in `nginx.conf` turns
off buffering and raises the read timeout. The dev server's proxy does not
propagate an upstream close, so the reconnect path can only be exercised
against the image (the `nginx` Playwright project).

## Analytics, flags and errors

The three share one transport, the API's `/api/v1/collect` proxy, which
forwards to PostHog; the browser never talks to PostHog. What each sends,
masks and withholds is in [Analytics privacy](SECURITY.md#analytics-privacy)
and [Error-tracking privacy](SECURITY.md#error-tracking-privacy).

### Analytics

`src/observability/analytics/` is the only code that imports posthog-js,
and `analytics.ts`, the facade, is the only module that imports it as a
value, through a dynamic `import()`. The rest of the app imports the barrel,
`index.ts`.

- **Lazy load with a queue.** `initAnalytics()` loads posthog-js once, after
  the first route load. Calls made before it has loaded queue and replay in
  order when it does, before any event is sent, so queued identity is
  applied first. The queue holds 100 commands; past
  that the oldest queued event capture is shed, and identity, reset, group
  and consent calls never are. With no PostHog key, or consent mode `off`,
  the facade turns inert and every call is a no-op. A throwing SDK call is
  swallowed: analytics never fails a user action.
- **Page views come from the router.** posthog-js's own history page views
  are off. `installRouteAnalytics` (`src/observability/route-analytics.ts`)
  subscribes to the router's `onResolved`: it sets the tenant group from the
  tenant route's loader data, or clears it, and only then captures
  `$pageview` when the path changed. It is installed before the first load,
  so the landing page is counted.
- **Identity follows the auth store**, through `installAnalyticsIdentity` in
  `src/http/session.ts` ([The HTTP layer and session](#the-http-layer-and-session)).
- **Per-app constants** sit at the top of
  `src/observability/analytics/config.ts`: the `app` property, the query-key
  allowlist, whether consent modes and the cross-domain handoff are
  supported, and how the identity cookie is shared. The registry of typed
  events is `events.ts`. Everything else in the folder is shared with the
  sibling app ([Sibling sync](#sibling-sync-with-apex)).
- `src/observability/identity-epoch.ts` is a counter of the calls that change
  who an event belongs to. It is a module of its own, importing nothing, so
  the entry-chunk error listener can read it without importing the facade.

### Feature flags

The API is the only evaluator. The app reads values from three endpoints by
scope (`src/observability/flags/flag-scope.ts`): `/tenants/:slug/flags` on a
tenant page and `/flags` elsewhere; the shared module also knows
`/platform/me/flags`, the staff scope the sibling app reads. posthog-js does
no flag work.

- **The registry slice** is `CLIENT_FLAGS` in `flag-keys.ts`: the API
  registry's entries this app reads, mirrored by hand, each with its kind,
  variants, fallback and whether it is an experiment. A value the server
  sends for a key the slice lacks is dropped, and a missing or invalid value
  becomes that flag's fallback (`normalizeFlags`).
- **Reads.** One query per scope (`flag-query.ts`): fresh for five minutes,
  refetched every ten and on focus once stale, never retried. `ensureFlags`
  never rejects, so a failed read renders the page with fallbacks. Pages
  read values with `useFlagValues()` and `useVariant(key)`
  (`flag-hooks.ts`), which show the fallback while loading and after a
  failure.
- **Scope changes.** On a resolved navigation to a different tenant,
  `installFlagScopeReset` drops every other scope's values and the exposure
  dedupe, so returning to a tenant reads its flags afresh. It runs on
  resolve, not in a loader, because a loader also runs for a hover preload.
  A change of user drops every scope's values.
- **Exposure.** `useVariant` on an experiment flag, once its value came from
  the server, reports the key, never the value, to the scope's
  `/exposures` endpoint (`exposure.ts`): batched for 50 ms, at most 10 keys
  per request, once per scope, key and value in a tab session. The API
  re-evaluates and records the exposure.
- **`$feature/*` super properties** carry each flag's value on every browser
  event. They are synced at two points and never from a query or loader:
  `useFeaturePropertiesSync` in `AppLayout`, in a layout effect, and the
  router's `onLoad` (`installRouteFeatureProperties`), which fires before
  `onResolved` captures the page view and never for a preload. The `onLoad`
  sync is what gives the first page view its properties, since that load
  runs before React mounts. A page outside the signed-in shell syncs to the
  no-tenant scope's cached values, or to none.

### Error tracking

Error tracking is split so that every page pays almost nothing for it:

- **`listen.ts`**, in the entry chunk, notes raw errors and nothing else:
  the window listeners, React's root `onUncaughtError` and `onCaughtError`
  (`rootErrorOptions`, passed to `createRoot`), and `noteError` for an error
  screen that catches an error those hooks never see (`RouteError` and the
  tenant route's error component). It dedupes by object and by a re-throw of
  the same name, message and stack within a second, buffers up to 20 errors,
  and loads the reporter on the first error or when the browser is idle
  (within three seconds). It imports only `identity-epoch.ts`.
  `pnpm check:bundle` caps it at 1 KB gzipped and keeps `@posthog/core` and
  posthog-js out of the first-visit chunks.
- **`report.ts`**, lazy, filters each error, builds a `$exception` with
  `@posthog/core`, scrubs it with `scrub.ts`, throttles it (5 per
  fingerprint, 30 per page life), attaches an identity only when analytics
  consent allows, and posts batches of up to 10 events within a 2-second
  window to `/api/v1/collect/batch/`. A batch that fails on the network or
  with a 5xx is retried once after 5 seconds; on `pagehide`, whatever is
  left goes by `sendBeacon`.
- **The reporter never imports the router.** `src/router.tsx` registers a
  route-id reader with `setErrorRouteSource`, so a crash in the router's own
  module can still be reported.
- **Releases.** `vite.config.ts` bakes `GIT_SHA` into the bundle as the
  release (`dev` when unset). The image build injects chunk ids into every
  chunk with `posthog-cli sourcemap inject`, offline and with no release, so
  an unchanged chunk keeps its bytes under its hashed name; it then uploads
  the hidden source maps and deletes them
  ([The container and run-time config](#the-container-and-run-time-config)).

## Maintenance mode

The API enforces maintenance; the app shows it. The mode lives in
`src/states/maintenance-mode.store.ts` and arrives three ways:

- **Every API response's `Maintenance-Mode` header**, read by the
  interceptor in `src/lib/maintenance-mode.ts`. Only a known value (`off`,
  `read_only`, `full`) moves the mode; a response with no header, such as
  nginx's own 502 page during a deploy, or with an unknown value changes
  nothing. A different mode clears the message and start time, which belong
  to the old one.
- **A 503 whose `code` is `MAINTENANCE_MODE` or `READ_ONLY_MODE`**, read by
  the same interceptor, with the body's mode, message and start time.
- **`GET /status/maintenance`** (`src/queries/maintenance-status.queries.ts`),
  read once when the app starts and polled every 30 seconds plus up to 10
  seconds of jitter while the mode is `full`. It sends
  `Cache-Control: no-cache`, because a cached status from before a change
  would overwrite the newer mode a header just reported. A body with no
  known mode rejects, and a failed poll never stops the next one.

The interceptor is installed from `src/router.tsx`, before the first
request, and lives in `src/lib/` rather than `src/http/`, which is shared
with the sibling app and so carries no maintenance handling.

`MaintenanceGate` wraps every route, in the root route's component:

- **`full`**: it renders `MaintenancePage` in place of the route tree, sign-in
  and sign-up included, with the owner's message as text. Because the
  outlet is not rendered, `AppLayout` unmounts and the notification stream's
  cleanup aborts its connection. The `_app` and `_auth` guards do not
  redirect while the mode is `full`, so the URL is kept. The API lets
  `POST /auth/refresh` and `GET /profile` through in `full`, so a page
  loaded then restores its session as usual; a page with no user is the
  rare case, such as an unreachable API.
- **When `full` ends**, `installMaintenanceRecovery` calls `ensureSession()`
  (a failure is ignored; it signs the store out only on a verdict), then
  `router.invalidate()`, which runs every guard and loader again on the URL
  the user never left, then refetches every active query.
- **`read_only`**: a banner sits above the page. Inside the signed-in shell,
  `AppLayout` draws it under its header so the fixed sidebar never covers
  it; the gate draws it for every other page. A write the API refuses with
  `READ_ONLY_MODE` shows "Changes are paused during maintenance." in one
  toast, however many writes fail at once (`useServerErrors`), and the form
  keeps what was typed.
- **A header that switches the mode on without a start time** makes the
  gate read the status endpoint again, cancelling any older read still in
  flight so its answer cannot revert the mode.
- **`maintenance_page_viewed`** is tracked once per tab session for each
  maintenance period, keyed on its start time, under the usual consent
  rules.

`MaintenanceGate` and `MaintenancePage` are imported statically into
`__root.tsx`, for the reason the router's error screen is: they are needed
exactly when the API is failing, a bad moment to fetch a lazy chunk. A
maintenance 503 never signs anyone out
([Sign-out rules](SECURITY.md#sign-out-rules)).

## The container and run-time config

The `Dockerfile` has two stages.

**Build stage** (`node:24-alpine`, pinned by digest):

1. Installs Corepack, then the pnpm version named by `packageManager` in
   `package.json`, then the dependencies from the frozen lockfile.
2. Downloads the `posthog-cli` binary and checks its SHA-256 against
   `docker/posthog-cli.sha256` before it first runs.
3. Copies the source and refuses a `.git` in the build context.
4. `pnpm build`, with `GIT_SHA` as the only build argument the bundle reads.
5. Injects chunk ids, release-less (see [Error tracking](#error-tracking)).
6. Uploads the source maps to each project in `POSTHOG_SOURCEMAP_PROJECTS`
   (`docker/upload-sourcemaps.sh`), with the token as a BuildKit secret, then
   deletes every `.map`.

**Serve stage** (`nginxinc/nginx-unprivileged`, pinned by digest) runs as
uid 101 on port 8080 and is built for a read-only root filesystem:
everything it writes is under `/tmp`, which must be a writable tmpfs.

- `docker/nginx.main.conf` replaces the image's `nginx.conf`: the pid file
  and temp paths under `/tmp`, connection limits sized for the notification
  stream, and an include of `/tmp/nginx/conf.d/*.conf`.
- `nginx.conf` is the server block, installed as a template. At start, the
  image's entrypoint runs `/docker-entrypoint.d/` in name order:
  `docker/05-prepare.sh` creates the render directory and validates
  `API_UPSTREAM`; `docker/10-runtime-config.sh` validates the run-time
  settings and writes `/tmp/runtime/runtime-config.js`; the stock envsubst
  script then renders `nginx.conf`, substituting `API_UPSTREAM` and nothing
  else, so nginx's own variables survive. A failing script stops the
  container before nginx starts.

`nginx.conf`'s locations:

| Location                       | Serves                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `/api/v1/notifications/stream` | The SSE stream: no buffering, an empty `Connection` header, a 24-hour read timeout, query-free logging. |
| `/api/`                        | Every other API call, proxied to `API_UPSTREAM` with no path on `proxy_pass`.                           |
| `/api/v1/collect/`             | The analytics and error proxy: a 10 MB body limit, streamed rather than buffered, for replay batches.   |
| `= /runtime-config.js`         | The file the entrypoint wrote under `/tmp`.                                                             |
| `/assets/`                     | Hashed assets; a missing one is a real 404, not `index.html`.                                           |
| Any `.map` outside `/api/`     | 404, even where a file exists.                                                                          |
| `/`                            | The SPA fallback to `index.html`.                                                                       |

Cache-Control is chosen by a `map` on the URI, not per location: hashed
assets are immutable for a year, and `index.html`, `theme-init.js`, the
favicon and `runtime-config.js` are `no-store`, so a deploy never leaves a
browser asking for asset names it removed. The security headers, the reason
no location declares an `add_header`, and the logging choices are in
[CSP and headers](SECURITY.md#csp-and-headers).

**Nothing is configured at build time.** One image digest is promoted
through every environment, so a setting that differs between environments
is a container environment variable read at start, never a `VITE_*` value
or a build argument. The flow:

1. `docker/10-runtime-config.sh` checks each value against its pattern and
   writes `window.__APP_CONFIG__ = Object.freeze({...})`.
2. `index.html` loads `/runtime-config.js` before the bundle.
3. `getRuntimeConfig()` (`src/configs/runtime-config.ts`), the app's only
   reader, applies the same patterns again. A production bundle reads only
   `window.__APP_CONFIG__`; the dev server, `pnpm preview` and the unit tests
   read the same names with a `VITE_` prefix from `import.meta.env`, and
   `scripts/runtime-config-plugin.mjs` serves a matching
   `/runtime-config.js` on the dev and preview servers.

A new setting goes into `RUNTIME_CONFIG_KEYS` and `RUNTIME_CONFIG_PATTERNS`,
the entrypoint script with the same pattern, `RUNTIME_CONFIG_NAMES` in
`scripts/runtime-config-plugin.mjs`, `docker/check-image.sh`, `.env.example`
and the README's table, in one change. The variables and their defaults are
in the [README's run-time configuration table](README.md#run-time-configuration),
and why the values are safe to write unescaped is in
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

`docker/check-image.sh` checks a built image from outside: the user, the
read-only root, the headers and the absence of source maps.

## Sibling sync with apex

`apex-boilerplate`, the staff console, shares these paths with this app.
A change to one here means checking the other app in the same pull
request, and the description says what happened there.

| Path                                                                                                                                                                                                                            | Why it must stay in step                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `src/http/*`                                                                                                                                                                                                                    | Session refresh single-flight, 401-verdict sign-out, the SSE parser, trace headers, analytics identity order           |
| `src/lib/api-error.ts`                                                                                                                                                                                                          | Error envelope parsing                                                                                                 |
| `src/schemas/auth.schemas.ts`, `src/schemas/safe-text.schemas.ts`                                                                                                                                                               | Mirror the API's validators                                                                                            |
| `src/components/ui/form.tsx`, `src/components/ui/sonner.tsx`                                                                                                                                                                    | Hand-written, shared behaviour                                                                                         |
| `nginx.conf` security headers and CSP, and `location /api/v1/collect/`                                                                                                                                                          | Same threat model; same replay batch size                                                                              |
| `src/observability/analytics/*`, except `config.ts`'s per-app constants and `events.ts`'s registry                                                                                                                              | One PII, consent, handoff and identity contract                                                                        |
| `src/components/shared/pii.tsx`, `e2e/helpers/fake-posthog.ts`                                                                                                                                                                  | The masking class and the egress guard's fake PostHog                                                                  |
| `src/observability/flags/**`, except `flag-keys.ts` (each app's registry slice) and `flag-scope.ts` (each app's scope); `tests/unit/observability/flags/**`, except `flag-scope.test.ts`; `tests/fixtures/test-client-flags.ts` | One flag read, exposure and `$feature/*` contract; the tests mock `flag-keys` with test keys so they pass in both apps |
| `docker/10-runtime-config.sh`, `src/configs/runtime-config.ts`, `scripts/runtime-config-plugin.mjs`, `nginx.conf`'s `location = /runtime-config.js`                                                                             | One run-time configuration contract: the same variable names, patterns and file in both images                         |
| `public/theme-init.js`, `src/lib/zod-jitless.ts`                                                                                                                                                                                | CSP compatibility                                                                                                      |
| `src/observability/errors/**`, `src/observability/identity-epoch.ts`, `tests/fixtures/error-scrub-vectors.json`                                                                                                                 | One capture, filter, scrub and consent contract; the vectors are express-boilerplate's, byte for byte                  |
| `docker/upload-sourcemaps.sh`, `docker/check-image.sh`, `docker/posthog-cli.sha256`, `.github/workflows/deploy.yml`                                                                                                             | One source map pipeline                                                                                                |
| `nginx.conf`'s `.map` location                                                                                                                                                                                                  | No source map is ever served                                                                                           |
| `docker/nginx.main.conf`, `pnpm-workspace.yaml`, `tests/unit/docker/check-image-script.test.ts`, `tests/unit/docker/nginx-main-conf.test.ts`                                                                                    | Same container limits, dependency overrides and script tests                                                           |
| `src/components/features/profile/security-section.tsx` and its test                                                                                                                                                             | One sign-out-other-sessions section                                                                                    |
| `src/schemas/changed-fields.schemas.ts`, `src/hooks/use-changed-fields.ts` and their tests                                                                                                                                      | Changed-field edit forms                                                                                               |
| `eslint.config.js` rule set (not its file lists)                                                                                                                                                                                | Same conventions                                                                                                       |

The error scrubber is also held in step with express-boilerplate; see
[The scrubber](SECURITY.md#the-scrubber).

## Deploy

`.github/workflows/deploy.yml` is the pipeline:

- **A push to `main`** runs `ci.yml` as a gate, then the `image` job builds
  the image once and pushes it to GHCR as `sha-<commit>` and `main`, with an
  SBOM and a provenance attestation, then runs the `deploy` job, bound to the
  `production` environment. That job is a placeholder until a deployment
  target is chosen.
- **A `vX.Y.Z` tag**, pushed by the release workflow, builds nothing: the
  `promote` job waits for `main`'s `sha-<commit>` image and adds `X.Y.Z`,
  `X.Y` and `X` to that same digest.
- **A manual dispatch from another branch** pushes the sha-tagged image
  only; the `main` tag and the `deploy` job run only from `main`.

Because a release promotes a digest rather than rebuilding, source maps are
uploaded only when an image is built: a PostHog project added later needs a
rebuild on `main` before its frames are symbolicated. The one-time
repository setup, the release flow and the one-origin rule for deployments
are in the README's [Deploying](README.md#deploying) and
[Releases](README.md#releases) sections.
