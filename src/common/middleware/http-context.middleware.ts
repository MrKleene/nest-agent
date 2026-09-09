import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestId, getRequestPath } from '../http/request-context.js';

@Injectable()
export class HttpContextMiddleware implements NestMiddleware {
  private readonly logger = new Logger(HttpContextMiddleware.name);

  use(request: Request, response: Response, next: NextFunction): void {
    const requestId = getRequestId(request, response);
    const startedAt = performance.now();
    let logged = false;

    const record = (outcome: 'completed' | 'aborted') => {
      if (logged) return;
      logged = true;
      response.off('finish', onFinish);
      response.off('close', onClose);
      this.logger.log({
        event: 'http_request',
        requestId,
        method: request.method,
        path: getRequestPath(request),
        statusCode: response.headersSent ? response.statusCode : null,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        outcome,
      });
    };
    const onFinish = () => record('completed');
    const onClose = () =>
      record(response.writableFinished ? 'completed' : 'aborted');
    response.once('finish', onFinish);
    response.once('close', onClose);
    next();
  }
}
