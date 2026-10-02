# Analytics handoff from a website on another domain

A product's marketing website and this app share **one PostHog project**. When
the website runs on a subdomain of the app's registrable domain
(`www.example.com` and `app.example.com`), posthog-js's
`cross_subdomain_cookie` already shares the visitor's anonymous id and nothing
here is needed. When it runs on **another domain** (`example.io` and
`app.example.com`), the website hands the id over in the link instead:

    https://app.example.com/register?ph_did=<anonymous id>&ph_sid=<session id>

The app accepts the handoff only when all of these hold, and strips both
parameters from the address bar either way:

- `ph_did` (and `ph_sid`, when present) is a UUID, the shape posthog-js mints;
- `document.referrer`'s origin is listed in the app's run-time
  `ANALYTICS_HANDOFF_ORIGINS` (container environment; comma-separated
  `https://` origins, e.g. `https://www.example.io`);
- this browser holds no identified person for the app yet;
- the app runs in the `opt_out` consent mode (in `required` mode nothing is
  stored before consent, so there is nothing to continue).

When the visitor then signs up or signs in, the app's `identify` merges the
website's anonymous history into the user.

## What the website must do

1. Use the **same project key** as the app (`POSTHOG_KEY` in the app's
   container, `POSTHOG_PROJECT_KEY` in the API).
2. Send a referrer the app can read. The browser default
   (`strict-origin-when-cross-origin`) sends the origin, which is all the app
   checks. A website that sets `Referrer-Policy: no-referrer`, as this app's own
   `nginx.conf` does, never hands off: the referrer arrives empty and the app
   ignores the link.
3. Decorate its links into the app with the snippet below, after posthog-js
   has loaded.

```js
/**
 * Appends the visitor's PostHog ids to every link into the app, so the app
 * continues this visit. Call once posthog-js has loaded; links added later
 * are decorated on click.
 * @param {string} appUrl - The app's origin, e.g. 'https://app.example.com'.
 */
function decorateAppLinks(appUrl) {
  const appOrigin = new URL(appUrl).origin
  const decorate = (anchor) => {
    const url = new URL(anchor.href, window.location.href)
    if (url.origin !== appOrigin || !window.posthog) return
    url.searchParams.set('ph_did', window.posthog.get_distinct_id())
    url.searchParams.set('ph_sid', window.posthog.get_session_id())
    anchor.href = url.toString()
  }
  document.querySelectorAll('a[href]').forEach(decorate)
  document.addEventListener('click', (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (anchor) decorate(anchor)
  })
}

decorateAppLinks('https://app.example.com')
```

## What it does not do

A crafted link can attach a stranger's anonymous browsing to whoever signs in
next on that browser. PostHog refuses to merge an id that is already
identified, so no identified person's history moves: the worst case is
polluted anonymous pageviews, which the referrer check and the
already-identified check narrow further.
