# React Boilerplate

A React 19 + TypeScript single-page app, built to talk to the
`express-boilerplate` API. Session handling, routing guards, forms, tenant
management and a live notification stream are wired up, so a new project starts
here rather than at `create-vite`.

| Concern | Choice                                                    |
| ------- | --------------------------------------------------------- |
| Build   | Vite 8, React Compiler via Babel                          |
| Routing | TanStack Router, file-based from `src/pages/`             |
| Data    | TanStack Query, axios with a single-flight refresh        |
| Forms   | TanStack Form + Zod v4 schemas                            |
| State   | Zustand (`src/states/`)                                   |
| UI      | Tailwind v4, shadcn components on Base UI, lucide, sonner |
| Tests   | Vitest, Testing Library, MSW, jest-axe, Playwright        |

How the code is organised, and why, is in [ARCHITECTURE.md](ARCHITECTURE.md).
The threat model and the defences are in [SECURITY.md](SECURITY.md). The rules
for changing code are in [CLAUDE.md](CLAUDE.md). This file covers running,
configuring, testing and shipping the app.

## Prerequisites

- **Node 24 or later** and **pnpm** at the version `packageManager` in
  `package.json` names. Install Corepack with
  `npm i -g corepack@0.36.0 && corepack enable`; pnpm then comes from
  `packageManager`. Node 25 and later do not ship Corepack, so this works on any
  supported Node. `pnpm install` refuses a Node older than 24.
