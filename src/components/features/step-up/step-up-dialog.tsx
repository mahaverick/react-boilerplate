import { IconAlertCircle } from '@tabler/icons-react'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { SigningInStatus } from '@/components/features/auth/link-panels'
import { PasskeyConfirm } from '@/components/features/step-up/passkey-confirm'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { Alert, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCountdown } from '@/hooks/use-countdown'
import { ensureSession, isAuthVerdict, redirectToLogin, subscribeAuthMessage } from '@/http/session'
import { actionMessageFrom } from '@/lib/action-message'
import { codeFrom, retryAfterSecondsFrom, statusFrom } from '@/lib/api-error'
import { formatClock } from '@/lib/countdown'
import {
  authTimeOf,
  isNewConfirmation,
  STEP_UP_LINK_COOLDOWN_MS,
  STEP_UP_LINK_TTL_MS,
} from '@/lib/step-up'
import { holdStepUpWait } from '@/lib/step-up-presence'
import { toast } from '@/lib/toast'
import { cancelPasskeyPrompt, passkeyFailure, requestPasskey } from '@/lib/webauthn'
import { track } from '@/observability/telemetry'
import {
  useFinishPasskeyStepUp,
  useRequestStepUpLink,
  useStartPasskeyStepUp,
} from '@/queries/step-up.queries'
import { useAuthStore } from '@/states/auth.store'
import { isPasskeySetupRequired, NO_PASSKEY, STEP_UP_LINK_COOLDOWN } from '@/types/passkey.types'

/** What the dialog says when the browser's prompt failed for a reason other than being dismissed. */
const PASSKEY_PROMPT_FAILED =
  'Your browser couldn’t use your passkey. Try again, or use another method.'

/**
 * Whether the options call says this account has no passkey to use: a 409
 * `NO_PASSKEY`, the unknown-route 404 of mode `off`, or the 403 that required
 * mode answers a user still in setup. Each opens the email link with no notice.
 * @param error - The options call's rejection.
 * @returns True when the passkey path is closed to this account.
 */
function noPasskeyPath(error: unknown): boolean {
  return (
    (statusFrom(error) === 409 && codeFrom(error) === NO_PASSKEY) ||
    statusFrom(error) === 404 ||
    isPasskeySetupRequired(error)
  )
}

/**
 * Where the dialog is:
 * - `opening`: fetching the passkey options;
 * - `passkey`: the browser's passkey prompt is open, or was dismissed;
 * - `start`: why it asks, Email me a link, and any notice;
 * - `email`: waiting on an emailed link;
 * - `resuming`: confirmed elsewhere, refreshing the session;
 * - `resume_failed`: that refresh failed, with Try again.
 */
type View = 'opening' | 'passkey' | 'start' | 'email' | 'resuming' | 'resume_failed'

/**
 * Where focus goes when the step-up closes: into the dialog still open
 * beneath it (the reason dialog waiting on this confirmation), at its first
 * enabled field, else onto that dialog's popup. Left to Base UI, focus would
 * land outside that dialog, behind a modal that is still open. With no dialog
 * open beneath, the default stands.
 * @param self - The step-up's own popup, excluded from the search.
 * @returns The element to focus, or `true` for Base UI's default.
 */
function focusBeneath(self: HTMLElement | null): HTMLElement | true {
  const beneath = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][data-open], [role="alertdialog"][data-open]'
    ),
  ].filter((popup) => popup !== self && !self?.contains(popup))
  const popup = beneath.at(-1)
  if (!popup) return true
  return (
    popup.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
    ) ?? popup
  )
}

/**
 * "Confirm it's you", by passkey or by an emailed link. The body mounts only
 * while open, so every step-up starts by fetching passkey options: a user with
 * a passkey gets the browser's prompt at once, anyone else Email me a link.
 * Escape and the backdrop dismiss only where nothing is pending (the opening,
 * the passkey prompt, the start, and a failed resume); while it waits on a
 * link, only Cancel does. Any dismissal rejects the waiting action.
 */
