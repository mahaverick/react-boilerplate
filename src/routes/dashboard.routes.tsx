import { Suspense } from 'react'

import { Dashboard } from '@/routes/lazy.routes'
import { organizationRoutes } from '@/routes/organization.routes'

import NotFound from '@/components/errors/not-found'
import SuspenseLoader from '@/components/features/suspense-loader'
import DashboardLayout from '@/pages/layouts/dashboard.layout'

export const dashboardRoutes = [
  {
    path: '',
    element: <DashboardLayout />,
    children: [
      {
        path: 'dashboard',
        element: (
          <Suspense fallback={<SuspenseLoader size="large" text="Loading content..." />}>
            <Dashboard />
          </Suspense>
        ),
      },
      ...organizationRoutes,
      {
        path: '*',
        element: <NotFound />,
      },
    ],
  },
]
