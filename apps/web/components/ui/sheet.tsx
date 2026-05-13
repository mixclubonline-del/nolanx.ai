"use client"

import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

interface SheetContextType {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
}

const SheetContext = React.createContext<SheetContextType | null>(null)

const useSheet = () => {
  const context = React.useContext(SheetContext)
  if (!context) {
    throw new Error("useSheet must be used within a Sheet")
  }
  return context
}

interface SheetProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const Sheet: React.FC<SheetProps> = ({
  children,
  open,
  onOpenChange
}) => {
  const [isOpen, setIsOpen] = React.useState(open || false);

  React.useEffect(() => {
    if (open !== undefined) {
      setIsOpen(open);
    }
  }, [open]);

  const handleOpenChange = (newOpen: boolean) => {
    setIsOpen(newOpen);
    onOpenChange?.(newOpen);
  };

  return (
    <SheetContext.Provider value={{ isOpen, onOpenChange: handleOpenChange }}>
      {children}
    </SheetContext.Provider>
  );
}

interface SheetTriggerProps {
  children: React.ReactNode
  asChild?: boolean
  onClick?: () => void
}

const SheetTrigger: React.FC<SheetTriggerProps> = ({
  children,
  asChild = false,
  onClick
}) => {
  const { onOpenChange } = useSheet()

  const handleClick = () => {
    onOpenChange(true)
    onClick?.()
  }

  if (asChild) {
    return React.cloneElement(children as React.ReactElement, {
      onClick: handleClick
    })
  }

  return (
    <div onClick={handleClick} className="inline-flex">
      {children}
    </div>
  )
}

interface SheetContentProps {
  children: React.ReactNode
  className?: string
  side?: "top" | "right" | "bottom" | "left"
  onClose?: () => void
}

const SheetContent: React.FC<SheetContentProps> = ({
  children,
  className,
  side = "right",
  onClose
}) => {
  const t = useTranslations("Common")
  const { isOpen, onOpenChange } = useSheet()

  const handleClose = () => {
    onOpenChange(false)
    onClose?.()
  }

  if (!isOpen) return null

  // Map side to position classes
  const sideClasses = {
    top: "inset-x-0 top-0 border-b animate-slide-in-from-top",
    bottom: "inset-x-0 bottom-0 border-t animate-slide-in-from-bottom",
    left: "inset-y-0 left-0 h-full w-3/4 border-r animate-slide-in-from-left sm:max-w-sm",
    right: "inset-y-0 right-0 h-full w-3/4 border-l animate-slide-in-from-right sm:max-w-sm",
  }

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Content */}
      <div
        className={cn(
          "fixed z-50 gap-4 bg-background p-6 shadow-lg transition ease-in-out",
          sideClasses[side],
          className
        )}
      >
        {children}
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">{t("userNav.menu.close")}</span>
        </button>
      </div>
    </>
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetContent
} 
