import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { User } from '../user/interfaces/user.interface.js';
import { UserService } from '../user/user.service.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import {
  accessTokenSchema,
  extractBearerToken,
  type AccessTokenPayload,
} from './access-token.js';
import { AuthSessionService } from './auth-session.service.js';
import type { SessionTokens } from './interfaces/session-tokens.interface.js';
import { parseRefreshToken } from './refresh-token.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async register(registerDto: RegisterDto): Promise<User> {
    const passwordHash = await argon2.hash(registerDto.password, {
      type: argon2.argon2id,
    });
    return this.userService.create(registerDto, passwordHash);
  }

  async login(loginDto: LoginDto): Promise<SessionTokens> {
    const user = await this.userService.findByEmail(loginDto.email);
    if (
      !user?.passwordHash ||
      !(await argon2.verify(user.passwordHash, loginDto.password))
    ) {
      throw new UnauthorizedException();
    }

    return this.authSessionService.create(user.id);
  }

  refresh(refreshToken: string): Promise<SessionTokens> {
    return this.authSessionService.refresh(refreshToken);
  }

  async logout(
    authorization: string | undefined,
    refreshToken: string | undefined,
  ): Promise<void> {
    const identity = await this.accessIdentity(authorization);
    if (refreshToken) {
      const { sessionId } = parseRefreshToken(refreshToken);
      // Signed access identity can revoke the session even if refresh just rotated.
      if (identity?.sid === sessionId) {
        return this.authSessionService.revoke(identity.sid, identity.sub);
      }
      // A different cookie session must be authenticated using its own secret.
      return this.authSessionService.revokeWithRefresh(refreshToken);
    }
    if (identity) {
      return this.authSessionService.revoke(identity.sid, identity.sub);
    }
    if (authorization) throw new UnauthorizedException();
  }

  private async accessIdentity(
    authorization: string | undefined,
  ): Promise<AccessTokenPayload | undefined> {
    const token = extractBearerToken(authorization);
    if (!token) return undefined;
    try {
      const result = accessTokenSchema.safeParse(
        await this.jwtService.verifyAsync(token),
      );
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  }
}
