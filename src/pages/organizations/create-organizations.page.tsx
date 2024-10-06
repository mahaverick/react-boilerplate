import { useState } from "react"
import { createOrganization } from "@/endpoints/organization.endpoints"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { useForm } from "react-hook-form"
import { useNavigate } from "react-router-dom"
import { z } from "zod"

import { Button } from "@/components/ui/button"
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
  name: z.string().min(1, "Organization name is required"),
})

export type CreateOrganizationData = z.infer<typeof formSchema>

const CreateOrganization = () => {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)

  const form = useForm<CreateOrganizationData>({
    resolver: zodResolver(formSchema),
  })

  const createOrganizationMutation = useMutation({
    mutationFn: createOrganization,
  })

  const onSubmit = (values: CreateOrganizationData) => {
    setIsLoading(true)
    createOrganizationMutation.mutate(values, {
      onSuccess: () => {
        navigate("/dashboard")
      },
      onError: (error) => {
        console.error("Error creating organization", error)
        // Display error to user
      },
      onSettled: () => setIsLoading(false),
    })
  }

  return (
    <div className="container mx-auto mt-10">
      <h1 className="mb-5 text-2xl font-bold">Create New Organization</h1>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Organization Name</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={isLoading}>
            {isLoading ? "Creating..." : "Create Organization"}
          </Button>
        </form>
      </Form>
    </div>
  )
}

export default CreateOrganization
