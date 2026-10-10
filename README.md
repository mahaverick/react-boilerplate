# React Boilerplate

A React 19 + TypeScript single-page app, built to talk to the
`express-boilerplate` API. Session handling, routing guards, forms, tenant
management and a live notification stream are already wired up; the intent is
that a new project starts here rather than at `create-vite`.

## Stack

| Concern | Choice                                                    |
| ------- | --------------------------------------------------------- |
| Build   | Vite 8, React Compiler via Babel                          |
| Routing | TanStack Router, file-based from `src/pages/`             |
| Data    | TanStack Query, axios with a single-flight refresh        |
| Forms   | TanStack Form + Zod v4 schemas                            |
| State   | Zustand (`src/states/`)                                   |
| UI      | Tailwind v4, shadcn components on Base UI, lucide, sonner |
| Tests   | Vitest, Testing Library, MSW, jest-axe, Playwright        |

## Prerequisites

- **Node 24** and **pnpm 12** (`npm i -g corepack@0.36.0 && corepack enable` — pnpm's version comes from `packageManager` in package.json; Node 25+ does not ship Corepack, so this works on 24 and 26 alike). `pnpm install` refuses an older Node.
- The **API running on `:4040`** — see below
- **Express version:** react 1.8 and later need **express 2.0.0 or later**:
  leaving a tenant and signing out other sessions use routes added in 2.0.0,
  and against 1.x a leave would wrongly report that you had already left.
  React 1.7 and earlier were built against express 1.x and work with its last
  release, 1.9.0.
- **The members page reads two things that need express 2.1.0 or later**: the
  `member_not_found` code on a role change or removal whose member is already
  gone, and `user.active` on the platform tenant's member list, which the
  last-owner check counts as express does (only active owners there; every
  owner on a customer tenant). Against an older express it falls back to the
  404's `Member not found` message and counts every platform owner as active,
  and express's 409 still refuses a leave, removal or demotion that would
  leave the platform tenant with no active owner, or a customer tenant with
  no owner (a deactivated one still counts there).

## Getting started

```bash
pnpm install
pnpm dev
```

The dev server listens on <http://localhost:5173>. There is no required
`.env` step: the only `VITE_*` variables are the optional analytics settings
in `.env.example`, which the dev server serves as `/runtime-config.js` — see
[Environment](#environment).

### The API must be running on :4040

The dev server proxies `/api` to `http://localhost:4040` (`vite.config.ts`).
Nothing that touches the backend works without it — sign-in, the session
bootstrap on page load, and the notification stream all fail immediately.

That proxy is not a convenience. The API path is a **relative** one
(`/api/v1`) because the SPA and the API are served from one origin, which is
the only topology this app supports (see [Deploying](#deploying)). In
development that origin is the Vite proxy; in the container it is nginx.

### The API prefix is fixed

`/api/v1` is not configurable, and there is no environment variable that
moves it. It is written once, as `API_PREFIX` in `src/constants/routes.ts`,
and everything on the JavaScript side derives from it: the axios base
(`src/http/client.ts`), the notification stream's `fetch` URL
(`src/hooks/use-notifications.ts`, which ignores axios entirely), and the
Google OAuth anchor (`GOOGLE_OAUTH_PATH`).

`nginx.conf` hardcodes it as well, which is why it is fixed rather than a
knob: `location /api/v1/notifications/stream` — its SSE buffering and its
query-stripping log format (defence in depth: the token travels in a header)
hang off that exact prefix. `nginx.conf`'s `location /api/` and the Vite dev
proxy in `vite.config.ts` match only the `/api` segment.

Moving the API to another prefix under `/api` therefore means changing
`API_PREFIX` and that SSE `location` together, in one change; a prefix outside
`/api` also moves `location /api/` and the Vite proxy. Changing `API_PREFIX`
alone sends the notification stream through the general `location /api/`,
which lacks the SSE location's 24h read timeout, its `crit` error log and its
empty `Connection` header.

### Environment

There are no build-time variables: the same image serves every environment.
The container reads its settings at **start**, as environment variables —
`API_UPSTREAM`, where nginx proxies `/api`, and the analytics settings —
listed with their patterns in [Run-time configuration](#run-time-configuration).
`API_UPSTREAM` defaults to `http://api:4040` and must be `scheme://host:port`
with no path, not even a trailing `/` (see
[What `nginx.conf` is doing](#what-nginxconf-is-doing)). Changing any of them
means restarting the container, not rebuilding the image. The dev server
ignores `API_UPSTREAM` (`pnpm dev` always proxies to `http://localhost:4040`)
and reads the analytics settings from `.env` under their `VITE_` names
(`.env.example` lists them).

## Scripts

| Script                | What it does                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`            | Dev server on :5173 with the `/api` proxy                                                                                                                                                                                                  |
| `pnpm build`          | `tsc -b` then `vite build` → `dist/`                                                                                                                                                                                                       |
| `pnpm preview`        | Serve the built bundle locally                                                                                                                                                                                                             |
| `pnpm lint`           | eslint **and** `prettier --check` — both must pass                                                                                                                                                                                         |
| `pnpm typecheck`      | `tsc --noEmit` on `tsconfig.app.json`, then `e2e/tsconfig.json`                                                                                                                                                                            |
| `pnpm test`           | Vitest, single pass                                                                                                                                                                                                                        |
| `pnpm test:coverage`  | Vitest + coverage; fails under 88/82/86/89 % (stmts/branches/funcs/lines). CI runs it                                                                                                                                                      |
| `pnpm test:watch`     | Vitest in watch mode                                                                                                                                                                                                                       |
| `pnpm format`         | `prettier --write`                                                                                                                                                                                                                         |
| `pnpm check:bundle`   | Builds in memory; fails on one JS chunk, first-visit JS over budget or holding posthog-js or `@posthog/core`, the error listener over 1 KB gzipped, or devtools in a chunk. CI runs it                                                     |
| `pnpm lint:docs`      | History phrasing and broken links in markdown and config comments. CI runs it                                                                                                                                                              |
| `pnpm test:e2e`       | Playwright `fixtures` project against the MSW harness; no backend needed. CI runs it                                                                                                                                                       |
| `pnpm test:e2e:live`  | Playwright `live` project; needs express at `E2E_API_ORIGIN` (default :4040); `flags.test.ts` also needs `E2E_FLAGS_SET_CMD` (`<cmd> <key> <value>`; `example_beta_page` on\|off, `example_cta_experiment` control\|bold at 100 % rollout) |
| `pnpm test:e2e:nginx` | Builds the production image and runs the Playwright `nginx` project against it on :8088, started with the run-time settings CI uses; all but the `@no-api` tests need a live API                                                           |
| `pnpm test:contrast`  | axe colour contrast in a real browser, both themes; no backend needed                                                                                                                                                                      |

CI holds eslint to **zero warnings** as well as zero errors
(`pnpm exec eslint . --max-warnings 0`).

## Project structure

```
src/
  components/
    dev/        dev-only tools, mounted from main.tsx
    features/   composed, app-specific pieces (theme toggle, user menu, …)
    layouts/    the auth shell and the app shell
    shared/     app-wide building blocks that are not shadcn output (`<Pii>`)
    ui/         vendored shadcn output — see CLAUDE.md before editing
  configs/      the run-time configuration (`getRuntimeConfig`)
  constants/    routes, roles, app name
  hooks/        use-* hooks
  http/         axios client, interceptors, the single-flight session refresh
  lib/          small helpers with no app knowledge
  observability/analytics/  the PostHog facade (lazy posthog-js, masking, handoff, typed events)
  observability/flags/      flag reads, gating, experiment exposure and `$feature/*` registration
  pages/        TanStack Router file routes (exempt from the kebab-case rules)
  queries/      TanStack Query options and mutations, one file per resource
  schemas/      Zod schemas mirroring the backend validators
  states/       Zustand stores
  styles/       globals.css and the design tokens
  types/        shared API types
scripts/        Node build and lint checks (check-bundle, comment-style, history-patterns, lint-docs), the dev server's /runtime-config.js
docker/         the image's entrypoint scripts and nginx main config, and check-image.sh
tests/
  unit/         Vitest suites, mirroring src/ (plus the accessibility gate)
  mocks/        MSW server and handlers
  fixtures/     shared test data
  setup.ts      Vitest setup
e2e/            Playwright suites and the fixture harness
```

No test file lives under `src/` — eslint rejects one. A test for
`src/http/session.ts` is `tests/unit/http/session.test.ts`.

## Testing

```bash
pnpm test
```

`tests/unit/a11y.test.tsx` is an **accessibility gate**: every routed page — plus
an open dialog and an open sheet, which a default-state sweep never sees — must
come back clean, with no rule disabled to get there. A violation is fixed in the
markup, never suppressed. It runs axe-core over the whole `document`, because
axe treats its page-level rules as inapplicable to anything smaller, and it
asserts the one-`<main>`/one-`<h1>` invariants by hand, because jsdom's selector
engine stops axe evaluating those two rules at all.

It does **not** check colour contrast. Those rules are switched off under jsdom,
which has no layout and no cascade, so a green run says nothing about them.
Contrast is measured in a real browser by `pnpm test:contrast`, and the
`fixtures` e2e project checks layout jsdom cannot see, such as nothing
overflowing the viewport at 390px. See CLAUDE.md's end-to-end section.

## Docker

```bash
docker build -t react-boilerplate .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 react-boilerplate
```

The image builds the bundle with Node and serves `dist/` from the unprivileged
nginx image — as uid 101, on port **8080** — proxying
`/api` to `API_UPSTREAM` — `http://api:4040` unless you set it — so by default
the container expects an **`api` host** on the same network. nginx resolves
the upstream's host when it loads its config, so without it the container
exits with `host not found in upstream`; `--add-host` above is what makes a
standalone smoke test start at all (the proxy itself will answer 502 until a
real API is there). Under compose, name the API service `api` and nothing else
is needed. To point it elsewhere, set the variable at start:

```bash
docker run --rm -p 8080:8080 -e API_UPSTREAM=http://my-api:8080 --read-only --tmpfs /tmp react-boilerplate
```

`API_UPSTREAM` is checked at start: `http://` or `https://`, a host (or a
bracketed IPv6 address) and an optional port — nothing else, not even a
trailing `/`. Any other value stops the container with
`API_UPSTREAM must be scheme://host[:port] with no path, got: …`.

At start the entrypoint renders `nginx.conf` as a template, and it substitutes
`API_UPSTREAM` and nothing else, so nginx's own `$host`, `$scheme` and the
rest are left alone.

The image is built to run on a **read-only root filesystem**. Everything nginx writes
— the rendered config, its pid file, request and proxy temp files — goes under
`/tmp`, so give it a writable `/tmp`: `--tmpfs /tmp` as above, or an
`emptyDir` in Kubernetes. With `--read-only` and no writable `/tmp`, the
container stops at start rather than serving without its config. Logs go to
stdout and stderr.

Extra server config goes in a template: add it as
`/etc/nginx/templates/*.conf.template`. The entrypoint strips only the
`.template` suffix, so the name before it has to end `.conf`, matching what
`docker/nginx.main.conf` includes from `/tmp/nginx/conf.d` on start. A file
placed directly in `/etc/nginx/conf.d` is ignored: `docker/nginx.main.conf`
replaces `/etc/nginx/nginx.conf` and its only server-config include is
`/tmp/nginx/conf.d/*.conf`.

`RUN` steps in an image derived from this one run as uid 101, not root: the
`Dockerfile` never resets the unprivileged base image's `USER`. A step that needs root
privileges has to `USER root` first and `USER 101` again before `CMD`.

No build argument configures an environment: every environment-specific
setting is read at start ([Run-time configuration](#run-time-configuration)).
The three build arguments are per commit — `GIT_SHA` (the release the bundle
reports, `dev` when unset or empty), `POSTHOG_SOURCEMAP_PROJECTS` and
`POSTHOG_CLI_HOST` (where the source maps go; see
[Error tracking](#error-tracking-posthog)). The API prefix is baked in and
fixed — see [The API prefix is fixed](#the-api-prefix-is-fixed) for what has
to change together if it ever moves.

### Run-time configuration

One image, one digest, is built per commit and promoted unchanged through
every environment (`deploy.yml`, then `promote`). Nothing is configured at
build time: no setting is a Vite `VITE_*` value in the production bundle.
Everything that differs between environments arrives when the container
**starts**, as plain environment variables, wherever the container runs —
Kubernetes or not — and whatever secret store the values come from.

| Container env               | Dev `.env`                       | Pattern                                       | Default                  | Meaning                                                                                                 |
| --------------------------- | -------------------------------- | --------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `API_UPSTREAM`              | —                                | `scheme://host[:port]`, no path               | `http://api:4040`        | Where nginx proxies `/api` (see [Docker](#docker)).                                                     |
| `POSTHOG_KEY`               | `VITE_POSTHOG_KEY`               | `phc_` and 8–128 of `A-Z a-z 0-9 _ -`         | empty                    | PostHog project key. Empty: no analytics code loads, every call is a no-op.                             |
| `POSTHOG_UI_HOST`           | `VITE_POSTHOG_UI_HOST`           | an `https://` origin, no path                 | `https://us.posthog.com` | PostHog's UI host, for links posthog-js builds.                                                         |
| `ANALYTICS_CONSENT_MODE`    | `VITE_ANALYTICS_CONSENT_MODE`    | `opt_out`, `required` or `off`                | `opt_out`                | `opt_out`: capture until the user opts out; `required`: the consent banner first; `off`: nothing loads. |
| `ANALYTICS_HANDOFF_ORIGINS` | `VITE_ANALYTICS_HANDOFF_ORIGINS` | comma-separated `https://` origins, no spaces | empty                    | Websites on other domains allowed to hand a visitor off ([how](docs/analytics-handoff.md)).             |
| `APP_ENVIRONMENT`           | `VITE_APP_ENVIRONMENT`           | `[a-z][a-z0-9-]` up to 32                     | `development`            | Sent as `environment` on every browser event and exception. Set it to express's `APP_ENV` value.        |

How it reaches the bundle:

- At start, `docker/10-runtime-config.sh` (in `/docker-entrypoint.d/`, after
  `05-prepare.sh`) checks every value against its pattern. An invalid one
  **stops the container** with `10-runtime-config.sh: POSTHOG_KEY must be …`
  — the message names the variable and never prints the value — so a typo
  fails the rollout instead of quietly switching analytics off. Unset or
  empty means the default.
- It writes `/tmp/runtime/runtime-config.js`
  (`window.__APP_CONFIG__ = Object.freeze({...})`); the root filesystem stays
  read-only. nginx serves it as `/runtime-config.js` with
  `Cache-Control: no-store`, and `index.html` loads it before the bundle.
  Same-origin, so `script-src 'self'` holds.
- The app reads it only through `getRuntimeConfig()`
  (`src/configs/runtime-config.ts`), which applies the same patterns again.
  A production bundle reads nothing else; `pnpm dev`, `pnpm preview` and the
  unit tests read the dev `.env` names from `import.meta.env`, and the dev and
  preview servers serve a matching `/runtime-config.js` from them
  (`scripts/runtime-config-plugin.mjs`).
- A change takes effect when the container restarts; nothing is rebuilt.
  Every value is public — each browser receives `/runtime-config.js` — so
  the PostHog key may come from a secret store but is not a secret.

`docker run`, or a GitHub Actions job using repository secrets:

```bash
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 \
  -e POSTHOG_KEY="$POSTHOG_KEY" -e APP_ENVIRONMENT=staging react-boilerplate
```

Compose:

```yaml
services:
  web:
    image: ghcr.io/<owner>/react-boilerplate:<version>
    read_only: true
    tmpfs: [/tmp]
    environment:
      API_UPSTREAM: http://api:4040
      POSTHOG_KEY: ${POSTHOG_KEY}
      APP_ENVIRONMENT: staging
```

Kubernetes, with the key in a Secret:

```yaml
containers:
  - name: web
    image: ghcr.io/<owner>/react-boilerplate@sha256:<digest>
    securityContext:
      readOnlyRootFilesystem: true
    env:
      - name: APP_ENVIRONMENT
        value: production
      - name: POSTHOG_KEY
        valueFrom:
          secretKeyRef:
            name: react-boilerplate
            key: posthog-key
    volumeMounts:
      - name: tmp
        mountPath: /tmp
volumes:
  - name: tmp
    emptyDir: {}
```

From Google Secret Manager: sync the secret into that Kubernetes Secret with
External Secrets or the Secret Manager CSI driver (the `secretKeyRef` stays
as it is), or on Cloud Run map it straight to the variable
(`--set-secrets=POSTHOG_KEY=posthog-key:latest`). The container only ever
sees an environment variable.

### What `nginx.conf` is doing

Two things in there are load-bearing and fail **silently** if edited away,
and the SSE location's settings are defence in depth. `nginx.conf` explains each at the line; in
short:

- `proxy_pass ${API_UPSTREAM};` carries **no trailing path**, and
  `API_UPSTREAM` must not bring one, not even `/`. A path there makes nginx
  rewrite the URI (`/api/` becomes that path), so express stops matching its
  routes.
- The TLS terminator's `X-Forwarded-Proto` is passed through to express. express
  needs `TRUST_PROXY` set for express-session to see HTTPS and set the Secure
  `oauth.sid` cookie.
- The SSE location sets `proxy_buffering off`, an empty `Connection` header
  and a 24h read timeout. express already turns buffering off per response
  (`X-Accel-Buffering: no`) and sends a `:ping` every 30s by default, inside
  nginx's default 60s read timeout, so these keep the stream open even if
  either of those changes.
- That same location logs with a `stream_nolog` format that records `$uri`
  instead of `$request`, and raises its `error_log` level to `crit`. The access
  token is not in the query string there: the client sends an
  `Authorization: Bearer` header, which never appears in a logged request line.
  Both lines stay as defence in depth, so that a query parameter added to this
  route later cannot quietly reach the access log, or the **error** log — nginx
  puts the full request line and the full upstream URL into every
  `connect() failed` message, which no log format can change. The cost is that
  `error`-level upstream detail for this one location is dropped; the access log
  still records every request and its status.
- `location /api/v1/collect/` is `location /api/` with a 10 MB body limit,
  streamed to express rather than buffered: posthog-js posts a replay batch
  of up to about 6.3 MB in one request (a third more as base64 when gzip is
  unavailable), and nginx's default 1 MB answers it 413. Every other API
  route keeps the default.
- `location = /runtime-config.js` serves the file the entrypoint writes under
  `/tmp`, `no-store` through the same `map` as `index.html`.

Security headers (`Content-Security-Policy`, `Permissions-Policy`,
`Referrer-Policy`, `X-Content-Type-Options`, `X-Frame-Options`,
`Cross-Origin-Opener-Policy`) are set once on the server block with `always`,
and `server_tokens off` drops the nginx version from the `Server` header and
error pages. No location declares an `add_header` of its own, because
one that did would silently drop all of them — `add_header` does not inherit
into a block that sets any header itself. Cache-Control is therefore chosen by
a `map` rather than per-location. **Verify this with `curl -I` against a real
asset, not by reading the config.**

A proxied `/api/` response keeps each of these headers the API already sent
(helmet's own, stricter values, such as its `default-src 'none'` policy and
`X-Frame-Options: SAMEORIGIN`); nginx adds only the ones the API left out, so
none is sent twice. Nginx's own 502 or 504 for an `/api/` request with no
backend carries the full set.

### Content-Security-Policy

nginx sends an **enforced** policy on every response it answers itself:

    default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data:; connect-src 'self'; object-src 'none';
    base-uri 'none'; frame-ancestors 'none'; form-action 'self'

- **No inline script.** The pre-paint theme script — which has to run before
  the bundle, or every dark-mode load flashes light — is the file
  `public/theme-init.js`, loaded by a classic, blocking `<script src>` in
  `index.html`. Keep it a file: an inline `<script>` is blocked by
  `script-src 'self'`, and `'unsafe-inline'` would give away what the policy is
  for. Its name is not content-hashed, so it is served `no-store`, like
  `index.html`.
- **`style-src 'unsafe-inline'`** is there because sonner injects a `<style>`
  element at runtime.
- **`connect-src 'self'`** holds because the API is same-origin: nginx proxies
  `/api`. Calling another origin from the browser means widening it here.
- **Analytics needs nothing added.** posthog-js sends to `/api/v1/collect`
  and loads its replay recorder and extensions from
  `/api/v1/collect/static/…`, both same-origin, and replay starts no worker
  (measured against this image: no `worker` event and no violation). The
  recorder can start a `blob:` worker only to record `<canvas>` content; that
  stays off in the PostHog project's replay settings, because `script-src
'self'` (which `worker-src` falls back to) blocks it.
- The `nginx` Playwright project asserts zero violations: on the sign-in page
  and for the theme script in CI (the `@no-api` tests), and on the signed-in
  app with a live stream and a tenant page locally (`pnpm test:e2e:nginx`).

### Known gaps

- **No HSTS.** Deliberate: this server listens on `:8080` behind a TLS
  terminator. A `max-age` sent over plain HTTP is ignored by browsers and is
  actively wrong if TLS is ever absent. Set it at the edge that terminates TLS.
- **IPv4 only.** `nginx.conf`'s `server` block declares `listen 8080;`, which
  binds `0.0.0.0:8080` and nothing else. IPv6-only clusters need
  `listen [::]:8080;` added to that block — which fails on hosts with IPv6
  disabled, so it is not a change to make unconditionally.

## Analytics (PostHog)

Product analytics, session replay and typed events go to the same PostHog
project as express-boilerplate's server events. Without `POSTHOG_KEY`
none of it exists: posthog-js is loaded with a dynamic `import()`
(`pnpm check:bundle` fails if it reaches the first-visit chunks), and every
call into `src/observability/analytics` is a no-op.

- **Configuration.** `POSTHOG_KEY`, `POSTHOG_UI_HOST`,
  `ANALYTICS_CONSENT_MODE`, `ANALYTICS_HANDOFF_ORIGINS` and `APP_ENVIRONMENT`
  are container environment, read at start
  ([Run-time configuration](#run-time-configuration)); one PostHog project per
  environment is one value per deployment, on the same image. The project is
  the one express's `POSTHOG_PROJECT_KEY` names. Set `POSTHOG_KEY` only once
  the API runs express 1.5.0 or later: on an older API the opt-out switch
  cannot persist and `/api/v1/collect` answers 404.
- **Transport.** Everything goes through the API's `/api/v1/collect` proxy
  (express 1.5.0+), so the browser never talks to PostHog and the CSP is
  unchanged. Each call through the axios client carries a fresh `traceparent`
  and, while capture is on and PostHog holds either nobody or the signed-in
  user, `X-POSTHOG-SESSION-ID`, so server events link to that person's replay
  and never to someone else's.
- **Identity.** The signed-in user is identified by id alone, after the
  session restore and on every sign-in; sign-out, forced or chosen, resets
  first. A page load whose session restore ends signed out forgets any person
  an earlier visit left in the browser, before its first page view, unless
  the restore failed without judging the session (a 502, say) and another
  open tab answers that it is signed in as that person. A token refresh that
  comes back as a different user (another tab signed someone else in) signs
  the tab out instead of carrying on, or replaying a request, as them, and
  that sign-out leaves the shared identity, now the other tab's, alone. Person properties (`is_staff`, `platform_role`, …) and the tenant
  group's name are set only by the server.
- **Page views and the tenant group.** posthog-js's own history page views are
  off; the router captures `$pageview` once each navigation has resolved,
  after putting the events in the tenant's group on a tenant page and taking
  them out of any group on every other page, so a page view never carries the
  previous page's tenant. A reload or a new tab starts with no group: one left
  in storage by another tab is dropped at load. Reaching a different tenant
  than the last one since sign-in sends `tenant_switched`, even with other
  pages in between. On tenant pages the `tenant_access` super property says
  `member` or `platform` (staff through platform access).
- **A website sharing the cookie.** posthog-js adopts the shared identity
  cookie before every event, so a website on a sibling subdomain must never
  call `identify`, `alias`, `reset` or `group`
  ([docs/analytics-handoff.md](docs/analytics-handoff.md)). The app defends
  itself anyway: while a user is signed in, an event under any other distinct
  id is dropped and, 250 ms later if the change still stands, the user is
  identified again; `app`, `environment` and the tenant group are put back on
  events a sibling's reset stripped. Another tab of this app is not a
  sibling to fight: a person it signed in is announced to the other tabs, and
  a tab whose user it replaced drops its events (never identifying over that
  person) and refreshes its session to settle who is signed in. A refresh
  that returns the other person signs that tab out alone; one that returns
  its own user resumes it; a failed one is retried while events keep coming.
  The tab also resumes as soon as the identity cookie holds its user again.
  A sign-out broadcast landing within the 250 ms cancels the repair.
- **The consent banner and page views.** Answering the banner captures the
  page on screen (cookieless after a decline), since its router page view was
  dropped while consent was pending; turning analytics back on in the profile
  does the same.
- **Consent.** In `opt_out` mode the profile's "Share usage analytics" switch
  (`PATCH /profile { analyticsOptOut }`) stops browser capture for that user;
  the API's own events continue. In `required` mode the banner decides and
  the switch can only opt out, or count as consent when turned on. The banner's
  answer belongs to the browser, not the person: consent is per device, so it
  survives sign-out and the next person on a shared browser starts with it.
  Each signed-in user's own opt-out is applied before they are identified, and
  the profile switch or the banner changes it for that browser.
- **Masking.** Inputs are masked in replay; every rendered name, address,
  avatar initial and invitation address is wrapped in `<Pii>`
  (`ph-sensitive ph-mask`); `aria-label`, `title`, `alt`, `placeholder`,
  `data-*` and query-carrying hrefs are masked in replay and never reach
  autocapture; captured URLs keep only the `tab` query key. Typed events
  (`track`) accept fixed keys, numbers and booleans, never a free string.
  The tenant slug is not masked: it appears in the browser's `$current_url`
  and `$pathname` and in the title `$pageview` carries. Staff browsing a
  customer's tenant through platform access put their browser events in that
  tenant's group with `tenant_access = platform`: filter group insights on
  `tenant_access = member` to count customers only (server events carry
  `access: 'platform'`).
- **Guards.** `e2e/fixtures/pii.test.ts` (CI) checks every probe name and
  address on the main pages sits inside `<Pii>`. `e2e/nginx/analytics.test.ts`
  searches everything that reached a fake PostHog, decoded, after a route walk
  that includes `?token=` and `register?email=` URLs.

The `@no-api` half of `e2e/nginx/analytics.test.ts` runs in CI against the
image started with `POSTHOG_KEY=phc_test_key_not_real`, `APP_ENVIRONMENT=ci`
and `ANALYTICS_HANDOFF_ORIGINS=https://www.example.test`, its
`/api/v1/collect` traffic answered by a fake PostHog through Playwright. The
live half needs an express 1.5.0+ behind the image: start express with
`POSTHOG_PROJECT_KEY=phc_test_key_not_real`, `POSTHOG_HOST` and
`POSTHOG_ASSETS_HOST` both `http://127.0.0.1:4063` and
`ANALYTICS_DRAIN_INTERVAL_MS=1000`, run the image with the same three
settings and `API_UPSTREAM` pointing at that express, then
`E2E_LIVE=1 E2E_NGINX=1 E2E_ANALYTICS=1 E2E_NGINX_ORIGIN=<image origin> E2E_API_ORIGIN=<express origin> pnpm exec playwright test --project=nginx e2e/nginx/analytics.test.ts`.
The suite starts the fake PostHog on :4063 itself (`E2E_FAKE_POSTHOG_PORT`
moves it).

## Feature flags

Flags are declared in express-boilerplate's registry, evaluated by express
and read here from three endpoints: `GET /api/v1/tenants/:slug/flags` on a
tenant page, `GET /api/v1/flags` elsewhere, and the matching
`POST …/flags/exposures` for experiments. With flags unconfigured in express,
both reads answer every flag's fallback, so the app behaves as if every flag
were off.

- **Reading.** `useVariant(key)` for a multivariate flag and `useFlagValues()`
  for every flag's value, from `src/observability/flags/flag-hooks.ts`. Each
  shows the fallback while the values load or after a failed read. The `_app`
  loader warms the page's scope, and values refetch on a tenant switch, on
  focus after five minutes and every ten minutes.
- **Gating.** A tenant tab or sidebar item takes `flag` and is hidden while it
  is off; a route's `beforeLoad` calls `requireClientFlag`, which answers not
  found. The API route behind it is gated by express, which is what actually
  refuses.
- **Experiments.** Reading an experiment flag reports its exposure once per
  tab session; express records `$feature_flag_called` when the user matched a
  release condition or is in the holdout. Every browser event
  carries `$feature/<key>` for the metrics.
- **Adding a flag.** Add it to express's registry and run `flags:sync` there,
  then copy its key, kind, variants, fallback and `experiment` into
  `src/observability/flags/flag-keys.ts`, and its fallback into
  `TEST_FLAG_FALLBACKS` (`tests/mocks/handlers.ts`) and the harness's
  `FLAG_FALLBACKS`.

## Maintenance mode

A platform owner switches the product into maintenance from Apex; express
enforces it and this app shows it. The app learns the mode from three
places: the `Maintenance-Mode` header on every API response, a 503 whose
`code` is `MAINTENANCE_MODE` or `READ_ONLY_MODE`, and
`GET /api/v1/status/maintenance`, read once at start and again every
30 to 40 seconds while the mode is `full`.

- **`full`.** Every page, sign-in and sign-up included, is replaced by a
  maintenance screen with the owner's message (as text) and the start time.
  The session and the URL are kept. When the poll sees the mode end, the
  app refreshes the session, runs the route guards again and refetches, so
  the user is back on the page they were on.
- **`read_only`.** A banner sits above every page with the owner's message;
  it collapses, but cannot be dismissed. A write the API refuses says
  "Changes are paused during maintenance." in a toast, and a form keeps what
  was typed.
- **Analytics.** `maintenance_page_viewed` (`{ mode }`) is sent once per tab
  session for each maintenance period, under the usual consent rules.
- **Operating it** is Apex's job: see the Apex and express READMEs for the
  runbook. Nothing here is configured per environment.

## Error tracking (PostHog)

Every crash in the browser becomes one `$exception` in PostHog Error
Tracking, in the project `POSTHOG_KEY` names, symbolicated to the `.ts` and
`.tsx` source. Without `POSTHOG_KEY`, or in consent mode `off`, nothing is
sent.

- **What is caught.** Uncaught errors and unhandled rejections (window
  listeners installed before any other module runs), every error React's
  root sees (`createRoot`'s `onUncaughtError` and `onCaughtError`, so every
  error boundary), and every error screen the router shows (`RouteError`, the
  tenant page's own). A chunk that fails to load is sent as handled, with
  `origin: chunk_load`: it means a deploy left the page behind.
- **What is not.** API errors and network failures (the API reports its own
  5xx), aborts, ResizeObserver noise, opaque cross-origin `Script error.`,
  and any error with no frame from this app's own files (an extension's).
- **Where it goes.** `src/observability/errors/listen.ts` is in the entry
  chunk (under 1 KB gzipped) and only notes errors; the reporter and
  `@posthog/core` load on the first error or when the browser is idle. Events
  go to the API's `/api/v1/collect/batch/`, batched, and by `sendBeacon` when
  the page is hidden. At most 5 per error and 30 per page are sent.
- **Identity.** With analytics consent, an exception carries the user's
  distinct id, the replay session and the tenant group. Without it (opted
  out, consent pending in `required` mode, posthog-js blocked, or analytics
  unsettled after 10 s) it is anonymous: a new distinct id per event and no
  person profile. An earlier anonymous crash is never re-attributed.
- **Scrubbing.** Exception types, values, frame file names and function names
  go through the same rules as express-boilerplate's
  (`src/observability/errors/scrub.ts`, tested against the shared
  `tests/fixtures/error-scrub-vectors.json`): Postgres key details and echoed
  values, URL credentials, query strings, fragments other than line or
  heading anchors, the token segment after `/reset/`, `/verify/`, `/invite/`
  or `/accept/`, Bearer and Basic credentials, Authorization and Cookie
  values, secret-named keys' values, JWTs, emails, PostHog and vendor keys,
  IP addresses, `+`-prefixed phone numbers and long hex and base64 runs are
  replaced, and each text is cut to 1024 characters. URLs keep only the
  analytics allowlist's query keys.
- **Release.** Each exception's `release` is the commit the image was built
  from (`GIT_SHA`); its `environment` is `APP_ENVIRONMENT`.

### What the scrubber does not catch

Regex scrubbing is best-effort; keep secrets out of error messages. The list
is express-boilerplate's (`SECURITY.md`), since the rules are the same. It
does not catch:

- names and other free text;
- ids, UUIDs included: they are identifiers, kept on purpose for debugging;
- national-format phone numbers without a leading `+`;
- a bare opaque word with no key in front of it;
- a `code` value outside a query, a form body or an OAuth or authorization
  context, and a `key` value written with `:`, so `code: 'ECONNREFUSED'` and
  `key: 'user_id'` stay readable (an `oauth` inside any word, `myoauthlib`
  included, counts as OAuth context, so every `code` key in that text goes);
- a bare `response:` followed by unquoted prose (`Unexpected response: 502`);
- an Authorization header on its own, which does not make a `code` on another
  line an authorization code;
- the text after a Bearer or Basic credential on an Authorization line
  (`Bearer [token] extra` keeps `extra`);
- a nested array value past its first `]`;
- a camelCase `pin` (`userPin`);
- a key behind a double-encoded quote or separator (`%2522`, `%253D`) or a
  hex HTML entity (`&#x3D;`), and a `key` after an encoded `&` (`%26key%3D`);
- a URL fragment of lowercase letters and hyphens with no key-like word
  (`#api-key` and `#token-abc` are replaced): under 40 characters, or up to 64
  when each hyphen-joined word has at most 20 letters, which reads as a
  heading, unless another rule would replace part of it (32 or more of the
  letters `a` to `f`, a Slack-style `xoxb-` prefix), when it is replaced whole;
- a kebab- or snake-case run of lowercase words of up to 20 letters each, 40
  or more characters in all, which reads as an identifier;
- vendor tokens with no rule (`ya29.`, `glpat-`, `hf_`, Google `1//` refresh
  tokens);
- a host named like a package ref after `@` (`jane@main`, `jane@npm:`,
  `jane@workspace:`);
- the domain of an email whose local part is a JWT (`[jwt]@example.com`);
- the part before the last `/` of a run joined to an email address's local
  part when the run, with the local part's leading base64 characters, is under
  40 characters or reads as a path rather than base64, counting stopped by a
  `%2F` (`abc/def%2Fghi@example.com` keeps `abc/`), or when it follows an
  address character directly (a letter, digit, `.`, `%`, `+`, `-`, `_`, `/` or
  `@`: `jane@example.com/<secret>@…`, `u.<secret>@…`);
- a quoted value whose key sits inside a URL query that an encoded key's value
  runs into (`secret%3Dhttps://…?a=1/api_key="…"` keeps the quoted value);
- a key name glued to the end of the segment after `/reset/`, `/verify/`,
  `/invite/` or `/accept/`, which goes into `[token]` with the segment and
  leaves the value after it in view (`/app/reset/x.tsrefresh_token = …`
  becomes `/app/reset/[token] = …`);
- the parameters other than secret-named ones of an Authorization or Cookie
  value opened by an escaped quote and a scheme (`\"OAuth username="…",
realm="…"` keeps `username` and `realm`; `oauth_signature`, `oauth_token`,
  `nonce`, `cnonce` and `response` are still redacted);
- the rest of a base64 run that is the domain of an address whose local part
  follows a `/` (`dir/x@wJalr…/K7MDENG/…` keeps `/K7MDENG/…`).

Scrubbing a scrubbed text again changes nothing, except contrived inputs that
glue a phone number, IP address or hex run to one another, put an address with
a quoted local part (`"jane doe"@…`) straight against a URL's or path's query
or fragment, end an address with a `.` straight before a query
(`jane@example.com.?a=1`), or leave a placeholder in quotes straight before an
`@`.

Also unverified by the binary's hash check: the CLI's JavaScript wrapper
(`lib/posthog-api-cli.mjs`), which comes from the npm package, not the download.

### Source maps

The build always writes hidden source maps (no `sourceMappingURL` in any
chunk), and the image's build stage then:

1. injects chunk ids into every chunk with `posthog-cli sourcemap inject`,
   offline and release-less, whether or not maps are uploaded, so one file
   name never holds two contents across builds;
2. uploads the maps to every project in `POSTHOG_SOURCEMAP_PROJECTS`
   (`docker/upload-sourcemaps.sh`), one run per project. The build fails if there
   are no `.map` files under `dist/`, if the CLI skipped a chunk as too large,
   if nothing was uploaded (unless the same output line gives a non-zero
   "already uploaded" or existing count), or if an upload fails;
3. deletes every `.map`, so none ships (`docker/check-image.sh` checks).

nginx also answers 404 for any `.map` URL outside `/api/` (the `.map`
location in `nginx.conf`), even where a file exists. **Any deploy of `dist/`
outside the image must delete `*.map` first.**

The build downloads the `posthog-cli` binary from releases.posthog.com and
verifies its SHA-256 against `docker/posthog-cli.sha256` (one hash per
architecture) before it first runs. **Bumping `@posthog/cli` means updating
those hashes** (the file says how); a mismatch fails the build.

**One-time setup, per repository:**

- Create a PostHog **personal API key** with the error-tracking write scope
  (sourcemap upload) for the organisation, and store it as the repository
  **secret `POSTHOG_CLI_TOKEN`**. It reaches the build as a BuildKit secret:
  never in a layer, an image or the provenance attestation.
- Set the repository **variable `POSTHOG_SOURCEMAP_PROJECTS`** to a
  comma-separated list of project ids, one per environment
  (`12345,67890`). Project ids appear in the image's provenance; they are not
  secrets.
- Optionally set the **variable `POSTHOG_CLI_HOST`** (default
  `https://us.posthog.com`; `https://eu.posthog.com` for EU cloud).

Until the variable is set, `deploy.yml` warns `sourcemaps not uploaded` and
the image builds without uploading: exceptions arrive, unsymbolicated. With
the variable set and the secret missing, the build fails. Maps are uploaded
only when an image is built: a release tag promotes the same digest and
uploads nothing, so **adding an environment's project later means rebuilding**
the image (re-run `deploy.yml` on `main`) before that environment shows
symbolicated frames.

## Deploying

A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml), which
calls `ci.yml` as a gate and, once it passes, builds and pushes
`ghcr.io/<repo>:sha-<commit>` and `:main` to GHCR with an SBOM and build
provenance attestation. The `deploy` job itself is a placeholder — no
deployment target has been chosen yet. A manual `workflow_dispatch` from
another branch only pushes the sha-tagged image — the `:main` tag and the
`deploy` job both run only from `main`.

**Add protection rules to the `production` GitHub Environment**
(Settings → Environments → `production`) — at minimum, required
reviewers — before replacing the placeholder `deploy` step with a real
deployment target. Until then, anything merged to `main` would deploy
unreviewed the moment that step does something real.

**Serve the SPA and the API from one origin.** The image's nginx proxies
`/api` to `API_UPSTREAM`, so the browser only ever calls the origin that
served the page. A split-origin deployment, with the SPA on one host calling
the API on another, is not supported. The API does send CORS headers, for
other frontends, but this app depends on same-origin: its API client uses
relative URLs, its Content-Security-Policy allows `connect-src 'self'` only,
and the refresh cookie is set on whichever origin answers `/api`.

## Releases

Releases are automatic. On every push to `main`,
[release-please](https://github.com/googleapis/release-please) opens a release
PR from the conventional commits since the last release, and
`.github/workflows/release.yml` queues it with `--auto` (or merges it directly
if GitHub refuses auto-merge). With the `main` ruleset below, either way it
merges only once the required checks pass. The next run tags `vX.Y.Z` and
publishes the GitHub Release, and the tag push makes `deploy.yml` promote the image `main` already built and
tested: it adds `:X.Y.Z`, `:X.Y` and `:X` to that same digest rather than
rebuilding. Only `feat`/`fix`/breaking commits cut a release — `chore`, `docs`, `ci`
and the like do not.

Releases use a GitHub App token, from the repo variable
**`RELEASE_APP_CLIENT_ID`** and the secret **`RELEASE_APP_PRIVATE_KEY`**; the
App needs Contents and Pull requests read/write. GitHub never starts workflows
from events `GITHUB_TOKEN` creates, so its release PRs would get no CI and its
tags no image promotion — don't fall back to it.

Three manual steps, once:

- **Create and install the release GitHub App** on this repository, then set
  its client ID as the `RELEASE_APP_CLIENT_ID` variable and its private key as
  the `RELEASE_APP_PRIVATE_KEY` secret. Without them `release.yml` fails.
- **Install the [Renovate GitHub App](https://github.com/apps/renovate).**
  `renovate.json` is inert without it — nothing schedules or opens Renovate
  PRs until the app is installed.
- **Set the merge rules** (Settings → General, then Settings → Rules).
  Enable "Allow auto-merge"; allow squash merging only, with the commit
  title set to the PR title and the commit message left blank; enable
  "Automatically delete head branches"; and add a ruleset on `main`, with no
  bypass list, requiring the checks `lint`, `test`, `e2e`, `docker`,
  `gitleaks` and `pr-title`. Without the ruleset, `release.yml`'s fallback
  merges the release PR without waiting for CI; without the blank squash
  message, each squash body would carry the branch's commit list, which
  release-please reads as extra conventional commits.

With those rules, the squashed commit on `main` is the PR's title alone, not
any of its individual commit messages — so PR titles must themselves be
conventional commits for release-please to read them correctly.

## Conventions

Read [CLAUDE.md](CLAUDE.md) before changing dependencies or adding files.
