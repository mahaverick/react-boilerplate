import { EnhancedStore } from '@reduxjs/toolkit'
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios'

import { http } from '@/services/http/client'

import { clearAuth, setAuthPending, setAuthToken, setAuthUser } from '@/redux/slices/auth.slice'

import { refreshAccessToken } from '@/endpoints/auth.endpoints'

// import { removeAuthStorage, saveAuthStorage } from "@/utils/storage.utils"

interface FailedQueueItem {
  resolve: (_value?: unknown) => void
  reject: (_reason?: unknown) => void
}

interface CustomInternalAxiosRequestConfig extends InternalAxiosRequestConfig {
  _retries?: number
  requireAuthHeader?: boolean
  withFiles?: boolean
}

const REFRESH_TOKEN_ERRORS = [
  'REFRESH_TOKEN_MISSING',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_EXPIRED',
  'REFRESH_TOKEN_ERROR',
]

function runInterceptors(store: EnhancedStore) {
  const MAX_RETRIES = 2
  let isRefreshing = false
  let failedQueue: FailedQueueItem[] = []

  const processQueue = (error: AxiosError | null, token: string | null = null) => {
    failedQueue.forEach((prom) => {
      if (error) {
        prom.reject(error)
      } else {
        prom.resolve(token)
      }
    })
    failedQueue = []
  }

  /*
   * 1. REQUEST INTERCEPTOR
   */
  http.interceptors.request.use(
    (config: CustomInternalAxiosRequestConfig) => {
      if (config.requireAuthHeader) {
        const token = store?.getState()?.auth?.token
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        delete config.requireAuthHeader
      }

      if (config.withFiles) {
        config.headers['Content-Type'] = 'multipart/form-data'
        delete config.withFiles
      }

      return config
    },
    (error: AxiosError) => Promise.reject(error)
  )

  /*
   * 2. RESPONSE INTERCEPTOR
   */
  http.interceptors.response.use(
    (response: AxiosResponse) => response,
    async (error: AxiosError) => {
      const originalRequest = error.config as CustomInternalAxiosRequestConfig

      const isTokenInvalid =
        error.response?.status === 498 ||
        error.response?.headers['X-Access-Token-Expired'] === 'true' ||
        error.response?.headers['X-Access-Token-Invalid'] === 'true'

      if (
        isTokenInvalid &&
        (originalRequest._retries === undefined || originalRequest._retries < MAX_RETRIES)
      ) {
        if (isRefreshing) {
          return new Promise((resolve, reject) => {
            failedQueue.push({ resolve, reject })
          })
            .then((token) => {
              originalRequest.headers.Authorization = `Bearer ${token}`
              http.defaults.headers.common['Authorization'] = `Bearer ${token}`

              return http(originalRequest)
            })
            .catch((err) => {
              return Promise.reject(err)
            })
        }

        originalRequest._retries = (originalRequest._retries || 0) + 1
        isRefreshing = true
        store.dispatch(setAuthPending(true))

        try {
          const { data: response } = await refreshAccessToken()
          const newAccessToken = response.data.accessToken
          const user = response.data.user

          store.dispatch(setAuthToken({ token: newAccessToken }))
          store.dispatch(setAuthUser({ user }))

          // saveAuthStorage(store.getState())

          // Update the Authorization header
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
          http.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`

          processQueue(null, newAccessToken)

          return http(originalRequest)
        } catch (e) {
          const refreshError = e as AxiosError
          processQueue(refreshError as AxiosError, null)

          // removeAuthStorage()
          store.dispatch(clearAuth())
          return Promise.reject(refreshError)
        } finally {
          isRefreshing = false
          store.dispatch(setAuthPending(false))
        }
      }

      // Extract error code or message from the response
      const errorCode = (error.response?.data as { code?: string })?.code || 'REFRESH_TOKEN_ERROR'

      // Check if the error indicates an issue with the refresh token
      if (REFRESH_TOKEN_ERRORS.includes(errorCode)) {
        // Remove the token from Axios defaults to prevent it from being sent in future requests.
        delete http.defaults.headers.common['Authorization']
        // Clear localStorage
        // removeAuthStorage()
        // Dispatch logout action
        store.dispatch(clearAuth())
      }

      //   logError(error, store)
      return Promise.reject(error)
    }
  )
}

const interceptors = { attach: runInterceptors }

export default interceptors
