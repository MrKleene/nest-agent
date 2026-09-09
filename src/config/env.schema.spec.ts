import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { envSchema } from './env.schema.js';
import type { EnvironmentVariables } from './env.schema.js';

describe('Environment configuration', () => {
  let moduleRef: TestingModule | undefined;
  const jwtSecret = 'test-only-jwt-secret-with-at-least-32-characters';

  beforeEach(() => {
    moduleRef = undefined;
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('PORT', undefined);
    vi.stubEnv('JWT_SECRET', jwtSecret);
    vi.stubEnv('JWT_ACCESS_TOKEN_TTL_SECONDS', undefined);
    vi.stubEnv('AUTH_SESSION_TTL_SECONDS', undefined);
    vi.stubEnv('CLIENT_ORIGIN', undefined);
    vi.stubEnv(
      'DATABASE_URL',
      'postgresql://test:test@127.0.0.1:5432/nest_agent_config_test',
    );
  });

  afterEach(async () => {
    try {
      await moduleRef?.close();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  async function loadConfig() {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema: envSchema,
        }),
      ],
    }).compile();

    return moduleRef.get<ConfigService<EnvironmentVariables, true>>(
      ConfigService,
    );
  }

  it('provides validated defaults while accepting unrelated environment variables', async () => {
    vi.stubEnv('CONFIG_TEST_UNRELATED', 'allowed');

    const config = await loadConfig();
    const port = config.get('PORT', { infer: true });
    const tokenTtl = config.get('JWT_ACCESS_TOKEN_TTL_SECONDS', {
      infer: true,
    });

    expectTypeOf(port).toEqualTypeOf<number>();
    expectTypeOf(tokenTtl).toEqualTypeOf<number>();
    expect(port).toBe(3000);
    expect(tokenTtl).toBe(900);
    expect(config.get('AUTH_SESSION_TTL_SECONDS', { infer: true })).toBe(
      604800,
    );
    expect(config.get('CLIENT_ORIGIN', { infer: true })).toBe(
      'http://localhost:5173',
    );
    expect(config.get('JWT_SECRET', { infer: true })).toBe(jwtSecret);
    expect(config.get('NODE_ENV', { infer: true })).toBe('development');
    expect(process.env.CONFIG_TEST_UNRELATED).toBe('allowed');
  });

  it.each(['postgresql', 'postgres'])(
    'accepts a DATABASE_URL with the %s protocol',
    async (protocol) => {
      const databaseUrl = `${protocol}://test:test@127.0.0.1:5432/nest_agent_config_test`;
      vi.stubEnv('DATABASE_URL', databaseUrl);

      const config = await loadConfig();

      expect(config.get('DATABASE_URL', { infer: true })).toBe(databaseUrl);
    },
  );

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['non-URL', 'not-a-url'],
    ['HTTP protocol', 'http://127.0.0.1:5432/nest_agent_config_test'],
  ])(
    'prevents module startup for a %s DATABASE_URL',
    async (_, databaseUrl) => {
      vi.stubEnv('DATABASE_URL', databaseUrl);

      await expect(loadConfig()).rejects.toThrow(
        /Config validation error:.*DATABASE_URL/s,
      );
    },
  );

  it('trims JWT_SECRET before exposing it through ConfigService', async () => {
    vi.stubEnv('JWT_SECRET', `  ${jwtSecret}  `);

    const config = await loadConfig();

    expect(config.get('JWT_SECRET', { infer: true })).toBe(jwtSecret);
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
    ['short', 'x'.repeat(31)],
    ['short after trimming', `  ${'x'.repeat(31)}  `],
  ])('prevents module startup for a %s JWT_SECRET', async (_, secret) => {
    vi.stubEnv('JWT_SECRET', secret);

    await expect(loadConfig()).rejects.toThrow(
      /Config validation error:.*JWT_SECRET/s,
    );
  });

  it('accepts a JWT_SECRET at the minimum length', async () => {
    const secret = 'x'.repeat(32);
    vi.stubEnv('JWT_SECRET', secret);

    const config = await loadConfig();

    expect(config.get('JWT_SECRET', { infer: true })).toBe(secret);
  });

  it.each(['1', '300', '900'])(
    'exposes JWT_ACCESS_TOKEN_TTL_SECONDS=%s as a number',
    async (ttl) => {
      vi.stubEnv('JWT_ACCESS_TOKEN_TTL_SECONDS', ttl);

      const config = await loadConfig();
      const tokenTtl = config.get('JWT_ACCESS_TOKEN_TTL_SECONDS', {
        infer: true,
      });

      expectTypeOf(tokenTtl).toEqualTypeOf<number>();
      expect(tokenTtl).toBe(Number(ttl));
      expect(process.env.JWT_ACCESS_TOKEN_TTL_SECONDS).toBe(ttl);
    },
  );

  it.each(['', '   ', 'invalid', '1.5', '0', '-1', '901', 'Infinity', 'NaN'])(
    'prevents module startup for invalid JWT_ACCESS_TOKEN_TTL_SECONDS=%j',
    async (ttl) => {
      vi.stubEnv('JWT_ACCESS_TOKEN_TTL_SECONDS', ttl);

      await expect(loadConfig()).rejects.toThrow(
        /Config validation error:.*JWT_ACCESS_TOKEN_TTL_SECONDS/s,
      );
    },
  );

  it('allows a shorter fixed session lifetime', async () => {
    vi.stubEnv('AUTH_SESSION_TTL_SECONDS', '86400');

    const config = await loadConfig();

    expect(config.get('AUTH_SESSION_TTL_SECONDS', { infer: true })).toBe(86400);
  });

  it.each(['', 'invalid', '0', '-1', '1.5', '604801'])(
    'prevents module startup for invalid AUTH_SESSION_TTL_SECONDS=%j',
    async (ttl) => {
      vi.stubEnv('AUTH_SESSION_TTL_SECONDS', ttl);

      await expect(loadConfig()).rejects.toThrow(
        /Config validation error:.*AUTH_SESSION_TTL_SECONDS/s,
      );
    },
  );

  it.each(['http://localhost:3001', 'https://app.example.com'])(
    'accepts the exact CLIENT_ORIGIN=%s',
    async (origin) => {
      vi.stubEnv('CLIENT_ORIGIN', origin);

      const config = await loadConfig();

      expect(config.get('CLIENT_ORIGIN', { infer: true })).toBe(origin);
    },
  );

  it.each([
    '*',
    'null',
    'ftp://localhost',
    'http://localhost:5173/',
    'http://localhost:5173/path',
    'https://user:password@app.example.com',
    'https://app.example.com?query=1',
  ])('prevents module startup for invalid CLIENT_ORIGIN=%j', async (origin) => {
    vi.stubEnv('CLIENT_ORIGIN', origin);

    await expect(loadConfig()).rejects.toThrow(
      /Invalid URL|Config validation error:.*CLIENT_ORIGIN/s,
    );
  });

  it.each(['development', 'test', 'production'])(
    'accepts NODE_ENV=%s',
    async (environment) => {
      vi.stubEnv('NODE_ENV', environment);

      const config = await loadConfig();

      expect(config.get('NODE_ENV', { infer: true })).toBe(environment);
    },
  );

  it.each(['1', '4000', '65535'])(
    'exposes PORT=%s as a number through ConfigService',
    async (port) => {
      vi.stubEnv('PORT', port);

      const config = await loadConfig();

      expect(config.get('PORT', { infer: true })).toBe(Number(port));
      expect(process.env.PORT).toBe(port);
    },
  );

  it.each(['', '   ', 'invalid', '1.5', '0', '-1', '65536', 'Infinity'])(
    'prevents module startup for invalid PORT=%j',
    async (port) => {
      vi.stubEnv('PORT', port);

      await expect(loadConfig()).rejects.toThrow(
        /Config validation error:.*PORT/s,
      );
    },
  );

  it.each(['', 'staging', 'Production'])(
    'prevents module startup for invalid NODE_ENV=%j',
    async (environment) => {
      vi.stubEnv('NODE_ENV', environment);

      await expect(loadConfig()).rejects.toThrow(
        /Config validation error:.*NODE_ENV/s,
      );
    },
  );
});
