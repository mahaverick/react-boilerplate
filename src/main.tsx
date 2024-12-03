import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import store from '@/redux/store'

import App from '@/app'

import '@/styles/global.styles.css'

import httpInterceptors from '@/services/http/interceptors'

// import { setupAuthPersistence } from "@/utils/storage.utils"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
    },
  },
})

// setupAuthPersistence(store)
httpInterceptors.attach(store)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
)
