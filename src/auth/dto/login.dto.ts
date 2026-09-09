import { z } from 'zod';
import { createUserSchema } from '../../user/dto/create-user.dto.js';

export const loginSchema = createUserSchema.pick({ email: true }).extend({
  password: z.string().min(1).max(128),
});

export type LoginDto = z.infer<typeof loginSchema>;
