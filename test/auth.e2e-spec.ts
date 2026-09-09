import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { verify } from 'argon2';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { configureHttp } from './../src/common/http/configure-http.js';
import { DatabaseService } from './../src/database/database.service.js';
import { users } from './../src/database/schema.js';
import { UserService } from './../src/user/user.service.js';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  const credentials = {
    name: '  Alice  ',
    email: '  ALICE@Example.com  ',
    password: '  exact-password-123  ',
  };

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
  });

  afterEach(async () => {
    await app.close();
  });

  function register(body: object = credentials) {
    return request(app.getHttpServer())
      .post('/api/auth/register')
      .set('Origin', 'http://localhost:5173')
      .send(body);
  }

  function login(
    body: object = {
      email: 'alice@example.com',
      password: credentials.password,
    },
  ) {
    return request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Origin', 'http://localhost:5173')
      .send(body);
  }

  it('registers, logs in, and exposes only public user fields', async () => {
    const suppliedId = randomUUID();
    const registered = await register({
      ...credentials,
      id: suppliedId,
      passwordHash: 'untrusted-hash',
    }).expect(201);
    const user = registered.body.data;

    expect(registered.body).toEqual({
      data: {
        id: expect.stringMatching(
          /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
        ),
        name: 'Alice',
        email: 'alice@example.com',
      },
    });
    expect(user.id).not.toBe(suppliedId);

    const record = await app.get(UserService).findByEmail('alice@example.com');
    expect(record?.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verify(record!.passwordHash!, credentials.password),
    ).resolves.toBe(true);

    const session = await login({
      email: '  ALICE@EXAMPLE.COM  ',
      password: credentials.password,
    }).expect(200);
    expect(session.body).toEqual({
      data: {
        access_token: expect.any(String),
        token_type: 'Bearer',
        expires_in: 900,
      },
    });

    const payload = app.get(JwtService).verify(session.body.data.access_token);
    expect(payload.sub).toBe(user.id);
    expect(payload.sid).toEqual(expect.any(String));
    expect(payload.type).toBe('access');
    expect(payload.exp - payload.iat).toBe(900);

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .auth(session.body.data.access_token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: user });
      });
    await request(app.getHttpServer())
      .get(`/api/user/${user.id}`)
      .auth(session.body.data.access_token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: user });
      });

    await login({
      email: user.email,
      password: credentials.password.trim(),
    }).expect(401);
  });

  it('rejects concurrent registrations for the same normalized email', async () => {
    const responses = await Promise.all([
      register(),
      register({ ...credentials, email: 'alice@example.com' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    expect(responses.find((response) => response.status === 409)?.body).toEqual(
      {
        error: {
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'Email already registered',
        },
      },
    );
    expect(await app.get(UserService).findAll()).toHaveLength(1);
    await register().expect(409);
  });

  it('rejects registration for a normalized email already present in the database', async () => {
    const existing = await app
      .get(UserService)
      .create(
        { name: 'Alice', email: '  ALICE@example.com  ' },
        'stored-password-hash',
      );

    const response = await register().expect(409);
    expect(response.body).toEqual({
      error: {
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'Email already registered',
      },
    });
    expect(await app.get(UserService).findAll()).toEqual([existing]);
  });

  it('uses the same unauthorized response for every invalid credential case', async () => {
    await register().expect(201);

    const bodies = [
      { email: 'alice@example.com', password: 'wrong-password' },
      { email: 'unknown@example.com', password: credentials.password },
    ];
    const responses = await Promise.all(
      bodies.map((body) => login(body).expect(401)),
    );

    expect(responses[0].body).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      },
    });
    expect(responses[1].body).toEqual(responses[0].body);
    for (const response of responses) {
      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it.each([
    ['missing fields', {}],
    ['blank name', { ...credentials, name: '   ' }],
    ['invalid email', { ...credentials, email: 'invalid' }],
    ['missing password', { name: 'Alice', email: 'alice@example.com' }],
    ['non-string password', { ...credentials, password: 12345678 }],
    ['short password', { ...credentials, password: 'a'.repeat(7) }],
    ['long password', { ...credentials, password: 'a'.repeat(129) }],
  ])('rejects registration with %s without storing a user', async (_, body) => {
    await register(body).expect(400);
    expect(await app.get(UserService).findAll()).toEqual([]);
  });

  it('keeps the home, registration, and login routes public even with an invalid bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api')
      .auth('invalid-token', { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: 'Hello World!' });
      });
    await register().auth('invalid-token', { type: 'bearer' }).expect(201);
    await login().auth('invalid-token', { type: 'bearer' }).expect(200);
  });

  it.each([8, 128])('accepts a %i-character password', async (length) => {
    const password = 'a'.repeat(length);
    await register({ ...credentials, password }).expect(201);
    await login({ email: 'alice@example.com', password }).expect(200);
  });

  it('rejects missing, forged, expired, or invalid access tokens', async () => {
    const registered = await register().expect(201);
    const session = await login().expect(200);
    const jwt = app.get(JwtService);
    const signerWithoutExpiry = new JwtService({
      secret: process.env.JWT_SECRET,
      signOptions: {
        algorithm: 'HS256',
        issuer: 'nest-agent',
        audience: 'nest-agent-api',
      },
    });
    const claims = {
      sub: registered.body.data.id,
      sid: jwt.verify(session.body.data.access_token).sid,
      type: 'access',
    };
    const invalidTokens = [
      'not-a-jwt',
      jwt.sign(claims, { expiresIn: 900, secret: 'another-test-secret' }),
      jwt.sign(claims, { expiresIn: -1 }),
      jwt.sign(claims, { expiresIn: 900, algorithm: 'HS384' }),
      jwt.sign(claims, { expiresIn: 900, issuer: 'another-issuer' }),
      jwt.sign(claims, { expiresIn: 900, audience: 'another-audience' }),
      jwt.sign({ ...claims, type: 'refresh' }, { expiresIn: 900 }),
      jwt.sign({ ...claims, sub: 'invalid-id' }, { expiresIn: 900 }),
      jwt.sign({ ...claims, sub: randomUUID() }, { expiresIn: 900 }),
      jwt.sign({ sid: claims.sid, type: 'access' }, { expiresIn: 900 }),
      jwt.sign({ sub: claims.sub, sid: claims.sid }, { expiresIn: 900 }),
      jwt.sign({ sub: claims.sub, type: 'access' }, { expiresIn: 900 }),
      jwt.sign(claims, { expiresIn: 900, noTimestamp: true }),
      signerWithoutExpiry.sign(claims),
    ];

    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Basic ${jwt.sign(claims, { expiresIn: 900 })}`)
      .expect(401);
    for (const token of invalidTokens) {
      const response = await request(app.getHttpServer())
        .get('/api/auth/me')
        .auth(token, { type: 'bearer' })
        .expect(401);
      expect(response.body).toEqual({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Unauthorized',
        },
      });
    }
  });

  it('preserves accounts and unexpired access tokens after app recreation', async () => {
    const original = await register().expect(201);
    const oldSession = await login().expect(200);

    await app.close();
    app = await createApp();

    await request(app.getHttpServer())
      .get('/api/auth/me')
      .auth(oldSession.body.data.access_token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: original.body.data });
      });
    await login().expect(200);
    await register().expect(409);
    expect(await app.get(UserService).findAll()).toEqual([original.body.data]);
  });

  it('rejects a deleted user token even after the same email registers again', async () => {
    const original = await register().expect(201);
    const oldSession = await login().expect(200);

    await app
      .get(DatabaseService)
      .db.delete(users)
      .where(eq(users.id, original.body.data.id));
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .auth(oldSession.body.data.access_token, { type: 'bearer' })
      .expect(401);

    const replacement = await register().expect(201);
    expect(replacement.body.data.id).not.toBe(original.body.data.id);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .auth(oldSession.body.data.access_token, { type: 'bearer' })
      .expect(401);

    const newSession = await login().expect(200);
    await request(app.getHttpServer())
      .get('/api/auth/me')
      .auth(newSession.body.data.access_token, { type: 'bearer' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ data: replacement.body.data });
      });
  });
});
