"use client";

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { ConfigsProvider } from '@/lib/nolanx/contexts/configs';
import { NolanxHome } from './NolanxHome';
import '@/styles/nolanx/assets/style/App.css';

const queryClient = new QueryClient();

export function NolanxApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigsProvider>
        <NolanxHome />
      </ConfigsProvider>
      <Toaster position="bottom-center" richColors />
    </QueryClientProvider>
  );
}
