# Security

This file is for developers and reviewers of the browser client and the
container that serves it. It says what the app defends against, how, and
where the defences stop.

The API it talks to, express-boilerplate, owns these, and its own
`SECURITY.md` covers them:

- every authorization decision;
- the refresh cookie;
- rate limits;
- cross-origin resource sharing (CORS);
- cross-site request forgery (CSRF) protection.

## Threat model for a browser client

The app is a static bundle served by nginx, same-origin with the API it
proxies under `/api`. Whoever runs the page can read anything in the bundle,
in `/runtime-config.js` or in browser storage. So:

- **The browser enforces nothing.** A hidden button, a route guard or a
  flag-gated page (`src/observability/flags/require-client-flag.ts`) is
  presentation. The API refuses what the user may not do, so a gated page
  must be backed by a gated API route.
- **A same-origin script is the main threat.** It could read the in-memory
  access token and call the API as the user. The defences:
  - React's escaping: no `dangerouslySetInnerHTML` or `innerHTML` anywhere in
    `src/`;
  - an enforced Content Security Policy (CSP) that admits only the third-party
    script hosts it lists and no inline script
    ([CSP and headers](#csp-and-headers)).
- **Credentials leave the browser only towards the API.** The access token
  travels in an `Authorization` header, never a URL. The refresh token is an
  httpOnly cookie the client never reads.
- **Shared browsers and multiple tabs.** A tab must never act as, or
  attribute events to, someone other than its own signed-in user. The risks:
  - One refresh cookie serves every tab.
  - Where express's `COOKIE_DOMAIN` covers this app's host and apex's (the
    staff console), that cookie is apex's too. A sign-in there as someone else
    ends this tab's session at its next refresh (`SessionIdentityChangedError`,
    below).
  - Where the app's analytics configuration shares it
    (`src/observability/telemetry/config.ts`), the analytics identity cookie
    is shared with a website on a sibling subdomain.
  - The analytics opt-out and consent state is keyed by the PostHog project
    key alone. Another app served from this host with the same key shares it.
- **Third parties see as little as possible.** Analytics and error tracking
  go to PostHog through the API's `/api/v1/collect` proxy, after masking and
  scrubbing in the browser.

## Token storage and refresh

This section covers where the access and refresh tokens live, and the rules
that keep refreshes safe across tabs.

- **The access token is memory-only.** It lives in the zustand store
  (`src/states/auth.store.ts`) with the user, and nowhere else. It is never in
  `localStorage`, `sessionStorage`, a cookie or a query string, and the store
  has no `persist` middleware.
  - Every page load therefore starts signed out and restores the session with
    one refresh (`bootstrapSession` in `src/router.tsx`).
  - This keeps the token out of anything that outlives the page. It does not
    hide the token from a script running in the page.
- **The refresh token is an httpOnly cookie** that the browser sends with
  `withCredentials` (`src/http/client.ts`). It belongs to whichever origin
  answers `/api`. Its attributes are the API's.
- **The store is the only source of the bearer token.** The request
  interceptor (`src/http/interceptors.ts`) adds `Authorization: Bearer …` only
  when a request has none. A default `Authorization` header set anywhere would
  therefore shadow the store's token on every request.
- **The notification stream sends the token in a header.**
  - It is read with `fetch`, because `EventSource` cannot set a header. The
    token stays out of history, `Referer` and request-line logs
    (`src/hooks/use-notifications.ts`).
  - The parser throws on a frame that grows past 1,048,576 characters without
    completing, which ends that connection (`src/http/sse.ts`).
- **Trace and analytics headers go only to this app's API.** `traceparent`
  and `X-POSTHOG-SESSION-ID` are set only on same-origin requests under the
  API prefix. An absolute URL to another origin never carries them.
- **One refresh at a time.** `ensureSession()` in `src/http/session.ts` is the
  only caller of `POST /auth/refresh`.
  - Every caller in a tab awaits the same in-flight promise, and tabs queue
    behind the `auth-refresh` Web Lock.
  - The reason: each refresh rotates the shared cookie. The API revokes the
    whole session when a rotated token is presented again outside its
    10-second reuse grace window.
  - A second call site anywhere reintroduces that race.
- **A refresh that returns someone else ends this tab's session.** The
  refresh loads `/profile` with the new token. The profile's id can differ
  from the tab's user, when another tab signed a different person in on the
  shared cookie. Then the refresh fails with `SessionIdentityChangedError`:
  - this tab signs out without broadcasting, so the other tab stays signed in;
  - nothing this tab started is replayed as the other person.

## Sign-out rules

