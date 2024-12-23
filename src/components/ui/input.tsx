import React from 'react'

import { cn } from '@/utils/global.utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
  icon?: React.ElementType | null
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ icon: Icon, error, className, type, ...props }, ref) => {
    return (
      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
        )}
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
            Icon ? 'pl-10' : 'pl-3',
            error && 'border-destructive',
            className
          )}
          ref={ref}
          {...props}
        />
      </div>
    )
  }
)
Input.displayName = 'Input'

export { Input }
