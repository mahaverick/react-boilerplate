import { useBreadcrumbs } from '@/hooks/use-breadcrumbs'

const breadcrumbItems = [{ href: '/dashboard', label: 'Home' }]

const Dashboard = () => {
  useBreadcrumbs(breadcrumbItems)
  return (
    <div className="flex h-full items-center justify-center">
      <h1 className="text-5xl">Dashboard from Boilerplate</h1>
    </div>
  )
}

export default Dashboard
