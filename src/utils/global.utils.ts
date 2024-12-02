import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * This function is a wrapper around clsx and tailwind-merge. which merges classnames according specificity rules.
 *
 * @param inputs classnames to merge
 * @returns
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * This function formats date to a human readable format.
 *
 * @param input string or number to format date
 * @returns
 */
export function formatDate(input: string | number): string {
  const date = new Date(input)
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * This function validates email address.
 * @param email
 * @returns
 */
export const validateEmail = (email: string): boolean => {
  const isValid = String(email)
    .toLowerCase()
    .match(
      /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    )

  return isValid ? true : false
}

/**
 * This function validates password
 * @param password
 * @returns
 */
export const validatePassword = (password: string): boolean => {
  const isValid = String(password)
    .toLowerCase()
    .match(/^(?=.*[0-9])(?=.*[!@#$%^&*])[a-zA-Z0-9!@#$%^&*]{6,16}$/)

  return isValid ? true : false
}
