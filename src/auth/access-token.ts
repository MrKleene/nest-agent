import { z } from 'zod';

export const accessTokenSchema = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  type: z.literal('access'),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type AccessTokenPayload = z.infer<typeof accessTokenSchema>;

export function extractBearerToken(
  authorization: string | undefined,
): string | undefined {
  return authorization?.match(/^Bearer (\S+)$/i)?.[1];
}
