import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { SecuritySection } from '@/components/features/profile/security-section'
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
import { pageTitle } from '@/constants/app'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { formatDate } from '@/lib/format'
import { useProfile, useUpdateProfile } from '@/queries/profile.queries'
import { updateProfileSchema } from '@/schemas/profile.schemas'
import type { User } from '@/types/api.types'

export const Route = createFileRoute('/_app/profile')({
  head: () => ({ meta: [{ title: pageTitle('Profile') }] }),
  staticData: { crumb: 'Profile' },
  component: ProfilePage,
})

/** The account's join date, in the reader's own locale. */
function memberSince(createdAt: string): string {
  return formatDate(createdAt, 'long') ?? 'Unknown'
}

/** The profile page; the details are keyed on the user, so the form's defaults come from real data. */
function ProfilePage() {
  const profile = useProfile()

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>
          <h1>Profile</h1>
        </CardTitle>
        <CardDescription>
          Update your name. Your email address cannot be changed here.
        </CardDescription>
      </CardHeader>
      <CardContent>
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

/**
 * The name form and the read-only email and join date; PATCH /profile changes
 * the names alone. The value is parsed before posting, so trimming reaches the
 * wire, and `<FormError />` shows schema-level server messages, which `<Form>`
 * does not render itself.
 */
function ProfileDetails({ user }: { user: User }) {
  const updateProfile = useUpdateProfile()
  const serverErrors = useServerErrors()

  const form = useForm({
    defaultValues: { firstName: user.firstName ?? '', lastName: user.lastName ?? '' },
    validators: { onSubmit: updateProfileSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await updateProfile.mutateAsync(updateProfileSchema.parse(value))
        toast.success('Profile updated.')
      } catch (error) {
        serverErrors.capture(error)
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

        <FormError />

        <Button type="submit" disabled={updateProfile.isPending}>
          {updateProfile.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </Form>

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

      <SecuritySection />
    </>
  )
}
