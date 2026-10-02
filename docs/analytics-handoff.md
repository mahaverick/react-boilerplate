# Analytics with a marketing website

A product's marketing website and this app share **one PostHog project**, so a
visit that starts on the website can continue in the app. How depends on where
the website runs, and the two setups have opposite rules about `reset()`.

| Website                                                    | The visit carries over through                     | The website's rule                                          |
| ---------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| On a subdomain of the app's domain (`www.example.com`)     | posthog-js's shared identity cookie, automatically | Never call `identify`, `alias`, `reset` or `group`          |
| On another domain (`example.io`, app on `app.example.com`) | The handoff link below                             | Hand off only an anonymous id, then `reset()` (the snippet) |

## A website on a sibling subdomain

The app keeps posthog-js's default storage name and
`cross_subdomain_cookie: true`, so the website's posthog-js and the app's read
and write **one identity cookie** on the registrable domain. Use the same
project key and leave both settings at their defaults.

posthog-js re-reads that cookie before every event and adopts whatever identity
it holds. So while a user is signed in to the app in one tab, a website page in
another tab that calls:

- `identify(<lead id or email>)` or `alias(…)` would file the user's next app
  events under the lead;
- `reset()` would make the app tab anonymous and drop its `app`,
  `environment` and tenant group;
- `group(…)` would put the app's events in the website's group.

The app defends itself: while a user is signed in, an event carrying any other
distinct id is dropped and the user is identified again, and an event missing
the app's `app`, `environment` or tenant group gets them back. But the dropped
events are lost, the re-identify can start a new replay session, and a signed-out
visitor has no identity to restore. **The website must therefore never call
`identify`, `alias`, `reset` or `group`** while it shares the cookie; it may
`capture` events and `register` its own properties. A lead form posts its data
to your backend, which sets person properties server-side if it must.

## A website on another domain: the handoff

The website hands the anonymous id over in the link instead:

    https://app.example.com/register?ph_did=<anonymous id>&ph_sid=<session id>

The app accepts the handoff only when all of these hold, and strips both
parameters from the address bar either way:

- `ph_did` (and `ph_sid`, when present) is a UUID, the shape posthog-js mints;
- `document.referrer`'s origin is listed in the app's run-time
  `ANALYTICS_HANDOFF_ORIGINS` (container environment; comma-separated
  `https://` origins, e.g. `https://www.example.io`);
- this browser holds no identified person for the app yet;
- this browser has not accepted that `ph_did` before: the app remembers the
  last 50 ids it accepted (localStorage `analytics_handoff_consumed`) and
  refuses one it has seen, or any when that storage cannot be read or written;
- the app runs in the `opt_out` consent mode (in `required` mode nothing is
  stored before consent, so there is nothing to continue).

When the visitor then signs up or signs in, the app's `identify` merges the
website's anonymous history into the user.

### What the website must do

1. Use the **same project key** as the app (`POSTHOG_KEY` in the app's
   container, `POSTHOG_PROJECT_KEY` in the API).
2. Send a referrer the app can read. The browser default
   (`strict-origin-when-cross-origin`) sends the origin, which is all the app
   checks. A website that sets `Referrer-Policy: no-referrer`, as this app's own
   `nginx.conf` does, never hands off: the referrer arrives empty and the app
   ignores the link.
3. Hand off only an **anonymous** id, and **reset after handing it off**, with
   the snippet below. Once the visitor signs in to the app, PostHog merges the
   handed-off id into that person; the website cannot see that, and without the
   reset it would keep the id and hand it off again for whoever uses the
   browser next. The reset gives the website's next visitor a fresh id; this
   visitor's journey continues in the app under the handed-off one.

```js
/**
 * Hands the visitor's anonymous PostHog ids to the app on a click into it,
 * then resets, so the website never hands the same id off twice. A visitor
 * the website has identified is not handed off. Call once posthog-js has
 * loaded.
 * @param {string} appUrl - The app's origin, e.g. 'https://app.example.com'.
 */
function decorateAppLinks(appUrl) {
  const appOrigin = new URL(appUrl).origin
  const handOff = (event) => {
    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!anchor || !window.posthog) return
    const url = new URL(anchor.href, window.location.href)
    if (url.origin !== appOrigin) return
    url.searchParams.delete('ph_did')
    url.searchParams.delete('ph_sid')
    const isAnonymous = window.posthog.get_property('$user_state') !== 'identified'
    if (isAnonymous) {
      url.searchParams.set('ph_did', window.posthog.get_distinct_id())
      url.searchParams.set('ph_sid', window.posthog.get_session_id())
    }
    anchor.href = url.toString()
    if (isAnonymous) window.posthog.reset()
  }
  document.addEventListener('click', handOff)
  // A middle click opens the link; a right click (which some browsers also report) does not.
  document.addEventListener('auxclick', (event) => {
    if (event.button === 1) handOff(event)
  })
}

decorateAppLinks('https://app.example.com')
```

### What it does not protect against

The handoff trusts the id in the link. A link carrying an id that PostHog has
**already merged into a signed-in person** (a link copied out of someone
else's browser after they signed up, or built by a website that ignored step 3)
starts the app as that id. PostHog files the visitor's pageviews, clicks and
replay before sign-in under that person, and when the visitor signs in it
refuses to merge an id that is already identified, so that activity stays with
the other person: **a stranger's activity is attributed to an identified
person**, not just added to anonymous pageviews. The checks above narrow it:
the link must be clicked from the allowlisted website, the app must hold nobody
identified, and the same browser never accepts an id twice (within its last 50
handoffs). They do not stop a crafted link opened once in a fresh browser.
