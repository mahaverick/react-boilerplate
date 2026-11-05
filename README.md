# React Boilerplate

React Boilerplate is the starting point for a Mahaverick Labs web app: a React
19 and TypeScript single-page app (SPA) that talks to the `express-boilerplate`
API. This file is for a developer who runs, configures, tests or ships the app.

People sign in by emailed link, by Google, or by passkey when the API turns
passkeys on. There are no passwords. The app wires up session handling, routing
guards, forms, tenant management, a Settings area for the account and the
current tenant, and a live notification stream, so a new project starts here
rather than at `create-vite`.

| Concern | Choice                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Build   | Vite 8, React Compiler via Babel                                                                      |
| Routing | TanStack Router, file-based from `src/pages/`                                                         |
| Data    | TanStack Query, axios with a single-flight refresh                                                    |
| Forms   | TanStack Form + Zod v4 schemas                                                                        |
| State   | Zustand (`src/states/`)                                                                               |
| UI      | Tailwind v4, shadcn components on Base UI (base-vega style, mist, Inter), Tabler icons, Base UI toast |
| Tests   | Vitest, Testing Library, MSW, jest-axe, Playwright                                                    |

Other docs:

- [ARCHITECTURE.md](ARCHITECTURE.md): how the code is organised, and why.
- [SECURITY.md](SECURITY.md): the threat model and the defences.
- [CLAUDE.md](CLAUDE.md): the rules for changing code.

## Prerequisites

- **Node 26 or later, and pnpm at the version `packageManager` in
  `package.json` names.** `pnpm install` refuses a Node older than 26. Node 25
  and later ship no Corepack, so install it yourself, and pnpm then comes from
  `packageManager`:

  ```bash
  npm i -g corepack@0.36.0 && corepack enable
  ```

