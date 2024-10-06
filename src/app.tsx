import { RouterProvider } from "react-router-dom"

import routes from "@/routes/index.routes"

const App = () => {
  return <RouterProvider router={routes} />
}

export default App
