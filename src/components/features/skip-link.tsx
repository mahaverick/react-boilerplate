import type { MouseEvent } from 'react'

/** The id of each layout's `<main>`: the skip link's target. */
export const MAIN_CONTENT_ID = 'main'

/**
 * A layout's first focusable element. It moves focus to the main landmark
 * itself and cancels the hash navigation, so the URL and history stay as they were.
 */
export function SkipLink() {
  function skip(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    document.getElementById(MAIN_CONTENT_ID)?.focus()
  }

  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      onClick={skip}
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:ring-2 focus:ring-ring"
    >
      Skip to content
    </a>
  )
}
