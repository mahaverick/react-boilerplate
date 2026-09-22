# Open items after Phase A

Written 2026-09-22, when Phase A merged to `main`. Nothing here blocks that merge.
Companion to `2026-09-22-phase-a-decision-record.md`, which explains WHY the constraints
in the code exist; this file is what is NOT yet done.

Ordered by what would cost most if forgotten.

---

## 1. Three behaviours have never actually been executed

Each is unit-tested and inferred end to end. All three need a live API and a real browser,
which the test harness does not have. **This is the largest gap in Phase A.**

- **A reload keeps you signed in.** The access token is memory-only, so every reload
  starts unauthenticated and the root route's `beforeLoad` must restore the session before
  any guard runs. Unit-tested in `src/pages/guards.test.tsx`.
- **The SSE stream reconnects after a real backend restart.** The hook closes on error and
  reconnects through `ensureSession()` under exponential backoff. Unit-tested with a mock
  `EventSource`; jsdom has none of its own.
- **`X-Forwarded-Proto` reaches Express** and drives the `secure` cookie flag and
  `TRUST_PROXY`. The nginx directive is present and was verified by `curl -I`; the
  behaviour behind it is inferred.

Also inferred: SSE actually streaming unbuffered (`proxy_buffering off` being present is
not the same as watching chunks arrive), and the refresh cookie's `Path=/api/v1/auth`
surviving the proxy, which needs a real `Set-Cookie` round trip.

**How to close:** run the app against a live express-boilerplate and check the three by
hand. Thirty minutes of work that no amount of unit testing substitutes for.

## 2. The first cold CI run is the real test of the flake fix

Three tests failed on one of four full local runs before the fix (`findBy*` at Testing
Library's 1s default while 28 workers each spawn ~700ms). Fixed at the mechanism —
`asyncUtilTimeout: 5000` in `src/tests/setup.ts` plus `testTimeout: 20000` — deliberately
not with `retry`, which hides flakes rather than fixing them. The evidence is mechanistic;
a cold CI box is the only honest test.

## 3. No opened dropdown is axe-checked anywhere

The a11y gate's overlay block covers a dialog and a sheet. It covers no open menu.

This is not hypothetical. A page-crashing bug lived in exactly this blind spot through 234
passing tests and ten reviews: `DropdownMenuLabel` is Base UI's `Menu.GroupLabel` and
throws outside a `Menu.Group`, so opening the notification bell replaced the whole app with
the root error boundary — on every authenticated route. It was found only because an
unrelated fix made the error states unreachable without opening the menu.

Every overlay component now has a test that opens it, so the crash class is closed. Adding
the opened menus to the axe gate is the cheaper guard against a repeat: bell, tenant
switcher, user menu, theme toggle.

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
- **The member table's horizontal scroll** is reasoned CSS; jsdom cannot demonstrate it.
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

## 8. Phase B is blocked on one decision

StyleSeed's bundled scaffold declares 19 `@radix-ui/react-*` packages, so its 32 primitives
are Radix-based. Phase A is Base UI. They cannot both own `src/components/ui/`.

1. **Take StyleSeed's method, not its primitives** (recommended) — adopt `ss-setup`,
   `ss-tokens`, the compiled grammar and the `ss-lint`/`ss-a11y`/`ss-audit`/`ss-score`/
   `ss-verify` gate chain, keeping Base UI components. Loses the 32 tuned primitives; keeps
   one primitive library.
2. Swap to StyleSeed's Radix primitives, discarding Phase A's Base UI work.
3. Run both — rejected: two accessibility models, two bundles.

Phase B also needs Playwright for `ss-verify`, and a decision on whether that render gate
runs in CI or locally only.
