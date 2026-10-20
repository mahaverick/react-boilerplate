import { useForm } from '@tanstack/react-form'
import { useId, useRef, useState } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useCountdown } from '@/hooks/use-countdown'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useSignedInElsewhere } from '@/hooks/use-signed-in-elsewhere'
import { messageFrom, retryAfterSecondsFrom } from '@/lib/api-error'
import { formatClock } from '@/lib/countdown'
import { toast } from '@/lib/toast'
import { useRequestSignInLink } from '@/queries/auth.queries'
import { signInLinkRequestSchema } from '@/schemas/auth.schemas'

/** How long resend waits after each link is sent, in seconds; a 429's `Retry-After` can make it longer. */
export const RESEND_COOLDOWN_SECONDS = 60

/** The card title a page shows once a link is on its way. */
export const CHECK_INBOX_TITLE = 'Check your inbox'

/** The card title for a sign-in link the server refused: it says nothing about which way it died. */
export const LINK_DEAD_TITLE = 'This link expired or was already used'

/** What a page hands the form. */
interface SignInLinkFormProps {
  /** The address the last link went to; null shows the email form. The page owns it, so it can title its card. */
  sentTo: string | null
  onSentToChange: (email: string | null) => void
  /** Already passed through safeRedirect by the page. */
  redirect?: string
  defaultEmail?: string
  /** Defaults to 'Email me a sign-in link'; the dead-link page passes 'Email me a new link'. */
  submitLabel?: string
  /** Called once another tab signed this browser in and ensureSession() resolved. */
  onSignedIn: () => void
  /** True where a passkey can sign in: the email field then carries the `webauthn` autofill token. */
  passkeyAutofill?: boolean
}

/**
 * The one sign-in form: an email field that requests a link, then "Check your
 * inbox" with a resend countdown. The value is parsed before posting, so the
 * schema's trimming and lowercasing reach the wire.
 *
 * While it waits on the inbox it listens, through `useSignedInElsewhere`, for
 * another tab's `signed_in`, sent after that tab used the link. The email
 * form has sent nothing to wait for, so it does not listen.
 */
export function SignInLinkForm({
  sentTo,
  onSentToChange,
  redirect,
  defaultEmail,
  submitLabel = 'Email me a sign-in link',
  onSignedIn,
  passkeyAutofill = false,
}: SignInLinkFormProps) {
  const request = useRequestSignInLink()
  /** The epoch-ms time resend opens again. */
  const [resendAt, setResendAt] = useState<number | null>(null)
  /** What the field shows when the form returns, so "Use a different email" keeps the address. */
  const [lastEmail, setLastEmail] = useState(defaultEmail ?? '')
  /** Which control takes focus once it mounts, because the one just used is gone or changed. */
  const focusNext = useRef<'resend' | 'email' | null>(null)

  useSignedInElsewhere(Boolean(sentTo), onSignedIn)

  /** Hands focus to the control a step left behind, unless the person has moved on. */
  const takeFocus = (key: 'resend' | 'email') => (element: HTMLElement | null) => {
    if (!element || focusNext.current !== key) return
    focusNext.current = null
    const active = document.activeElement
    if (active === null || active === document.body) element.focus()
  }

  /** Posts a link request; on a 202 the page moves to the inbox state and the resend clock restarts. */
  const send = async (email: string) => {
    await request.mutateAsync({ email, redirect })
    setLastEmail(email)
    setResendAt(Date.now() + RESEND_COOLDOWN_SECONDS * 1_000)
    focusNext.current = 'resend'
    onSentToChange(email)
  }

  if (sentTo === null) {
    return (
      <EmailStep
        initialEmail={lastEmail}
        submitLabel={submitLabel}
        busy={request.isPending}
        onSend={send}
        inputRef={takeFocus('email')}
        passkeyAutofill={passkeyAutofill}
      />
    )
  }

  return (
    <InboxStep
      sentTo={sentTo}
      resendAt={resendAt}
      busy={request.isPending}
      resendRef={takeFocus('resend')}
      onResend={() => {
        send(sentTo).catch((error: unknown) => {
          const wait = retryAfterSecondsFrom(error)
          if (wait !== null) {
            setResendAt((current) => Math.max(current ?? 0, Date.now() + wait * 1_000))
          }
          toast.error(messageFrom(error))
        })
      }}
      onChangeEmail={() => {
        focusNext.current = 'email'
        onSentToChange(null)
      }}
    />
  )
}

/** The email field and its submit button. A 400's field detail lands on the field; any other failure on the form. */
function EmailStep({
  initialEmail,
  submitLabel,
  busy,
  onSend,
  inputRef,
  passkeyAutofill,
}: {
  initialEmail: string
  submitLabel: string
  busy: boolean
  onSend: (email: string) => Promise<void>
  inputRef: (element: HTMLElement | null) => void
  passkeyAutofill: boolean
}) {
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { email: initialEmail },
    validators: { onSubmit: signInLinkRequestSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await onSend(signInLinkRequestSchema.parse(value).email)
      } catch (submitError) {
        serverErrors.capture(submitError)
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors} className="space-y-0">
      <FieldGroup className="gap-6">
        <FormField form={form} name="email">
          {(field) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  ref={inputRef}
                  type="email"
                  autoComplete={passkeyAutofill ? 'username webauthn' : 'email'}
                  placeholder="you@example.com"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        <FormError />

        <BusyButton busy={busy} busyLabel="Sending…" type="submit" className="w-full">
          {submitLabel}
        </BusyButton>
      </FieldGroup>
    </Form>
  )
}

/**
 * "Check your inbox": where the link went, its rules, and a resend that waits
 * out the cooldown. The clock sits outside the status line, so it is not
 * announced every second; the button stays focusable while it waits.
 */
function InboxStep({
  sentTo,
  resendAt,
  busy,
  resendRef,
  onResend,
  onChangeEmail,
}: {
  sentTo: string
  resendAt: number | null
  busy: boolean
  resendRef: (element: HTMLElement | null) => void
  onResend: () => void
  onChangeEmail: () => void
}) {
  const left = useCountdown(resendAt)
  const sentLineId = useId()
  return (
    <div className="grid gap-4 text-center text-sm">
      <p id={sentLineId} role="status">
        We sent a sign-in link to <Pii>{sentTo}</Pii>.
      </p>
      <p className="text-muted-foreground">The link works once and expires in 15 minutes.</p>
      <BusyButton
        ref={resendRef}
        // Focus lands here as the status line mounts, so the button carries the line in case the region is not announced.
        aria-describedby={sentLineId}
        busy={busy}
        busyLabel="Sending…"
        variant="outline"
        className="w-full"
        disabled={left > 0}
        focusableWhenDisabled
        onClick={onResend}
      >
        {left > 0 ? `Resend in ${formatClock(left)}` : 'Resend link'}
      </BusyButton>
      <Button variant="link" onClick={onChangeEmail}>
        Use a different email
      </Button>
    </div>
  )
}
