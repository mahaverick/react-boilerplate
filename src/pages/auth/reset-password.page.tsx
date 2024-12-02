import { useEffect, useRef, useState } from 'react'
import { resetPassword, verifyResetToken } from '@/endpoints/auth.endpoints'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router-dom'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

const formSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  })

type ResetPasswordData = z.infer<typeof formSchema>

const ResetPassword = () => {
  const [searchParams] = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null)
  const [isResetSuccessful, setIsResetSuccessful] = useState(false)

  const tokenVerified = useRef(false)

  const token = searchParams.get('token')

  const form = useForm<ResetPasswordData>({
    resolver: zodResolver(formSchema),
  })

  const verifyTokenMutation = useMutation({
    mutationFn: verifyResetToken,
    onSuccess: () => {
      setIsTokenValid(true)
    },
    onError: () => {
      setIsTokenValid(false)
      setError('Invalid or expired reset token. Please request a new password reset.')
    },
  })

  useEffect(() => {
    if (token && !tokenVerified.current) {
      verifyTokenMutation.mutate(token)
      tokenVerified.current = true
    } else if (!token) {
      setIsTokenValid(false)
      setError('No reset token provided. Please request a new password reset.')
    }
  }, [token, verifyTokenMutation])

  const resetPasswordMutation = useMutation({
    mutationFn: resetPassword,
    onSuccess: () => {
      setIsResetSuccessful(true)
    },
    onError: (error) => {
      setError('Failed to reset password. Please try again.')
      // eslint-disable-next-line no-console
      console.error('Reset password error:', error)
    },
  })

  const onSubmit = (values: ResetPasswordData) => {
    const token = searchParams.get('token')
    if (!token) {
      setError('Invalid reset token. Please try resetting your password again.')
      return
    }
    resetPasswordMutation.mutate({ token, newPassword: values.password })
  }

  if (isTokenValid === null) {
    return <div>Verifying reset token...</div>
  }

  if (isTokenValid === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-[350px]">
          <CardHeader>
            <CardTitle>Reset Password</CardTitle>
            <CardDescription>There was an issue with your reset token.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
          <CardFooter>
            <Link to="/password/forgot" className="w-full">
              <Button className="w-full">Request New Reset Link</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (isResetSuccessful) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-[350px]">
          <CardHeader>
            <CardTitle>Password Reset Successful</CardTitle>
            <CardDescription>Your password has been successfully reset.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-green-600">You can now log in with your new password.</p>
          </CardContent>
          <CardFooter>
            <Link to="/login" className="w-full">
              <Button className="w-full">Go to Login</Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Card className="w-[350px]">
        <CardHeader>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>Enter your new password below.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {error && <p className="text-sm text-destructive">{error}</p>}
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Enter new password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Confirm new password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button type="submit" className="w-full" disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset Password'}
              </Button>
              <Link to="/login" className="text-sm text-primary hover:underline">
                Back to Login
              </Link>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}

export default ResetPassword
