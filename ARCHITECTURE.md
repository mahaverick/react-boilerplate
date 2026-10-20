# Architecture

How the app is put together: what runs at boot, how a route gets its data,
where state lives, and how the HTTP layer, the notification stream,
observability, maintenance mode and the container fit around it. What each
part defends against is in [SECURITY.md](SECURITY.md); how to run, configure
and deploy it is in [README.md](README.md).

The HTTP layer, analytics, feature flags, error tracking and most of the
container are shared with apex ([Sibling sync](#sibling-sync-with-apex)).
Their sections describe the shared code; what only this app has sits in
sections and subsections marked _this app only_.

## Layout of `src/`

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

The UI kit is shadcn's `base-vega` style on Base UI, with the `mist` base colour,
Inter Variable (`@fontsource-variable/inter`, imported by `globals.css`) and Tabler
icons (`@tabler/icons-react`; each decorative icon carries `aria-hidden`, which Tabler
does not add). `components.json` records the preset. The vendored files in
`src/components/ui/` are held to the registry: `scripts/ui-registry/` is a
committed snapshot of the registry's files as the `shadcn` devDependency renders them,
`docs/ui-local-edits.md` records each local edit (line rewrites, or exact hunks
with a reason), and `pnpm ui:drift`, a step of CI's `lint` job, fails on any
other difference, or when that version or `components.json`'s style or icon
library no longer matches the snapshot's manifest. `pnpm ui:drift:refresh` retakes
the snapshot, over the network, as a reviewed change; Renovate leaves `shadcn`
bumps for a human, and CODEOWNERS covers the directory. The signed-out pages follow
shadcn's login-04 and signup-04 blocks: `AuthCard` puts the page's form beside a brand
panel that shows `APP_NAME` and `APP_TAGLINE` from `src/constants/app.ts`, and the
social sign-in buttons come from `SOCIAL_PROVIDERS` in
`src/constants/auth-providers.ts`, since the API publishes no list of configured
providers. The signed-in shell follows sidebar-07: the tenant switcher, `NavMain`
(Dashboard and Tenants; a collapsible group only for an item with sub-items),
`NavSecondary` pinned to the bottom (Notifications with the unread count, and
Settings) and the account menu, in a sidebar that collapses to icons. On a
settings page (`isSettingsPath`) the sidebar swaps `NavMain` and `NavSecondary`
for `NavSettings` ([The Settings area](#the-settings-area)). Every sidebar link
closes the drawer on a phone.

The header's Search… button and ⌘K on Apple platforms, Ctrl+K elsewhere,
open the command palette (`src/components/shared/command-palette/`, shared
with apex; react's commands are `src/components/features/command-palette.tsx`).
The palette lists Recent (tenants worked in lately and still listed), This
page (commands a mounted component registers with `usePaletteCommands`; here,
Copy tenant ID), Go to
(the nav, Notifications, Settings and its sections, the workspace ones only
with a current tenant), Switch tenant (the caller's tenants, matched here,
through the switcher's own routing, `useSwitchTenant`), Theme, and Account
(Create a tenant, which opens `/tenants#create`, and Sign out). A choice sends
`command_palette_action_run` with a fixed `action` key and nothing else.

`CommandPaletteHost`, mounted once in `AppLayout`, holds the shortcut and loads
the palette's code (`palette-loader.ts`, one `import()`), so the entry chunk
carries none of it. The fetch starts when the shell is idle, on hover or focus
of the Search… button, or at the first open, whichever comes first. Once it
has resolved, even by hover alone, the first open mounts the palette directly.
Only an open that beats the fetch shows a "Loading search…" overlay whose input
is bound to the store's `query`, so keys typed right after the shortcut are
kept. The overlay is a modal dialog: Tab stays on its field, and Escape or a
click on the backdrop closes it. When the palette replaces the overlay, focus first
goes back to the opener, so the palette's own close returns it there. A failed fetch closes the palette and shows a toast with a Reload
action: Chromium keeps a failed `import()` for the page's lifetime, so there is
no in-page retry. `pnpm check:bundle` fails if a chunk that holds the palette's
code is reachable from the entry or the host by static imports, and its entry
budget is 586,800 B.

Recents live in `localStorage` per user (`palette.recent.v1:<userId>`, five
tenants, newest first). `logout()` in `auth.store.ts` removes every
`palette.recent.v1:` key (`clearAllRecents` in `recent-keys.ts`) without importing the palette, so a sign-out on a page
that never loaded it still clears them. `logout()` also runs when the session
ends any other way: a 401 verdict on the cold-load restore or a refresh (an
expired session or a dead cookie), and another tab's logout, so recents are
cleared on every session end, expiry included. `installRecentItems`, installed
by the host, additionally deletes a user's list when the signed-in user changes
away from them, and every other user's list while someone is signed in.

`src/routeTree.gen.ts` is generated from `src/pages/` by the TanStack Router
plugin in `vite.config.ts`, which also splits each route's component into
its own chunk (`autoCodeSplitting`). A route's pending template is not split
with it: a route names one of the lazy wrappers in
`src/components/shared/pending-templates.ts`, whose chunk is fetched at
startup (`templatesReady`, which `main.tsx` waits for, capped), so a template
renders without suspending and the page templates still stay out of the entry
chunk.

A lazy route with its own `errorComponent` keeps that screen in the route
module, with `codeSplitGroupings: [['component']]`, as the settings leaves do.
A split error screen would need a fetch exactly when chunk loading fails, and
the plugin's default split pulls the error listener out of the entry chunk.
For the same reason such a route's page component must not import `Route`
back from its route module: it reads params with `useParams({ from })`
instead of `Route.useParams()`. Either mistake fails `pnpm check:bundle`
([Error tracking](#error-tracking)).

## Boot

`index.html` loads two blocking scripts in its `<head>`, then the bundle:

1. `public/theme-init.js` sets the `dark` class from `localStorage` before
   the first paint.
2. `/runtime-config.js` sets `window.__APP_CONFIG__`
   ([run-time config](#the-container-and-run-time-config)).
3. `src/main.tsx`, the module entry. `#root` holds a static boot shell, styled
   by inline CSS in `index.html`, until React's first commit replaces it.

`src/main.tsx` runs in this order:

- **`@/lib/zod-jitless` is the first import**, before any module builds a
  Zod schema ([CSP and headers](SECURITY.md#csp-and-headers) says why).
  `tests/setup.ts` and
  `e2e/harness/harness.tsx` import it first for the same reason, and so does
  every source file that imports Zod as a value: the entry's own body runs
  after every chunk it imports, so its first import alone does not run before
  a schema built in one of those chunks. `tests/unit/lib/zod-jitless.test.ts`
  and `pnpm check:bundle` fail when a file or a chunk misses it.
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
  against a settled session, and `_app`'s loader waits for the flags, at most
  10 s. React mounts once the load has settled, whether it resolved or
  rejected (and once the pending templates' chunks have, or after 3 s):
  mounting earlier would blank the boot shell, because `createRoot().render()`
  clears `#root` and the router renders nothing until it has a match. The tenant
  list and the tenant reads are not waited for; the page shows its template
  while they load ([boot.md](docs/pages/boot.md)).
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
the toast host and the analytics consent banner. The toast UI
(`src/components/ui/toast.tsx`) is a lazy chunk that `ToastHost` fetches when
the root route first renders. `toast.*` from `src/lib/toast.ts` is small and
outside that chunk; it queues the newest ten toasts raised before the UI has
mounted, and those raised in its first 100 ms, and replays them in order once
the empty live region has been in the document for that long, so they are not
inserted together with the region, which screen readers often skip. A failed
chunk load is reported as a `chunk_load` error and leaves the page without
toasts. Beside the router,
`src/main.tsx` mounts the TanStack Query and Router devtools, which load only
in development; a production build drops them.

## Routing and data loading

Routes are files under `src/pages/`; `__root.tsx`, `_auth.tsx` and
`$slug.members.tsx` follow TanStack Router's naming, not the kebab-case rule
the rest of `src/` follows.

| Route group                                                                   | Guard                                                                                                                                                                                              |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/_app` (dashboard, notifications, tenants, every tenant tab, settings)       | Not signed in: redirect to `/login?redirect=<href>`. Then the tenant guard ([The current tenant in the URL](#the-current-tenant-in-the-url)). Its loader warms the page's flags.                   |
| `/_auth` (login)                                                              | Signed in: redirect to the dashboard.                                                                                                                                                              |
| `/welcome`                                                                    | Its own guard: not signed in, redirect to `/login?redirect=/welcome`. A user who already has a tenant goes on to the dashboard.                                                                    |
| `/`                                                                           | Redirects in `beforeLoad`: signed in to the dashboard, anyone else to `/login`.                                                                                                                    |
| `/auth/callback`, `/auth/link`, `/invitations/accept`, `/invitations/confirm` | None. These open from Google or from a mailed link, often in a tab that is already signed in, so each page decides for itself; `_auth`'s guard would bounce a visitor the page has just signed in. |
| `/register`, `/forgot-password`, `/reset-password`, `/verify-email`           | Redirect in `beforeLoad` to `/login?notice=sign-in-link`, dropping any `?token=`. Old mailed links and bookmarks still reach them.                                                                 |
| `/$`                                                                          | None. The splat route renders `RouteNotFound` inside its own `<main>`.                                                                                                                             |

Both layout guards stand down while maintenance is `full`
([Maintenance mode](#maintenance-mode)). The guards read the auth store
directly, and that is sound because the root route's `beforeLoad` has
already awaited the session restore; a guard in a `useEffect` would see an
empty store on every reload and redirect wrongly.

Sign-in is by emailed link or Google; there is no password anywhere.
`/login` posts `POST /auth/link/request` and turns into "Check your inbox".
The link opens `/auth/link?token=…&email=…[&redirect=…]`, which posts the
token once per page load (a ref-guarded effect, never a query, so a refocus
cannot spend it) and lands on the safe `redirect`, on `/welcome` for a new
account, or on the dashboard. Every landing passes through `safeRedirect`
(`src/lib/safe-redirect.ts`) and replaces the token page in history. The
accept and confirm pages follow the same rules for invitation links.

The Google sign-in button on `/login` is a plain anchor to
`GOOGLE_OAUTH_PATH`, which `src/constants/routes.ts` derives from
`API_PREFIX`, so moving the prefix moves it too. The API answers at
`/auth/callback`, with `new=1` for a new account (which lands on `/welcome`),
or at `/login?error=<code>`, which the sign-in page explains in a toast.

**Loaders warm the query cache; components read it.** A loader calls
`queryClient.ensureQueryData(...)` with the same options a component's
`useQuery` uses, so the page renders from the cache. Three loaders do this:

- `/_app` reads the flags of the page the shell is entered on. It does not
  run again for a navigation that stays in the shell. `ensureFlags` waits at
  most `FLAGS_BOOT_WAIT_MS` (10 s), then resolves to the fallbacks; the read
  keeps going and its values land in the cache.
- `/_app/tenants/$slug` (`startTenantRoute`) starts the tenant's detail read
  without waiting on it and, for a navigation that commits, awaits the
  tenant's flags (same cap); a hover preload starts the detail only. It
  returns `{ tenant }`, the detail read, which route analytics awaits.
  `preloadStaleTime: 0` with a blocking stale reload makes the commit run the
  loader again after a preload, before the page renders. `TenantGate` shows
  the page's template until the detail lands. A 404 on the detail resolves to
  `null`, and the gate reads the tenant list to choose between the suspended
  panel and the not-found panel; any other failure is the gate's load-error
  panel, whose retry refetches the detail.
- `/_app/settings/workspace/$slug` runs the same `startTenantRoute` and renders
  the same `TenantGate`, so flags, the tenant switcher and analytics grouping
  resolve the tenant there as on `/tenants/$slug`.

Links preload on intent (`defaultPreload: 'intent'`). The pending component
waits 300 ms before it shows and then stays at least 300 ms. The error and
not-found components are imported statically in `src/router.tsx`: when a
chunk cannot be fetched, a lazy error screen could not load either. The
pending templates are lazy wrappers fetched at startup, and fetched again once
if that failed (`templatesReady`), since the router preloads none of them. `RouteError`
recognises a failed chunk load (`src/lib/chunk-load-error.ts`) and offers a
reload, the only way to pick up a new deploy's file names; any other error
offers a retry that re-runs the loaders.

`QueryState` (`components/shared/query-state.tsx`) renders every query-backed
section: skeleton, role refusal, retryable error, empty, content in a
`SectionBoundary`. Four things read a query without it: the bell and the
tenant switcher, whose menus carry their own loading, unavailable and retry
states; the owners read on the members page and the Actor facet's member
read, which show a `LoadError` or the facet's own message beside the list;
and `tenant-search-guard` and `maintenance-gate`, which render nothing.

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

**Queries** live in `src/queries/`, one file per resource. Most export a key
factory and their hooks, and the rest reuse another file's keys; `unwrap`
(`src/http/client.ts`) returns the `data` of the API's success envelope. Keys
nest by prefix, so invalidating a prefix refetches everything under it:
`['tenants']` is a prefix of every tenant's detail, members, settings,
invitations and onboarding, and a mutation that means the list alone passes
`exact: true`. Failed requests are read with the helpers in
`src/lib/api-error.ts`, and a form maps the API's field errors onto its inputs
through `useServerErrors`.

### The current tenant in the URL

The URL is the only source of truth for the current tenant, so the tenant
switcher and Settings › Workspace agree on every page. Tenant pages keep the
tenant in their path; every other page in the signed-in shell carries it as a
search param.

| Page                                                 | Tenant comes from | `?tenant`                 |
| ---------------------------------------------------- | ----------------- | ------------------------- |
| `/tenants/$slug/*` and `/settings/workspace/$slug/*` | the path          | never; removed if present |
| every other `/_app` page                             | the search param  | always, once resolved     |

`src/lib/current-tenant.ts` holds the schema and middlewares,
`src/lib/tenant-guard.ts` the pure resolution (`correctTenant`), and
`TenantSearchGuard` (`components/features/tenant/tenant-search-guard.tsx`),
around the layout's page slot, the guard. `_app` owns the param:

- **`validateSearch`** (`tenantSearchSchema`) accepts `tenant` only as a slug
  express's pattern allows (`src/schemas/slug.schemas.ts`); anything else is caught as `undefined`.
- **The search middleware** (`retainTenant`) keeps the current tenant on every
  navigation inside the shell, as `retainSearchParams(['tenant'])` would. The
  plain `retainSearchParams` reads only the current URL's search, which on a
  `$slug` page has no `?tenant`, so leaving `/tenants/acme` for `/dashboard`
  would lose the tenant. `retainTenant` falls back to the tenant
  `installCurrentTenant` records on `onBeforeLoad` (the destination's `$slug`,
  else its `?tenant` when it has a slug's shape, else none). It records before the router publishes the
  location, so a link that renders for the new page (the sidebar's) builds its
  href from that page's tenant; on `onResolved` it would keep the previous one.
  A navigation that names `tenant` itself wins, `undefined` included. The two
  `$slug` layouts declare `stripTenant`, so a link to them never carries
  `?tenant`.
- **The guard** (`TenantSearchGuard`, after mount, around the `_app`
  layout's page slot). On a `$slug` page it never reads the list: it renders
  the page and drops any `?tenant` with a replace. On any other page it reads
  the tenant list (the switcher's query) and shows, in the page slot under the
  already-rendered sidebar and header, the pending template of the route
  directly under `_app` (the `dashboard` template on `/dashboard`, the list
  template on `/tenants`) until the list lands. It then resolves the tenant: the URL's `?tenant` if it is eligible,
  else the remembered tenant if it is, else the first eligible tenant in list
  order, else none. "Eligible" is a tenant in the caller's `GET /tenants` list
  that is neither the platform tenant nor suspended. When the result differs
  from the URL it navigates to the same page with the other params kept and
  `tenant` set, or removed when there is none, replacing the entry. The
  resolved tenant is remembered for the user. A list that fails renders the
  page with the URL as it is; the switcher shows the failure and a retry. The
  guard decides only while the router is idle, when the location and the
  rendered matches belong to the same page. A hover preload renders nothing,
  so it is never corrected and remembers nothing.

Components read the tenant with `useCurrentTenantSlug()`: the route's `$slug`,
else `?tenant`, else null. A `?tenant` that a loaded tenant list lacks or lists
as ineligible reads as null, so a URL the guard could not yet correct never
enables the Workspace links; while the list loads, the URL is trusted. The
remembered tenant
(`src/states/current-tenant.store.ts`) is only the guard's fallback. It is
written when `TenantGate` loads a tenant and when the guard resolves `?tenant`,
never for platform access or the platform tenant.

The tenant switcher on a workspace settings page opens the same section for
the chosen tenant, on another `$slug` page opens `/tenants/$slug`, and on any
other page changes only `?tenant`. That is a push, so Back returns to the
previous tenant. Flags, route telemetry and the API are unchanged: flags are
tenant-scoped only on `$slug` routes, `?tenant` is not in
`ANALYTICS_URL_QUERY_ALLOWLIST`, so page views drop it, and the API resolves a
tenant from `:slug` in its own paths. Apex has no tenant switcher, so none of
this is shared.

### The Settings area

`src/constants/settings.ts` is the area's single source of truth.
`SETTINGS_GROUPS` (Account, Workspace) and `SETTINGS_SECTIONS` (each page's
path, label, description and icon) drive the settings nav, the `/settings`
landing page and the settings layout's `h1`, which is the active section's
label (`settingsActiveSection`), so each page's own cards start at `h2`. A new
page is a section there plus a route under `src/pages/_app/settings/`.

| Path                                 | Page                                                       |
| ------------------------------------ | ---------------------------------------------------------- |
| `/settings`                          | Landing page: one card of links per group                  |
| `/settings/account/profile`          | Name, email and the privacy (analytics) choice             |
| `/settings/account/security`         | Sign-in methods and other sessions                         |
| `/settings/account/notifications`    | Notification preferences                                   |
| `/settings/workspace/$slug/general`  | The tenant's details and settings; `$slug/` redirects here |
| `/settings/workspace/$slug/members`  | Members, roles and pending invitations                     |
| `/settings/workspace/$slug/activity` | The tenant's audit log                                     |

Permissions never hide a section. A member who cannot manage the tenant sees
the read-only views under a banner saying owners and admins can change them.

**The sidebar on settings pages** is `NavSettings`: Back to app, then the
Account and Workspace groups. Workspace items link to the current tenant,
`useCurrentTenantSlug()` ([The current tenant in the URL](#the-current-tenant-in-the-url)).
The Workspace label names the tenant when the tenant list has
it ("Workspace · Acme Corp"). With no tenant, the Workspace items are
`aria-disabled` buttons, and the landing page's rows plain text, described by
the hint "Choose a tenant first.". Choosing a tenant in the switcher while on a
workspace page keeps the same section for the new tenant. The workspace
layout's breadcrumb (the slug) is text, since `/settings/workspace/$slug` only
redirects to General.

**Redirects** keep old bookmarks working, each with and without a trailing
slash, and keep the query string and hash: `/profile` and `/settings/account`
go to `/settings/account/profile`, and `/tenants/$slug/members`,
`/tenants/$slug/settings` and `/tenants/$slug/activity` go to the workspace
Members, General and Activity pages. The tenant page itself keeps its Overview
and (flag-gated) Beta tabs.

## Lists

Every list page renders through one table, `DataTable`
(`components/shared/data-table/`), over one URL contract and one query shape.
Lists use the API's list contract: `?search`, `sort` (a leading `-` is
descending), `cursor`, `direction`, `limit` and each list's filters in, and
`{ items, page, total? }` out, where `page` is `{ nextCursor, prevCursor,
hasNext, hasPrev, limit }`. The code is shared with apex
([Sibling sync](#sibling-sync-with-apex)).

**The URL contract.** A list is declared once, at module scope, with
`defineList` (`schemas/list.schemas.ts`): its sort whitelist (the first key is
the default), its filters (`listFilter` for a comma list of known values,
`booleanFilter`, `idFilter`, `dayFilter`), the `table` name its analytics
events carry, and optionally `extra` (the route's own params). The result's
`schema` is the route's `validateSearch`. The shared fields are `search`,
`sort`, `cursor`, `direction` (`prev` only), `limit` (20, 50 or 100) and
`hidden` (column ids, a comma list). Every field is `.optional().catch(undefined)`:
a malformed value is dropped, never an error page. Defaults are omitted from
the URL and the request, so a default view's URL has no list params; a route
whose `extra` params have defaults strips them with `stripSearchParams`. A
second list on one route sets a `prefix` (`invitationsSearch`,
`invitationsSort`), and the first list names it in `also` so the route's one
schema keeps both lists' params. A filter is never named `tenant`, which is
the shell's `?tenant`.

**The request.** `listValues` reads a validated search into a list's values
and `listRequest` turns them into the API request (both in
`schemas/list-request.schemas.ts`, which only the table loads, so a route's
schema stays small). `listQueryOptions` (`queries/list.queries.ts`) is the
one query shape: the key is `[...key, 'list', request]`, the first page (no
cursor) also asks for `total=1`, and `placeholderData: keepPreviousData` keeps
the old rows up, marked busy, while the next view loads. The total is capped
at 1,000 by the API (`capped: true` reads "1,000+ results"). `total: false`
leaves `total=1` off for a read that never uses the total, such as the bell's
preview, and is part of the cache key (`'no-total'`) so that page never stands
in for one with a total. `retryList` is the default retry: once, except that
a 4xx other than 408 and 429 is final (a refused param, cursor or role, or a
missing route). A list passes no `retry` of its own.

**`useListSearch(definition)`** is one list's URL state and its writes. Any
write but paging and column choice drops the cursor and direction, since a
cursor belongs to the view it was cut from; hiding a column keeps the page.
Typing a search replaces the history entry; every other write (a filter, a
sort, a page size, a page) pushes one. A default is written as no key. It
fires `table_filtered`, `table_sorted` and `table_paged`, naming the list
and never a value. "Showing 21-40" counts from a page index this tab recorded
as the reader paged (`resetListPositions` forgets them; `tests/setup.ts` calls
it after each test). A page the API answers with no previous page is index 0
whatever was recorded, and a `prev` page with no next page (the API's
last-page answer to a cursor whose page came back empty) has no known
position, so "Showing" is left out rather than wrong.

**`useListQuery(list, options, { enabled })`** is the page: `items`, `page`,
the query, and the view's `total`. A later page keeps the first page's total
through a disabled observer on the first page's cache entry; while a new
view's first page loads the total is absent, never the old view's. A 400 with
`code: 'CURSOR_INVALID'` on a page with a cursor means the API refused the
cursor (tampered, rotated key, or cut from another view): the list drops
`cursor` and `direction`, replacing the refused history entry, and reloads its
first page. The query reads as pending meanwhile, so the refusal never shows
as an error. Any other 400 is an error the table shows.

**`DataTable`** takes the columns, the query state, a `label`, a `getRowId`,
and the `empty` state; the rest is optional (`search`, `filters`, `toolbar`,
`card`, `layout`, `landmark`, `rowTarget`, `errorMessage`).

- _States_ come from `QueryState`: a table-shaped skeleton inside
  `role="status"`, a role refusal, a load error with Try again (the list's
  own `errorMessage`, or `{label} didn’t load. Try again.`), the empty state, or
  the rows. An empty list under a search or filter says "Nothing matches these
  filters." with Reset; an empty page behind a cursor says "Nothing on this
  page." with First page. While the page on screen is the old view's
  placeholder, an empty one shows the skeleton, never "nothing matches", and
  "Showing" is hidden.
- _Columns_ are built with `createColumnHelper<DataTableFeatures, Row>()` and
  passed as a stable array (module-level or memoized). A column's `meta`
  carries `sorts` (the API keys its header steps through) and `sortName`
  (its name in `table_sorted`); `sortWords` picks "A to Z", "oldest first" or
  "lowest first"; `label` names a column whose header is not a string;
  `actions: true` marks the actions column, which is never hideable, and the
  first column never is either (`canHideColumn`); a stale `?hidden=` id for a
  column that cannot hide is ignored. Sorting and paging are server-side
  (`manualSorting`, `manualPagination`).
- _The toolbar_ holds the search box, the faceted filters with their chips,
  the Columns menu, the list's own controls (`toolbar`) and the total. The
  search box follows outside changes to `?search` (the command palette, a
  history pop) and keeps newer keystrokes when the change is its own echo, so
  a page never adds its own sync.
- _Phone cards._ Below 768 px, or with `layout="cards"`, the rows render as
  cards built from the visible columns (the first column is the title, actions
  sit at the bottom). A custom `card(row, { target })` replaces the card; it
  renders one `role="listitem"` and puts `target` on it as the row's focus
  landmark. Card layout gets a "Sort by" menu in the toolbar row when any
  column is sortable, with "Default order" when no column owns the list's
  default sort (reported as `table_sorted` with `sort: 'default'`). With a
  custom card the Columns menu is hidden in card layout.
- _Names._ The table sits in `<section aria-label={label}>`, its paging
  landmark is `{label} pagination`, so a page with two lists passes axe's
  `landmark-unique`. Each toolbar control is named with what it shows, then the
  list (`controlName`): "Filter by role, Members", "Columns, Members", "Reset,
  Members", "Rows per page, Members" and "Sort by, Members". The name starts
  with the visible words (WCAG 2.5.3), and a buttons list never shows two of
  one name. "Previous page" and "Next page" keep their names, since the
  `{label} pagination` landmark names the list. A parent that is already the
  list's named region passes `landmark={false}`.

**Adding a list.**

1. Define the URL contract with `defineList` in a module of its own when the
   list's queries are heavy (`notification-list.queries.ts` holds the inbox's
   so the route's `validateSearch` does not pull the writes into the entry
   chunk). A filter's values come from a constants module (`membership-roles.ts`,
   `audit-action-names.ts`), not from the module that holds the labels, for
   the same reason.
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

A route schema keeps zod classes out of the entry chunk. Use `z.custom` rather
than `z.number`, `z.literal` or `z.boolean` in a route's search schema, as
`list.schemas.ts` does for `limit` and the yes/no filter, and keep
`components/shared/data-table/**` (and TanStack Table) out of anything the
entry imports: the switcher, the bell, `nav-secondary` and the guard never
import from it. `pnpm check:bundle` enforces the budget. `ENTRY_BUDGET_BYTES`
went from 584,000 to 586,600 B over the lists: the list contract's route
schemas and query options reach the entry through each list route's
`validateSearch` and the tenant queries, plus the paged membership read, the
members and activity routes' schemas, the owners read and the audit action
names. None of it added a zod class. The activity route took the entry to
587,153 B; moving the inbox's writes out of it and making `_app`'s guard lazy
brought it to 586,530 B, and the members read's `total` opt-out added 67 B. The
budget is the final 586,597 B rounded up to the next 100 B. The list route
search types are type-only and cost nothing.

**The inbox** is a list in card layout. Its writes (mark read, mark all read,
delete) are optimistic across every cached page of every view: a read row
leaves the unread views and lowers an exact unread total by one. Each write
carries `WRITE_KEY`, so one can tell whether another is in flight
(`isMutating`): a rollback or a refetch waits for the last write to settle,
because an earlier one would undo a later write's edit. The bell reads a
`limit=5` preview with `total: false` and the unread count from the unread
view's total.

## State

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
interceptors and route guards do, or subscribes to them: the session module
follows the auth store's user to keep analytics and the flag caches in step,
and the maintenance recovery follows the mode. The auth store's user is the
profile the session restore or the sign-in loaded; the maintenance store
holds what the API last said about the mode, from any of its three sources.

Every `queryFn` hands TanStack Query's `signal` to `apiClient`, so a cancelled
query (`cancelQueries`, or a read no observer wants any more) aborts its
request on the wire. `tests/unit/queries/query-cancellation.test.tsx` pins it
for each read, and `list.queries.test.ts` for the list pages.

## The HTTP layer and session

Every REST call goes through `apiClient` (`src/http/client.ts`): an axios
instance whose base is the relative `API_PREFIX`, `/api/v1`, with
credentials sent and a 30-second timeout. The timeout exists because axios
has none by default, and a request that never answers would leave its
mutation pending and its button disabled.

**The prefix is fixed and same-origin.** It is written once, as
`API_PREFIX` in `src/constants/routes.ts`; the axios base derives from it
and the analytics proxy path repeats it. The development server proxies
`/api` to the API (`vite.config.ts`) and the container's nginx does the
same, so the app only ever calls the origin that served it. nginx's
`location /api/v1/collect/` hardcodes `/api/v1`, so moving the prefix means
changing `API_PREFIX` and `nginx.conf` in one change, plus the `/api/`
location and the Vite proxy for a prefix outside `/api`. There is no
environment variable for it: one that moved only the axios base would leave
every path that repeats or hardcodes the prefix on the old one. This app's
own users of the prefix are in [Routing](#routing-and-data-loading) and
[Realtime](#realtime-this-app-only).

**Interceptors**, installed by `installInterceptors`. The two request
interceptors are independent of each other; the response interceptors run
in the order they are registered:

| Direction | Order | Interceptor                   | Does                                                                                                                                                                |
| --------- | ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request   | –     | Bearer token                  | Adds `Authorization: Bearer` from the auth store when the request has none.                                                                                         |
| Request   | –     | Trace headers                 | On a same-origin request under the prefix: a `traceparent` when the request has none (a replay keeps its own), and the analytics session id when one may be linked. |
| Response  | 1     | 401 handling                  | Refreshes and replays once on an expired token; signs out on a verdict; leaves `REAUTH_REQUIRED` to the caller.                                                     |
| Response  | 2     | `rejectMalformedJsonResponse` | Rejects a 2xx whose body is not a JSON object, such as an HTML page from a misrouted proxy.                                                                         |

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
- The `auth` BroadcastChannel carries three messages between tabs, none with
  data. `logout` signs every tab out. `signed_in` is posted by the page that
  spent a sign-in or invitation-confirm link; a tab with a link out (the
  sign-in form's "Check your inbox", or the accept page while its
  confirmation link is out) restores the shared session with
  `ensureSession()` and moves on,
  and a tab that is already signed in ignores it. `step_up_confirmed` is
  posted by apex's confirm page; this app never sends it.
- `installAnalyticsIdentity()` subscribes to the auth store: a change of
  user resets analytics and drops every cached flag value and exposure mark
  before the next user is identified.

Why each of these holds, and what breaks if it does not, is in
[Token storage and refresh](SECURITY.md#token-storage-and-refresh) and
[Sign-out rules](SECURITY.md#sign-out-rules).

## Realtime (this app only)

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
`worker_connections` for that. `nginx.conf`'s
`location /api/v1/notifications/stream` turns off buffering, empties the
`Connection` header and raises the read timeout; it hardcodes the API
prefix, so moving `API_PREFIX` means editing this location too. Its logging
choices are in [CSP and headers](SECURITY.md#csp-and-headers). The dev
server's proxy does not propagate an upstream close, so the reconnect path
can only be exercised against the image (the `nginx` Playwright project).

## Analytics, flags and errors

Analytics and error tracking share one transport, the API's `/api/v1/collect`
proxy, which forwards to PostHog. Flags are read from, and exposures reported
to, the API's own flag endpoints. In every case the browser never talks to
PostHog. What each sends, masks and withholds is in
[Analytics privacy](SECURITY.md#analytics-privacy) and
[Error-tracking privacy](SECURITY.md#error-tracking-privacy).

### Analytics

`src/observability/telemetry/` is the only code that imports posthog-js,
and `telemetry.ts`, the facade, is the only module that imports it as a
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
- **Page views come from the app, not the SDK.** posthog-js's own history
  page views are off; the app captures `$pageview` with `capturePageview()`
  (this app's router hook: [Router hooks](#router-hooks-this-app-only)).
- **Identity follows the auth store**, through `installAnalyticsIdentity` in
  `src/http/session.ts` ([The HTTP layer and session](#the-http-layer-and-session)).
- **Per-app constants** sit at the top of
  `src/observability/telemetry/config.ts`: the `app` property, the query-key
  allowlist, whether consent modes and the cross-domain handoff are
  supported, and how the identity cookie is shared. The registry of typed
  events is `event-registry.ts`. Everything else in the folder is shared with the
  sibling app ([Sibling sync](#sibling-sync-with-apex)).
- `src/observability/identity-epoch.ts` is a counter of the calls that change
  who an event belongs to. It is a module of its own, importing nothing, so
  the entry-chunk error listener can read it without importing the facade.

### Feature flags

The API is the only evaluator; posthog-js does no flag work. Values are read
per scope, and `src/observability/flags/flag-scope.ts`, which each app owns,
says which scope a page reads and which endpoint answers it. This app's
scopes are in [Router hooks](#router-hooks-this-app-only).

- **The registry slice** is `CLIENT_FLAGS` in `flag-keys.ts`, also per app:
  the API registry's entries the app reads, mirrored by hand, each with its kind,
  variants, fallback and whether it is an experiment. A value the server
  sends for a key the slice lacks is dropped, and a missing or invalid value
  becomes that flag's fallback (`normalizeFlags`).
- **Reads.** One query per scope (`flag-query.ts`): fresh for five minutes,
  refetched every ten and on focus once stale, never retried. `ensureFlags`
  never rejects, so a failed read renders the page with fallbacks. Pages
  read values with `useFlagValues()` and `useVariant(key)`
  (`flag-hooks.ts`), which show the fallback while loading and after a
  failure.
- **A change of user** drops every scope's values and the exposure marks
  ([The HTTP layer and session](#the-http-layer-and-session)).
- **Exposure.** `useVariant` on an experiment flag, once its value came from
  the server, reports the key, never the value, to the scope's
  `/exposures` endpoint (`exposure.ts`): batched for 50 ms, at most 10 keys
  per request, once per scope, key and value in a tab session. The API
  re-evaluates and records the exposure.
- **`$feature/*` super properties** carry each flag's value on every browser
  event. `useFeaturePropertiesSync`, mounted once in the signed-in layout,
  syncs them in a layout effect, never from a query or loader: a loader also
  runs for a hover preload, whose scope is not the page's. The app's router
  syncs them too before each page view.

### Router hooks (this app only)

`src/router.tsx` subscribes three hooks of this app's own to the router.
All run on committed navigations, never in a loader, because a loader also
runs for a hover preload. A fourth, `installCurrentTenant`, records the tenant
`retainTenant` carries ([The current tenant in the URL](#the-current-tenant-in-the-url)).

- **Page views and the tenant group.** `installRouteAnalytics`
  (`src/observability/route-telemetry.ts`) runs on `onResolved`: it sets the
  tenant group from the tenant read in the tenant route's loader data,
  awaited for at most `TENANT_GROUP_WAIT_MS` (10 s), or clears it, and only
  then captures `$pageview` when the path changed. Resolves are handled in
  order, so a later page's view waits behind an earlier tenant read. It is
  installed before the first load, so the landing page is counted.
- **Flag scopes.** A tenant page reads `/tenants/:slug/flags` and every other
  page `/flags` (`flagScopeFor` in `flag-scope.ts`). The `_app` loader warms
  the scope the shell is entered on, and the tenant route's loader warms a
  tenant's on a switch. On a resolved navigation to a different tenant,
  `installFlagScopeReset` drops every other scope's values and the exposure
  dedupe, so returning to a tenant reads its flags afresh.
- **`$feature/*` before each page view.** `installRouteFeatureProperties`
  syncs them on `onLoad`, which fires before `onResolved` captures the page
  view and never for a preload. It is what gives the first page view its
  properties, since that load runs before React mounts. A page outside the
  signed-in shell syncs to the no-tenant scope's cached values, or to none.

### Error tracking

Error tracking is split so that every page pays almost nothing for it:

- **`listen.ts`**, in the entry chunk, notes raw errors and nothing else:
  the window listeners, React's root `onUncaughtError` and `onCaughtError`
  (`rootErrorOptions`, passed to `createRoot`), and `noteError` for an error
  the app catches that those hooks never see (this app's callers are
  `RouteError` and `ToastHost`). It drops repeats,
  buffers a few errors, and loads the reporter on the first error or when
  the browser is idle. It imports only `identity-epoch.ts`.
  `pnpm check:bundle` caps it at 1 KB gzipped and keeps `@posthog/core` and
  posthog-js out of the first-visit chunks.
- **`report.ts`**, lazy, filters each error, builds a `$exception` with
  `@posthog/core`, and scrubs, caps and attributes it as
  [Error-tracking privacy](SECURITY.md#error-tracking-privacy) describes.
  It posts batches to `/api/v1/collect/batch/`, retries a failed batch once,
  and on `pagehide` sends whatever is left by `sendBeacon`. The batch,
  retry and cap constants are at the top of the file.
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

The interceptor is installed on `apiClient` from `src/router.tsx`, before
the first request, after the interceptors of
[The HTTP layer and session](#the-http-layer-and-session), so it sees what
they pass on, a replay's answer included. It never changes a response's
outcome. It lives in `src/lib/` rather than `src/http/`, which is shared
with the sibling app and so carries no maintenance handling.

`MaintenanceGate` wraps every route, in the root route's component:

- **`full`**: it renders `MaintenancePage` in place of the route tree, sign-in
  and the link pages included, with the owner's message as text. Because the
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
  and temp paths under `/tmp`, connection limits (its comments give the
  sizing), and an include of `/tmp/nginx/conf.d/*.conf`.
- `nginx.conf` is the server block, installed as a template. At start, the
  image's entrypoint runs `/docker-entrypoint.d/` in name order:
  `docker/05-prepare.sh` creates the render directory and validates
  `API_UPSTREAM`; `docker/10-runtime-config.sh` validates the run-time
  settings and writes `/tmp/runtime/runtime-config.js`; the stock envsubst
  script then renders `nginx.conf`, substituting `API_UPSTREAM` and nothing
  else, so nginx's own variables survive. A failing script stops the
  container before nginx starts.

`nginx.conf` proxies `/api/` to `API_UPSTREAM`, gives
`/api/v1/collect/` a larger request body that streams to the API for replay
batches, serves `/runtime-config.js` from where the entrypoint wrote it,
answers a missing file under `/assets/` with a real 404 rather than
`index.html`, and falls back to `index.html` for every other path. Each
location's comment in `nginx.conf` gives its reason; the source map
location is covered in [CSP and headers](SECURITY.md#csp-and-headers).

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
   reader, applies the same patterns again. A production bundle, the one
   `pnpm preview` serves included, reads only `window.__APP_CONFIG__`. The
   dev server and the unit tests read the same names with a `VITE_` prefix
   from `import.meta.env`. On the dev and preview servers,
   `scripts/runtime-config-plugin.mjs` renders `/runtime-config.js` from
   those `VITE_` names.

A new setting goes into `RUNTIME_CONFIG_KEYS` and `RUNTIME_CONFIG_PATTERNS`,
the entrypoint script with the same pattern, `RUNTIME_CONFIG_NAMES` in
`scripts/runtime-config-plugin.mjs`, `docker/check-image.sh`, `.env.example`
and the README's table, in one change. The variables and their defaults are
in the [README's run-time configuration table](README.md#run-time-configuration),
and why the values are safe to write unescaped is in
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

`docker/check-image.sh` checks a built image from outside. Its checks on the
user, the root filesystem, the headers, the source maps, the refused run-time
settings and the release are listed in
[CSP and headers](SECURITY.md#csp-and-headers); the script also checks that
`docker/05-prepare.sh` accepts good `API_UPSTREAM` values and refuses bad
ones, and the content type of the JavaScript the image serves.

## Sibling sync with apex

`apex-boilerplate`, the staff console, shares these paths with this app.
A change to one here means checking the other app in the same pull
request, and the description says what happened there.

| Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Why it must stay in step                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/http/*`, except `sse.ts` (this app only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Session refresh single-flight, 401-verdict sign-out, trace headers, analytics identity order                                                                                                                                                                                                                                                                                                                                                               |
| `src/lib/api-error.ts`, `tests/unit/lib/api-error.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Error envelope parsing                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/schemas/auth.schemas.ts`, `tests/unit/schemas/auth.schemas.test.ts`, `src/schemas/safe-text.schemas.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Mirror the API's validators                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/schemas/profile.schemas.ts`, `src/schemas/invitation.schemas.ts`, `src/schemas/email-domain.schemas.ts` and their tests in `tests/unit/schemas/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Mirror the API's validators                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/ui/form.tsx`, `src/components/ui/toast.tsx`, `src/lib/toast.ts`, `src/components/shared/toast-host.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Shared behaviour; form.tsx is hand-written, toast.tsx is vendored with local edits                                                                                                                                                                                                                                                                                                                                                                         |
| `nginx.conf` security headers and CSP, `location /api/v1/collect/` and `location ~* ^/api/v1/auth/google/callback/?$`, the token-page comment above `access_log`, `tests/unit/docker/nginx-conf.test.ts` (react's also covers the stream location)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Same threat model; same replay batch size                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/observability/telemetry/*`, except `config.ts`'s per-app constants and `event-registry.ts`'s registry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | One PII, consent, handoff and identity contract                                                                                                                                                                                                                                                                                                                                                                                                            |
| `src/components/shared/pii.tsx`, `e2e/helpers/fake-posthog.ts`, `tests/mocks/posthog.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The masking class, the egress guard's fake PostHog, and the posthog-js stand-in the unit tests share                                                                                                                                                                                                                                                                                                                                                       |
| `src/components/shared/{query-state,page-skeleton,section-skeleton,section-boundary,pending-templates}.tsx` (`pending-templates.ts`), `tests/unit/components/shared/{query-state,page-skeleton,section-skeleton,section-boundary,pending-templates,pending-templates-preload}.test.tsx`; the `retryDelay: 0` `QueryClient` mock block in `tests/setup.ts` (the block, not the file)                                                                                                                                                                                                                                                                                                                                                                                                                                                | Byte-identical loading templates and section states; each app keeps its own `src/lib/role-denied.ts` (react: 403, apex: 404) and `src/components/features/role-denied.tsx` at the same paths                                                                                                                                                                                                                                                               |
| `src/observability/flags/**`, except `flag-keys.ts` (each app's registry slice) and `flag-scope.ts` (each app's scope); `tests/unit/observability/flags/**`, except `flag-scope.test.ts` and apex's `flag-keys.test.ts`; `tests/fixtures/test-client-flags.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | One flag read, exposure and `$feature/*` contract; the tests mock `flag-keys` with test keys so they pass in both apps                                                                                                                                                                                                                                                                                                                                     |
| `docker/10-runtime-config.sh`, `src/configs/runtime-config.ts`, `scripts/runtime-config-plugin.mjs`, `nginx.conf`'s `location = /runtime-config.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | One run-time configuration contract: the same variable names, patterns and file in both images                                                                                                                                                                                                                                                                                                                                                             |
| `docker/05-prepare.sh`, `tests/unit/docker/prepare-script.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Validates `API_UPSTREAM`, the other half of the container contract                                                                                                                                                                                                                                                                                                                                                                                         |
| `public/theme-init.js`, `src/lib/zod-jitless.ts`, `tests/unit/lib/zod-jitless.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | CSP compatibility                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/observability/errors/**`, `src/observability/identity-epoch.ts`, `tests/fixtures/error-scrub-vectors.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | One capture, filter, scrub and consent contract; the vectors are express-boilerplate's, byte for byte                                                                                                                                                                                                                                                                                                                                                      |
| `src/main.tsx`, `src/components/features/route-error.tsx`, the `setErrorRouteSource` line in `src/router.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | The same boot order, and router and React root errors reported with their route the same way                                                                                                                                                                                                                                                                                                                                                               |
| `docker/upload-sourcemaps.sh`, `docker/check-image.sh`, `docker/posthog-cli.sha256`, `.github/workflows/deploy.yml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | One source map pipeline                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `nginx.conf`'s `.map` location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | No source map is ever served                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `docker/nginx.main.conf`, `pnpm-workspace.yaml`, `tests/unit/docker/check-image-script.test.ts`, `tests/unit/docker/nginx-main-conf.test.ts`, `tests/unit/docker/dockerfile.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Same container limits, dependency overrides and script tests                                                                                                                                                                                                                                                                                                                                                                                               |
| `e2e/nginx/cors.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | The CORS seam through nginx; this app adds a preflight for its stream                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/components/features/profile/security-section.tsx` and its test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | One Security section: sign-in methods and sign-out-other-sessions                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/lib/safe-redirect.ts`, `src/lib/countdown.ts`, `src/lib/retry.ts`, `src/hooks/use-countdown.ts`, `tests/unit/lib/{safe-redirect,countdown,retry}.test.ts`, `tests/unit/hooks/use-countdown.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | One rule for a safe landing path, one countdown clock (with `'use no memo'`, so the React Compiler cannot freeze it) and one wording of a `Retry-After` wait                                                                                                                                                                                                                                                                                               |
| `src/components/features/auth/{sign-in-link-form,link-panels}.tsx`, `tests/unit/components/features/auth/{sign-in-link-form,link-panels}.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | One sign-in-link form with its "Check your inbox" step and resend clock, and one set of link-page panels (signing in, switch account, Try again)                                                                                                                                                                                                                                                                                                           |
| `src/components/features/invitations/{invitation-parts.tsx,land-joined.ts}`, `src/hooks/use-signed-in-elsewhere.ts`, `tests/unit/components/features/invitations/invitation-parts.test.tsx`, `tests/unit/hooks/use-signed-in-elsewhere.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | One set of invitation-page parts: the card, "Check your inbox", the dead and incomplete confirm links, the join toast, and the cross-tab listener the page holds while a confirmation link is out, which the sign-in link form holds too. Each app keeps its own accept and confirm pages and passes its own landing                                                                                                                                       |
| `src/schemas/changed-fields.schemas.ts`, `src/hooks/use-changed-fields.ts`, `tests/unit/hooks/use-changed-fields.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Changed-field edit forms; each app keeps its own schema test                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/hooks/use-now.ts`, `tests/unit/hooks/use-now.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | One shared ticking clock, so every relative time moves on while a page stays open; byte for byte                                                                                                                                                                                                                                                                                                                                                           |
| `vitest.config.ts`'s React Compiler plugin block (`babel({ presets: [reactCompilerPreset()] })`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | The unit suite runs under the compiler, so a value the compiler would cache at render (a clock, module state) fails a unit test in both apps                                                                                                                                                                                                                                                                                                               |
| `scripts/check-bundle.mjs`, except `ENTRY_BUDGET_BYTES` (each app's measured budget)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | One first-visit budget check; the budgets differ                                                                                                                                                                                                                                                                                                                                                                                                           |
| `eslint.config.js`'s shared conventions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Same conventions; each app adds its own import restrictions and file lists                                                                                                                                                                                                                                                                                                                                                                                 |
| `e2e/capture/*`, except `seed.ts`, `manifest.ts` and `boot.test.ts` (each app's own); `tests/unit/capture-endpoint.test.ts`, `tests/unit/docs-pages.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | One page-inventory capture harness and docs check. `mailpit.ts`'s `mailedLink` is also how the `live` helpers read each mailed sign-in and confirmation link                                                                                                                                                                                                                                                                                               |
| `src/components/ui/{alert,spinner,item,button}.tsx`, `tests/unit/components/ui/button.test.tsx`, the intro, `*`, `alert.tsx` and `button.tsx` sections of `docs/ui-local-edits.md`, `scripts/ui-drift.mjs`, `scripts/ui-drift.d.mts`, `tests/unit/ui-drift.test.ts`, the `ui:drift` scripts, CI step, `scripts/ui-registry` ignores (`.dockerignore` included), CODEOWNERS line and `shadcn` Renovate rule; not the snapshot itself, each app's own                                                                                                                                                                                                                                                                                                                                                                                | Byte-identical vendored components and the one drift check over them                                                                                                                                                                                                                                                                                                                                                                                       |
| `src/components/shared/{empty-state,note,busy-button}.tsx`, `src/components/features/load-error.tsx`, `tests/unit/components/shared/*.test.tsx`, `tests/unit/components/features/load-error.test.tsx`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Byte-identical shared empty, note, busy and load-error components                                                                                                                                                                                                                                                                                                                                                                                          |
| `public/boot-variant.js`, `index.html`'s `<style id="boot-shell">` block and `#root` markup (not its `<style id="boot-tokens">` colours, each app's own), `tests/unit/boot-shell.test.ts`, `tests/unit/boot-variant.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | One first-paint shell; the colours are pinned to each app's `globals.css`                                                                                                                                                                                                                                                                                                                                                                                  |
| `src/types/list.types.ts`, `src/schemas/{list,list-request,search}.schemas.ts`, `src/queries/list.queries.ts`, `src/components/shared/data-table/{data-table,data-table-cards,data-table-chip,data-table-column-header,data-table-faceted-filter,data-table-pagination,data-table-sort-menu,data-table-toolbar}.tsx`, `src/components/shared/data-table/{data-table-model,use-list-query,use-list-search}.ts`, `src/components/ui/{popover,checkbox}.tsx`, `tests/fixtures/list-page.ts`, `tests/unit/schemas/{list,search}.schemas.test.ts`, `tests/unit/queries/list.queries.test.ts`, `tests/unit/components/shared/data-table/{list-harness.tsx,use-list-search.test.tsx,data-table.test.tsx,data-table-toolbar.test.tsx}`; the `resetListPositions` import and `afterEach` call in `tests/setup.ts` (the lines, not the file) | Byte-identical list contract and DataTable: one URL shape, one table, one test suite. Each app keeps its own list definitions and query files, columns, `event-registry.ts` entries (`table_*`), constants such as `membership-roles.ts`, and `e2e/fixtures/lists.test.ts`                                                                                                                                                                                 |
| `src/components/ui/command.tsx`, `src/lib/shortcut.ts`, `src/hooks/use-debounced-value.ts`, `src/states/command-palette.store.ts`, `src/components/shared/command-palette/*` (`command-palette-host.tsx` included, whose open-time read must stay compiler-safe), `tests/unit/hooks/use-debounced-value.test.tsx`, `tests/unit/lib/shortcut.test.ts`, `tests/unit/states/command-palette.store.test.ts`, `tests/unit/components/shared/command-palette/*`; the `### command.tsx` section of `docs/ui-local-edits.md`                                                                                                                                                                                                                                                                                                               | Byte-identical command palette core: one shell, one shortcut, one recents rule, one test suite. `recent-keys.ts` holds the recents' key prefix and the sign-out clear, and each app's `auth.store.ts` (not shared) calls its `clearAllRecents()`. Each app keeps its own `src/components/features/command-palette.tsx` (its commands), the components that register This page commands, its `event-registry.ts` entries and `e2e/fixtures/palette.test.ts` |

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

A release promotes a digest rather than rebuilding, so source maps are
uploaded only when an image is built; the consequence is in the README's
[Source maps](README.md#source-maps). The one-time repository setup, the release
flow and the one-origin rule for deployments are in the README's
[Deploying](README.md#deploying) and [Releases](README.md#releases) sections.
