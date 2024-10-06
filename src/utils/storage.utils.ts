import { rehydrateAuth } from "@/redux/features/auth/auth.slice"
import { RootState } from "@/redux/store"
import { decryptData, encryptData } from "@/utils/crypto.utils"

/**
 * The key used to store the auth state in the local storage.
 */
const STORAGE_KEY = process.env.VITE_AUTH_STORAGE_KEY as string

/**
 * This function saves the auth state to the local storage.
 * @param {RootState} state
 */
export const saveAuthStorage = (state: RootState) => {
  try {
    const serializedState = JSON.stringify(state)
    const encryptedState = encryptData(serializedState)
    localStorage.setItem(STORAGE_KEY, encryptedState)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Could not save auth state", error)
  }
}

/**
 * This function loads the auth state from the local storage.
 * @returns {RootState | undefined} The auth state or undefined if it cannot be loaded.
 */
export const loadAuthStorage = () => {
  try {
    const encryptedState = localStorage.getItem(STORAGE_KEY)
    if (encryptedState === null) {
      return undefined
    }
    const decryptedState = decryptData(encryptedState)
    return JSON.parse(decryptedState)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Could not load auth state", error)
    return undefined
  }
}

/**
 * This function removes the auth state from the local storage.
 */
export const removeAuthStorage = () => {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * This function sets up the auth persistence by rehydrating the auth state from the local storage and subscribing to the store to save the auth state whenever it changes.
 * @param {RootState} store
 */
export const setupAuthPersistence = (store: RootState) => {
  store.dispatch(rehydrateAuth(loadAuthStorage()))

  store.subscribe(() => {
    const state = store.getState()
    saveAuthStorage(state.auth)
  })
}
