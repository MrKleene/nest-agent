import { getTestDatabaseUrl } from './test-database-url.js';

process.env.DATABASE_URL = getTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.API_PREFIX = 'api';
process.env.JWT_SECRET = 'test-only-jwt-secret-with-at-least-32-characters';
process.env.JWT_ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.AUTH_SESSION_TTL_SECONDS = '604800';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
