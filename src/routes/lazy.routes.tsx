import { lazy } from "react"

export const Login = lazy(() => import("@/pages/auth/login.page"))
export const Register = lazy(() => import("@/pages/auth/register.page"))
export const Dashboard = lazy(() => import("@/pages/dashboard/dashboard.page"))
export const ForgotPassword = lazy(() => import("@/pages/auth/forgot-password.page"))
export const ResetPassword = lazy(() => import("@/pages/auth/reset-password.page"))
