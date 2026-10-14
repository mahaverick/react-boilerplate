/**
 * @file The app's toast API: `toast.success`, `toast.error` and `toast.warning`,
 * callable from anywhere, React or not. It feeds Base UI's toast manager, which
 * the lazily loaded `<Toaster>` (`@/components/ui/toast`) renders. This module
 * is small and stays outside that lazy UI chunk, so a toast raised before the
 * UI has mounted is queued rather than lost.
 */
import { Toast, type ToastManager, type ToastManagerAddOptions } from '@base-ui/react/toast'
import type { ReactNode } from 'react'

/** What a toast call may pass beside its title. */
export interface ToastOptions {
  /** A second line under the title. */
  description?: ReactNode
  /**
   * A key for the toast. Raising a toast with the key of one still showing
   * replaces it in place (title, type, description and action alike: what the
   * new raise leaves out is cleared) and restarts its timer, so a burst of
   * identical failures shows one toast.
   */
  id?: string
  /**
   * A button on the toast. Clicking it runs `onClick`, then closes the toast,
   * even if `onClick` throws.
   */
  action?: ToastAction
}

/** A toast's button: its label and what clicking it does. */
export interface ToastAction {
  /** The button's text. */
  label: ReactNode
  /**
   * Runs when the button is clicked, before the toast closes. If it throws,
   * the toast still closes and the error propagates to the click handler.
   */
  onClick: () => void
}

/** The toast types the app raises; `@/components/ui/toast` styles each one. */
type ToastType = 'success' | 'error' | 'warning'

const inner = Toast.createToastManager()

/** How many providers are subscribed to `inner`: 0 until the lazy `<Toaster>` mounts. */
let subscribers = 0

/**
 * Whether raises go straight to the provider. Only the replay sets it, so a
 * toast raised between the subscribe and the replay still joins the queue
 * behind the older ones: order holds, and a newer raise with an id replaces a
 * queued one instead of being overwritten by it. Cleared when the last
 * provider unsubscribes.
 */
let live = false

/** The scheduled replay, if one is pending. */
let replayTimer: ReturnType<typeof setTimeout> | undefined

/** The most toasts the queue keeps; the provider shows at most 3 at once anyway. */
const PENDING_LIMIT = 10

/**
 * How long after the first subscribe the queue is replayed. The provider
 * subscribes in an effect as it mounts, while its live region is being
 * inserted; a toast inserted together with its region is often not announced,
 * so the replay waits until the empty region has been in the document for a
 * moment.
 */
const REPLAY_DELAY_MS = 100

/**
 * Toasts raised while no provider listened, the newest `PENDING_LIMIT` of
 * them. Base UI's manager only emits to current listeners, so without this
 * queue a toast raised before the lazy `<Toaster>` has mounted would be
 * dropped. The cap bounds it in a session whose toast chunk never loads.
 */
let pending: ToastManagerAddOptions<object>[] = []

/**
 * Hands the queue to the subscribed provider and lets later raises through.
 * The unsubscribe that drops `subscribers` to 0 cancels it, so it never runs
 * without a provider.
 */
function replayPending(): void {
  replayTimer = undefined
  live = true
  const queued = pending
  pending = []
  for (const options of queued) inner.add(options)
}

/**
 * The manager `<Toaster>` subscribes to. It is Base UI's own, except that the
 * first subscriber receives the toasts queued before it arrived, and those
 * raised in the meantime, `REPLAY_DELAY_MS` after it subscribed.
 */
export const toastManager: ToastManager = {
  ...inner,
  ' subscribe': (listener) => {
    const unsubscribe = inner[' subscribe'](listener)
    subscribers += 1
    if (!live && replayTimer === undefined) {
      replayTimer = setTimeout(replayPending, REPLAY_DELAY_MS)
    }
    return () => {
      subscribers -= 1
      unsubscribe()
      if (subscribers > 0) return
      live = false
      clearTimeout(replayTimer)
      replayTimer = undefined
    }
  },
}

/** Numbers the ids given to toasts that carry an action but no `id`. */
let actionToasts = 0

/**
 * Raises a toast of `type`, or queues it until a mounted `<Toaster>` has
 * replayed the queue. A queued toast with an `id` replaces an earlier queued
 * one with the same id. A toast with an action gets an id if it has none, so
 * its button can close it.
 */
function show(type: ToastType, title: ReactNode, options: ToastOptions = {}): void {
  const { action, ...rest } = options
  // Both keys are always set: Base UI merges a raise with a showing toast's id over the old one, so a key left out would keep the old value.
  const add: ToastManagerAddOptions<object> = {
    ...rest,
    title,
    type,
    description: rest.description,
    actionProps: undefined,
  }
  if (action) {
    const id = rest.id ?? `toast-action-${String((actionToasts += 1))}`
    add.id = id
    add.actionProps = {
      children: action.label,
      onClick: () => {
        try {
          action.onClick()
        } finally {
          toast.dismiss(id)
        }
      },
    }
  }
  if (live) {
    inner.add(add)
    return
  }
  pending = [...pending.filter((queued) => !add.id || queued.id !== add.id), add].slice(
    -PENDING_LIMIT
  )
}

/** The app's toasts. Each call returns nothing; dedupe through `options.id`. */
export const toast = {
  /** Confirms that an action succeeded. */
  success: (title: ReactNode, options?: ToastOptions) => show('success', title, options),
  /** Reports a failure. */
  error: (title: ReactNode, options?: ToastOptions) => show('error', title, options),
  /** Flags something the user should know before going on. */
  warning: (title: ReactNode, options?: ToastOptions) => show('warning', title, options),
  /**
   * Closes the toast with `id`, or every toast when `id` is omitted, queued
   * ones included. Tests call it after each case so no toast outlives it.
   */
  dismiss: (id?: string) => {
    pending = id === undefined ? [] : pending.filter((queued) => queued.id !== id)
    inner.close(id)
  },
}
