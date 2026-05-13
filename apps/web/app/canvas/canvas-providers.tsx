"use client";

import { ConfigsProvider } from "@/lib/nolanx/contexts/configs";
import { SocketProvider } from "@/lib/nolanx/contexts/socket";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function CanvasProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigsProvider>
        <SocketProvider>{children}</SocketProvider>
      </ConfigsProvider>
    </QueryClientProvider>
  );
}