- **The API running on `:4040`.** See [Getting started](#getting-started).
- **express-boilerplate 1.0.0 or later.** Express restarted its version
  numbers at 1.0.0 on 28 October 2026, and 1.0.0 already serves every route and
  body this app sends: passkeys, leaving a workspace, signing out other
  sessions, the `member_not_found` code and the `email_already_verified` 409.
  - Use 2.1.0 or later for the client settings (`GET /status/client-settings`)
    and the step-up link's `expiresAt`. Against an older express, the link
    copy states no lifetime and "Contact support" names no address.
- **Deploy express first when an invitation or sign-in rule changes.** This app
  expects `POST /invitations/verify` to answer only `202`, so it needs the
  express release in which every invitation confirms by an emailed link.
  Against an older API, a new invitee sees "Check your inbox" with no address
  while a session is set.

## Getting started

This section takes you from a fresh clone to a signed-in browser session. Pick
one of two setups:

| Setup                                      | You install           | Runs where                           |
| ------------------------------------------ | --------------------- | ------------------------------------ |
| [On the host](#run-on-the-host)            | Node, pnpm and Docker | The API and this app on your machine |
| [All in Docker](#run-everything-in-docker) | Docker and git        | API, this app and apex in containers |

Both setups use an express-boilerplate checkout next to this repo, and both
serve the app at <http://localhost:5173>.

### Run on the host

1. Install Node and Corepack as in [Prerequisites](#prerequisites).
2. Clone both repos side by side:

   ```bash
   git clone git@github.com:mahaverick/express-boilerplate.git
   git clone git@github.com:mahaverick/react-boilerplate.git
   ```

3. Start the API. express-boilerplate's README, section "Quickstart", lists the
   blank values to fill in `.env`. Set `WEB_URL=http://localhost:5173`:
   `/auth/refresh` refuses a browser origin that is not `WEB_URL`, `APEX_URL`
   or in `CORS_ALLOWED_ORIGINS`.

   ```bash
   cd express-boilerplate
   pnpm install
   docker compose up -d --wait
   cp .env.example .env    # then fill in the blank required values
   pnpm db:migrate
   pnpm dev
   ```

4. Start this app in a second terminal, from the directory that holds both
   clones:

   ```bash
   cd react-boilerplate
   pnpm install
   pnpm dev
   ```

5. Open <http://localhost:5173> and ask for a sign-in link. The link arrives in
   express's mail catcher, Mailpit, at <http://localhost:8025> by default. Open
   the newest message and select its link.

No `.env` is required here. The only `VITE_*` variables are the optional
analytics settings in `.env.example`, which the dev server serves as
`/runtime-config.js` (see [Run-time configuration](#run-time-configuration)).

### Run everything in Docker

express-boilerplate's `docker-compose.yml` has a `dev` profile that runs the
API, this app and apex-boilerplate in containers, with each repo's source
bind-mounted and hot reload on. Your machine needs Docker and git, not Node.
express-boilerplate's README, section "Run everything with Docker", is the
full reference.

1. Clone the three repos side by side. Compose builds the frontends from
   `../react-boilerplate` and `../apex-boilerplate`; set `REACT_DIR` or
   `APEX_DIR` to use other paths.

   ```bash
   git clone git@github.com:mahaverick/express-boilerplate.git
   git clone git@github.com:mahaverick/react-boilerplate.git
   git clone git@github.com:mahaverick/apex-boilerplate.git
   ```

2. Create express's `.env` from `.env.example`, filled in as in express's
   "Quickstart". Set `WEB_URL=http://localhost:5173` and
   `APEX_URL=http://localhost:5174`. Without `.env`, compose stops with
   "env file … not found".
3. Stop any API or Vite dev server on the host. The profile publishes ports
   4040, 5173 and 5174 on `127.0.0.1`.
4. Start the stack from express-boilerplate:

   ```bash
   cd express-boilerplate
   docker compose --profile dev up
   ```

   `api-dev` runs the migrations, then `pnpm dev` on :4040. `react-dev` runs
   Vite on :5173 and `apex-dev` on :5174. The first run installs every
   dependency into a named `node_modules` volume per repo; later runs reuse
   the volumes.

5. Open <http://localhost:5173> and sign in through Mailpit at
   <http://localhost:8025>, as on the host.

Stop the stack with `docker compose --profile dev down`. `down -v` also
deletes the volumes: the `node_modules` volumes, Tempo's data and the database.
The database is the same one a host `pnpm dev` of express uses, so `down -v`
also empties it for the host setup.

- **Edits reload as on the host.** Edit files in your react-boilerplate
  checkout; the container sees them through the bind mount.
- **Git hooks do not install in the container** (it sets `VP_GIT_HOOKS=0`).
  To commit with the hooks, run `pnpm install` once on the host
  ([Scripts](#scripts) lists the hooks).
- **`react-dev` shares `api-dev`'s network**, so `localhost:4040` inside it is
  the API and the Vite proxy works unchanged. If `api-dev` is recreated, run
  `docker compose --profile dev up -d` again so the frontends rejoin it.

### How the app reaches the API

The dev server proxies `/api` to `http://localhost:4040` (`vite.config.ts`).
Without the API, nothing that touches the backend works: sign-in, the session
bootstrap on page load and the notification stream all fail at once.

The proxy is not a convenience. This app supports one topology only: the SPA
and the API served from one origin (see [Deploying](#deploying)). In
development that origin is the Vite proxy; in the container it is nginx.

### The API prefix is fixed

`/api/v1` is not configurable, and no environment variable moves it. It is
written once, as `API_PREFIX` in `src/constants/routes.ts`, and `nginx.conf`
hardcodes it too. What has to change together if it ever moves is in
[The HTTP layer and session](ARCHITECTURE.md#the-http-layer-and-session).

## Run-time configuration

This section lists the settings that differ between environments and how to
pass them.

One image, built once per commit, is promoted unchanged through every
environment. No setting is a `VITE_*` value in the production bundle. Each
setting arrives as a plain environment variable when the container **starts**,
wherever it runs, so changing one means restarting the container, not
rebuilding the image.

- The flow from variable to bundle is in
  [The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).
- Why the values are safe to write unescaped is in
  [Run-time config injection safety](SECURITY.md#run-time-config-injection-safety).

Every variable is optional. An unset or empty value means the default, except
`API_UPSTREAM`: the container refuses an empty one.

| Container env               | Dev `.env`                       | Pattern                                       | Default                  | Meaning                                                                                                 |
| --------------------------- | -------------------------------- | --------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `API_UPSTREAM`              | none                             | `scheme://host[:port]`, no path               | `http://api:4040`        | Where nginx proxies `/api`. The dev server always proxies to `http://localhost:4040`.                   |
| `POSTHOG_KEY`               | `VITE_POSTHOG_KEY`               | `phc_` and 8–128 of `A-Z a-z 0-9 _ -`         | empty                    | PostHog project key. Empty: no analytics code loads, every call is a no-op.                             |
| `POSTHOG_UI_HOST`           | `VITE_POSTHOG_UI_HOST`           | an `https://` origin, no path                 | `https://us.posthog.com` | PostHog's UI host, for links posthog-js builds.                                                         |
| `ANALYTICS_CONSENT_MODE`    | `VITE_ANALYTICS_CONSENT_MODE`    | `opt_out`, `required` or `off`                | `opt_out`                | `opt_out`: capture until the user opts out; `required`: the consent banner first; `off`: nothing loads. |
| `ANALYTICS_HANDOFF_ORIGINS` | `VITE_ANALYTICS_HANDOFF_ORIGINS` | comma-separated `https://` origins, no spaces | empty                    | Websites on other domains allowed to hand a visitor off ([how](docs/analytics-handoff.md)).             |
| `APP_ENVIRONMENT`           | `VITE_APP_ENVIRONMENT`           | `[a-z][a-z0-9-]` up to 32                     | `development`            | Sent as `environment` on every browser event and exception. Set it to express's `APP_ENV` value.        |
| `IOS_APP_IDS`               | none                             | comma-separated `TEAMID10CH.bundle.id`        | empty                    | iOS app IDs for `/.well-known/apple-app-site-association` ([how](#app-association-files)).              |
| `ANDROID_APP_LINKS`         | none                             | comma-separated `package:SHA-256 fingerprint` | empty                    | Android apps for `/.well-known/assetlinks.json` ([how](#app-association-files)).                        |

- `docker/10-runtime-config.sh` checks every value against its pattern at
  start. An invalid one **stops the container** and names the variable, never
  its value, so a typo fails the rollout instead of switching analytics off
  unnoticed.
- `docker/15-app-links.sh` checks `IOS_APP_IDS` and `ANDROID_APP_LINKS` the same
  way, and stops the container with
  `15-app-links.sh: <NAME> must be ...; the value given does not match (not shown)`.
- `docker/05-prepare.sh` checks `API_UPSTREAM`. A path, even a trailing `/`,
  stops the container with
  `05-prepare.sh: API_UPSTREAM must be scheme://host[:port] with no path; the value given does not match (not shown)`.
- `getRuntimeConfig()` (`src/configs/runtime-config.ts`) applies the patterns
  again; the consent mode fails closed
  ([how](SECURITY.md#run-time-config-injection-safety)).
- Every value is public
  ([why](SECURITY.md#run-time-config-injection-safety)); the PostHog key may
  come from a secret store.

#### App-association files

`IOS_APP_IDS` and `ANDROID_APP_LINKS` are read by no browser code. The
container turns them into the two files that iOS and Android fetch to trust
this site for universal links, app links and password autofill:

- `IOS_APP_IDS` is a comma-separated list of `<team id>.<bundle id>`, where the
  team id is ten uppercase letters or digits. It becomes
  `/.well-known/apple-app-site-association`.
- `ANDROID_APP_LINKS` is a comma-separated list of
  `<package>:<SHA-256 certificate fingerprint>`, the fingerprint being 32
  uppercase hex pairs joined by colons. It becomes `/.well-known/assetlinks.json`,
  with one statement per entry.
- A variable that is unset or empty writes no file, so nginx answers `404` for
  its path.
- Both files are served as `application/json`, with no redirect and `no-store`.
- Apple's content delivery network (CDN) caches the
  `apple-app-site-association` file, and iOS reads it from there rather than
  from this site. A change to `IOS_APP_IDS` can therefore take a while to reach
  devices, even after the container serves the new file at once.

The dev server and `pnpm preview` serve neither file.

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

From Google Secret Manager, either sync the secret into that Kubernetes Secret
with External Secrets or the Secret Manager CSI driver (the `secretKeyRef`
stays as it is), or on Cloud Run map it straight to the variable
(`--set-secrets=POSTHOG_KEY=posthog-key:latest`). Either way, the container
sees only an environment variable.

#### Account-deletion URL

`/delete-account` is a public page. Enter `https://<your host>/delete-account`
in the account-deletion URL field of Google Play Console. A signed-in visitor is
sent to Settings > Account > Delete (`/settings/account/delete`). A signed-out
visitor gets a form that emails a sign-in link, and the link brings them back to
`/settings/account/delete`.

## Scripts

This section lists the package scripts and the git hooks. CI is continuous
integration, the GitHub Actions workflows in `.github/workflows/`; a PR is a
pull request.

| Script                  | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Dev server on :5173 with the `/api` proxy                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm build`            | `tsc -b` then `vp build` into `dist/`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm preview`          | Serve the built bundle locally                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm check`            | The static gate: `vp check` (Oxlint with type-aware rules, Oxfmt check), then ESLint for the 17 rules Oxlint lacks, untyped, at zero warnings                                                                                                                                                                                                                                                                                                  |
| `pnpm lint`             | `vp lint`, ESLint and `vp fmt --check`; all three must pass                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm lint:docs`        | History phrasing and broken links in markdown and config comments. CI runs it                                                                                                                                                                                                                                                                                                                                                                  |
| `pnpm knip`             | Unused files, exports, types and dependencies (`knip.jsonc` lists the ignores and why). CI runs it                                                                                                                                                                                                                                                                                                                                             |
| `pnpm typecheck`        | `tsc --noEmit` on `tsconfig.app.json`, then `typecheck:e2e`                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm typecheck:e2e`    | `tsc --noEmit` on `e2e/tsconfig.json`                                                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm format`           | `vp fmt` (Oxfmt)                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`             | Vitest, single pass                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm test:coverage`    | Vitest with coverage; fails under 88/82/86/89 % (statements/branches/functions/lines). CI runs `test:shard` in four `unit` jobs, then `test:merge` in `test`                                                                                                                                                                                                                                                                                   |
| `pnpm test:watch`       | Vitest in watch mode                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:e2e`         | Playwright `fixtures` project against a bundle of the MSW harness; no backend needed. CI runs it                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test:e2e:live`    | Playwright `live` project; needs express at `E2E_API_ORIGIN` (default :4040); `flags.test.ts` also needs `E2E_FLAGS_SET_CMD` (`<cmd> <key> <value>`; `example_beta_page` on\|off, `example_cta_experiment` control\|bold at 100 % rollout)                                                                                                                                                                                                     |
| `pnpm test:e2e:nginx`   | Builds the production image and runs the Playwright `nginx` project against it on :8088, started with the run-time settings CI uses; all but the `@no-api` tests need a live API                                                                                                                                                                                                                                                               |
| `pnpm e2e:fake-flags`   | Fake PostHog flag definitions on 127.0.0.1:4064 (`E2E_FAKE_FLAGS_PORT`) for `live/flags.test.ts`; `scripts/e2e-flags-set.mjs <key> <value>` changes one                                                                                                                                                                                                                                                                                        |
| `pnpm test:contrast`    | axe colour contrast in a real browser, both themes; no backend needed                                                                                                                                                                                                                                                                                                                                                                          |
| `pnpm capture:pages`    | Playwright `capture` project: the page inventory's screenshots into `docs/pages/img/`. Needs the dev stack up (react :5173, API :4040, Mailpit :8025) and starts nothing; `CAPTURE_ONLY=auth,tenants` limits it to those areas, or a route key such as `'/tenants/$slug/beta'` (quote it, or the shell expands `$slug`) to one route; `E2E_BASE_URL` runs it (and `pnpm test:contrast`) against a dev server already running on another origin |
| `pnpm check:bundle`     | Builds in memory; fails on one JS chunk, first-visit JS over budget or holding posthog-js or `@posthog/core`, the error listener over 1 KB gzipped, or devtools in a chunk. CI runs it                                                                                                                                                                                                                                                         |
| `pnpm ui:drift`         | Compares each vendored `src/components/ui/` file with its registry snapshot in `scripts/ui-registry/`; fails on a change `docs/ui-local-edits.md` does not record. CI runs it                                                                                                                                                                                                                                                                  |
| `pnpm ui:drift:refresh` | Retakes the registry snapshot through the installed `shadcn` devDependency; needs the network. Review its diff                                                                                                                                                                                                                                                                                                                                 |
| `pnpm gate`             | CI's lint job plus the unit suite: `check`, `typecheck`, `lint:docs`, `ui:drift`, `knip`, `test`. pre-push runs it                                                                                                                                                                                                                                                                                                                             |
| `pnpm push`             | Runs `pnpm gate`, then `git push --no-verify` with your arguments; nothing is pushed if the gate fails                                                                                                                                                                                                                                                                                                                                         |
| `pnpm prepare`          | Installs the `.vite-hooks/` git hooks (`vp config --hooks`); `pnpm install` runs it                                                                                                                                                                                                                                                                                                                                                            |

The git hooks live in `.vite-hooks/`:

- pre-commit checks the staged files and their tests;
- commit-msg runs commitlint;
- pre-push runs `pnpm gate`.

In a clone made while the hooks were husky's, run
`git config --unset core.hooksPath && pnpm prepare` once after `pnpm install`,
or no hook runs.

CI holds the gate to **zero warnings** as well as zero errors. Run
`pnpm check` before you push.

Oxlint runs the type-aware rules; ESLint runs the 17 leftover rules without
types. The exemptions for the vendored `src/components/ui/` files live in the
`vite.config.ts` overrides and in `eslint.config.js`. To see which rules apply
to one file:

- **ESLint:** run `pnpm exec eslint --print-config <file>`.
- **Oxlint:** lint a probe file under that glob, seeded with
  `import { cn as seededCn } from 'cn'`. `oxlint --print-config` prints the
  whole config, not one file's.

## Testing

This section covers the unit suite, the five Playwright projects, the nightly
run and the variables the end-to-end (e2e) tests read.

```bash
pnpm test
```

Unit tests live under `tests/unit/`, mirroring `src/`: the test for
`src/http/session.ts` is `tests/unit/http/session.test.ts`. No test file lives
under `src/`; ESLint rejects one.

`tests/unit/a11y.test.tsx` is an **accessibility gate**. No rule is disabled to
pass it, and a violation is fixed in the markup. What it covers, and why colour
contrast is measured elsewhere, is in [CLAUDE.md](CLAUDE.md#accessibility).

The `fixtures` project covers passkeys in Chrome with a virtual authenticator
(`e2e/helpers/virtual-authenticator.ts`, over the Chrome DevTools Protocol,
CDP). The harness answers the contract's calls (`?passkeys=off|optional|required`,
`?passkeyList=`, `?stepUp=`, `?setup=1`); the browser builds and signs the
credential, with private keys generated at run time. `e2e/live/passkeys.test.ts`
runs the same flows against an express with passkeys on.

`pnpm test:e2e` builds the harness in development mode and serves it with
`vp preview`. A bare `playwright test --project=fixtures` without `E2E_BUNDLED`
uses the dev server instead. The bundled run serves on :5173, the port
`pnpm dev` uses, and refuses to start while `pnpm dev` holds it: stop
`pnpm dev`, or set `REACT_E2E_PORT` to a free port.

Playwright has five projects in `e2e/`:

| Project    | Command               | Runs against                                        | In CI                         |
| ---------- | --------------------- | --------------------------------------------------- | ----------------------------- |
| `fixtures` | `pnpm test:e2e`       | A bundle of the harness, with MSW answering; no API | Yes                           |
| `live`     | `pnpm test:e2e:live`  | A real express and its services, with `E2E_LIVE=1`  | Nightly                       |
| `nginx`    | `pnpm test:e2e:nginx` | The production image on :8088                       | `@no-api` on PRs; all nightly |
| `contrast` | `pnpm test:contrast`  | The harness, in both themes; no API                 | No                            |
| `capture`  | `pnpm capture:pages`  | An already-running dev stack; starts nothing        | No                            |

The `live` and `nginx` projects read these variables (defaults in
`playwright.config.ts` and the helpers):

| Variable             | Default                 | What it is                                                                                                            |
| -------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `E2E_API_ORIGIN`     | `http://localhost:4040` | The express under test. Tests read it, never a hardcoded `:4040`.                                                     |
| `E2E_NGINX_ORIGIN`   | `http://localhost:8088` | The image under test.                                                                                                 |
| `E2E_FLAGS_SET_CMD`  | none                    | How `live/flags.test.ts` sets a flag; the test fails without it. For the fake flags host, see below.                  |
| `E2E_API_DIR`        | none                    | The express checkout whose database the API under test uses. See the note below the table.                            |
| `E2E_MAILPIT_ORIGIN` | `http://localhost:8025` | The Mailpit the helpers read sign-in and invitation-confirm links from. Every `live` sign-in goes through it.         |
| `E2E_RELEASE`        | `dev`                   | The release `nginx/errors.test.ts` expects on each error report.                                                      |
| `E2E_ALLOWED_ORIGIN` | `http://localhost:5173` | The origin `nginx/cors.test.ts` sends, which must be in the express's cross-origin resource sharing (CORS) allowlist. |

`live/platform.test.ts` runs `pnpm platform:grant` in `E2E_API_DIR`. Any
checkout works, `../express-boilerplate` included. The SSE (server-sent events)
reconnect test restarts `pnpm dev` there, so for that test alone
`E2E_API_DIR` must be a separate git worktree, never the main checkout.

Each `live` run signs in fresh addresses by emailed link. Express mails an
address one link a minute and allows ten link requests per IP per fifteen
minutes. A full run against a local express therefore needs `RATE_LIMIT_SCALE`
set there, as the nightly run does. The helpers are described in
[CLAUDE.md](CLAUDE.md#end-to-end-tests).

The SSE reconnect test restarts an express, so it runs only by hand, behind a
guard that refuses to touch the main checkout. The steps and the guard's rules
are in [CLAUDE.md](CLAUDE.md#end-to-end-tests).

### Nightly live and nginx run

`.github/workflows/e2e-nightly.yml` runs the `live` and `nginx` projects every
night at 02:17 UTC, and on demand from the Actions tab. It needs no secrets.
Each run:

1. checks out this repo into `app/` and express-boilerplate's `main` into
   `express/`;
2. starts Postgres, Redis and Mailpit from express's compose file (project
   `e2e`), and the fake flags host;
3. starts express on :4040 with `APP_ENV=local` and `RATE_LIMIT_SCALE=10`,
   because one runner IP sends every request;
4. runs `pnpm test:e2e:live` and `pnpm test:e2e:nginx`. The second runs even
   when the first fails.

The SSE reconnect test skips itself, and the opt-in analytics tests stay
skipped.

A red run on `main` opens an issue labelled `e2e-nightly`, or comments on the
open one, with the run link, the failed steps and the express commit under
test. The next green run closes it. A run on `main` that is cancelled by hand
or times out also counts as a failure. Each run of the suites uploads an
`e2e-nightly` artifact, kept 7 days, with both Playwright reports, the test
results, express's `api.log` and the fake flags host's log.

A manual run on another branch never touches issues, unless its
`exercise_issue` input is `fail` or `pass`. Then the stack and suites are
skipped, the outcome is forced to that value, and the issue step runs:

```bash
gh workflow run e2e-nightly.yml --ref <branch> -f exercise_issue=fail
```

### Running `live/flags.test.ts` locally

1. Start the fake flags host: `pnpm e2e:fake-flags` (127.0.0.1:4064;
   `E2E_FAKE_FLAGS_PORT` moves it, and the set script reads the same variable).
2. Give the express under test these three lines in its `.env` and restart it:
   `POSTHOG_HOST=http://127.0.0.1:4064`,
   `POSTHOG_PROJECT_KEY=phc_test_key_not_real` and
   `POSTHOG_FEATURE_FLAGS_KEY=phs_test_key_not_real`. Its analytics then goes
   to the fake too, which accepts and discards it. Take the lines out
   afterwards.
3. Run the test with the set script's path as `E2E_FLAGS_SET_CMD`:

   ```bash
   E2E_FLAGS_SET_CMD="$PWD/scripts/e2e-flags-set.mjs" pnpm test:e2e:live e2e/live/flags.test.ts
   ```

   It flips each flag through the fake, then waits up to 45 s for express's
   30-second definitions fetch.

## Feature flags

express evaluates every flag; this app only reads the values. How is in
[Feature flags](ARCHITECTURE.md#feature-flags), and the rules are in
[CLAUDE.md](CLAUDE.md#feature-flags). To add one:

1. Add it to express's flag registry
   (`express-boilerplate/src/constants/flags.constants.ts`) with `client: true`
   and `react` in `apps`, and run `flags:sync` there. Without both, express
   never sends the flag to this app.
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
`ANALYTICS_HANDOFF_ORIGINS=https://www.example.test`). Its `@no-api` tests run
in CI, with a fake PostHog answering `/api/v1/collect` through Playwright.

The live half needs an express on `:4040` started with these settings:

- `POSTHOG_PROJECT_KEY=phc_test_key_not_real`;
- `POSTHOG_HOST` and `POSTHOG_ASSETS_HOST` both `http://127.0.0.1:4063`;
- `ANALYTICS_DRAIN_INTERVAL_MS=1000`.

Then run:

```bash
E2E_ANALYTICS=1 pnpm test:e2e:nginx
```

The script builds the image with the settings above, sets `E2E_LIVE` and
`E2E_NGINX` itself, and reaches the express on the host through
`--add-host=api:host-gateway`. The suite starts the fake PostHog on :4063
(`E2E_FAKE_POSTHOG_PORT` moves it). For an express elsewhere, run the image
yourself with `API_UPSTREAM` pointing at it, and set `E2E_NGINX_ORIGIN` and
`E2E_API_ORIGIN`.

## Docker

This section covers building and running the production image on its own.

```bash
docker build -t react-boilerplate .
docker run --rm -p 8080:8080 --read-only --tmpfs /tmp --add-host=api:127.0.0.1 react-boilerplate
```

The image builds the bundle with Node and serves `dist/` from the unprivileged
nginx image, as uid 101 on port **8080**. It proxies `/api` to `API_UPSTREAM`,
which is `http://api:4040` unless you set it, so by default the container
expects an **`api` host** on the same network.

nginx resolves the upstream's host when it loads its config, so without one
the container exits with `host not found in upstream`. The `--add-host` flag
above lets a standalone smoke test start; the proxy answers 502 until a real
API is there. Under compose, name the API service `api` and nothing else is
needed. To point it elsewhere:

```bash
docker run --rm -p 8080:8080 -e API_UPSTREAM=http://my-api:8080 --read-only --tmpfs /tmp react-boilerplate
```

The image runs on a **read-only root filesystem**. nginx writes everything
under `/tmp`, so give it a writable one: `--tmpfs /tmp` as above, or an
`emptyDir` in Kubernetes. With `--read-only` and no writable `/tmp`, the
container stops at start. Logs go to stdout and stderr. The stages, the
entrypoint order and the nginx locations are in
[The container and run-time config](ARCHITECTURE.md#the-container-and-run-time-config).

- **Extra server config** goes in a template:
  `/etc/nginx/templates/*.conf.template`. The entrypoint strips only the
  `.template` suffix, so the name before it has to end `.conf`. A file placed
  directly in `/etc/nginx/conf.d` is ignored, because `docker/nginx.main.conf`
  includes only `/tmp/nginx/conf.d/*.conf`.
- **Derived images.** `RUN` steps in an image derived from this one run as uid
  101, not root: the `Dockerfile` never resets the base image's `USER`. A step
  that needs root has to `USER root` first and `USER 101` again before `CMD`.
- **Build arguments** are per commit, not per environment:
  - `GIT_SHA`: the release the bundle reports, `dev` when unset or empty;
  - `POSTHOG_SOURCEMAP_PROJECTS` and `POSTHOG_CLI_HOST`: where the source maps
    go (see [Source maps](#source-maps)).
- **IPv4 only.** The `server` block in `nginx.conf` declares `listen 8080;`,
  which binds `0.0.0.0:8080`. An IPv6-only cluster needs `listen [::]:8080;`
  added to that block. That line fails on hosts with IPv6 disabled, so do not
  add it unconditionally.
- **Headers and the Content Security Policy (CSP).** What nginx sends, and why
  no location may declare its own `add_header`, is in
  [CSP and headers](SECURITY.md#csp-and-headers). Check headers with `curl -I`
  against a real asset, not by reading the config.

### Source maps

The build writes hidden source maps. The image's build stage then injects
chunk ids, uploads the maps to every project in `POSTHOG_SOURCEMAP_PROJECTS`
and deletes every `.map`, so none ships
([Error tracking](ARCHITECTURE.md#error-tracking)). The build fails if any of
these happens:

- there are no `.map` files under `dist/`;
- the CLI skipped a chunk as too large;
- nothing was uploaded, unless the same output line gives a non-zero "already
  uploaded" or existing count;
- an upload fails.

**Any deploy of `dist/` outside the image must delete `*.map` first**
([CSP and headers](SECURITY.md#csp-and-headers)).

The build downloads the `posthog-cli` binary from releases.posthog.com and
verifies its SHA-256 against `docker/posthog-cli.sha256` (one hash per
architecture) before it first runs. **Bumping `@posthog/cli` means updating
those hashes** (the file says how); a mismatch fails the build. The hash check
does not cover the CLI's JavaScript wrapper (`lib/posthog-api-cli.mjs`), which
comes from the npm package, not the download.

**One-time setup, per repository:**

- Create a PostHog **personal API key** that can upload source maps for the
  organisation, and store it as the repository **secret `POSTHOG_CLI_TOKEN`**.
  It reaches the build as a BuildKit secret: never in a layer, an image or the
  provenance attestation.
- Set the repository **variable `POSTHOG_SOURCEMAP_PROJECTS`** to a
  comma-separated list of project ids, one per environment (`12345,67890`).
  Project ids appear in the image's provenance; they are not secrets.
- Optionally set the **variable `POSTHOG_CLI_HOST`** (default
  `https://us.posthog.com`; `https://eu.posthog.com` for EU cloud).

What happens with each part missing:

- **Variable unset:** `deploy.yml` warns `sourcemaps not uploaded`, and the
  image builds without uploading, so exceptions arrive unsymbolicated.
- **Variable set, secret missing:** the build fails.
- **A project added after the image was built:** maps are uploaded only when an
  image is built, and a release tag promotes the same digest and uploads
  nothing. **Adding an environment's project later means rebuilding** the image
  (re-run `deploy.yml` on `main`) before that environment shows symbolicated
  frames.

## Deploying

A push to `main` runs [`deploy.yml`](.github/workflows/deploy.yml): the CI
gate, then an image build and push to the GitHub Container Registry (GHCR),
then a `deploy` job. That job is a placeholder, because no deployment target
has been chosen. The pipeline is in [Deploy](ARCHITECTURE.md#deploy).

**Add protection rules to the `production` GitHub Environment** (Settings →
Environments → `production`), at minimum required reviewers, before replacing
the placeholder `deploy` step with a real deployment target. Without them,
anything merged to `main` deploys unreviewed as soon as that step does
something real.

**Serve the SPA and the API from one origin.** The image's nginx proxies `/api`
to `API_UPSTREAM`, so the browser only ever calls the origin that served the
page. A split-origin deployment, with the SPA on one host calling the API on
another, is not supported. The API sends CORS headers for other frontends, but
this app depends on same-origin:

- its API client uses relative URLs;
- its Content-Security-Policy's `connect-src` allows `'self'` and Razorpay's
  hosts only;
- the refresh cookie is set on whichever origin answers `/api`.

## Releases

Releases are automatic:

1. On every push to `main`,
   [release-please](https://github.com/googleapis/release-please) opens a
   release PR from the conventional commits since the last release.
2. `.github/workflows/release.yml` queues that PR with `--auto`, or merges it
   directly if GitHub refuses auto-merge. With the `main` ruleset below, either
   way it merges only once the required checks pass.
3. The next run tags `vX.Y.Z` and publishes the GitHub Release.
4. The tag push makes `deploy.yml` promote the image `main` already built and
   tested: it adds `:X.Y.Z`, `:X.Y` and `:X` to that same digest rather than
   rebuilding.

Only `feat`, `fix` and breaking commits cut a release; `chore`, `docs`, `ci`
and the like do not.

Releases use a GitHub App token, from the repo variable
**`RELEASE_APP_CLIENT_ID`** and the secret **`RELEASE_APP_PRIVATE_KEY`**. The
App needs Contents and Pull requests read/write. Do not fall back to
`GITHUB_TOKEN`: GitHub never starts workflows from events it creates, so its
release PRs would get no CI and its tags no image promotion.

### One-time setup

Three manual steps, once:

- **Create and install the release GitHub App** on this repository, then set
  its client ID as the `RELEASE_APP_CLIENT_ID` variable and its private key as
  the `RELEASE_APP_PRIVATE_KEY` secret. Without them `release.yml` fails.
- **Install the [Renovate GitHub App](https://github.com/apps/renovate).**
  `renovate.json` is inert without it: nothing schedules or opens Renovate PRs
  until the app is installed.
- **Set the merge rules** (Settings → General, then Settings → Rules):
  - enable "Allow auto-merge";
  - allow squash merging only, with the commit title set to the PR title and
    the commit message left blank;
  - enable "Automatically delete head branches";
  - add a ruleset on `main`, with no bypass list, requiring the checks `lint`,
    `test`, `e2e`, `docker`, `gitleaks` and `pr-title`.

  Without the ruleset, `release.yml`'s fallback merges the release PR without
  waiting for CI. Without the blank squash message, each squash body carries
  the branch's commit list, which release-please reads as extra conventional
  commits.

With those rules, the squashed commit on `main` is the PR's title alone, so
each PR title must itself be a conventional commit for release-please to read
it correctly.
