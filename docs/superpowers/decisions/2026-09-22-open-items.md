# Open items after Phase A

Written 2026-09-22, when Phase A merged to `main`. Nothing here blocks that merge.
Companion to `2026-09-22-phase-a-decision-record.md`, which explains WHY the constraints
in the code exist; this file is what is NOT yet done.

Ordered by what would cost most if forgotten.

> **Updated 2026-09-22, end of Phase B.** §3, §4 and §8 are closed. §1 is mostly
> closed: two of its three behaviours are now executed against a live backend, a third
> was **mis-stated** and is corrected below, and the SSE one turned out not to be
> provable through the Vite dev proxy. Evidence:
> `2026-09-22-phase-b-evidence.md`; tests: `e2e/live/session.test.ts`.

---

## 1. ~~Three behaviours have never actually been executed~~ — CLOSED 2026-09-22

Each was unit-tested and inferred end to end. All three needed a live API and a real browser,
which the test harness did not have. It was the largest gap in Phase A; it is now covered by
the e2e suite, and one of the three turned out to be describing something the code does not do.

- **A reload keeps you signed in.** ✅ **VERIFIED 2026-09-22** against a live
  express-boilerplate — `e2e/live/session.test.ts`. The same test also pins **exactly one**
  `/auth/refresh` per reload, which is the first assertion anywhere that `ensureSession()`'s
  single-flight wrapper actually holds.
- **The SSE stream reconnects after a real backend restart.** ✅ **VERIFIED 2026-09-22**
  against the production image — `e2e/nginx/sse.test.ts`, `pnpm test:e2e:nginx`.
  It could not be shown against the dev server, and the reason is the finding: a `curl -N`
  at the Vite proxy stays open after the API is killed, so `EventSource` never fires `error`
  and the reconnect path is unreachable. The same curl against nginx exited on **the exact
  second** the API died. The test therefore runs against the real bundle and the real
  `nginx.conf`, which is the path this behaviour ships on. It asserts a stream opened
  strictly **after** the new server was ready, not merely that the count grew — a
  connection from before the restart would otherwise satisfy it.
- **~~`X-Forwarded-Proto` … drives the `secure` cookie flag~~ — THIS WAS WRONG.**
  `isSecureCookieEnvironment()` (`auth.controller.ts`) returns
  `getEnv().NODE_ENV === 'production'` and never reads `req.secure`, so **no request header
  can change that flag**. `TRUST_PROXY` is real but governs `req.ip`, which the IP-keyed rate
  limiters consume — a different mechanism entirely. The claim is asserted false in
  `e2e/live/session.test.ts`. ✅ The cookie's `Path=/api/v1/auth`, `HttpOnly` and
  `SameSite=Strict` — all previously inferred — **are** now verified.

Also inferred: SSE actually streaming unbuffered (`proxy_buffering off` being present is
not the same as watching chunks arrive), and the refresh cookie's `Path=/api/v1/auth`
surviving the proxy, which needs a real `Set-Cookie` round trip.

**All three are now settled** — two verified, one corrected. `pnpm test:e2e:live` covers the
session and cookie behaviour; `pnpm test:e2e:nginx` covers the stream. **This section is
closed.**

## 2. The first cold CI run is the real test of the flake fix

