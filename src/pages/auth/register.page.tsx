import { register } from "@/endpoints/auth.endpoints"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AxiosError, AxiosResponse } from "axios"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import * as z from "zod"

import { handleFormErrors } from "@/utils/form.utils"
import { cn } from "@/utils/global.utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const formSchema = z.object({
  username: z.string().min(3).max(255),
  firstName: z.string().min(1).max(255),
  middleName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
  email: z.string().email().max(255),
  password: z.string().min(8).max(255),
  role: z.enum(["user", "admin"]).default("user"),
  phone: z.string().max(32).optional(),
  avatar: z.string().url().max(255).optional(),
  dateOfBirth: z.date().optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
})

export type RegisterData = z.infer<typeof formSchema>

const Register = () => {
  const navigate = useNavigate()

  const form = useForm<RegisterData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      role: "user",
    },
  })

  const registerMutation = useMutation({
    mutationFn: (data: RegisterData) => register(data),
    onSuccess: (response: AxiosResponse) => {
      // eslint-disable-next-line no-console
      console.log(response)
      navigate("/login")
    },
    onError: (error: AxiosError<ErrorResponse>) => {
      handleFormErrors<RegisterData>(error, form.setError)
    },
  })

  function onSubmit(values: RegisterData) {
    registerMutation.mutate(values)
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Register</h1>
      </header>
      <Card className="mx-auto w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Register a New Account</CardTitle>
          <CardDescription>
            Please fill in your information to create a new account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              {form.formState.errors.root && (
                <div className="text-destructive">{form.formState.errors.root.message}</div>
              )}
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="john-doe"
                        {...field}
                        className={cn(form.formState.errors.username && "border-destructive")}
                      />
                    </FormControl>
                    <FormDescription>
                      This will be your unique identifier on the platform.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="John"
                          {...field}
                          className={cn(form.formState.errors.firstName && "border-destructive")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="middleName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Middle Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Michael"
                          {...field}
                          className={cn(form.formState.errors.middleName && "border-destructive")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="Doe"
                          {...field}
                          className={cn(form.formState.errors.lastName && "border-destructive")}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="john.doe@example.com"
                        {...field}
                        className={cn(form.formState.errors.email && "border-destructive")}
                      />
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
                      <Input
                        type="password"
                        placeholder="********"
                        {...field}
                        className={cn(form.formState.errors.password && "border-destructive")}
                      />
                    </FormControl>
                    <FormDescription>Must be at least 8 characters long.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        placeholder="+1234567890"
                        {...field}
                        className={cn(form.formState.errors.phone && "border-destructive")}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="dateOfBirth"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Date of Birth</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={`w-full pl-3 text-left font-normal ${!field.value && "text-muted-foreground"}`}>
                            {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto size-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
                          // initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="gender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Gender</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your gender" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="avatar"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Avatar URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com/avatar.jpg" {...field} />
                    </FormControl>
                    <FormDescription>Enter a URL for your profile picture.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? "Registering..." : "Register"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}

export default Register
