import { NextRequest } from 'next/server'
import { isAllowedTimelineVideoOrigin, parseVideoUrl } from '@/lib/utils/videoUrl'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type TimelineVideoCacheRequest = {
  videoUrl?: string
  fallbackUrls?: string[]
}

const EXPLICIT_ALLOWED_ORIGINS = [
  'https://gen-video.tos-ap-southeast-1.bytepluses.com',
  'https://ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com',
]

const pickAllowedCandidate = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    const parsed = parseVideoUrl(candidate)
    if (!parsed) continue
    if (isAllowedTimelineVideoOrigin(parsed, EXPLICIT_ALLOWED_ORIGINS)) {
      return parsed.toString()
    }
  }
  return null
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as TimelineVideoCacheRequest
    const candidates = [body.videoUrl, ...(body.fallbackUrls || [])]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

    const targetUrl = pickAllowedCandidate(candidates)
    if (!targetUrl) {
      return new Response('No allowed video source provided', { status: 400 })
    }

    const upstream = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'video/*,*/*;q=0.8',
      },
      cache: 'no-store',
    })

    if (!upstream.ok || !upstream.body) {
      return new Response(`Upstream fetch failed: ${upstream.status}`, {
        status: upstream.ok ? 502 : upstream.status,
      })
    }

    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4')
    headers.set('Cache-Control', 'no-store, max-age=0')

    const contentLength = upstream.headers.get('content-length')
    if (contentLength) {
      headers.set('Content-Length', contentLength)
    }

    const acceptRanges = upstream.headers.get('accept-ranges')
    if (acceptRanges) {
      headers.set('Accept-Ranges', acceptRanges)
    }

    return new Response(upstream.body, {
      status: 200,
      headers,
    })
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'Timeline video proxy failed',
      { status: 500 },
    )
  }
}
