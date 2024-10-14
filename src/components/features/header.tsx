import { useSelector } from "react-redux"

import { RootState } from "@/redux/store"
import { cn } from "@/utils/global.utils"

function Header() {
  const { isExpanded } = useSelector((state: RootState) => state.sidebar)
  const { user } = useSelector((state: RootState) => state.auth)
  return (
    <header
      className={cn(
        "fixed left-0 right-0 top-0 z-20 flex h-16 items-center justify-end bg-background px-6 py-3 transition-all duration-300",
        isExpanded ? "ml-64" : "ml-16"
      )}>
      {/* <div className="flex items-center space-x-4">
            <Input type="search" placeholder="Search..." className="w-64" />
          </div> */}
      <span className="text-lg">{`Welcome, ${user?.firstName} ${user?.lastName}`}</span>
    </header>
  )
}

export default Header
