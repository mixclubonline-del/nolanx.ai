"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { ReactNode, useEffect, useState } from "react";

interface CinematicWrapperProps {
  children: ReactNode;
  className?: string;
  variant?: "default" | "glass" | "surface";
  animation?: "fade" | "slide" | "none";
  glow?: boolean;
}

export function CinematicWrapper({
  children,
  className,
  variant = "default",
  animation = "fade",
  glow = false,
}: CinematicWrapperProps) {
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className={className}>{children}</div>;
  }

  const baseClasses = "transition-all duration-300 ease-out";
  
  const variantClasses = {
    default: "cinematic-bg",
    glass: "cinematic-glass",
    surface: "cinematic-surface cinematic-border border",
  };

  const animationClasses = {
    fade: "cinematic-fade-in",
    slide: "cinematic-slide-up",
    none: "",
  };

  const glowClasses = glow ? "cinematic-glow-subtle" : "";

  return (
    <div
      className={cn(
        baseClasses,
        variantClasses[variant],
        animationClasses[animation],
        glowClasses,
        className
      )}
    >
      {children}
    </div>
  );
}

interface CinematicButtonProps {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  variant?: "primary" | "secondary" | "ghost" | "neon-pink" | "neon-green" | "neon-purple" | "neon-orange" | "neon-cyan";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  animated?: boolean;
  glow?: boolean;
}

export function CinematicButton({
  children,
  onClick,
  className,
  variant = "primary",
  size = "md",
  disabled = false,
  animated = false,
  glow = false,
}: CinematicButtonProps) {
  const baseClasses = cn(
    "inline-flex items-center justify-center font-medium rounded-lg",
    "transition-all duration-300 cubic-bezier(0.4, 0, 0.2, 1)",
    "focus:outline-none focus:ring-2 focus:ring-offset-2",
    "disabled:opacity-50 disabled:cursor-not-allowed",
    "select-none"
  );

  const sizeClasses = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-base",
    lg: "px-6 py-3 text-lg",
  };

  const variantClasses = {
    primary: cn(
      "cinematic-button",
      "hover:cinematic-glow-subtle",
      "focus:ring-cinematic-accent/50"
    ),
    secondary: cn(
      "bg-transparent border border-cinematic-border",
      "cinematic-text hover:cinematic-text-accent",
      "hover:border-cinematic-accent/50 hover:bg-cinematic-accent/5",
      "focus:ring-cinematic-accent/50"
    ),
    ghost: cn(
      "bg-transparent cinematic-text",
      "hover:bg-cinematic-surface hover:cinematic-text-accent",
      "focus:ring-cinematic-accent/50"
    ),
    "neon-pink": cn(
      "bg-black/80 border-2 border-transparent neon-pink font-bold",
      "hover:border-current hover:neon-glow-pink hover:bg-black/90",
      "focus:ring-pink-500/50 transition-all duration-300",
      animated && "neon-pulse",
      glow && "neon-glow-pink"
    ),
    "neon-green": cn(
      "bg-black/80 border-2 border-transparent neon-green font-bold",
      "hover:border-current hover:neon-glow-green hover:bg-black/90",
      "focus:ring-green-500/50 transition-all duration-300",
      animated && "neon-flicker",
      glow && "neon-glow-green"
    ),
    "neon-purple": cn(
      "bg-black/80 border-2 border-transparent neon-purple font-bold",
      "hover:border-current hover:neon-glow-purple hover:bg-black/90",
      "focus:ring-purple-500/50 transition-all duration-300",
      animated && "neon-wave",
      glow && "neon-glow-purple"
    ),
    "neon-orange": cn(
      "bg-black/80 border-2 border-transparent neon-orange font-bold",
      "hover:border-current hover:neon-glow-orange hover:bg-black/90",
      "focus:ring-orange-500/50 transition-all duration-300",
      animated && "neon-pulse",
      glow && "neon-glow-orange"
    ),
    "neon-cyan": cn(
      "bg-black/80 border-2 border-transparent neon-cyan font-bold",
      "hover:border-current hover:neon-glow-cyan hover:bg-black/90",
      "focus:ring-cyan-500/50 transition-all duration-300",
      animated && "neon-flicker",
      glow && "neon-glow-cyan"
    ),
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        baseClasses,
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
    >
      {children}
    </button>
  );
}

interface CinematicCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function CinematicCard({
  children,
  className,
  hover = true,
  glow = false,
}: CinematicCardProps) {
  const baseClasses = cn(
    "cinematic-surface rounded-xl border cinematic-border",
    "backdrop-filter backdrop-blur-sm",
    hover && "transition-all duration-300 hover:transform hover:-translate-y-1 hover:shadow-lg cursor-pointer",
    glow && "cinematic-glow-subtle"
  );

  return (
    <div className={cn(baseClasses, className)}>
      {children}
    </div>
  );
}

interface CinematicTextProps {
  children: ReactNode;
  variant?: "default" | "muted" | "accent" | "title" | "subtitle";
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "span" | "div";
}

export function CinematicText({
  children,
  variant = "default",
  className,
  as: Component = "p",
}: CinematicTextProps) {
  const variantClasses = {
    default: "cinematic-text",
    muted: "cinematic-text-muted",
    accent: "cinematic-text-accent font-medium",
    title: "cinematic-text text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight",
    subtitle: "cinematic-text-muted text-lg md:text-xl",
  };

  return (
    <Component className={cn(variantClasses[variant], className)}>
      {children}
    </Component>
  );
}

interface CinematicInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  className?: string;
  multiline?: boolean;
  rows?: number;
}

export function CinematicInput({
  placeholder,
  value,
  onChange,
  className,
  multiline = false,
  rows = 3,
}: CinematicInputProps) {
  const baseClasses = cn(
    "w-full px-4 py-3 rounded-lg",
    "bg-cinematic-surface/50 border cinematic-border",
    "cinematic-text placeholder:cinematic-text-muted",
    "focus:outline-none focus:ring-2 focus:ring-cinematic-accent/50",
    "focus:border-cinematic-accent/50",
    "backdrop-filter backdrop-blur-sm",
    "transition-all duration-300"
  );

  if (multiline) {
    return (
      <textarea
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        rows={rows}
        className={cn(baseClasses, "resize-none", className)}
      />
    );
  }

  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(baseClasses, className)}
    />
  );
}
