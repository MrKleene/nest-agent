import { HttpStatus } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';
import type { ApiErrorResponse } from './api-response.interface.js';

export const API_ERRORS = {
  BAD_REQUEST: {
    status: HttpStatus.BAD_REQUEST,
    code: 'BAD_REQUEST',
    message: 'Bad Request',
  },
  VALIDATION_ERROR: {
    status: HttpStatus.BAD_REQUEST,
    code: 'VALIDATION_ERROR',
    message: 'Request validation failed',
  },
  UNAUTHORIZED: {
    status: HttpStatus.UNAUTHORIZED,
    code: 'UNAUTHORIZED',
    message: 'Unauthorized',
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    code: 'FORBIDDEN',
    message: 'Forbidden',
  },
  ORIGIN_NOT_ALLOWED: {
    status: HttpStatus.FORBIDDEN,
    code: 'ORIGIN_NOT_ALLOWED',
    message: 'Origin not allowed',
  },
  NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    code: 'NOT_FOUND',
    message: 'Not Found',
  },
  CONFLICT: {
    status: HttpStatus.CONFLICT,
    code: 'CONFLICT',
    message: 'Conflict',
  },
  EMAIL_ALREADY_REGISTERED: {
    status: HttpStatus.CONFLICT,
    code: 'EMAIL_ALREADY_REGISTERED',
    message: 'Email already registered',
  },
  INTERNAL_SERVER_ERROR: {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Internal Server Error',
  },
} as const;

type ApiErrorCode = keyof typeof API_ERRORS;

export function getApiError(
  status: number,
  errorCode?: string,
): ApiErrorResponse['error'] {
  const defaultCode = HttpStatus[status] ?? 'HTTP_ERROR';
  const code = status < 500 ? (errorCode ?? defaultCode) : defaultCode;
  if (Object.hasOwn(API_ERRORS, code)) {
    const definition = API_ERRORS[code as ApiErrorCode];
    if (definition.status === status) {
      return { code: definition.code, message: definition.message };
    }
  }

  // Unregistered codes and mismatched statuses use the HTTP default contract.
  return {
    code: defaultCode,
    message: STATUS_CODES[status] ?? 'Request failed',
  };
}
