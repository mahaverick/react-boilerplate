import AllOrganizations from "@/pages/organizations/all-organizations.page"
import CreateOrganization from "@/pages/organizations/create-organizations.page"

export const organizationRoutes = [
  {
    path: "organizations",
    element: <AllOrganizations />,
  },
  {
    path: "organizations/create",
    element: <CreateOrganization />,
  },
]
