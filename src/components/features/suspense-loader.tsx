import React from "react"
import { Loader2 } from "lucide-react"

import { cn } from "@/utils/global.utils"

interface SuspenseLoaderProps {
  className?: string
  size?: "small" | "medium" | "large"
  text?: string
}

const SuspenseLoader: React.FC<SuspenseLoaderProps> = ({
  className,
  size = "medium",
  text = "Loading...",
}) => {
  const sizeClasses = {
    small: "w-4 h-4",
    medium: "w-8 h-8",
    large: "w-12 h-12",
  }

  return (
    <div className={cn("flex h-screen flex-col items-center justify-center", className)}>
      <Loader2 className={cn("animate-spin text-primary", sizeClasses[size])} />
      {text && <p className="mt-2 text-sm text-muted-foreground">{text}</p>}
    </div>
  )
}

export default SuspenseLoader
