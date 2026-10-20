import { IconKey } from '@tabler/icons-react'
import { AxiosError } from 'axios'
import { useId, useState } from 'react'
import {
  DeletePasskeyDialog,
  RenamePasskeyDialog,
} from '@/components/features/profile/passkey-dialogs'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { QueryState } from '@/components/shared/query-state'
import { CardRowsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import { Item, ItemContent, ItemGroup } from '@/components/ui/item'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { passkeyFailure } from '@/lib/webauthn'
import { writeFailureMessage } from '@/lib/write-failure'
import { track } from '@/observability/telemetry'
import { useCreatePasskey, usePasskeyCreateSupport } from '@/queries/passkey-manage.queries'
import { usePasskeyConfig, usePasskeys } from '@/queries/passkey.queries'
import { MAX_PASSKEYS, type PasskeyMode, type PublicPasskey } from '@/types/passkey.types'

const LEAD =
  'Sign in and confirm it’s you with Face ID, Touch ID, Windows Hello, a device PIN or a security key.'
const LOAD_ERROR = 'We couldn’t load your passkeys. Select Try again to load them.'
const ALREADY_ON_DEVICE =
  'This device already holds a passkey for your account. Use that passkey, or create one on another device.'
const CREATE_FAILED = 'Your browser didn’t create a passkey. Try again, or use another device.'
const UNSUPPORTED =
  'This browser can’t create passkeys. Use a current version of Chrome, Edge, Firefox or Safari.'
const LIMIT_HINT = `You have ${String(MAX_PASSKEYS)} passkeys, the limit for one account. Delete one to create another.`

/**
 * What a failed create tells the person. An API failure shows the server's
 * message (or the step-up refusal); a browser failure is worded here, and a
 * dismissed prompt says nothing but is tracked.
 * @param error - What the create rejected with.
 * @returns The toast text, or null for a dismissed prompt.
 */
function createFailureMessage(error: unknown): string | null {
  if (error instanceof AxiosError) return writeFailureMessage(error)
  const failure = passkeyFailure(error)
  if (failure === 'cancelled') {
    track('passkey_prompt_cancelled', { ceremony: 'create' })
    return null
  }
  return failure === 'already_registered' ? ALREADY_ON_DEVICE : CREATE_FAILED
}

/**
 * The passkeys section, or nothing while the config is unread or passkeys are
 * off. Lazy-loaded by the Security section, so the config check lives here and
 * the Security chunk carries none of the passkey code.
 */
export function PasskeysSection() {
  const { data: config } = usePasskeyConfig()
  if (!config || config.mode === 'off') return null
  return <PasskeysList mode={config.mode} />
}

/**
 * The account's passkeys, for Settings › Security: the list with Rename and
 * Delete, and Create a passkey. Passkeys appear nowhere else (no prompts or
 * banners), and nothing here depends on the app: apex shows the same section.
 * Without WebAuthn, Create is replaced by an explanation and the list still
 * works. At 20 passkeys, Create is disabled with the reason beside it.
 * @param props.mode - The passkey mode (on); `required` forbids deleting the last passkey.
 */
function PasskeysList({ mode }: { mode: PasskeyMode }) {
  const passkeys = usePasskeys(true)
  const headingId = useId()
  const total = passkeys.data?.passkeys.length ?? 0

  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <h3 id={headingId} className="text-sm font-medium">
        Passkeys
      </h3>
      <p className="text-sm text-muted-foreground">{LEAD}</p>
      <QueryState
        query={passkeys}
        name="Passkeys"
        errorMessage={LOAD_ERROR}
        className="gap-2"
        skeleton={<CardRowsSkeleton rows={2} rowHeight="2.5rem" />}
        isEmpty={(data) => data.passkeys.length === 0}
        empty={<p className="text-sm">You have no passkeys.</p>}
      >
        {(data) => (
          <ItemGroup className="gap-2">
            {data.passkeys.map((passkey) => (
              <PasskeyRow
                key={passkey.id}
                passkey={passkey}
                mode={mode}
                isOnly={data.passkeys.length === 1}
              />
            ))}
          </ItemGroup>
        )}
      </QueryState>
      <CreatePasskey full={total >= MAX_PASSKEYS} />
    </section>
  )
}

/**
 * "Create a passkey", or why there is none: this browser cannot, or the
 * account is at the limit.
 */
function CreatePasskey({ full }: { full: boolean }) {
  const create = useCreatePasskey()
  const stepUp = useStepUp()
  const stepping = useStepUpWaiting()
  const support = usePasskeyCreateSupport()
  const hintId = useId()

  if (support.known && !support.create) {
    return <p className="text-sm text-muted-foreground">{UNSUPPORTED}</p>
  }

  return (
    <div className="grid justify-items-start gap-2">
      <BusyButton
        variant="outline"
        busy={create.isPending || stepping}
        busyLabel={stepping ? STEP_UP_WAITING_LABEL : 'Creating…'}
        disabled={full || !support.known}
        aria-describedby={full ? hintId : undefined}
        onClick={() => {
          stepUp
            .run(() => create.mutateAsync())
            .then(
              () => toast.success('Passkey created.'),
              (error: unknown) => {
                const message = createFailureMessage(error)
                if (message !== null) toast.error(message)
              }
            )
        }}
      >
        Create a passkey
      </BusyButton>
      {full ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {LIMIT_HINT}
        </p>
      ) : null}
    </div>
  )
}

/** The authenticator's icon, light and dark, or a key when it has none. */
function ProviderIcon({ passkey }: { passkey: PublicPasskey }) {
  const { iconLight, iconDark } = passkey.provider
  if (!iconLight && !iconDark) {
    return <IconKey aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
  }
  return (
    <>
      {iconLight ? (
        <img src={iconLight} alt="" className={cn('size-5 shrink-0', iconDark && 'dark:hidden')} />
      ) : null}
      {iconDark ? (
        <img
          src={iconDark}
          alt=""
          className={cn('size-5 shrink-0', iconLight && 'hidden dark:block')}
        />
      ) : null}
    </>
  )
}

/** One passkey: icon, name, provider, kind, dates, and Rename and Delete. */
function PasskeyRow({
  passkey,
  mode,
  isOnly,
}: {
  passkey: PublicPasskey
  mode: PasskeyMode
  isOnly: boolean
}) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const created = formatDate(passkey.createdAt, 'medium')
  const used = passkey.lastUsedAt ? formatDate(passkey.lastUsedAt, 'medium') : null

  return (
    <Item size="xs" role="listitem" variant="outline" className="flex-nowrap">
      <ProviderIcon passkey={passkey} />
      <ItemContent className="min-w-0">
        <p className="truncate text-sm font-medium">
          <Pii>{passkey.name}</Pii>
        </p>
        <p className="text-xs text-muted-foreground">
          <span>{passkey.provider.name}</span>
          {' · '}
          <span>{passkey.synced ? 'Synced' : 'This device only'}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {created ? <span>{`Created ${created}`}</span> : null}
          {' · '}
          <span>{used ? `Last used ${used}` : 'Never used'}</span>
        </p>
      </ItemContent>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Rename ${passkey.name}`}
          onClick={() => setRenaming(true)}
        >
          Rename
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={`Delete ${passkey.name}`}
          onClick={() => setDeleting(true)}
        >
          Delete
        </Button>
      </div>
      <RenamePasskeyDialog passkey={passkey} open={renaming} onOpenChange={setRenaming} />
      <DeletePasskeyDialog
        passkey={passkey}
        mode={mode}
        isOnly={isOnly}
        open={deleting}
        onOpenChange={setDeleting}
      />
    </Item>
  )
}
