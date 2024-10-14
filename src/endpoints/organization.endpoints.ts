import { http } from "@/services/http/client"

import { CreateOrganizationData } from "@/pages/organizations/create-organizations.page"

/**
 * Fetch all organizations API endpoint
 * @returns {Promise} - Axios promise object
 */
export const fetchAllOrganizations = () => http.get("/organizations", { requireAuthHeader: true })

/**
 * Fetch single organization API endpoint
 * @returns {Promise} - Axios promise object
 */
export const fetchOrganization = (identifier: string) =>
  http.get(`/organizations/${identifier}`, { requireAuthHeader: true })

/**
 * Create an organization API endpoint
 * @returns {Promise} - Axios promise object
 */
export const createOrganization = (data: CreateOrganizationData) =>
  http.post(`/organizations`, data, { requireAuthHeader: true })
