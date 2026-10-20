import { IconAlertCircle } from '@tabler/icons-react'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Alert, AlertTitle } from '@/components/ui/alert'

/** The section's name and its content. */
interface SectionBoundaryProps {
  /** The section's name, as the reader knows it: "Sign-ups". */
  name: string
  children: ReactNode
}

/**
 * One section's render error stays in that section, so a card that throws
 * never blanks the page. Data errors are the query's to show (`QueryState`);
 * this only catches what rendering throws. React reports the caught error
 * through the root's `onCaughtError`, once.
 */
export class SectionBoundary extends Component<SectionBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  /** Switches to the failure message on the next render. */
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  /** Logs the error and the component stack, naming the section. */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[section] ${this.props.name}`, error, info.componentStack)
  }

  /** The section, or a short alert in its place once it has failed. */
  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <Alert variant="destructive">
          <IconAlertCircle aria-hidden="true" />
          <AlertTitle>{this.props.name} didn’t load. Reload the page to try again.</AlertTitle>
        </Alert>
      )
    }
    return this.props.children
  }
}
