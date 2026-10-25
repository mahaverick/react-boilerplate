# Security

What this app defends against, how, and where the defences stop. The API it
talks to, express-boilerplate, owns every authorization decision, the refresh
cookie, rate limits, CORS and CSRF; its own `SECURITY.md` covers those. This
file covers the browser client and the container that serves it.

## Threat model for a browser client

The app is a static bundle served by nginx, same-origin with the API it
proxies under `/api`. Anything in the bundle, in `/runtime-config.js` or in
browser storage is readable by whoever runs the page, so:

- **The browser enforces nothing.** A hidden button, a route guard or a
  flag-gated page (`src/observability/flags/require-client-flag.ts`) is
  presentation. The API refuses what the user may not do, so a gated page
  must be backed by a gated API route.
- **A same-origin script is the main threat.** It could read the in-memory
  access token and call the API as the user. The defences are React's escaping
  (no `dangerouslySetInnerHTML` or `innerHTML` anywhere in `src/`) and an
  enforced Content-Security-Policy that admits no inline or third-party
  script ([CSP and headers](#csp-and-headers)).
- **Credentials leave the browser only towards the API.** The access token
  travels in an `Authorization` header, never a URL; the refresh token is an
  httpOnly cookie the client never reads.
- **Shared browsers and multiple tabs.** One refresh cookie serves every tab.
  Where express's `COOKIE_DOMAIN` covers this app's host and apex's, that cookie
  is apex's too, so a sign-in there as someone else ends this tab's session at
  its next refresh (`SessionIdentityChangedError`, below). Where the app's
  analytics configuration shares it (`src/observability/telemetry/config.ts`),
  the analytics identity cookie is shared with a website on a sibling
  subdomain. The analytics opt-out and consent state is keyed by the PostHog
  project key alone, so another app served from this host with the same key
  shares it. A tab must never act as, or attribute events to, someone other
  than its own signed-in user.
- **Third parties see as little as possible.** Analytics and error tracking
  go to PostHog through the API's `/api/v1/collect` proxy, after masking and
  scrubbing in the browser.

## Token storage and refresh

- **The access token is memory-only.** It lives in the zustand store
  (`src/states/auth.store.ts`) with the user, and nowhere else: never
  `localStorage`, `sessionStorage`, a cookie or a query string, and the store
  has no `persist` middleware. Every page load therefore starts signed out
  and restores the session with one refresh (`bootstrapSession` in
  `src/router.tsx`). This keeps the token out of anything that outlives the
  page; it does not hide it from a script running in the page.
- **The refresh token is an httpOnly cookie** that the browser sends with
  `withCredentials` (`src/http/client.ts`). It belongs to whichever origin
  answers `/api`. Its attributes are the API's.
- **The store is the only source of the bearer token.** The request
  interceptor (`src/http/interceptors.ts`) adds `Authorization: Bearer …`
  only when a request has none, so a default `Authorization` header set
  anywhere would shadow the store's token on every request.
- **The notification stream sends the token in a header.** It is read with
  `fetch`, because `EventSource` cannot set one, so the token stays out of
  history, `Referer` and request-line logs (`src/hooks/use-notifications.ts`).
  The parser throws on a frame that grows past 1,048,576 characters without
  completing, which ends that connection (`src/http/sse.ts`).
- **Trace and analytics headers go only to this app's API.** `traceparent`
  and `X-POSTHOG-SESSION-ID` are set only on same-origin requests under the
  API prefix; an absolute URL to another origin never carries them.
- **One refresh at a time.** `ensureSession()` in `src/http/session.ts` is
  the only caller of `POST /auth/refresh`. Every caller in a tab awaits the
  same in-flight promise, and tabs queue behind the `auth-refresh` Web Lock,
  because each refresh rotates the shared cookie and the API revokes the
  whole session when a rotated token is presented again outside its 10-second
  reuse grace window. A second call site anywhere reintroduces that race.
- **A refresh that returns someone else ends this tab's session.** The
  refresh loads `/profile` with the new token. When the profile's id differs
  from the tab's user (another tab signed a different person in on the shared
  cookie), the refresh fails with `SessionIdentityChangedError`: this tab
  signs out without broadcasting, so the other tab stays signed in, and
  nothing it started is replayed as the new person.

## Sign-out rules

- **Only an auth verdict signs a user out.** `isAuthVerdict` accepts exactly
  two things: a 401, and `SessionIdentityChangedError`. A 5xx during a rolling
  restart, a 429 from the rate-limited refresh, a malformed 200, a timeout or
  a network failure judges nobody; treating any of them as a verdict signs
  out every user during a deploy. Widen it only with a status the API's
  refresh returns as a judgment on the caller's credentials.
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
- **`skipAuthRetry` opts a request out of both paths.** It is set on the two
  requests a refresh makes (re-entering `ensureSession()` there would await
  itself), on `POST /auth/logout`, and on every request a signed-out visitor
  makes with a mailed link: the link request, the link verify, and the
  invitation preview, verify and confirm, each sent with no bearer.
- **Every tab follows a sign-out.** A sign-out posts `logout` on the `auth`
  BroadcastChannel; a tab that hears it while signed in clears its store and
  loads `/login`. A tab that is not signed in ignores it, and a refresh that
  fails in such a tab broadcasts nothing, so it cannot sign out a sibling
  that just logged in.
- **A sign-in in one tab reaches only a tab that waits for it.** The page
  that spends a sign-in or invitation-confirm link posts `signed_in`, with no
  data. Only a tab with a link out listens: the sign-in form's "Check your
  inbox" step, and the accept page while its confirmation link is out (its
  Try again panel after a failed Resend included). It acts only while it is
  signed out; it restores the shared session through `ensureSession()`, the
  same refresh as a reload, so the message itself grants nothing. A tab that
  is already signed in ignores it.
