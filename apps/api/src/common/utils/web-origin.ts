const LOCAL_DEVELOPMENT_ORIGINS = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:8080',
]);

const PRODUCTION_HOSTNAMES = ['nolanx.ai'] as const;

export function isAllowedWebOrigin(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const origin = `${url.protocol}//${url.host}`;

    if (LOCAL_DEVELOPMENT_ORIGINS.has(origin)) {
      return true;
    }

    if (url.protocol !== 'https:') {
      return false;
    }

    return PRODUCTION_HOSTNAMES.some(
      (hostname) =>
        url.hostname === hostname || url.hostname.endsWith(`.${hostname}`),
    );
  } catch {
    return false;
  }
}
