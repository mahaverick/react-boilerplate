# Findings

Each finding: where, what is wrong, evidence, and the part that fixes it.

The tag names the work that fixes it: `[P2 loading]` boot and loading states, `[P3 shadcn]` the shadcn refresh, `[P4 table]` the data table, `[P5 palette]` the command palette, and `[UX]` a copy or flow change outside those.

| Id         | Route                       | Tag          | Finding                                                                                                                                  | Evidence                                                 |
| ---------- | --------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| F-boot-1   | cold load                   | [P2 loading] | The splash paints unstyled in the top-left, then re-paints centred once the CSS arrives.                                                 | [frames](boot.md#frame-by-frame)                         |
| F-boot-2   | cold load of an `_app` page | [P2 loading] | Every request the boot awaits holds the whole screen on the splash; a slow tenant or flags answer shows no shell, skeleton or progress.  | [boot](boot.md#what-happens), `report.json`              |
| F-auth-1   | `/verify-email`             | [UX]         | Without `?token` the page shows the form with an empty token field, where the other mailed-link pages say the link is incomplete.        | [shot](auth.md#verify-email--verify-your-email)          |
| F-auth-2   | `/verify-email`             | [UX]         | The verification token is shown as an editable text field the user has no reason to read or change.                                      | [shot](auth.md#verify-email--verify-your-email)          |
| F-auth-3   | `/invitations/accept`       | [P2 loading] | The loading card has a different title and about half the height of the card that replaces it, so the page jumps when the preview lands. | [shots](auth.md#invitationsaccept--accept-an-invitation) |
| F-auth-4   | `/invitations/accept`       | [UX]         | The error state says "We could not load this invitation" twice, in the title and again in the `LoadError` box nested inside the card.    | [shot](auth.md#invitationsaccept--accept-an-invitation)  |
| F-auth-5   | `/login`, `/register`       | [UX]         | The agreement line says "By clicking continue", but the primary buttons say "Sign in" and "Create account".                              | [shot](auth.md#login--sign-in)                           |
| F-system-1 | `/$`                        | [UX]         | The not-found page has no app shell for a signed-in user and no auth frame for a signed-out one: a bare card on a plain page.            | [shot](system.md#--not-found)                            |

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
