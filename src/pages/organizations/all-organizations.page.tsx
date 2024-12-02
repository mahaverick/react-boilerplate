import { fetchAllOrganizations } from '@/endpoints/organization.endpoints'
import { useQuery } from '@tanstack/react-query'

export interface Organization {
  id: string
  name: string
  identifier: string
}

const AllOrganizations = () => {
  // Fetch all organizations from the API

  const { data: organizations, isLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: fetchAllOrganizations,
    select: (response) => response.data.data.organizations as Organization[],
  })

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <div className="flex h-full flex-col">
      <h1>All Organizations</h1>
      <ul>
        {organizations?.map((organization: Organization) => (
          <li key={organization.id}>{organization.name}</li>
        ))}
      </ul>
    </div>
  )
}

export default AllOrganizations
