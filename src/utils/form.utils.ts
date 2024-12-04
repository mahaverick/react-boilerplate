import { AxiosError } from 'axios'
import { FieldValues, Path, UseFormSetError } from 'react-hook-form'

/**
 * Handles form errors by setting the appropriate error messages on the form fields.
 *
 * @template T - The type of the form values.
 * @param {AxiosError<ErrorResponse>} error - The error object returned from an Axios request.
 * @param {UseFormSetError<T>} setError - The function to set errors on the form fields.
 *
 * @remarks
 * This function processes the error response from an Axios request and sets the error messages
 * on the corresponding form fields using the `setError` function from `react-hook-form`.
 * It handles both field-specific errors and root-level errors.
 *
 * @example
 * ```typescript
 * handleFormErrors(error, setError);
 * ```
 */
export function handleFormErrors<T extends FieldValues>(
  error: AxiosError<ErrorResponse>,
  setError: UseFormSetError<T>
): void {
  const errorData = (error.response && error.response.data) as ErrorResponse | undefined

  if (errorData && errorData.errors) {
    Object.entries(errorData.errors).forEach(([field, fieldErrors]) => {
      if (field !== '_errors') {
        if (Array.isArray(fieldErrors)) {
          fieldErrors.forEach((errorMessage) => {
            setError(field as Path<T>, {
              type: 'manual',
              message: errorMessage,
            })
          })
        } else if (fieldErrors._errors) {
          fieldErrors._errors.forEach((errorMessage) => {
            setError(field as Path<T>, {
              type: 'manual',
              message: errorMessage,
            })
          })
        }
      }
    })
  }
  if (errorData && errorData.message) {
    setError('root' as Path<T>, {
      type: 'manual',
      message: errorData.message,
    })
  }
}
