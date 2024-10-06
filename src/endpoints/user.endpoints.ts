import { http } from "@/services/http/client"

/**
 * Fetch all users API endpoint
 * @returns {Promise} - Axios promise object
 */
export const fetchUsers = () => http.get("/users", { withCredentials: true })
