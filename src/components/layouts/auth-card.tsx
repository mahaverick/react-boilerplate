import { IconStack2 } from '@tabler/icons-react'
import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { APP_NAME, APP_TAGLINE } from '@/constants/app'

/**
 * The brand side of `AuthCard`: the app name and tagline from
 * `@/constants/app` on the primary colour, hidden below `md` where the card
 * is one column. Both themes pair `--primary` with `--primary-foreground`,
 * so the text keeps the button's contrast.
 */
function AuthBrandPanel() {
  return (
    <div className="hidden flex-col justify-between gap-10 bg-primary p-8 text-primary-foreground md:flex">
      <p className="flex items-center gap-2 font-medium">
        <span className="flex size-8 items-center justify-center rounded-md bg-primary-foreground text-primary">
          <IconStack2 aria-hidden="true" className="size-5" />
        </span>
        {APP_NAME}
      </p>
      <p className="text-2xl font-semibold text-balance">{APP_TAGLINE}</p>
    </div>
  )
}

/**
 * Every signed-out page's card, after shadcn's login-04 block: the page's
 * `h1` and description over its content on one side, the brand panel on the
 * other. The page's one `h1` is `title`. `footer` renders under the card,
 * outside it.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
    <>
      <Card className="gap-0 p-0">
        <CardContent className="grid gap-0 p-0 md:grid-cols-2">
          <div className="flex flex-col gap-6 p-6 md:p-8">
            <div className="flex flex-col items-center gap-2 text-center">
              <h1 className="font-heading text-2xl font-bold">{title}</h1>
              {description && (
                <p className="text-sm text-balance text-muted-foreground">{description}</p>
              )}
            </div>
            {children}
          </div>
          <AuthBrandPanel />
        </CardContent>
      </Card>
      {footer}
    </>
  )
}
