const KNOWN_TIMELINE_VIDEO_HOST_SUFFIXES = [
  '.tos-ap-southeast-1.volces.com',
  '.bytepluses.com',
  '.byteplusapi.com',
];

const SIGNED_VIDEO_QUERY_KEYS = [
  'X-Tos-Algorithm',
  'X-Tos-Credential',
  'X-Tos-Date',
  'X-Tos-Expires',
  'X-Tos-Signature',
  'X-Tos-SignedHeaders',
];

const EXTRA_ALLOWED_VIDEO_ORIGINS = (
  process.env.NEXT_PUBLIC_VIDEO_DOWNLOAD_ALLOWED_ORIGINS ||
  process.env.VIDEO_DOWNLOAD_ALLOWED_ORIGINS ||
  ''
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const EXTRA_ALLOWED_VIDEO_HOST_SUFFIXES = (
  process.env.NEXT_PUBLIC_VIDEO_DOWNLOAD_ALLOWED_HOST_SUFFIXES ||
  process.env.VIDEO_DOWNLOAD_ALLOWED_HOST_SUFFIXES ||
  ''
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean)
  .map((value) => (value.startsWith('.') ? value : `.${value}`));

const ALL_TIMELINE_VIDEO_HOST_SUFFIXES = [
  ...KNOWN_TIMELINE_VIDEO_HOST_SUFFIXES,
  ...EXTRA_ALLOWED_VIDEO_HOST_SUFFIXES,
];

const normalizeVideoBaseUrl = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, '');
  }

  return `https://${trimmed.replace(/\/+$/, '')}`;
};

const BYTEPLUS_OUTPUT_TOS_BASE_URL = normalizeVideoBaseUrl(
  process.env.NEXT_PUBLIC_BYTEPLUS_OUTPUT_TOS_BASE_URL ||
    process.env.BYTEPLUS_OUTPUT_TOS_BASE_URL ||
    'https://gen-video.tos-ap-southeast-1.bytepluses.com',
);

const BYTEPLUS_PROVIDER_OUTPUT_TOS_BASE_URL = normalizeVideoBaseUrl(
  process.env.NEXT_PUBLIC_BYTEPLUS_PROVIDER_OUTPUT_TOS_BASE_URL ||
    process.env.BYTEPLUS_PROVIDER_OUTPUT_TOS_BASE_URL ||
    'https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com',
);

export const parseVideoUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const hasSignedVideoQuery = (url: URL): boolean => {
  return SIGNED_VIDEO_QUERY_KEYS.some((key) => url.searchParams.has(key));
};

export const matchesAllowedVideoHostSuffix = (hostname: string): boolean => {
  const normalizedHostname = hostname.trim().toLowerCase();
  return ALL_TIMELINE_VIDEO_HOST_SUFFIXES.some((suffix) => normalizedHostname.endsWith(suffix));
};

export const shouldUseTimelineVideoProxy = (value: string): boolean => {
  const parsed = parseVideoUrl(value);
  if (!parsed) {
    return false;
  }

  return hasSignedVideoQuery(parsed) || matchesAllowedVideoHostSuffix(parsed.hostname);
};

export const rewriteBytePlusVideoUrlToProviderSource = (value: string): string | null => {
  const parsed = parseVideoUrl(value);
  const outputBase = parseVideoUrl(BYTEPLUS_OUTPUT_TOS_BASE_URL);
  const providerBase = parseVideoUrl(BYTEPLUS_PROVIDER_OUTPUT_TOS_BASE_URL);

  if (!parsed || !outputBase || !providerBase) {
    return null;
  }

  if (parsed.origin !== outputBase.origin || parsed.pathname === '/') {
    return null;
  }

  const fallback = new URL(parsed.toString());
  fallback.protocol = providerBase.protocol;
  fallback.username = providerBase.username;
  fallback.password = providerBase.password;
  fallback.host = providerBase.host;
  return fallback.toString();
};

export const getTimelineVideoSourceCandidates = (videoUrl: string): string[] => {
  const candidates = [videoUrl];
  const providerFallbackUrl = rewriteBytePlusVideoUrlToProviderSource(videoUrl);

  if (providerFallbackUrl && providerFallbackUrl !== videoUrl) {
    candidates.push(providerFallbackUrl);
  }

  return candidates;
};

export const buildTimelineVideoProxyRequest = (videoUrl: string, fallbackUrls: string[] = []) => {
  return {
    input: '/api/timeline-video-cache',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoUrl, fallbackUrls }),
    } satisfies RequestInit,
  };
};

export const isAllowedTimelineVideoOrigin = (url: URL, explicitOrigins: string[]): boolean => {
  if (explicitOrigins.includes(url.origin)) {
    return true;
  }

  if (EXTRA_ALLOWED_VIDEO_ORIGINS.includes(url.origin)) {
    return true;
  }

  return matchesAllowedVideoHostSuffix(url.hostname);
};
