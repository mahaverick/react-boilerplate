# CLAUDE.md

Guidance for Claude Code (and any other agent) working in this repository.

This file is not a tour of the codebase — the code says what it does, and the
comments in it say why. What follows is the set of decisions that look wrong
until you know the reason, and that cost fix rounds to get right. Changing one
of these is a deliberate act, not a tidy-up.

## What this is

A React 19 + TypeScript SPA that talks to the `express-boilerplate` API. Vite,
TanStack Router (file-based), TanStack Query, TanStack Form, Zustand, Tailwind
v4, Base UI via shadcn, axios, Zod v4, Vitest + Testing Library + MSW.

## Commands

| Command          | What it does                                           |
| ---------------- | ------------------------------------------------------ |
| `pnpm dev`       | Dev server on :5173, proxying `/api` to `:4040`        |
| `pnpm build`     | `tsc -b` then `vite build`                             |
| `pnpm lint`      | eslint **and** `prettier --check` — both must be clean |
| `pnpm typecheck` | `tsc --noEmit -p tsconfig.app.json`                    |
| `pnpm test`      | Vitest, one pass                                       |
| `pnpm format`    | prettier --write                                       |

The gate is **0 errors and 0 warnings**: verify with
`pnpm exec eslint . --max-warnings 0`, not with a bare `pnpm lint`, whose
eslint half exits 0 on warnings.

## Auth — the rules that break silently when broken

- **The API prefix is fixed and relative** (`/api/v1`), written once as
  `API_PREFIX` in `src/constants/routes.ts`. The backend sets no CORS headers,
  so the SPA and the API must be one origin: the dev server proxies `/api`, and
  the container's nginx does the same. An absolute URL fails at runtime in a
  way no test catches. There is no environment variable for it, and there was:
  `VITE_API_URL` moved the axios base alone while the `EventSource` URL, the
  Google OAuth anchor and nginx's SSE `location` kept the old prefix. Moving
  the prefix means changing `API_PREFIX`, `nginx.conf` and `vite.config.ts`
  together.
- **The access token is memory-only.** It lives in `auth.store` and nowhere
  else. Never write it to `localStorage`, `sessionStorage`, a cookie or a query
  string, and never add a `persist` middleware to that store. The refresh token
  is an httpOnly cookie the browser owns; the client never reads it.
- **`ensureSession()` is the only caller of `/auth/refresh`.** That single-flight
  wrapper is what makes N concurrent 401s produce exactly one refresh. A second
  call site anywhere — an interceptor, a retry, a bootstrap path — reintroduces
  the thundering herd it exists to prevent, and the existing tests will not see
  it.
- **A user is signed out if and only if a request made by `refreshSession()`
  returns 401.** Not "the refresh failed", not "the server answered". A 502
  during a rolling restart, a timeout, a dropped connection: none of those sign
  anyone out. Widening this to any error is the single easiest way to log every
  user out during a deploy.

## Never install

`react-hook-form`, `@hookform/resolvers`, `next-themes`,
`@tanstack/zod-form-adapter`, `clsx`, `tailwind-merge`, any `@radix-ui/*`.

Each has an in-repo replacement: TanStack Form with a Zod validator (no
adapter package is needed in v1), `theme.store` plus the pre-paint script in
`index.html`, the `cn` package, and Base UI through shadcn. Adding one of these
back gives the project two ways to do the same thing, which is how the
inconsistency starts.

## Never run

`shadcn add form` or `shadcn add toast`. The registry's `form.tsx` is built on
react-hook-form and its toast on next-themes; both are on the list above. Ours
are hand-written for this stack.

## The `src/components/ui/**` exception

That directory is **vendored** shadcn output. Edits there are lost the next time
the component is re-added, so it is excluded from the checks that would
otherwise churn the diff on every `shadcn add`:

- **prettier skips it entirely** (`.prettierignore`) — shadcn emits semicolons
  and double quotes, and reformatting them fights the registry on every re-add.