- **A link never signs in over another account.** When a sign-in or
  invitation link opens in a tab signed in as someone else, the page asks
  first. "Continue" signs the current account out through the API (every
  tab hears the logout) and reloads the page signed out before it posts the
  token, so the token never travels with the other account's bearer. A
  verify that still finds a different user in the store switches identity
  fully before it signs in: the query cache, palette recents and analytics
  identity are cleared, and the switch is broadcast.
- **The page names the address it signs in.** A link carries its address,
  and the sign-in page sends it back with the token; express refuses a
  mismatch without spending the link. While verifying, the page shows the
  link's address, then the address the server signed in. The confirm page
  does the same with its link's address. The accept page names only the
  address from the server's preview or answer, never one from the URL. This
  is the mitigation for login CSRF, which any emailed link allows: an
  attacker's own link would sign a victim into the attacker's account, so
  the victim sees whose account it is.
- **Choosing to sign out** (`useLogout` in `src/queries/auth.queries.ts`)
  asks the API first. The local session ends when the API confirms, or
  answers 401 because its session is already over; a network error, 5xx or
  429 leaves the user signed in with an error toast, so a sign-out never
  only looks done.
- **A sign-out is a full page load.** `redirectToLogin()` and `useLogout`
  use `window.location.assign`, which discards every in-memory cache.
- **Identity follows the user.** When the store's user changes or clears,
  analytics resets and every flag value and exposure mark is dropped, so the
  next person never sees or sends the last one's (`installAnalyticsIdentity`
  in `src/http/session.ts`).
- **A landing cannot leave the origin.** `safeRedirect`
  (`src/lib/safe-redirect.ts`) accepts only a value starting with `/` that the
  URL parser resolves to this origin, whose path does not start with `//`,
  and whose resolved path is at most 2048 characters, the API's limit. It
  refuses `/\t/evil.example` and `/..//evil.example`. Every landing passes
  through it: `/login`'s `?redirect=`, the link's `redirect` hint, the verify
  response's `redirect` and the Google callback's `?redirect=`. `/login` drops
  an unsafe hint rather than sending it. No landing and no carried redirect
  is ever a token page (`safeLanding` in `src/lib/landing.ts`): carried, its
  token would be mailed again inside the new link; landed on, the page on
  screen would never act on it. `safeLanding` decodes the path before the
  check, as the router does before it matches, so `/auth/%6Cink` counts as
  `/auth/link`, and a path that does not decode is refused. Each landing
  replaces the token page in history, so Back never returns to it.
- **A token is posted once per page load.** `/auth/link` and the invitation
  pages post their token from a mutation that a ref-guarded effect fires, so
  StrictMode's second run and a re-render never spend the link twice. A
  query would post it again on refocus or reconnect. The invitation preview
  is a query because it spends nothing. Every verify is sent
  with no bearer and `skipAuthRetry`.
