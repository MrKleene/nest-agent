import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { AuthSessionService } from './../src/auth/auth-session.service.js';
import { configureHttp } from './../src/common/http/configure-http.js';
import { DatabaseService } from './../src/database/database.service.js';
import { users } from './../src/database/schema.js';
import type { User } from './../src/user/interfaces/user.interface.js';
import { UserService } from './../src/user/user.service.js';

describe('User access (e2e)', () => {
  let app: INestApplication<App>;
  let currentUser: User;
  let accessToken: string;

  beforeEach(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureHttp(app);
    await app.init();
    await app.get(DatabaseService).db.delete(users);

    currentUser = await app
      .get(UserService)
      .create(
        { name: 'Alice', email: 'alice@example.com' },
        'stored-password-hash',
      );
    const session = await app.get(AuthSessionService).create(currentUser.id);
    accessToken = session.accessToken;
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns only the current user public profile and accepts uppercase UUIDs', async () => {
    for (const id of [currentUser.id, currentUser.id.toUpperCase()]) {
      await request(app.getHttpServer())
        .get(`/api/user/${id}`)
        .auth(accessToken, { type: 'bearer' })
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual(currentUser);
        });
    }
  });

  it('requires authentication before validating or looking up a user ID', async () => {
    for (const id of [currentUser.id, randomUUID(), 'invalid-id']) {
      await request(app.getHttpServer()).get(`/api/user/${id}`).expect(401);
    }
    await request(app.getHttpServer())
      .get(`/api/user/${currentUser.id}`)
      .auth('invalid-token', { type: 'bearer' })
      .expect(401);
  });

  it('returns the same forbidden response for another user and an unknown UUID', async () => {
    const anotherUser = await app
      .get(UserService)
      .create(
        { name: 'Bob', email: 'bob@example.com' },
        'another-stored-password-hash',
      );
    const responses = [];

    for (const id of [anotherUser.id, randomUUID()]) {
      const response = await request(app.getHttpServer())
        .get(`/api/user/${id}`)
        .auth(accessToken, { type: 'bearer' })
        .expect(403);
      expect(response.body.error).toEqual(
        expect.objectContaining({
          code: expect.any(String),
          message: expect.any(String),
        }),
      );
      responses.push(response.body.error);
    }

    expect(responses[0]).toEqual(responses[1]);
  });

  it.each(['abc', '1', '00000000-0000-4000-8000-00000000000g'])(
    'rejects malformed UUID %s after authentication',
    async (id) => {
      await request(app.getHttpServer())
        .get(`/api/user/${id}`)
        .auth(accessToken, { type: 'bearer' })
        .expect(400);
    },
  );

  it('does not expose user creation or list routes with or without authentication', async () => {
    for (const token of [undefined, accessToken]) {
      const list = request(app.getHttpServer()).get('/api/user');
      if (token) {
        list.auth(token, { type: 'bearer' });
      }
      await list.expect(404);

      const create = request(app.getHttpServer())
        .post('/api/user')
        .send({ name: 'Bob', email: 'bob@example.com' });
      if (token) {
        create.auth(token, { type: 'bearer' });
      }
      await create.expect(404);
    }

    expect(await app.get(UserService).findAll()).toEqual([currentUser]);
  });
});
