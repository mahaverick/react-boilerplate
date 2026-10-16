/**
 * @file URL search params the list pages bind to. The router JSON-parses
 * search values before validating them, so free text needs taking back.
 */
import { z } from 'zod'

/**
 * A free-text search param. `?q=2026` arrives as a number; this takes it back
 * as text instead of dropping it. Anything else is no search.
 */
export const searchText = z
  .union([z.string(), z.number()])
  .transform(String)
  .optional()
  .catch(undefined)
