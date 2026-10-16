/**
 * @file The inbox's URL contract, apart from the inbox's queries and writes:
 * the route's `validateSearch` reads it, so it is in the first-visit chunk, and
 * the queries module (writes, preferences) stays out of it.
 */
import { analyticsKey } from '@/observability/telemetry'
import { booleanFilter, defineList } from '@/schemas/list.schemas'

/** The inbox's URL contract: newest first, filtered by read state. */
export const notificationsList = defineList({
  sorts: ['-created'],
  filters: { unread: booleanFilter() },
  table: analyticsKey('notifications'),
})
