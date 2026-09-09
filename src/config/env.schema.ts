import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_SECRET: z.string().trim().min(32),
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(900)
    .default(900),
  AUTH_SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(604800)
    .default(604800),
  CLIENT_ORIGIN: z
    .url({ protocol: /^https?$/ })
    .refine((value) => URL.parse(value)?.origin === value, {
      message: 'CLIENT_ORIGIN must contain only scheme, host and port',
    })
    .default('http://localhost:5173'),
});

export type EnvironmentVariables = z.infer<typeof envSchema>;
