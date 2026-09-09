import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DrizzleQueryError } from 'drizzle-orm';
import { inspect } from 'node:util';
import { DatabaseService } from '../database/database.service.js';
import { AuthSessionService } from './auth-session.service.js';
import { parseRefreshToken } from './refresh-token.js';

describe('AuthSessionService security failures', () => {
  const userId = 'afe24a0b-567b-4a12-8424-fb9326085013';
  const sessionId = 'bf4cbec1-e7dc-47f8-998e-fc7a261487df';
  const refreshToken = `${sessionId}.${'s'.repeat(43)}`;
  const { tokenHash } = parseRefreshToken(refreshToken);
  const queryText = 'update auth_sessions set refresh_token_hash = $1';
  const databaseFailure = new DrizzleQueryError(queryText, [tokenHash]);
  const session = {
    userId,
    expiresAt: new Date(Date.now() + 3_600_000),
  };

  function createQueryMock() {
    return {
      values: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      catch: vi.fn((onRejected: (error: unknown) => never): Promise<unknown> =>
        Promise.reject(databaseFailure).catch(onRejected),
      ),
    };
  }

  let query: ReturnType<typeof createQueryMock>;
  let service: AuthSessionService;
  let database: {
    insert: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  const signAsync = vi.fn();

  beforeEach(async () => {
    query = createQueryMock();
    database = {
      insert: vi.fn().mockReturnValue(query),
      select: vi.fn().mockReturnValue(query),
      update: vi.fn().mockReturnValue(query),
    };
    signAsync.mockReset().mockResolvedValue('test-access-token');
    const module = await Test.createTestingModule({
      providers: [
        AuthSessionService,
        { provide: DatabaseService, useValue: { db: database } },
        { provide: JwtService, useValue: { signAsync } },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            AUTH_SESSION_TTL_SECONDS: 604800,
            JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
          }),
        },
      ],
    }).compile();
    service = module.get(AuthSessionService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['create', (target: AuthSessionService) => target.create(userId)],
    [
      'refresh lookup',
      (target: AuthSessionService) => target.refresh(refreshToken),
    ],
    [
      'refresh rotation',
      (target: AuthSessionService) => target.refresh(refreshToken),
    ],
    [
      'findUser',
      (target: AuthSessionService) => target.findUser(sessionId, userId),
    ],
    [
      'revoke',
      (target: AuthSessionService) => target.revoke(sessionId, userId),
    ],
    [
      'revokeWithRefresh',
      (target: AuthSessionService) => target.revokeWithRefresh(refreshToken),
    ],
  ])('sanitizes database failures during %s', async (operation, invoke) => {
    const logError = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    if (operation === 'refresh rotation') {
      query.catch.mockResolvedValueOnce([session]);
    }

    const error: unknown = await invoke(service).catch(
      (failure: unknown) => failure,
    );

    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as InternalServerErrorException).getResponse()).toEqual({
      message: 'Internal Server Error',
      statusCode: 500,
    });
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      'Failed to access authentication sessions in PostgreSQL',
    );
    const output = inspect([error, logError.mock.calls], { depth: 10 });
    expect(output).not.toContain(queryText);
    expect(output).not.toContain(tokenHash);
    expect(output).not.toContain(refreshToken);
  });

  it('leaves the current refresh token unconsumed when access signing fails', async () => {
    query.catch.mockResolvedValueOnce([session]);
    const signingFailure = new Error('Signing unavailable');
    signAsync.mockRejectedValueOnce(signingFailure);

    await expect(service.refresh(refreshToken)).rejects.toBe(signingFailure);

    expect(database.select).toHaveBeenCalledOnce();
    expect(signAsync).toHaveBeenCalledOnce();
    expect(database.update).not.toHaveBeenCalled();
  });
});
