import { z } from 'zod';
import { createUserSchema } from '../../user/dto/create-user.dto.js';

export const registerSchema = createUserSchema.extend({
  password: z.string().min(8).max(128),
});

export type RegisterDto = z.infer<typeof registerSchema>;
