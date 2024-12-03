import { useState } from 'react'
import { Link } from 'react-router-dom'

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
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
import { forgotPassword } from '@/endpoints/auth.endpoints'

const formSchema = z.object({
  email: z.string().email('Invalid email address'),
})

type ForgotPasswordData = z.infer<typeof formSchema>

const ForgotPassword = () => {
  const [isSubmitted, setIsSubmitted] = useState(false)

  const form = useForm<ForgotPasswordData>({
    resolver: zodResolver(formSchema),
  })

  const forgotPasswordMutation = useMutation({
    mutationFn: forgotPassword,
    onSuccess: () => {
      setIsSubmitted(true)
    },
  })

  const onSubmit = (values: ForgotPasswordData) => {
    forgotPasswordMutation.mutate(values)
  }

  if (isSubmitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Card className="w-[350px]">
          <CardHeader>
            <CardTitle>Check Your Email</CardTitle>
            <CardDescription>
              If the email exists, a password reset link has been sent.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link to="/login" className="w-full">
              <Button className="w-full">Back to Login</Button>
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
          <CardTitle>Forgot Password</CardTitle>
          <CardDescription>Enter your email to reset your password.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your email" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button type="submit" className="w-full" disabled={forgotPasswordMutation.isPending}>
                {forgotPasswordMutation.isPending ? 'Sending...' : 'Send Reset Link'}
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

export default ForgotPassword