- **eslint excludes only the Tailwind rules and `react-refresh/only-export-components`**
  (`eslint.config.js`, the `src/components/ui/**` block). Everything else still
  applies. Do not read this as "eslint skips the directory" — print the config
  for a file in there and count: 507 rules, 113 of them enabled, including
  type-aware ones like `@typescript-eslint/no-unsafe-call` at **error**. A type
  error in there fails CI like anywhere else. Settle this with
  `eslint --print-config` rather than by reading the config file: the `ignores`
  at `eslint.config.js:30` is scoped to the Tailwind _settings_ block, which is
  exactly what makes it easy to misread.

**`form.tsx` and `sonner.tsx` are ours, not upstream's.** Both are fully linted
and formatted, and both are named explicitly in `eslint.config.js` and
`.prettierignore`. If you add a third hand-written file to that directory, add
it to both lists in the same change or it will sit there unchecked.

## Forms

- Frontend Zod schemas in `src/schemas/` **mirror the backend validators**.
  They are one contract in two repos: change both together, or the client will
  accept what the server rejects.
- Parse before posting. TanStack hands `onSubmit` the raw form state, so a
  schema's `.trim()`/`.toLowerCase()` only reaches the wire if the value is
  parsed on the way out.
- **`<Form>`'s server-error clearing covers native inputs only.** It listens for
  a change event that bubbles out of the form element. A Base UI `Select` does
  not emit one, so a form with a Select must call `serverErrors.clearField()`
  itself — `$slug.members.tsx` is the worked example. The `Checkbox` case is
  **unverified**: check it before relying on either answer.

## Versions

TypeScript stays at `~6.0.3` and `@types/node` at `24.x` until typescript-eslint
supports TS 7. Bumping either ahead of that breaks the type-aware lint rules,
which is most of the lint config.

The pnpm version is pinned in **two** places that must move together: the
Dockerfile's `corepack prepare` and `.github/workflows/ci.yml`'s
`pnpm/action-setup`. A `packageManager` field in package.json would collapse
those into one, but pnpm 12 then records itself in the lockfile
(`packageManagerDependencies`, ~160 lines of per-platform binaries) and
`--frozen-lockfile` fails until the lockfile is regenerated. Adding the field
is fine — just regenerate the lockfile in the same commit.

## Conventions the linter enforces

- **kebab-case** filenames and folders under `src/`, with suffixed files
  confined to their directory: `*.store.ts` → `src/states/`, `*.queries.ts` →
  `src/queries/`, `*.schemas.ts` → `src/schemas/`, `*.types.ts` → `src/types/`,
  `use-*` → `src/hooks/`.
- **`src/pages/**` is exempt** from all of it. TanStack Router's file-based
  routing needs `__root.tsx`, `_auth.tsx` and `$slug.members.tsx`, which are not
  kebab-case by design.
- Tests are **`.test.ts(x)`**, never `.spec.`, and never in a `__tests__/`
  folder — those two ARE linted (`check-file/filename-blocklist`). Co-location
  beside the subject is the convention wherever there is a subject to sit beside;
  nothing enforces it, and the cross-cutting suites under `src/tests/`
  (`a11y.test.tsx`) sit beside nothing by design.

## End-to-end tests

`pnpm test:e2e` (fixtures) and `pnpm test:e2e:live` (needs a backend). Playwright, two
projects, and three conventions that are load-bearing rather than taste:

- **Tests are `*.test.ts`, never Playwright's default `*.spec.ts`** —
  `check-file/filename-blocklist` rejects `.spec.` repo-wide, so the default fails lint on
  the first file. `playwright.config.ts` sets `testMatch` accordingly.
- **`vitest.config.ts` carries an explicit `exclude` for `e2e/**`.** Vitest's default
  `include` is `**/*.{test,spec}.*`, so without it Vitest collects the Playwright specs and
  runs them under jsdom.
- **`e2e/` is typed-linted via its own `tsconfig.json`** and `projectService`, not exempted
  with `disableTypeChecked` the way the root configs are. `playwright.config.ts` itself is a
  root config and is linted with those.

**`fixtures`** drives `e2e/harness/` — the real router and real CSS with MSW answering the
same fixtures `src/tests/a11y.test.tsx` uses, so it needs no backend. It exists for the
checks jsdom cannot make, because jsdom has no layout: whether the webfont actually resolved,
whether anything overflows the viewport at 390px, whether a state renders as more than a bare
header. `?state=loaded|empty|error|loading|soleowner` picks the members response.

