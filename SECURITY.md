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
  analytics configuration shares it (`src/observability/analytics/config.ts`),
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
    not a bad session; it rejects untouched for the caller to handle;
  - any other 401 on a request that carried a bearer token: sign this tab
    out, broadcast the logout and redirect to `/login`;
  - a 401 on a request with no token (the sign-in form): a wrong password,
    not a session verdict.
- **`skipAuthRetry` opts a request out of both paths.** It is set on the two
  requests a refresh makes (re-entering `ensureSession()` there would await
  itself), on `POST /auth/logout`, and on the invitation preview, which is
  asked as a stranger.
- **Every tab follows a sign-out.** A sign-out posts `logout` on the `auth`
  BroadcastChannel; a tab that hears it while signed in clears its store and
  loads `/login`. A tab that is not signed in ignores it, and a refresh that
  fails in such a tab broadcasts nothing, so it cannot sign out a sibling
  that just logged in.
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
- **The post-login redirect cannot leave the origin.** `?redirect=` arrives
  from the URL bar. `safeRedirect` (`src/pages/_auth/login.tsx`) accepts only
  a value starting with `/` that the URL parser resolves to this origin and
  whose path does not start with `//`, which refuses `/\t/evil.example` and
  `/..//evil.example`.
- **Passwords.** A password being set (registration, reset, change) needs at
  least 15 code points and at most 72 UTF-8 bytes, bcrypt's limit
  (`src/schemas/auth.schemas.ts`); sign-in and email verification check
  none, as the API does. Changing the password keeps this session; the API
  revokes every other one.
- **An already-verified link.** When `POST /auth/verify-email` answers 409
  with `email_already_verified`, the verify page
  (`src/pages/verify-email.tsx`) treats it as done, not as a failure: it shows
  the API's message and a **Sign in** link to `/login`, and offers no
  resend. The resend form shows the same message whatever the API answers,
  so it never reveals whether an address needs verifying.

## CSP and headers

nginx sends these on every response it answers itself (`nginx.conf`):

| Header                       | Value                                                          |
| ---------------------------- | -------------------------------------------------------------- |
| `Content-Security-Policy`    | see below                                                      |
| `Referrer-Policy`            | `no-referrer`                                                  |
| `X-Content-Type-Options`     | `nosniff`                                                      |
| `X-Frame-Options`            | `DENY`                                                         |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                  |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` |

The policy is enforced, not report-only:

    default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
    img-src 'self' data:; connect-src 'self'; object-src 'none';
    base-uri 'none'; frame-ancestors 'none'; form-action 'self'

- **`script-src 'self'` holds because no script is inline.** The pre-paint
  theme script is the file `public/theme-init.js`, loaded by a blocking
  `<script src>`, and `/runtime-config.js` is same-origin. Never add an
  inline script, `'unsafe-inline'` or `'unsafe-eval'` for scripts.
  `src/lib/zod-jitless.ts` turns off Zod's JIT, whose `new Function` probe
  this policy reports as a violation; it is the first import of
  `src/main.tsx`.
- **`style-src 'unsafe-inline'`** is there because sonner injects a `<style>`
  element at runtime.
- **`connect-src 'self'`** holds because the API, analytics and error
  tracking are all same-origin: posthog-js sends to `/api/v1/collect` and
  loads its recorder from there, so the browser never talks to PostHog.
  Calling another origin from the browser means widening it in `nginx.conf`
  in the same change.
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
  `index.html`, including `/reset-password?token=…` and
  `/verify-email?token=…`, whose tokens are credentials mailed to users.
  `Referrer-Policy: no-referrer` keeps the page URL out of the logged
  referrer. The invitation preview posts its token in a request body, so it
  stays out of URLs and logs (`src/queries/invitation.queries.ts`).
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
  `e2e/nginx/csp-live.test.ts`), and `docker/check-image.sh` checks the
  built image from outside: user 101, a read-only root, each header sent
  once on proxied and unproxied responses, no source map in the image, a
  refused run-time setting that stops the container without printing its
  value, an upstream error on the Google OAuth callback (exact, with a
  trailing slash, or in mixed case) that writes none of its query string to the log while another `/api/` path still logs its
  request, and a bundle that carries its release and no release id written by
  inject.

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
`src/observability/analytics/config.ts`, so the bullets that rely on them say
so: whether consent modes are honoured (`SUPPORTS_CONSENT_MODES`; an app
that says no always runs `opt_out`), whether the cross-domain handoff is
read (`SUPPORTS_HANDOFF`), and whether the identity cookie is shared with
sibling subdomains (`ANALYTICS_PERSISTENCE_NAME`,
`ANALYTICS_CROSS_SUBDOMAIN_COOKIE`). The query-key allowlist is set there
too.

- **Typed events carry no free text.** Every event and its properties are
  declared in `src/observability/analytics/events.ts`. A property typed as
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
  `ANALYTICS_URL_QUERY_ALLOWLIST` (`src/observability/analytics/config.ts`)
  is the whole list: `tab`; the sanitizer
  (`src/observability/analytics/url-sanitizer.ts`) runs as `before_send` and
  rewrites every absolute http(s) string in an event's properties, `$set` and
  `$set_once`, to eight levels deep, plus the hrefs in `$elements` and
  `$elements_chain` and the keys of `$heatmap_data`. The fragment goes, and
  a `mailto:` or `tel:` URL keeps only its scheme. posthog-js's own
  personal-data masking also covers `token`, `email`, `redirect`,
  `invitation`, `q`, `search`, `ph_did` and `ph_sid`. Add a key to the
  allowlist only when its values can never be a token, an address, a search
  term or a redirect.
- **Events never cross people** (`guardEvent` in
  `src/observability/analytics/analytics.ts`). posthog-js adopts the
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
secret-named keys' values,
JWTs, emails, PostHog and other vendor keys, IP addresses, `+`-prefixed phone
numbers, and long hex and base64 runs, then cuts each text to 1024
characters.

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
- **Inline styles are allowed** (`style-src 'unsafe-inline'`), for sonner.
  An injected `<style>` cannot run script, but it can restyle the page.
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
