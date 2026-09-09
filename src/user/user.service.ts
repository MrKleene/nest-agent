import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import { users } from '../database/schema.js';
import type { CreateUserDto } from './dto/create-user.dto.js';
import type { User, UserRecord } from './interfaces/user.interface.js';

const publicUserFields = {
  id: users.id,
  name: users.name,
  email: users.email,
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async create(
    createUserDto: CreateUserDto,
    passwordHash: string,
  ): Promise<User> {
    const [user] = await this.databaseService.db
      .insert(users)
      .values({
        name: createUserDto.name,
        email: createUserDto.email.trim().toLowerCase(),
        passwordHash,
      })
      .onConflictDoNothing({ target: users.email })
      .returning(publicUserFields)
      .catch(() => {
        // Drizzle errors include SQL parameters, including the password hash.
        this.logger.error('Failed to persist user in PostgreSQL');
        throw new InternalServerErrorException();
      });

    if (!user) {
      throw new ConflictException('Email already registered', {
        errorCode: 'EMAIL_ALREADY_REGISTERED',
      });
    }

    return user;
  }

  async findAll(): Promise<User[]> {
    return this.databaseService.db.select(publicUserFields).from(users);
  }

  async findByEmail(email: string): Promise<UserRecord | undefined> {
    const [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);

    return user;
  }

  async findById(id: string): Promise<User | undefined> {
    const [user] = await this.databaseService.db
      .select(publicUserFields)
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user;
  }

  async findOne(id: string): Promise<User> {
    const user = await this.findById(id);

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return user;
  }
}
