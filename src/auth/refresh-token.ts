import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { z } from 'zod';

const refreshTokenPartsSchema = z.tuple([
  z.uuid(),
  z.string().regex(/^[A-Za-z0-9_-]{43}$/),
]);

export function parseRefreshToken(token: string): {
  sessionId: string;
  tokenHash: string;
} {
  const result = refreshTokenPartsSchema.safeParse(token.split('.'));
  if (!result.success) {
    throw new UnauthorizedException();
  }

  return {
    sessionId: result.data[0],
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}
