import axios from "axios"

const BASE_URL = process.env.VITE_API_BASE_URL || "http://localhost:4545/api/"
const TIMEOUT_MESSAGE = "Request timed out. Please try again."

const config = {
  baseURL: BASE_URL,
  timeout: 20000,
  timeoutErrorMessage: TIMEOUT_MESSAGE,
}

export const http = axios.create(config)
