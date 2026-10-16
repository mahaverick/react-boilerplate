/** Descending authority. Mirrors MEMBERSHIP_ROLES on the server. Apart from `roles.ts` so a route schema can use it without the permission rules. */
export const MEMBERSHIP_ROLES = ['owner', 'admin', 'manager', 'editor', 'viewer'] as const