export function StepUpDialog({
  open,
  onConfirmed,
  onDismissed,
}: {
  open: boolean
  onConfirmed: () => void
  onDismissed: () => void
}) {
  const popup = useRef<HTMLDivElement>(null)
  const sendRef = useRef<HTMLButtonElement>(null)
  const dismissible = useRef(true)
  const setDismissible = useCallback((value: boolean) => {
    dismissible.current = value
  }, [])
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissible.current) onDismissed()
      }}
    >
      <DialogContent
        ref={popup}
        showCloseButton={false}
        initialFocus={sendRef}
        finalFocus={() => focusBeneath(popup.current)}
      >
        <DialogHeader>
          <DialogTitle>Confirm it’s you</DialogTitle>
        </DialogHeader>
        {open && (
          <StepUpBody
            sendRef={sendRef}
            onConfirmed={onConfirmed}
            onDismissed={onDismissed}
            onDismissibleChange={setDismissible}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The views and what moves between them. It holds the step-up wait lock from
 * the first link sent until it unmounts, which is when the
 * provider settles the confirmation or itself unmounts, so the confirm page
 * never reports a tab that stopped waiting.
 */
function StepUpBody({
  sendRef,
  onConfirmed,
  onDismissed,
  onDismissibleChange,
}: {
  sendRef: RefObject<HTMLButtonElement | null>
  onConfirmed: () => void
  onDismissed: () => void
  onDismissibleChange: (dismissible: boolean) => void
}) {
  const requestLink = useRequestStepUpLink()
  const startPasskey = useStartPasskeyStepUp()
  const finishPasskey = useFinishPasskeyStepUp()
  const email = useAuthStore((state) => state.user?.email)
  const [view, setView] = useState<View>('opening')
  const [notice, setNotice] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState<number | null>(null)
  const [linkExpiresAt, setLinkExpiresAt] = useState<number | null>(null)
  const linkLeft = useCountdown(view === 'email' ? linkExpiresAt : null)
  const mounted = useRef(true)
  const release = useRef<(() => void) | null>(null)
  // The auth_time the session had when the wait began, from the API's clock.
  const baseline = useRef<number | null>(null)
  const resuming = useRef(false)
  // Whether the last options call answered 200, which is when the link view offers the passkey.
  const [hasPasskey, setHasPasskey] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(true)
  // Which passkey attempt is current; an older one that settles late is ignored.
  const attempt = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelPasskeyPrompt()
      release.current?.()
      release.current = null
    }
  }, [])

  useEffect(() => {
    onDismissibleChange(view !== 'email' && view !== 'resuming')
  }, [view, onDismissibleChange])
  useEffect(() => () => onDismissibleChange(true), [onDismissibleChange])

  /** Starts the wait the first time a link goes out: the lock, and the auth_time to beat. */
  const beginWait = () => {
    if (release.current) return
    baseline.current = authTimeOf(useAuthStore.getState().accessToken)
    release.current = holdStepUpWait()
  }

  /** Back to the start, with a notice or none. */
  const showStart = (message: string | null) => {
    setNotice(message)
    setView('start')
  }

  /**
   * Fetches fresh passkey options and opens the browser's prompt, then posts
   * the answer. Every attempt takes a number; an older one that settles after
   * a newer began, or after Use another method, changes nothing.
   * @param from - The view the attempt began in.
   */
  const runPasskey = async (from: View) => {
    const mine = ++attempt.current
    /** Whether this attempt is still the live one. */
    const current = () => mounted.current && attempt.current === mine
    let challenge
    try {
      challenge = await startPasskey.mutateAsync()
    } catch (error) {
      if (!current()) return
      setPasskeyBusy(false)
      if (noPasskeyPath(error)) {
        setHasPasskey(false)
        showStart(null)
      } else if (from === 'opening') {
        setHasPasskey(false)
        showStart(actionMessageFrom(error))
      } else {
        setNotice(actionMessageFrom(error))
      }
      return
    }
    if (!current()) return
    setHasPasskey(true)
    setView('passkey')
    let response
    try {
      response = await requestPasskey(challenge.options, 'modal')
    } catch (error) {
      if (!current()) return
      setPasskeyBusy(false)
      if (passkeyFailure(error) === 'cancelled')
        track('passkey_prompt_cancelled', { ceremony: 'confirm' })
      else setNotice(PASSKEY_PROMPT_FAILED)
      return
    }
    if (!current()) return
    try {
      await finishPasskey.mutateAsync({ challengeId: challenge.challengeId, response })
    } catch (error) {
      if (!current()) return
      setPasskeyBusy(false)
      setNotice(actionMessageFrom(error))
      return
    }
    // The new token is in the store, so the action retries even if the person has since moved to the link.
    if (mounted.current) onConfirmed()
  }

  /** Asks again, from a view that is already showing: clears the notice, shows busy, and from the link also opens the passkey view. */
  const promptPasskey = (from: View) => {
    setNotice(null)
    setPasskeyBusy(true)
    if (from === 'start') setView('passkey')
    void runPasskey(from)
  }

  // The opening view starts with no notice and busy, so the mount sets no state before its first await.
  const openPasskey = useEffectEvent(() => void runPasskey('opening'))
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every state change in the attempt follows its first await, so none runs in the effect body
    openPasskey()
  }, [])

  /** Leaves the passkey prompt for the emailed link. */
  const switchToLink = () => {
    attempt.current += 1
    cancelPasskeyPrompt()
    setPasskeyBusy(false)
    showStart(null)
  }

  /**
   * Mails a link. From the start, a cooldown means one was just sent, so it
   * waits on that one.
   * @param from - The view the request was made in.
   */
  const sendLink = (from: View) => {
    setNotice(null)
    requestLink.mutateAsync().then(
      ({ resendAvailableAt }) => {
        if (!mounted.current) return
        beginWait()
        setResendAt(Date.parse(resendAvailableAt))
        setLinkExpiresAt(Date.now() + STEP_UP_LINK_TTL_MS)
        setView('email')
      },
      (error: unknown) => {
        if (!mounted.current) return
        const wait = retryAfterSecondsFrom(error)
        /** Pushes the resend out to `Retry-After`, never earlier than it already was. */
        const holdResend = (seconds: number) => {
          setResendAt((current) => Math.max(current ?? 0, Date.now() + seconds * 1_000))
        }
        const cooldown = codeFrom(error) === STEP_UP_LINK_COOLDOWN && wait !== null
        const message = actionMessageFrom(error)
        // A link is already out, so the wait stays: the refusal is a toast, and a 429 moves the resend out.
        if (from === 'email') {
          if (statusFrom(error) === 429 && wait !== null) holdResend(wait)
          toast.error(message)
          return
        }
        if (cooldown) {
          beginWait()
          holdResend(wait)
          // The link went out when the cooldown began, so its 15 minutes started then.
          const sentAt = Date.now() - Math.max(0, STEP_UP_LINK_COOLDOWN_MS - wait * 1_000)
          setLinkExpiresAt((current) => current ?? sentAt + STEP_UP_LINK_TTL_MS)
          setView('email')
          return
        }
        showStart(message)
      }
    )
  }

  /**
   * Confirmed in another tab: refresh, and retry only if the new token says
   * the session confirmed since the wait began. A stray or forged message
   * brings no newer `auth_time`, so the wait goes on. A refused refresh has
   * signed this tab out, so it leaves for /login.
   */
  const resume = async () => {
    if (resuming.current) return
    resuming.current = true
    setView('resuming')
    try {
      let token = await ensureSession()
      // A refresh already in flight when the confirmation landed carries the old auth_time; the next one is fresh.
      if (mounted.current && !isNewConfirmation(baseline.current, authTimeOf(token))) {
        token = await ensureSession()
      }
      if (!mounted.current) return
      if (isNewConfirmation(baseline.current, authTimeOf(token))) {
        onConfirmed()
        return
      }
      setView('email')
    } catch (error) {
      if (!mounted.current) return
      if (isAuthVerdict(error)) {
        redirectToLogin()
        return
      }
      setView('resume_failed')
    } finally {
      resuming.current = false
    }
  }

  const onConfirmedElsewhere = useEffectEvent(() => void resume())
  useEffect(() => {
    if (view !== 'email') return
    return subscribeAuthMessage('step_up_confirmed', onConfirmedElsewhere)
  }, [view])

  /**
   * Focuses a view's main control as it mounts, when the step that brought
   * the person here took focus with it: the button they pressed has gone, so
   * focus fell to the page body. Focus anywhere else stays put, including on
   * open, where the dialog's own initial focus decides.
   */
  const arrive = useCallback((element: HTMLElement | null) => {
    const active = document.activeElement
    // Focus on the dialog's own popup is no choice either: nothing inside it had taken focus yet.
    if (
      element &&
      (active === null ||
        active === document.body ||
        !active.closest('[role="dialog"]') ||
        active.getAttribute('role') === 'dialog')
    ) {
      element.focus()
    }
  }, [])
  /** Email me a link's ref: the dialog's initial focus, and focused on a return to the start. */
  const sendButtonRef = useCallback(
    (element: HTMLButtonElement | null) => {
      sendRef.current = element
      arrive(element)
    },
    [sendRef, arrive]
  )

  // The dialog's own initial focus can land after the opening view hands over to the first real view; a frame later, a popup still holding focus gives it to the main control.
  useEffect(() => {
    if (view !== 'start' && view !== 'passkey') return
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement
      if (active === null || active === document.body || active.getAttribute('role') === 'dialog') {
        sendRef.current?.focus()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [view, sendRef])

  /** Use your passkey's ref: the dialog's initial focus, and focused on arrival. */
  const passkeyButtonRef = useCallback(
    (element: HTMLButtonElement | null) => {
      sendRef.current = element
      arrive(element)
    },
    [sendRef, arrive]
  )

  const cancel = (
    <Button type="button" variant="outline" onClick={onDismissed}>
      Cancel
    </Button>
  )

  if (view === 'opening') {
    return (
      // No buttons yet, so focus stays on the dialog until a view takes it; Escape dismisses.
      <SigningInStatus label="Opening your passkey…" />
    )
  }

  if (view === 'passkey') {
    return (
      <PasskeyConfirm
        notice={notice}
        busy={passkeyBusy}
        buttonRef={passkeyButtonRef}
        cancel={cancel}
        onUsePasskey={() => promptPasskey('passkey')}
        onOtherMethod={switchToLink}
      />
    )
  }

  if (view === 'resuming') return <SigningInStatus label="Confirmed. Continuing…" />

  if (view === 'resume_failed') {
    return (
      <div className="grid gap-4">
        <DialogDescription>
          You confirmed, but we couldn’t reach the server. Check your connection, then select Try
          again.
        </DialogDescription>
        <DialogFooter>
          {cancel}
          <Button ref={arrive} onClick={() => void resume()}>
            Try again
          </Button>
        </DialogFooter>
      </div>
    )
  }

  if (view === 'email') {
    return (
      <EmailWait
        email={email}
        expired={linkExpiresAt !== null && linkLeft === 0}
        resendAt={resendAt}
        busy={requestLink.isPending}
        resendRef={arrive}
        onResend={() => sendLink('email')}
        cancel={cancel}
      />
    )
  }

  return (
    <div className="grid gap-4">
      <DialogDescription>
        This action needs a confirmation from the last 10 minutes. We’ll email you a link to open in
        this browser.
      </DialogDescription>
      {notice !== null && (
        <Alert variant="destructive">
          <IconAlertCircle aria-hidden="true" />
          <AlertTitle>{notice}</AlertTitle>
        </Alert>
      )}
      <DialogFooter>
        {cancel}
        <BusyButton
          ref={sendButtonRef}
          busy={requestLink.isPending}
          busyLabel="Sending…"
          onClick={() => sendLink('start')}
        >
          Email me a link
        </BusyButton>
      </DialogFooter>
      {hasPasskey && (
        <Button
          type="button"
          variant="link"
          className="justify-self-center"
          onClick={() => promptPasskey('start')}
        >
          Use your passkey instead
        </Button>
      )}
    </div>
  )
}

/**
 * The wait on an emailed link: where it went, how long it works, and a
 * Resend that counts down to when the API will mail again. The sent line is
 * the live region; the clock sits outside it, so it is not announced every
 * second.
 */
function EmailWait({
  email,
  expired,
  resendAt,
  busy,
  resendRef,
  onResend,
  cancel,
}: {
  email: string | undefined
  expired: boolean
  resendAt: number | null
  busy: boolean
  resendRef: (element: HTMLElement | null) => void
  onResend: () => void
  cancel: ReactNode
}) {
  const left = useCountdown(resendAt)
  return (
    <div className="grid gap-4">
      <DialogDescription>
        Check your email. Open the link in this browser to continue.
      </DialogDescription>
      <p role="status" className="text-sm">
        {expired ? (
          'That link expired. Send a new link to continue.'
        ) : (
          <>
            We sent the link to {email ? <Pii>{email}</Pii> : 'your email address'}. It expires in
            15 minutes.
          </>
        )}
      </p>
      <DialogFooter>
        {cancel}
        <BusyButton
          ref={resendRef}
          busy={busy}
          busyLabel="Sending…"
          variant={expired ? 'default' : 'outline'}
          disabled={left > 0}
          focusableWhenDisabled
          onClick={onResend}
        >
          {left > 0 ? `Resend in ${formatClock(left)}` : 'Resend link'}
        </BusyButton>
      </DialogFooter>
    </div>
  )
}
