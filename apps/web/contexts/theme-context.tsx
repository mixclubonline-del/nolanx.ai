"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

// 定义主题上下文的类型
interface ThemeContextType {
    theme: string | undefined;
    setTheme: (theme: string) => void;
    resolvedTheme: string | undefined;
    mounted: boolean;
}

// 创建主题上下文
const ThemeContext = createContext<ThemeContextType>({
    theme: 'dark',
    setTheme: () => null,
    resolvedTheme: undefined,
    mounted: false,
});

// 创建使用主题的Hook
export const useThemeContext = () => useContext(ThemeContext);

// 主题提供者组件的属性类型
interface ThemeContextProviderProps {
    children: ReactNode;
    defaultTheme?: ThemeProviderProps["defaultTheme"];
    attribute?: ThemeProviderProps["attribute"];
    disableTransitionOnChange?: ThemeProviderProps["disableTransitionOnChange"];
    enableSystem?: ThemeProviderProps["enableSystem"];
}

// 内部主题内容组件，用于访问next-themes的钩子
function ThemeContextContent({ children }: { children: ReactNode }) {
    const [mounted, setMounted] = useState(false);
    const { theme, setTheme, resolvedTheme } = useNextTheme();

    // 在客户端挂载后设置mounted状态
    useEffect(() => {
        setMounted(true);
    }, []);

    // 上下文值
    const contextValue: ThemeContextType = {
        theme,
        setTheme,
        resolvedTheme,
        mounted,
    };

    return (
        <ThemeContext.Provider value={contextValue}>
            {children}
        </ThemeContext.Provider>
    );
}

// 主题提供者组件
export function ThemeContextProvider({
    children,
    defaultTheme = "system",
    attribute = "class",
    disableTransitionOnChange = true,
    enableSystem = true,
}: ThemeContextProviderProps) {
    return (
        <NextThemesProvider
            attribute={attribute}
            defaultTheme={defaultTheme}
            enableSystem={enableSystem}
            disableTransitionOnChange={disableTransitionOnChange}
        >
            <ThemeContextContent>
                {children}
            </ThemeContextContent>
        </NextThemesProvider>
    );
}

// 客户端组件包装器
export function ClientOnly({ children }: { children: ReactNode }) {
    const { mounted } = useThemeContext();

    if (!mounted) {
        return null;
    }

    return <>{children}</>;
}

// 带有占位符的客户端组件包装器
export function ClientOnlyWithFallback({
    children,
    fallback
}: {
    children: ReactNode;
    fallback: ReactNode;
}) {
    const { mounted } = useThemeContext();

    if (!mounted) {
        return <>{fallback}</>;
    }

    return <>{children}</>;
} 