- **The API running on `:4040`.** See [Getting started](#getting-started).
- **express-boilerplate 2.0.0 or later; 4.0.0 or later is recommended.** 2.0.0 is
  the earliest tag that has every route and body this app sends: leaving a tenant
  (`DELETE /tenants/:slug/membership`) and signing out other sessions
  (`POST /auth/sessions/revoke-others`) arrive in 2.0.0, and every other route it
  calls is older. From 2.1.0 the members page reads the `member_not_found` code on
  a role change or removal whose member is already gone, and `user.active` on the
  platform tenant's member list; against 2.0.x it falls back to the 404's
  `Member not found` message and treats every member as active
  (`src/queries/tenant.queries.ts`). From 4.0.0 a second click on a used
  verification link answers 409 `email_already_verified`, which the verify page
  shows as done; earlier versions answer 400, which it shows as a failed link.

## Getting started

```bash
pnpm install
pnpm dev
```

The dev server listens on <http://localhost:5173>. No `.env` is required: the
only `VITE_*` variables are the optional analytics settings in `.env.example`,
which the dev server serves as `/runtime-config.js` (see
[Run-time configuration](#run-time-configuration)).

The dev server proxies `/api` to `http://localhost:4040` (`vite.config.ts`).
Nothing that touches the backend works without the API: sign-in, the session
bootstrap on page load and the notification stream all fail at once. The proxy
is not a convenience. The SPA and the API are served from one origin, which is
the only topology this app supports (see [Deploying](#deploying)). In
development that origin is the Vite proxy, and in the container it is nginx.

### The API prefix is fixed

`/api/v1` is not configurable, and no environment variable moves it. It is
written once, as `API_PREFIX` in `src/constants/routes.ts`, and `nginx.conf`
hardcodes it too. What has to change together if it ever moves is in
[The HTTP layer and session](ARCHITECTURE.md#the-http-layer-and-session).

## Run-time configuration

One image, built once per commit, is promoted unchanged through every
environment. No setting is a `VITE_*` value in the production bundle. Everything
that differs between environments arrives when the container **starts**, as
plain environment variables, wherever the container runs. Changing one means
restarting the container, not rebuilding the image. The flow from variable to
bundle is in
[The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config),
and why the values are safe to write unescaped is in
[Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

Every variable is optional. When one is unset, its default applies. An empty
value means the default too, except `API_UPSTREAM`: the container refuses an
empty one.

| Container env               | Dev `.env`                       | Pattern                                       | Default                  | Meaning                                                                                                 |
| --------------------------- | -------------------------------- | --------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `API_UPSTREAM`              | none                             | `scheme://host[:port]`, no path               | `http://api:4040`        | Where nginx proxies `/api`. The dev server always proxies to `http://localhost:4040`.                   |
| `POSTHOG_KEY`               | `VITE_POSTHOG_KEY`               | `phc_` and 8–128 of `A-Z a-z 0-9 _ -`         | empty                    | PostHog project key. Empty: no analytics code loads, every call is a no-op.                             |
| `POSTHOG_UI_HOST`           | `VITE_POSTHOG_UI_HOST`           | an `https://` origin, no path                 | `https://us.posthog.com` | PostHog's UI host, for links posthog-js builds.                                                         |
| `ANALYTICS_CONSENT_MODE`    | `VITE_ANALYTICS_CONSENT_MODE`    | `opt_out`, `required` or `off`                | `opt_out`                | `opt_out`: capture until the user opts out; `required`: the consent banner first; `off`: nothing loads. |
| `ANALYTICS_HANDOFF_ORIGINS` | `VITE_ANALYTICS_HANDOFF_ORIGINS` | comma-separated `https://` origins, no spaces | empty                    | Websites on other domains allowed to hand a visitor off ([how](docs/analytics-handoff.md)).             |
| `APP_ENVIRONMENT`           | `VITE_APP_ENVIRONMENT`           | `[a-z][a-z0-9-]` up to 32                     | `development`            | Sent as `environment` on every browser event and exception. Set it to express's `APP_ENV` value.        |

- `docker/10-runtime-config.sh` checks every value against its pattern at start.
  An invalid one **stops the container** and names the variable, never its value,
  so a typo fails the rollout instead of quietly switching analytics off.
  `API_UPSTREAM` is checked by `docker/05-prepare.sh`: no path, not even a
  trailing `/`, or the container stops with
  `05-prepare.sh: API_UPSTREAM must be scheme://host[:port] with no path; the value given does not match (not shown)`.
- `getRuntimeConfig()` (`src/configs/runtime-config.ts`) applies the patterns
  again; the consent mode fails closed
  ([how](SECURITY.md#run-time-config-injection-safety)).
- Every value is public
  ([why](SECURITY.md#run-time-config-injection-safety)); the PostHog key may come
  from a secret store.

The dev server, `pnpm preview` and the unit tests read the `VITE_` names from
`.env` (`.env.example` lists them).

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
External Secrets or the Secret Manager CSI driver (the `secretKeyRef` stays as
it is), or on Cloud Run map it straight to the variable
(`--set-secrets=POSTHOG_KEY=posthog-key:latest`). The container only ever sees an
environment variable.

## Scripts

| Script                | What it does                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`            | Dev server on :5173 with the `/api` proxy                                                                                                                                                                                                  |
| `pnpm build`          | `tsc -b` then `vite build` into `dist/`                                                                                                                                                                                                    |
| `pnpm preview`        | Serve the built bundle locally                                                                                                                                                                                                             |
| `pnpm lint`           | eslint **and** `prettier --check`; both must pass                                                                                                                                                                                          |
| `pnpm lint:docs`      | History phrasing and broken links in markdown and config comments. CI runs it                                                                                                                                                              |
| `pnpm knip`           | Unused files, exports, types and dependencies (`knip.jsonc` lists the ignores and why). CI runs it                                                                                                                                         |
| `pnpm typecheck`      | `tsc --noEmit` on `tsconfig.app.json`, then `typecheck:e2e`                                                                                                                                                                                |
| `pnpm typecheck:e2e`  | `tsc --noEmit` on `e2e/tsconfig.json`                                                                                                                                                                                                      |
| `pnpm format`         | `prettier --write`                                                                                                                                                                                                                         |
| `pnpm test`           | Vitest, single pass                                                                                                                                                                                                                        |
| `pnpm test:coverage`  | Vitest with coverage; fails under 88/82/86/89 % (statements/branches/functions/lines). CI runs it                                                                                                                                          |
| `pnpm test:watch`     | Vitest in watch mode                                                                                                                                                                                                                       |
| `pnpm test:e2e`       | Playwright `fixtures` project against the MSW harness; no backend needed. CI runs it                                                                                                                                                       |
| `pnpm test:e2e:live`  | Playwright `live` project; needs express at `E2E_API_ORIGIN` (default :4040); `flags.test.ts` also needs `E2E_FLAGS_SET_CMD` (`<cmd> <key> <value>`; `example_beta_page` on\|off, `example_cta_experiment` control\|bold at 100 % rollout) |
| `pnpm test:e2e:nginx` | Builds the production image and runs the Playwright `nginx` project against it on :8088, started with the run-time settings CI uses; all but the `@no-api` tests need a live API                                                           |
| `pnpm test:contrast`  | axe colour contrast in a real browser, both themes; no backend needed                                                                                                                                                                      |
| `pnpm check:bundle`   | Builds in memory; fails on one JS chunk, first-visit JS over budget or holding posthog-js or `@posthog/core`, the error listener over 1 KB gzipped, or devtools in a chunk. CI runs it                                                     |
| `pnpm prepare`        | Installs the husky git hooks; `pnpm install` runs it                                                                                                                                                                                       |

CI holds eslint to **zero warnings** as well as zero errors
(`pnpm exec eslint . --max-warnings 0`).

## Testing

```bash
pnpm test
```

Unit tests live under `tests/unit/`, mirroring `src/`. No test file lives under
`src/`: eslint rejects one. A test for `src/http/session.ts` is
`tests/unit/http/session.test.ts`.

`tests/unit/a11y.test.tsx` is an **accessibility gate**: no rule is disabled to
pass it, and a violation is fixed in the markup. What it covers, and why colour
contrast is measured elsewhere, is in [CLAUDE.md](CLAUDE.md#accessibility).

Playwright has four projects in `e2e/`:

| Project    | Command               | Runs against                                        | In CI                    |
| ---------- | --------------------- | --------------------------------------------------- | ------------------------ |
| `fixtures` | `pnpm test:e2e`       | The real router and CSS, with MSW answering; no API | Yes                      |
| `live`     | `pnpm test:e2e:live`  | A real express and its services, with `E2E_LIVE=1`  | No                       |
| `nginx`    | `pnpm test:e2e:nginx` | The production image on :8088                       | Only the `@no-api` tests |
| `contrast` | `pnpm test:contrast`  | The harness, in both themes; no API                 | No                       |

The `live` and `nginx` projects read these variables (defaults in
`playwright.config.ts` and the helpers):

- `E2E_API_ORIGIN` (default `http://localhost:4040`): the express under test.
  Tests read it, never a hardcoded `:4040`.
- `E2E_NGINX_ORIGIN`: the image under test (default `http://localhost:8088`).
- `E2E_FLAGS_SET_CMD`: how `live/flags.test.ts` sets a flag; the test fails
  without it.
- `E2E_MAILPIT_ORIGIN` (default `http://localhost:8025`): the mailpit the helpers
  read verification emails from.
- `E2E_RELEASE` (default `dev`): the release `nginx/errors.test.ts` expects on each
  error report.
- `E2E_ALLOWED_ORIGIN` (default `http://localhost:5173`): the origin
  `nginx/cors.test.ts` sends, which must be in the express's CORS allowlist.

The SSE reconnect test restarts an express, so it runs only by hand, behind a
guard that refuses to touch the main checkout. The steps and the guard's rules
are in [CLAUDE.md](CLAUDE.md#end-to-end-tests).

## Feature flags

express evaluates every flag; this app only reads the values. How is in
[Feature flags](ARCHITECTURE.md#feature-flags), and the rules are in
[CLAUDE.md](CLAUDE.md#feature-flags). To add one:

1. Add it to express's flag registry
   (`express-boilerplate/src/constants/flags.constants.ts`) with `client: true`
   and `react` in `apps`, and run `flags:sync` there. Without both, express never
   sends the flag to this app.
2. Copy its key, kind, variants, fallback and `experiment` into
   `CLIENT_FLAGS` in `src/observability/flags/flag-keys.ts`.
3. Copy its fallback into `TEST_FLAG_FALLBACKS` (`tests/mocks/handlers.ts`) and
   the harness's `FLAG_FALLBACKS` (`e2e/harness/harness.tsx`).

## Analytics (PostHog)

Set `POSTHOG_KEY` to turn analytics on
([Run-time configuration](#run-time-configuration)). Events go through the
API's `/api/v1/collect` proxy, never to PostHog directly. The mechanism is in
[Analytics](ARCHITECTURE.md#analytics) and the privacy rules are in
[Analytics privacy](SECURITY.md#analytics-privacy).

`e2e/nginx/analytics.test.ts` runs against the production image started with
the settings CI uses (`POSTHOG_KEY=phc_test_key_not_real`, `APP_ENVIRONMENT=ci`,
`ANALYTICS_HANDOFF_ORIGINS=https://www.example.test`). Its `@no-api` tests run in
CI with a fake PostHog answering `/api/v1/collect` through Playwright. The live
half needs an express on `:4040` started with
`POSTHOG_PROJECT_KEY=phc_test_key_not_real`, `POSTHOG_HOST` and
`POSTHOG_ASSETS_HOST` both `http://127.0.0.1:4063`, and
`ANALYTICS_DRAIN_INTERVAL_MS=1000`. Then:

```bash
E2E_ANALYTICS=1 pnpm test:e2e:nginx
```

The script builds the image with the settings above, sets `E2E_LIVE` and
`E2E_NGINX` itself, and reaches the express on the host through
`--add-host=api:host-gateway`. The suite starts the fake PostHog on :4063
(`E2E_FAKE_POSTHOG_PORT` moves it). For an express elsewhere, run the image
yourself with `API_UPSTREAM` pointing at it and set `E2E_NGINX_ORIGIN` and
`E2E_API_ORIGIN`.

## Docker

```bash
docker build -t react-boilerplate .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 react-boilerplate
```

The image builds the bundle with Node and serves `dist/` from the unprivileged
nginx image, as uid 101 on port **8080**. It proxies `/api` to `API_UPSTREAM`,
`http://api:4040` unless you set it, so by default the container expects an
**`api` host** on the same network. nginx resolves the upstream's host when it
loads its config, so without one the container exits with
`host not found in upstream`. `--add-host` above is what lets a standalone smoke
test start; the proxy answers 502 until a real API is there. Under compose, name
the API service `api` and nothing else is needed. To point it elsewhere:

```bash
docker run --rm -p 8080:8080 -e API_UPSTREAM=http://my-api:8080 --read-only --tmpfs /tmp react-boilerplate
```

The image is built to run on a **read-only root filesystem**. Everything nginx
writes goes under `/tmp`, so give it a writable one: `--tmpfs /tmp` as above, or
an `emptyDir` in Kubernetes. With `--read-only` and no writable `/tmp` the
container stops at start. Logs go to stdout and stderr. The stages, the
entrypoint order and the nginx locations are in
[The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).

- **Extra server config** goes in a template: add it as
  `/etc/nginx/templates/*.conf.template`. The entrypoint strips only the
  `.template` suffix, so the name before it has to end `.conf`. A file placed
  directly in `/etc/nginx/conf.d` is ignored, because `docker/nginx.main.conf`
  includes only `/tmp/nginx/conf.d/*.conf`.
- **Derived images.** `RUN` steps in an image derived from this one run as uid
  101, not root: the `Dockerfile` never resets the base image's `USER`. A step
  that needs root has to `USER root` first and `USER 101` again before `CMD`.
- **Build arguments** are per commit, not per environment: `GIT_SHA` (the release
  the bundle reports, `dev` when unset or empty), `POSTHOG_SOURCEMAP_PROJECTS` and
  `POSTHOG_CLI_HOST` (where the source maps go; see
  [Source maps](#source-maps)).
- **IPv4 only.** The `server` block in `nginx.conf` declares `listen 8080;`,
  which binds `0.0.0.0:8080`. An IPv6-only cluster needs `listen [::]:8080;`
  added to that block, which fails on hosts with IPv6 disabled, so it is not a
  change to make unconditionally.
- **Headers and CSP.** What nginx sends, and why no location may declare its own
  `add_header`, is in [CSP and headers](SECURITY.md#csp-and-headers). Check
  headers with `curl -I` against a real asset, not by reading the config.

### Source maps

The build writes hidden source maps, and the image's build stage injects chunk
ids, uploads the maps to every project in `POSTHOG_SOURCEMAP_PROJECTS` and
deletes every `.map` so none ships
([Error tracking](ARCHITECTURE.md#error-tracking)). The build fails if there are
no `.map` files under `dist/`, if the CLI skipped a chunk as too large, if
nothing was uploaded (unless the same output line gives a non-zero "already
uploaded" or existing count), or if an upload fails.

**Any deploy of `dist/` outside the image must delete `*.map` first**
([CSP and headers](SECURITY.md#csp-and-headers)).

The build downloads the `posthog-cli` binary from releases.posthog.com and
verifies its SHA-256 against `docker/posthog-cli.sha256` (one hash per
architecture) before it first runs. **Bumping `@posthog/cli` means updating those
hashes** (the file says how); a mismatch fails the build. The hash check does not
cover the CLI's JavaScript wrapper (`lib/posthog-api-cli.mjs`), which comes from
the npm package, not the download.

**One-time setup, per repository:**

- Create a PostHog **personal API key** that can upload source maps
  for the organisation, and store it as the repository
  **secret `POSTHOG_CLI_TOKEN`**. It reaches the build as a BuildKit secret:
  never in a layer, an image or the provenance attestation.
- Set the repository **variable `POSTHOG_SOURCEMAP_PROJECTS`** to a
  comma-separated list of project ids, one per environment (`12345,67890`).
  Project ids appear in the image's provenance; they are not secrets.
- Optionally set the **variable `POSTHOG_CLI_HOST`** (default
  `https://us.posthog.com`; `https://eu.posthog.com` for EU cloud).

Until the variable is set, `deploy.yml` warns `sourcemaps not uploaded` and the
image builds without uploading: exceptions arrive unsymbolicated. With the
variable set and the secret missing, the build fails. Maps are uploaded only when
an image is built: a release tag promotes the same digest and uploads nothing, so
**adding an environment's project later means rebuilding** the image (re-run
`deploy.yml` on `main`) before that environment shows symbolicated frames.

## Deploying

A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml): the CI
gate, then an image build and push to GHCR, then a `deploy` job that is a
placeholder because no deployment target has been chosen. The pipeline is in
[Deploy](ARCHITECTURE.md#deploy).

**Add protection rules to the `production` GitHub Environment** (Settings →
Environments → `production`), at minimum required reviewers, before replacing the
placeholder `deploy` step with a real deployment target. Until then, anything
merged to `main` would deploy unreviewed the moment that step does something
real.

**Serve the SPA and the API from one origin.** The image's nginx proxies `/api`
to `API_UPSTREAM`, so the browser only ever calls the origin that served the
page. A split-origin deployment, with the SPA on one host calling the API on
another, is not supported. The API sends CORS headers for other frontends, but
this app depends on same-origin: its API client uses relative URLs, its
Content-Security-Policy allows `connect-src 'self'` only, and the refresh cookie
is set on whichever origin answers `/api`.

## Releases

Releases are automatic. On every push to `main`,
[release-please](https://github.com/googleapis/release-please) opens a release PR
from the conventional commits since the last release, and
`.github/workflows/release.yml` queues it with `--auto` (or merges it directly if
GitHub refuses auto-merge). With the `main` ruleset below, either way it merges
only once the required checks pass. The next run tags `vX.Y.Z` and publishes the
GitHub Release, and the tag push makes `deploy.yml` promote the image `main`
already built and tested: it adds `:X.Y.Z`, `:X.Y` and `:X` to that same digest
rather than rebuilding. Only `feat`, `fix` and breaking commits cut a release;
`chore`, `docs`, `ci` and the like do not.

Releases use a GitHub App token, from the repo variable
**`RELEASE_APP_CLIENT_ID`** and the secret **`RELEASE_APP_PRIVATE_KEY`**; the App
needs Contents and Pull requests read/write. GitHub never starts workflows from
events `GITHUB_TOKEN` creates, so its release PRs would get no CI and its tags no
image promotion. Do not fall back to it.

### One-time setup

Three manual steps, once:

- **Create and install the release GitHub App** on this repository, then set its
  client ID as the `RELEASE_APP_CLIENT_ID` variable and its private key as the
  `RELEASE_APP_PRIVATE_KEY` secret. Without them `release.yml` fails.
- **Install the [Renovate GitHub App](https://github.com/apps/renovate).**
  `renovate.json` is inert without it: nothing schedules or opens Renovate PRs
  until the app is installed.
- **Set the merge rules** (Settings → General, then Settings → Rules). Enable
  "Allow auto-merge"; allow squash merging only, with the commit title set to the
  PR title and the commit message left blank; enable "Automatically delete head
  branches"; and add a ruleset on `main`, with no bypass list, requiring the
  checks `lint`, `test`, `e2e`, `docker`, `gitleaks` and `pr-title`. Without the
  ruleset, `release.yml`'s fallback merges the release PR without waiting for CI;
  without the blank squash message, each squash body would carry the branch's
  commit list, which release-please reads as extra conventional commits.

With those rules, the squashed commit on `main` is the PR's title alone, so PR
titles must themselves be conventional commits for release-please to read them
correctly.
