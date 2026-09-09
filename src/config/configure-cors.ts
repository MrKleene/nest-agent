import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from './env.schema.js';

export function configureCors(app: INestApplication): void {
  const config = app.get<ConfigService<EnvironmentVariables>>(ConfigService);
  app.enableCors({
    origin: [config.getOrThrow('CLIENT_ORIGIN', { infer: true })],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Request-Id'],
  });
}
