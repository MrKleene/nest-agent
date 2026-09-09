import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';
import type { EnvironmentVariables } from '../config/env.schema.js';
import type { SessionTokens } from './interfaces/session-tokens.interface.js';

export const REFRESH_COOKIE_NAME = 'nest_agent_refresh';

@Injectable()
export class AuthCookieService {
  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  read(request: Request): string | undefined {
    return parseCookie(request.headers.cookie ?? '')[REFRESH_COOKIE_NAME];
  }

  write(response: Response, tokens: SessionTokens): void {
    response.setHeader('Cache-Control', 'no-store');
    response.cookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
      ...this.options(),
      maxAge: Math.max(0, tokens.expiresAt.getTime() - Date.now()),
    });
  }

  clear(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
    response.clearCookie(REFRESH_COOKIE_NAME, this.options());
  }

  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure:
        this.config.getOrThrow('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: `/${[this.config.getOrThrow('API_PREFIX', { infer: true }), 'auth']
        .filter(Boolean)
        .join('/')}`,
    };
  }
}
