import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;