This section lists when the app ends a session, and the rules for sign-in
links, landings and cross-tab messages.

- **Only an auth verdict signs a user out.** `isAuthVerdict` accepts exactly
  two things: a 401, and `SessionIdentityChangedError`.
  - These judge nobody: a 5xx during a rolling restart, a 429 from the
    rate-limited refresh, a malformed 200, a timeout or a network failure.
    Treating any of them as a verdict signs out every user during a deploy.
  - Widen it only with a status the API's refresh returns as a judgment on
    the caller's credentials.
- **The 401 interceptor** (`src/http/interceptors.ts`) distinguishes:
  - a 401 with `ACCESS_TOKEN_EXPIRED`: refresh once, replay once
    (`_retried` stops a loop), and send the user to `/login` only when the
    refresh failed with a verdict;
  - a 401 with `REAUTH_REQUIRED`: the sign-in is too old for the action,
    not a bad session; it rejects untouched, and `useStepUp().run` opens
    "Confirm it's you" and retries the action once ([Confirm it's
    you](#confirm-its-you-in-this-app));
  - any other 401 on a request that carried a bearer token: sign this tab
    out, broadcast the logout and redirect to `/login`;
  - a 401 on a request with no token (a link request or a token page's
    verify): an answer about that request, not a session verdict.
- **`skipAuthRetry` opts a request out of both paths.** It is set on:
  - the two requests a refresh makes, because re-entering `ensureSession()`
    there would await itself;
  - `POST /auth/logout`;
  - every request a signed-out visitor makes with a mailed link: the link
    request, the link verify, and the invitation preview, verify and confirm,
    each sent with no bearer.
- **Every tab follows a sign-out.** A sign-out posts `logout` on the `auth`
  BroadcastChannel. A tab that hears it while signed in clears its store and
  loads `/login`. A tab that is not signed in ignores it. A refresh that fails
  in such a tab broadcasts nothing, so it cannot sign out a sibling tab that
  just signed in.
- **A sign-in in one tab reaches only a tab that waits for it.** The page
  that spends a sign-in or invitation-confirm link posts `signed_in`, with no
  data.
  - Only a tab with a link out listens: the sign-in form's "Check your inbox"
    step, and the accept page while its confirmation link is out (its Try
    again panel after a failed Resend included).
  - The listener acts only while its tab is signed out. It restores the shared
    session through `ensureSession()`, the same refresh as a reload, so the
    message itself grants nothing.
  - A tab that is already signed in ignores it.
- **A link never signs in over another account.** When a sign-in or
  invitation link opens in a tab signed in as someone else, the page asks
  first.
  - "Continue" signs the current account out through the API (every tab hears
    the logout). It reloads the page signed out before it posts the token, so
    the token never travels with the other account's bearer.
  - A verify that still finds a different user in the store switches identity
    fully before it signs in. It clears the query cache, palette recents and
    analytics identity, and broadcasts the switch.
- **The page names the address it signs in.** This is the mitigation for
  login CSRF, which any emailed link allows: an attacker's own link would sign
  a victim into the attacker's account. Naming the address lets the victim see
  whose account it is.
  - A link carries its address, and the sign-in page sends it back with the
    token. Express refuses a mismatch without spending the link.
  - While verifying, the page shows the link's address, then the address the
    server signed in. The confirm page does the same with its link's address.
  - The accept page names only the address from the server's preview or
    answer, never one from the URL.
- **Choosing to sign out** (`useLogout` in `src/queries/auth.queries.ts`)
  asks the API first.
  - The local session ends when the API confirms, or answers 401 because its
    session is already over.
  - A network error, 5xx or 429 leaves the user signed in with an error toast,
    so a sign-out never only looks done.
- **A sign-out is a full page load.** `redirectToLogin()` and `useLogout`
  use `window.location.assign`, which discards every in-memory cache.
- **Identity follows the user.** When the store's user changes or clears,
  analytics resets, and every flag value and exposure mark is dropped
  (`installAnalyticsIdentity` in `src/http/session.ts`). The next person never
  sees or sends the last one's.
- **A landing cannot leave the origin.** `safeRedirect`
  (`src/lib/safe-redirect.ts`) accepts only a value that:
  - starts with `/`;
  - the URL parser resolves to this origin;
  - has a path that does not start with `//`;
  - has a resolved path of at most 2048 characters, the API's limit.

  It refuses `/\t/evil.example` and `/..//evil.example`. Every landing passes
  through it: `/login`'s `?redirect=`, the link's `redirect` hint, the verify
  response's `redirect` and the Google callback's `?redirect=`. `/login` drops
  an unsafe hint rather than sending it.

- **No landing and no carried redirect is ever a token page** (`safeLanding`
  in `src/lib/landing.ts`).
  - Carried, its token would be mailed again inside the next link.
  - Landed on, the page on screen would never act on it.
  - `safeLanding` decodes the path before the check, as the router does
    before it matches. So `/auth/%6Cink` counts as `/auth/link`, and a path
    that does not decode is refused.

  Each landing replaces the token page in history, so Back never returns to
  it.

- **A sign-in link with no address is never posted.** The API compares the
  link's `email` with its token, to stop another person's link signing a
  visitor in. So `/auth/link` treats a token with no `email` as no token at
  all.
- **A token is posted once per page load.** `/auth/link` and the invitation
  pages post their token from a mutation that a ref-guarded effect fires.
  StrictMode's second run and a re-render therefore never spend the link
  twice.
  - A query would post it again on refocus or reconnect.
  - The invitation preview is a query because it spends nothing.
  - Every verify is sent with no bearer and `skipAuthRetry`.
- **No password anywhere.** Sign-in is by emailed link or Google. No page,
  form, schema or query takes a password. `/register`, `/forgot-password`,
  `/reset-password` and `/verify-email` only redirect to
  `/login?notice=sign-in-link`, dropping their `?token=` before anything
  renders.

## Passkeys

Express is the relying party, the server that registers and checks
passkeys; this app only runs the browser half. Why each rule holds:

- **The relying-party ID (RP ID) comes from the API.**
  `GET /auth/passkeys/config` returns `rpId`, and the options the API signs
  carry it. The browser refuses a ceremony for an RP ID outside the page's own
  origin, so a wrong value fails closed. The app never builds an RP ID,
  challenge or credential parameter of its own.
- **User verification is the server's to require.** The options set
  `userVerification: 'required'` and express checks the verified flag on
  every answer. Nothing in the browser can lower it; a hand-built request
  that skips it is refused by the API.
- **A passkey is checked by the server, never by the app.** The app posts
  the browser's response with its `challengeId` and trusts only the API's
  answer.
- **The WebAuthn package loads on demand.** `src/lib/webauthn.ts` is the only
  importer of `@simplewebauthn/browser`, through one cached `import()`.
  `pnpm check:bundle` fails if it reaches a first-visit chunk. A failed import
  surfaces as a prompt failure, never as a hang.
- **Signals tell the browser what the server knows, and nothing else.** The
  app calls these browser methods:

  | After                                    | Method                         |
  | ---------------------------------------- | ------------------------------ |
  | A refused credential (`PASSKEY_UNKNOWN`) | `signalUnknownCredential`      |
  | A delete                                 | `signalAllAcceptedCredentials` |
  | A create or rename                       | `signalCurrentUserDetails`     |

  The data is the credential ids the account already holds, its user handle,
  and its name and address. It goes to the browser's own passkey store, not
  the network. Each call is feature-detected and fire-and-forget.
  `PASSKEY_SIGNALS` in `src/lib/webauthn.ts` turns each off for a browser
  that misbehaves.

- **Passkey names are personal data.** A name is whatever the person typed,
  or the device's name.
  - The list and both dialogs wrap it in `<Pii>`.
  - `mask-attribute.ts` masks the row buttons' `aria-label`.
  - `e2e/fixtures/pii.test.ts` scans them.
- **Analytics sees the ceremony, not the passkey.** `passkey_prompt_cancelled`
  carries `sign_in`, `create` or `confirm` and nothing else.
  `sign_in_completed.method` can be `'passkey'`.
- **Required mode is enforced by the API.** The setup screen is a convenience.
  Until the account holds a passkey, the API answers 403
  `PASSKEY_SETUP_REQUIRED` to every other authenticated route, whatever the
  page shows. The notification stream stops on that refusal instead of
  retrying.

### Confirm it's you in this app

These writes need a recent sign-in: tenant invitations and members, creating
and deleting a passkey, and signing out other sessions. Express refuses them
with 401 `REAUTH_REQUIRED`. The "Confirm it's you" dialog then confirms in one
of two ways:

- by passkey (`/auth/passkeys/step-up/*`);
- by an emailed link that opens `/auth/confirm` in the browser that asked.

Rules:

- **Google cannot confirm.** It cannot prove a fresh sign-in, so there is no
  "Re-confirm with Google"; the options are the passkey and the email link.
- **A confirmation swaps the access token and nothing else.** `setToken` keeps
  the user, so a confirmation never changes who is signed in.
- **`/auth/confirm` posts its token once per page load**, with the session's
  bearer, and drops `token` from the address bar once the outcome is final. It
  is a token page: see [CSP and headers](#csp-and-headers).
- **The link opens in the browser that asked.** The page tells the waiting
  tab through the `auth` channel and the `step-up-wait` Web Lock. Where the
  browser cannot say whether a tab waits, the page says to return to it.

## CSP and headers

This section lists the headers nginx sends and what nginx logs. It also says
why each part of the Content Security Policy holds. nginx sends these headers on
every response it answers itself (`nginx.conf`):

| Header                       | Value                                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | see below                                                                                                                     |
| `Referrer-Policy`            | `no-referrer`                                                                                                                 |
| `X-Content-Type-Options`     | `nosniff`                                                                                                                     |
| `X-Frame-Options`            | `DENY`                                                                                                                        |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups`                                                                                                    |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com"), usb=()` |

The policy is enforced, not report-only:

    default-src 'self';
    script-src 'self' https://checkout.razorpay.com https://cdn.razorpay.com;
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https://cdn.razorpay.com;
    connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com;
    frame-src https://api.razorpay.com https://checkout.razorpay.com;
    object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'

- **No script is inline.**
  - The pre-paint scripts are the files `public/theme-init.js` and
    `public/boot-variant.js`, each loaded by a blocking `<script src>`.
    `/runtime-config.js` is same-origin.
  - Never add an inline script, `'unsafe-inline'` or `'unsafe-eval'` for
    scripts.
  - The only other script hosts are Razorpay Checkout's (below).
  - `src/lib/zod-jitless.ts` turns off Zod's just-in-time (JIT) compiler,
    whose `new Function` probe this policy reports as a violation. It is the
    first import of `src/main.tsx` and of every source file that imports Zod
    as a value.
- **`style-src 'unsafe-inline'`** is there for two reasons:
  1. Base UI's `Select` popup renders a `<style>` element that hides its
     scrollbar. So does `ScrollArea`, which the app does not use.
  2. `index.html` carries the boot shell's inline `<style id="boot-tokens">`
     and `<style id="boot-shell">` blocks, so the first paint needs no
     stylesheet request. A static `index.html` cannot carry a nonce, and only
     a hash source per block could stand in for the keyword.

  React applies `style` props through the CSS Object Model (CSSOM), which the
  policy does not govern. The toast's and the sidebar's inline CSS variables
  therefore do not need the keyword. Base UI's `CSPProvider` with
  `disableStyleElements` would remove the first reason, not the second, so the
  keyword stays while the shell is inline.

- **The app's own requests stay on `'self'`.** The API, analytics and error
  tracking are all same-origin. posthog-js sends to `/api/v1/collect` and
  loads its recorder from there, so the browser never talks to PostHog.
  Calling another origin from the browser means widening the policy in
  `nginx.conf` in the same change.
- **Razorpay Checkout is the one third party, and its hosts are provisional.**
  `src/lib/razorpay-checkout.ts` loads
  `https://checkout.razorpay.com/v1/checkout.js` on demand. It has no
  `integrity` hash, because Razorpay serves it unversioned, so the policy pins
  the host instead. The policy allows Razorpay in:

  | Directive     | Razorpay hosts                                                                                    |
  | ------------- | ------------------------------------------------------------------------------------------------- |
  | `script-src`  | `checkout.razorpay.com`, and `cdn.razorpay.com` for the risk-detection script `checkout.js` loads |
  | `frame-src`   | `api.razorpay.com`, `checkout.razorpay.com`                                                       |
  | `connect-src` | `api.razorpay.com`, `lumberjack.razorpay.com`                                                     |
  | `img-src`     | `cdn.razorpay.com`                                                                                |

  These hosts are **provisional**:
  - `e2e/nginx/razorpay-checkout.test.ts` needs Razorpay's servers, so it runs
    only in live nginx runs (`E2E_LIVE=1`). It proves only that the script
    loads and defines `window.Razorpay` with no violation.
  - Opening a real Checkout needs a live API with Razorpay test keys. The
    billing live walk opens one; it confirms the final list and records it
    here.
  - A missing host blocks payment only in production.

  Two more headers serve Checkout:
  - `Permissions-Policy` lets the two Razorpay frame hosts use `payment`.
  - `Cross-Origin-Opener-Policy` (COOP) is `same-origin-allow-popups`. Unified
    Payments Interface (UPI) intent and bank 3-D Secure pages open as popups,
    which `same-origin` would cut off from the page.

  `Referrer-Policy` stays `no-referrer` unless the live walk shows Checkout
  refusing it.

- **Session replay starts no worker.** Recording `<canvas>` content would
  start a `blob:` worker, which `script-src 'self'` blocks (`worker-src`
  falls back to it). The options pin
  `session_recording.captureCanvas.recordCanvas: false`. That overrides the
  PostHog project's replay setting, so the project cannot turn canvas
  recording on. `e2e/nginx/analytics.test.ts` asserts that replay records
  under this policy with no worker and no violation.
- **No location declares an `add_header`.** In nginx, a location that sets
  any header of its own inherits none of the server block's. It would
  silently drop every security header. Cache-Control is therefore chosen by a
  `map` on the URI. The security headers carry `always`, so error responses
  get them too.
- **A proxied API response keeps its own headers.** nginx adds each header
  above only when the upstream response lacks it.
  - Express's stricter API values (`default-src 'none'`,
    `X-Frame-Options: SAMEORIGIN`) pass through.
  - No header is sent twice. Two `Cross-Origin-Opener-Policy` lines do not
    parse, and COOP then falls back to `unsafe-none`.
  - nginx's own 502 or 504 for an `/api/` request carries the full set.
- **No HTTP Strict Transport Security (HSTS).** The Transport Layer Security
  (TLS) edge decides whether TLS fronts this container and which hosts the
  policy covers. So `Strict-Transport-Security` is set there, not in
  `nginx.conf`.
- **The access log keeps no query string.** Its server-level format records
  `$uri`, not `$request`. Every single-page app (SPA) route falls back to
  `index.html`, including the token pages, whose tokens are credentials
  mailed to users:
  - `/auth/link?token=…&email=…`
  - `/auth/confirm?token=…`
  - `/invitations/accept?token=…`
  - `/invitations/confirm?token=…&email=…`

  `Referrer-Policy: no-referrer` on every response keeps a token page's URL
  out of the referrer the browser sends to any request it makes, and out of
  the logged referrer. The pages carry no `<meta name="referrer">`: the header
  covers them in production, and dev has no nginx and nothing secret to leak.
  Each page posts its token in a request body, so it stays out of request
  URLs and logs (`src/queries/auth.queries.ts`,
  `src/queries/invitation.queries.ts`).

- **The error log can keep one.** nginx writes the full request line, query
  string included, into every upstream error message, and no log format
  changes that.
  - The leak happens at every level up to `error`, so the level (`notice`,
    `docker/nginx.main.conf`) does not matter. Only `crit` drops it.
  - The notification stream's location and the Google Open Authorization
    (OAuth) callback's
    (`location ~* ^/api/v1/auth/google/callback/?$`) set their error log
    level to `crit`, which silences those messages there.
  - No other location does (see [Known gaps](#known-gaps)).
- **No source map is served.** The image deletes every `.map` after the
  upload. `nginx.conf` answers 404 for any `.map` path outside `/api/`, even
  where a file exists. A deploy of `dist/` outside the image must delete
  `*.map` first.
- `server_tokens off` drops the nginx version from the `Server` header and
  error pages.

**Checks.** The `nginx` Playwright project checks the headers and asserts
zero CSP violations (`e2e/nginx/headers.test.ts`, `e2e/nginx/csp.test.ts`,
`e2e/nginx/csp-live.test.ts`, `e2e/nginx/razorpay-checkout.test.ts`).
`docker/check-image.sh` checks the built image from outside:

- user 101 and a read-only root;
- each header sent once on proxied and unproxied responses;
- no source map in the image;
- a refused run-time setting that stops the container without printing its
  value;
- an upstream error on the Google OAuth callback (exact, with a trailing
  slash, or in mixed case) that writes none of its query string to the log,
  while another `/api/` path still logs its request;
- a bundle that carries its release and no release id written by inject.

## Run-time config injection safety

Settings that differ between environments reach the bundle at container
start, never at build time, as `/runtime-config.js`. The variables, their
patterns and defaults are in the
[README's run-time configuration table](README.md#run-time-configuration).

- **Values are validated before they are written.**
  `docker/10-runtime-config.sh` checks each non-empty value against its
  pattern and refuses one containing a newline.
  - No pattern admits a quote, a backslash, `<` or a newline. So the script
    writes each value into a JavaScript string literal unescaped, and the
    value cannot break out of it.
  - A mismatch stops the container. The error names the variable and never
    prints its value.
- **The file is replaced atomically.** It is written beside the target and
  renamed, so nginx never serves a half-written file. It sets
  `window.__APP_CONFIG__` with `Object.freeze`. nginx serves it `no-store`.
- **The bundle validates again.** `src/configs/runtime-config.ts` applies the
  same patterns.
  - An invalid value counts as unset, with one exception:
    `ANALYTICS_CONSENT_MODE` fails closed to `off`. It does not fall back to
    capturing in an app whose `config.ts` honours consent modes.
  - A handoff origin list with one origin that `URL` refuses is dropped whole.
  - Its console warning names the keys, never the values.
  - A production bundle reads only `window.__APP_CONFIG__`, so no build-time
    value can configure it.
- **Every value is public.** Each browser fetches `/runtime-config.js`, so
  nothing secret goes in it. The PostHog project key may come from a secret
  store, but it is not a secret.
- **`API_UPSTREAM` is checked too.** `docker/05-prepare.sh` refuses anything
  but `http(s)://host[:port]` with no path. envsubst substitutes only that
  variable into `nginx.conf`. A value can therefore neither rewrite the
  proxied URI nor inject nginx syntax or variables. Its refusal message never
  shows the value.

## Analytics privacy

This section lists what analytics capture, mask and withhold, and which
checks guard each rule. posthog-js loads only when a PostHog key is set and
the consent mode is not `off`. It loads through a dynamic `import()` kept out
of the first-visit chunks (`pnpm check:bundle`). Without it, every call is a
no-op.

Three behaviours depend on per-app constants in
`src/observability/telemetry/config.ts`. The bullets that rely on them say
so:

| Behaviour                                                     | Constant                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Whether consent modes are honoured                            | `SUPPORTS_CONSENT_MODES`; an app that says no always runs `opt_out` |
| Whether the cross-domain handoff is read                      | `SUPPORTS_HANDOFF`                                                  |
| Whether the identity cookie is shared with sibling subdomains | `ANALYTICS_PERSISTENCE_NAME`, `ANALYTICS_CROSS_SUBDOMAIN_COOKIE`    |

The query-key allowlist is set there too.

- **Typed events carry no free text.** Every event and its properties are
  declared in `src/observability/telemetry/event-registry.ts`.
  - A property typed as any string fails `REGISTRY_HAS_NO_FREE_STRINGS` at
    compile time.
  - A key passed to `analyticsKey` must be a lowercase literal without a
    space, `@`, `.`, `/`, `:`, `?`, `=`, `&` or `#`.
  - A free string is how a name, an address or a search term reaches an
    event; do not widen it.
- **The browser never sets person or group properties.** `identify` takes the
  user id alone, and the tenant group is set by id. The server sets staff
  status, roles and tenant names, where a user cannot forge them from
  devtools.
- **Rendered personal data is masked.** Every rendered person name, email
  address, avatar initial and invitation address is wrapped in `<Pii>`
  (`src/components/shared/pii.tsx`). Its `ph-sensitive ph-mask` class keeps the
  text out of autocapture's `$el_text` and masks it in replay.
  - Wrap the value, not the sentence.
  - Inputs are masked in replay, and autocapture masks every element
    attribute.
- **Replay masks attributes by name** (`mask-attribute.ts`). These become
  `***`:
  - `aria-label`, `title`, `alt`, `placeholder` and `srcdoc`;
  - every `data-*`;
  - an `href` with a query or a `mailto:`/`tel:` scheme;
  - a `src` or `srcset` with a query.

  That is why an accessible name may carry an address; an attribute outside
  the list may not. Replay records no request headers, bodies or JSON-LD
  (JSON for Linked Data), and each recorded request URL is sanitised.

- **Captured URLs keep only allowlisted query keys.**
  `ANALYTICS_URL_QUERY_ALLOWLIST` (`src/observability/telemetry/config.ts`)
  is the whole list: `tab`, and the Urchin Tracking Module (UTM) campaign
  keys express puts on every link it mails (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`). A
  mailed link's landing page view keeps its campaign, while its `token` and
  `email` go.
  - The sanitizer keeps a `utm_*` value only when it matches
    `^[a-z0-9_-]{1,64}$`, the shape of every value express sends. Otherwise
    it drops the key with its value. An `@`, a `.`, uppercase, or a value
    longer than 64 characters never reaches PostHog.
  - The sanitizer (`src/observability/telemetry/url-sanitizer.ts`) runs as
    `before_send`. It rewrites every absolute http(s) string in an event's
    properties, `$set` and `$set_once`, to eight levels deep. It also rewrites
    the hrefs in `$elements` and `$elements_chain` and the keys of
    `$heatmap_data`.
  - The fragment goes, and a `mailto:` or `tel:` URL keeps only its scheme.
  - posthog-js's own personal-data masking also covers `token`, `email`,
    `redirect`, `invitation`, `q`, `search`, `ph_did` and `ph_sid`.

  Add a key to the allowlist only when its values can never be a token, an
  address, a search term or a redirect. The `utm_*` keys are the one
  exception. Their values arrive from the URL, so the sanitizer's value check
  above is what keeps an address or a token out (the UTM rule of 19 October
  2026).

- **Events never cross people** (`guardEvent` in
  `src/observability/telemetry/telemetry.ts`). posthog-js adopts the identity
  cookie before every event. Where `config.ts` shares that cookie, a
  sibling-subdomain website can change it. So while a user is signed in, any
  event under another distinct id is dropped.
  - Another tab of this app may have identified that person, announced on
    the `analytics-identity` channel or written to a 60-second `localStorage`
    registry. Then this tab is superseded: it drops its events and refreshes
    its session to settle who is signed in.
  - Otherwise the user is identified again after 250 ms.
  - Never loosen the guard to log-and-send.
  - A sign-out resets the PostHog software development kit (SDK) but keeps
    the browser's consent answer.
- **The session header never links another person.** `X-POSTHOG-SESSION-ID`
  is sent only while capture is on (in `required` mode, once consent is
  granted) and PostHog holds either nobody or the signed-in user.
- **Consent** (modes honoured per `config.ts`).
  - In `opt_out` mode, capture runs until the user turns off the profile's
    analytics switch.
  - In `required` mode, no analytics event is captured until the banner is
    accepted. A refusal leaves only cookieless, server-hashed counts
    (`cookieless_mode: 'on_reject'`).
  - Each user's own opt-out is applied before they are identified, so an
    opted-out user's identify is never captured.
  - Consent holds back the SDK's own events and replay only. Exception
    reports and flag exposure are sent whatever the answer (see below).
- **The cross-domain handoff is narrow** (`handoff.ts`, read only where
  `config.ts` enables it). A link's `?ph_did=&ph_sid=` is accepted only:
  - in `opt_out` mode;
  - from an allowlisted referrer;
  - into a browser that holds no identified person;
  - once per id.

  The full conditions, and what they do not stop, are in
  [docs/analytics-handoff.md](docs/analytics-handoff.md). Both parameters
  leave the address bar on every load, accepted or not.

- **Guards.**
  - `e2e/fixtures/pii.test.ts` checks that every probe name and address on
    the main pages sits inside `<Pii>`.
  - `e2e/nginx/analytics.test.ts` searches everything that reached a fake
    PostHog, decoded, after a route walk that includes token-carrying URLs.
- **Flag exposure ignores consent.** The flag hooks report experiment keys,
  never values, to the API's exposure endpoint, whatever the analytics consent
  (`src/observability/flags/exposure.ts`). The API re-evaluates each key. It
  records the exposure in PostHog for a user who matched a release condition
  or is in the holdout.

## Error-tracking privacy

This section covers what browser error reports carry and what they never
carry. Browser exceptions go to PostHog Error Tracking through the API's
`/api/v1/collect/batch/` proxy whenever a PostHog key is set and the consent
mode is not `off` (`src/observability/errors/report.ts`).

The consent answer does not stop them. With consent pending or refused, or
after a profile opt-out, an exception is still sent, anonymous. Only the
SDK's own events and replay wait for consent.

- **What is dropped before anything is built:**
  - API and network failures (the API reports its own 5xx);
  - aborts;
  - ResizeObserver noise;
  - a cross-origin `Script error.` with no stack;
  - any error with no frame from this app's own files (an extension's),
    except a failed chunk load.
- **What is scrubbed:** every exception's type and value, and every frame's
  file name and function name, through `scrubText`
  (`src/observability/errors/scrub.ts`). The page URL is reduced to the
  analytics allowlist's query keys, then its path is scrubbed. No request,
  header or form data is attached.
- **Identity follows analytics consent.** An exception carries PostHog's
  distinct id, session and tenant group only when all of these hold:
  - analytics consent allows it;
  - the tab is not superseded;
  - PostHog's person is this tab's signed-in user. While nobody is signed in,
    it is whoever PostHog holds, normally anonymous.

  Otherwise the exception is anonymous: a fresh distinct id per event and no
  person profile. Two more cases are sent anonymous, so they are never
  attributed to the next person:
  - an error noted more than 10 seconds before the lazy reporter received it;
  - an error noted before the user, the tenant group or the tab's standing
    changed.

- **Volume is capped:** 5 events per fingerprint and 30 per page life.

### The scrubber

`scrub.ts` is express-boilerplate's
`express-boilerplate/src/services/errors/error-scrubber.service.ts` byte for
byte. Both are tested against the same
`tests/fixtures/error-scrub-vectors.json`. A rule therefore changes in express
first and is copied here, never edited here alone.

It replaces:

- Postgres key details and echoed input;
- URL credentials, query strings, and fragments other than line or heading
  anchors;
- the token segment after `/reset/`, `/verify/`, `/invite/` or `/accept/`;
- Bearer, Basic and other Authorization credentials, with Bearer and Basic
  taking the unquoted or quoted `,key=value` or `;key=value` pairs glued to
  them;
- Cookie values and secret-named keys' values;
- JSON Web Tokens (JWTs), emails, and PostHog and other vendor keys;
- Internet Protocol (IP) addresses and `+`-prefixed phone numbers;
- long hex and base64 runs.

It then cuts each text to 1024 characters.

### What it does not catch

Regex scrubbing is best-effort: keep secrets and personal data out of error
messages. It leaves these in place, among others:

- names and other free text;
- ids, universally unique identifiers (UUIDs) included, kept on purpose for
  debugging;
- phone numbers in national format, without a leading `+`;
- a bare opaque word with no key in front of it;
- a `code` value outside a query, a form body or an OAuth context, and a
  `key` value written with `:`, so `code: 'ECONNREFUSED'` stays readable;
- a camelCase `pin` (`userPin=1234`);
- vendor tokens with no rule, such as `ya29.` and `glpat-`;
- the text after a Bearer credential on an Authorization line
  (`Bearer [token] extra` keeps `extra`);
- a `Bearer` or `Basic` glued to a letter from `g` to `z` or a `_`
  (`xBearer abc`, `_Bearer abc`), and a fully URL-encoded header
  (`Bearer%20abc%2Crefresh%3Dxyz`);
- pairs after a credential that a secret key's value took
  (`token=Bearer abc,refresh=xyz`), and a quoted pair value glued to more
  text or split by a line break.

The comments in `src/observability/errors/scrub.ts` list what each rule
catches and what it misses.

## Known gaps

This section lists what the defences above do not cover.

- **The container trusts its front.** Every request arrives from the TLS
  terminator's address (`docker/nginx.main.conf`), so nginx:
  - appends to the client's `X-Forwarded-For`;
  - passes on a client-supplied `X-Forwarded-Proto` of `http` or `https` in
    any letter case, lowercased (any other value becomes `http`);
  - sets no per-IP connection limit.

  Expose the container only through that terminator.

- **The error log can hold query strings.** nginx writes the full request
  line into every upstream error message, at the `error` level.
  - Lowering the log level from `notice` changes nothing. Only `crit`
    silences it, and with it the reason for the upstream failure.
  - The notification stream's location and the Google OAuth callback
    (`location ~* ^/api/v1/auth/google/callback/?$`, whose `code` and `state`
    are credentials) set their error log to `crit`.
  - Every other path under `/api/` still writes its query string on an
    upstream error.
- **HSTS is the edge's job.** See [CSP and headers](#csp-and-headers).
- **Inline styles are allowed** (`style-src 'unsafe-inline'`), for Base UI's
  `Select` popup and the boot shell's inline `<style>` blocks. An injected
  `<style>` cannot run script, but it can restyle the page.
- **The in-memory token is reachable by an injected script.** Memory-only
  storage stops persistence, not same-origin code; the CSP and React's
  escaping are what keep such code out.
- **Without Web Locks** (an insecure context or an old browser), refreshes
  in different tabs are not serialised, and the API's 10-second reuse grace
  window is the only cover for concurrent rotations.
- **The cross-tab identity registry narrows a race; it does not close it.**
  A tab whose event loop stalls past the 250 ms repair delay can still read
  another tab's storage write late.
- **Consent belongs to the browser, not the person.** The banner's answer
  survives sign-out, so the next person on a shared browser starts with it.
- **Tenant slugs are not masked.** They appear in captured URL paths. Where
  the PostHog project records network requests in replay, the paths of
  tenant-scoped API calls (`/tenants/:slug/…`) carry the tenant's slug.
- **Workspace names are in the tab title, not in events.** A workspace
  page's tab title carries the workspace's name. Events send the page-only
  title in its place (`sendTitleAs`,
  `src/observability/telemetry/sent-title.ts`), so a page view's `title`
  carries at most the page name. Replay records the tab title as shown, as it
  records the unmasked name in the page heading.
- **Error scrubbing is regex-based** and misses free text; see
  [What it does not catch](#what-it-does-not-catch).

## Reporting a vulnerability

Report a security problem privately through GitHub's private vulnerability
reporting on this repository: the **Security** tab, then **Report a
vulnerability**. Do not open a public issue for a security problem.
