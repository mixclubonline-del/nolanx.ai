import { forwardRef, HTMLAttributes } from "react"
import { cn } from "@/lib/utils"

interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
    value: number
    max?: number
    variant?: "default" | "primary" | "success"
    showValue?: boolean
    size?: "default" | "sm" | "lg"
    indeterminate?: boolean
}

export const Progress = forwardRef<HTMLDivElement, ProgressProps>(
    ({
        className,
        value = 0,
        max = 100,
        variant = "default",
        showValue = false,
        size = "default",
        indeterminate = false,
        ...props
    }, ref) => {
        // 确保值的范围在0-max之间
        const validValue = Math.max(0, Math.min(value, max))
        const percentage = (validValue / max) * 100

        return (
            <div
                className={cn(
                    "relative w-full overflow-hidden rounded-full",
                    size === "default" && "h-2",
                    size === "sm" && "h-1",
                    size === "lg" && "h-3",
                    className
                )}
                ref={ref}
                {...props}
            >
                <div
                    className={cn(
                        "h-full w-full flex-1 rounded-full bg-muted",
                    )}
                />
                <div
                    className={cn(
                        "absolute inset-y-0 left-0 rounded-full transition-all duration-300 ease-in-out",
                        indeterminate && "animate-progress-indeterminate",
                        variant === "default" && "bg-primary",
                        variant === "primary" && "bg-primary",
                        variant === "success" && "bg-green-500",
                    )}
                    style={{ width: `${percentage}%` }}
                />
                {showValue && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-xs font-medium text-foreground">
                            {Math.round(percentage)}%
                        </span>
                    </div>
                )}
            </div>
        )
    }
)

Progress.displayName = "Progress" 