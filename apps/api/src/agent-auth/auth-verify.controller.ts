import { Controller, Post, Body, Headers, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';

interface VerifyTokenRequest {
  token: string;
}

interface VerifyTokenResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    user_metadata?: any;
    app_metadata?: any;
  };
  error?: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthVerifyController {
  @Post('verify-token')
  @ApiOperation({
    summary: 'Verify JWT token for internal services',
    description: 'Internal API for Python service to verify user authentication tokens',
  })
  @ApiHeader({
    name: 'X-Internal-API-Key',
    description: 'Internal API key for service-to-service authentication',
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Token verification result',
  })
  async verifyToken(
    @Body() body: VerifyTokenRequest,
    @Headers('x-internal-api-key') apiKey: string,
  ): Promise<VerifyTokenResponse> {
    const expectedApiKey = process.env.INTERNAL_API_KEY;
    if (expectedApiKey && apiKey !== expectedApiKey) {
      throw new HttpException('Unauthorized internal API access', HttpStatus.UNAUTHORIZED);
    }

    const user = this.buildUserFromToken(body.token);
    if (!user) {
      return {
        success: false,
        error: 'Token is required',
      };
    }

    return {
      success: true,
      user,
    };
  }

  @Post('verify-token-simple')
  @ApiOperation({
    summary: 'Simple token verification (returns only user ID)',
    description: 'Lightweight verification for high-frequency calls',
  })
  @ApiHeader({
    name: 'X-Internal-API-Key',
    description: 'Internal API key for service-to-service authentication',
    required: true,
  })
  async verifyTokenSimple(
    @Body() body: VerifyTokenRequest,
    @Headers('x-internal-api-key') apiKey: string,
  ): Promise<{ success: boolean; user_id?: string; error?: string }> {
    const expectedApiKey = process.env.INTERNAL_API_KEY;
    if (expectedApiKey && apiKey !== expectedApiKey) {
      throw new HttpException('Unauthorized internal API access', HttpStatus.UNAUTHORIZED);
    }

    const user = this.buildUserFromToken(body.token);
    if (!user) {
      return {
        success: false,
        error: 'Token is required',
      };
    }

    return {
      success: true,
      user_id: user.id,
    };
  }

  private buildUserFromToken(token?: string) {
    if (!token) {
      return null;
    }

    const fromJwt = this.tryDecodeJwtUser(token);
    if (fromJwt) return fromJwt;

    return {
      id: process.env.NOLANX_LOCAL_USER_ID || 'local-dev-user',
      email: process.env.NOLANX_LOCAL_USER_EMAIL || 'local@nolanx.dev',
      user_metadata: {
        name: 'Local NolanX Developer',
      },
      app_metadata: {},
    };
  }

  private tryDecodeJwtUser(token: string) {
    try {
      const [, payloadPart] = token.split('.');
      if (!payloadPart) return null;

      const payload = JSON.parse(
        Buffer.from(payloadPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
      ) as {
        sub?: string;
        exp?: number;
        email?: string;
        user_metadata?: Record<string, unknown>;
        app_metadata?: Record<string, unknown>;
      };

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!payload.sub || !payload.exp || payload.exp <= nowSeconds) {
        return null;
      }

      return {
        id: payload.sub,
        email: payload.email || 'local@nolanx.dev',
        user_metadata: payload.user_metadata || {},
        app_metadata: payload.app_metadata || {},
      };
    } catch {
      return null;
    }
  }
}
