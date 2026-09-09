import type { INestApplication } from '@nestjs/common';
import { configureCors } from '../../config/configure-cors.js';
import { HttpContextMiddleware } from '../middleware/http-context.middleware.js';

export function configureHttp(app: INestApplication): void {
  const middleware = app.get(HttpContextMiddleware);
  // Run before CORS preflight and the body parser registered by app.init().
  app.use(middleware.use.bind(middleware));
  configureCors(app);
}
