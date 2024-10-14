import React from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"

const NotFound: React.FC = () => {
  const navigate = useNavigate()

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background">
      <h1 className="mb-4 text-4xl font-bold text-primary">404</h1>
      <p className="mb-8 text-xl text-muted-foreground">Oops! Page not found.</p>
      <Button onClick={() => navigate("/")}>Go Home</Button>
    </div>
  )
}

export default NotFound
