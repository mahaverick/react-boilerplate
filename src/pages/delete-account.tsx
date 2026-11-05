import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { WhatWeDelete } from '@/components/features/account/what-we-delete'
import { CHECK_INBOX_TITLE, SignInLinkForm } from '@/components/features/auth/sign-in-link-form'
import { AuthCard } from '@/components/layouts/auth-card'
import { AuthLayout } from '@/components/layouts/auth-layout'
import { AuthPagePending } from '@/components/shared/pending-templates'
import { APP_NAME, pageTitle } from '@/constants/app'
import { ROUTES } from '@/constants/routes'
import { isSignedInVisitor } from '@/lib/signed-in-guard'

/**
 * The public account-deletion page: the web address entered in Google Play
 * Console. Top level, under neither `_auth` nor `_app`, so it renders
 * `AuthLayout` itself. A signed-in visitor goes straight to Settings › Delete
 * account, with the check `_auth` uses; a signed-out one asks for a sign-in
 * link that lands there.
 */
export const Route = createFileRoute('/delete-account')({
  beforeLoad: () => {
    if (isSignedInVisitor()) throw redirect({ to: ROUTES.settingsDeleteAccount, replace: true })
  },
  head: () => ({ meta: [{ title: pageTitle('Delete your account') }] }),
  component: DeleteAccountPage,
  pendingComponent: AuthPagePending,
})

/** The steps to ask for deletion, the sign-in link form and what we delete. */
function DeleteAccountPage() {
  const navigate = useNavigate()
  const [sentTo, setSentTo] = useState<string | null>(null)

  return (
    <AuthLayout>
      <AuthCard
        title={sentTo ? CHECK_INBOX_TITLE : `Delete your ${APP_NAME} account`}
        description={
          sentTo
            ? undefined
            : `Sign in with an email link, then ask us to delete your ${APP_NAME} account.`
        }
      >
        <ol className="grid list-decimal gap-1 pl-5 text-sm">
          <li>Enter your email address below, and we’ll send you a sign-in link.</li>
          <li>Open the link. It takes you to Delete account in Settings.</li>
          <li>Select Request deletion. We may ask you to confirm it’s you.</li>
        </ol>
        <SignInLinkForm
          sentTo={sentTo}
          onSentToChange={setSentTo}
          redirect={ROUTES.settingsDeleteAccount}
          onSignedIn={() => {
            void navigate({ to: ROUTES.settingsDeleteAccount, replace: true })
          }}
        />
        <WhatWeDelete headingLevel={2} />
      </AuthCard>
    </AuthLayout>
  )
}
