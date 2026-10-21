import { Component, type ReactNode } from 'react'

/** What to show instead, and what to protect. */
interface LazyBoundaryProps {
  /** Shown in place of the children once they fail; null shows nothing. */
  fallback: ReactNode
  children: ReactNode
}

/**
 * Keeps a lazy chunk that fails to load (or a render that throws) from taking
 * out the route around it. The children are replaced by `fallback` for good:
 * a rejected `lazy()` stays rejected, so the only retry is a page reload.
 * React reports the caught error through the root's `onCaughtError`, once.
 */
export class LazyBoundary extends Component<LazyBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  /** Switches to the fallback on the next render. */
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  /** The children, or the fallback once they have failed. */
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
