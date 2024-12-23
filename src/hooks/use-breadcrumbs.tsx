import { useEffect } from 'react'
import { useDispatch } from 'react-redux'

import { setBreadcrumbs } from '@/redux/slices/breadcrumb.slice'

export const useBreadcrumbs = (breadcrumbItems: BreadcrumbItem[]) => {
  const dispatch = useDispatch()

  useEffect(() => {
    dispatch(setBreadcrumbs({ breadcrumbs: breadcrumbItems }))

    return () => {
      dispatch(setBreadcrumbs({ breadcrumbs: [] }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return
}
