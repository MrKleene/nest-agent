import { envSchema } from './env.schema.js';

const schema = envSchema.shape.API_PREFIX;

describe('API_PREFIX validation', () => {
  it.each([
    [undefined, 'api'],
    ['', ''],
    ['/', ''],
    [' /internal/v2/ ', 'internal/v2'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(schema.parse(input)).toBe(expected);
  });

  it.each([
    'api//v2',
    '../api',
    'api?x=1',
    'api#x',
    'api/*',
    'api/:id',
    'api v2',
  ])('rejects invalid prefix %j', (input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});
