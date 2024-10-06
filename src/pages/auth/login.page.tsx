import { login } from "@/endpoints/auth.endpoints"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AxiosError, AxiosResponse } from "axios"
import { LockIcon, MailIcon } from "lucide-react"
import { SubmitHandler, useForm } from "react-hook-form"
import { useDispatch } from "react-redux"
import { Link, useNavigate } from "react-router-dom"
import { z } from "zod"

import { setAuthToken, setAuthUser } from "@/redux/features/auth/auth.slice"
import { handleFormErrors } from "@/utils/form.utils"
import { cn } from "@/utils/global.utils"
// import { saveAuthStorage } from "@/utils/storage.utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"

const formSchema = z.object({
  email: z.string().min(1, { message: "Email is Required" }).email(),
  password: z.string().min(1, { message: "Password is Required" }),
  rememberMe: z.boolean().optional(),
})

export type LoginData = z.infer<typeof formSchema>

const Login = () => {
  const navigate = useNavigate()
  const dispatch = useDispatch()

  const form = useForm<LoginData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      rememberMe: false,
    },
  })

  const loginMutation = useMutation({
    mutationFn: (data: LoginData) => login(data),
    onSuccess: (response: AxiosResponse) => {
      const { accessToken, user } = response.data.data

      // Dispatch actions to update Redux store
      dispatch(setAuthToken({ token: accessToken }))
      dispatch(setAuthUser({ user }))

      // Check if user has organizations
      if (user.organizations && user.organizations.length > 0) {
        // Redirect to dashboard with default organization
        navigate("/dashboard")
      } else {
        // Redirect to create organization form
        navigate("/organizations/create")
      }
    },
    onError: (error: AxiosError<ErrorResponse>) => {
      handleFormErrors<LoginData>(error, form.setError)
      form.reset({ password: "" }, { keepErrors: true })
    },
  })

  // Submit form
  const onSubmit: SubmitHandler<LoginData> = (values) => {
    loginMutation.mutate(values)
  }

  // Clear field error
  const clearFieldError = (fieldName: keyof LoginData) => {
    form.clearErrors(fieldName)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Welcome Back</h1>
      </header>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Login</CardTitle>
          <CardDescription>Enter your credentials to access your account</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="space-y-4">
              {form.formState.errors.root && (
                <p className="text-sm text-destructive">{form.formState.errors.root.message}</p>
              )}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <MailIcon
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                          size={18}
                        />
                        <Input
                          placeholder="Enter your email"
                          className={cn(
                            "pl-10",
                            form.formState.errors.email && "border-destructive"
                          )}
                          {...field}
                          onChange={(e) => {
                            field.onChange(e)
                            clearFieldError("email")
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <LockIcon
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                          size={18}
                        />
                        <Input
                          type="password"
                          placeholder="Enter your password"
                          className={cn(
                            "pl-10",
                            form.formState.errors.password && "border-destructive"
                          )}
                          {...field}
                          onChange={(e) => {
                            field.onChange(e)
                            clearFieldError("password")
                          }}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex items-center justify-between">
                <FormField
                  control={form.control}
                  name="rememberMe"
                  render={({ field }) => (
                    <FormItem className="flex h-fit items-center space-x-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel>Remember me</FormLabel>
                    </FormItem>
                  )}
                />
                <Link to="/password/forgot" className="text-sm text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <Button className="w-full" type="submit" disabled={loginMutation.isPending}>
                {loginMutation.isPending ? "Logging in..." : "Log in"}
              </Button>
              <p className="text-center text-sm text-gray-600">
                Don't have an account?{" "}
                <Link to="/register" className="text-primary hover:underline">
                  Sign up
                </Link>
              </p>
            </CardFooter>
          </form>
        </Form>
      </Card>
    </div>
  )
}
export default Login
