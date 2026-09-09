import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { EnvironmentVariables } from '../config/env.schema.js';
import * as schema from './schema.js';

@Injectable()
export class DatabaseService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  readonly db: NodePgDatabase<typeof schema>;

  constructor(configService: ConfigService<EnvironmentVariables>) {
    this.pool = new Pool({
      connectionString: configService.getOrThrow('DATABASE_URL', {
        infer: true,
      }),
      max: 10,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', (error) => {
      this.logger.error('PostgreSQL connection pool error', error.stack);
    });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
