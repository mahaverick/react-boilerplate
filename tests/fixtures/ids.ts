/**
 * @file Fixture ids shaped like the API's own. express validates an invitation's `:id` and the audit log's id filters as UUIDs, so a non-UUID id models a request the real API would refuse with a 400. The first digit names the kind (1 tenant, 2 user, 3 membership, 4 invitation, 5 notification, 6 audit entry), the last digits the ordinal, and `...100` the platform-side one.
 */

/** The tenant most tests act in. */
export const TENANT_ID = '10000000-0000-4000-8000-000000000001'
/** A second tenant, for switching between tenants. */
export const TENANT_ID_2 = '10000000-0000-4000-8000-000000000002'
/** A third tenant; no test imports it. */
export const TENANT_ID_3 = '10000000-0000-4000-8000-000000000003'
/** A fourth tenant; no test imports it. */
export const TENANT_ID_4 = '10000000-0000-4000-8000-000000000004'
/** A tenant outside the numbered run, for one-off rows. */
export const TENANT_ID_9 = '10000000-0000-4000-8000-000000000009'
/** The platform tenant (`isPlatform`), as opposed to a customer tenant. */
export const PLATFORM_TENANT_ID = '10000000-0000-4000-8000-000000000100'
/** `testUser.id`: the user every signed-in test signs in as. */
export const USER_ID = '20000000-0000-4000-8000-000000000001'
/** A second user, for a different signed-in identity or another member. */
export const USER_ID_2 = '20000000-0000-4000-8000-000000000002'
/** A third user, for member lists with several people. */
export const USER_ID_3 = '20000000-0000-4000-8000-000000000003'
/** A fourth user, for member lists with several people. */
export const USER_ID_4 = '20000000-0000-4000-8000-000000000004'
/** A fifth user, for member lists with several people. */
export const USER_ID_5 = '20000000-0000-4000-8000-000000000005'
/** A user outside the numbered run, for one-off rows. */
export const USER_ID_9 = '20000000-0000-4000-8000-000000000009'
/** A platform staff user, as shown in an audit entry actor. */
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
/** The invitation most tests list, revoke or resend. */
export const INVITATION_ID = '40000000-0000-4000-8000-000000000001'
/** A second pending invitation, for lists with several rows. */
export const INVITATION_ID_2 = '40000000-0000-4000-8000-000000000002'
/** A third pending invitation, for lists with several rows. */
export const INVITATION_ID_3 = '40000000-0000-4000-8000-000000000003'
/** A fourth pending invitation, for lists with several rows. */
export const INVITATION_ID_4 = '40000000-0000-4000-8000-000000000004'
/** A fifth pending invitation, for lists with several rows. */
export const INVITATION_ID_5 = '40000000-0000-4000-8000-000000000005'
/** An invitation outside the numbered run, for one-off rows. */
export const INVITATION_ID_9 = '40000000-0000-4000-8000-000000000009'
/** The notification most tests read or mark as read. */
export const NOTIFICATION_ID = '50000000-0000-4000-8000-000000000001'
/** A second notification, for lists with several rows. */
export const NOTIFICATION_ID_2 = '50000000-0000-4000-8000-000000000002'
/** A later notification, used as the `Last-Event-ID` a stream resumes from. */
export const NOTIFICATION_ID_7 = '50000000-0000-4000-8000-000000000007'
/** The first audit entry in an activity list. */
export const AUDIT_ID_1 = '60000000-0000-4000-8000-000000000001'
/** The second audit entry in an activity list. */
export const AUDIT_ID_2 = '60000000-0000-4000-8000-000000000002'
/** The third audit entry in an activity list. */
export const AUDIT_ID_3 = '60000000-0000-4000-8000-000000000003'
/** The platform-side audit entry (`...100`); no test imports it. */
export const PLATFORM_AUDIT_ID = '60000000-0000-4000-8000-000000000100'
