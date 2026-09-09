import { Controller, ForbiddenException, Get, Param } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { User } from './interfaces/user.interface.js';
import { UserService } from './user.service.js';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get(':id')
  findOne(
    @Param('id', { schema: z.uuid().toLowerCase() })
    id: string,
    @CurrentUser() user: User,
  ): Promise<User> {
    if (id !== user.id) {
      throw new ForbiddenException();
    }

    return this.userService.findOne(id);
  }
}
