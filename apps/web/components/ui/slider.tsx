"use client"

import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"
import { cn } from "@/lib/utils"

const Slider = React.forwardRef<
    React.ElementRef<typeof SliderPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
    <SliderPrimitive.Root
        ref={ref}
        className={cn(
            "relative flex w-full touch-none select-none items-center",
            className
        )}
        {...props}
    >
        <SliderPrimitive.Track className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary">
            <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

// 赛博朋克风格滑块
const CyberpunkSlider = React.forwardRef<
    React.ElementRef<typeof SliderPrimitive.Root>,
    React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
    <SliderPrimitive.Root
        ref={ref}
        className={cn(
            "relative flex w-full touch-none select-none items-center",
            className
        )}
        {...props}
    >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-black border border-[#F5EFFF]/30">
            <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-[#F5EFFF]/60 to-[#F5EFFF] shadow-[0_0_10px_rgba(0,255,0,0.5)]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-[#F5EFFF] bg-black shadow-[0_0_8px_rgba(0,255,0,0.7)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F5EFFF] focus-visible:ring-offset-2 hover:bg-[#F5EFFF]/10 hover:scale-110 hover:shadow-[0_0_12px_rgba(0,255,0,0.9)] disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
))
CyberpunkSlider.displayName = "CyberpunkSlider"

export { Slider, CyberpunkSlider } 