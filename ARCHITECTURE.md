# Architecture

This file is for developers who change the app. It explains how the app is
put together: what runs at boot, how a route gets its data, and where state
lives. It also covers how the HTTP layer, the notification stream,
observability, maintenance mode and the container fit around it.

- What each part defends against: [SECURITY.md](SECURITY.md).
- How to run, configure and deploy the app: [README.md](README.md).

This app shares code with apex, the staff console, and with expo, the mobile
app ([Shared core](#shared-core) lists every shared path). The shared parts are
the HTTP layer, analytics, feature flags, error tracking and the container
files the table names. Their sections describe the shared code. Sections and subsections marked _this app
only_ describe code apex does not have.

## Layout of `src/`

This section maps the source folders, then describes the UI kit, the command
palette and how routes split into chunks.

```
src/
  components/
    dev/        TanStack devtools, development builds only
    features/   composed, app-specific pieces
    layouts/    the signed-out shell (AuthLayout, AuthCard) and the signed-in one (AppLayout, NavMain)
    shared/     app-wide pieces that are not shadcn output (<Pii>, the lazy <ToastHost>, the loading templates)
    ui/         vendored shadcn output (toast.tsx with local edits), plus the hand-written form.tsx
  configs/      the run-time configuration (getRuntimeConfig)
  constants/    routes and the API prefix, roles, maintenance-mode constants
  hooks/        use-* hooks, the notification stream among them
  http/         the axios client, its interceptors, the session, the SSE parser, trace ids
  lib/          small helpers, and the maintenance-mode interceptor and recovery
  observability/
    errors/     error tracking: the entry-chunk listener and the lazy reporter
    flags/      flag reads, gating, exposure and $feature/* registration
    telemetry/  the PostHog facade: lazy posthog-js, typed events, masking, handoff
  pages/        TanStack Router file routes
  queries/      TanStack Query options and mutations, one file per resource
  schemas/      Zod schemas that mirror the API's validators
  states/       Zustand stores
  styles/       globals.css and the design tokens
  types/        API envelope and shared response types
```

**The UI kit** is shadcn's `base-vega` style on Base UI, with:

- the `mist` base colour;
- Inter Variable (`@fontsource-variable/inter`, imported by `globals.css`);
- Tabler icons (`@tabler/icons-react`). Each decorative icon carries
  `aria-hidden`, which Tabler does not add.

`components.json` records the preset.

**The vendored files in `src/components/ui/` are held to the registry.**

- `scripts/ui-registry/` is a committed snapshot of the registry's files, as
  the `shadcn` devDependency renders them.
- `docs/ui-local-edits.md` records each local edit: line rewrites, or exact
  hunks with a reason.
- `pnpm ui:drift`, a step of the continuous integration (CI) `lint` job, fails
  on any other difference. It also fails when that `shadcn` version, or
  `components.json`'s style or icon library, no longer matches the snapshot's
  manifest.
- `pnpm ui:drift:refresh` retakes the snapshot over the network, as a reviewed
  change. Renovate leaves `shadcn` bumps for a human, and CODEOWNERS covers
  the directory.

**The signed-out pages** follow shadcn's login-04 and signup-04 blocks.
`AuthCard` puts the page's form beside a brand panel that shows `APP_NAME` and
`APP_TAGLINE` from `src/constants/app.ts`. The social sign-in buttons come from
`SOCIAL_PROVIDERS` in `src/constants/auth-providers.ts`, because the API
publishes no list of configured providers.

**The signed-in shell** follows sidebar-07. Its sidebar collapses to icons and
holds, top to bottom:

1. the tenant switcher;
2. `NavMain`: Dashboard and Tenants, with a collapsible group only for an item
   with sub-items;
3. `NavSecondary`, pinned to the bottom: Notifications with the unread count,
   and Settings;
4. the account menu.

On a settings page (`isSettingsPath`) the sidebar swaps `NavMain` and
`NavSecondary` for `NavSettings` ([The Settings area](#the-settings-area)).
Every sidebar link closes the drawer on a phone.

**The command palette** (`src/components/shared/command-palette/`, shared with
apex) opens from the header's Search… button, or from ⌘K on Apple platforms
and Ctrl+K elsewhere. This app's commands are in
`src/components/features/command-palette.tsx`. The palette lists these groups:

| Group            | Commands                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Recent           | Tenants worked in lately and still listed                                                               |
| This page        | Commands a mounted component registers with `usePaletteCommands`; here, Copy workspace ID (for support) |
| Go to            | The nav, Notifications, Settings and its sections; the workspace sections only with a current tenant    |
| Switch workspace | The caller's tenants, matched here, through the switcher's own routing (`useSwitchTenant`)              |
| Theme            | Light, Dark and System                                                                                  |
| Account          | Create a workspace, which opens `/tenants#create`, and Sign out                                         |

A choice sends `command_palette_action_run` with a fixed `action` key and
nothing else.

`CommandPaletteHost`, mounted once in `AppLayout`, holds the shortcut. It
loads the palette's code with one `import()` (`palette-loader.ts`), so the
entry chunk carries none of it. The fetch starts at the first of these: the
shell going idle, hover or focus on the Search… button, or the first open.

- Once the fetch has resolved, even from a hover alone, the first open mounts
  the palette directly.
- Only an open that beats the fetch shows a "Loading search…" overlay. Its
  input is bound to the store's `query`, so the palette keeps keys typed right
  after the shortcut.
- The overlay is a modal dialog: Tab stays on its field, and Escape or a click
  on the backdrop closes it.
- When the palette replaces the overlay, focus first goes back to the opener,
  so the palette's own close returns focus there.
- A failed fetch closes the palette and shows a toast with a Reload action.
  There is no in-page retry, because Chromium keeps a failed `import()` for
  the page's lifetime.

`pnpm check:bundle` fails if static imports reach a chunk that holds the
palette's code from the entry or the host. It also enforces the entry
budget ([Lists](#lists) says where it is set).

**Recents** live in `localStorage` per user (`palette.recent.v1:<userId>`,
five tenants, newest first). They are cleared on every session end, expiry
included:

- `logout()` in `auth.store.ts` removes every `palette.recent.v1:` key
  (`clearAllRecents` in `recent-keys.ts`) without importing the palette. A
  sign-out on a page that never loaded the palette still clears them.
- `logout()` also runs when the session ends any other way: a 401 verdict on
  the cold-load restore or on a refresh (an expired session or a dead cookie),
  and another tab's logout.
- `installRecentItems`, installed by the host, also deletes a user's list when
  the signed-in user changes away from them. While someone is signed in, it
  deletes every other user's list.

**Code splitting.** The TanStack Router plugin in `vite.config.ts` generates
`src/routeTree.gen.ts` from `src/pages/`. It also splits each route's
component into its own chunk (`autoCodeSplitting`). A route's pending template
is not split with it:

- A route names one of the lazy wrappers in
  `src/components/shared/pending-templates.ts`.
- That chunk is fetched at startup (`templatesReady`). `main.tsx` waits for it,
  capped at 3 seconds (`TEMPLATES_WAIT_MS`).
- So a template renders without suspending, and the page templates still stay
  out of the entry chunk.

A lazy route with its own `errorComponent` keeps that screen in the route
module, with `codeSplitGroupings: [['component']]`, as the settings leaves do.
Two reasons:

- A split error screen would need a fetch exactly when chunk loading fails.
- The plugin's default split pulls the error listener out of the entry chunk.

For the same reason, such a route's page component must not import `Route`
back from its route module. It reads params with `useParams({ from })` instead
of `Route.useParams()`. Either mistake fails `pnpm check:bundle`
([Error tracking](#error-tracking)).

## Boot

This section covers what runs between the first byte of `index.html` and
React's first commit, in order.

`index.html` loads two blocking scripts in its `<head>`, then the bundle:

1. `public/theme-init.js` sets the `dark` class from `localStorage` before
   the first paint.
2. `/runtime-config.js` sets `window.__APP_CONFIG__`
   ([run-time config](#the-container-and-run-time-config)).
3. `src/main.tsx`, the module entry. `#root` holds a static boot shell, styled
   by inline CSS in `index.html`, until React's first commit replaces it.

`src/main.tsx` runs in this order:

- **`@/lib/zod-jitless` is the first import**, before any module builds a
  Zod schema. The Content Security Policy (CSP) is why
  ([CSP and headers](SECURITY.md#csp-and-headers)).
  `tests/setup.ts` and `e2e/harness/harness.tsx` import it first for the same
  reason.
  - Every source file that imports Zod as a value also imports it first. The
    entry's own body runs after every chunk it imports, so the entry's first
    import alone does not run before a schema built in one of those chunks.
  - `tests/unit/lib/zod-jitless.test.ts` and `pnpm check:bundle` fail when a
    file or a chunk misses it.
- **`@/observability/errors/install` is the second**, so the window `error`
  and `unhandledrejection` listeners exist before the rest of the app's
  modules evaluate.
- **Importing `@/router` builds the app.** At module evaluation,
  `src/router.tsx`:
  1. installs the maintenance-mode response interceptor on `apiClient`;
  2. creates the `QueryClient` (queries fresh for 30 seconds, one retry);
  3. creates the router, and subscribes page-view analytics, the flag scope
     reset, the `$feature/*` sync and the error reporter's route source to it.
- **`router.load()` runs before React mounts.**
  - The root route's `beforeLoad` awaits `bootstrapSession()`, so the router
    resolves the first match against a settled session.
  - `_app`'s loader waits for the flags, at most 10 seconds.
  - React mounts once the load has settled, resolved or rejected, and once the
    pending templates' chunks have settled, or after 3 seconds.
  - Mounting earlier would blank the boot shell: `createRoot().render()`
    clears `#root`, and the router renders nothing until it has a match.
  - The boot does not wait for the tenant list or the tenant reads. The page
    shows its template while they load ([boot.md](docs/pages/boot.md)).
- **`initAnalytics()` runs after that first load**, so posthog-js applies the
  identity the session restore queued before it sends anything.

`bootstrapSession()` runs once per page load:

1. It installs the cross-tab logout listener and the analytics identity
   subscription.
2. It calls `ensureSession()`. Whether the refresh succeeds or fails, the
   store is marked bootstrapped.
3. A load that ends with no user drops any person posthog-js still holds from
   an earlier visit, and the `$feature/*` properties with it. The exception: the
   refresh failed without an auth verdict, and another open tab answers that it
   is signed in as that person.

The access token is memory-only, so every page load starts signed out and
restores the session this way
([Token storage and refresh](SECURITY.md#token-storage-and-refresh)).

The root route's component renders the page inside `MaintenanceGate`, plus
the toast host and the analytics consent banner.

**Toasts.** The toast UI (`src/components/ui/toast.tsx`) is a lazy chunk that
`ToastHost` fetches when the root route first renders. `toast.*` from
`src/lib/toast.ts` is small and outside that chunk.

- It queues the newest ten toasts raised before the UI has mounted, and those
  raised in the UI's first 100 milliseconds (ms).
- It replays them in order once the empty live region has been in the
  document for 100 ms. Toasts inserted together with the region are often
  skipped by screen readers.
- A failed chunk load is reported as a `chunk_load` error and leaves the page
  without toasts.

Beside the router, `src/main.tsx` mounts the TanStack Query and Router
devtools. They load only in development; a production build drops them.

## Routing and data loading

This section covers the route guards, the sign-in pages, and how loaders and
components share the query cache.

Routes are files under `src/pages/`. `__root.tsx`, `_auth.tsx` and
`$slug.members.tsx` follow TanStack Router's naming, not the kebab-case rule
the rest of `src/` follows.

| Route group                                                                                    | Guard                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/_app` (dashboard, notifications, tenants, every tenant tab, settings)                        | Not signed in: redirect to `/login?redirect=<href>`. Then the tenant guard ([The current tenant in the URL](#the-current-tenant-in-the-url)). Its loader warms the page's flags.                   |
| `/_auth` (login)                                                                               | Signed in: redirect to the dashboard.                                                                                                                                                              |
| `/welcome`                                                                                     | Its own guard: not signed in, redirect to `/login?redirect=/welcome`. A user who already has a tenant goes on to the dashboard.                                                                    |
| `/`                                                                                            | Redirects in `beforeLoad`: signed in to the dashboard, anyone else to `/login`.                                                                                                                    |
| `/auth/callback`, `/auth/confirm`, `/auth/link`, `/invitations/accept`, `/invitations/confirm` | None. These open from Google or from a mailed link, often in a tab that is already signed in, so each page decides for itself; `_auth`'s guard would bounce a visitor the page has just signed in. |
| `/register`, `/forgot-password`, `/reset-password`, `/verify-email`                            | Redirect in `beforeLoad` to `/login?notice=sign-in-link`, dropping any `?token=`. Old mailed links and bookmarks still reach them.                                                                 |
| `/$`                                                                                           | None. The splat route renders `RouteNotFound` inside its own `<main>`.                                                                                                                             |

Both layout guards stand down while maintenance is `full`
([Maintenance mode](#maintenance-mode)). The guards read the auth store
directly. That is sound because the root route's `beforeLoad` has already
awaited the session restore. A guard in a `useEffect` would see an empty store
on every reload and redirect wrongly.

**Sign-in is by emailed link or Google**; there is no password anywhere.

1. `/login` posts `POST /auth/link/request` and turns into "Check your inbox".
2. The link opens `/auth/link?token=…&email=…[&redirect=…]`.
3. That page posts the token once per page load, from a ref-guarded effect.
   It is never a query, so a refocus cannot spend the token.
4. The page lands on the safe `redirect`, on `/welcome` for a new account, or
   on the dashboard.

Every landing passes through `safeRedirect` (`src/lib/safe-redirect.ts`) and
replaces the token page in history. The accept and confirm pages follow the
same rules for invitation links.

**`/auth/confirm?token=…`** is the page the "Confirm it's you" email link
opens. It is outside the layouts for the same reason as the link pages.

- It posts the token to `POST /auth/step-up/link/verify` with the session's
  bearer, once per page load.
- Its result swaps the access token in place (`setToken`) and posts
  `step_up_confirmed` on the `auth` channel, so the tab that asked retries
  its action.
- It has no 404 branch: express answers a dead link with 400.

**`AppShell`** (`src/components/layouts/app-shell.tsx`) is the `/_app` route's
component. It wraps `AppLayout` in `StepUpProvider`, which owns the "Confirm
it's you" dialog. In required mode, while the setup flag is raised, it renders
the lazy Create your passkey screen in place of `AppLayout`
([Passkeys](#passkeys)). The URL stays the page the user opened, so after the
user creates the passkey the same route renders with no reload.

**The Google sign-in button** on `/login` is a plain anchor to
`GOOGLE_OAUTH_PATH`. `src/constants/routes.ts` derives it from `API_PREFIX`,
so moving the prefix moves it too. The API answers at one of two places:

- `/auth/callback`, with `new=1` for a new account (which lands on
  `/welcome`);
- `/login?error=<code>`, which the sign-in page explains in a toast.

**Loaders warm the query cache; components read it.** A loader calls
`queryClient.ensureQueryData(...)` with the same options a component's
`useQuery` uses, so the page renders from the cache. Three loaders do this:

- **`/_app`** reads the flags of the page the shell is entered on. It does not
  run again for a navigation that stays in the shell. `ensureFlags` waits at
  most `FLAGS_BOOT_WAIT_MS` (10 seconds), then resolves to the fallbacks. The
  read keeps going, and its values land in the cache.
- **`/_app/tenants/$slug`** (`startTenantRoute`) starts the tenant's detail
  read without waiting on it.
  - For a navigation that commits, it also awaits the tenant's flags (same
    cap). A hover preload starts the detail only.
  - It returns `{ tenant }`, the detail read, which route analytics awaits.
  - `preloadStaleTime: 0`, with a blocking stale reload, makes the commit run
    the loader again after a preload, before the page renders.
  - `TenantGate` shows the page's template until the detail lands.
  - A 404 on the detail resolves to `null`. The gate then reads the tenant
    list to choose between the suspended panel and the not-found panel.
  - Any other failure shows the gate's load-error panel, whose retry
    refetches the detail.
- **`/_app/settings/workspace/$slug`** runs the same `startTenantRoute` and
  renders the same `TenantGate`. Flags, the tenant switcher and analytics
  grouping resolve the tenant there as on `/tenants/$slug`.

**Pending, error and not-found screens.**

- Links preload on intent (`defaultPreload: 'intent'`).
- The pending component waits 300 ms before it shows, then stays at least
  300 ms.
- The error and not-found components are imported statically in
  `src/router.tsx`. When a chunk cannot be fetched, a lazy error screen could
  not load either.
- The pending templates are lazy wrappers fetched at startup, and fetched
  again once if that failed (`templatesReady`), because the router preloads
  none of them.
- `RouteError` recognises a failed chunk load (`src/lib/chunk-load-error.ts`)
  and offers a reload, the only way to pick up a new deploy's file names. Any
  other error offers a retry that re-runs the loaders.

**`QueryState`** (`components/shared/query-state.tsx`) renders every
query-backed section: skeleton, role refusal, retryable error, empty, or
content in a `SectionBoundary`. These read a query without it:

1. the bell and the tenant switcher, whose menus carry their own loading,
   unavailable and retry states;
2. the owners read on the members page, which shows a `LoadError` beside the
   list;
3. the Actor facet's member read, which shows the facet's own message;
4. `tenant-search-guard` and `maintenance-gate`, which render nothing.

**A flag-gated page** calls `requireClientFlag` in its `beforeLoad`, which
throws `notFound()` unless the flag has the opening value
(`src/pages/_app/tenants/$slug.beta.tsx` is the worked example). It hides
the page only; the API route behind it is what refuses
([Threat model](SECURITY.md#threat-model-for-a-browser-client)).

**Breadcrumbs** come from each route's `staticData.crumb`: a string, or a
function of the match's params. The module augmentation in `src/router.tsx`
types it. `AppLayout` builds the trail from the matches. It also inserts the
list pages that a detail page sits under in the reader's mind but not in the
route tree.

**Queries** live in `src/queries/`, one file per resource.

- Most files export a key factory and their hooks; the rest reuse another
  file's keys.
- `unwrap` (`src/http/client.ts`) returns the `data` of the API's success
  envelope.
- Keys nest by prefix, so invalidating a prefix refetches everything under
  it. `['tenants']` is a prefix of every tenant's detail, members, settings,
  invitations and onboarding. A mutation that means the list alone passes
  `exact: true`.
- The helpers in `src/lib/api-error.ts` read failed requests. A form maps the
  API's field errors onto its inputs through `useServerErrors`.

### The current tenant in the URL

The URL is the only source of truth for the current tenant, so the tenant
switcher and Settings › Workspace agree on every page. Tenant pages keep the
tenant in their path; every other page in the signed-in shell carries it as a
search param.

| Page                                                 | Tenant comes from | `?tenant`                 |
| ---------------------------------------------------- | ----------------- | ------------------------- |
| `/tenants/$slug/*` and `/settings/workspace/$slug/*` | the path          | never; removed if present |
| every other `/_app` page                             | the search param  | always, once resolved     |

Three files hold the code:

| File                                                                       | Holds                                    |
| -------------------------------------------------------------------------- | ---------------------------------------- |
| `src/lib/current-tenant.ts`                                                | The schema and middlewares               |
| `src/lib/tenant-guard.ts`                                                  | The pure resolution (`correctTenant`)    |
| `TenantSearchGuard` (`components/features/tenant/tenant-search-guard.tsx`) | The guard, around the layout's page slot |

`_app` owns the param:

- **`validateSearch`** (`tenantSearchSchema`) accepts `tenant` only as a slug
  express's pattern allows (`src/schemas/slug.schemas.ts`). It catches
  anything else as `undefined`.
- **The search middleware** (`retainTenant`) keeps the current tenant on every
  navigation inside the shell, as `retainSearchParams(['tenant'])` would.
  - The plain `retainSearchParams` reads only the current URL's search. A
    `$slug` page has no `?tenant`, so leaving `/tenants/acme` for `/dashboard`
    would lose the tenant.
  - `retainTenant` falls back to the tenant `installCurrentTenant` records on
    `onBeforeLoad`: the destination's `$slug`, else its `?tenant` when it has a
    slug's shape, else none.
  - It records before the router publishes the location. A link that renders
    for the new page (the sidebar's) then builds its href from that page's
    tenant. On `onResolved` it would keep the previous one.
  - A navigation that names `tenant` itself wins, `undefined` included.
  - The two `$slug` layouts declare `stripTenant`, so a link to them never
    carries `?tenant`.
- **The guard** (`TenantSearchGuard`) runs after mount, around the `_app`
  layout's page slot.
  - On a `$slug` page it never reads the list. It renders the page and drops
    any `?tenant` with a replace.
  - On any other page it reads the tenant list (the switcher's query). Until
    the list lands, it shows the pending template of the route directly under
    `_app` in the page slot, under the sidebar and header that have already
    rendered. Examples: the `dashboard` template on `/dashboard`, the list
    template on `/tenants`.
  - It then resolves the tenant, taking the first that applies: the URL's
    `?tenant` if it is eligible; the remembered tenant if it is eligible; the
    first eligible tenant in list order; none.
  - "Eligible" means a tenant in the caller's `GET /tenants` list that is
    neither the platform tenant nor suspended.
  - When the result differs from the URL, the guard navigates to the same page,
    replacing the entry. It keeps the other params and sets `tenant`, or
    removes it when there is none.
  - The guard remembers the resolved tenant for the user.
  - When the list fails, the guard renders the page with the URL as it is; the
    switcher shows the failure and a retry.
  - The guard decides only while the router is idle, when the location and the
    rendered matches belong to the same page. A hover preload renders nothing,
    so the guard never corrects it and remembers nothing from it.

**Reading the tenant.** Components call `useCurrentTenantSlug()`: the route's
`$slug`, else `?tenant`, else null.

- A `?tenant` that a loaded tenant list lacks, or lists as ineligible, reads
  as null. So a URL the guard has not corrected yet never enables the
  Workspace links.
- While the list loads, the URL is trusted.
- The remembered tenant (`src/states/current-tenant.store.ts`) is only the
  guard's fallback. It is written when `TenantGate` loads a tenant and when
  the guard resolves `?tenant`. It is never written for platform access or
  the platform tenant.

**The tenant switcher** acts by page:

| Current page              | Choosing a tenant                      |
| ------------------------- | -------------------------------------- |
| A workspace settings page | Opens the same section for that tenant |
| Another `$slug` page      | Opens `/tenants/$slug`                 |
| Any other page            | Changes only `?tenant`                 |

The change is a push, so Back returns to the previous tenant. It does not
touch flags, route telemetry or the API:

- flags are tenant-scoped only on `$slug` routes;
- `?tenant` is not in `ANALYTICS_URL_QUERY_ALLOWLIST`, so page views drop it;
- the API resolves a tenant from `:slug` in its own paths.

Apex has no tenant switcher, so none of this is shared.

### The Settings area

`src/constants/settings.ts` is the area's single source of truth. Two
constants drive the settings nav, the `/settings` landing page and the
settings layout's `h1`:

- `SETTINGS_GROUPS`: Account and Workspace;
- `SETTINGS_SECTIONS`: each page's path, label, description and icon.

The `h1` is the active section's label (`settingsActiveSection`), so each
page's own cards start at `h2`. To add a page, add a section there and a route
under `src/pages/_app/settings/`.

| Path                                 | Page                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `/settings`                          | Landing page: one card of links per group                  |
| `/settings/account/profile`          | Name, email and the privacy (analytics) choice             |
| `/settings/account/security`         | Sign-in methods and other sessions                         |
| `/settings/account/notifications`    | Notification preferences                                   |
| `/settings/account/delete`           | Ask for the account to be deleted, or see the open request |
| `/settings/workspace/$slug/general`  | The tenant's details and settings; `$slug/` redirects here |
| `/settings/workspace/$slug/members`  | Members, roles and pending invitations                     |
| `/settings/workspace/$slug/activity` | The tenant's audit log                                     |

Permissions never hide a section. A member who cannot manage the tenant sees
the read-only views under a banner saying owners and admins can change them.

**The sidebar on settings pages** is `NavSettings`: Back to app, then the
Account and Workspace groups.

- Workspace items link to the current tenant, `useCurrentTenantSlug()`
  ([The current tenant in the URL](#the-current-tenant-in-the-url)).
- The Workspace label names the tenant when the tenant list has it
  ("Workspace · Acme Corp").
- With no tenant, the Workspace items are `aria-disabled` buttons and the
  landing page's rows are plain text. The hint "Choose a workspace first."
  describes both.
- Choosing a tenant in the switcher while on a workspace page keeps the same
  section for the chosen tenant.
- The workspace layout's breadcrumb (the slug) is text, because
  `/settings/workspace/$slug` only redirects to General.

**Redirects** keep earlier bookmarks working. Each works with and without a
trailing slash, and keeps the query string and hash:

| From                            | To                          |
| ------------------------------- | --------------------------- |
| `/profile`, `/settings/account` | `/settings/account/profile` |
| `/tenants/$slug/members`        | The workspace Members page  |
| `/tenants/$slug/settings`       | The workspace General page  |
| `/tenants/$slug/activity`       | The workspace Activity page |

The tenant page itself keeps its Overview and (flag-gated) Beta tabs.

## Lists

This section is for anyone who adds or changes a list page. Every list page
renders through one table, `DataTable` (`components/shared/data-table/`), over
one URL contract and one query shape. The code is shared with apex
([Shared core](#shared-core)).

Lists use the API's list contract:

- **In:** `?search`, `sort` (a leading `-` is descending), `cursor`,
  `direction`, `limit` and each list's filters.
- **Out:** `{ items, page, total? }`, where `page` is `{ nextCursor,
  prevCursor, hasNext, hasPrev, limit }`.

**The URL contract.** A list is declared once, at module scope, with
`defineList` (`schemas/list.schemas.ts`). The declaration names:

- its sort whitelist (the first key is the default);
- its filters: `listFilter` for a comma list of known values, `booleanFilter`,
  `idFilter`, `dayFilter`;
- the `table` name its analytics events carry;
- optionally `extra`, the route's own params.

The result's `schema` is the route's `validateSearch`. The shared fields are
`search`, `sort`, `cursor`, `direction` (`prev` only), `limit` (20, 50 or 100) and `hidden` (column ids, a comma list). Rules:

- Every field is `.optional().catch(undefined)`. A malformed value is dropped,
  never an error page.
- Defaults are omitted from the URL and the request, so a default view's URL
  has no list params. A route whose `extra` params have defaults strips them
  with `stripSearchParams`.
- A second list on one route sets a `prefix` (`invitationsSearch`,
  `invitationsSort`). The first list names it in `also`, so the route's one
  schema keeps both lists' params.
- A filter is never named `tenant`, which is the shell's `?tenant`.

**The request.** `listValues` reads a validated search into a list's values,
and `listRequest` turns them into the API request. Both are in
`schemas/list-request.schemas.ts`, which only the table loads, so a route's
schema stays small.

`listQueryOptions` (`queries/list.queries.ts`) is the one query shape:

- The key is `[...key, 'list', request]`.
- The first page (no cursor) also asks for `total=1`.
- `placeholderData: keepPreviousData` keeps the previous rows up, marked busy,
  while the next view loads.
- The API caps the total at 1,000 (`capped: true` reads "1,000+ results").
- `total: false` leaves `total=1` off for a read that never uses the total,
  such as the bell's preview. It is part of the cache key (`'no-total'`), so
  that page never stands in for one with a total.
- `retryList` is the default retry: once, except that a 4xx other than 408 and
  429 is final (a refused param, cursor or role, or a missing route). A list
  passes no `retry` of its own.

**`useListSearch(definition)`** is one list's URL state and its writes.

- Any write except paging and column choice drops the cursor and direction,
  because a cursor belongs to the view it was cut from. Hiding a column keeps
  the page.
- Typing a search replaces the history entry. Every other write (a filter, a
  sort, a page size, a page) pushes one.
- A default is written as no key.
- It fires `table_filtered`, `table_sorted` and `table_paged`, naming the list
  and never a value.
- "Showing 21–40" counts from a page index this tab recorded as the reader
  paged. `resetListPositions` forgets them; `tests/setup.ts` calls it after
  each test.
- A page the API answers with no previous page is index 0, whatever was
  recorded.
- A `prev` page with no next page has no known position, so "Showing" is left
  out rather than wrong. That is the API's last-page answer to a cursor whose
  page came back empty.

**`useListQuery(list, options, { enabled })`** is the page: `items`, `page`,
the query, and the view's `total`.

- A later page keeps the first page's total through a disabled observer on the
  first page's cache entry.
- While a new view's first page loads, the total is absent, never the
  previous view's.
- A 400 with `code: 'CURSOR_INVALID'` on a page with a cursor means the API
  refused the cursor (tampered, rotated key, or cut from another view). The list drops `cursor` and `direction`, replacing the refused history
  entry, and reloads its first page. The query reads as pending meanwhile, so
  the refusal never shows as an error.
- Any other 400 is an error the table shows.

**`DataTable`** takes the columns, the query state, a `label`, a `getRowId`,
and the `empty` state; the rest is optional (`search`, `filters`, `toolbar`,
`card`, `layout`, `landmark`, `rowTarget`, `errorMessage`).

- _States_ come from `QueryState`:
  - a table-shaped skeleton inside `role="status"`;
  - a role refusal;
  - a load error with Try again: the list's own `errorMessage`, or
    `{label} didn’t load. Select Try again.`;
  - the empty state, or the rows.

  An empty list under a search or filter says "Nothing matches these
  filters." with Reset. An empty page behind a cursor says "Nothing on this
  page." with First page. While the page on screen is the previous view's
  placeholder, an empty one shows the skeleton, never "nothing matches", and
  "Showing" is hidden.

- _Columns_ are built with `createColumnHelper<DataTableFeatures, Row>()` and
  passed as a stable array (module-level or memoized). A column's `meta`
  carries:
  - `sorts`: the API keys its header steps through;
  - `sortName`: its name in `table_sorted`;
  - `sortWords`: picks "A to Z", "oldest first" or "lowest first";
  - `label`: names a column whose header is not a string;
  - `actions: true`: marks the actions column, which is never hideable.

  The first column is never hideable either (`canHideColumn`). A stale
  `?hidden=` id for a column that cannot hide is ignored. Sorting and paging
  are server-side (`manualSorting`, `manualPagination`).

- _The toolbar_ holds the search box, the faceted filters with their chips,
  the Columns menu, the list's own controls (`toolbar`) and the total. The
  search box follows outside changes to `?search` (the command palette, a
  history pop). When the change is its own echo, it keeps newer keystrokes, so
  a page never adds its own sync.
- _Phone cards._ Below 768 pixels (px) wide, or with `layout="cards"`, the
  rows render as cards built from the visible columns. The first column is the
  title, and actions sit at the bottom.
  - A custom `card(row, { target })` replaces the card. It renders one
    `role="listitem"` and puts `target` on it as the row's focus landmark.
  - Card layout gets a "Sort by" menu in the toolbar row when any column is
    sortable. It offers "Default order" when no column owns the list's default
    sort (reported as `table_sorted` with `sort: 'default'`).
  - With a custom card, the Columns menu is hidden in card layout.
- _Names._ The table sits in `<section aria-label={label}>`, and its paging
  landmark is `{label} pagination`. A page with two lists therefore passes
  axe's `landmark-unique` rule.
  - Each toolbar control is named with what it shows, then the list
    (`controlName`): "Filter by role, Members", "Columns, Members", "Reset,
    Members", "Rows per page, Members" and "Sort by, Members".
  - The name starts with the visible words, as Web Content Accessibility
    Guidelines (WCAG) 2.5.3 asks. A buttons list never shows two of one name.
  - "Previous page" and "Next page" keep their names, because the
    `{label} pagination` landmark names the list.
  - A parent that is already the list's named region passes
    `landmark={false}`.

**Adding a list.**

1. Define the URL contract with `defineList`, in a module of its own when the
   list's queries are heavy. `notification-list.queries.ts` holds the inbox's,
   so the route's `validateSearch` does not pull the writes into the entry
   chunk. For the same reason, a filter's values come from a constants module
   (`membership-roles.ts`, `audit-action-names.ts`), not from the module that
   holds the labels.
2. Write the page's options: `(request) => listQueryOptions<Row>({ key, path,
   request })` under the resource's key prefix, so a write's invalidation
   reaches every page.
3. Write the columns with `createColumnHelper`, at module scope.
4. Set `validateSearch: list.schema` on the route (with `search: {
   middlewares: [stripSearchParams(...)] }` when `extra` has defaults).
5. In the page: `const list = useListSearch(def)`, `const query =
   useListQuery(list, options)`, then `<DataTable columns query label
   getRowId empty ... />`. Pass `errorMessage` when the list has load-error
   copy of its own.
6. Test it through `tests/unit/components/shared/data-table/list-harness.tsx`
   (`renderTestList`, `serveTestItems`, `testColumns`, `atPhoneWidth`) and
   answer in `listPage(items, page?, total?)` from `tests/fixtures/list-page.ts`.

**Keep the entry chunk small.** `pnpm check:bundle` enforces the entry budget,
`ENTRY_BUDGET_BYTES` in `scripts/check-bundle.mjs` (593,750 bytes on 3
November 2026). The comment above that constant records each raise, with its
measurement and reason. Two rules keep lists from growing the entry:

- **Keep zod classes out of route schemas.** Use `z.custom` rather than
  `z.number`, `z.literal` or `z.boolean` in a route's search schema, as
  `list.schemas.ts` does for `limit` and the yes/no filter.
- **Keep `components/shared/data-table/**` (and TanStack Table) out of
  anything the entry imports.** The switcher, the bell, `nav-secondary` and
  the guard never import from it.

This list code does reach the entry, and adds no zod class:

- the list contract's route schemas and query options, through each list
  route's `validateSearch` and the tenant queries;
- the paged membership read, the members and activity routes' schemas, the
  owners read and the audit action names.

The list route search types are type-only and cost nothing.

Passkeys put three things in the entry:

- The `/auth/confirm` route registration, about 1.1 kilobytes (KB), because a
  top-level route cannot be lazy-registered.
- Lazy-chunk file names in the entry's preload map (`__vite__mapDeps`), from
  the Passkeys section and the setup screen, which also split
  `passkey.queries` out of `login`.
- Required mode's setup interceptor, its store and the retry predicate, so the
  entry catches the first 403.

No passkey UI is in the entry, and the WebAuthn package stays in a lazy chunk.

**The inbox** is a list in card layout.

- Its writes (mark read, mark all read, delete) are optimistic across every
  cached page of every view. A read row leaves the unread views and lowers an
  exact unread total by one.
- Each write carries `WRITE_KEY`, so code can tell whether another write is in
  flight (`isMutating`). A rollback or a refetch waits for the last write to
  settle, because an earlier one would undo a later write's edit.
- The bell reads a `limit=5` preview with `total: false`, and the unread count
  from the unread view's total.

## State

This table lists where each piece of client state lives and whether it
survives a reload.

| What                                                  | Where                                                   | Persisted                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Access token, user, bootstrapped flag                 | `src/states/auth.store.ts`                              | No: memory only                                                                                                                                                                                              |
| Maintenance mode, message, start time                 | `src/states/maintenance-mode.store.ts`                  | No: each load starts at `off` and learns it from the API                                                                                                                                                     |
| Sidebar collapsed                                     | `src/states/sidebar.store.ts`                           | No                                                                                                                                                                                                           |
| Command palette open, and the typed query             | `src/states/command-palette.store.ts`                   | No                                                                                                                                                                                                           |
| Recent tenants in the palette, per user               | `src/components/shared/command-palette/recent-items.ts` | `localStorage` key `palette.recent.v1:<userId>`, when storage allows: kind, id, the name the pages show, a time; at most 5 tenants; cleared when the session ends, expiry and a dead session cookie included |
| Last tenant opened, per user (the `?tenant` fallback) | `src/states/current-tenant.store.ts`                    | `localStorage` key `last-tenant:<userId>`, when storage allows                                                                                                                                               |
| Theme (`light`, `dark`, `system`)                     | `src/states/theme.store.ts`                             | `localStorage` key `theme`, read pre-paint by `theme-init.js`                                                                                                                                                |
| Everything the API returns                            | The TanStack Query cache                                | No                                                                                                                                                                                                           |
| Form state                                            | TanStack Form, per form                                 | No                                                                                                                                                                                                           |

Code outside React reads and writes the stores through `getState()`, as the
interceptors and route guards do, or subscribes to them:

- The session module follows the auth store's user, to keep analytics and the
  flag caches in step.
- The maintenance recovery follows the mode.

The auth store's user is the profile the session restore or the sign-in
loaded. The maintenance store holds what the API last said about the mode,
from any of its three sources ([Maintenance mode](#maintenance-mode)).

Every `queryFn` hands TanStack Query's `signal` to `apiClient`. A cancelled
query (`cancelQueries`, or a read no observer wants any more) therefore aborts
its request on the wire. `tests/unit/queries/query-cancellation.test.tsx` pins
this for each read, and `list.queries.test.ts` for the list pages.

## The HTTP layer and session

This section covers how the app calls the API and how it keeps a session
alive across reloads and tabs.

Every REST call goes through `apiClient` (`src/http/client.ts`). It is an
axios instance with:

- the relative `API_PREFIX`, `/api/v1`, as its base;
- credentials sent;
- a 30-second timeout. Axios has none by default, and a request that never
  answers would leave its mutation pending and its button disabled.

**The prefix is fixed and same-origin.** It is written once, as `API_PREFIX`
in `src/constants/routes.ts`. The axios base derives from it, and the
analytics proxy path repeats it. The development server proxies `/api` to the
API (`vite.config.ts`), and the container's nginx does the same, so the app
only ever calls the origin that served it.

Moving the prefix means one change that edits:

- `API_PREFIX`;
- `nginx.conf`, because `location /api/v1/collect/` hardcodes `/api/v1`;
- for a prefix outside `/api`, also the `/api/` location and the Vite proxy.

There is no environment variable for the prefix. One that moved only the
axios base would leave every path that repeats or hardcodes the prefix on the
earlier value. This app's own users of the prefix are in
[Routing](#routing-and-data-loading) and [Realtime](#realtime-this-app-only).

**Interceptors**, installed by `installInterceptors`. The two request
interceptors are independent of each other. The response interceptors run in
the order they are registered:

| Direction | Order | Interceptor                   | Does                                                                                                                                                                |
| --------- | ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request   | –     | Bearer token                  | Adds `Authorization: Bearer` from the auth store when the request has none.                                                                                         |
| Request   | –     | Trace headers                 | On a same-origin request under the prefix: a `traceparent` when the request has none (a replay keeps its own), and the analytics session id when one may be linked. |
| Response  | 1     | 401 handling                  | Refreshes and replays once on an expired token; signs out on a verdict; leaves `REAUTH_REQUIRED` to the caller.                                                     |
| Response  | 2     | `rejectMalformedJsonResponse` | Rejects a 2xx whose body is not a JSON object, such as an HTML page from a misrouted proxy.                                                                         |
| Response  | 3     | Passkey setup                 | Raises the setup flag on a 403 `PASSKEY_SETUP_REQUIRED` and rejects with the same error (`installPasskeySetupInterceptor`, `src/lib/passkey-setup.ts`).             |

The passkey-setup interceptor is installed from `src/router.tsx`, after the
maintenance one. The app-side interceptors are not in `src/http/`, which stays
shared with apex.

A replay goes through the whole chain again. The rules each step enforces,
and why, are in [Sign-out rules](SECURITY.md#sign-out-rules).

`traceparent` values come from `src/http/traceparent.ts`: random ids from
`crypto.getRandomValues`, flagged sampled. There is no tracing software
development kit (SDK) in the browser. The header only lets the API's span join
a trace the browser chose.

**The session** (`src/http/session.ts`):

- `ensureSession()` is the single entry to a refresh. Callers in a tab share
  one in-flight promise, and tabs queue on the `auth-refresh` Web Lock.
- `refreshSession()` posts `/auth/refresh`, then loads `/profile` with the
  new token, because the refresh returns only a token. A profile whose id
  differs from the tab's user fails the refresh with
  `SessionIdentityChangedError`.
- `useAuthStore.setToken()` swaps the access token and keeps the user. It is
  the only token swap that is not a sign-in. A "Confirm it's you" result (by
  email link or passkey) calls it, so the next write carries a recent sign-in.
- `isAuthVerdict()` is the one test of whether a failure may end a session.
- `redirectToLogin()` is the one place a dead session navigates, to
  `/login?redirect=…`.
- `installAnalyticsIdentity()` subscribes to the auth store. A change of user
  resets analytics, and drops every cached flag value and exposure mark,
  before the next user is identified.

The `auth` BroadcastChannel carries three messages between tabs, none with
data:

| Message             | Posted by                                                | What a listening tab does                                                                                                                                                                                                         |
| ------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `logout`            | A sign-out                                               | Signs out.                                                                                                                                                                                                                        |
| `signed_in`         | The page that spent a sign-in or invitation-confirm link | A tab with a link out (the sign-in form's "Check your inbox", or the accept page while its confirmation link is out) restores the shared session with `ensureSession()` and moves on. A tab that is already signed in ignores it. |
| `step_up_confirmed` | `/auth/confirm`, after it confirms                       | The tab that asked ([Confirm it's you](#confirm-its-you)) hears it through the `step-up-wait` Web Lock and retries its action.                                                                                                    |

Why each of these holds, and what breaks if it does not, is in
[Token storage and refresh](SECURITY.md#token-storage-and-refresh) and
[Sign-out rules](SECURITY.md#sign-out-rules).

## Passkeys

This section covers the browser half of passkey sign-in, setup and
management. Express runs passkeys in one of three modes: `off`, `optional` and
`required`. The app reads the mode from the public `GET /auth/passkeys/config`
(`{ mode, rpId }`).

- `usePasskeyConfig` (`src/queries/passkey.queries.ts`) reads it without a
  bearer. It treats any failure as `off`, a 404 from an API without passkey
  routes included.
- In `off` the app shows no passkey button and no Passkeys section, and makes
  no other passkey request.

The parts:

- **WebAuthn code is lazy.** `src/lib/webauthn.ts` is the only importer of
  `@simplewebauthn/browser`, through one cached `import()`.
  `pnpm check:bundle` fails if the package reaches a first-visit chunk, and
  fails if no chunk holds it.
- **Sign-in.** When the mode is not `off` and the browser supports WebAuthn,
  `/login` shows "Sign in with a passkey". It also starts a conditional
  (autofill) request on the email field (`use-passkey-autofill.ts`).
  - Clicking the button, sending a link or leaving the page cancels that
    request first.
  - Nobody asked for that request, so a failure before a pick ends quietly.
    Examples: the options request fails, or the browser refuses the request,
    as headless Chrome does with `NotSupportedError`. The button reports its
    own failures.
  - A stale autofill pick (`PASSKEY_VERIFICATION_FAILED`) restarts autofill
    once, quietly. Any other refusal of a picked passkey shows a toast.
- **Settings.** Settings › Security shows the Passkeys section
  (`passkeys-section.tsx`, `passkey-dialogs.tsx`) between Sign-in methods and
  Other sessions: list, Create, Rename and Delete. Create and Delete run
  through `useStepUp().run`, so a `REAUTH_REQUIRED` opens the dialog and
  retries.
- **Required mode.**
  - A 403 `PASSKEY_SETUP_REQUIRED` raises `passkey-setup.store`. `AppShell`
    then swaps `AppLayout` for Create your passkey
    (`passkey-setup-screen.tsx`).
  - `finishPasskeySetup` clears the flag and re-runs the loaders, so the page
    the user opened renders without a reload.
  - The flag resets on sign-out or a switch of user, not on sign-in.
  - The notification stream (`useNotificationStream`) reads a 403's body. On
    `PASSKEY_SETUP_REQUIRED` it stops and does not reconnect.

### Confirm it's you

"Confirm it's you" is the step-up check for writes that need a recent
sign-in. `StepUpProvider` and `useStepUp().run(action)` wrap a write that
express may refuse with 401 `REAUTH_REQUIRED`: tenant invitations and members,
creating and deleting a passkey, and signing out other sessions.

1. The refusal opens `StepUpDialog`. An explicit cached import loads it on
   first use; a failed import rejects every waiter and closes.
2. The dialog tries the passkey first when the user has one. `NO_PASSKEY`
   goes straight to the link view.
3. It offers "Use another method": an emailed link to open in this browser,
   which leads to `/auth/confirm`. From the link view it offers "Use your
   passkey instead".
4. Either path ends in `setToken`, then the action runs again.

`src/lib/step-up.ts`, `step-up-presence.ts` (the `step-up-wait` lock) and
`src/hooks/use-step-up.ts` hold the shared mechanics. `write-failure.ts` maps
`REAUTH_REQUIRED` to the step-up refusal copy.

The link view states the link's expiry from the request's own answer
(`expiresAt`, written by `formatExpiry` with the zone named). It says the link
expired when that time passes. Two answers name no expiry: a 429
`STEP_UP_LINK_COOLDOWN`, and one from an API that predates the field. Then the
view states no expiry and never says the link expired.

### Client settings

Copy that states a link's lifetime or the support address reads them from
express's public `GET /status/client-settings` (`useClientSettings`,
`src/queries/client-settings.queries.ts`):

| Field                  | Express setting    |
| ---------------------- | ------------------ |
| `signInLinkTtlSeconds` | `SIGN_IN_LINK_TTL` |
| `stepUpLinkTtlSeconds` | `STEP_UP_LINK_TTL` |
| `invitationTtlSeconds` | `INVITATION_TTL`   |
| `supportEmail`         | `SUPPORT_EMAIL`    |

A deployment that changes one of those settings changes the copy. TTL means
time to live.

- The read is public (no bearer, no refresh retry) and fresh for an hour.
- A 404, from an API that predates the route, or a body of another shape
  reads as no settings. Any other failure rejects, and the next reader asks
  again.
- While there are no settings, the copy leaves the figure or the address out
  ("The link works once.", "Contact support to restore access."). It never
  falls back to a default written into the copy.
- `src/lib/link-lifetime.ts` writes the figures as express's mail does: links
  in minutes, invitations in whole days rounded up.

These read it: the sign-in form, the dead-link page, the invitation's "Check
your inbox", the confirm page's dead link, the invite card, the
suspended-workspace panel and the payments-off line.

## Realtime (this app only)

The notification inbox follows the API's server-sent events (SSE) stream at
`/api/v1/notifications/stream`. Two pieces handle it:

- **`src/http/sse.ts`** parses frames out of a `fetch` response body, doing
  the framing `EventSource` would. Why `fetch`:
  [Token storage and refresh](SECURITY.md#token-storage-and-refresh). The
  parser:
  - keeps the unfinished tail between reads;
  - accepts carriage-return-line-feed (CRLF) separators;
  - skips comment lines (the API's keep-alive pings);
  - throws past its buffer limit (1,048,576 characters), which ends that
    connection and sends it into the reconnect path.
- **`useNotificationStream`** (`src/hooks/use-notifications.ts`) owns the
  connection for as long as there is an access token. It is mounted once, in
  `AppLayout`'s body, for two reasons. Two mounts would open two connections.
  And below the `md` breakpoint the sidebar renders into a sheet whose content
  unmounts while it is closed.

The hook's connection cycle:

- **Connect** with the token in a header and, on a reconnect, the last
  event id seen as `Last-Event-ID`, so the API can replay what was missed.
  Each accepted connect refetches the notification list, which also covers
  the first connect.
- **A `notification` frame** refetches the list and resets the backoff.
  Nothing else resets the backoff. Otherwise a server that accepts and then
  closes with no frames would pin retries at one second, each of them a
  refresh that rotates the cookie.
- **A dropped stream or a 401** waits the backoff (1 second, doubling to 30
  seconds), then calls `ensureSession()`.
  - When the refresh returns the same token, the hook reconnects.
  - A new token re-runs the effect, which owns that reconnect.
  - An auth verdict sends the user to `/login`. Any other refresh failure is
    retried.
- **Any other refusal** says nothing about the session. Examples: a 503 at the
  API's stream capacity, a 429 over the per-user cap. The hook reconnects with
  the same token and no refresh. It waits the longer of the backoff and the
  response's `Retry-After`, capped at five minutes, plus up to 20 % jitter.
- **A 403 `PASSKEY_SETUP_REQUIRED`** (required mode switched on while the
  stream was open) raises the setup flag and stops. The hook does not
  reconnect, and the effect idles until the flag clears.
- **A token change or unmount** cancels the timer and aborts the request.

**nginx and the stream.**

- Each open stream holds two connections in nginx, the browser's and the one
  to the API, for as long as its tab is open. `docker/nginx.main.conf` sizes
  `worker_connections` for that.
- `nginx.conf`'s `location /api/v1/notifications/stream` turns off buffering,
  empties the `Connection` header and raises the read timeout.
- That location hardcodes the API prefix, so moving `API_PREFIX` means editing
  it too.
- Its logging choices are in [CSP and headers](SECURITY.md#csp-and-headers).
- The dev server's proxy does not propagate an upstream close. The reconnect
  path can only be exercised against the image (the `nginx` Playwright
  project).

## Analytics, flags and errors

This section covers how the app reports analytics and errors and reads
feature flags. The browser never talks to PostHog directly:

- Analytics and error tracking share one transport, the API's
  `/api/v1/collect` proxy, which forwards to PostHog.
- Flags are read from, and exposures reported to, the API's own flag
  endpoints.

What each sends, masks and withholds is in
[Analytics privacy](SECURITY.md#analytics-privacy) and
[Error-tracking privacy](SECURITY.md#error-tracking-privacy).

### Analytics

`src/observability/telemetry/` is the only code that imports posthog-js,
and `telemetry.ts`, the facade, is the only module that imports it as a
value, through a dynamic `import()`. The rest of the app imports the barrel,
`index.ts`.

- **Lazy load with a queue.** `initAnalytics()` loads posthog-js once, after
  the first route load.
  - Calls made before it has loaded queue up. They replay in order when it
    loads, before any event is sent, so queued identity is applied first.
  - The queue holds 100 commands. Past that, the oldest queued event capture
    is shed. Identity, reset, group and consent calls are never shed.
  - With no PostHog key, or consent mode `off`, the facade turns inert and
    every call is a no-op.
  - A throwing SDK call is swallowed: analytics never fails a user action.
- **Page views come from the app, not the SDK.** posthog-js's own history
  page views are off; the app captures `$pageview` with `capturePageview()`
  (this app's router hook: [Router hooks](#router-hooks-this-app-only)).
- **Identity follows the auth store**, through `installAnalyticsIdentity` in
  `src/http/session.ts` ([The HTTP layer and session](#the-http-layer-and-session)).
- **Passkey events.** `sign_in_completed.method` is `'link'`, `'google'` or
  `'passkey'`. `passkey_prompt_cancelled` carries only the ceremony
  (`sign_in`, `create` or `confirm`), never a passkey or its name.
- **Per-app constants** sit at the top of
  `src/observability/telemetry/config.ts`:
  - the `app` property;
  - the query-key allowlist;
  - whether consent modes and the cross-domain handoff are supported;
  - how the identity cookie is shared.

  The registry of typed events is `event-registry.ts`. Everything else in the
  folder is shared with the sibling app
  ([Shared core](#shared-core)).

- `src/observability/identity-epoch.ts` counts the calls that change who an
  event belongs to. It is a module of its own that imports nothing, so the
  entry-chunk error listener can read it without importing the facade.

### Feature flags

The API is the only evaluator; posthog-js does no flag work. Values are read
per scope. `src/observability/flags/flag-scope.ts`, which each app owns, says
which scope a page reads and which endpoint answers it. This app's scopes are
in [Router hooks](#router-hooks-this-app-only).

- **The registry slice** is `CLIENT_FLAGS` in `flag-keys.ts`, also per app.
  It mirrors by hand the API registry's entries that the app reads, each with
  its kind, variants, fallback and whether it is an experiment.
  `normalizeFlags` drops a value the server sends for a key the slice lacks,
  and turns a missing or invalid value into that flag's fallback.
- **Reads.** One query per scope (`flag-query.ts`):
  - fresh for five minutes;
  - refetched every ten minutes, and on focus once stale;
  - never retried.

  `ensureFlags` never rejects, so a failed read renders the page with
  fallbacks. Pages read values with `useFlagValues()` and `useVariant(key)`
  (`flag-hooks.ts`). They show the fallback while loading and after a
  failure.

- **A change of user** drops every scope's values and the exposure marks
  ([The HTTP layer and session](#the-http-layer-and-session)).
- **Exposure.** `useVariant` on an experiment flag, once its value came from
  the server, reports the key, never the value. It reports to the scope's
  `/exposures` endpoint (`exposure.ts`):
  - batched for 50 ms;
  - at most 10 keys per request;
  - once per scope, key and value in a tab session.

  The API re-evaluates and records the exposure.

- **`$feature/*` super properties** carry each flag's value on every browser
  event. `useFeaturePropertiesSync`, mounted once in the signed-in layout,
  syncs them in a layout effect, never from a query or loader. A loader also
  runs for a hover preload, whose scope is not the page's. The app's router
  also syncs them before each page view.

### Router hooks (this app only)

`src/router.tsx` subscribes three hooks of this app's own to the router. All
three run on committed navigations, never in a loader, because a loader also
runs for a hover preload. A fourth, `installCurrentTenant`, records the tenant
`retainTenant` carries
([The current tenant in the URL](#the-current-tenant-in-the-url)).

- **Page views and the tenant group.** `installRouteAnalytics`
  (`src/observability/route-telemetry.ts`) runs on `onResolved`.
  1. It sets the tenant group from the tenant read in the tenant route's
     loader data, awaited for at most `TENANT_GROUP_WAIT_MS` (10 seconds), or
     clears it.
  2. Only then does it capture `$pageview`, when the path changed.

  Resolves are handled in order, so a later page's view waits behind an
  earlier tenant read. The hook is installed before the first load, so the
  landing page is counted.

- **Flag scopes.** A tenant page reads `/tenants/:slug/flags`, and every other
  page reads `/flags` (`flagScopeFor` in `flag-scope.ts`).
  - The `_app` loader warms the scope the shell is entered on. The tenant
    route's loader warms a tenant's scope on a switch.
  - On a resolved navigation to a different tenant, `installFlagScopeReset`
    drops every other scope's values and the exposure dedupe. Returning to a
    tenant then reads its flags afresh.
- **`$feature/*` before each page view.** `installRouteFeatureProperties`
  syncs them on `onLoad`, which fires before `onResolved` captures the page
  view and never for a preload. It gives the first page view its properties,
  because that load runs before React mounts. A page outside the signed-in
  shell syncs to the no-tenant scope's cached values, or to none.

### Error tracking

Error tracking is split so that the entry chunk carries only `listen.ts`, and
the reporter loads later:

- **`listen.ts`**, in the entry chunk, notes raw errors and nothing else. Its
  sources:
  - the window listeners;
  - React's root `onUncaughtError` and `onCaughtError` (`rootErrorOptions`,
    passed to `createRoot`);
  - `noteError`, for an error the app catches that those hooks never see.
    This app's callers are `RouteError` and `ToastHost`.

  It drops repeats, buffers up to 20 errors (`ERROR_BUFFER_LIMIT`), and loads
  the reporter on the first error or when the browser is idle. It imports
  only `identity-epoch.ts`. `pnpm check:bundle` caps it at 1 KB gzipped, and
  keeps `@posthog/core` and posthog-js out of the first-visit chunks.

- **`report.ts`** is lazy. It filters each error, builds a `$exception` with
  `@posthog/core`, and scrubs, caps and attributes it as
  [Error-tracking privacy](SECURITY.md#error-tracking-privacy) describes.
  - It posts batches to `/api/v1/collect/batch/` and retries a failed batch
    once.
  - On `pagehide` it sends whatever is left by `sendBeacon`.
  - The batch, retry and cap constants are at the top of the file.
- **The reporter never imports the router.** `src/router.tsx` registers a
  route-id reader with `setErrorRouteSource`, so the reporter can still report
  a crash in the router's own module.
- **Releases.** `vite.config.ts` bakes `GIT_SHA` into the bundle as the
  release (`dev` when unset). The image build then:
  1. injects chunk ids into every chunk with `posthog-cli sourcemap inject`,
     offline and with no release, so an unchanged chunk keeps its bytes under
     its hashed name;
  2. uploads the hidden source maps and deletes them
     ([The container and run-time config](#the-container-and-run-time-config)).

## Maintenance mode

The API enforces maintenance; the app shows it. This section covers how the
app learns the mode and what each mode shows. The mode lives in
`src/states/maintenance-mode.store.ts` and arrives three ways:

- **Every API response's `Maintenance-Mode` header**, read by the
  interceptor in `src/lib/maintenance-mode.ts`.
  - Only a known value (`off`, `read_only`, `full`) moves the mode.
  - A response with no header, such as nginx's own 502 page during a deploy,
    changes nothing. So does a response with an unknown value.
  - A different mode clears the message and start time, which belong to the
    previous mode.
- **A 503 whose `code` is `MAINTENANCE_MODE` or `READ_ONLY_MODE`**, read by
  the same interceptor, with the body's mode, message and start time.
- **`GET /status/maintenance`** (`src/queries/maintenance-status.queries.ts`).
  - The app reads it once when it starts. While the mode is `full`, it polls
    every 30 seconds plus up to 10 seconds of jitter.
  - It sends `Cache-Control: no-cache`. A cached status from before a change
    would overwrite the newer mode a header just reported.
  - A body with no known mode rejects, and a failed poll never stops the next
    one.

The interceptor is installed on `apiClient` from `src/router.tsx`, before the
first request. It runs after the interceptors of
[The HTTP layer and session](#the-http-layer-and-session), so it sees what
they pass on, a replay's answer included. It never changes a response's
outcome. It lives in `src/lib/` rather than `src/http/`, because `src/http/`
is shared with the sibling app and carries no maintenance handling.

`MaintenanceGate` wraps every route, in the root route's component:

- **`full`**: it renders `MaintenancePage` in place of the route tree, sign-in
  and the link pages included, with the owner's message as text.
  - Because the outlet is not rendered, `AppLayout` unmounts, and the
    notification stream's cleanup aborts its connection.
  - The `_app` and `_auth` guards do not redirect while the mode is `full`, so
    the URL is kept.
  - The API lets `POST /auth/refresh` and `GET /profile` through in `full`, so
    a page loaded then restores its session as usual. A page ends up with no
    user only in a case such as an unreachable API.
- **When `full` ends**, `installMaintenanceRecovery`:
  1. calls `ensureSession()`. A failure is ignored; the store signs out only
     on a verdict.
  2. calls `router.invalidate()`, which runs every guard and loader again on
     the URL the user never left;
  3. refetches every active query.
- **`read_only`**: a banner sits above the page.
  - Inside the signed-in shell, `AppLayout` draws it under its header, so the
    fixed sidebar never covers it. The gate draws it for every other page.
  - A write the API refuses with `READ_ONLY_MODE` shows "Changes are paused
    during maintenance." in one toast, however many writes fail at once
    (`useServerErrors`). The form keeps what was typed.
- **A header that switches the mode on without a start time** makes the gate
  read the status endpoint again. It cancels any earlier read still in
  flight, so that read's answer cannot revert the mode.
- **`maintenance_page_viewed`** is tracked once per tab session for each
  maintenance period, keyed on its start time, under the usual consent rules.

`MaintenanceGate` and `MaintenancePage` are imported statically into
`__root.tsx`, for the same reason as the router's error screen. They are
needed exactly when the API is failing, a bad moment to fetch a lazy chunk. A
maintenance 503 never signs anyone out
([Sign-out rules](SECURITY.md#sign-out-rules)).

## The container and run-time config

This section covers how the image is built and served, and how settings
reach the bundle at container start. The `Dockerfile` has two stages.

**Build stage** (`node:26-alpine`, pinned by digest):

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
user id (uid) 101 on port 8080. It is built for a read-only root filesystem:
everything it writes is under `/tmp`, which must be a writable tmpfs (an
in-memory filesystem).

- `docker/nginx.main.conf` replaces the image's `nginx.conf`. It holds the pid
  file and temp paths under `/tmp`, the connection limits (its comments give
  the sizing), and an include of `/tmp/nginx/conf.d/*.conf`.
- `nginx.conf` is the server block, installed as a template. At start, the
  image's entrypoint runs `/docker-entrypoint.d/` in name order:
  1. `docker/05-prepare.sh` creates the render directory and validates
     `API_UPSTREAM`.
  2. `docker/10-runtime-config.sh` validates the run-time settings and writes
     `/tmp/runtime/runtime-config.js`.
  3. `docker/15-app-links.sh` validates `IOS_APP_IDS` and `ANDROID_APP_LINKS`
     and writes `/tmp/runtime/well-known/`.
  4. The stock envsubst script renders `nginx.conf`. It substitutes
     `API_UPSTREAM` and nothing else, so nginx's own variables survive.

  A failing script stops the container before nginx starts.

`nginx.conf`:

- proxies `/api/` to `API_UPSTREAM`;
- gives `/api/v1/collect/` a larger request body, which streams to the API,
  for replay batches;
- serves `/runtime-config.js` from where the entrypoint wrote it;
- serves `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json` from exact-match locations, as
  `application/json`. A variable left unset leaves its file absent, which is a
  real 404 and never `index.html`;
- answers a missing file under `/assets/` with a real 404 rather than
  `index.html`;
- falls back to `index.html` for every other path.

Each location's comment in `nginx.conf` gives its reason. The source map
location is covered in [CSP and headers](SECURITY.md#csp-and-headers).

**Cache-Control** is chosen by a `map` on the URI, not per location:

- Hashed assets are immutable for a year.
- `index.html`, `theme-init.js`, the favicon, `runtime-config.js` and the two
  app-association files are `no-store`, so a deploy never leaves a browser
  asking for asset names it removed.

The security headers, the reason no location declares an `add_header`, and
the logging choices are in [CSP and headers](SECURITY.md#csp-and-headers).

**Nothing is configured at build time.** One image digest is promoted through
every environment. A setting that differs between environments is therefore a
container environment variable read at start, never a `VITE_*` value or a
build argument. The flow:

1. `docker/10-runtime-config.sh` checks each value against its pattern and
   writes `window.__APP_CONFIG__ = Object.freeze({...})`.
2. `index.html` loads `/runtime-config.js` before the bundle.
3. `getRuntimeConfig()` (`src/configs/runtime-config.ts`), the app's only
   reader, applies the same patterns again.
   - A production bundle reads only `window.__APP_CONFIG__`. That includes the
     one `pnpm preview` serves.
   - The dev server and the unit tests read the same names with a `VITE_`
     prefix from `import.meta.env`.
   - On the dev and preview servers, `scripts/runtime-config-plugin.mjs`
     renders `/runtime-config.js` from those `VITE_` names.

The two app-association variables are the exception to that flow: the browser
never reads them, so they have no `RUNTIME_CONFIG_KEYS` entry, no `VITE_` name
and no plugin entry. They touch `docker/15-app-links.sh`,
`docker/check-image.sh`, the Dockerfile, `nginx.conf`, `.env.example`'s comment
and the README.

**Adding a setting** is one change that edits all of these:

- `RUNTIME_CONFIG_KEYS` and `RUNTIME_CONFIG_PATTERNS`;
- the entrypoint script, with the same pattern;
- `RUNTIME_CONFIG_NAMES` in `scripts/runtime-config-plugin.mjs`;
- `docker/check-image.sh`;
- `.env.example`;
- the README's table.

The variables and their defaults are in the
[README's run-time configuration table](README.md#run-time-configuration).
Why the values are safe to write unescaped is in
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

`docker/check-image.sh` checks a built image from outside. Its checks on the
user, the root filesystem, the headers, the source maps, the refused run-time
settings and the release are listed in
[CSP and headers](SECURITY.md#csp-and-headers). The script also checks:

- that `docker/05-prepare.sh` accepts good `API_UPSTREAM` values and refuses
  bad ones;
- the content type of the JavaScript the image serves.

## Shared core

react is the source of a set of files that `apex-boilerplate` (the staff
console) and `expo-boilerplate` (the mobile app) copy. `shared-core.json` at the
repository root is the manifest: its `files` and `tests` keys name each shared
path and the apps that hold it, and its `ports`, `testPorts` and `exemptions`
keys describe the seams. The table below is generated from it, and
`pnpm check:shared` fails when the two differ.

### The core table

A `yes` in the apex or expo column means that app holds the file. A change to a
row here needs the same change in each app the row names, and the pull request
description says what happened there ("ported in apex#N", or "not applicable
because ...").

| Path                                                                             | apex | expo |
| -------------------------------------------------------------------------------- | ---- | ---- |
| `.github/workflows/deploy.yml`                                                   | yes  | -    |
| `docker/05-prepare.sh`                                                           | yes  | -    |
| `docker/10-runtime-config.sh`                                                    | yes  | -    |
| `docker/15-app-links.sh`                                                         | yes  | -    |
| `docker/nginx.main.conf`                                                         | yes  | -    |
| `docker/posthog-cli.sha256`                                                      | yes  | -    |
| `docker/upload-sourcemaps.sh`                                                    | yes  | -    |
| `e2e/capture/endpoint.ts`                                                        | yes  | -    |
| `e2e/capture/mailpit.ts`                                                         | yes  | -    |
| `e2e/capture/navigation.test.ts`                                                 | yes  | -    |
| `e2e/capture/pages.test.ts`                                                      | yes  | -    |
| `e2e/capture/route-control.ts`                                                   | yes  | -    |
| `e2e/capture/shoot.ts`                                                           | yes  | -    |
| `e2e/capture/types.ts`                                                           | yes  | -    |
| `e2e/helpers/fake-posthog.ts`                                                    | yes  | -    |
| `e2e/helpers/virtual-authenticator.ts`                                           | yes  | -    |
| `public/boot-variant.js`                                                         | yes  | -    |
| `public/theme-init.js`                                                           | yes  | -    |
| `scripts/check-shared.d.mts`                                                     | yes  | yes  |
| `scripts/check-shared.mjs`                                                       | yes  | yes  |
| `scripts/runtime-config-plugin.mjs`                                              | yes  | -    |
| `scripts/ui-drift.d.mts`                                                         | yes  | -    |
| `scripts/ui-drift.mjs`                                                           | yes  | -    |
| `src/components/features/auth/link-panels.tsx`                                   | yes  | -    |
| `src/components/features/auth/passkey-sign-in.tsx`                               | yes  | -    |
| `src/components/features/auth/sign-in-link-form.tsx`                             | yes  | -    |
| `src/components/features/auth/social-sign-in.tsx`                                | yes  | -    |
| `src/components/features/invitations/invitation-parts.tsx`                       | yes  | -    |
| `src/components/features/invitations/land-joined.ts`                             | yes  | -    |
| `src/components/features/load-error.tsx`                                         | yes  | -    |
| `src/components/features/passkeys/passkey-setup-screen.tsx`                      | yes  | -    |
| `src/components/features/profile/passkey-dialogs.tsx`                            | yes  | -    |
| `src/components/features/profile/passkeys-section.tsx`                           | yes  | -    |
| `src/components/features/profile/security-section.tsx`                           | yes  | -    |
| `src/components/features/route-error.tsx`                                        | yes  | -    |
| `src/components/features/step-up/passkey-confirm.tsx`                            | yes  | -    |
| `src/components/features/step-up/step-up-dialog.tsx`                             | yes  | -    |
| `src/components/features/step-up/step-up-provider.tsx`                           | yes  | -    |
| `src/components/layouts/app-shell.tsx`                                           | yes  | -    |
| `src/components/shared/busy-button.tsx`                                          | yes  | -    |
| `src/components/shared/command-palette/command-palette-host.tsx`                 | yes  | -    |
| `src/components/shared/command-palette/command-palette-shell.tsx`                | yes  | -    |
| `src/components/shared/command-palette/copy-id.ts`                               | yes  | -    |
| `src/components/shared/command-palette/match.ts`                                 | yes  | -    |
| `src/components/shared/command-palette/palette-loader.ts`                        | yes  | -    |
| `src/components/shared/command-palette/palette-registry.ts`                      | yes  | -    |
| `src/components/shared/command-palette/palette-types.ts`                         | yes  | -    |
| `src/components/shared/command-palette/recent-items.ts`                          | yes  | -    |
| `src/components/shared/command-palette/recent-keys.ts`                           | yes  | -    |
| `src/components/shared/command-palette/remote-group.ts`                          | yes  | -    |
| `src/components/shared/command-palette/use-palette-shortcut.ts`                  | yes  | -    |
| `src/components/shared/command-palette/use-palette-term.ts`                      | yes  | -    |
| `src/components/shared/data-table/data-table-cards.tsx`                          | yes  | -    |
| `src/components/shared/data-table/data-table-chip.tsx`                           | yes  | -    |
| `src/components/shared/data-table/data-table-column-header.tsx`                  | yes  | -    |
| `src/components/shared/data-table/data-table-faceted-filter.tsx`                 | yes  | -    |
| `src/components/shared/data-table/data-table-model.ts`                           | yes  | -    |
| `src/components/shared/data-table/data-table-pagination.tsx`                     | yes  | -    |
| `src/components/shared/data-table/data-table-sort-menu.tsx`                      | yes  | -    |
| `src/components/shared/data-table/data-table-toolbar.tsx`                        | yes  | -    |
| `src/components/shared/data-table/data-table.tsx`                                | yes  | -    |
| `src/components/shared/data-table/use-list-query.ts`                             | yes  | -    |
| `src/components/shared/data-table/use-list-search.ts`                            | yes  | -    |
| `src/components/shared/empty-state.tsx`                                          | yes  | -    |
| `src/components/shared/lazy-boundary.tsx`                                        | yes  | -    |
| `src/components/shared/note.tsx`                                                 | yes  | -    |
| `src/components/shared/page-skeleton.tsx`                                        | yes  | -    |
| `src/components/shared/pending-templates.ts`                                     | yes  | -    |
| `src/components/shared/pii.tsx`                                                  | yes  | -    |
| `src/components/shared/query-state.tsx`                                          | yes  | -    |
| `src/components/shared/section-boundary.tsx`                                     | yes  | -    |
| `src/components/shared/section-skeleton.tsx`                                     | yes  | -    |
| `src/components/shared/toast-host.tsx`                                           | yes  | -    |
| `src/components/ui/alert.tsx`                                                    | yes  | -    |
| `src/components/ui/button.tsx`                                                   | yes  | -    |
| `src/components/ui/checkbox.tsx`                                                 | yes  | -    |
| `src/components/ui/command.tsx`                                                  | yes  | -    |
| `src/components/ui/form.tsx`                                                     | yes  | -    |
| `src/components/ui/item.tsx`                                                     | yes  | -    |
| `src/components/ui/popover.tsx`                                                  | yes  | -    |
| `src/components/ui/spinner.tsx`                                                  | yes  | -    |
| `src/components/ui/toast.tsx`                                                    | yes  | -    |
| `src/configs/runtime-config.ts`                                                  | yes  | -    |
| `src/constants/app.ts`                                                           | -    | yes  |
| `src/constants/audit-action-names.ts`                                            | -    | yes  |
| `src/constants/audit-actions.ts`                                                 | -    | yes  |
| `src/constants/maintenance-mode.ts`                                              | -    | yes  |
| `src/constants/membership-roles.ts`                                              | -    | yes  |
| `src/constants/roles.ts`                                                         | -    | yes  |
| `src/constants/routes.ts`                                                        | -    | yes  |
| `src/hooks/use-changed-fields.ts`                                                | yes  | -    |
| `src/hooks/use-countdown.ts`                                                     | yes  | -    |
| `src/hooks/use-debounced-value.ts`                                               | yes  | -    |
| `src/hooks/use-now.ts`                                                           | yes  | yes  |
| `src/hooks/use-passkey-autofill.ts`                                              | yes  | -    |
| `src/hooks/use-signed-in-elsewhere.ts`                                           | yes  | -    |
| `src/hooks/use-step-up.ts`                                                       | yes  | -    |
| `src/http/auth-verdict.ts`                                                       | yes  | yes  |
| `src/http/create-api-client.ts`                                                  | yes  | yes  |
| `src/http/interceptors.ts`                                                       | yes  | yes  |
| `src/http/refresh-core.ts`                                                       | yes  | yes  |
| `src/http/traceparent.ts`                                                        | yes  | yes  |
| `src/lib/api-error.ts`                                                           | yes  | yes  |
| `src/lib/billing-banner.ts`                                                      | -    | yes  |
| `src/lib/billing-format.ts`                                                      | yes  | yes  |
| `src/lib/billing-page.ts`                                                        | -    | yes  |
| `src/lib/countdown.ts`                                                           | yes  | yes  |
| `src/lib/download-file.ts`                                                       | yes  | -    |
| `src/lib/format.ts`                                                              | -    | yes  |
| `src/lib/gst.ts`                                                                 | yes  | -    |
| `src/lib/link-lifetime.ts`                                                       | yes  | -    |
| `src/lib/maintenance-state.ts`                                                   | -    | yes  |
| `src/lib/members-limit.ts`                                                       | -    | yes  |
| `src/lib/notification-link.ts`                                                   | -    | yes  |
| `src/lib/notification-type.ts`                                                   | -    | yes  |
| `src/lib/passkey-create-failure.ts`                                              | yes  | -    |
| `src/lib/passkey-setup.ts`                                                       | yes  | -    |
| `src/lib/passkey-sign-in-message.ts`                                             | yes  | yes  |
| `src/lib/plan-refusal.ts`                                                        | yes  | yes  |
| `src/lib/plural.ts`                                                              | yes  | yes  |
| `src/lib/relative-time.ts`                                                       | -    | yes  |
| `src/lib/retry.ts`                                                               | yes  | yes  |
| `src/lib/role-denied.ts`                                                         | -    | yes  |
| `src/lib/safe-redirect.ts`                                                       | yes  | -    |
| `src/lib/shortcut.ts`                                                            | yes  | -    |
| `src/lib/step-up-presence.ts`                                                    | yes  | -    |
| `src/lib/step-up.ts`                                                             | yes  | yes  |
| `src/lib/tenant-guard.ts`                                                        | -    | yes  |
| `src/lib/toast.ts`                                                               | yes  | -    |
| `src/lib/trial-summary.ts`                                                       | -    | yes  |
| `src/lib/webauthn.ts`                                                            | yes  | -    |
| `src/lib/write-failure.ts`                                                       | -    | yes  |
| `src/lib/zod-jitless.ts`                                                         | yes  | yes  |
| `src/main.tsx`                                                                   | yes  | -    |
| `src/observability/errors/index.ts`                                              | yes  | -    |
| `src/observability/errors/install.ts`                                            | yes  | -    |
| `src/observability/errors/listen.ts`                                             | yes  | -    |
| `src/observability/errors/report.ts`                                             | yes  | -    |
| `src/observability/errors/scrub.ts`                                              | yes  | -    |
| `src/observability/flags/exposure.ts`                                            | yes  | -    |
| `src/observability/flags/feature-property-names.ts`                              | yes  | -    |
| `src/observability/flags/flag-hooks.ts`                                          | yes  | -    |
| `src/observability/flags/flag-query.ts`                                          | yes  | -    |
| `src/observability/flags/flag-types.ts`                                          | yes  | yes  |
| `src/observability/flags/flag-values.ts`                                         | yes  | yes  |
| `src/observability/flags/register.ts`                                            | yes  | -    |
| `src/observability/flags/require-client-flag.ts`                                 | yes  | -    |
| `src/observability/identity-epoch.ts`                                            | yes  | -    |
| `src/observability/telemetry/handoff.ts`                                         | yes  | -    |
| `src/observability/telemetry/index.ts`                                           | yes  | -    |
| `src/observability/telemetry/mask-attribute.ts`                                  | yes  | -    |
| `src/observability/telemetry/posthog-options.ts`                                 | yes  | -    |
| `src/observability/telemetry/sent-title.ts`                                      | yes  | -    |
| `src/observability/telemetry/telemetry.ts`                                       | yes  | -    |
| `src/observability/telemetry/url-sanitizer.ts`                                   | yes  | yes  |
| `src/queries/account-deletion.queries.ts`                                        | -    | yes  |
| `src/queries/audit.queries.ts`                                                   | -    | yes  |
| `src/queries/auth.queries.ts`                                                    | -    | yes  |
| `src/queries/beta.queries.ts`                                                    | -    | yes  |
| `src/queries/billing.queries.ts`                                                 | -    | yes  |
| `src/queries/client-settings.queries.ts`                                         | yes  | yes  |
| `src/queries/insights.queries.ts`                                                | -    | yes  |
| `src/queries/invitation.queries.ts`                                              | -    | yes  |
| `src/queries/list.queries.ts`                                                    | yes  | yes  |
| `src/queries/maintenance-status.queries.ts`                                      | -    | yes  |
| `src/queries/notification-list.queries.ts`                                       | -    | yes  |
| `src/queries/notification.queries.ts`                                            | -    | yes  |
| `src/queries/onboarding.queries.ts`                                              | -    | yes  |
| `src/queries/passkey-manage.queries.ts`                                          | yes  | yes  |
| `src/queries/passkey.queries.ts`                                                 | yes  | yes  |
| `src/queries/profile.queries.ts`                                                 | -    | yes  |
| `src/queries/step-up.queries.ts`                                                 | yes  | yes  |
| `src/queries/tax.queries.ts`                                                     | -    | yes  |
| `src/queries/tenant-forms.queries.ts`                                            | -    | yes  |
| `src/queries/tenant.queries.ts`                                                  | -    | yes  |
| `src/schemas/auth.schemas.ts`                                                    | yes  | yes  |
| `src/schemas/changed-fields.schemas.ts`                                          | yes  | -    |
| `src/schemas/email-domain.schemas.ts`                                            | yes  | yes  |
| `src/schemas/invitation.schemas.ts`                                              | yes  | -    |
| `src/schemas/list-request.schemas.ts`                                            | yes  | yes  |
| `src/schemas/list.schemas.ts`                                                    | yes  | yes  |
| `src/schemas/passkey.schemas.ts`                                                 | yes  | yes  |
| `src/schemas/profile.schemas.ts`                                                 | yes  | yes  |
| `src/schemas/safe-text.schemas.ts`                                               | yes  | yes  |
| `src/schemas/search.schemas.ts`                                                  | yes  | yes  |
| `src/schemas/slug.schemas.ts`                                                    | -    | yes  |
| `src/schemas/tax-details.schemas.ts`                                             | yes  | -    |
| `src/schemas/tenant.schemas.ts`                                                  | -    | yes  |
| `src/states/command-palette.store.ts`                                            | yes  | -    |
| `src/states/passkey-setup.store.ts`                                              | yes  | -    |
| `src/types/api.types.ts`                                                         | -    | yes  |
| `src/types/billing.types.ts`                                                     | -    | yes  |
| `src/types/list.types.ts`                                                        | yes  | yes  |
| `src/types/passkey.types.ts`                                                     | yes  | yes  |
| `src/types/tax.types.ts`                                                         | -    | yes  |
| `src/types/webauthn.types.ts`                                                    | yes  | yes  |
| `tests/fixtures/billing.ts`                                                      | -    | yes  |
| `tests/fixtures/client-settings.ts`                                              | yes  | -    |
| `tests/fixtures/error-scrub-vectors.json`                                        | yes  | -    |
| `tests/fixtures/ids.ts`                                                          | -    | yes  |
| `tests/fixtures/list-page.ts`                                                    | yes  | -    |
| `tests/fixtures/test-client-flags.ts`                                            | yes  | -    |
| `tests/fixtures/user-handle.ts`                                                  | yes  | -    |
| `tests/mocks/jwt.ts`                                                             | yes  | -    |
| `tests/mocks/posthog.ts`                                                         | yes  | -    |
| `tests/mocks/step-up.ts`                                                         | yes  | -    |
| `tests/mocks/web-locks.ts`                                                       | yes  | -    |
| `tests/unit/boot-shell.test.ts`                                                  | yes  | -    |
| `tests/unit/boot-variant.test.ts`                                                | yes  | -    |
| `tests/unit/capture-endpoint.test.ts`                                            | yes  | -    |
| `tests/unit/components/features/auth/link-panels.test.tsx`                       | yes  | -    |
| `tests/unit/components/features/auth/passkey-sign-in.test.tsx`                   | yes  | -    |
| `tests/unit/components/features/auth/sign-in-link-form.test.tsx`                 | yes  | -    |
| `tests/unit/components/features/auth/social-sign-in.test.tsx`                    | yes  | -    |
| `tests/unit/components/features/invitations/invitation-parts.test.tsx`           | yes  | -    |
| `tests/unit/components/features/load-error.test.tsx`                             | yes  | -    |
| `tests/unit/components/features/passkeys/passkey-setup-screen.test.tsx`          | yes  | -    |
| `tests/unit/components/features/profile/passkeys-section.test.tsx`               | yes  | -    |
| `tests/unit/components/features/profile/security-section-chunk-failure.test.tsx` | yes  | -    |
| `tests/unit/components/features/profile/security-section.test.tsx`               | yes  | -    |
| `tests/unit/components/features/step-up-chunk-failure.test.tsx`                  | yes  | -    |
| `tests/unit/components/features/step-up.test.tsx`                                | yes  | -    |
| `tests/unit/components/layouts/app-shell-chunk-failure.test.tsx`                 | yes  | -    |
| `tests/unit/components/shared/busy-button.test.tsx`                              | yes  | -    |
| `tests/unit/components/shared/command-palette/command-palette-host.test.tsx`     | yes  | -    |
| `tests/unit/components/shared/command-palette/command-palette-shell.test.tsx`    | yes  | -    |
| `tests/unit/components/shared/command-palette/copy-id.test.ts`                   | yes  | -    |
| `tests/unit/components/shared/command-palette/match.test.ts`                     | yes  | -    |
| `tests/unit/components/shared/command-palette/palette-harness.tsx`               | yes  | -    |
| `tests/unit/components/shared/command-palette/palette-registry.test.tsx`         | yes  | -    |
| `tests/unit/components/shared/command-palette/recent-items.test.tsx`             | yes  | -    |
| `tests/unit/components/shared/command-palette/recent-keys.test.ts`               | yes  | -    |
| `tests/unit/components/shared/command-palette/remote-group.test.ts`              | yes  | -    |
| `tests/unit/components/shared/command-palette/use-palette-shortcut.test.tsx`     | yes  | -    |
| `tests/unit/components/shared/data-table/data-table-toolbar.test.tsx`            | yes  | -    |
| `tests/unit/components/shared/data-table/data-table.test.tsx`                    | yes  | -    |
| `tests/unit/components/shared/data-table/list-harness.tsx`                       | yes  | -    |
| `tests/unit/components/shared/data-table/use-list-search.test.tsx`               | yes  | -    |
| `tests/unit/components/shared/empty-state.test.tsx`                              | yes  | -    |
| `tests/unit/components/shared/lazy-boundary.test.tsx`                            | yes  | -    |
| `tests/unit/components/shared/note.test.tsx`                                     | yes  | -    |
| `tests/unit/components/shared/page-skeleton.test.tsx`                            | yes  | -    |
| `tests/unit/components/shared/pending-templates-preload.test.tsx`                | yes  | -    |
| `tests/unit/components/shared/pending-templates.test.tsx`                        | yes  | -    |
| `tests/unit/components/shared/pii.test.tsx`                                      | yes  | -    |
| `tests/unit/components/shared/query-state.test.tsx`                              | yes  | -    |
| `tests/unit/components/shared/section-boundary.test.tsx`                         | yes  | -    |
| `tests/unit/components/shared/section-skeleton.test.tsx`                         | yes  | -    |
| `tests/unit/components/shared/toast-host.test.tsx`                               | yes  | -    |
| `tests/unit/components/ui/button.test.tsx`                                       | yes  | -    |
| `tests/unit/copy-style.test.ts`                                                  | yes  | yes  |
| `tests/unit/docker/app-links-script.test.ts`                                     | yes  | -    |
| `tests/unit/docker/check-image-script.test.ts`                                   | yes  | -    |
| `tests/unit/docker/dockerfile.test.ts`                                           | yes  | -    |
| `tests/unit/docker/nginx-main-conf.test.ts`                                      | yes  | -    |
| `tests/unit/docker/prepare-script.test.ts`                                       | yes  | -    |
| `tests/unit/docs-pages.test.ts`                                                  | yes  | -    |
| `tests/unit/hooks/use-changed-fields.test.tsx`                                   | yes  | -    |
| `tests/unit/hooks/use-countdown.test.ts`                                         | yes  | -    |
| `tests/unit/hooks/use-debounced-value.test.tsx`                                  | yes  | -    |
| `tests/unit/hooks/use-now.test.ts`                                               | yes  | -    |
| `tests/unit/hooks/use-passkey-autofill.test.tsx`                                 | yes  | -    |
| `tests/unit/hooks/use-signed-in-elsewhere.test.tsx`                              | yes  | -    |
| `tests/unit/http/auth-verdict.test.ts`                                           | yes  | yes  |
| `tests/unit/http/refresh-core.test.ts`                                           | yes  | yes  |
| `tests/unit/lib/api-error.test.ts`                                               | yes  | yes  |
| `tests/unit/lib/billing-banner.test.ts`                                          | -    | yes  |
| `tests/unit/lib/billing-format.test.ts`                                          | yes  | yes  |
| `tests/unit/lib/billing-page.test.ts`                                            | -    | yes  |
| `tests/unit/lib/countdown.test.ts`                                               | yes  | yes  |
| `tests/unit/lib/download-file.test.ts`                                           | yes  | -    |
| `tests/unit/lib/format.test.ts`                                                  | -    | yes  |
| `tests/unit/lib/gst.test.ts`                                                     | yes  | -    |
| `tests/unit/lib/link-lifetime.test.ts`                                           | yes  | -    |
| `tests/unit/lib/maintenance-state.test.ts`                                       | -    | yes  |
| `tests/unit/lib/notification-link.test.ts`                                       | -    | yes  |
| `tests/unit/lib/notification-type.test.ts`                                       | -    | yes  |
| `tests/unit/lib/passkey-setup.test.ts`                                           | yes  | -    |
| `tests/unit/lib/plan-refusal.test.ts`                                            | yes  | yes  |
| `tests/unit/lib/plural.test.ts`                                                  | yes  | yes  |
| `tests/unit/lib/relative-time.test.ts`                                           | -    | yes  |
| `tests/unit/lib/retry.test.ts`                                                   | yes  | yes  |
| `tests/unit/lib/role-denied.test.ts`                                             | -    | yes  |
| `tests/unit/lib/safe-redirect.test.ts`                                           | yes  | -    |
| `tests/unit/lib/shortcut.test.ts`                                                | yes  | -    |
| `tests/unit/lib/step-up-presence.test.ts`                                        | yes  | -    |
| `tests/unit/lib/step-up.test.ts`                                                 | yes  | -    |
| `tests/unit/lib/trial-summary.test.ts`                                           | -    | yes  |
| `tests/unit/lib/webauthn.test.ts`                                                | yes  | -    |
| `tests/unit/lib/write-failure.test.ts`                                           | -    | yes  |
| `tests/unit/lib/zod-jitless.test.ts`                                             | yes  | -    |
| `tests/unit/observability/flags/exposure.test.ts`                                | yes  | -    |
| `tests/unit/observability/flags/flag-hooks.test.tsx`                             | yes  | -    |
| `tests/unit/observability/flags/flag-query.test.ts`                              | yes  | -    |
| `tests/unit/observability/flags/flag-values.test.ts`                             | yes  | -    |
| `tests/unit/observability/flags/register.test.ts`                                | yes  | -    |
| `tests/unit/observability/flags/require-client-flag.test.ts`                     | yes  | -    |
| `tests/unit/queries/account-deletion.queries.test.ts`                            | -    | yes  |
| `tests/unit/queries/client-settings.queries.test.tsx`                            | yes  | -    |
| `tests/unit/queries/list.queries.test.ts`                                        | yes  | -    |
| `tests/unit/queries/passkey-sign-in-cancel.test.tsx`                             | yes  | -    |
| `tests/unit/queries/passkey.queries.test.tsx`                                    | yes  | -    |
| `tests/unit/schemas/auth.schemas.test.ts`                                        | yes  | yes  |
| `tests/unit/schemas/email-domain.schemas.test.ts`                                | yes  | yes  |
| `tests/unit/schemas/invitation.schemas.test.ts`                                  | yes  | -    |
| `tests/unit/schemas/list.schemas.test.ts`                                        | yes  | yes  |
| `tests/unit/schemas/passkey.schemas.test.ts`                                     | yes  | yes  |
| `tests/unit/schemas/profile.schemas.test.ts`                                     | yes  | yes  |
| `tests/unit/schemas/safe-text.schemas.test.ts`                                   | yes  | yes  |
| `tests/unit/schemas/search.schemas.test.ts`                                      | yes  | yes  |
| `tests/unit/schemas/slug.schemas.test.ts`                                        | -    | yes  |
| `tests/unit/schemas/tax-details.schemas.test.ts`                                 | yes  | -    |
| `tests/unit/schemas/tenant.schemas.test.ts`                                      | -    | yes  |
| `tests/unit/states/command-palette.store.test.ts`                                | yes  | -    |
| `tests/unit/ui-drift.test.ts`                                                    | yes  | -    |

### The ports

A port is a file that exists in every app under the same path and exports the
same names, but each app writes its own body. A shared file may import a port
and nothing else that is platform-specific. The manifest's `ports` key lists
the exports a shared file may use. This table is react's version of each port;
`check:shared` does not compare it with the manifest, so a new port or export
is a change to both.

| Port                                   | Exports                                                                                         | What react's version does                                                                                                                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/constants/frontend-app.ts`        | `FRONTEND_APP`                                                                                  | The `app` value (`'web'`) that sign-in, passkey and step-up requests send, so express builds links and policy for this app.                                                                                                                                                                            |
| `src/http/client.ts`                   | `apiClient`, `unwrap`                                                                           | Builds `apiClient` from the shared `createApiClient` and installs the shared interceptor chain with react's ports: a same-origin check against `API_PREFIX`, `ensureSession`, and a sign-out that clears `auth.store`, tells the other tabs and goes to /login. `unwrap` re-exports the shared one.    |
| `src/http/session.ts`                  | `broadcastAuthMessage`, `broadcastLogout`, `ensureSession`, `redirectToLogin`, `switchIdentity` | The browser session: `ensureSession` builds the shared refresh core with the cookie transport and a Web Lock across tabs; `redirectToLogin` assigns `/login?redirect=`; the broadcast functions use a `BroadcastChannel`; `switchIdentity` resets the query cache and analytics when the user changes. |
| `src/lib/toast.ts`                     | `toast`                                                                                         | The toast API (`toast.success`, `toast.error`, `toast.warning`) over Base UI's toast manager. It queues toasts raised before the lazy `<Toaster>` mounts.                                                                                                                                              |
| `src/observability/flags/flag-keys.ts` | `CLIENT_FLAGS`                                                                                  | This app's slice of express's flag registry: the entries with `client: true` and `react` in `apps`, copied by hand into `CLIENT_FLAGS`.                                                                                                                                                                |
| `src/observability/telemetry/index.ts` | `AnalyticsKey`, `analyticsKey`, `getAnalyticsSessionIdFor`, `track`                             | The analytics facade over posthog-js, loaded on demand. Shared files use only `track`, `analyticsKey`, `AnalyticsKey` and `getAnalyticsSessionIdFor`.                                                                                                                                                  |
| `src/ports/navigation.ts`              | `assignLocation`                                                                                | `assignLocation(url)` calls `window.location.assign(url)`.                                                                                                                                                                                                                                             |
| `src/ports/runtime.ts`                 | `isDev`                                                                                         | `isDev`, read from `import.meta.env.DEV`.                                                                                                                                                                                                                                                              |
| `src/ports/webauthn.ts`                | `webauthn`                                                                                      | `webauthn`, the browser's WebAuthn built from `src/lib/webauthn.ts`: support check, get, create, cancel generation and the three signals.                                                                                                                                                              |
| `src/states/auth.store.ts`             | `useAuthStore`                                                                                  | A Zustand store holding the access token and user in memory only, with no `persist` middleware. `logout` also clears the command palette's recent items.                                                                                                                                               |
| `src/states/maintenance-mode.store.ts` | `useMaintenanceModeStore`                                                                       | A Zustand store of the maintenance mode, the owner's notice and the start time, set from the `Maintenance-Mode` header, the status endpoint or a 503 body. Memory only.                                                                                                                                |
| `tests/support/runner.ts`              | `describe`, `it`, `test`, `expect`, `beforeEach`, `afterEach`, `repoRoot`, `copyStyleRoots`     | Re-exports `describe`, `it`, `test`, `expect`, `beforeEach` and `afterEach` from `vite-plus/test`, and defines `repoRoot` and `copyStyleRoots` (`['src']`).                                                                                                                                            |

`switchArea` in `src/copy/billing.ts` is per-app, like the rest of that file:
each app words its own billing copy, so the shared billing logic (`src/lib/billing-*.ts`) takes
no copy from it.

### Rules

- **react is the source.** Change a shared file here first, then copy it to
  each app the row names. `scrub.ts` is the exception: its rules change in
  express first ([The scrubber](SECURITY.md#the-scrubber)), then in react,
  apex and expo.
- **The purity rules bind the expo rows only.** A file with an expo mark uses no
  browser global (`window`, `document`, `location`, `navigator`,
  `localStorage`, `sessionStorage`), imports no banned package
  (`posthog-js`, `posthog-react-native`, `@tanstack/react-router`,
  `@simplewebauthn/browser`, `react-native`, `@tabler/icons-react`), and
  imports only another shared file or a port export the manifest lists. A
  shared test takes its test functions only from the runner port
  (`tests/support/runner.ts`) and uses no `vi`, no `import.meta` and no
  `node:fs`. The manifest's `exemptions` key lists the one exception today:
  `tests/unit/copy-style.test.ts` may import `node:fs`.
- **Apex rows are byte for byte copies.** Apex's `sync-check` (added in plan 2c)
  byte-compares them with react `main` and re-runs only the expo-row checks.
  The purity rules do not apply to an apex-only row.
- **`check-shared` runs in the gate.** `pnpm check:shared` runs
  `scripts/check-shared.mjs --docs ARCHITECTURE.md`, so it also compares the
  core table with the manifest. `scripts/check-shared.mjs` and its `.d.mts` are
  expo and apex rows themselves.
- **apex and expo run `sync-check` against react `main`.** A pull request that
  changes a shared row here lands first; each app's check then reports the rows
  that no longer match.
- **The container files split.** `Dockerfile`, `docker/check-image.sh` and
  `nginx.conf` are per-app. `docker/15-app-links.sh` and its test
  (`tests/unit/docker/app-links-script.test.ts`) are apex rows.
- **`public/boot-variant.js` is an apex row.** A change there, such as the
  `/delete-account` entry, needs the same change in apex.

### Apex rows that are not byte for byte today

On 5 November 2026, `cmp` against `/Users/abhijeet/Mahaverick/apex-boilerplate`
found 10 apex rows that apex lacks and 24 that differ. They differ because
apex has not copied react's new versions yet; plan 2c does that.

- Absent from apex:
  - `docker/15-app-links.sh`
  - `scripts/check-shared.d.mts`
  - `scripts/check-shared.mjs`
  - `src/http/auth-verdict.ts`
  - `src/http/create-api-client.ts`
  - `src/http/refresh-core.ts`
  - `src/types/webauthn.types.ts`
  - `tests/unit/docker/app-links-script.test.ts`
  - `tests/unit/http/auth-verdict.test.ts`
  - `tests/unit/http/refresh-core.test.ts`
- Different in apex:
  - `public/boot-variant.js`
  - `src/http/interceptors.ts`
  - `src/observability/flags/flag-values.ts`
  - `src/observability/telemetry/url-sanitizer.ts`
  - `src/queries/passkey-manage.queries.ts`
  - `src/queries/passkey.queries.ts`
  - `src/queries/step-up.queries.ts`
  - `tests/unit/boot-variant.test.ts`
  - `tests/unit/copy-style.test.ts`
  - `tests/unit/docker/dockerfile.test.ts`
  - `tests/unit/lib/api-error.test.ts`
  - `tests/unit/lib/billing-format.test.ts`
  - `tests/unit/lib/countdown.test.ts`
  - `tests/unit/lib/plan-refusal.test.ts`
  - `tests/unit/lib/plural.test.ts`
  - `tests/unit/lib/retry.test.ts`
  - `tests/unit/schemas/auth.schemas.test.ts`
  - `tests/unit/schemas/email-domain.schemas.test.ts`
  - `tests/unit/schemas/list.schemas.test.ts`
  - `tests/unit/schemas/passkey.schemas.test.ts`
  - `tests/unit/schemas/profile.schemas.test.ts`
  - `tests/unit/schemas/safe-text.schemas.test.ts`
  - `tests/unit/schemas/search.schemas.test.ts`
  - `tests/unit/schemas/tax-details.schemas.test.ts`

### Shared in part

The paths below are shared in part, so the manifest does not list them and
`check-shared` does not compare them. Change the shared part here and check
apex in the same pull request.

| Path                                                                                                                                                                                                                                               | Why it must stay in step                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nginx.conf` security headers and CSP, `location /api/v1/collect/` and `location ~* ^/api/v1/auth/google/callback/?$`, the token-page comment above `access_log`, `tests/unit/docker/nginx-conf.test.ts` (react's also covers the stream location) | Same threat model; same replay batch size. The Content Security Policy (CSP), Cross-Origin-Opener-Policy (COOP) and Permissions-Policy values differ on purpose: this app allows Razorpay Checkout, and apex loads no third-party script. |
| `nginx.conf`'s `location = /runtime-config.js` and its `.map` location                                                                                                                                                                             | One run-time configuration contract and no source map ever served.                                                                                                                                                                        |
| `docker/check-image.sh`, `pnpm-workspace.yaml`, `e2e/nginx/cors.test.ts`                                                                                                                                                                           | Same container checks and dependency overrides. `check-image.sh` is per-app because its expected CSP, COOP and Permissions-Policy lines match each app's `nginx.conf`.                                                                    |
| The `setErrorRouteSource` line in `src/router.tsx`                                                                                                                                                                                                 | Router errors reported with their route the same way.                                                                                                                                                                                     |
| `vitest.config.ts`'s React Compiler plugin block (`babel({ presets: [reactCompilerPreset()] })`)                                                                                                                                                   | The unit suite runs under the compiler, so a value the compiler would cache at render fails a unit test in both apps.                                                                                                                     |
| `scripts/check-bundle.mjs`, except `ENTRY_BUDGET_BYTES` (each app's measured budget) and apex's `BILLING_ADMIN_MODULE` rule                                                                                                                        | One first-visit budget check; the budgets differ.                                                                                                                                                                                         |
| The `lint` block of `vite.config.ts` and `eslint.config.js`'s shared conventions                                                                                                                                                                   | Same conventions; each app adds its own import restrictions and file lists.                                                                                                                                                               |
| The intro, `*`, `alert.tsx`, `button.tsx` and `### command.tsx` sections of `docs/ui-local-edits.md`, and the `ui:drift` scripts, CI step, `scripts/ui-registry` ignores, CODEOWNERS line and `shadcn` Renovate rule                               | Byte-identical vendored components and the one drift check over them. The snapshot itself is each app's own.                                                                                                                              |
| `index.html`'s `<style id="boot-shell">` block and `#root` markup (not its `<style id="boot-tokens">` colours, each app's own)                                                                                                                     | One first-paint shell; the colours are pinned to each app's `globals.css`.                                                                                                                                                                |

The error scrubber is also held in step with express-boilerplate; see
[The scrubber](SECURITY.md#the-scrubber).

## Deploy

This section covers what the deploy pipeline does for each trigger.
`.github/workflows/deploy.yml` is the pipeline:

- **A push to `main`** runs `ci.yml` as a gate. Then:
  1. The `image` job builds the image once and pushes it to the GitHub
     Container Registry (GHCR) as `sha-<commit>` and `main`. It attaches a
     software bill of materials (SBOM) and a provenance attestation.
  2. The `deploy` job runs, bound to the `production` environment. That job
     is a placeholder until a deployment target is chosen.
- **A `vX.Y.Z` tag**, pushed by the release workflow, builds nothing. The
  `promote` job waits for `main`'s `sha-<commit>` image and adds `X.Y.Z`,
  `X.Y` and `X` to that same digest.
- **A manual dispatch from another branch** pushes the sha-tagged image only.
  The `main` tag and the `deploy` job run only from `main`.

A release promotes a digest rather than rebuilding, so source maps are
uploaded only when an image is built. The consequence is in the README's
[Source maps](README.md#source-maps). The one-time repository setup, the
release flow and the one-origin rule for deployments are in the README's
[Deploying](README.md#deploying) and [Releases](README.md#releases) sections.
