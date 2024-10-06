import CryptoJS from "crypto-js"

const ENCRYPTION_KEY = process.env.VITE_AUTH_ENCRYPTION_KEY as string

/**
 * This function encrypts the given data using AES encryption.
 * @param {string} data - The data to encrypt.
 * @returns {string} The encrypted data.
 */
export const encryptData = (data: string) => {
  const salt = CryptoJS.lib.WordArray.random(16).toString()
  const saltedData = salt + data
  return salt + CryptoJS.AES.encrypt(saltedData, ENCRYPTION_KEY).toString()
}

/**
 * This function decrypts the given cipher text using AES decryption.
 * @param {string} cipherText - The cipher text to decrypt.
 * @returns {string} The decrypted data.
 */
export const decryptData = (cipherText: string) => {
  //   const salt = cipherText.slice(0, 32)
  const actualCipherText = cipherText.slice(32)
  const bytes = CryptoJS.AES.decrypt(actualCipherText, ENCRYPTION_KEY)
  const decryptedData = bytes.toString(CryptoJS.enc.Utf8)
  return decryptedData.slice(32) // Remove the salt
}