- **No password anywhere.** Sign-in is by emailed link or Google. No page,
  form, schema or query takes a password, and `/register`,
  `/forgot-password`, `/reset-password` and `/verify-email` only redirect to
  `/login?notice=sign-in-link`, dropping their `?token=` before anything
  renders.

## Passkeys

Express is the relying party; this app only runs the browser half. Why each
rule holds:

- **The relying-party ID comes from the API.** `GET /auth/passkeys/config`
  returns `rpId`, and the options the API signs carry it. The browser refuses
  a ceremony for an RP ID outside the page's own origin, so a wrong value
  fails closed. The app never builds an RP ID, challenge or credential
  parameter of its own.
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
- **Signals tell the browser what the server knows, and nothing else.** After
  a refused credential (`PASSKEY_UNKNOWN`), a delete, and a create or rename,
  the app calls the browser's `signalUnknownCredential`,
  `signalAllAcceptedCredentials` and `signalCurrentUserDetails`. The data
  is the credential ids the account already holds, its user handle and its
  name and address, sent to the browser's own passkey store, not the network.
  Each is feature-detected and fire-and-forget, and `PASSKEY_SIGNALS` in
  `src/lib/webauthn.ts` turns each off for a browser that misbehaves.
- **Passkey names are personal data.** A name is whatever the person typed
  (or the device's name), so the list and both dialogs wrap it in `<Pii>`, and
  the row buttons' `aria-label` is masked by `mask-attribute.ts`
  (`e2e/fixtures/pii.test.ts` scans them).
- **Analytics sees the ceremony, not the passkey.** `passkey_prompt_cancelled`
  carries `sign_in`, `create` or `confirm` and nothing else;
  `sign_in_completed.method` gains `'passkey'`.
- **Required mode is enforced by the API.** The setup screen is a convenience:
  the API answers 403 `PASSKEY_SETUP_REQUIRED` to every other authenticated
  route until the account holds a passkey, whatever the page shows. The
  notification stream stops on that refusal instead of retrying.

### Confirm it's you in this app

Writes that need a recent sign-in (tenant invitations and members, creating
and deleting a passkey) are refused with 401 `REAUTH_REQUIRED`. The dialog
confirms by passkey (`/auth/passkeys/step-up/*`) or by an emailed link that
opens `/auth/confirm` in the browser that asked. Rules:

- **Google cannot confirm.** It cannot prove a fresh sign-in, so there is no
  "Re-confirm with Google"; the options are the passkey and the email link.
- **A confirmation swaps the access token and nothing else.** `setToken` keeps
  the user, so a confirmation never changes who is signed in.
- **`/auth/confirm` posts its token once per page load**, with the session's
  bearer, and drops `token` from the address bar once the outcome is final. It
  is a token page: see [CSP and headers](#csp-and-headers).
- **The link opens in the browser that asked.** The page tells the waiting
  tab through the `auth` channel and the `step-up-wait` Web Lock; where the
  browser cannot say whether a tab waits, the page says to return to it.

## CSP and headers

nginx sends these on every response it answers itself (`nginx.conf`):

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

- **No script is inline.** The pre-paint
  scripts are the files `public/theme-init.js` and `public/boot-variant.js`,
  each loaded by a blocking `<script src>`, and `/runtime-config.js` is same-origin. Never add an
  inline script, `'unsafe-inline'` or `'unsafe-eval'` for scripts. The only
  other script hosts are Razorpay Checkout's (below).
  `src/lib/zod-jitless.ts` turns off Zod's JIT, whose `new Function` probe
  this policy reports as a violation; it is the first import of
  `src/main.tsx` and of every source file that imports Zod as a value.
- **`style-src 'unsafe-inline'`** is there for two reasons. Base UI's `Select`
  popup (and `ScrollArea`, which the app does not use yet) renders a `<style>`
  element that hides its scrollbar. And `index.html` carries the boot shell's
  inline `<style id="boot-tokens">` and `<style id="boot-shell">` blocks, so the
  first paint needs no stylesheet request; a static `index.html` cannot carry a
  nonce, and only a hash source per block could stand in for the keyword.
  React applies `style` props through the CSSOM, which the policy does not
  govern, so the toast's and the sidebar's inline CSS variables do not need it.
  Base UI's `CSPProvider` with `disableStyleElements` would drop the first
  reason, not the second, so the keyword stays while the shell is inline.
- **The app's own requests stay on `'self'`.** The API, analytics and error
  tracking are all same-origin: posthog-js sends to `/api/v1/collect` and
  loads its recorder from there, so the browser never talks to PostHog.
  Calling another origin from the browser means widening the policy in
  `nginx.conf` in the same change.
- **Razorpay Checkout is the one third party, and its hosts are provisional.**
  `src/lib/razorpay-checkout.ts` loads `https://checkout.razorpay.com/v1/checkout.js`
  on demand, without an `integrity` hash because Razorpay serves it
  unversioned, so the policy pins the host instead. The policy allows Razorpay
  in `script-src` (`checkout.razorpay.com`, and `cdn.razorpay.com` for the
  risk-detection script `checkout.js` loads), `frame-src` (`api.razorpay.com`,
  `checkout.razorpay.com`), `connect-src` (`api.razorpay.com`,
  `lumberjack.razorpay.com`) and `img-src` (`cdn.razorpay.com`). These hosts
  are **provisional**: `e2e/nginx/razorpay-checkout.test.ts` proves only that
  the script loads and defines `window.Razorpay` with no violation. Opening a
  real Checkout needs a live API with Razorpay test keys, so the billing live
  walk, which opens one, confirms the final list and records it here. A
  missing host blocks payment only in production.
  `Permissions-Policy` lets the two Razorpay frame hosts use `payment`, and
  `Cross-Origin-Opener-Policy` is `same-origin-allow-popups` because UPI
  intent and bank 3-D Secure pages open as popups, which `same-origin` would
  cut off from the page. `Referrer-Policy` stays `no-referrer` unless the live
  walk shows Checkout refusing it.
- **Session replay starts no worker.** Recording `<canvas>` content would
  start a `blob:` worker, which `script-src 'self'` blocks (`worker-src`
  falls back to it). The options pin
  `session_recording.captureCanvas.recordCanvas: false`, which overrides the
  PostHog project's replay setting, so the project cannot turn canvas
  recording on. `e2e/nginx/analytics.test.ts` asserts replay records under
  this policy with no worker and no violation.
- **No location declares an `add_header`.** In nginx, a location that sets
  any header of its own inherits none of the server block's, so it would
  silently drop every security header. Cache-Control is therefore chosen by
  a `map` on the URI. The security headers carry `always`, so error
  responses get them too.
- **A proxied API response keeps its own headers.** Each header above is
  added only when the upstream response lacks it, so express's stricter API
  values (`default-src 'none'`, `X-Frame-Options: SAMEORIGIN`) pass through
  and none is sent twice: two `Cross-Origin-Opener-Policy` lines do not
  parse, and COOP falls back to `unsafe-none`. nginx's own 502 or 504 for an
  `/api/` request carries the full set.
- **No HSTS.** Whether TLS fronts this container, and which hosts the policy
  covers, is the TLS edge's to decide, so `Strict-Transport-Security` is set
  there, not in `nginx.conf`.
- **The access log keeps no query string.** Its server-level format
  records `$uri`, not `$request`, because every SPA route falls back to
  `index.html`, including the token pages: `/auth/link?token=…&email=…`,
  `/auth/confirm?token=…`, `/invitations/accept?token=…` and `/invitations/confirm?token=…&email=…`,
  whose tokens are credentials mailed to users. `Referrer-Policy: no-referrer`
  on every response keeps a token page's URL out of the referrer the browser
  sends to any request it makes, and out of the logged referrer. The pages
  carry no `<meta name="referrer">`: the header covers them in production,
  and dev has no nginx and nothing secret to leak. Each page posts its token
  in a request body, so it stays out of request URLs and logs
  (`src/queries/auth.queries.ts`, `src/queries/invitation.queries.ts`).
- **The error log can keep one.** nginx writes the full request line, query
  string included, into every upstream error message, and no log format
  changes that. A request-line leak happens at every level up to `error`, so
  the level (`notice`, `docker/nginx.main.conf`) does not matter; only `crit`
  drops it. The notification stream's location and the Google OAuth
  callback's (`location ~* ^/api/v1/auth/google/callback/?$`) set their error log
  level to `crit`, which silences those messages there; no other location
  does (see [Known gaps](#known-gaps)).
- **No source map is served.** The image deletes every `.map` after the
  upload, and `nginx.conf` answers 404 for any `.map` path outside `/api/`
  even where a file exists. A deploy of `dist/` outside the image must
  delete `*.map` first.
- `server_tokens off` drops the nginx version from the `Server` header and
  error pages.
- The `nginx` Playwright project checks the headers and asserts zero CSP
  violations (`e2e/nginx/headers.test.ts`, `e2e/nginx/csp.test.ts`,
  `e2e/nginx/csp-live.test.ts`, `e2e/nginx/razorpay-checkout.test.ts`), and `docker/check-image.sh` checks the
  built image from outside: user 101, a read-only root, each header sent
  once on proxied and unproxied responses, no source map in the image, a
  refused run-time setting that stops the container without printing its
  value, an upstream error on the Google OAuth callback (exact, with a
  trailing slash, or in mixed case) that writes none of its query string to
  the log while another `/api/` path still logs its request, and a bundle
  that carries its release and no release id written by inject.

## Run-time config injection safety

Settings that differ between environments reach the bundle at container
start, never at build time, as `/runtime-config.js`. The variables, their
patterns and defaults are in the
[README's run-time configuration table](README.md#run-time-configuration).

- **Values are validated before they are written.**
  `docker/10-runtime-config.sh` checks each non-empty value against its
  pattern and refuses one containing a newline. No pattern admits a quote, a
  backslash, `<` or a newline, so the script writes each value into a
  JavaScript string literal unescaped and it cannot break out of it. A
  mismatch stops the container; the error names the variable and never
  prints its value.
- **The file is replaced atomically.** It is written beside the target and
  renamed, so nginx never serves a half-written file, and it sets
  `window.__APP_CONFIG__` with `Object.freeze`. nginx serves it `no-store`.
- **The bundle validates again.** `src/configs/runtime-config.ts` applies
  the same patterns. An invalid value counts as unset, except
  `ANALYTICS_CONSENT_MODE`, which fails closed to `off` rather than falling
  back to capturing in an app whose `config.ts` honours consent modes; a
  handoff origin list with one origin `URL` refuses is dropped whole. Its
  console warning names the keys, never the values. A production bundle reads
  only `window.__APP_CONFIG__`, so no build-time value can configure it.
- **Every value is public.** Each browser fetches `/runtime-config.js`, so
  nothing secret goes in it. The PostHog project key may come from a secret
  store, but it is not a secret.
- **`API_UPSTREAM` is checked too.** `docker/05-prepare.sh` refuses anything
  but `http(s)://host[:port]` with no path, and envsubst substitutes only
  that variable into `nginx.conf`, so a value can neither rewrite the
  proxied URI nor inject nginx syntax or variables. Its refusal message
  never shows the value.

## Analytics privacy

posthog-js loads only when a PostHog key is set and the consent mode is not
`off`, through a dynamic `import()` kept out of the first-visit chunks
(`pnpm check:bundle`). Without it every call is a no-op.

Three behaviours depend on per-app constants in
`src/observability/telemetry/config.ts`, so the bullets that rely on them say
so: whether consent modes are honoured (`SUPPORTS_CONSENT_MODES`; an app
that says no always runs `opt_out`), whether the cross-domain handoff is
read (`SUPPORTS_HANDOFF`), and whether the identity cookie is shared with
sibling subdomains (`ANALYTICS_PERSISTENCE_NAME`,
`ANALYTICS_CROSS_SUBDOMAIN_COOKIE`). The query-key allowlist is set there
too.

- **Typed events carry no free text.** Every event and its properties are
  declared in `src/observability/telemetry/event-registry.ts`. A property typed as
  any string fails `REGISTRY_HAS_NO_FREE_STRINGS` at compile time, and a key
  passed to `analyticsKey` must be a lowercase literal without a space, `@`,
  `.`, `/`, `:`, `?`, `=`, `&` or `#`. A free string is how a name, an
  address or a search term reaches an event; do not widen it.
- **The browser never sets person or group properties.** `identify` takes
  the user id alone and the tenant group is set by id; staff status, roles
  and tenant names are set by the server, where a user cannot forge them
  from devtools.
- **Rendered personal data is masked.** Every rendered person name, email
  address, avatar initial and invitation address is wrapped in `<Pii>`
  (`src/components/shared/pii.tsx`), whose `ph-sensitive ph-mask` class keeps
  the text out of autocapture's `$el_text` and masks it in replay. Wrap the
  value, not the sentence. Inputs are masked in replay, and autocapture
  masks every element attribute.
- **Replay masks attributes by name** (`mask-attribute.ts`): `aria-label`,
  `title`, `alt`, `placeholder`, `srcdoc`, every `data-*`, an `href` with a
  query or a `mailto:`/`tel:` scheme, and a `src` or `srcset` with a query
  become `***`. That is why an accessible name may carry an address; an
  attribute outside the list may not. Replay records no request headers,
  bodies or JSON-LD, and each recorded request URL is sanitised.
- **Captured URLs keep only allowlisted query keys.**
  `ANALYTICS_URL_QUERY_ALLOWLIST` (`src/observability/telemetry/config.ts`)
  is the whole list: `tab` and the campaign keys express puts on every link it
  mails (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`), so a
  mailed link's landing page view keeps its campaign while its `token` and
  `email` go. The sanitizer keeps a `utm_*` value only when it matches
  `^[a-z0-9_-]{1,64}$`, the shape of every value express sends, and otherwise
  drops the key with its value; an `@`, a `.`, uppercase, or a value longer
  than 64 characters never reaches PostHog. The sanitizer
  (`src/observability/telemetry/url-sanitizer.ts`) runs as `before_send` and
  rewrites every absolute http(s) string in an event's properties, `$set` and
  `$set_once`, to eight levels deep, plus the hrefs in `$elements` and
  `$elements_chain` and the keys of `$heatmap_data`. The fragment goes, and
  a `mailto:` or `tel:` URL keeps only its scheme. posthog-js's own
  personal-data masking also covers `token`, `email`, `redirect`,
  `invitation`, `q`, `search`, `ph_did` and `ph_sid`. Add a key to the
  allowlist only when its values can never be a token, an address, a search
  term or a redirect. The `utm_*` keys are the one exception: their values
  arrive from the URL, so the sanitizer's value check above is what keeps an
  address or a token out (the UTM rule of 2026-10-19).
- **Events never cross people** (`guardEvent` in
  `src/observability/telemetry/telemetry.ts`). posthog-js adopts the
  identity cookie before every event, and where `config.ts` shares that
  cookie a sibling-subdomain website can change it, so while a user is signed
  in, any event under another distinct id is dropped.
  If another tab of this app identified that person (announced on the
  `analytics-identity` channel or written to a 60-second `localStorage`
  registry), this tab is superseded: it drops its events and refreshes its
  session to settle who is signed in. Otherwise the user is identified
  again after 250 ms. Never loosen the guard to log-and-send. A sign-out
  resets the SDK but keeps the browser's consent answer.
- **The session header never links another person.** `X-POSTHOG-SESSION-ID`
  is sent only while capture is on (in `required` mode, once consent is
  granted) and PostHog holds either nobody or the signed-in user.
- **Consent** (modes honoured per `config.ts`). In `opt_out` mode capture
  runs until the user turns off the profile's analytics switch; in
  `required` mode no analytics event is captured until the banner is
  accepted, and a refusal leaves only cookieless, server-hashed counts
  (`cookieless_mode: 'on_reject'`). Each user's own opt-out is applied
  before they are identified, so an opted-out user's identify is never
  captured. Consent holds back the SDK's own events and replay only:
  exception reports and flag exposure are sent whatever the answer (see
  below).
- **The cross-domain handoff is narrow** (`handoff.ts`, read only where
  `config.ts` enables it). A link's `?ph_did=&ph_sid=` is accepted only in
  `opt_out` mode, from an allowlisted referrer, into a browser that holds no
  identified person, and once per id; the full conditions and what they do not
  stop are in [docs/analytics-handoff.md](docs/analytics-handoff.md). Both
  parameters leave the address bar on every load, accepted or not.
- **Guards.** `e2e/fixtures/pii.test.ts` checks that every probe name and
  address on the main pages sits inside `<Pii>`; `e2e/nginx/analytics.test.ts`
  searches everything that reached a fake PostHog, decoded, after a route
  walk that includes token-carrying URLs.
- **Flag exposure ignores consent.** The flag hooks report experiment keys,
  never values, to the API's exposure endpoint whatever the analytics
  consent (`src/observability/flags/exposure.ts`); the API re-evaluates each
  key and records the exposure in PostHog for a user who matched a release
  condition or is in the holdout.

## Error-tracking privacy

Browser exceptions go to PostHog Error Tracking through the API's
`/api/v1/collect/batch/` proxy whenever a PostHog key is set and the consent
mode is not `off` (`src/observability/errors/report.ts`). The consent answer
does not stop them: with consent pending or refused, or after a profile
opt-out, an exception is still sent, anonymous. Only the SDK's own events and
replay wait for consent.

- **What is dropped before anything is built:** API and network failures
  (the API reports its own 5xx), aborts, ResizeObserver noise, a
  cross-origin `Script error.` with no stack, and any error with no frame
  from this app's own files (an extension's), except a failed chunk load.
- **What is scrubbed:** every exception's type and value, and every frame's
  file name and function name, through `scrubText`
  (`src/observability/errors/scrub.ts`). The page URL is reduced to the
  analytics allowlist's query keys, then its path is scrubbed. No request,
  header or form data is attached.
- **Identity follows analytics consent.** An exception carries PostHog's
  distinct id, session and tenant group only when analytics consent allows,
  the tab is not superseded, and PostHog's person is this tab's signed-in
  user (or, while nobody is signed in, whoever PostHog holds, normally
  anonymous). Otherwise it is anonymous: a fresh distinct id per event and
  no person profile. An error noted more than 10 seconds before the lazy
  reporter received it, or noted before the user, the tenant group or the
  tab's standing changed, is sent anonymous, so it is never attributed to
  the next person.
- **Volume is capped:** 5 events per fingerprint and 30 per page life.

### The scrubber

`scrub.ts` is express-boilerplate's
`express-boilerplate/src/services/errors/error-scrubber.service.ts` byte for
byte, tested against the same `tests/fixtures/error-scrub-vectors.json`, so a
rule changes in express first and is copied here, never edited here alone.
It replaces Postgres key details and echoed input, URL credentials, query
strings, fragments other than line or heading anchors, the token segment
after `/reset/`, `/verify/`, `/invite/` or `/accept/`, Bearer, Basic and
other Authorization credentials (Bearer and Basic with the unquoted or
quoted `,key=value` or `;key=value` pairs glued to them), Cookie values,
secret-named keys' values, JWTs, emails, PostHog and other vendor keys, IP
addresses, `+`-prefixed phone numbers, and long hex and base64 runs, then cuts
each text to 1024 characters.

### What it does not catch

Regex scrubbing is best-effort: keep secrets and personal data out of error
messages. Among what it leaves in place:

- names and other free text;
- ids, UUIDs included, kept on purpose for debugging;
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

- **The container trusts its front.** nginx appends to the client's
  `X-Forwarded-For` and passes on a client-supplied `X-Forwarded-Proto` of
  `http` or `https` in any letter case, lowercased (any other value becomes
  `http`), and sets no per-IP connection limit, since every request arrives
  from the TLS terminator's address (`docker/nginx.main.conf`). Expose the
  container only through that terminator.
- **The error log can hold query strings.** nginx writes the full request
  line into every upstream error message, at the `error` level, so lowering
  the log level from `notice` changes nothing; only `crit` silences it, and
  with it the reason for the upstream failure. The notification stream's
  location and the Google OAuth callback
  (`location ~* ^/api/v1/auth/google/callback/?$`, whose `code` and `state` are
  credentials) set their error log to `crit`. Every other path under `/api/`
  still writes its query string on an upstream error.
- **HSTS is the edge's job.** See [CSP and headers](#csp-and-headers).
- **Inline styles are allowed** (`style-src 'unsafe-inline'`), for Base UI's
  `Select` popup and the boot shell's inline `<style>` blocks. An injected `<style>` cannot run script, but it can restyle
  the page.
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
- **Tenant slugs are not masked.** They appear in captured URL paths and in
  the page titles page views carry. Where the PostHog project records network
  requests in replay, the paths of tenant-scoped API calls
  (`/tenants/:slug/…`) carry the tenant's slug.
- **Error scrubbing is regex-based** and misses free text; see
  [What it does not catch](#what-it-does-not-catch).

## Reporting a vulnerability

Report a security problem privately through GitHub's private vulnerability
reporting on this repository: the **Security** tab, then **Report a
vulnerability**. Do not open a public issue for a security problem.
