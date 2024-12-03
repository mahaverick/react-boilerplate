import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useMutation } from '@tanstack/react-query'
import { AxiosError } from 'axios'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { resendVerificationEmail, verifyEmail } from '@/endpoints/auth.endpoints'

const EmailVerification = () => {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [verificationStatus, setVerificationStatus] = useState<'verifying' | 'success' | 'error'>(
    'verifying'
  )

  const token = searchParams.get('token')
  const email = searchParams.get('email')

  const verifyEmailMutation = useMutation({
    mutationFn: () => verifyEmail(token as string),
    onSuccess: () => {
      setVerificationStatus('success')
      // Optionally update Redux store to set email as verified
      // dispatch(setEmailVerified(true))
      setTimeout(() => navigate('/login'), 3000) // Redirect to login after 3 seconds
    },
    onError: (error: AxiosError) => {
      setVerificationStatus('error')
      // eslint-disable-next-line no-console
      console.error('Email verification failed:', error)
    },
  })

  const resendVerificationMutation = useMutation({
    mutationFn: () => resendVerificationEmail(email as string),
    onSuccess: () => {
      alert('Verification email resent. Please check your inbox.')
    },
    onError: (error: AxiosError) => {
      // eslint-disable-next-line no-console
      console.error('Failed to resend verification email:', error)
      alert('Failed to resend verification email. Please try again later.')
    },
  })

  useEffect(() => {
    if (token && email) {
      verifyEmailMutation.mutate()
    } else {
      setVerificationStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, email])

  const handleResendVerification = () => {
    if (email) {
      resendVerificationMutation.mutate()
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>Email Verification</CardTitle>
          <CardDescription>Verifying your email address</CardDescription>
        </CardHeader>
        <CardContent>
          {verificationStatus === 'verifying' && <p>Verifying your email...</p>}
          {verificationStatus === 'success' && (
            <p className="text-green-600">
              Your email has been successfully verified. Redirecting to login...
            </p>
          )}
          {verificationStatus === 'error' && (
            <>
              <p className="mb-4 text-red-600">
                Email verification failed. The link may be invalid or expired.
              </p>
              <Button onClick={handleResendVerification}>Resend Verification Email</Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default EmailVerification
