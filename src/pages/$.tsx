import { createFileRoute } from '@tanstack/react-router'
import { RouteNotFound } from '@/components/features/route-not-found'
import { pageTitle } from '@/constants/app'

export const Route = createFileRoute('/$')({
  head: () => ({ meta: [{ title: pageTitle('Page not found') }] }),
  component: RouteNotFound,
})
