import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { API_ERRORS } from '../../common/http/api-errors.js';
import type { EnvironmentVariables } from '../../config/env.schema.js';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService<EnvironmentVariables>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    if (
      request.headers.origin !==
      this.config.getOrThrow('CLIENT_ORIGIN', { infer: true })
    ) {
      const { code, message } = API_ERRORS.ORIGIN_NOT_ALLOWED;
      throw new ForbiddenException(message, { errorCode: code });
    }
    return true;
  }
}
