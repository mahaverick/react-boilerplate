import "axios"

declare module "axios" {
  export interface AxiosRequestConfig {
    requireAuthHeader?: boolean
    withFiles?: boolean
  }
}
