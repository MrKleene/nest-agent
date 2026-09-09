import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-Id';

interface RequestWithId extends Request {
  requestId?: string;
}

export function getRequestId(
  request: RequestWithId,
  response: Response,
): string {
  // Generate our own ID rather than trusting a caller-supplied header.
  request.requestId ??= randomUUID();
  if (!response.headersSent) {
    response.setHeader(REQUEST_ID_HEADER, request.requestId);
  }
  return request.requestId;
}

export function getRequestPath(request: Request): string {
  // Route templates avoid logging query strings and sensitive path parameters.
  const path: unknown = request.route?.path;
  return typeof path === 'string' ? path : '[unmatched]';
}
