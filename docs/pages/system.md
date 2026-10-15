# System

The root URL and the page for a URL nothing matches. Back to the [route map](README.md#route-map).

### `/` — Root redirect

No shot: the route only redirects.

|                     |                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Send the visitor to the right starting page.                                                                               |
| File                | `src/pages/index.tsx`                                                                                                      |
| Guard and redirects | `beforeLoad` throws a redirect: signed in → `/dashboard`, else `/login`. `_app` then adds `?tenant=` for a signed-in user. |
| Layout              | none                                                                                                                       |
| Data                | none of its own; the boot's session restore decides ([boot.md](boot.md#what-happens))                                      |
| Transitions         | → `/dashboard` or `/login`                                                                                                 |

The walk confirmed both: signed out, `/` landed on `/login`; signed in, on `/dashboard?tenant=<slug>`.

### `/$` — Not found

![Page not found](img/system/not-found--default.jpg)

|                     |                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Tell the reader the URL matches no page, and offer a way back.                                                               |
| File                | `src/pages/$.tsx`, rendering `RouteNotFound` (`src/components/features/route-not-found.tsx`)                                 |
| Guard and redirects | none: the splat route is top level, under neither `_app` nor `_auth`, so it renders the same for everyone                    |
| Layout              | none: the route renders its own `<main>` around `RouteNotFound` on a plain background, with no app shell and no `AuthLayout` |
| Data                | none                                                                                                                         |
| Sections            | A `Card` with "Page not found", "The address may be mistyped, or the page may have moved." and Go home                       |
| Components          | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardFooter`, `buttonVariants`                                         |
| Transitions         | Go home → `/`, which redirects to `/dashboard` or `/login`                                                                   |

The shot is taken signed in, and still shows no sidebar or header. In the walk, a signed-in `/tenants/no-such-tenant/nothing` showed the same bare card.

`RouteNotFound` is also the router's `defaultNotFoundComponent`, so a route that throws `notFound()` inside a layout (the beta page with its flag off, for example) shows the same card inside that layout instead.

Findings: [F-system-1](findings.md#f-system-1)
