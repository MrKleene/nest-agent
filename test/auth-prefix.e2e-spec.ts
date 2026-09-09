import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { REFRESH_COOKIE_NAME } from '../src/auth/auth-cookie.service.js';
import { configureHttp } from '../src/common/http/configure-http.js';
import { envSchema } from '../src/config/env.schema.js';
import { DatabaseService } from '../src/database/database.service.js';
import { users } from '../src/database/schema.js';

describe('Auth Cookie path follows API_PREFIX', () => {
  it.each([
    ['api', '/api/auth'],
    ['/internal/v2/', '/internal/v2/auth'],
    ['', '/auth'],
  ])(
    'supports prefix %j with an automatic cookie jar',
    async (prefix, path) => {
      const previousPrefix = process.env.API_PREFIX;
      let app: INestApplication | undefined;
      let userId: string | undefined;
      try {
        const module = await Test.createTestingModule({
          imports: [AppModule],
        }).compile();
        app = module.createNestApplication();
        // AppModule's forRoot metadata is evaluated once when imported. Override
        // the validated config per app before registering routes and cookies.
        app
          .get(ConfigService)
          .set('API_PREFIX', envSchema.shape.API_PREFIX.parse(prefix));
        configureHttp(app);
        await app.init();
        const client = request.agent(app.getHttpServer());
        const origin = 'http://localhost:5173';
        const credentials = {
          name: 'Prefix test',
          email: 'prefix@example.com',
          password: 'prefix-test-password',
        };
        const registered = await client
          .post(`${path}/register`)
          .set('Origin', origin)
          .send(credentials)
          .expect(201);
        userId = registered.body.data.id;
        const login = await client
          .post(`${path}/login`)
          .set('Origin', origin)
          .send({ email: credentials.email, password: credentials.password })
          .expect(200);
        const cookie = (response: request.Response): string => {
          const headers = response.headers['set-cookie'] as unknown as string[];
          return headers.find((value) =>
            value.startsWith(`${REFRESH_COOKIE_NAME}=`),
          )!;
        };
        expect(cookie(login)).toContain(`; Path=${path};`);
        // No manual Cookie header: the jar must apply the server's Path attribute.
        const refreshed = await client
          .post(`${path}/refresh`)
          .set('Origin', origin)
          .expect(200);
        expect(cookie(refreshed)).toContain(`; Path=${path};`);
        const rotatedCookie = cookie(refreshed).split(';')[0];
        expect(rotatedCookie).not.toBe(cookie(login).split(';')[0]);
        const logout = await client
          .post(`${path}/logout`)
          .set('Origin', origin)
          .expect(204);
        expect(cookie(logout)).toContain(`; Path=${path};`);
        expect(cookie(logout)).toContain('Expires=Thu, 01 Jan 1970');
        await client.post(`${path}/refresh`).set('Origin', origin).expect(401);
        // Replaying the last token also fails: logout revoked the server session.
        await request(app.getHttpServer())
          .post(`${path}/refresh`)
          .set('Origin', origin)
          .set('Cookie', rotatedCookie)
          .expect(401);
        await client
          .get(`${path}/me`)
          .auth(refreshed.body.data.access_token, { type: 'bearer' })
          .expect(401);
      } finally {
        try {
          if (app && userId)
            await app
              .get(DatabaseService)
              .db.delete(users)
              .where(eq(users.id, userId));
        } finally {
          try {
            if (app) await app.close();
          } finally {
            if (previousPrefix === undefined) delete process.env.API_PREFIX;
            else process.env.API_PREFIX = previousPrefix;
          }
        }
      }
    },
  );
});
