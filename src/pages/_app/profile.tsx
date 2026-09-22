import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom } from '@/lib/api-error'
import { useProfile, useUpdateProfile } from '@/queries/profile.queries'
import { updateProfileSchema } from '@/schemas/profile.schemas'
import type { User } from '@/types/api.types'

export const Route = createFileRoute('/_app/profile')({
  staticData: { crumb: 'Profile' },
  component: ProfilePage,
})

/** The account's join date, in the reader's own locale. */
function memberSince(createdAt: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date)
}

function ProfilePage() {
  const profile = useProfile()

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        {/* CardTitle renders a div, so the heading is nested inside it. */}
        <CardTitle>
          <h1>Profile</h1>
        </CardTitle>
        <CardDescription>
          Update your name. Your email address cannot be changed here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Keyed on the user so the form's defaultValues are captured from
            real data rather than from an empty placeholder that arrived
            first. */}
        {profile.data ? (
          <ProfileDetails key={profile.data.id} user={profile.data} />
        ) : (
          <div className="grid gap-4">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProfileDetails({ user }: { user: User }) {
  const updateProfile = useUpdateProfile()
  const serverErrors = useServerErrors()

  const form = useForm({
    defaultValues: { firstName: user.firstName ?? '', lastName: user.lastName ?? '' },
    validators: { onSubmit: updateProfileSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        // Parsed rather than posted raw, so the schema's `.trim()` reaches
        // the wire — TanStack hands `value` straight from form state.
        await updateProfile.mutateAsync(updateProfileSchema.parse(value))
        toast.success('Profile updated.')
      } catch (error) {
        serverErrors.capture(error)
        toast.error(messageFrom(error))
      }
    },
  })

  return (
    <>
      <Form form={form} serverErrors={serverErrors}>
        <FormField form={form} name="firstName">
          {(field) => (
            <FormItem>
              <FormLabel>First name</FormLabel>
              <FormControl>
                <Input
                  autoComplete="given-name"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        <FormField form={form} name="lastName">
          {(field) => (
            <FormItem>
              <FormLabel>Last name</FormLabel>
              <FormControl>
                <Input
                  autoComplete="family-name"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>

        {/* Placed by hand: <Form> does not render this itself, and without it
            the server's schema-level messages would never be shown. */}
        <FormError />

        <Button type="submit" disabled={updateProfile.isPending}>
          {updateProfile.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </Form>

      {/* Read-only, because PATCH /profile accepts firstName and lastName and
          nothing else. There is deliberately no change-password form and no
          auth-provider list: the API exposes an endpoint for neither. */}
      <dl className="mt-6 grid gap-3 border-t pt-6 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Member since</dt>
          <dd>{memberSince(user.createdAt)}</dd>
        </div>
      </dl>
    </>
  )
}
