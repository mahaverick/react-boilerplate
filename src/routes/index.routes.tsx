import { createBrowserRouter } from "react-router-dom"

import NotFound from "@/components/errors/not-found"
import AuthGuard from "@/components/guards/auth-guard"
import ProtectedGuard from "@/components/guards/protected-guard"
import Home from "@/pages/home.page"
import RootLayout from "@/pages/layouts/root.layout"

import { checkAuthStatusLoader } from "./auth.loader"
import { authRoutes } from "./auth.routes"
import { dashboardRoutes } from "./dashboard.routes"

const routes = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        path: "",
        element: <Home />,
      },
      {
        path: "",
        loader: checkAuthStatusLoader,
        children: [
          {
            element: <AuthGuard />,
            children: authRoutes,
          },
          {
            element: <ProtectedGuard />,
            children: dashboardRoutes,
          },
        ],
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
])

export default routes
