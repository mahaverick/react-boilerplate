/**
 * @file Fixture ids shaped like the API's own. express validates an invitation's `:id` and the
 * audit log's id filters as UUIDs, so a non-UUID id models a request the real API would refuse
 * with a 400.
 *
 * Hand-written and fixed, never generated, so an assertion can name the id it expects. The first
 * digit names the kind (1 tenant, 2 user, 3 membership, 4 invitation, 5 notification, 6 audit
 * entry) and the last digits the ordinal; `...100` is the platform-side one.
 */

/** The tenant most tests act in. */
export const TENANT_ID = '10000000-0000-4000-8000-000000000001'
/** The second tenant ('Beta Inc', 'Globex') in the tenant switcher tests. */
export const TENANT_ID_2 = '10000000-0000-4000-8000-000000000002'
/** A third tenant; no test imports it. */
export const TENANT_ID_3 = '10000000-0000-4000-8000-000000000003'
/** A fourth tenant; no test imports it. */
export const TENANT_ID_4 = '10000000-0000-4000-8000-000000000004'
/**
 * The extra tenant ('Umbrella') that the switcher's "Your tenants" filter test lists beside Acme.
 */
export const TENANT_ID_9 = '10000000-0000-4000-8000-000000000009'
/**
 * The platform tenant (`isPlatform`) that staff belong to, in the switcher and platform member
 * tests.
 */
export const PLATFORM_TENANT_ID = '10000000-0000-4000-8000-000000000100'
/** `testUser.id`: the user every signed-in test signs in as. */
export const USER_ID = '20000000-0000-4000-8000-000000000001'
/**
 * A user other than the signed-in one: the different identity a refresh returns in the session
 * tests, and Ada or Cleo in the members and a11y tests.
 */
export const USER_ID_2 = '20000000-0000-4000-8000-000000000002'
/** Vic, a viewer member in the members tests. */
export const USER_ID_3 = '20000000-0000-4000-8000-000000000003'
/** Otto, a second owner in the members tests, so the signed-in owner is not the last one. */
export const USER_ID_4 = '20000000-0000-4000-8000-000000000004'
/** Amy, an admin member in the members tests that check what each role may touch. */
export const USER_ID_5 = '20000000-0000-4000-8000-000000000005'
/** The nameless actor of an audit entry in the activity tests. */
export const USER_ID_9 = '20000000-0000-4000-8000-000000000009'
/**
 * The staff actor ('Sam Staff') of the platform-side audit entries in the activity and a11y tests.
 */
export const STAFF_USER_ID = '20000000-0000-4000-8000-000000000100'
/** `USER_ID`'s membership; `MEMBERSHIP_ID_n` is `USER_ID_n`'s. */
export const MEMBERSHIP_ID = '30000000-0000-4000-8000-000000000001'
/** `USER_ID_2`'s membership. */
export const MEMBERSHIP_ID_2 = '30000000-0000-4000-8000-000000000002'
/** `USER_ID_3`'s membership. */
export const MEMBERSHIP_ID_3 = '30000000-0000-4000-8000-000000000003'
/** `USER_ID_4`'s membership. */
export const MEMBERSHIP_ID_4 = '30000000-0000-4000-8000-000000000004'
/** `USER_ID_5`'s membership. */
export const MEMBERSHIP_ID_5 = '30000000-0000-4000-8000-000000000005'
/**
 * The pending invitation that the members tests resend or revoke, and that the mock handlers
 * serve.
 */
export const INVITATION_ID = '40000000-0000-4000-8000-000000000001'
/** A second pending row in the invitations list, in the members tests. */
export const INVITATION_ID_2 = '40000000-0000-4000-8000-000000000002'
/**
 * A third pending row in the invitations list, with the editor or manager role, in the members
 * tests.
 */
export const INVITATION_ID_3 = '40000000-0000-4000-8000-000000000003'
/** A fourth pending row, the editor, in the members test that runs every role. */
export const INVITATION_ID_4 = '40000000-0000-4000-8000-000000000004'
/** A fifth pending row, the viewer, in the members test that runs every role. */
export const INVITATION_ID_5 = '40000000-0000-4000-8000-000000000005'
/**
 * The invitation that appears only after the refetch in the members test where a racing invite
 * wins.
 */
export const INVITATION_ID_9 = '40000000-0000-4000-8000-000000000009'
/**
 * The notification that the bell, the notifications page and the query tests read or mark as read.
 */
export const NOTIFICATION_ID = '50000000-0000-4000-8000-000000000001'
/** A second notification row, in the a11y and e2e harness lists. */
export const NOTIFICATION_ID_2 = '50000000-0000-4000-8000-000000000002'
/** A later notification, used as the `Last-Event-ID` a stream resumes from. */
export const NOTIFICATION_ID_7 = '50000000-0000-4000-8000-000000000007'
/** The 'tenant.created' entry in the activity tests. */
export const AUDIT_ID_1 = '60000000-0000-4000-8000-000000000001'
/** The staff 'tenant.settings_updated' entry in the activity and a11y tests. */
export const AUDIT_ID_2 = '60000000-0000-4000-8000-000000000002'
/** The invitation entry whose actor has no name on file, in the activity tests. */
export const AUDIT_ID_3 = '60000000-0000-4000-8000-000000000003'
/** The platform-side audit entry (`...100`); no test imports it. */
export const PLATFORM_AUDIT_ID = '60000000-0000-4000-8000-000000000100'
