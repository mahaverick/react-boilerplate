/**
 * @file Every react route and how the capture shoots it. Keyed by the route
 * tree's full paths, so a new route fails `pnpm typecheck:e2e` until it is
 * listed here. Endpoints are relative to /api/v1 (see endpoint.ts).
 */
import type { FileRoutesByFullPath } from '@/routeTree.gen'
import type { NavigationCapture, RouteCapture, Section } from './types'

/**
 * The tenant read. Its flags are not held with it: the boot waits up to 10 s
 * for them before it mounts anything, so a held flags read shows the boot shell,
 * not the page's loading state (`docs/pages/boot.md` has that frame).
 */
const TENANT: Section = {
  name: 'Tenant',
  endpoints: ['GET /tenants/:slug'],
}

/** What a list endpoint answers when it has no rows: the list envelope, empty. */
const EMPTY_PAGE = {
  items: [],
  page: { nextCursor: null, prevCursor: null, hasNext: false, hasPrev: false, limit: 20 },
}

/** Each route's capture, keyed by its full path. */
export const CAPTURES: Record<keyof FileRoutesByFullPath, RouteCapture> = {
  '/': { kind: 'redirect', to: '/dashboard when signed in, else /login' },
  '/$': {
    kind: 'page',
    area: 'system',
    shot: 'not-found',
    url: '/no-such-page',
    as: 'owner',
    sections: [],
  },
  '/reset-password': { kind: 'redirect', to: '/login?notice=sign-in-link' },
  '/verify-email': { kind: 'redirect', to: '/login?notice=sign-in-link' },
  '/welcome': {
    kind: 'page',
    area: 'auth',
    shot: 'welcome',
    url: '/welcome',
    as: 'newcomer',
    sections: [{ name: 'Tenants', endpoints: ['GET /tenants'] }],
    note: 'The newcomer has no tenant; a session with one lands on /dashboard.',
  },
  '/dashboard': {
    kind: 'page',
    area: 'dashboard',
    shot: 'dashboard',
    url: '/dashboard',
    as: 'owner',
    responsive: true,
    sections: [
      { name: 'Tenants (guard)', endpoints: ['GET /tenants'] },
      { name: 'Notifications (bell)', endpoints: ['GET /notifications'] },
    ],
  },
  '/notifications': {
    kind: 'page',
    area: 'notifications',
    shot: 'notifications',
    url: '/notifications',
    as: 'owner',
    sections: [{ name: 'Notifications', endpoints: ['GET /notifications'] }],
    empty: {
      stubs: [
        {
          endpoint: 'GET /notifications',
          data: { ...EMPTY_PAGE, total: { count: 0, capped: false } },
        },
      ],
    },
  },
  '/profile': { kind: 'redirect', to: '/settings/account/profile' },
  '/settings': {
    kind: 'layout',
    note: 'Settings shell: NavSettings replaces the sidebar; h1 from the active section.',
  },
  '/forgot-password': { kind: 'redirect', to: '/login?notice=sign-in-link' },
  '/login': {
    kind: 'page',
    area: 'auth',
    shot: 'login',
    url: '/login',
    as: 'anonymous',
    sections: [],
    responsive: true,
    note: '"Check your inbox" (after Email me a sign-in link) needs a click, which the capture does not make; take that frame by hand in the final walk.',
  },
  '/register': { kind: 'redirect', to: '/login?notice=sign-in-link' },
  '/auth/callback': {
    kind: 'redirect',
    to: '/welcome for a new account (new=1), else the safe redirect or /dashboard when signed in, else /login?error=google_auth_failed (in an effect)',
  },
  '/auth/link': {
    kind: 'page',
    area: 'auth',
    shot: 'sign-in-link',
    url: '/auth/link?{spentLinkQuery}',
    as: 'anonymous',
    sections: [{ name: 'Verify', endpoints: ['POST /auth/link/verify'] }],
    note: 'The seed owner’s spent link, so the default is the dead link with the address filled in; the loading shot is "Signing you in", the error shot "Try again".',
  },
  '/auth/confirm': {
    kind: 'page',
    area: 'auth',
    shot: 'confirm-its-you',
    url: '/auth/confirm',
    as: 'anonymous',
    sections: [],
    note: 'No token: the incomplete-link card.',
  },
  '/invitations/accept': {
    kind: 'page',
    area: 'auth',
    shot: 'invitation-accept',
    url: '/invitations/accept?token={invitationToken}',
    as: 'anonymous',
    sections: [
      { name: 'Invitation preview', endpoints: ['POST /invitations/preview'] },
      { name: 'Verify', endpoints: ['POST /invitations/verify'] },
    ],
    empty: { url: '/invitations/accept' },
    note: 'The invitee has an account, so the default is "Check your inbox" and the invitation stays pending; each shot mails another confirmation link, inside the cooldown or not.',
  },
  '/invitations/confirm': {
    kind: 'page',
    area: 'auth',
    shot: 'invitation-confirm',
    url: '/invitations/confirm?{spentConfirmationQuery}',
    as: 'anonymous',
    sections: [{ name: 'Confirm', endpoints: ['POST /invitations/confirm'] }],
    empty: { url: '/invitations/confirm' },
    note: 'The seed member’s spent confirmation link, so the default is the dead link; the empty shot is the incomplete link.',
  },
  '/tenants/$slug': {
    kind: 'layout',
    note: 'TenantGate + header + tab nav; the loader starts the tenant and awaits its flags.',
  },
  '/settings/': {
    kind: 'page',
    area: 'settings',
    shot: 'settings-index',
    url: '/settings',
    as: 'owner',
    sections: [],
  },
  '/tenants/': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenants',
    url: '/tenants',
    as: 'owner',
    responsive: true,
    sections: [{ name: 'Tenants', endpoints: ['GET /tenants'] }],
    empty: {
      stubs: [
        {
          endpoint: 'GET /tenants',
          data: EMPTY_PAGE,
        },
      ],
    },
  },
  '/settings/account/notifications': {
    kind: 'page',
    area: 'settings',
    shot: 'account-notifications',
    url: '/settings/account/notifications',
    as: 'owner',
    sections: [{ name: 'Preferences', endpoints: ['GET /notifications/preferences'] }],
    empty: { stubs: [{ endpoint: 'GET /notifications/preferences', data: { preferences: [] } }] },
  },
  '/settings/account/profile': {
    kind: 'page',
    area: 'settings',
    shot: 'account-profile',
    url: '/settings/account/profile',
    as: 'owner',
    sections: [],
    note: 'useProfile has initialData from the auth store, so the page makes no request of its own.',
  },
  '/settings/account/security': {
    kind: 'page',
    area: 'settings',
    shot: 'account-security',
    url: '/settings/account/security',
    as: 'owner',
    sections: [{ name: 'Sign-in methods', endpoints: ['GET /auth/providers'] }],
  },
  '/settings/workspace/$slug': {
    kind: 'layout',
    note: 'TenantGate (h2); the loader starts the tenant and awaits its flags.',
  },
  '/tenants/$slug/activity': { kind: 'redirect', to: '/settings/workspace/$slug/activity' },
  '/tenants/$slug/beta': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-beta',
    url: '/tenants/{slug}/beta',
    as: 'owner',
    sections: [TENANT, { name: 'Beta', endpoints: ['GET /tenants/:slug/beta'] }],
    note: 'Gated by the example_beta_page flag; with the flag off this is the not-found screen.',
  },
  '/tenants/$slug/members': { kind: 'redirect', to: '/settings/workspace/$slug/members' },
  '/tenants/$slug/settings': { kind: 'redirect', to: '/settings/workspace/$slug/general' },
  '/settings/account/': { kind: 'redirect', to: '/settings/account/profile' },
  '/tenants/$slug/': {
    kind: 'page',
    area: 'tenants',
    shot: 'tenant-overview',
    url: '/tenants/{slug}',
    as: 'owner',
    responsive: true,
    roleDenied: {
      as: 'member',
      note: 'An editor: no Dismiss; owner-or-admin steps say "An owner or admin can do this".',
    },
    sections: [TENANT, { name: 'Getting started', endpoints: ['GET /tenants/:slug/onboarding'] }],
    empty: {
      stubs: [
        {
          endpoint: 'GET /tenants/:slug/onboarding',
          data: {
            state: 'not_tracked',
            steps: [],
            requiredDone: 0,
            requiredTotal: 0,
            completedAt: null,
            dismissedAt: null,
          },
        },
      ],
    },
  },
  '/settings/workspace/$slug/activity': {
    kind: 'page',
    area: 'settings',
    shot: 'workspace-activity',
    url: '/settings/workspace/{slug}/activity',
    as: 'owner',
    roleDenied: {
      as: 'member',
      note: 'An editor: the owners-and-admins message; no members or audit-log request.',
    },
    sections: [
      TENANT,
      { name: 'Members (actor filter)', endpoints: ['GET /tenants/:slug/members'] },
      { name: 'Activity', endpoints: ['GET /tenants/:slug/audit-log'] },
    ],
    empty: {
      stubs: [{ endpoint: 'GET /tenants/:slug/audit-log', data: EMPTY_PAGE }],
    },
  },
  '/settings/workspace/$slug/general': {
    kind: 'page',
    area: 'settings',
    shot: 'workspace-general',
    url: '/settings/workspace/{slug}/general',
    as: 'owner',
    roleDenied: { as: 'member', note: 'An editor: ReadOnlyBanner and read-only details.' },
    sections: [TENANT, { name: 'Settings', endpoints: ['GET /tenants/:slug/settings'] }],
  },
  '/settings/workspace/$slug/members': {
    kind: 'page',
    area: 'settings',
    shot: 'workspace-members',
    url: '/settings/workspace/{slug}/members',
    as: 'owner',
    responsive: true,
    roleDenied: {
      as: 'member',
      note: 'An editor: ReadOnlyBanner, plain-text roles, no invite form or pending invitations.',
    },
    sections: [
      TENANT,
      { name: 'Members', endpoints: ['GET /tenants/:slug/members'] },
      { name: 'Pending invitations', endpoints: ['GET /tenants/:slug/invitations'] },
    ],
    empty: {
      stubs: [
        { endpoint: 'GET /tenants/:slug/members', data: EMPTY_PAGE },
        { endpoint: 'GET /tenants/:slug/invitations', data: EMPTY_PAGE },
      ],
    },
  },
  '/settings/workspace/$slug/billing': {
    kind: 'page',
    area: 'settings',
    shot: 'workspace-billing',
    url: '/settings/workspace/{slug}/billing',
    as: 'owner',
    sections: [TENANT],
    note: 'A placeholder: the billing page replaces it.',
  },
  '/settings/workspace/$slug/': { kind: 'redirect', to: '/settings/workspace/$slug/general' },
}

/** The in-app navigations the capture shoots mid-flight: the route template, then the section skeletons. */
export const NAVIGATIONS: readonly NavigationCapture[] = [
  {
    area: 'settings',
    shot: 'account-notifications',
    as: 'owner',
    from: '/settings/account/profile',
    link: 'Notifications',
    template: { variant: 'settings', nested: true },
    endpoints: ['GET /notifications/preferences'],
  },
  {
    area: 'tenants',
    shot: 'tenant-overview',
    as: 'owner',
    from: '/tenants',
    link: '{tenantName}',
    template: { variant: 'detail', nested: false },
    endpoints: ['GET /tenants/:slug', 'GET /tenants/:slug/onboarding'],
  },
  {
    area: 'settings',
    shot: 'account-security',
    as: 'owner',
    from: '/settings/account/profile',
    link: 'Security',
    template: { variant: 'settings', nested: true },
    endpoints: ['GET /auth/providers'],
  },
]
