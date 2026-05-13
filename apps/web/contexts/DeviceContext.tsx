'use client';

import React, { createContext, useContext, ReactNode } from 'react';
import { useDevice, DeviceType, BREAKPOINTS } from '../hooks/useDevice';

// 设备上下文接口定义
interface DeviceContextType {
    device: DeviceType;
    isMobile: boolean;
    isTablet: boolean;
    isDesktop: boolean;
    isClient: boolean;
    // 导出断点常量便于在组件中使用
    breakpoints: typeof BREAKPOINTS;
}

// 创建上下文
const DeviceContext = createContext<DeviceContextType | null>(null);

interface DeviceProviderProps {
    children: ReactNode;
}

/**
 * 设备检测提供者组件
 * 在应用根组件中使用此组件包裹其他组件
 */
export function DeviceProvider({ children }: DeviceProviderProps) {
    const deviceData = useDevice();

    return (
        <DeviceContext.Provider value={{ ...deviceData, breakpoints: BREAKPOINTS }}>
            {children}
        </DeviceContext.Provider>
    );
}

/**
 * 使用设备上下文的钩子
 * @returns 设备信息和工具方法
 */
export function useDeviceContext(): DeviceContextType {
    const context = useContext(DeviceContext);

    if (!context) {
        throw new Error('useDeviceContext must be used within a DeviceProvider');
    }

    return context;
} 