# Changelog

## [4.0.3](https://github.com/mahaverick/react-boilerplate/compare/v4.0.2...v4.0.3) (2026-10-20)


### Bug Fixes

* **copy:** absolute dates, named tenants, units and no vague time in ui copy ([#135](https://github.com/mahaverick/react-boilerplate/issues/135)) ([499d248](https://github.com/mahaverick/react-boilerplate/commit/499d248c7637bfc73ab2772625d48607747ce92a))

## [4.0.2](https://github.com/mahaverick/react-boilerplate/compare/v4.0.1...v4.0.2) (2026-10-20)


### Bug Fixes

* abort cancelled queries, reword legacy copy, share the sign-in listener ([#132](https://github.com/mahaverick/react-boilerplate/issues/132)) ([0b1240e](https://github.com/mahaverick/react-boilerplate/commit/0b1240eaa68669115223730ddb01b41933225419))

## [4.0.1](https://github.com/mahaverick/react-boilerplate/compare/v4.0.0...v4.0.1) (2026-10-20)


### Bug Fixes

* **invitations:** describe the one-click and confirm-by-email join ([#130](https://github.com/mahaverick/react-boilerplate/issues/130)) ([894f08c](https://github.com/mahaverick/react-boilerplate/commit/894f08ccb375ef31bfc3ac39459cf472fb1d22f5))

## [4.0.0](https://github.com/mahaverick/react-boilerplate/compare/v3.4.3...v4.0.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* password sign-in, registration, password reset and verify-email are removed. Sign-in is by emailed link or Google: /login requests a link, /auth/link spends it, and the first sign-in creates the account. New users land on /welcome to create a workspace; invitations join from /invitations/accept, or confirm by email at /invitations/confirm. /register, /forgot-password, /reset-password and /verify-email redirect to /login?notice=sign-in-link. This needs express >= 6.0.0.

#### Code a derived project must update

* Removed: loginSchema, registerSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, resendVerificationSchema, changePasswordSchema, MIN_PASSWORD_LENGTH and their *Input types (src/schemas/auth.schemas.ts now exports emailSchema and signInLinkRequestSchema); every password query and mutation in src/queries/auth.queries.ts (useLogin, useRegister, useForgotPassword, useResetPassword, useVerifyEmail, useResendVerification, useChangePassword); EMAIL_ALREADY_VERIFIED, INVITATION_EMAIL_UNVERIFIED and AuthProviders.hasPassword (src/types/api.types.ts); ROUTES.register and ROUTES.forgotPassword.
* Added: ROUTES.authLink, ROUTES.welcome, ROUTES.invitationConfirm; useRequestSignInLink and useVerifySignInLink (src/queries/auth.queries.ts); useVerifyInvitation and useConfirmInvitation (src/queries/invitation.queries.ts).
* Moved: useCreateTenant, useUpdateTenant, useTenantSettings and useUpdateTenantSettings, from @/queries/tenant.queries to @/queries/tenant-forms.queries.
* Changed: SocialProvider.href is now hrefFor(redirect?) and sends app=web; TenantInvitation gains lastSentAt and resendAvailableAt; AcceptedInvitation gains alreadyMember; ANALYTICS_URL_QUERY_ALLOWLIST adds utm_source, utm_medium, utm_campaign and utm_content (kept only when the value matches ^[a-z0-9_-]{1,64}$); messageFrom's fallback text changed.

### Features

* passwordless sign-in by email link and Google ([26b0b63](https://github.com/mahaverick/react-boilerplate/commit/26b0b63fc880c901a3dd372a29ec73cc21420d8d))

## [3.4.3](https://github.com/mahaverick/react-boilerplate/compare/v3.4.2...v3.4.3) (2026-10-17)


### Bug Fixes

* **palette:** drop the blank band under the search input, with after-shots ([#124](https://github.com/mahaverick/react-boilerplate/issues/124)) ([83aa34a](https://github.com/mahaverick/react-boilerplate/commit/83aa34a9c0f49a57f4692fca8a4c6f8b10e4718e))

## [3.4.2](https://github.com/mahaverick/react-boilerplate/compare/v3.4.1...v3.4.2) (2026-10-17)


### Bug Fixes

* **telemetry:** mask the prefixed list search keys in posthog URLs ([#121](https://github.com/mahaverick/react-boilerplate/issues/121)) ([8e85994](https://github.com/mahaverick/react-boilerplate/commit/8e85994e2b39764f98ccdf52f8734724b56a4a46))

## [3.4.1](https://github.com/mahaverick/react-boilerplate/compare/v3.4.0...v3.4.1) (2026-10-17)


### Bug Fixes

* **csp:** import zod-jitless first in every module that imports zod ([#119](https://github.com/mahaverick/react-boilerplate/issues/119)) ([55d2470](https://github.com/mahaverick/react-boilerplate/commit/55d24705457dd91265885026e45d8946d47ac158))

## [3.4.0](https://github.com/mahaverick/react-boilerplate/compare/v3.3.0...v3.4.0) (2026-10-17)


### Features

* **palette:** a ⌘K command palette on a core shared with apex ([#116](https://github.com/mahaverick/react-boilerplate/issues/116)) ([aa0ccd4](https://github.com/mahaverick/react-boilerplate/commit/aa0ccd41368aec2e24eac17df32d1a448b69582f))

## [3.3.0](https://github.com/mahaverick/react-boilerplate/compare/v3.2.0...v3.3.0) (2026-10-16)


### Features

* **lists:** one shared DataTable for every list, on the 5.0.0 list API ([#114](https://github.com/mahaverick/react-boilerplate/issues/114)) ([4bedaad](https://github.com/mahaverick/react-boilerplate/commit/4bedaad943246530a52edb201e79d17156ca77d7))

## [3.2.0](https://github.com/mahaverick/react-boilerplate/compare/v3.1.0...v3.2.0) (2026-10-16)


### Features

* **loading:** styled boot shell, skeleton templates and per-section loading ([#112](https://github.com/mahaverick/react-boilerplate/issues/112)) ([8545b99](https://github.com/mahaverick/react-boilerplate/commit/8545b9944194572fb8b02c6dc2f6e7e9fdbdfa04))

## [3.1.0](https://github.com/mahaverick/react-boilerplate/compare/v3.0.1...v3.1.0) (2026-10-15)


### Features

* **ui:** shadcn sweep — shared empty/note/busy/error components, full width ([#109](https://github.com/mahaverick/react-boilerplate/issues/109)) ([add27b4](https://github.com/mahaverick/react-boilerplate/commit/add27b4c866aedcb4ad55b5cbcfb7d42a850cf72))

## [3.0.1](https://github.com/mahaverick/react-boilerplate/compare/v3.0.0...v3.0.1) (2026-10-14)


### Bug Fixes

* **toast:** add an action button option and match apex's toast files ([#104](https://github.com/mahaverick/react-boilerplate/issues/104)) ([1fac049](https://github.com/mahaverick/react-boilerplate/commit/1fac049fc6b160f7eb4032738e04c44fb8b9f1e8))

## [3.0.0](https://github.com/mahaverick/react-boilerplate/compare/v2.4.0...v3.0.0) (2026-10-14)


### ⚠ BREAKING CHANGES

* **toast:** `sonner` is gone. Import `toast` from '@/lib/toast' instead of 'sonner'; `__root.tsx` mounts `<ToastHost />`. Only success, error and warning toasts with `description` and `id` options exist; `toast.getToasts()` has no replacement. The default timeout is Base UI's 5 s (sonner's was 4 s).

### Features

* **toast:** replace sonner with the Base UI toast ([b90d60e](https://github.com/mahaverick/react-boilerplate/commit/b90d60ef4f50ddd0d73578117e1100d9ebe446cd))

## [2.4.0](https://github.com/mahaverick/react-boilerplate/compare/v2.3.3...v2.4.0) (2026-10-14)


### Features

* **tenant:** carry the current tenant in the URL ([#100](https://github.com/mahaverick/react-boilerplate/issues/100)) ([b15d9a2](https://github.com/mahaverick/react-boilerplate/commit/b15d9a2eb8edf7b565e68eacb89170fbb61026fc))

## [2.3.3](https://github.com/mahaverick/react-boilerplate/compare/v2.3.2...v2.3.3) (2026-10-13)


### Bug Fixes

* **settings:** stop settings cards repeating their page heading ([#98](https://github.com/mahaverick/react-boilerplate/issues/98)) ([19657cd](https://github.com/mahaverick/react-boilerplate/commit/19657cd2704934c43c68a88ad69046c730f5b7c8))

## [2.3.2](https://github.com/mahaverick/react-boilerplate/compare/v2.3.1...v2.3.2) (2026-10-13)


### Bug Fixes

* **a11y:** hide the vendored ui icons from assistive tech ([#95](https://github.com/mahaverick/react-boilerplate/issues/95)) ([0638cc7](https://github.com/mahaverick/react-boilerplate/commit/0638cc788fbafe73151000975c17f75247f1238f))

## [2.3.1](https://github.com/mahaverick/react-boilerplate/compare/v2.3.0...v2.3.1) (2026-10-13)


### Bug Fixes

* **settings:** one h1 when a settings page fails to render ([#93](https://github.com/mahaverick/react-boilerplate/issues/93)) ([95bb6dd](https://github.com/mahaverick/react-boilerplate/commit/95bb6dd58ffd581c50712a7e08ba6b6c8c26140a))

## [2.3.0](https://github.com/mahaverick/react-boilerplate/compare/v2.2.3...v2.3.0) (2026-10-13)


### Features

* **settings:** one settings area for account and workspace ([#91](https://github.com/mahaverick/react-boilerplate/issues/91)) ([761ebbd](https://github.com/mahaverick/react-boilerplate/commit/761ebbde3ad4abb1fd89957311ff5d26bd5b981d))

## [2.2.3](https://github.com/mahaverick/react-boilerplate/compare/v2.2.2...v2.2.3) (2026-10-13)


### Bug Fixes

* **ui:** live relative times, aligned register columns, no devtools on phones ([#89](https://github.com/mahaverick/react-boilerplate/issues/89)) ([c5b3aee](https://github.com/mahaverick/react-boilerplate/commit/c5b3aee3a2cb49a753daf05840b7b5e134477a91))

## [2.2.2](https://github.com/mahaverick/react-boilerplate/compare/v2.2.1...v2.2.2) (2026-10-13)


### Bug Fixes

* **toast:** a caller's className can no longer drop the analytics mask ([#87](https://github.com/mahaverick/react-boilerplate/issues/87)) ([98661f6](https://github.com/mahaverick/react-boilerplate/commit/98661f63406796b4c33a5ca35a41e08f763b1cab))

## [2.2.1](https://github.com/mahaverick/react-boilerplate/compare/v2.2.0...v2.2.1) (2026-10-13)


### Bug Fixes

* **shell:** one selector icon in the tenant switcher, devtools off the account menu ([#85](https://github.com/mahaverick/react-boilerplate/issues/85)) ([2029f16](https://github.com/mahaverick/react-boilerplate/commit/2029f16e4e1423319f1f85b4afd59f39a1e40a82))

## [2.2.0](https://github.com/mahaverick/react-boilerplate/compare/v2.1.2...v2.2.0) (2026-10-13)


### Features

* **ui:** restyle on the shadcn base-vega preset with login-04, signup-04 and sidebar-07 ([#83](https://github.com/mahaverick/react-boilerplate/issues/83)) ([c7a9d5f](https://github.com/mahaverick/react-boilerplate/commit/c7a9d5f4cdad7a5a23f7ae295c43563c33b04f85))

## [2.1.2](https://github.com/mahaverick/react-boilerplate/compare/v2.1.1...v2.1.2) (2026-10-13)


### Bug Fixes

* **observability:** move analytics modules off blocker-matched paths ([#81](https://github.com/mahaverick/react-boilerplate/issues/81)) ([08c71c5](https://github.com/mahaverick/react-boilerplate/commit/08c71c57be5d084d7dd08c065aa0c31e245c985d))

## [2.1.1](https://github.com/mahaverick/react-boilerplate/compare/v2.1.0...v2.1.1) (2026-10-13)


### Bug Fixes

* **e2e:** make the sse restart runbook and cleanup safe and runnable ([#79](https://github.com/mahaverick/react-boilerplate/issues/79)) ([ac2cdf4](https://github.com/mahaverick/react-boilerplate/commit/ac2cdf4fb1813dbf57b63baa7e92aed5dd55ee4b))

## [2.1.0](https://github.com/mahaverick/react-boilerplate/compare/v2.0.0...v2.1.0) (2026-10-13)


### Features

* **notifications:** switch off a notification type's in-app copy, plus open follow-up fixes ([#77](https://github.com/mahaverick/react-boilerplate/issues/77)) ([e7bc906](https://github.com/mahaverick/react-boilerplate/commit/e7bc906723be49a341d587e070e78ef994ae754b))

## [2.0.0](https://github.com/mahaverick/react-boilerplate/compare/v1.9.3...v2.0.0) (2026-10-12)


### ⚠ BREAKING CHANGES

* **auth:** the register, reset-password, change-password and verify-email forms now refuse a password shorter than 15 characters, matching express-boilerplate 4.0.0. Sign-in still accepts existing shorter passwords.

### Features

* **auth:** raise the new-password minimum to 15 characters ([e0d97d3](https://github.com/mahaverick/react-boilerplate/commit/e0d97d3f11d8d82b632f3c756f15575c575842d0))
* **auth:** show a sign-in link when a verify-email link was already used ([e0d97d3](https://github.com/mahaverick/react-boilerplate/commit/e0d97d3f11d8d82b632f3c756f15575c575842d0))

## [1.9.3](https://github.com/mahaverick/react-boilerplate/compare/v1.9.2...v1.9.3) (2026-10-12)


### Bug Fixes

* close the P3 follow-ups (member.left, invite domain, sse wording, dead fixtures) ([#72](https://github.com/mahaverick/react-boilerplate/issues/72)) ([125e7c1](https://github.com/mahaverick/react-boilerplate/commit/125e7c139183c0bf5f8d42053fcc533ab99a7786))

## [1.9.2](https://github.com/mahaverick/react-boilerplate/compare/v1.9.1...v1.9.2) (2026-10-12)


### Bug Fixes

* **errors:** sync the scrubber with express (AWS key, email query, compass) ([#70](https://github.com/mahaverick/react-boilerplate/issues/70)) ([8cfd353](https://github.com/mahaverick/react-boilerplate/commit/8cfd3534acb40375ab9d2bcd5bd923d6e8c21163))

## [1.9.1](https://github.com/mahaverick/react-boilerplate/compare/v1.9.0...v1.9.1) (2026-10-10)


### Bug Fixes

* **errors:** take express's scrubber, prune dead code and add knip to CI ([#66](https://github.com/mahaverick/react-boilerplate/issues/66)) ([de969e8](https://github.com/mahaverick/react-boilerplate/commit/de969e830a5939dd1d8a383987768ee37d976f09))

## [1.9.0](https://github.com/mahaverick/react-boilerplate/compare/v1.8.0...v1.9.0) (2026-10-10)


### Features

* **members:** staff read-only view, member_not_found and active owners, and P1 follow-ups ([#64](https://github.com/mahaverick/react-boilerplate/issues/64)) ([9d46e88](https://github.com/mahaverick/react-boilerplate/commit/9d46e884805c1569800d0ec53e89979766224c5d))

## [1.8.0](https://github.com/mahaverick/react-boilerplate/compare/v1.7.0...v1.8.0) (2026-10-09)


### Features

* leave a tenant, sign out other sessions, and the cleanup P1 client fixes ([#62](https://github.com/mahaverick/react-boilerplate/issues/62)) ([670e72f](https://github.com/mahaverick/react-boilerplate/commit/670e72f67ec5418e2d0985054657f46c3351ffa9))

## [1.7.0](https://github.com/mahaverick/react-boilerplate/compare/v1.6.0...v1.7.0) (2026-10-06)


### Features

* **tenants:** load a tenant's flags with the tenant page ([#59](https://github.com/mahaverick/react-boilerplate/issues/59)) ([c6ac388](https://github.com/mahaverick/react-boilerplate/commit/c6ac38820ae76ec823e7a831419abcf3ff3aa36d))


### Bug Fixes

* **analytics:** a stalled tab yields to a sibling's sign-in instead of repairing over it ([#60](https://github.com/mahaverick/react-boilerplate/issues/60)) ([1d30b48](https://github.com/mahaverick/react-boilerplate/commit/1d30b489f1bcf8048ee8d520a42e9e00374a87f1))

## [1.6.0](https://github.com/mahaverick/react-boilerplate/compare/v1.5.2...v1.6.0) (2026-10-06)


### Features

* **maintenance:** maintenance page, read-only banner and status poll (sp5e-1) ([#56](https://github.com/mahaverick/react-boilerplate/issues/56)) ([bd98446](https://github.com/mahaverick/react-boilerplate/commit/bd98446c8312e5198119248f9ba1f4db153eb995))

## [1.5.2](https://github.com/mahaverick/react-boilerplate/compare/v1.5.1...v1.5.2) (2026-10-06)


### Bug Fixes

* **flags:** landing pageview flag properties and SP5d review follow-ups ([#53](https://github.com/mahaverick/react-boilerplate/issues/53)) ([7127970](https://github.com/mahaverick/react-boilerplate/commit/712797090a36c658a8c495b6f760bd8700636606))

## [1.5.1](https://github.com/mahaverick/react-boilerplate/compare/v1.5.0...v1.5.1) (2026-10-06)


### Bug Fixes

* **flags:** order the $feature/* sync before the page view and reset it on sign-out ([#51](https://github.com/mahaverick/react-boilerplate/issues/51)) ([03489a7](https://github.com/mahaverick/react-boilerplate/commit/03489a77b0216e5295f0d21465e8b28d00b2fef2))

## [1.5.0](https://github.com/mahaverick/react-boilerplate/compare/v1.4.0...v1.5.0) (2026-10-05)


### Features

* read server-evaluated feature flags (sp5d) ([#49](https://github.com/mahaverick/react-boilerplate/issues/49)) ([d906f7c](https://github.com/mahaverick/react-boilerplate/commit/d906f7c407cb0076804f7e7ada0b0faec95d716f))

## [1.4.0](https://github.com/mahaverick/react-boilerplate/compare/v1.3.0...v1.4.0) (2026-10-05)


### Features

* browser error tracking and source maps (sp5c) ([#47](https://github.com/mahaverick/react-boilerplate/issues/47)) ([e5ee0a0](https://github.com/mahaverick/react-boilerplate/commit/e5ee0a043967c61aa9e393b800df57958813b73a))

## [1.3.0](https://github.com/mahaverick/react-boilerplate/compare/v1.2.1...v1.3.0) (2026-10-03)


### Features

* posthog analytics, run-time configuration, masked replay and consent (sp5a) ([#45](https://github.com/mahaverick/react-boilerplate/issues/45)) ([87a468c](https://github.com/mahaverick/react-boilerplate/commit/87a468c9591f05f8633f978883eb2af64b0c6aed))

## [1.2.1](https://github.com/mahaverick/react-boilerplate/compare/v1.2.0...v1.2.1) (2026-10-02)


### Bug Fixes

* keep keyboard focus when an action replaces its button ([#43](https://github.com/mahaverick/react-boilerplate/issues/43)) ([e490e4b](https://github.com/mahaverick/react-boilerplate/commit/e490e4b8062b9d45b26fc8f0d53d08a70b1eba9f))

## [1.2.0](https://github.com/mahaverick/react-boilerplate/compare/v1.1.1...v1.2.0) (2026-10-02)


### Features

* getting started checklist on the tenant overview (Apex SP4) ([#41](https://github.com/mahaverick/react-boilerplate/issues/41)) ([e6be0a1](https://github.com/mahaverick/react-boilerplate/commit/e6be0a151041a1fe8bb4d72d9acb07c7c878f7cc))

## [1.1.1](https://github.com/mahaverick/react-boilerplate/compare/v1.1.0...v1.1.1) (2026-09-30)


### Bug Fixes

* keep staff signed in on step-up and show suspended tenants ([#39](https://github.com/mahaverick/react-boilerplate/issues/39)) ([953600a](https://github.com/mahaverick/react-boilerplate/commit/953600aaf3fdf3c3c45fffc8211116d33eeac7f4))

## [1.1.0](https://github.com/mahaverick/react-boilerplate/compare/v1.0.1...v1.1.0) (2026-09-29)


### Features

* hand staff screens to Apex ([#36](https://github.com/mahaverick/react-boilerplate/issues/36)) ([74048d5](https://github.com/mahaverick/react-boilerplate/commit/74048d5d47b534eca0d7be52f34cdc78665efe3c))

## [1.0.1](https://github.com/mahaverick/react-boilerplate/compare/v1.0.0...v1.0.1) (2026-09-28)


### Bug Fixes

* **tenants:** reserve the platform slug ([#34](https://github.com/mahaverick/react-boilerplate/issues/34)) ([960603d](https://github.com/mahaverick/react-boilerplate/commit/960603d0ee4dc78f268c9a0a5bc3ead8d75e3ba8))

## 1.0.0 (2026-09-28)


### Features

* current-state comments and docs; restart at 1.0.0 ([#31](https://github.com/mahaverick/react-boilerplate/issues/31)) ([0d2b2da](https://github.com/mahaverick/react-boilerplate/commit/0d2b2dae0a6ce38b1d2649f177d37dd79ac852c8))
