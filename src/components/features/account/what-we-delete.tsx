import { useId } from 'react'

/**
 * What we delete and what we keep, for the settings page and the public
 * `/delete-account` page. Every statement comes from express's SECURITY.md
 * "Account deletion" and "Purge" sections, `redactActor` and the audit-log
 * retention default (`RETENTION_AUDIT_LOGS_DAYS`, 0: no end date). The sole-owner and payer refusals are
 * express's 409s in `deleteUser`. `headingLevel` follows the heading above it.
 */
export function WhatWeDelete({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const headingId = useId()
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <section aria-labelledby={headingId} className="grid gap-2 text-sm">
      <Heading id={headingId} className="font-medium">
        What we delete
      </Heading>
      <p>
        Within 30 days of your request, we delete your account and sign you out everywhere. You
        can’t sign in to it again, and we remove its Google sign-in link.
      </p>
      <p>
        We can’t delete it while you’re the only owner of a workspace, even one with no other
        members, or while you pay for a running subscription. Your request then stays open. Our
        staff help hand the workspace over or delete it, or move the subscription to a co-owner or
        cancel it. Then we delete your account.
      </p>
      <p>
        When our staff purge your account, we permanently erase your name, your email address and
        the emails we sent you. We set no date for the purge. At the purge, we also ask our
        analytics provider to delete your profile, events and recordings.
      </p>
      <p>
        We keep our audit log, which records actions taken in your account and workspaces. At the
        purge, entries for actions you took lose your user ID, IP address and browser details.
        Entries about your account keep the account’s ID. We keep audit entries with no end date,
        unless we set a retention period for the audit log.
      </p>
    </section>
  )
}
