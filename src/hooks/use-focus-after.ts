import * as React from 'react'

/** What `useFocusAfter` hands back: a ref factory for the targets and the trigger for the move. */
export interface FocusAfter<Key extends string> {
  /** Ref for the element that should take focus when `focusAfter(key)` is called. */
  target: (key: Key) => (element: HTMLElement | null) => void
  /** Moves focus to the `key` target now if it is mounted, otherwise the moment it mounts. */
  focusAfter: (key: Key) => void
}

/**
 * Keeps keyboard focus in place when a successful action unmounts the button
 * that was just used: the browser drops focus on `<body>` and a keyboard or
 * screen-reader user loses their place.
 *
 * Call it in a component that stays mounted across the action, hand `target`
 * to the elements that may receive focus and `focusAfter` to the action's
 * success path. The target may already be mounted when the action settles
 * (a section heading) or may not exist until the refetch renders it (the
 * control that replaces the button); both orders work, with no timer.
 *
 * Call `focusAfter` on success only. On failure the button is still there and
 * the confirm dialog returns focus to it.
 *
 * Where focus goes, one rule everywhere: the control that takes the button's
 * place when there is one; otherwise the title of the item that held the
 * button (a step), or the heading of the section whose row went away
 * (members, invitations). Programmatically focusable titles and headings take
 * `tabIndex={-1}` and `outline-none`, since they are never in the tab order.
 */
export function useFocusAfter<Key extends string>(): FocusAfter<Key> {
  const mounted = React.useRef(new Map<Key, HTMLElement>())
  const pending = React.useRef<Key | null>(null)
  const refs = React.useRef(new Map<Key, (element: HTMLElement | null) => void>())

  const target = React.useCallback((key: Key) => {
    let ref = refs.current.get(key)
    if (!ref) {
      ref = (element) => {
        if (!element) {
          mounted.current.delete(key)
          return
        }
        mounted.current.set(key, element)
        if (pending.current === key) {
          pending.current = null
          element.focus()
        }
      }
      refs.current.set(key, ref)
    }
    return ref
  }, [])

  const focusAfter = React.useCallback((key: Key) => {
    const element = mounted.current.get(key)
    if (element) {
      pending.current = null
      element.focus()
    } else {
      pending.current = key
    }
  }, [])

  return React.useMemo(() => ({ target, focusAfter }), [target, focusAfter])
}
