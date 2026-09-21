# React Boilerplate Rebuild — Design Spec

Status: **Revision 2026-09-21 — approved in brainstorming, supersedes the 2026-09-17 text**
Original session: https://claude.ai/code/session_018W6fi5MwVob2Vr1AexY5Mu
Revision session: https://claude.ai/code/session_01Ez5SLSQsK5MAu5LjyGAQGG
Stream: 7 of 7 (see express-boilerplate's `2026-09-16-boilerplate-roadmap.md`)
Verified against: express-boilerplate @ `d5979b2`, npm registry as of 2026-09-21

> **Revision note.** The 2026-09-17 spec was approved before anyone read the shipped
> express-boilerplate closely. Four of its statements about that API were wrong and
> several more were missing. This revision replaces the document wholesale rather than
> appending errata — git holds v1 at commit `ba89b3d`. Appendix A lists every change and
> the evidence for it, so a reader who remembers v1 can see exactly what moved.
>
> The implementation plan at `docs/superpowers/plans/2026-09-17-react-rebuild.md` derives
> from v1 and is **superseded**. It must be regenerated from this document, not patched —
> see Appendix B for the specific defects that make hand-patching unsafe.

## Problem

The current react-boilerplate uses an outdated stack: React 18, React Router, Redux,
Tailwind 3, React Hook Form, Zod 3. It does not align with the express-boilerplate's
shipped API routes, has no proper tests, no CI, and no Dockerfile. Both production
frontends (Ofluence/pulse, Consequential/pulse) have already moved to React 19 +
TanStack Router + Zustand + Tailwind 4.

## Solution

A full rewrite on the production-proven stack from Ofluence/pulse and Consequential/pulse,
correct against the express-boilerplate's actual API surface, with a StyleSeed-governed
design layer.

## Phasing

The work splits at one seam: **who owns the token layer and the UI primitives.** This
spec pins that seam once, so both phases can be planned now and built in order.

| | Phase A — Correct frontend | Phase B — Designed frontend |
|---|---|---|
| Scope | Transport, auth/HTTP, pages, tenancy, tests, CI, Docker, lint | StyleSeed setup, tokens, primitives, gate chain |
| Depends on | Nothing | Phase A's stack and page inventory |
| Deliverable | A working, tested, accessible SPA on neutral shadcn defaults | The same SPA on StyleSeed's compiled grammar and palette |

Phase A is shippable on its own. Phase B does not change Phase A's routes, queries,
stores, or contracts — only the visual layer and the primitives those pages import.

---

## 1. Transport & Origin

**This section governs everything downstream. Read it first.**

`src/app.ts` in express-boilerplate mounts exactly: `requestId`, `requestContext`,
`express.json({ limit: '1mb' })`, `express.urlencoded`, `/health`, `/health/ready`,
`/api/v1`, a 404, and the error handler. There is **no CORS middleware and no `cors`
dependency**. `env.config.ts:48` refers to CORS as a plan, not a shipped feature.

A browser therefore cannot call this API cross-origin. The SPA is served **same-origin**
with the API; no CORS is added to the backend.

| | Dev | Prod |
|---|---|---|
| SPA | Vite dev server, port 5173 | nginx, serving `dist/` |
| API | Vite proxy `/api` → `http://localhost:4040` | nginx `location /api/` → upstream |
| `VITE_API_URL` | `/api/v1` | `/api/v1` |

`VITE_API_URL` is a **relative path**. v1 specified an absolute
`http://localhost:4040/api/v1` *and* a Vite `/api` proxy; axios given an absolute URL
bypasses the proxy entirely, so v1's two halves contradicted each other and neither
worked alone.

Four consequences, each binding:

1. **The Google sign-in control is an anchor, not an axios call.**
   `<a href="/api/v1/auth/google">` — a top-level navigation. Same-origin, so no preflight.
   `VITE_GOOGLE_OAUTH_URL` is removed from the environment.
2. **nginx must not rewrite the URI.** Use `proxy_pass http://api:4040;` with no trailing
   path. The refresh cookie's `Path` is `/api/v1/auth` (`REFRESH_TOKEN_COOKIE_PATH`); a
   rewriting `proxy_pass` changes the path the browser scopes the cookie to, and token
   refresh silently stops working.
3. **`proxy_set_header X-Forwarded-Proto $scheme` is required.** Express's
   `isSecureCookieEnvironment()` and its `TRUST_PROXY` setting both read it; without it the
   `secure` cookie flag is wrong in production.
4. **`proxy_buffering off` on the notifications stream location.** nginx buffers responses
   by default, which stalls SSE indefinitely. `/api/v1/notifications/stream` needs its own
   `location` block. v1's one-line `try_files` nginx.conf did not cover this.

**Deployment coupling.** express's `WEB_URL` must equal the SPA's origin:
`handleGoogleCallback` redirects to `${WEB_URL}/auth/callback` on success and
`${WEB_URL}/login?error=<code>` on failure (`auth.controller.ts:933,957,964`).

---

## 2. Tech Stack

Exact versions, pinned the way express-boilerplate pins (exact for tooling, `~` for
TypeScript). Resolved from the npm registry on 2026-09-21.

### Runtime

| Package | Version | Note |
|---|---|---|
| react, react-dom | 19.3.0 | |
| @tanstack/react-router | 1.170.38 | File-based routing |
| @tanstack/react-query | 5.103.2 | Server state |
| @tanstack/react-form | 1.33.5 | **No adapter package** — see below |
| zustand | 5.0.15 | Client state |
| zod | 4.6.5 | Matches express-boilerplate |
| axios | 1.20.0 | |
| sonner | 2.0.8 | Toasts |
| lucide-react | 1.47.0 | Icons |
| @radix-ui/react-* | per component | **Individual packages, not unified `radix-ui`** — see below |
| clsx | 2.1.1 | |
| tailwind-merge | 3.7.0 | |
| class-variance-authority | 0.7.1 | |

**Radix arrives per-component, not as the unified `radix-ui` package.** Verified against
the shadcn registry: `button.json` and `breadcrumb.json` declare `@radix-ui/react-slot`,
`sidebar.json` declares `@radix-ui/react-slot` plus six registry dependencies. StyleSeed's
primitives do the same. Both sources add the individual packages they need, so the
unified `radix-ui` package is not a dependency of this project and must not be installed
alongside them.

**`@tanstack/zod-form-adapter` must not be installed.** It is stranded at 0.42.1 against
`@tanstack/react-form@1.33.5`, and `@tanstack/form-core@1.33.5` declares no schema
dependency at all. TanStack Form v1 consumes **Standard Schema** directly; Zod 4
implements it, so a Zod schema is passed straight to a validator. v1 of this spec's plan
listed the adapter as a dependency.

### Build and tooling

| Package | Version | Note |
|---|---|---|
| typescript | **~6.0.3** | **Not 7.0.2** — see below |
| @types/react, @types/react-dom | 19.3.0 | |
| @types/node | 24.13.6 | **Matches the Node 24 runtime**, not latest — see below |
| vite | 8.3.0 | |
| @vitejs/plugin-react | 6.1.1 | oxc-based |
| babel-plugin-react-compiler | 1.0.0 | Optional peer, required for the compiler |
| @rolldown/plugin-babel | 0.2.4 | Optional peer, required for the compiler |
| tailwindcss, @tailwindcss/vite | 4.3.3 | |
| @tanstack/router-plugin | 1.168.40 | |
| @tanstack/react-router-devtools | 1.167.2 | |
| @tanstack/react-query-devtools | 5.103.2 | |

**`@types/node` is pinned to the 24.x line on purpose.** Docker (§12) and CI (§11) both
run Node 24. Installing types for Node 26 would let tooling code compile against APIs the
runtime does not have. Same shape as the TypeScript pin below, smaller blast radius.

**TypeScript is pinned below latest on purpose.** `typescript-eslint@8.70.0` — and its
canary `8.70.1-alpha.31` — both declare `typescript: ">=4.8.4 <6.1.0"`. No
typescript-eslint release supports TypeScript 7. express-boilerplate already pins
`typescript: ~6.0.3` against the same `typescript-eslint@8.70.0` and `eslint@10.10.0`, so
`~6.0.3` is both the working ceiling and the consistent choice. Revisit when
typescript-eslint ships TS 7 support.

### Lint, format, test

| Package | Version |
|---|---|
| eslint | 10.11.0 |
| @eslint/js | 10.0.1 |
| typescript-eslint | 8.70.0 |
| globals | 17.12.0 |
| eslint-config-prettier | 10.1.8 |
| eslint-plugin-react-hooks | 7.1.1 |
| eslint-plugin-react-refresh | 0.5.7 |
| eslint-plugin-tailwindcss | 4.4.0 |
| prettier | 3.9.8 |
| @ianvs/prettier-plugin-sort-imports | 4.7.1 |
| prettier-plugin-tailwindcss | 0.8.1 |
| vitest, @vitest/coverage-v8 | 5.0.1 |
| @testing-library/react | 16.3.3 |
| @testing-library/dom | 10.4.2 |
| @testing-library/jest-dom | 7.0.1 |
| @testing-library/user-event | 14.6.7 |
| jsdom | 30.1.0 |
| msw | 2.15.0 |
| jest-axe | 11.0.0 |
| @types/jest-axe | 3.5.9 |
| axe-core | 4.13.0 |
| husky | 9.1.7 |

`jest-axe` — not `vitest-axe` — backs the accessibility assertions in §11. Despite the
name it is framework-agnostic: `expect.extend(toHaveNoViolations)` works under Vitest.
`vitest-axe` is stuck at 0.1.0 and was last published in January 2025, against a `vitest`
peer range that predates Vitest 5.

`@testing-library/dom` is an explicit peer of `@testing-library/react` and must be
installed by name. **`eslint-plugin-react-compiler` must not be installed** — it is still
`19.1.0-rc.2`, and `eslint-plugin-react-hooks@7` already ships the compiler rules.

### Package manager

`pnpm`, matching express-boilerplate. The repo currently carries a `yarn.lock`; it is
**deleted** as part of the scaffold step. The existing lint config file is
`eslint.config.js`, not `.mjs`.

### React Compiler

Enabled: `react({ compiler: true })`. `@vitejs/plugin-react@6` is oxc-based and exposes
`compiler?: boolean | ReactCompilerOptions` directly — it is **not** configured through a
`babel.plugins` array as in v5 and earlier. It requires the two optional peers listed
above to be installed explicitly.

### Vite config (exact)

```ts
import path from 'node:path'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/pages',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react({ compiler: true }),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:4040', changeOrigin: true } },
  },
})
```

`TanStackRouterVite` still exists as a deprecated alias; the current export is
`tanstackRouter`, and `target` is now a required-in-practice option.

### Phase A primitives (two CLI traps)

Phase A takes its primitives from the shadcn CLI. Two registry entries must be handled
deliberately rather than installed as-is:

1. **Never run `shadcn add form`.** Its registry entry declares `react-hook-form` and
   `@hookform/resolvers` as dependencies — the libraries this rewrite removes. The form
   primitive is hand-written against TanStack Form from the start, exporting `Form`,
   `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`
   and `useFormField`, so Phase B can swap in StyleSeed's presentational versions without
   touching a single call site.
2. **`shadcn add sonner` pulls `next-themes`**, which is a Next.js library and has no
   place in a Vite SPA. The generated component is edited to read this project's Zustand
   theme store instead, and `next-themes` is not installed.

`shadcn add toast` is not used at all — Sonner is the only toast system (§9).

---

## 3. API Contract

Every response uses one of two envelopes (`src/utilities/response.utilities.ts`):

```ts
type ApiSuccess<T> = { success: true;  message: string; statusCode: number; data: T }
type ApiError      = { success: false; message: string; statusCode: number
                       code?: string; errors?: unknown; requestId: string }
```

`code` is the stable, machine-readable discriminator a client branches on —
`ACCESS_TOKEN_EXPIRED` is the one this frontend depends on. `errors` carries field-level
validator detail and is mapped onto form fields. These types live in
`src/types/api.types.ts`; v1 named that file without ever defining its contents.

The auth router mounts `requireJsonContentType` router-wide, so every auth request must
carry `Content-Type: application/json` (axios does this for object bodies) or no
content-type at all.

### Endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | |
| POST | `/auth/login` | — | |
| POST | `/auth/refresh` | cookie | Returns `{ accessToken }` **only** |
| POST | `/auth/logout` | cookie | |
| POST | `/auth/verify-email` | — | Body `{ token, password }` |
| POST | `/auth/resend-verification` | — | Body `{ email }` |
| POST | `/auth/forgot-password` | — | Ruling G: identical response either way |
| POST | `/auth/reset-password` | — | |
| GET | `/auth/google` | — | Only mounted when Google OAuth is configured |
| GET | `/auth/google/callback` | — | Backend-handled; redirects to `WEB_URL` |
| GET | `/profile` | Bearer | |
| PATCH | `/profile` | Bearer | `{ firstName?, lastName? }` **only** |
| GET | `/notifications/stream` | `?token=` | SSE; not behind `requireAuth` |
| GET | `/notifications` | Bearer | `?limit=` (default 20, max 100), `?cursor=` |
| PATCH | `/notifications/:id/read` | Bearer | |
| PATCH | `/notifications/read-all` | Bearer | |
| DELETE | `/notifications/:id` | Bearer | |
| GET | `/notifications/preferences` | Bearer | |
| PUT | `/notifications/preferences` | Bearer | |
| POST | `/tenants` | Bearer | Caller becomes sole `owner` |
| GET | `/tenants` | Bearer | Caller's tenants with role |
| GET | `/tenants/:slug` | member | |
| PATCH | `/tenants/:slug` | owner, admin | `slug` is **not** editable |
| GET | `/tenants/:slug/members` | member | |
| POST | `/tenants/:slug/members` | owner, admin | `{ email, role }` |
| PATCH | `/tenants/:slug/members/:userId` | **owner only** | `{ role }` |
| DELETE | `/tenants/:slug/members/:userId` | owner, admin | |
| GET | `/tenants/:slug/settings` | member | |
| PATCH | `/tenants/:slug/settings` | owner, admin | `{ timezone?, locale?, metadata? }` |

**There is no change-password endpoint.** Auth exposes only the routes above, and
`updateProfileSchema` is exactly `{ firstName?, lastName? }` — it rejects unrecognised
keys, including `password`. v1's Profile page specified a change-password form with
nothing to call; it is removed. Adding such an endpoint is a change to the shipped
express-boilerplate and is explicitly out of scope here.

### The user shape

`GET /profile` and `PATCH /profile` both return `toPublicUser(user)`, which is exactly:

```ts
interface User {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: string   // Date on the server, ISO string over the wire
}
```

`login` and `register` return the same projection (`AuthenticatedUser` plus `createdAt`).
The frontend `User` type mirrors this and nothing more.

**There is no auth-provider data on the API.** An `auth_providers` table and model exist
server-side, but no route, controller or serializer exposes them — `PublicUser` has five
fields and none of them is a provider list. v1 of this spec, and the 2026-09-21 revision
before this correction, both specified "auth providers listed" on the Profile page. There
is nothing to list. Surfacing them would require a new endpoint on express-boilerplate,
which is out of scope for the same reason the change-password endpoint is.

### Validation mirrors

The frontend Zod schemas mirror the backend's exactly, so a form rejects locally what the
API would reject remotely:

- Password: min 8 (`MIN_PASSWORD_LENGTH`). Login, verify-email and reset-password compare
  against a stored hash and therefore apply **no** policy beyond "required".
- Email: max 320 (`MAX_EMAIL_LENGTH`), trimmed and lowercased.
- First/last name: trimmed, 1–100 (`MAX_NAME_LENGTH`), optional.
- Tenant name: 1–255. Description: ≤1000. Logo: ≤255. Website: ≤255.
- Tenant slug: trimmed, 3–100, `/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/`, and not one of the
  reserved slugs. Mixed case is **rejected, not lowercased** — the slug is a routing
  identifier, so silently rewriting it would hand the caller a different tenant than the
  one they typed.
- Reserved slugs: `admin api app auth login logout register signin signup settings
  billing support help docs status health static assets public cdn www mail ftp blog
  about contact terms privacy dashboard root system null undefined true false new edit
  delete create update tenants tenant users user members owner me test staging dev
  localhost`

---

## 4. Auth & HTTP Layer

### Zustand auth store

```ts
interface AuthState {
  accessToken: string | null
  user: User | null
  isAuthenticated: boolean
  isBootstrapped: boolean
  login: (token: string, user: User) => void
  logout: () => void
  setToken: (token: string) => void
}
```

The access token lives **in memory only** — never `localStorage`. The refresh token is an
httpOnly cookie the backend owns, scoped to `Path=/api/v1/auth`, `SameSite=Strict`
(`Lax` for the OAuth callback alone).

`isBootstrapped` replaces v1's `isLoading` and means something specific: the one-time
session restore below has settled. Route guards read it; nothing else does.

### One session mechanism

The bootstrap below and the interceptor's refresh in the next subsection are **the same
function**, not two. `ensureSession()` owns a single module-level promise: if a refresh is
already in flight, every caller awaits that one; otherwise it starts one. It resolves to a
fresh access token or rejects after logging out. Bootstrap, the 401 interceptor, and the
SSE reconnect path are its three callers.

This matters because the backend *rotates* the refresh token on every call
(`auth.controller.ts:519`, `rotated`): two concurrent refreshes mean the second presents an
already-consumed token and the session dies. One promise is what prevents that.

### Session bootstrap on load

Because the token is memory-only, **every page reload starts unauthenticated**. v1's
guards — `_app` redirects to `/login` when unauthenticated, `_auth` redirects to
`/dashboard` when authenticated — would both misfire on reload, bouncing a signed-in user
to the login page.

A single module-level bootstrap promise resolves this:

1. `POST /auth/refresh` — the cookie rides along automatically.
2. On success, `GET /profile`, then `login(accessToken, user)`.
   `/auth/refresh` returns `{ accessToken }` and **no user**, so the profile call is not
   optional. v1's OAuth callback description omitted it.
3. On failure, `logout()`.
4. Either way, set `isBootstrapped`.

It is awaited in the **root route's `beforeLoad`**, not a `useEffect`, so no guard ever
observes a half-populated store. It runs at most once per page load; concurrent callers
await the same promise.

### Axios interceptors

**Request:** attach `Authorization: Bearer <accessToken>` from the store when present.

**Response:** on `401` whose body carries `code === 'ACCESS_TOKEN_EXPIRED'`:

1. Call `POST /auth/refresh`.
2. Store the new access token.
3. Replay the original request once.
4. If the refresh itself fails: `logout()` and redirect to `/login`.

Step 1 is `ensureSession()`, so N requests 401-ing concurrently produce exactly one
refresh. A request that has already been retried once is never retried again.

### Logout

`POST /auth/logout` (the cookie rides along — its `Path=/api/v1/auth` covers this route),
then `logout()` on the store, then redirect to `/login`. The store is cleared even if the
request fails: a user who clicked logout must end up logged out locally regardless of what
the network did. The SSE connection closes as a consequence of the token clearing.

### SSE notifications

`EventSource` to `/api/v1/notifications/stream?token=<accessToken>` — a query parameter
because `EventSource` cannot set an `Authorization` header, which is precisely why that
route sits ahead of `requireAuth` and authenticates itself.

**The connection must be rebuilt when the token changes.** v1 said EventSource
"reconnects automatically (EventSource built-in)". Against this backend that is wrong:
`notification-stream.controller.ts:81` rejects an expired `?token=` with
`ACCESS_TOKEN_EXPIRED`, and EventSource's built-in retry re-requests the **same URL** —
the same expired token — forever. The hook therefore:

- keys the `EventSource` on the current `accessToken` and tears down / recreates on change;
- on `error`, closes the connection, then calls `ensureSession()` and reconnects with
  whatever token that resolves to, under exponential backoff (1s doubling to a 30s cap,
  reset on a successful message);
- writes incoming events into the TanStack Query cache via `queryClient.setQueryData`;
- closes on unmount.

**The `error` handler cannot simply stop.** An `EventSource` `error` event carries no
status code, so the hook cannot distinguish an expired token from a dropped Wi-Fi
connection. Stopping and waiting for the token to change would leave notifications
silently dead until the next expiry — typically fifteen minutes — for what may have been a
one-second blip. Routing every error through `ensureSession()` handles both: an expired
token gets refreshed, a transient failure gets the same valid token back, and a genuinely
dead session logs out. Backoff is what keeps a hard-down backend from becoming a
reconnect loop.

---

## 5. Project Structure

```
src/
├── components/
│   ├── ui/              ← primitives (Phase A: shadcn CLI; Phase B: StyleSeed + 4 shadcn)
│   ├── layouts/         ← auth-layout, app-layout
│   └── features/        ← notification-bell, tenant-switcher, theme-toggle
├── pages/               ← TanStack Router file-based routes
│   ├── __root.tsx       ← providers, Toaster, devtools, bootstrap beforeLoad
│   ├── index.tsx        ← redirect to /dashboard or /login
│   ├── _auth.tsx        ← unauthenticated layout route
│   ├── _auth/
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── forgot-password.tsx
│   │   ├── reset-password.tsx
│   │   └── verify-email.tsx
│   ├── _app.tsx         ← authenticated layout route
│   ├── _app/
│   │   ├── dashboard.tsx
│   │   ├── profile.tsx
│   │   ├── notifications.tsx
│   │   └── tenants/
│   │       ├── index.tsx           ← tenant list + create
│   │       ├── $slug.tsx           ← LAYOUT: header + tabs, renders <Outlet />
│   │       ├── $slug.index.tsx     ← overview tab
│   │       ├── $slug.members.tsx   ← members tab
│   │       └── $slug.settings.tsx  ← settings tab
│   └── auth/
│       └── callback.tsx  ← Google OAuth landing
├── hooks/               ← use-auth, use-notifications, use-theme, use-sidebar
├── queries/             ← auth, profile, notification, tenant query/mutation hooks
├── states/              ← auth.store, theme.store, sidebar.store
├── http/                ← client.ts, interceptors.ts, bootstrap.ts
├── schemas/             ← auth, profile, tenant Zod schemas
├── types/               ← api.types.ts
├── styles/              ← globals.css
├── constants/           ← routes.ts, roles.ts
├── lib/                 ← utils.ts (cn)
├── router.ts
├── routeTree.gen.ts     ← generated
└── main.tsx
```

---

## 6. Pages

### Auth pages (`_auth` layout)

Centered card. Redirect to `/dashboard` if authenticated — but only once
`isBootstrapped` is true.

**Login** (`/login`) — email + password; "Forgot password?" link; a Google anchor to
`/api/v1/auth/google`, rendered only when OAuth is configured. **Reads `?error=` from the
URL** and surfaces it as a toast: the backend redirects here with
`?error=google_auth_failed` or `?error=<code>` when OAuth fails. v1 had no error handling
on this route at all.

**Register** (`/register`) — email, password, first name, last name; password strength
indicator. On success: "Check your email for a verification link", plus a **resend**
control calling `POST /auth/resend-verification`. That endpoint ships and v1 gave it no UI.

**Forgot password** (`/forgot-password`) — email only. Identical confirmation message
whether or not the address exists (Ruling G).

**Reset password** (`/reset-password?token=`) — new password + confirm.

**Verify email** (`/verify-email?token=`) — token from the URL **plus the account
password**, which the backend requires and does not treat as optional. On failure, offers
the same resend control as the register-success state.

**OAuth callback** (`/auth/callback`) — no chrome, just a spinner. It does **not** call
`/auth/refresh` itself: the root `beforeLoad` bootstrap has already run by the time this
route mounts, and the backend has already set the refresh cookie (`SameSite=Lax` for this
hop specifically). A second refresh here would rotate the cookie again for nothing. The
page reads the hydrated store and redirects to `/dashboard`, or to `/login` with an error
toast if bootstrap did not produce a session.

### App pages (`_app` layout)

Redirect to `/login` if unauthenticated, once `isBootstrapped` is true.

**Dashboard** (`/dashboard`) — welcome card naming the user. Deliberately thin; derived
projects fill it. It does **not** show a "current tenant": no such concept exists outside
a `/tenants/$slug` URL (see §7).

**Profile** (`/profile`) — edit first and last name (the only two mutable fields). Email
and member-since read-only. **No auth-provider list and no change-password form** — see
below; neither has a data source.

**Notifications** (`/notifications`) — cursor-paginated list (`?cursor=`, `?limit=`,
default 20, max 100). Mark read, mark all read, delete, preferences. Live updates via SSE.
Optimistic updates on mark-read and delete.

**Tenants** (`/tenants`) — list with role badges; create form with live slug validation
mirroring §3.

**Tenant detail** (`/tenants/$slug`) — `$slug.tsx` is a **layout route**, not a leaf: it
renders the tenant header and the tab bar, then an `<Outlet />`. The three tabs are real
child routes, so each is linkable and reload-safe:

| Tab | Route | File |
|---|---|---|
| Overview | `/tenants/$slug` | `$slug.index.tsx` |
| Members | `/tenants/$slug/members` | `$slug.members.tsx` |
| Settings | `/tenants/$slug/settings` | `$slug.settings.tsx` |

The tenant is loaded once in `$slug.tsx`'s loader and shared by all three; the member and
settings forms gate their controls on the matrix in §7. A 404 from `resolveTenant` —
which is returned identically for "no such tenant" and "you are not a member" (Ruling G)
— renders a not-found state, never an error boundary.

---

## 7. Tenancy & Roles

### Tenant scope is the URL

Every tenant-scoped route resolves its tenant from the `:slug` **path parameter**
(`resolveTenant()` defaults to `from: 'param'`). The `X-Tenant-Id` header exists as a
constant but `tenant.middleware.ts:68` marks it *"reserved for a future"* and **no route
reads it**.

The TenantSwitcher is therefore a **navigation dropdown** that routes to
`/tenants/$slug`. It sets no header and there is no client-side "current tenant" store.
v1 specified the switcher as setting `X-Tenant-Id` on the HTTP client, which would have
been a silent no-op.

### Roles

Five, in descending order of authority: `owner`, `admin`, `manager`, `editor`, `viewer`.
A newly added member defaults to `viewer`. v1 referred to four.

### Actor → target matrix (verbatim, `tenant.controller.ts:116–119`)

| Actor \ Target | owner | admin | manager / editor / viewer |
|---|---|---|---|
| **owner** | self only | yes | yes |
| **admin** | no | no | yes |

`manager`, `editor` and `viewer` never reach these endpoints and are omitted from the
table for that reason; the UI treats them as read-only.

Three rules the matrix alone does not express, all of which the UI must honour:

1. **Role change is owner-only.** `PATCH /tenants/:slug/members/:userId` is gated
   `requireRole('owner')`. An admin cannot change any role, including a viewer's.
   Removal, by contrast, is owner + admin.
2. **Granting to a new member is a different rule** (`canActorGrantRole`): an owner may
   grant any role; an admin may grant anything **except** `owner` and `admin`.
3. **Last-owner guard.** An owner acting on their own membership is refused when they are
   the only owner. The UI disables the control and explains why rather than letting the
   request 4xx.

These live in `src/constants/roles.ts` as pure predicates mirroring the backend, and are
unit-tested against the same cases.

---

## 8. Layouts

**AuthLayout** — centered card, logo, full-width on mobile and `max-w-md` above. Dark mode.

**AppLayout** — sidebar (tenant switcher, nav to Dashboard / Notifications / Tenants, user
menu with Profile, theme toggle, logout) plus a header (sidebar toggle, breadcrumbs,
notification bell with unread badge). Sidebar collapses to icons below `md`. The SSE
connection is established here and torn down on unmount.

---

## 9. UX, Accessibility & Quality Floor

These are **Phase A acceptance criteria**, not aspirations — each is checked in §11.

- **Feedback.** Sonner toasts for every mutation outcome. Skeletons while fetching,
  spinners on submit, driven by `isPending`. Optimistic updates for mark-read and delete.
- **Forms.** Inline errors under each field, mapped from the envelope's `errors`.
  Submit disabled while pending. Server-side field errors reconcile with client validation.
- **Keyboard.** Every interactive element reachable by Tab, in visual order, with a
  **visible focus indicator**. Focus trapped in dialogs and sheets, restored on close.
- **Screen readers.** Radix primitives carry the ARIA roles and relationships. Toasts and
  form errors announce via live regions. Icon-only controls carry accessible names.
- **Contrast.** WCAG 2.2 AA for text and interactive states, in both themes.
- **Motion.** `prefers-reduced-motion: reduce` honoured — transitions reduced to
  near-instant, no non-essential animation.
- **Responsive.** Usable to 320px with no horizontal page scroll. Touch targets ≥44px.
  Member tables scroll horizontally rather than overflowing.
- **Theming.** Light / dark / system via a class on `<html>`, persisted to
  `localStorage`. Applied by a small blocking inline script in `index.html` that runs
  before the bundle loads — the Zustand store rehydrates from the same key afterwards.
  Without that script the page paints light, then flips, on every load for dark-mode
  users. `prefers-color-scheme` is the fallback when no preference is stored.

---

## 10. Linting & Formatting

`eslint.config.js` (flat), ESLint 10, composing `@eslint/js`, `typescript-eslint`,
`eslint-plugin-react-hooks@7`, `eslint-plugin-react-refresh`, `eslint-plugin-tailwindcss`,
and `eslint-config-prettier` last.

Three settings are load-bearing and were verified against a live fixture, not documentation:

1. **The config key is `configs.recommended`.** `eslint-plugin-tailwindcss@4.4.0` exports
   exactly one config key; `configs['flat/recommended']` is **undefined** and using it
   throws `TypeError: Config (unnamed): Unexpected undefined config at user-defined index 0`.
   The plugin's own README hedges with `configs['flat/recommended'] || configs.recommended`
   for this reason.
2. **`cssConfigPath` is mandatory** and points at `./src/styles/globals.css`. With it set,
   the plugin resolves classes through the Tailwind compiler, so `@theme`-defined tokens
   (`bg-sidebar`, `text-sidebar-accent`) validate cleanly and need **no whitelist**. Only
   genuinely unknown classes are flagged.
3. **`tailwindcss/classnames-order` is disabled.** `prettier-plugin-tailwindcss` already
   sorts classes; running both gives two sorters that disagree. Prettier is the single
   sorter and its Tailwind plugin stays **last** in the `plugins` array.

The plugin's defaults already cover this stack: `functions` includes `cn`, `clsx`, `cva`
and `twMerge`; `ignoredKeys` includes `defaultVariants` and `compoundVariants`.

`src/components/ui/**` is **excluded** from the Tailwind plugin — those files are vendored
from shadcn/StyleSeed, and linting them churns the diff on every upstream re-add.
`src/routeTree.gen.ts` is excluded from linting and formatting entirely.

```js
import tailwindcss from 'eslint-plugin-tailwindcss'

// …
tailwindcss.configs.recommended,
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/components/ui/**', 'src/routeTree.gen.ts'],
  settings: { tailwindcss: { cssConfigPath: './src/styles/globals.css' } },
  rules: { 'tailwindcss/classnames-order': 'off' },
},
```

---

## 11. Testing

Vitest 5 + Testing Library + MSW 2 against jsdom. **No test performs real HTTP.**

Required coverage:

- **Auth store** — login, logout, setToken, `isBootstrapped` transitions.
- **Bootstrap** — restores a session from the cookie; clears state when refresh fails;
  runs once under concurrent callers.
- **Interceptor** — refreshes and replays on `ACCESS_TOKEN_EXPIRED`; **fires exactly one
  refresh for N concurrent 401s**; never retries a request twice; logs out when refresh
  fails.
- **SSE hook** — rebuilds the connection when the token changes; stops on error rather
  than looping; writes events into the query cache.
- **Forms** — render, validate, submit, and map server field errors for login, register
  and the tenant create form.
- **Guards** — unauthenticated users are redirected away from `_app`; authenticated users
  are redirected away from `_auth`; neither fires before bootstrap settles.
- **Role predicates** — the full §7 matrix, both grant rules, and the last-owner guard.
- **Accessibility** — an automated `jest-axe` pass over each page's default state,
  asserting no violations; keyboard traversal and focus restoration on one dialog.

`package.json` gains a `typecheck` script (`tsc --noEmit -p tsconfig.app.json`); the
current file has no such script and `build` is the only thing that type-checks today.

CI (`.github/workflows/ci.yml`) runs `pnpm lint`, `pnpm typecheck`, `pnpm test` and
`pnpm build` on pull requests, on Node 24 with pnpm caching, mirroring
express-boilerplate's parallel-job layout.

---

## 12. Docker & nginx

Multi-stage: `node:24-alpine` with corepack + `pnpm install --frozen-lockfile` →
`pnpm build`; then `nginx:alpine` serving `dist/`.

`nginx.conf` must contain all four of:

- `try_files $uri /index.html` for SPA routing;
- `location /api/` → `proxy_pass http://api:4040;` with **no** URI rewrite (§1.2);
- `proxy_set_header X-Forwarded-Proto $scheme` (§1.3);
- a dedicated `location /api/v1/notifications/stream` with `proxy_buffering off`,
  `proxy_read_timeout` raised, and `Connection ''` (§1.4).

Plus gzip and long-lived cache headers on hashed assets, `no-store` on `index.html`.

---

## 13. Environment

```
VITE_API_URL=/api/v1
VITE_ENABLE_DEVTOOLS=true
```

`VITE_GOOGLE_OAUTH_URL` is removed — the Google control is a same-origin anchor (§1.1).
Only `VITE_`-prefixed variables reach client code.

---

## 14. Phase B — StyleSeed design layer

StyleSeed v4.2.0 (`github.com/bitjaru/styleseed`) is a design-method engine built **on top
of** shadcn/ui conventions — the same Radix primitives and CVA patterns — so it layers onto
this stack rather than replacing it. It is **not currently installed**:

```
/plugin marketplace add bitjaru/styleseed
/plugin install styleseed@styleseed
```

### Setup decisions (pinned here, not re-asked)

`ss-setup` is a seven-decision wizard. For this project the answers follow from the
product job and are fixed by this spec:

| Decision | Value | Why |
|---|---|---|
| Surface adapter | desktop/mobile product | An authenticated web console |
| Output grammar | `operations-console` | Tenant administration, dense forms and tables |
| Page types | dashboard, form, list, detail, settings | The §6 inventory |
| Brand recipe | `auto` | The maintained mapping fits the grammar |
| Palette recipe | `auto` | Same |
| Aesthetic profile | `none` | A base must not impose a look |
| Brand colour | the palette's default primary | See below |

**A boilerplate must stay neutral.** `ss-setup` normally locks a real brand colour; doing
that here would push one product's identity onto every derived project. The base ships the
palette's default primary, and derived projects re-run `/ss-setup` with their own brand.
Light/dark and surface temperature (`neutral`) are set at the base and overridable.

### Token ownership

**StyleSeed owns `src/styles/globals.css`.** `shadcn init` also generates an OKLCH palette;
only one can own the file, and the generated shadcn palette is discarded. Components
consume tokens; they never hard-code colour.

### Primitives

StyleSeed ships 33 primitives in `engine/components/ui/` and 16 composed patterns. Across
all 49 files, **`ui/form.tsx` is the only one importing `react-hook-form`**.

Per the Phase A decision, **TanStack Form stays** and `form.tsx` is replaced with a
TanStack-backed equivalent preserving the same export surface — `Form`, `FormField`,
`FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`, `useFormField`.
Only `Form`, `FormField` and `useFormField` have react-hook-form internals; the rest are
presentational and carry over unchanged. `react-hook-form` and `@hookform/resolvers` are
**not** dependencies of this project.

StyleSeed ships no `sidebar`, `breadcrumb`, `sonner` or `command`. Those four come from
the shadcn CLI. **The primitive source is 32 from StyleSeed + 4 from shadcn.**

`shadcn add sidebar` additionally pulls `button`, `separator`, `sheet`, `tooltip`,
`input`, `skeleton` and `use-mobile` as registry dependencies — six of which StyleSeed
already provides. StyleSeed's versions win; only `use-mobile` and `sidebar.tsx` itself
are kept from that install, and `sidebar.tsx` is re-pointed at the StyleSeed primitives.
Left unchecked this silently overwrites six styled primitives with unstyled shadcn
defaults.

StyleSeed's own scaffold targets React 18, Vite 6, TypeScript 5.5 and individual
`@radix-ui/react-*` packages. **The primitives are adopted; the scaffold is not.** All 33
are free of `React.forwardRef`, so they are React 19-clean as written.

### Gate chain

Each page runs `ss-lint` → `ss-a11y` → `ss-audit` → `ss-score` → `ss-verify`, with
evidence recorded under `.styleseed/evidence/`. `ss-verify` renders and screenshots the
route, which requires Playwright (or the claude-in-chrome MCP). **Playwright is a
Phase B devDependency and the render gate runs locally, not in CI** — CI keeps the Phase A
checks in §11, which need no browser.

### frontend-design

The `frontend-design` skill is scoped to distinctive, per-client visual identity. That is
the wrong mandate for a shared base, whose tokens must stay neutral and re-skinnable. It
applies to **derived projects and showcase surfaces**, not to this boilerplate's base
layer. Its quality floor — responsive to mobile, visible keyboard focus, reduced motion
respected, accessible contrast — is already binding here as §9.

---

## 15. Out of scope

- Server-side rendering (SPA only, matching the production frontends)
- E2E tests (Playwright enters in Phase B for render gating only)
- i18n / localization
- PWA / service worker
- Analytics integration
- Admin panel
- File upload / media management
- **A change-password endpoint** — that is a change to express-boilerplate (§3)
- **An auth-providers endpoint** — the table exists server-side but nothing exposes it (§3)
- **CORS support in express-boilerplate** — the same-origin decision in §1 removes the need

---

## Appendix A — What changed from the 2026-09-17 revision

Every item was verified against express-boilerplate @ `d5979b2` or the npm registry.

### Wrong about the backend

| v1 said | Actually | Evidence |
|---|---|---|
| `VITE_API_URL` absolute, *and* a Vite `/api` proxy | No CORS middleware, no `cors` dep; the two halves contradict | `src/app.ts` |
| TenantSwitcher sets `X-Tenant-Id` | Header reserved, unread; scope is the `:slug` param | `tenant.middleware.ts:68,87` |
| Profile has a change-password form | No endpoint; `updateProfileSchema` is `{firstName?,lastName?}` | `auth.routes.ts`, `profile.validators.ts:69` |
| OAuth callback: refresh → store → redirect | `/auth/refresh` returns `{accessToken}` only, no user | `auth.controller.ts:525` |
| EventSource reconnects automatically | Retries the same expired token forever | `notification-stream.controller.ts:81` |
| Four roles | Five: owner, admin, manager, editor, viewer | `tenant.constants.ts:42` |
| Profile lists auth providers | No endpoint exposes them; `PublicUser` has 5 fields | `auth.controller.ts:92,104` |

### Missing entirely

Session bootstrap on reload; single-flight refresh against cookie rotation
(`auth.controller.ts:519`); OAuth `?error=` handling on `/login`; resend-verification UI;
the response envelope; the role matrix and its three extra rules; the nginx SSE and
`X-Forwarded-Proto` requirements.

### Stack corrections

`typescript` pinned `~6.0.3` — no typescript-eslint release supports TS 7;
`@tanstack/zod-form-adapter` removed (dead against Form v1's Standard Schema support);
`TanStackRouterVite` → `tanstackRouter`; React Compiler via `react({ compiler: true })`;
`@testing-library/dom` added as an explicit peer; `eslint-plugin-react-compiler` excluded.

### Added

`eslint-plugin-tailwindcss@4.4.0` with the three verified settings in §10; the §9
accessibility floor as testable criteria; Phase B.

## Appendix B — Why the 2026-09-17 plan must be regenerated

`docs/superpowers/plans/2026-09-17-react-rebuild.md` cannot be hand-patched safely:

- Task 1 Step 1 installs `@tanstack/zod-form-adapter`, which is dead.
- Task 1 Step 3 runs `shadcn add form`, whose registry entry declares `react-hook-form`
  and `@hookform/resolvers` — the exact packages Step 1 removes. It also adds `toast`
  alongside `sonner`.
- Task 1 installs everything at `@latest`, which would pull TypeScript 7 and break
  type-aware linting.
- Task 1 Step 2 imports `TanStackRouterVite` and omits `target`.
- Step 9 edits `eslint.config.mjs`; the file is `eslint.config.js`.
- No step deletes `yarn.lock` despite the plan mandating pnpm.
- Task 3 Step 5 builds the `X-Tenant-Id` header seam that no route reads.
- Task 3 Step 2's "fetches user profile on mount" is not the bootstrap in §4.
- Nothing covers single-flight refresh, SSE token rotation, or the §9 criteria.
