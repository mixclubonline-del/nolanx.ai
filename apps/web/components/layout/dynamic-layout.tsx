"use client";

import { ReactNode } from 'react';

interface DynamicLayoutProps {
  children: ReactNode;
}

export function DynamicLayout({ children }: DynamicLayoutProps) {
  return <div className="h-screen overflow-hidden bg-[#050403]">{children}</div>;
}
