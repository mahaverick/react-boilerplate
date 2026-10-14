/**
 * @file The app's toast API: `toast.success`, `toast.error` and `toast.warning`,
 * callable from anywhere, React or not. It feeds Base UI's toast manager, which
 * the lazily loaded `<Toaster>` (`@/components/ui/toast`) renders. This module
 * stays small and eager; the toast UI does not.
 */
import { Toast, type ToastManager, type ToastManagerAddOptions } from '@base-ui/react/toast'
import type { ReactNode } from 'react'

/** What a toast call may pass beside its title. */
export interface ToastOptions {
  /** A second line under the title. */
  description?: ReactNode
  /**
   * A key for the toast. Raising a toast with the key of one still showing
   * replaces it in place and restarts its timer, so a burst of identical
   * failures shows one toast.
   */
  id?: string
}

/** The toast types the app raises; `@/components/ui/toast` styles each one. */
type ToastType = 'success' | 'error' | 'warning'

const inner = Toast.createToastManager()

/** How many providers are subscribed to `inner`: 0 until the lazy `<Toaster>` mounts. */
let subscribers = 0

/**
 * Toasts raised while no provider listened. Base UI's manager only emits to
 * current listeners, so without this queue a toast raised before the lazy
 * `<Toaster>` has mounted would be dropped.
 */
let pending: ToastManagerAddOptions<object>[] = []

/**
 * The manager `<Toaster>` subscribes to. It is Base UI's own, except that the
 * first subscriber receives the toasts queued before it arrived.
 */
export const toastManager: ToastManager = {
  ...inner,
  ' subscribe': (listener) => {
    const unsubscribe = inner[' subscribe'](listener)
    subscribers += 1
    const queued = pending
    pending = []
    for (const options of queued) inner.add(options)
    return () => {
      subscribers -= 1
      unsubscribe()
    }
  },
}

/**
 * Raises a toast of `type`, or queues it while no `<Toaster>` is mounted. A
 * queued toast with an `id` replaces an earlier queued one with the same id.
 */
function show(type: ToastType, title: ReactNode, options: ToastOptions = {}): void {
  const add: ToastManagerAddOptions<object> = { ...options, title, type }
  if (subscribers > 0) {
    inner.add(add)
    return
  }
  pending = [...pending.filter((queued) => !add.id || queued.id !== add.id), add]
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
