import { http } from "@/services/http/client"

import { LoginData } from "@/pages/auth/login.page"
import { RegisterData } from "@/pages/auth/register.page"

/**
 * Login API endpoint
 * @param {LoginData} data - Account Credentials
 * @param {string} data.email - Email used by the account
 * @param {string} data.password - Password
 * @param {boolean} data.rememberMe - Remember me
 * @returns {Promise} - Axios promise object
 */
export const login = (data: LoginData) => http.post("/auth/login", data, { withCredentials: true })

/**
 * Register API endpoint
 * @param {RegisterData} data - Data to create new user
 * @returns {Promise} - Axios promise object
 */
export const register = (data: RegisterData) =>
  http.post("/auth/register", data, { withCredentials: true })

/**
 * Refresh Token API endpoint
 * @returns {Promise} - Axios promise object
 */
export const refreshAccessToken = () => http.post("/auth/refresh", null, { withCredentials: true })

/**
 * Logout API endpoint
 * @returns {Promise} - Axios promise object
 */
export const logout = () =>
  http.post("/auth/logout", null, {
    withCredentials: true,
    requireAuthHeader: true,
  })

/**
 * Verify Email API endpoint
 * @param {string} token - Verification token
 * @returns {Promise} - Axios promise object
 */
export const verifyEmail = (token: string) =>
  http.post("/auth/email/verify", { token }, { withCredentials: true })

/**
 * Resend Verification Email API endpoint
 * @param {string} email - User's email address
 * @returns {Promise} - Axios promise object
 */
export const resendVerificationEmail = (email: string) =>
  http.post("/auth/email/resend-verification", { email }, { withCredentials: true })

/**
 * Forgot Password API endpoint
 * @param {string} email - User's email address
 * @returns {Promise} - Axios promise object
 */
export const forgotPassword = (data: { email: string }) =>
  http.post("/auth/password/forgot", data, { withCredentials: true })

/**
 * Reset Password API endpoint
 * @param {string} token - Reset password token
 * @param {string} newPassword - New password
 * @returns {Promise} - Axios promise object
 */
export const resetPassword = (data: { token: string; newPassword: string }) =>
  http.post("/auth/password/reset", data, { withCredentials: true })

/**
 * Verify Reset Token API endpoint
 * @param {string} token - Reset password token
 * @returns {Promise} - Axios promise object
 */
export const verifyResetToken = (token: string) =>
  http.post("/auth/password/verify-reset-token", { token }, { withCredentials: true })
