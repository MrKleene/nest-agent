import { createHash, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureHttp } from './../src/common/http/configure-http.js';
import { DatabaseService } from './../src/database/database.service.js';
import { authSessions, users } from './../src/database/schema.js';
import type { User } from './../src/user/interfaces/user.interface.js';
import { UserService } from './../src/user/user.service.js';

const origin = 'http://localhost:5173';
const cookieName = 'nest_agent_refresh';
const credentials = {
  name: 'Alice',
  email: 'alice@example.com',
  password: 'session-test-password',
};

function setCookieHeader(response: request.Response): string {
  const cookies = response.headers['set-cookie'] as unknown as string[];
  const cookie = cookies?.find((value) => value.startsWith(`${cookieName}=`));
  expect(cookie).toBeDefined();
  return cookie!;
}

function cookiePair(response: request.Response): string {
  return setCookieHeader(response).split(';')[0];
}

describe('Auth sessions (e2e)', () => {
  let app: INestApplication<App>;
  let user: User;
  let sessionId: string;
  let accessToken: string;
  let refreshCookie: string;
  let loginResponse: request.Response;

  async function createApp() {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const application = moduleFixture.createNestApplication();
    configureHttp(application);
    await application.init();
    return application;
  }

  beforeEach(async () => {
    app = await createApp();
    await app.get(DatabaseService).db.delete(users);
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .set('Origin', origin)
      .send(credentials)
      .expect(201);
    user = registered.body.data;
    loginResponse = await login().expect(200);
    accessToken = loginResponse.body.data.access_token;
    refreshCookie = cookiePair(loginResponse);
    sessionId = app.get(JwtService).verify(accessToken).sid;
  });

  afterEach(async () => {
    await app.close();
  });

  function login() {
    return request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', origin)
      .send({ email: credentials.email, password: credentials.password });
  }

  function refresh(cookie = refreshCookie) {
    return request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', cookie);
  }

  function logout(cookie?: string, token?: string) {
    const operation = request(app.getHttpServer())
      .post('/auth/logout')
      .set('Origin', origin);
    if (cookie) operation.set('Cookie', cookie);
    if (token) operation.auth(token, { type: 'bearer' });
    return operation;
  }

  function me(token = accessToken) {
    return request(app.getHttpServer())
      .get('/auth/me')
      .auth(token, { type: 'bearer' });
  }

  async function storedSession() {
    const [session] = await app
      .get(DatabaseService)
      .db.select()
      .from(authSessions)
      .where(eq(authSessions.id, sessionId));
    expect(session).toBeDefined();
    return session!;
  }

  async function withNodeEnv(
    environment: 'development' | 'test' | 'production',
    run: () => Promise<void>,
  ) {
    const config = app.get(ConfigService);
    const previous = config.getOrThrow<string>('NODE_ENV');
    const previousProcessEnv = process.env.NODE_ENV;
    try {
      config.set('NODE_ENV', environment);
      await run();
    } finally {
      config.set('NODE_ENV', previous);
      if (previousProcessEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousProcessEnv;
    }
  }

  it('stores a refresh hash and sets a scoped HttpOnly cookie with a fixed lifetime', async () => {
    expect(loginResponse.headers['cache-control']).toBe('no-store');
    const cookie = setCookieHeader(loginResponse);
    const token = refreshCookie.slice(`${cookieName}=`.length);
    const [sid, secret] = token.split('.');
    expect(sid).toBe(sessionId);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    expect(cookie).toMatch(/; Path=\/auth(?:;|$)/);
    expect(cookie).toMatch(/; HttpOnly(?:;|$)/);
    expect(cookie).toMatch(/; SameSite=Lax(?:;|$)/);
    expect(cookie).not.toMatch(/; Secure(?:;|$)/);
    expect(cookie).not.toMatch(/; Domain=/);
    expect(Number(cookie.match(/; Max-Age=(\d+)/)?.[1])).toBeGreaterThanOrEqual(
      604799,
    );
    expect(Number(cookie.match(/; Max-Age=(\d+)/)?.[1])).toBeLessThanOrEqual(
      604800,
    );
    expect(loginResponse.body).toEqual({
      data: {
        access_token: expect.any(String),
        token_type: 'Bearer',
        expires_in: 900,
      },
    });

    const session = await storedSession();
    expect(session.userId).toBe(user.id);
    expect(session.refreshTokenHash).not.toBe(token);
    expect(session.refreshTokenHash).not.toBe(secret);
    expect(session.refreshTokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(session.revokedAt).toBeNull();
    expect(
      session.expiresAt.getTime() - session.createdAt.getTime(),
    ).toBeCloseTo(604800000, -3);
  });

  it('sets Secure on production login and logout cookies without changing other configuration', async () => {
    const config = app.get(ConfigService);
    const getOrThrow = config.getOrThrow.bind(config);
    const configSpy = vi
      .spyOn(config, 'getOrThrow')
      .mockImplementation((key, ...options) =>
        key === 'NODE_ENV' ? 'production' : getOrThrow(key, ...options),
      );

    try {
      const productionLogin = await login().expect(200);
      expect(setCookieHeader(productionLogin)).toMatch(/; Secure(?:;|$)/);
      const productionLogout = await logout(
        cookiePair(productionLogin),
        productionLogin.body.data.access_token,
      ).expect(204);
      expect(setCookieHeader(productionLogout)).toMatch(/; Secure(?:;|$)/);
      expect(setCookieHeader(productionLogout)).toMatch(/; Path=\/auth(?:;|$)/);
    } finally {
      configSpy.mockRestore();
    }
  });

  it('rotates the refresh secret once without extending the session deadline', async () => {
    const previous = await storedSession();
    const refreshed = await refresh().expect(200);
    expect(refreshed.headers['cache-control']).toBe('no-store');
    const newCookie = cookiePair(refreshed);
    expect(newCookie).not.toBe(refreshCookie);
    expect(refreshed.body).toEqual({
      data: {
        access_token: expect.any(String),
        token_type: 'Bearer',
        expires_in: 900,
      },
    });

    const current = await storedSession();
    expect(current.refreshTokenHash).not.toBe(previous.refreshTokenHash);
    expect(current.expiresAt).toEqual(previous.expiresAt);
    const replay = await refresh().expect(401);
    expect(replay.headers['set-cookie']).toBeUndefined();
    await me(refreshed.body.data.access_token)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: user });
      });
    await refresh(newCookie).expect(200);
  });

  it('requires a valid refresh cookie even when valid Access is supplied', async () => {
    const missing = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', origin)
      .auth(accessToken, { type: 'bearer' })
      .expect(401);
    expect(missing.headers['set-cookie']).toBeUndefined();
    const malformed = await refresh(`${cookieName}=invalid-token`).expect(401);
    expect(malformed.headers['set-cookie']).toBeUndefined();
    await refresh().expect(200);
  });

  it('allows exactly one concurrent refresh and does not clear the winning cookie', async () => {
    const responses = await Promise.all([refresh(), refresh(), refresh()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401, 401,
    ]);
    const successful = responses.find((response) => response.status === 200)!;
    for (const failed of responses.filter(
      (response) => response.status === 401,
    )) {
      expect(failed.headers['set-cookie']).toBeUndefined();
    }
    await me(successful.body.data.access_token).expect(200);
    await refresh(cookiePair(successful)).expect(200);
  });

  it('caps refreshed Access and cookie lifetimes at the remaining session lifetime', async () => {
    const deadline = new Date(Date.now() + 30000);
    await app
      .get(DatabaseService)
      .db.update(authSessions)
      .set({ expiresAt: deadline })
      .where(eq(authSessions.id, sessionId));

    const refreshed = await refresh().expect(200);
    expect(refreshed.body.data.expires_in).toBeGreaterThan(0);
    expect(refreshed.body.data.expires_in).toBeLessThanOrEqual(30);
    const payload = app
      .get(JwtService)
      .verify(refreshed.body.data.access_token);
    expect(payload.exp).toBeLessThanOrEqual(
      Math.floor(deadline.getTime() / 1000),
    );
    expect(
      Number(setCookieHeader(refreshed).match(/; Max-Age=(\d+)/)?.[1]),
    ).toBeLessThanOrEqual(30);
    expect((await storedSession()).expiresAt).toEqual(deadline);
  });

  it.each(['cookie', 'access'])(
    'revokes the current session using %s and clears the same cookie path',
    async (credential) => {
      const response = await logout(
        credential === 'cookie' ? refreshCookie : undefined,
        credential === 'access' ? accessToken : undefined,
      ).expect(204);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).toBe('');
      const cleared = setCookieHeader(response);
      expect(cleared).toMatch(/^nest_agent_refresh=;/);
      expect(cleared).toMatch(/; Path=\/auth(?:;|$)/);
      expect(cleared).toMatch(/; HttpOnly(?:;|$)/);
      expect(cleared).toMatch(/; SameSite=Lax(?:;|$)/);
      expect(cleared).toMatch(/; Expires=Thu, 01 Jan 1970 00:00:00 GMT(?:;|$)/);
      expect((await storedSession()).revokedAt).toBeInstanceOf(Date);
      await me().expect(401);
      await refresh().expect(401);
      await logout().expect(204);
    },
  );

  it('uses the current refresh cookie to log out when Access has expired', async () => {
    const expiredAccess = app
      .get(JwtService)
      .sign(
        { sub: user.id, sid: sessionId, type: 'access' },
        { expiresIn: -1 },
      );
    await logout(undefined, expiredAccess).expect(401);
    await me().expect(200);
    await logout(refreshCookie, expiredAccess).expect(204);
    await me().expect(401);
    await refresh().expect(401);
  });

  it('refuses unprovable logout credentials without clearing or revoking the current session', async () => {
    const rotated = await refresh().expect(200);
    const rejected = await logout(refreshCookie).expect(401);
    expect(rejected.headers['set-cookie']).toBeUndefined();
    await logout(undefined, 'invalid-access-token').expect(401);
    await me(rotated.body.data.access_token).expect(200);
    await refresh(cookiePair(rotated)).expect(200);
  });

  it('uses valid Access to complete logout despite a concurrent refresh rotation', async () => {
    const [rotation, loggedOut] = await Promise.all([
      refresh(),
      logout(refreshCookie, accessToken),
    ]);
    expect(loggedOut.status).toBe(204);
    expect([200, 401]).toContain(rotation.status);
    await me().expect(401);
    await refresh().expect(401);
    if (rotation.status === 200) {
      await refresh(cookiePair(rotation)).expect(401);
    }
  });

  it('prioritizes a different cookie session and leaves the other login active', async () => {
    const secondLogin = await login().expect(200);
    const secondCookie = cookiePair(secondLogin);
    const secondAccess = secondLogin.body.data.access_token;
    expect(app.get(JwtService).verify(secondAccess).sid).not.toBe(sessionId);

    await logout(secondCookie, accessToken).expect(204);
    await me(secondAccess).expect(401);
    await refresh(secondCookie).expect(401);
    await me()
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: user });
      });
    await refresh().expect(200);
  });

  it('rejects Access for an absent session or a session owned by another user', async () => {
    const anotherUser = await app
      .get(UserService)
      .create(
        { name: 'Bob', email: 'bob@example.com' },
        'stored-password-hash',
      );
    for (const claims of [
      { sub: user.id, sid: randomUUID(), type: 'access' },
      { sub: anotherUser.id, sid: sessionId, type: 'access' },
    ]) {
      await me(app.get(JwtService).sign(claims)).expect(401);
    }
    await me().expect(200);
  });

  it.each(['expired', 'revoked'])(
    'rejects Access and refresh for an %s session',
    async (state) => {
      await app
        .get(DatabaseService)
        .db.update(authSessions)
        .set(
          state === 'expired'
            ? { expiresAt: new Date(Date.now() - 1000) }
            : { revokedAt: new Date() },
        )
        .where(eq(authSessions.id, sessionId));
      await me().expect(401);
      await refresh().expect(401);
    },
  );

  it('allows auth mutations without Origin in development while keeping Access authentication', async () => {
    await withNodeEnv('development', async () => {
      const localCredentials = {
        ...credentials,
        email: `local-${randomUUID()}@example.com`,
      };
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send(localCredentials)
        .expect(201);
      const loggedIn = await request(app.getHttpServer())
        .post('/auth/login')
        .send(localCredentials)
        .expect(200);
      const refreshed = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', cookiePair(loggedIn))
        .expect(200);

      await request(app.getHttpServer()).get('/auth/me').expect(401);
      await me(refreshed.body.data.access_token)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual({ data: registered.body.data });
        });
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', cookiePair(refreshed))
        .expect(204);
      await me(refreshed.body.data.access_token).expect(401);
    });
  });

  it.each(['development', 'test', 'production'] as const)(
    'rejects disallowed Origins on every auth mutation without side effects in %s',
    async (environment) => {
      await withNodeEnv(environment, async () => {
        const db = app.get(DatabaseService).db;
        const sessionsBefore = await db.select().from(authSessions);
        const disallowedOrigins: (string | undefined)[] = [
          '',
          'null',
          'http://localhost:5173.evil.example',
          `${origin}/`,
        ];
        if (environment !== 'development') disallowedOrigins.push(undefined);

        for (const path of ['register', 'login', 'refresh', 'logout']) {
          for (const requestOrigin of disallowedOrigins) {
            const operation = request(app.getHttpServer())
              .post(`/auth/${path}`)
              .set('Cookie', refreshCookie)
              .send(credentials);
            if (requestOrigin !== undefined) {
              operation.set('Origin', requestOrigin);
            }
            const response = await operation.expect(403);
            expect(response.body).toEqual({
              error: {
                code: 'ORIGIN_NOT_ALLOWED',
                message: 'Origin not allowed',
              },
            });
            expect(response.headers['x-request-id']).toMatch(
              /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
          }
        }
        expect(await app.get(UserService).findAll()).toEqual([user]);
        expect(await db.select().from(authSessions)).toEqual(sessionsBefore);
        await me().expect(200);
        await refresh().expect(200);
      });
    },
  );

  it('allows credentialed CORS only for the configured client origin in development', async () => {
    await app.close();
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();

    await withNodeEnv('development', async () => {
      configureHttp(app);
      await app.init();
      await request(app.getHttpServer())
        .options('/auth/refresh')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .expect(204)
        .expect('Access-Control-Allow-Origin', origin)
        .expect('Access-Control-Allow-Credentials', 'true');
      const denied = await request(app.getHttpServer())
        .options('/auth/refresh')
        .set('Origin', 'https://other.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  it('keeps the refresh session usable after the application restarts', async () => {
    const previous = await storedSession();
    await app.close();
    app = await createApp();

    await me()
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: user });
      });
    const refreshed = await refresh().expect(200);
    await me(refreshed.body.data.access_token)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: user });
      });
    expect((await storedSession()).expiresAt).toEqual(previous.expiresAt);
  });
});
