import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { CustomLogger } from '../services/logger.service';

@Injectable()
export class JwtGuard implements CanActivate {
  private guardLogger: CustomLogger;

  constructor(private readonly logger: CustomLogger) {
    this.guardLogger = this.logger.createLoggerWithContext(JwtGuard.name);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const internalApiKey = this.extractInternalApiKey(request);
    if (internalApiKey && internalApiKey === (process.env.INTERNAL_API_KEY || 'dev-internal-api-key')) {
      request.user = this.buildLocalDevUser();
      return true;
    }

    const token = this.extractTokenFromHeader(request);
    request.user = this.buildLocalDevUser(token);

    if (!token) {
      this.guardLogger.warn('Missing auth token, using local dev user');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers['authorization'];
    if (!authHeader) return undefined;

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }

  private extractInternalApiKey(request: Request): string | undefined {
    const value = request.headers['x-api-key'];
    if (Array.isArray(value)) {
      return value[0];
    }
    return typeof value === 'string' ? value : undefined;
  }

  private buildLocalDevUser(token?: string) {
    const fromJwt = token ? this.tryBuildLocalDevUserFromJwt(token) : null;
    if (fromJwt) return fromJwt;

    return {
      id: process.env.NOLANX_LOCAL_USER_ID || 'local-dev-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: process.env.NOLANX_LOCAL_USER_EMAIL || 'local@nolanx.dev',
      phone: '',
      app_metadata: {},
      user_metadata: {
        name: 'Local NolanX Developer',
      },
    };
  }

  private tryBuildLocalDevUserFromJwt(token: string) {
    try {
      const [, payloadPart] = token.split('.');
      if (!payloadPart) {
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(this.toBase64(payloadPart), 'base64').toString('utf8'),
      ) as {
        sub?: string;
        aud?: string;
        exp?: number;
        email?: string;
        phone?: string;
        role?: string;
        app_metadata?: Record<string, unknown>;
        user_metadata?: Record<string, unknown>;
      };

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!payload.sub || !payload.exp || payload.exp <= nowSeconds) {
        return null;
      }

      return {
        id: payload.sub,
        aud: payload.aud || 'authenticated',
        role: payload.role || 'authenticated',
        email: payload.email,
        phone: payload.phone || '',
        app_metadata: payload.app_metadata || {},
        user_metadata: payload.user_metadata || {},
      };
    } catch {
      return null;
    }
  }

  private toBase64(base64Url: string): string {
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = base64.length % 4;
    return padding ? base64 + '='.repeat(4 - padding) : base64;
  }
}
