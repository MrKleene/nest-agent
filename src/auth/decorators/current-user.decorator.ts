import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../../user/interfaces/user.interface.js';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
