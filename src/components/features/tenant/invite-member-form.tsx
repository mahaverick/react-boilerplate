import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  canActorGrantRole,
  DEFAULT_MEMBER_ROLE,
  MEMBERSHIP_ROLES,
  ROLE_LABELS,
  type MembershipRole,
} from '@/constants/roles'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { useInviteMember } from '@/queries/tenant.queries'
import { inviteMemberSchema } from '@/schemas/tenant.schemas'
import { ALREADY_MEMBER, INVITATION_CONFLICT } from '@/types/api.types'

/** A 409 `invitation_conflict`: another invite for this address just won the race. */
const RACED = 'Someone just invited this address — refresh and try again.'

/**
 * Invite someone by email.
 *
 * Reachable for owner and admin (`canManageTenant`), but the roles OFFERED
 * come from `canActorGrantRole` — a third rule, separate from the
 * actor→target matrix, because a person who is not yet a member has no
 * current role to compare against. Without it an admin could invite a
 * brand-new `admin` (or `owner`), which is a larger grant than the matrix
 * lets that same admin apply to an EXISTING admin.
 */
export function InviteMemberForm({ slug, myRole }: { slug: string; myRole: MembershipRole }) {
  const inviteMember = useInviteMember(slug)
  const serverErrors = useServerErrors()
  const grantable = MEMBERSHIP_ROLES.filter((role) => canActorGrantRole(myRole, role))

  // The schema's own input type, so `role` stays a MembershipRole rather than
  // widening to `string` — the same annotation register.tsx makes.
  const defaultValues: z.input<typeof inviteMemberSchema> = {
    email: '',
    role: DEFAULT_MEMBER_ROLE,
  }

  const form = useForm({
    defaultValues,
    validators: { onSubmit: inviteMemberSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        // The 202 carries `data: null`, so the toast names what was sent.
        const input = inviteMemberSchema.parse(value)
        await inviteMember.mutateAsync(input)
        toast.success(`Invitation sent to ${input.email}.`)
        form.reset()
      } catch (error) {
        serverErrors.capture(error)
        // The one answer about the address itself, so it goes on that field.
        if (codeFrom(error) === ALREADY_MEMBER) {
          serverErrors.setFieldError('email', [messageFrom(error)])
          return
        }
        // The hook refetches the list on a conflict, so the winner shows below.
        toast.error(codeFrom(error) === INVITATION_CONFLICT ? RACED : messageFrom(error))
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors} className="sm:flex sm:items-start sm:gap-3">
      <FormField form={form} name="email">
        {(field) => (
          <FormItem className="sm:flex-1">
            <FormLabel>Email</FormLabel>
            <FormControl>
              <Input
                type="email"
                autoComplete="off"
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <FormField form={form} name="role">
        {(field) => (
          <FormItem>
            <FormLabel>Role</FormLabel>
            {/* `FormControl`'s id lands on the visible trigger button, so the
                label points at something a pointer can reach. */}
            <Select
              value={fieldValue(field.state.value)}
              onValueChange={(value: string | null) => {
                if (value === null) return
                field.handleChange(value)
                // Base UI's selection does NOT bubble a change event to the
                // <form>, so <Form>'s own clearing rule never sees this.
                serverErrors.clearField('role')
              }}
            >
              <FormControl>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue>
                    {(value: string) => ROLE_LABELS[value as MembershipRole] ?? value}
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {grantable.map((role) => (
                  <SelectItem key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      </FormField>

      <div className="grid gap-2 sm:pt-6">
        <FormError />
        <Button type="submit" disabled={inviteMember.isPending}>
          {inviteMember.isPending ? 'Sending…' : 'Invite member'}
        </Button>
      </div>
    </Form>
  )
}
