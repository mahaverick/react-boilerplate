import { AxiosError } from "axios"
import { FieldValues, Path, UseFormSetError } from "react-hook-form"

export function handleFormErrors<T extends FieldValues>(
  error: AxiosError<ErrorResponse>,
  setError: UseFormSetError<T>
) {
  const errorData = (error.response && error.response.data) as ErrorResponse | undefined

  if (errorData && errorData.errors) {
    Object.entries(errorData.errors).forEach(([field, fieldErrors]) => {
      if (field !== "_errors") {
        if (Array.isArray(fieldErrors)) {
          fieldErrors.forEach((errorMessage) => {
            setError(field as Path<T>, {
              type: "manual",
              message: errorMessage,
            })
          })
        } else if (fieldErrors._errors) {
          fieldErrors._errors.forEach((errorMessage) => {
            setError(field as Path<T>, {
              type: "manual",
              message: errorMessage,
            })
          })
        }
      }
    })
  }
  if (errorData && errorData.message) {
    setError("root" as Path<T>, {
      type: "manual",
      message: errorData.message,
    })
  }
}
