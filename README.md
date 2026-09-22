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
| Tests   | Vitest, Testing Library, MSW, jest-axe                    |

## Prerequisites

- **Node 24** and **pnpm 12** (`corepack enable && corepack prepare pnpm@12.4.1 --activate`)
- The **API running on `:4040`** — see below

## Getting started

```bash
pnpm install
pnpm dev
```

The dev server listens on <http://localhost:5173>. There is no `.env` step:
nothing in the app reads a `VITE_*` variable today, and `.env.example` holds
only the comments explaining why — see [Environment](#environment).

### The API must be running on :4040

The dev server proxies `/api` to `http://localhost:4040` (`vite.config.ts`).
Nothing that touches the backend works without it — sign-in, the session
bootstrap on page load, and the notification stream all fail immediately.

That proxy is not a convenience. The API path is a **relative** one
(`/api/v1`) because the backend sends no CORS headers, so the SPA and the API
have to be served from one origin. In development that origin is the Vite
proxy; in the container it is nginx.

### The API prefix is fixed

`/api/v1` is not configurable, and there is no environment variable that
moves it. It is written once, as `API_PREFIX` in `src/constants/routes.ts`,
and everything on the JavaScript side derives from it: the axios base
(`src/http/client.ts`), the `EventSource` URL for the notification stream
(`src/hooks/use-notifications.ts`, which ignores axios entirely), and the
Google OAuth anchor (`GOOGLE_OAUTH_PATH`).

Two things outside JavaScript hardcode it as well, and they are why it is
fixed rather than a knob: `nginx.conf` routes
`location /api/v1/notifications/stream` — its SSE buffering and its
token-stripping log format hang off that exact prefix — and `vite.config.ts`
proxies `/api` in development.

Moving the API to another prefix therefore means changing `API_PREFIX`,
`nginx.conf` and the Vite proxy together, in one change. An earlier
`VITE_API_URL` build variable is gone precisely because it did not: it moved
the axios base alone and left the stream, the OAuth anchor and nginx pointing
at the old path, producing a build in which Google sign-in and every
notification were broken with nothing to say so.

### Environment

`.env` is read at **build** time — Vite inlines `VITE_*` values into the
bundle, so changing one means rebuilding, not restarting. Nothing in the app
currently reads one.

## Scripts

| Script            | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `pnpm dev`        | Dev server on :5173 with the `/api` proxy          |
| `pnpm build`      | `tsc -b` then `vite build` → `dist/`               |
| `pnpm preview`    | Serve the built bundle locally                     |
| `pnpm lint`       | eslint **and** `prettier --check` — both must pass |
| `pnpm typecheck`  | `tsc --noEmit -p tsconfig.app.json`                |
| `pnpm test`       | Vitest, single pass                                |
| `pnpm test:watch` | Vitest in watch mode                               |
| `pnpm format`     | `prettier --write`                                 |

CI holds eslint to **zero warnings** as well as zero errors
(`pnpm exec eslint . --max-warnings 0`).

## Project structure

```
src/
  components/
    features/   composed, app-specific pieces (theme toggle, user menu, …)
    layouts/    the auth shell and the app shell
    ui/         vendored shadcn output — see CLAUDE.md before editing
  constants/    routes, roles
  hooks/        use-* hooks
  http/         axios client, interceptors, the single-flight session refresh
  lib/          small helpers with no app knowledge
  pages/        TanStack Router file routes (exempt from the kebab-case rules)
  queries/      TanStack Query options and mutations, one file per resource
  schemas/      Zod schemas mirroring the backend validators
  states/       Zustand stores
  styles/       globals.css and the design tokens
  tests/        setup, MSW handlers, fixtures, the accessibility gate
  types/        shared API types
```

Tests are co-located beside their subject as `*.test.ts(x)`, except the
cross-cutting ones under `src/tests/`.

## Testing

```bash
pnpm test
```

`src/tests/a11y.test.tsx` is an **accessibility gate**: every routed page — plus
an open dialog and an open sheet, which a default-state sweep never sees — must
come back clean, with no rule disabled to get there. A violation is fixed in the
markup, never suppressed. It runs axe-core over the whole `document`, because
axe treats its page-level rules as inapplicable to anything smaller, and it
asserts the one-`<main>`/one-`<h1>` invariants by hand, because jsdom's selector
engine stops axe evaluating those two rules at all.

It does **not** check colour contrast. Those rules are switched off under jsdom,
which has no layout and no cascade, so a green run says nothing about them.
Contrast, focus rings and the member table's horizontal scroll are browser
checks; automating them is Phase B's Playwright gate.

## Docker

```bash
docker build -t react-boilerplate .
docker run --rm -p 8080:80 --add-host=api:127.0.0.1 react-boilerplate
```

The image builds the bundle with Node and serves `dist/` from nginx, proxying
`/api` to `http://api:4040` — so the container expects an **`api` host** on the
same network. nginx resolves that name when it loads its config, so without it
the container exits with `host not found in upstream`; `--add-host` above is
what makes a standalone smoke test start at all (the proxy itself will answer
502 until a real API is there). Under compose, name the API service `api` and
nothing else is needed.

The image takes no build arguments. The API prefix is baked in and fixed —
see [The API prefix is fixed](#the-api-prefix-is-fixed) for what has to change
together if it ever moves.

### What `nginx.conf` is doing

Four things in there are load-bearing and fail **silently** if edited away.
`nginx.conf` explains each at the line; in short:

- `proxy_pass http://api:4040;` carries **no trailing path**. A path there makes
  nginx rewrite the URI, and the refresh cookie is scoped `Path=/api/v1/auth` —
  token refresh then stops working with nothing in any log.
- `X-Forwarded-Proto` is forwarded, because express reads it for the `secure`
  cookie flag and `TRUST_PROXY`.
- The SSE location sets `proxy_buffering off` (plus HTTP/1.1, an empty
  `Connection` header and a long read timeout). nginx buffers by default, which
  stalls an event stream indefinitely.
- That same location logs with a `stream_nolog` format that records `$uri`
  instead of `$request`, and raises its `error_log` level to `crit`. The access
  token rides in the query string there — `requireAuth` reads only a Bearer
  header and `EventSource` cannot set one — so the default access format would
  write a live token into the log on every connect and every reconnect, and the
  **error** log writes it too: nginx puts the full request line and the full
  upstream URL into every `connect() failed` message, which no log format can
  change. Both were confirmed by curling the running container and reading its
  logs. The cost is that `error`-level upstream detail for this one location is
  dropped; the access log still records every request and its status.

Security headers (`Referrer-Policy`, `X-Content-Type-Options`,
`X-Frame-Options`, `Cross-Origin-Opener-Policy`) are set once on the server
block with `always`. No location declares an `add_header` of its own, because
one that did would silently drop all of them — `add_header` does not inherit
into a block that sets any header itself. Cache-Control is therefore chosen by
a `map` rather than per-location. **Verify this with `curl -I` against a real
asset, not by reading the config.**

### Known gaps

- **No `Content-Security-Policy`.** `index.html` carries an inline script that
  applies the stored theme before first paint — it has to run before the bundle
  or every dark-mode load flashes light. `script-src 'self'` blocks it, and
  `'unsafe-inline'` gives away most of what the header is for. The honest fix is
  a SHA-256 hash of that exact script, regenerated by a build step whenever the
  script changes, and emitted into the nginx config. Shipping a guessed policy
  would be worse than shipping none. **Follow-up, tracked here.**
- **No HSTS.** Deliberate: this server listens on `:80` behind a TLS
  terminator. A `max-age` sent over plain HTTP is ignored by browsers and is
  actively wrong if TLS is ever absent. Set it at the edge that terminates TLS.

## Conventions

`CLAUDE.md` is the short list of decisions that are easy to undo by accident —
what must never be installed, why the access token is memory-only, which
directory is vendored, and which rules the linter enforces. Read it before
changing dependencies or adding files.
