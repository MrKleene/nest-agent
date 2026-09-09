import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import {
  REDIRECT_METADATA,
  RENDER_METADATA,
  SSE_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator.js';
import type { ApiResponse } from '../http/api-response.interface.js';
import { getRequestId } from '../http/request-context.js';

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const handler = context.getHandler();
    if (
      this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
        handler,
        context.getClass(),
      ]) ||
      this.reflector.get(SSE_METADATA, handler) ||
      this.reflector.get(REDIRECT_METADATA, handler) ||
      this.reflector.get(RENDER_METADATA, handler)
    ) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        if (
          request.method === 'HEAD' ||
          [204, 205, 304].includes(response.statusCode)
        ) {
          return undefined;
        }
        if (response.headersSent || data instanceof StreamableFile) return data;
        const contentType = String(response.getHeader('Content-Type') ?? '')
          .split(';')[0]
          .trim()
          .toLowerCase();
        if (
          contentType &&
          contentType !== 'application/json' &&
          !contentType.endsWith('+json')
        ) {
          return data;
        }
        return {
          data: data ?? null,
          meta: { requestId: getRequestId(request, response) },
        } satisfies ApiResponse<unknown>;
      }),
    );
  }
}
