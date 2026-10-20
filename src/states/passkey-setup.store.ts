import { create } from 'zustand'

/** Whether required mode is holding the session back until the account creates a passkey. */
interface PasskeySetupState {
  /** True after any request answered 403 `PASSKEY_SETUP_REQUIRED`; the app shell then shows the setup screen. */
  required: boolean
  /** The server's own message for that refusal, shown on the setup screen as it arrived; null when none was read. */
  message: string | null
  /**
   * Raises or clears the flag. Clearing drops the message.
   * @param value - Whether setup is required.
   * @param message - The server's refusal message, kept while `value` is true.
   */
  setRequired: (value: boolean, message?: string | null) => void
}

/** The required-mode setup flag. In memory only: the next request raises it again if it still applies. */
export const usePasskeySetupStore = create<PasskeySetupState>()((set) => ({
  required: false,
  message: null,
  setRequired: (value, message = null) => {
    set({ required: value, message: value ? message : null })
  },
}))
