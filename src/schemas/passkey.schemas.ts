import '@/lib/zod-jitless'
import { z } from 'zod'
import { PASSKEY_NAME_MAX_LENGTH } from '@/types/passkey.types'

/** Shown beside the name field and under it when the name is refused. */
export const PASSKEY_NAME_MESSAGE = 'Enter a name of 1 to 64 characters.'

/** A passkey's name: trimmed, 1 to 64 characters. Mirrors express's `passkeyNameSchema`. */
export const passkeyNameSchema = z
  .string()
  .trim()
  .min(1, PASSKEY_NAME_MESSAGE)
  .max(PASSKEY_NAME_MAX_LENGTH, PASSKEY_NAME_MESSAGE)

/** What the rename form submits. */
export const renamePasskeySchema = z.object({ name: passkeyNameSchema })
