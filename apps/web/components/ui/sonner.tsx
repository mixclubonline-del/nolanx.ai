"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const themeMap: any = {
    light: 'dark',
    dark: 'light'
  }

  return (
    <Sonner
      theme={themeMap[theme] || 'system'}
      className="toaster group"
      position="top-center"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-black group-[.toaster]:text-white dark:group-[.toaster]:bg-white dark:group-[.toaster]:text-black group-[.toaster]:border-gray-700 dark:group-[.toaster]:border-gray-300 group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-gray-300 dark:group-[.toast]:text-gray-600",
          actionButton:
            "group-[.toast]:bg-white group-[.toast]:text-black dark:group-[.toast]:bg-black dark:group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-gray-800 group-[.toast]:text-gray-300 dark:group-[.toast]:bg-gray-200 dark:group-[.toast]:text-gray-600",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
