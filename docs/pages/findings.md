# Findings

Each finding: where, what is wrong, evidence, and the part that fixes it.

The tag names the work that fixes it: `[P2 loading]` boot and loading states, `[P3 shadcn]` the shadcn refresh, `[P4 table]` the data table, `[P5 palette]` the command palette, and `[UX]` a copy or flow change outside those.

## Summary by part

[P2 loading]

- [F-boot-1](#f-boot-1), [F-boot-2](#f-boot-2), [F-auth-3](#f-auth-3)
- [F-dashboard-1](#f-dashboard-1), [F-dashboard-2](#f-dashboard-2)
- [F-tenants-1](#f-tenants-1), [F-tenants-2](#f-tenants-2), [F-tenants-3](#f-tenants-3)
- [F-notifications-1](#f-notifications-1)
- [F-settings-1](#f-settings-1), [F-settings-2](#f-settings-2), [F-settings-3](#f-settings-3), [F-settings-4](#f-settings-4), [F-settings-5](#f-settings-5)

[P3 shadcn]

- [F-tenants-4](#f-tenants-4), [F-notifications-2](#f-notifications-2), [F-notifications-3](#f-notifications-3), [F-settings-7](#f-settings-7), [F-settings-8](#f-settings-8)

[P4 table]

- [F-settings-6](#f-settings-6)

[P5 palette]

- [F-tenants-7](#f-tenants-7), [F-settings-14](#f-settings-14)

[UX]

- [F-auth-1](#f-auth-1), [F-auth-2](#f-auth-2), [F-auth-4](#f-auth-4), [F-auth-5](#f-auth-5), [F-system-1](#f-system-1)
- [F-dashboard-3](#f-dashboard-3), [F-dashboard-4](#f-dashboard-4), [F-dashboard-5](#f-dashboard-5)
- [F-tenants-5](#f-tenants-5), [F-tenants-6](#f-tenants-6)
- [F-notifications-4](#f-notifications-4), [F-notifications-5](#f-notifications-5), [F-notifications-6](#f-notifications-6)
- [F-settings-9](#f-settings-9), [F-settings-10](#f-settings-10), [F-settings-11](#f-settings-11), [F-settings-12](#f-settings-12), [F-settings-13](#f-settings-13)

## All findings

"The walk" below is a Playwright walk of the signed-in app as a new account owning two tenants, with a layout-shift observer on every page; "the capture" is `pnpm capture:pages` and its `report.json`.

| Id                | Route                                              | Tag          | Finding                                                                                                                                                               | Evidence                                                                   |
| ----------------- | -------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| F-boot-1          | cold load                                          | [P2 loading] | The splash paints unstyled in the top-left, then re-paints centred once the CSS arrives.                                                                              | [frames](boot.md#frame-by-frame)                                           |
| F-boot-2          | cold load of an `_app` page                        | [P2 loading] | Every request the boot awaits holds the whole screen on the splash; a slow tenant or flags answer shows no shell, skeleton or progress.                               | [boot](boot.md#what-happens), `report.json`                                |
| F-auth-1          | `/verify-email`                                    | [UX]         | Without `?token` the page shows the form with an empty token field, where the other mailed-link pages say the link is incomplete.                                     | [shot](auth.md#verify-email--verify-your-email)                            |
| F-auth-2          | `/verify-email`                                    | [UX]         | The verification token is shown as an editable text field the user has no reason to read or change.                                                                   | [shot](auth.md#verify-email--verify-your-email)                            |
| F-auth-3          | `/invitations/accept`                              | [P2 loading] | The loading card has a different title and about half the height of the card that replaces it, so the page jumps when the preview lands.                              | [shots](auth.md#invitationsaccept--accept-an-invitation)                   |
| F-auth-4          | `/invitations/accept`                              | [UX]         | The error state says "We could not load this invitation" twice, in the title and again in the `LoadError` box nested inside the card.                                 | [shot](auth.md#invitationsaccept--accept-an-invitation)                    |
| F-auth-5          | `/login`, `/register`                              | [UX]         | The agreement line says "By clicking continue", but the primary buttons say "Sign in" and "Create account".                                                           | [shot](auth.md#login--sign-in)                                             |
| F-system-1        | `/$`                                               | [UX]         | The not-found page has no app shell for a signed-in user and no auth frame for a signed-out one: a bare card on a plain page.                                         | [shot](system.md#--not-found)                                              |
| F-dashboard-1     | `/dashboard`                                       | [P2 loading] | While the guard's `GET /tenants` is slow, the splash holds for its 3 s cap, then the page renders with "Choose a tenant" and no sign that tenants are still coming.   | [shot](dashboard.md#dashboard--dashboard), `report.json`                   |
| F-dashboard-2     | every `_app` page                                  | [P2 loading] | A failed tenant list or notifications read shows nothing on screen: the switcher says "Choose a tenant", as if there were none, and the bell's badge just disappears. | [shot](dashboard.md#dashboard--dashboard)                                  |
| F-dashboard-3     | `/dashboard`                                       | [UX]         | Without a first name the greeting uses the whole email address, which wraps mid-address at 390 px.                                                                    | [shot](dashboard.md#dashboard--dashboard)                                  |
| F-dashboard-4     | `/dashboard`, `/tenants/`, `/notifications`        | [UX]         | These pages put their `h1` in a card title at body size, while settings and tenant pages use a large page heading, so one shell has two heading scales.               | [shots](dashboard.md#dashboard--dashboard)                                 |
| F-dashboard-5     | every `_app` page                                  | [UX]         | The theme menu (Light, Dark, System) marks no current choice.                                                                                                         | [walk](dashboard.md#the-app-shell)                                         |
| F-tenants-1       | `/tenants/$slug/`, `/tenants/$slug/beta`           | [P2 loading] | A slow tenant read shows the boot splash on a cold load and a lone spinner on an in-app navigation; the tenant gate's skeleton is never reached.                      | [layout](tenants.md#layout), `report.json`                                 |
| F-tenants-2       | `/tenants/$slug/…`                                 | [P2 loading] | A failed tenant read replaces the header, the tabs and the whole page with one `LoadError`, while the breadcrumb still names the tab.                                 | [shot](tenants.md#tenantsslug--overview)                                   |
| F-tenants-3       | `/tenants/$slug/`                                  | [P2 loading] | Getting started has no skeleton and no error: it appears late above Details (layout shift 0.143), and vanishes without a word when its request fails.                 | [walk](tenants.md#tenantsslug--overview)                                   |
| F-tenants-4       | `/tenants/`                                        | [P3 shadcn]  | The empty list is a muted sentence, not an empty state, and the list is hand-rolled bordered rows.                                                                    | [shot](tenants.md#tenants--tenants)                                        |
| F-tenants-5       | tenant pages                                       | [UX]         | The breadcrumb names the tenant by its slug, and at 390 px it wraps to two lines.                                                                                     | [shots](tenants.md#tenantsslug--overview)                                  |
| F-tenants-6       | `/tenants/$slug/beta`                              | [UX]         | With the flag off, a "Page not found" card sits inside the tenant's own header and tabs under a "Beta" crumb, and its Go home leaves the tenant.                      | [shot](tenants.md#tenantsslugbeta--beta)                                   |
| F-tenants-7       | tenant switcher                                    | [P5 palette] | Switching tenant or creating one is only reachable from the sidebar switcher, behind the sheet on a phone; a palette has neither.                                     | [walk](dashboard.md#the-app-shell)                                         |
| F-notifications-1 | `/notifications`                                   | [P2 loading] | Three plain blocks stand in for rows of title, badge, body and date; Mark all read appears with the data and pushes the list down.                                    | [shots](notifications.md#notifications--notifications)                     |
| F-notifications-2 | `/notifications`                                   | [P3 shadcn]  | "You have no notifications." is a muted sentence, not an empty state.                                                                                                 | [shot](notifications.md#notifications--notifications)                      |
| F-notifications-3 | `/notifications`                                   | [P3 shadcn]  | Load more is a hand-rolled button whose pending state is the text "Loading…", not pagination or a spinner.                                                            | [code](notifications.md#notifications--notifications)                      |
| F-notifications-4 | the bell                                           | [UX]         | Every bell preview opens the same inbox rather than its notification, and the unread mark is a "●" text character.                                                    | [walk](notifications.md#the-bell)                                          |
| F-notifications-5 | account menu, sidebar                              | [UX]         | Two items called "Notifications" lead to different pages: the sidebar's to the inbox, the account menu's to the preferences.                                          | [walk](notifications.md#the-bell)                                          |
| F-notifications-6 | `/notifications`                                   | [UX]         | A verified account still has an unread "Verify your email" notification.                                                                                              | [shot](notifications.md#notifications--notifications)                      |
| F-settings-1      | `/settings/workspace/$slug/…`                      | [P2 loading] | A slow tenant read shows the boot splash on a cold load and a lone spinner in the app; the workspace gate's skeleton is never reached.                                | [layout](settings.md#settingsworkspaceslug--workspace-gate), `report.json` |
| F-settings-2      | `/settings/workspace/$slug/…`                      | [P2 loading] | A failed tenant read replaces every card of a workspace page with one `LoadError`, though each card has its own request and error state.                              | [shots](settings.md#settingsworkspaceslugmembers--members)                 |
| F-settings-3      | `/settings/account/security`                       | [P2 loading] | Two short bars stand in for the sign-in methods and a three-field form; Other sessions jumps 294 px when it lands.                                                    | [shots](settings.md#settingsaccountsecurity--security)                     |
| F-settings-4      | `/settings/account/notifications`                  | [P2 loading] | One bar stands in for four preference rows.                                                                                                                           | [shots](settings.md#settingsaccountnotifications--notifications)           |
| F-settings-5      | workspace members, activity, general               | [P2 loading] | Plain bars stand in for a table, a filtered log and forms; the member table's arrival pushes the cards below it 77 px.                                                | [walk](settings.md#settingsworkspaceslugmembers--members)                  |
| F-settings-6      | `/settings/workspace/$slug/members`                | [P4 table]   | At 1440 px the member table's Actions column (Remove, Leave) is outside the card and needs a sideways scroll; a member without a name shows the address twice.        | [walk](settings.md#settingsworkspaceslugmembers--members)                  |
| F-settings-7      | workspace activity, members                        | [P3 shadcn]  | The audit log, with server-side filters and Load more, and the pending invitations are hand-rolled lists rather than a table.                                         | [shots](settings.md#settingsworkspaceslugactivity--activity)               |
| F-settings-8      | account notifications, workspace members, activity | [P3 shadcn]  | Every empty list is a muted sentence, not an empty state.                                                                                                             | [shots](settings.md#settingsworkspaceslugmembers--members)                 |
| F-settings-9      | `/settings/workspace/$slug/activity`               | [UX]         | The activity card has no visible title, and its first line, "What platform staff did is marked Staff.", reads like a stray footnote.                                  | [shot](settings.md#settingsworkspaceslugactivity--activity)                |
| F-settings-10     | `/settings/account/notifications`                  | [UX]         | The card's description repeats the page's subtitle word for word before saying anything new.                                                                          | [shot](settings.md#settingsaccountnotifications--notifications)            |
| F-settings-11     | `/settings/workspace/$slug/general`                | [UX]         | Timezone is free text, metadata a raw JSON box, and the first card is called "Overview", the name of a different page.                                                | [shot](settings.md#settingsworkspacesluggeneral--general)                  |
| F-settings-12     | `/settings/account/security`                       | [UX]         | Three sections share one untitled card, and the "Change password" label sits flush on the first field's label.                                                        | [shot](settings.md#settingsaccountsecurity--security)                      |
| F-settings-13     | `/settings/workspace/$slug/members`                | [UX]         | At 390 px each member card shows the address twice and breaks it mid-word, under a two-line breadcrumb.                                                               | [shot](settings.md#settingsworkspaceslugmembers--members)                  |
| F-settings-14     | settings                                           | [P5 palette] | Settings pages, theme and sign-out live in three different menus; there is no one place to jump to any of them.                                                       | [layout](settings.md#settings--settings-shell)                             |

### F-boot-1

On every cold load under `vite dev`, the splash in `index.html` shows for about half a second as unstyled black serif "Loading…" in the top-left corner, with no spinner, before it jumps to the centred, styled splash (frames 01 and 02 of each scenario in [boot.md](boot.md#frame-by-frame): 69 → 557 ms, 23 → 590 ms, 32 → 544 ms). The splash's only styles are in `src/styles/globals.css`, which `vite dev` delivers through JavaScript after the module graph runs ([why](boot.md#why-the-first-frame-is-unstyled)). A production build links that CSS in `<head>`, so production is not affected. Fix: give the splash styles that do not depend on the bundle, for example a small stylesheet linked from `index.html`.

### F-boot-2

React mounts only after `router.load()` settles (`src/main.tsx`), and `router.load()` awaits the session restore, `_app`'s tenant guard (`GET /tenants`, up to 3 s), the flags, and on tenant pages `GET /tenants/:slug`. While any of these is slow, the user sees only the boot splash: no shell, no skeleton, no sign of which page is coming. The capture held each tenant page's requests: the loading shots of `/tenants/$slug/`, `/tenants/$slug/beta` and the three `/settings/workspace/$slug/…` pages all recorded `loadingUi: "splash"` in `test-results/capture/report.json`. Fix: mount the shell before the awaited reads finish and show route-level skeletons in place of the splash.

### F-auth-1

`/reset-password` and `/invitations/accept` without `?token` both show "This link is incomplete" and one way out. `/verify-email` without `?token` shows the normal form with a blank "Verification token" field ([shot](img/auth/verify-email--empty.jpg)), so a user who lost the token is asked to type something they never saw. Fix: give `/verify-email` the same incomplete-link state, pointing at the resend form.

### F-auth-2

`/verify-email` renders the token from the link in a labelled, editable text input ([shot](img/auth/verify-email--default.jpg)). The reset page carries its token in the form values without rendering it. The visible field adds a step that means nothing to the user and invites accidental edits. Fix: carry the token like the reset page does, and show the field only when there is no token.

### F-auth-3

While the preview loads, the card is titled "Checking your invitation" and holds two skeleton bars; when it lands, the card becomes "Join {tenant}" with a sentence, two buttons and a hint paragraph ([loading](img/auth/invitation-accept--loading.jpg), [loaded](img/auth/invitation-accept--default.jpg)). The card grows from about 200 px to about 345 px tall and its title changes, so everything in it moves. Fix: a skeleton shaped like the loaded state (title line, sentence, two button-height bars).

### F-auth-4

The preview-failure state has the title "We could not load this invitation" and, inside the card, a bordered `LoadError` box whose message starts with the same sentence ([shot](img/auth/invitation-accept--error.jpg)). Fix: shorten the box's message to the part the title does not say, or drop the box's border inside a card.

### F-auth-5

`TermsNote` under the sign-in and registration cards reads "By clicking continue, you agree to our Terms of Service and Privacy Policy." The primary buttons are "Sign in" and "Create account"; only the Google button says "Continue" ([sign in](img/auth/login--default.jpg), [register](img/auth/register--default.jpg)). Fix: word the note for the page's own button, or for any sign-in method.

### F-system-1

`src/pages/$.tsx` is a top-level route, so the not-found page renders outside both layouts: a bare card on a plain background, with no sidebar, header or way to switch tenant for a signed-in user, and without the muted auth frame for a signed-out one ([shot](img/system/not-found--default.jpg), taken signed in). In the walk, a mistyped signed-in URL (`/tenants/no-such-tenant/nothing`) gave the same bare page. Fix: render the not-found card inside the shell when signed in, and inside `AuthLayout` when signed out.

### F-dashboard-1

`/dashboard` has no request of its own; the capture held the `_app` guard's `GET /tenants` and the bell's `GET /notifications`, and recorded `loadingUi: "none"` (5466 ms). The guard awaits the tenant list with a 3 s cap (`src/lib/tenant-guard.ts`), so the boot splash covers the first 3 s, then the page renders as if loading were done: "Choose a tenant" in the switcher, no badge on the bell ([shot](img/dashboard/dashboard--loading.jpg)). The same happens on every page without `$slug` (`/tenants/` shows "Choose a tenant" over its own skeleton, [shot](img/tenants/tenants--loading.jpg)). Fix: render the shell without waiting on the tenant list, with a skeleton in the switcher and the bell while their reads are in flight.

### F-dashboard-2

The capture failed `GET /tenants` and `GET /notifications` on `/dashboard` and recorded `errorUi: "none"`: the page renders normally, the switcher says "Choose a tenant", the words it uses for an account with no tenants, and the bell's badge is gone ([shot](img/dashboard/dashboard--error.jpg)). Only the bell's accessible name changes ("Notifications, count unavailable"), and the switcher's popup says "Tenants could not be loaded" once opened (`ownTenantsMessage` in `src/components/features/tenant-switcher.tsx`). `/tenants/` does show a `LoadError` for the same failure, but its switcher also says "Choose a tenant" ([shot](img/tenants/tenants--error.jpg)). Fix: give the switcher trigger and the bell a visible failed state with a retry, distinct from "no tenants" and "no notifications".

### F-dashboard-3

`DashboardPage` greets `user.firstName ?? user.email`. A new account has no first name, so the heading is the full address; at 390 px it wraps in the middle of it ([shot](img/dashboard/dashboard--mobile.jpg)). Fix: greet without a name when there is no first name, or truncate the address.

### F-dashboard-4

`/dashboard`, `/tenants/` and `/notifications` put their `h1` inside a `CardTitle` (body size, `font-medium`), while the settings layout and the tenant layout render a separate `text-2xl lg:text-3xl` page heading above their cards ([dashboard](img/dashboard/dashboard--default.jpg), [tenants](img/tenants/tenants--default.jpg), [settings](img/settings/settings-index--default.jpg), [tenant](img/tenants/tenant-overview--default.jpg)). Moving between them, the page title changes size and position. Fix: one page-header pattern for every page in the shell.

### F-dashboard-5

`ThemeToggle` (`src/components/features/theme-toggle.tsx`) lists Light, Dark and System as plain `DropdownMenuItem`s. In the walk, after choosing Dark the reopened menu marked nothing; only the trigger's accessible name says "Theme: dark". With System chosen, the icon shows the resolved theme, so the menu is the only place the choice could show. Fix: a radio group with the current choice checked.

### F-tenants-1

`/tenants/$slug` and `/settings/workspace/$slug` await `GET /tenants/:slug` and its flags in their loaders. On a cold load that runs inside `router.load()`, before React mounts: the capture's loading shots of `/tenants/$slug/` and `/tenants/$slug/beta` recorded `loadingUi: "splash"` ([shot](img/tenants/tenant-overview--loading.jpg)), the mechanism in [F-boot-2](#f-boot-2). On an in-app navigation the router shows `RoutePending` after 300 ms instead: in the walk, with the detail held 2.5 s, the page was one centred spinner under a breadcrumb that already read Tenants › {slug} › Overview, for about 2.3 s. `TenantGate`'s skeleton (`h-10 w-64`, `h-8`, `h-40`) is reachable only in the narrow cases [tenants.md](tenants.md#layout) lists, inferred from the code. Fix: let the layout render from the route match with a header-and-tabs skeleton while the detail loads.

### F-tenants-2

A failed `GET /tenants/:slug` reaches the layout's `errorComponent`, `TenantLoadFailed`, which replaces the tenant's header, role badge and tabs as well as the page with one `LoadError`; the breadcrumb above still says Overview or Beta ([overview](img/tenants/tenant-overview--error.jpg), [beta](img/tenants/tenant-beta--error.jpg)). The capture fails every section at once, so this shot is the worst case; but the onboarding card and the beta card read their own endpoints and would render without the detail except for the header's name (from the code). Fix: keep the header and tabs (from the slug) and put the failure in the region that needs the detail.

### F-tenants-3

`GettingStartedCard` returns `null` until `GET /tenants/:slug/onboarding` has data (`src/components/features/tenant/getting-started-card.tsx`), and has no error branch. In the walk the Details card painted first and was pushed from y 217 to y 761 when the checklist arrived about 60 ms later (layout shift 0.143, the largest on any page). With that request answering 500, the card was absent and nothing said so. Fix: a checklist-shaped skeleton while pending, and a `LoadError` in the card's place on failure.

### F-tenants-4

The tenant list's empty state is `<p className="text-sm text-muted-foreground">You do not belong to any tenants yet. Create one below.</p>` ([shot](img/tenants/tenants--empty.jpg)), and the list itself is a `ul` of hand-rolled bordered link rows. Fix: shadcn's `empty` for the empty state; the rows can stay a list or move to the data table with the other lists.

### F-tenants-5

The tenant crumb is `params.slug`, because static data resolves before any fetch (`src/pages/_app/tenants/$slug.tsx`), so the trail reads Tenants › {slug} › Overview while the page heading is the tenant's name ([shot](img/tenants/tenant-overview--default.jpg)). At 390 px the trail wraps to two lines (46 px against 20 px on other pages in the walk, [shot](img/tenants/tenant-overview--mobile.jpg)); workspace settings pages do the same. Fix: resolve the crumb from the cached tenant detail and truncate the middle crumbs on narrow screens.

### F-tenants-6

With `example_beta_page` off, `/tenants/$slug/beta`'s `beforeLoad` throws `notFound()`, so the router's `RouteNotFound` card ("Page not found", Go home) renders inside the tenant layout, under the tenant's header and tabs and a "Beta" crumb ([shot](img/tenants/tenant-beta--default.jpg)). The page says the address may be mistyped while the header shows a real tenant, and Go home leaves the tenant for `/dashboard`. Fix: a tenant-scoped not-available message with a link back to the tenant's overview.

### F-tenants-7

Switching tenant is reachable only from the switcher at the top of the sidebar; on a phone, from inside the sidebar sheet. In the walk the switcher searched both tenants well, but there is no keyboard way in and no command palette in react at all. Creating a tenant is a link at the bottom of the switcher that goes to the tenant list page. Fix: the palette lists the user's tenants ("Switch to…") and "Create a tenant".

### F-notifications-1

The loading branch is three `Skeleton className="h-16 w-full"` blocks ([shot](img/notifications/notifications--loading.jpg)), while each row has a title, an Unread badge, a body line, a type and date line and two icon buttons. Mark all read renders only once loaded data has an unread row, so in the walk the row moved from y 184 to y 220 when the button appeared. Fix: a row-shaped skeleton, and the Mark all read slot reserved (disabled) while loading.

### F-notifications-2

The empty inbox is a muted `p`, "You have no notifications." ([shot](img/notifications/notifications--empty.jpg)), as is the bell's "You have no notifications.". Fix: shadcn's `empty` on the page.

### F-notifications-3

Load more is an outline `Button` whose label turns to "Loading…" while the next page is fetched (`src/pages/_app/notifications.tsx`). Fix: shadcn's `spinner` in the button, or `pagination` if the inbox moves to pages.

### F-notifications-4

Each of the bell's five previews is a `DropdownMenuItem` rendered as a link to `/notifications`, the same target as View all notifications, so a click never opens or marks the notification it names. The unread mark is the text character "●" in an `aria-hidden` span (`src/components/features/notification-bell.tsx`). In the walk the menu read "Notifications / ● Verify your email / View all notifications". Fix: open the notification (or its target) from its row and mark it read; draw the unread dot as a styled element like the sidebar's badge.

### F-notifications-5

The sidebar's Notifications item (with the unread count) opens the inbox, `/notifications`. The account menu's Notifications item opens `/settings/account/notifications`, the delivery preferences (seen in the walk). Same label, same bell icon, different pages. Fix: call the menu item "Notification settings", as the inbox's own link does.

### F-notifications-6

The capture's owner and the walk's owner were both registered and verified before signing in, and both inboxes held an unread "Verify your email — Please verify your email address for Express Boilerplate." ([shot](img/notifications/notifications--default.jpg)). The notification is created at registration by the API and stays after the address is verified. Fix: mark it read (or delete it) on verification, in express.

### F-settings-1

The three workspace pages await the tenant detail in the `/settings/workspace/$slug` loader, so their capture loading shots recorded `loadingUi: "splash"` ([general](img/settings/workspace-general--loading.jpg), [members](img/settings/workspace-members--loading.jpg), [activity](img/settings/workspace-activity--loading.jpg)), the mechanism in [F-boot-2](#f-boot-2). In the app, the same wait shows `RoutePending`'s lone spinner, as in [F-tenants-1](#f-tenants-1) (inferred from the shared loader; the walk timed it on the tenant layout). Fix: as F-tenants-1, a settings-shaped skeleton under the settings shell's heading while the detail loads.

### F-settings-2

With the tenant read failing, every workspace page shows the settings heading and one `LoadError` from `TenantLoadFailed` in place of all its cards ([general](img/settings/workspace-general--error.jpg), [members](img/settings/workspace-members--error.jpg), [activity](img/settings/workspace-activity--error.jpg)). The cards below the gate each have their own request and their own error branch: in the walk, a 500 on only `GET /tenants/:slug/invitations` showed one `LoadError` in Pending invitations, and a 500 on only `GET /tenants/:slug/settings` one in the Settings card, the rest usable. The gate needs the detail for the "{name} · /{slug}" line and the role. Fix: render the cards that do not need the detail while it loads or fails, and put the tenant failure in the line it feeds.

### F-settings-3

`SecuritySection`'s loading branch is `h-5 w-40` and `h-9` ([shot](img/settings/account-security--loading.jpg)). It is replaced by "Sign-in methods", the method, "Change password" and three labelled fields with a button ([shot](img/settings/account-security--default.jpg)): in the walk Other sessions moved from y 284 to y 578 (layout shift 0.026). Fix: a skeleton shaped like the methods line and the password form.

### F-settings-4

`PreferencesCard` shows one `h-14` bar ([shot](img/settings/account-notifications--loading.jpg)) for four bordered rows of about 46 px each ([shot](img/settings/account-notifications--default.jpg)). Fix: one skeleton row per expected kind.

### F-settings-5

On the workspace pages, once the gate has the detail: members shows 2× `h-10` and invitations 2× `h-10` for a table with a header row and a list of invitation rows (in the walk the table's arrival pushed Invite a member from y 438 to y 515.5, layout shift 0.017); activity shows `h-24` while the role resolves and 2× `h-14` for the log, with no filter row; General's Overview card shows 2× `h-9` for four fields and a button. Shapes from `tenant-members-panel.tsx`, `pending-invitations.tsx`, `activity-list.tsx`, `tenant-activity-panel.tsx` and `tenant-overview-card.tsx`; the capture's shots of these pages are the splash, so these skeletons are seen only in the walk. Fix: skeletons with the table's columns, the filter row and the form's fields.

### F-settings-6

The members `Table` is `min-w-2xl` inside the vendored table's `overflow-x-auto` wrapper, inside a card capped at `max-w-3xl xl:max-w-4xl`. In the walk at 1440×900 the wrapper was 848 px wide and the table 1075 px: the header cells ran Name 304–632, Email 632–920, Role 920–1287, Actions 1287–1379, and the wrapper ended at 1152. The Remove and Leave buttons sit past the card's edge, behind a sideways scroll, at the default desktop size ([shot](img/settings/workspace-members--default.jpg) shows no Actions column). The Name column falls back to the address, so a member with no name has the same address in Name and Email. Fix: in the data table, fit the columns to the card (two columns of long addresses and the last-owner note under the role select push the table past it), and show "—" or the address once when there is no name.

### F-settings-7

The audit log is a `ul` of entries with two `Select` filters (sent to the API as `action`, `actorUserId`, `access`) and a "Load more activity" button ([shot](img/settings/workspace-activity--default.jpg)); pending invitations are a `ul` of bordered rows with Resend and Revoke ([shot](img/settings/workspace-members--default.jpg)). Both are tabular (actor, action, time; address, role, inviter, expiry), and Load more is hand-rolled paging. Fix: render both with shadcn's `table`, and the log's paging with `pagination`, keeping ordering, filtering and paging on the API.

### F-settings-8

Every empty list in settings is a muted `p`: "This account has no notification types yet." ([shot](img/settings/account-notifications--empty.jpg)), "No one has access to this tenant yet. Invite someone below." and "No invitations are waiting to be accepted." ([shot](img/settings/workspace-members--empty.jpg)), "Nothing has happened in this tenant yet." and "Nothing matches these filters." ([shot](img/settings/workspace-activity--empty.jpg)). Fix: shadcn's `empty`, with the invite form or a clear-filters button as its action where one applies.

### F-settings-9

`TenantActivityPanel` titles its card with an `sr-only` `h2`, so the first visible thing in the card is the description "What platform staff did is marked Staff." above the filters ([shot](img/settings/workspace-activity--default.jpg)). Out of context it reads like a footnote about staff, and most tenants never see a Staff badge. Fix: drop the line from the top, and explain the badge where it appears (its tooltip) or under the filters.

### F-settings-10

The page subtitle is "How each kind of notification reaches you." and the card's description starts with the same sentence before "Email for these notifications cannot be turned off, but you can turn off the in-app copy." ([shot](img/settings/account-notifications--default.jpg)). Fix: keep only the second sentence in the card.

### F-settings-11

On General, Timezone is a plain `Input` described "A time zone name such as Europe/London.", Locale a plain input, and Metadata a raw JSON `Textarea` ([shot](img/settings/workspace-general--default.jpg)). A mistyped zone is caught only by the server. The page's first card is titled "Overview", which is also the name of the tenant's own overview tab, one click away. Fix: a searchable timezone `Combobox` fed by `Intl.supportedValuesOf('timeZone')`, and a card title such as "Details".

### F-settings-12

The security page is one `Card` with no title holding three sections, "Sign-in methods", "Change password" and "Other sessions", as small bold labels with no separators; "Change password" sits directly on top of the "Current password" label ([shot](img/settings/account-security--default.jpg)). Fix: one titled card per section, as Profile does with its Details card.

### F-settings-13

At 390 px the members list is cards ([shot](img/settings/workspace-members--mobile.jpg)): the name line falls back to the address and the line below repeats it, and `break-all` splits it mid-word ("example.co / m"). The breadcrumb above wraps to two lines (46 px in the walk). Fix: show the address once and let it truncate; shorten the breadcrumb as in [F-tenants-5](#f-tenants-5).

### F-settings-14

Settings pages are reached from the sidebar's Settings item (then the settings nav), the account menu (Profile, Notifications), or the landing page's rows; the theme is in its own header menu; Sign out is in the account menu. In the walk each took two or three clicks through a different menu, and nothing has a keyboard shortcut. Fix: the react palette lists every settings page, the three themes and Sign out.
