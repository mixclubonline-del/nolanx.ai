import { getSiteConfig } from '@/lib/site';

const isDevelopment = process.env.NODE_ENV === 'development';
const siteConfig = getSiteConfig();

export const API_CONFIG = {
  BASE_URL: isDevelopment
    ? process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080'
    : process.env.NEXT_PUBLIC_API_BASE_URL || siteConfig.apiBaseUrl,
  TIMEOUT: 30000,
};