Two harness traps, both of which made tests measure the wrong thing once already: answering
the SSE stream with `204` looks to the hook exactly like a dropped connection and sends the
page into a refresh-then-redirect that a test will race; and **any endpoint left unmocked
falls through to the real backend** (`onUnhandledRequest: 'bypass'`) and 401s. If a fixtures
test starts landing on `/login`, that is why.

**`live`** needs a real express-boilerplate on `:4040` and its docker services, and is skipped
unless `E2E_LIVE=1`. Accounts are registered and verified through mailpit — login stays 401
until the address is verified, and the link only exists in the email. Each run uses a **fresh
address**, because the login limiter is keyed `ip:email` at five attempts per fifteen minutes
and a fixed address would rate-limit every rerun.

**`nginx`** runs against the PRODUCTION image — `pnpm test:e2e:nginx` builds it, runs it on
:8088 with `--add-host=api:host-gateway`, tests, and tears it down. It exists for one test,
and for a reason worth keeping: **the Vite dev proxy does not propagate an upstream close.**
A `curl -N` at it stays open after the API is killed, so `EventSource` never fires `error`
and the SSE reconnect path is unreachable from a dev-server browser. The same curl against
nginx exits on the second the API dies. Anything that depends on noticing a dropped upstream
has to be tested here, not against `pnpm dev`.

`restartApi()` kills by port with `-sTCP:LISTEN` and escalates SIGTERM→SIGKILL. Both details
are load-bearing: `pnpm dev` is `tsx watch`, whose CHILD holds the port and survives a
group SIGTERM, and without `-sTCP:LISTEN` lsof also lists the Vite proxy as a client of that
port and the kill takes the dev server down too.

## Accessibility

`src/tests/a11y.test.tsx` is a gate, not a smoke test: every routed page, plus
an open dialog, an open sheet and all four open menus, must come back clean. If
something trips a rule, **fix the markup** — no rule is disabled to make it pass.

**Menus are graded at menu scope, not document scope, and that is the one place
the gate narrows.** Base UI portals a menu popup to `document.body`, so at
document scope every open menu trips `region` — "some page content is not
contained by landmarks". That is a page-structure rule, and it does not describe
a barrier in a transient popup that focus has just been moved into; the dialog
and sheet escape it only because axe exempts `role="dialog"`. `expectNoViolationsIn`
therefore runs the **identical rule set** against the popup element. Nothing is
disabled, and the narrowing is pinned the same way the document context is: it
asserts `aria-required-children` is in `results.passes`, which only happens when
axe really evaluated a `role="menu"`. Pages are still graded at document scope.

The alternative — rendering the popups into a container inside a landmark — was
not taken: the triggers live in the sidebar and header, so `<main>` would be the
wrong home for their menus, and dropping the portal risks real clipping and
stacking regressions to satisfy a rule that is not describing a real barrier.

Three details that took measuring, and that a "tidy-up" would quietly undo:

- It runs **axe-core over `document`**, not jest-axe's `axe()` over a fragment.
  Axe reports its page-level rules (`page-has-heading-one`, `landmark-one-main`,
  `bypass`, `html-has-lang`, `document-title`) as _inapplicable_ for anything
  smaller than the document, so a fragment run grades far less than it looks
  like it does. The context is **pinned by an assertion**, not by this comment:
  the gate asserts `html-has-lang`, `document-title` and `bypass` are in
  `results.passes`, so narrowing the context back to `document.body` fails 14
  tests instead of silently passing all 17.
- **Every page needs exactly one `<main>` and exactly one `<h1>`**, and the test
  asserts both by hand. It has to: axe's own rules for them query
  `[aria-level=1]`, a selector jsdom rejects outright, so axe files them under
  `incomplete` — which `toHaveNoViolations` does not read. `CardTitle` renders a
  `div`, so a page's `h1` goes _inside_ it.
- Colour contrast is **not** checked. jest-axe's default — reproduced explicitly
  in that file — switches every `cat.color` rule off under jsdom, which has no
  layout. Contrast, focus rings and the member table's horizontal scroll are
  browser checks.
