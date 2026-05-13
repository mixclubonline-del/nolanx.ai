"use client";

import { useMemo } from "react";
import { Moon, Sun } from "lucide-react";
import { useThemeContext } from "@/contexts/theme-context";
import { Button } from "../ui/button";

export default function ThemeButton() {
  const { theme, setTheme, mounted } = useThemeContext();

  const isDark = useMemo(() => {
    if (!mounted) {
      return true;
    }
    return theme !== "light";
  }, [mounted, theme]);

  const nextTheme = isDark ? "light" : "dark";

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => setTheme(nextTheme)}
      className="flex items-center gap-2 rounded-full px-2 text-neutral-600 hover:bg-white/22 hover:text-neutral-900 dark:text-white/58 dark:hover:bg-white/[0.08] dark:hover:text-white md:px-3"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      <span className="hidden md:inline">{isDark ? "Light" : "Dark"}</span>
    </Button>
  );
}
