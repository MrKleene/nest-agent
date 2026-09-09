import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { EnvironmentVariables } from '../config/env.schema.js';
import { DatabaseService } from '../database/database.service.js';
import { authSessions, users } from '../database/schema.js';
import type { User } from '../user/interfaces/user.interface.js';
import type { SessionTokens } from './interfaces/session-tokens.interface.js';
import { parseRefreshToken } from './refresh-token.js';

@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<EnvironmentVariables>,
  ) {}

  async create(userId: string): Promise<SessionTokens> {
    const sessionId = randomUUID();
    const expiresAt = new Date(
      Date.now() +
        this.configService.getOrThrow('AUTH_SESSION_TTL_SECONDS', {
          infer: true,
        }) *
          1000,
    );
    const tokens = await this.issueTokens(userId, sessionId, expiresAt);

    await this.databaseService.db
      .insert(authSessions)
      .values({
        id: sessionId,
        userId,
        refreshTokenHash: parseRefreshToken(tokens.refreshToken).tokenHash,
        expiresAt,
      })
      .catch(() => this.databaseError());

    return tokens;
  }

  async refresh(token: string): Promise<SessionTokens> {
    const { sessionId, tokenHash } = parseRefreshToken(token);
    const validSession = and(
      eq(authSessions.id, sessionId),
      eq(authSessions.refreshTokenHash, tokenHash),
      isNull(authSessions.revokedAt),
      gt(authSessions.expiresAt, sql`now()`),
    );
    const [session] = await this.databaseService.db
      .select({
        userId: authSessions.userId,
        expiresAt: authSessions.expiresAt,
      })
      .from(authSessions)
      .where(validSession)
      .limit(1)
      .catch(() => this.databaseError());

    if (!session) {
      throw new UnauthorizedException();
    }

    // Sign before replacing the hash so signing failures leave the old token usable.
    const tokens = await this.issueTokens(
      session.userId,
      sessionId,
      session.expiresAt,
    );
    const [rotated] = await this.databaseService.db
      .update(authSessions)
      .set({
        refreshTokenHash: parseRefreshToken(tokens.refreshToken).tokenHash,
      })
      .where(validSession)
      .returning({ id: authSessions.id })
      .catch(() => this.databaseError());

    if (!rotated) {
      throw new UnauthorizedException();
    }

    return tokens;
  }

  async findUser(sessionId: string, userId: string): Promise<User | undefined> {
    const [user] = await this.databaseService.db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(authSessions)
      .innerJoin(users, eq(users.id, authSessions.userId))
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          gt(authSessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1)
      .catch(() => this.databaseError());

    return user;
  }

  async revoke(sessionId: string, userId: string): Promise<void> {
    await this.databaseService.db
      .update(authSessions)
      .set({ revokedAt: sql`coalesce(${authSessions.revokedAt}, now())` })
      .where(
        and(eq(authSessions.id, sessionId), eq(authSessions.userId, userId)),
      )
      .catch(() => this.databaseError());
  }

  async revokeWithRefresh(token: string): Promise<void> {
    const { sessionId, tokenHash } = parseRefreshToken(token);
    const [revoked] = await this.databaseService.db
      .update(authSessions)
      .set({ revokedAt: sql`coalesce(${authSessions.revokedAt}, now())` })
      .where(
        and(
          eq(authSessions.id, sessionId),
          eq(authSessions.refreshTokenHash, tokenHash),
        ),
      )
      .returning({ id: authSessions.id })
      .catch(() => this.databaseError());

    if (!revoked) {
      throw new UnauthorizedException();
    }
  }

  private async issueTokens(
    userId: string,
    sessionId: string,
    expiresAt: Date,
  ): Promise<SessionTokens> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresIn = Math.min(
      this.configService.getOrThrow('JWT_ACCESS_TOKEN_TTL_SECONDS', {
        infer: true,
      }),
      Math.floor(expiresAt.getTime() / 1000) - issuedAt,
    );

    if (expiresIn <= 0) {
      throw new UnauthorizedException();
    }

    return {
      accessToken: await this.jwtService.signAsync(
        { sub: userId, sid: sessionId, type: 'access', iat: issuedAt },
        { expiresIn },
      ),
      expiresIn,
      refreshToken: `${sessionId}.${randomBytes(32).toString('base64url')}`,
      expiresAt,
    };
  }

  private databaseError(): never {
    // Drizzle errors include SQL parameters, including credential hashes.
    this.logger.error('Failed to access authentication sessions in PostgreSQL');
    throw new InternalServerErrorException();
  }
}
