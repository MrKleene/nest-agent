import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.schema.js';
import { configureCors } from '../../config/configure-cors.js';
import { HttpContextMiddleware } from '../middleware/http-context.middleware.js';

export function configureHttp(app: INestApplication): void {
  const config = app.get<ConfigService<EnvironmentVariables>>(ConfigService);
  const prefix = config.getOrThrow('API_PREFIX', { infer: true });
  app.setGlobalPrefix(prefix ? `/${prefix}` : '');
  const middleware = app.get(HttpContextMiddleware);
  // Run before CORS preflight and the body parser registered by app.init().
  app.use(middleware.use.bind(middleware));
  configureCors(app);
}
