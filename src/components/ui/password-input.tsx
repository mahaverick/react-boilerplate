import { useCallback, useState } from 'react'

import { EyeIcon, EyeOffIcon, LockIcon } from 'lucide-react'

import { cn } from '@/utils/global.utils'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface PasswordInputProps {
  value?: string
  error?: boolean
  showIcon?: boolean
  onChange?: (_value: string) => void
  placeholder?: string
  className?: string
  showPasswordStrength?: boolean
}

export default function PasswordInput({
  value,
  error,
  showIcon,
  onChange,
  placeholder = 'Enter your password',
  className,
  showPasswordStrength = false,
}: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false)
  const togglePasswordVisibility = useCallback(() => {
    setShowPassword((prev) => !prev)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e.target.value)
  }

  return (
    <>
      <div className="relative">
        <Input
          type={showPassword ? 'text' : 'password'}
          id="password"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          icon={showIcon ? LockIcon : null}
          error={error}
          className={cn('pr-10', className)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
          onClick={togglePasswordVisibility}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          aria-controls="password"
        >
          {showPassword ? (
            <EyeOffIcon className="size-4 text-gray-400" />
          ) : (
            <EyeIcon className="size-4 text-gray-400" />
          )}
        </Button>
      </div>
      {value !== undefined && value !== '' && showPasswordStrength && (
        <p className="text-sm text-muted-foreground">
          Password strength: {value.length < 8 ? 'Weak' : 'Strong'}
        </p>
      )}
    </>
  )
}
