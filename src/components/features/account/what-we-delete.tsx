import { useId } from 'react'

/**
 * What we delete and what we keep, for the settings page and the public
 * `/delete-account` page. Every statement comes from express's SECURITY.md
 * "Account deletion" and "Purge" sections, and the owner confirms them in the
 * pull request. `headingLevel` follows the heading above it on the page.
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
        After that, we permanently erase your name, your email address and the emails we sent you.
        We also ask our analytics provider to delete your profile, events and recordings.
      </p>
      <p>
        We keep our audit log, which records actions taken in your account and workspaces. Once we
        erase your account, those entries no longer carry your user ID, IP address or browser
        details.
      </p>
      <p>
        If you’re the only owner of a workspace, or you pay for one, we contact you first to hand it
        over.
      </p>
    </section>
  )
}