Three tests failed on one of four full local runs before the fix (`findBy*` at Testing
Library's 1s default while 28 workers each spawn ~700ms). Fixed at the mechanism —
`asyncUtilTimeout: 5000` in `src/tests/setup.ts` plus `testTimeout: 20000` — deliberately
not with `retry`, which hides flakes rather than fixing them. The evidence is mechanistic;
a cold CI box is the only honest test.

## 3. ~~No opened dropdown is axe-checked anywhere~~ — CLOSED 2026-09-22

The a11y gate's overlay block covers a dialog and a sheet. It covers no open menu.

This is not hypothetical. A page-crashing bug lived in exactly this blind spot through 234
passing tests and ten reviews: `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and
throws outside a `Menu.Group`, so opening the notification bell replaced the whole app with
the root error boundary — on every authenticated route. It was found only because an
unrelated fix made the error states unreachable without opening the menu.

Every overlay component now has a test that opens it, so the crash class is closed. Adding
the opened menus to the axe gate is the cheaper guard against a repeat: bell, tenant
switcher, user menu, theme toggle.

**Done.** All four are axe-checked open in `src/tests/a11y.test.tsx`. They run through
`expectNoViolationsIn`, which narrows the CONTEXT to the popup without disabling any rule —
Base UI portals menus to `document.body`, so at document scope every open menu trips
`region`. See CLAUDE.md's accessibility section.

## 4. Smaller gaps

- **No test pins "cached rows survive a failed refetch"** for the tenant switcher. Its
  preference for stale data over an error is verified by reading, not by a test.
- **`FormControl`'s `id` on a Base UI Checkbox is UNVERIFIED.** The Select case was
  measured and is safe — the id lands on the visible `role="combobox"`. Nothing wires a
  Checkbox yet; measure rather than assume symmetry.
- **Base UI Select change events do not bubble**, so `<Form>`'s server-error clearing rule
  is dead for them and such controls must call `serverErrors.clearField()` themselves.
  Documented in `form.tsx`; `$slug.members.tsx` is the worked example.
- **Two devtools devDependencies are referenced by nothing.** Removing them is a lockfile
  change that CI runs `--frozen-lockfile` against.

## 5. Known limits we accepted

- **`aria-hidden-focus` is INCOMPLETE under jsdom** in both overlay tests — a
  still-tabbable background behind an open dialog is precisely what cannot be caught here.
  Needs a browser.
- **axe colour-contrast is disabled by jest-axe under jsdom.** A green axe run is not a
  contrast check.
- ~~**The member table's horizontal scroll** is reasoned CSS; jsdom cannot demonstrate
  it.~~ **CLOSED.** Measured at 390×844: `scrollWidth 672` against `clientWidth 326`, page
  itself not overflowing. It worked — but the scroll put the Actions column and the
  last-owner sentence off-screen, so the members list now **stacks as cards** below the
  mobile breakpoint and the table is desktop-only. `e2e/fixtures/members.test.ts`.
- **`/auth/refresh` returning 403 or 419** leaves the user stuck signed-in-but-broken
  rather than bounced. Neither status is in the backend's emitted set, and the alternative
  is the false sign-outs that took two fix rounds to remove.
- **Two tabs share one rotating refresh cookie** while each holds its own in-flight
  singleton, so a concurrent refresh can hand the loser a genuine 401 though the account is
  fine. Pre-existing, not introduced by Phase A. Note this also means "single-flight across
  tabs" is not an implemented property — it cannot be verified because it does not exist.
- **Unread notification count is derived from loaded pages** — the API exposes no
  unread-count endpoint.
- **Notification preferences render read-only.** `CONFIGURABLE_NOTIFICATION_TYPES` is empty
  server-side, so every toggle would 400. `useUpdatePreferences` stays exported and
  wire-tested for the day a disableable type ships.

## 6. Out of scope — these are express-boilerplate changes

Recorded in the spec's out-of-scope list, not oversights:

- A **change-password** endpoint. `updateProfileSchema` is exactly `{firstName?, lastName?}`.
- An **auth-providers** endpoint. The table exists server-side; nothing exposes it.
- **CORS.** Phase A is same-origin behind a proxy precisely because there is none.
- A **single-use SSE stream ticket.** The access token currently rides in the stream URL
  because `requireAuth` reads only a Bearer header and `EventSource` cannot set one. It is
  kept out of both nginx logs, at server and location level, but the proper fix is a
  short-TTL ticket issued by POST.

## 7. Content-Security-Policy

Deliberately not shipped. `index.html` carries the inline pre-paint theme script, which
must run before the bundle or dark-mode users see a flash of light. `script-src 'self'`
blocks it and `'unsafe-inline'` defeats the point. The honest fix is a SHA-256 hash of that
exact script in the policy, regenerated by a build step so it cannot rot.

A wrong CSP is worse than none: it either breaks the theme script or teaches people to add
`'unsafe-inline'`.

## 8. ~~Phase B is blocked on one decision~~ — SETTLED 2026-09-22

StyleSeed's bundled scaffold declares 19 `@radix-ui/react-*` packages, so its 32 primitives
are Radix-based. Phase A is Base UI. They cannot both own `src/components/ui/`.

**Settled: option 1, and the conflict turned out not to exist.** StyleSeed's gate chain
references neither Radix nor `engine/components`; `ss-component` reads the project's own
primitives; the 19 `@radix-ui/*` packages live only in a fresh-project scaffold. Base UI owns
`src/components/ui/` permanently — see `STYLESEED.md` and
`../specs/2026-09-22-phase-b-styleseed-design.md`. Playwright is installed and `ss-verify`
has been run.

The options as they were recorded:

1. **Take StyleSeed's method, not its primitives** (recommended) — adopt `ss-setup`,
   `ss-tokens`, the compiled grammar and the `ss-lint`/`ss-a11y`/`ss-audit`/`ss-score`/
   `ss-verify` gate chain, keeping Base UI components. Loses the 32 tuned primitives; keeps
   one primitive library.
2. Swap to StyleSeed's Radix primitives, discarding Phase A's Base UI work.
3. Run both — rejected: two accessibility models, two bundles.

Phase B also needs Playwright for `ss-verify`, and a decision on whether that render gate
runs in CI or locally only.
