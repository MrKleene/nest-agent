import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiErrorResponse } from '../http/api-response.interface.js';
import { API_ERRORS, getApiError } from '../http/api-errors.js';
import { getRequestId, getRequestPath } from '../http/request-context.js';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = getRequestId(request, response);
    const status = this.getStatus(exception);
    let error = getApiError(status);

    if (exception instanceof HttpException && status < 500) {
      error = getApiError(status, exception.errorCode);
      const body = exception.getResponse();
      const message: unknown =
        typeof body === 'string'
          ? body
          : (body as { message?: unknown }).message;
      if (
        status === 400 &&
        Array.isArray(message) &&
        message.every((item) => typeof item === 'string')
      ) {
        error = {
          ...getApiError(status, API_ERRORS.VALIDATION_ERROR.code),
          details: message,
        };
      }
    }

    if (status >= 500) {
      // Never log the raw exception/cause: Drizzle errors contain SQL parameters.
      this.logger.error({
        event: 'http_error',
        requestId,
        method: request.method,
        path: getRequestPath(request),
        statusCode: status,
        code: error.code,
      });
    }
    if (response.headersSent || response.writableEnded) {
      if (!response.writableEnded) response.end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json({ error } satisfies ApiErrorResponse);
  }

  private getStatus(exception: unknown): number {
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : exception &&
            typeof exception === 'object' &&
            'statusCode' in exception
          ? exception.statusCode
          : undefined;
    return typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
      ? status
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
