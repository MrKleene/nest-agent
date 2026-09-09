import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { EnvironmentVariables } from '../config/env.schema.js';
import { DatabaseModule } from '../database/database.module.js';
import { UserModule } from '../user/user.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { OriginGuard } from './guards/origin.guard.js';
import { AuthCookieService } from './auth-cookie.service.js';
import { AuthSessionService } from './auth-session.service.js';

@Module({
  imports: [
    DatabaseModule,
    UserModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables>) => ({
        secret: configService.getOrThrow('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          expiresIn: configService.getOrThrow('JWT_ACCESS_TOKEN_TTL_SECONDS', {
            infer: true,
          }),
          issuer: 'nest-agent',
          audience: 'nest-agent-api',
        },
        verifyOptions: {
          algorithms: ['HS256'],
          issuer: 'nest-agent',
          audience: 'nest-agent-api',
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionService,
    AuthCookieService,
    OriginGuard,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
})
export class AuthModule {}
