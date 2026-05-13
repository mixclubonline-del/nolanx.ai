import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getLocaleFromPathname, stripLocalePrefix } from './i18n/pathname';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const localeFromPath = getLocaleFromPathname(pathname);

  if (localeFromPath) {
    const targetPath = stripLocalePrefix(pathname);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = targetPath;
    return NextResponse.redirect(redirectUrl, 308);
  }

  if (pathname === '/') {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = '/nolanx';
    return NextResponse.rewrite(rewriteUrl);
  }

  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return response;
}

export const config = {
  matcher: ['/', '/canvas/:path*', '/nolanx', '/nolanx/:path*', '/:locale(en|zh-CN)/:path*'],
};
