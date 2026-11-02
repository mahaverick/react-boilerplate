# System

This file covers two routes: the root URL (Uniform Resource Locator), `/`, and the page for a URL that matches no route. Back to the [route map](README.md#route-map).

"The walk" below is the Playwright walk of the app made for pull request (PR) #108 on 15 October 2026.

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

The walk confirmed both paths. Signed out, `/` landed on `/login`. Signed in, it landed on `/dashboard?tenant=<slug>`.

### `/$` — Not found

![Page not found](img/system/not-found--default.jpg)

|                     |                                                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Purpose             | Tell the reader the URL matches no page, and offer a way back.                                                               |
| File                | `src/pages/$.tsx`, rendering `RouteNotFound` (`src/components/features/route-not-found.tsx`)                                 |
| Guard and redirects | none: the splat route is top level, under neither `_app` nor `_auth`, so it renders the same for everyone                    |
| Layout              | none: the route renders its own `<main>` around `RouteNotFound` on a plain background, with no app shell and no `AuthLayout` |
| Data                | none                                                                                                                         |
| Sections            | A `Card` with "Page not found", "Check the address, or go home." and Go home                                                 |
| Components          | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardFooter`, `buttonVariants`                                         |
| Transitions         | Go home → `/`, which redirects to `/dashboard` or `/login`                                                                   |

The shot is taken signed in, and it shows no sidebar or header. In the walk, a signed-in visit to `/tenants/no-such-tenant/nothing` showed the same bare card.

`RouteNotFound` is also the router's `defaultNotFoundComponent`. A route that throws `notFound()` inside a layout therefore shows the same card inside that layout. The beta page with its flag off is one example.

Findings: [F-system-1](findings.md#f-system-1)
