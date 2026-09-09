import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttp } from './common/http/configure-http.js';
import type { EnvironmentVariables } from './config/env.schema.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  configureHttp(app);
  app.setGlobalPrefix('api');
  const configService =
    app.get<ConfigService<EnvironmentVariables>>(ConfigService);
  await app.listen(configService.getOrThrow('PORT', { infer: true }));
}
await bootstrap();
