import { useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { messageFrom } from '@/lib/api-error'
import { toast } from '@/lib/toast'
import { downloadTaxDocument } from '@/queries/tax.queries'
import type { TaxDocumentRef } from '@/types/tax.types'

/**
 * One tax document's download. A click saves its PDF; this one button is
 * disabled while that runs, so a double click asks once and the other buttons
 * stay usable. A failure shows the server's message in a toast; success shows
 * none, since the browser shows the download.
 * @param props - The tenant, the document and the button's text.
 */
export function TaxDocumentButton({
  slug,
  document,
  label,
}: {
  slug: string
  document: TaxDocumentRef
  label: string
}) {
  const download = useMutation({
    mutationFn: () => downloadTaxDocument(slug, document),
    onError: (error) => {
      toast.error(messageFrom(error))
    },
  })
  return (
    <Button
      variant="link"
      size="sm"
      className="whitespace-nowrap"
      disabled={download.isPending}
      onClick={() => download.mutate()}
    >
      {label}
    </Button>
  )
}
