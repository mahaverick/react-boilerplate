import React from "react"
import App from "@/app"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import ReactDOM from "react-dom/client"
import { Provider } from "react-redux"

import store from "@/redux/store"

import "@/styles/global.styles.css"

import httpInterceptors from "@/services/http/interceptors"

// import { setupAuthPersistence } from "@/utils/storage.utils"

const queryClient = new QueryClient()

// setupAuthPersistence(store)
httpInterceptors.attach(store)

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
)
