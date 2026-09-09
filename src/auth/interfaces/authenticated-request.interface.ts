import type { Request } from 'express';
import type { User } from '../../user/interfaces/user.interface.js';

export interface AuthenticatedRequest extends Request {
  user: User;
  sessionId: string;
}
