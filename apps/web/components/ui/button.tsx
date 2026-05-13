import type React from "react"
import { cn } from "@/lib/utils"
import { cva } from "class-variance-authority"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "default" | "outline" | "secondary" | "destructive" | "ghost" | "link"
    size?: "default" | "sm" | "lg" | "icon"
}

export const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "bg-primary text-primary-foreground hover:bg-primary/90",
                destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground dark:border-white/20 dark:bg-white/5 dark:hover:bg-white/10",
                secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 dark:bg-white/5 dark:hover:bg-white/10 dark:border-white/20 dark:border",
                ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-white/10",
                link: "text-primary underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-9 rounded-md px-3",
                lg: "h-11 rounded-md px-8",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export function Button({
    className,
    variant = "default",
    size = "default",
    ...props
}: ButtonProps) {
    return (
        <button
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    )
} 