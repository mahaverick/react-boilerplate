import { FieldDescription } from '@/components/ui/field'

/**
 * The agreement line under the sign-in and registration cards. Plain text:
 * the app has no terms or privacy pages to link, and a `#` link would be a
 * dead control. A derived project with those pages links them here.
 */
export function TermsNote() {
  return (
    <FieldDescription className="px-6 text-center">
      By clicking continue, you agree to our Terms of Service and Privacy Policy.
    </FieldDescription>
  )
}
