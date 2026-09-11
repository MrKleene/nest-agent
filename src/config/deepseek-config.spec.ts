import { envSchema } from './env.schema.js';

const schema = envSchema.pick({
  DEEPSEEK_API_KEY: true,
  DEEPSEEK_MODEL: true,
  DEEPSEEK_TIMEOUT_MS: true,
});

describe('DeepSeek configuration', () => {
  it('allows an unconfigured API key and supplies defaults', () => {
    expect(schema.parse({})).toEqual({
      DEEPSEEK_API_KEY: '',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_TIMEOUT_MS: 60000,
    });
    expect(schema.parse({ DEEPSEEK_API_KEY: '   ' }).DEEPSEEK_API_KEY).toBe('');
  });

  it('normalizes environment strings', () => {
    expect(
      schema.parse({
        DEEPSEEK_API_KEY: ' test-only-key ',
        DEEPSEEK_MODEL: ' deepseek-v4-pro ',
        DEEPSEEK_TIMEOUT_MS: '30000',
      }),
    ).toEqual({
      DEEPSEEK_API_KEY: 'test-only-key',
      DEEPSEEK_MODEL: 'deepseek-v4-pro',
      DEEPSEEK_TIMEOUT_MS: 30000,
    });
  });

  it.each(['', '0', '-1', '1.5', 'invalid', 'Infinity'])(
    'rejects invalid timeout %j',
    (value) => {
      expect(schema.safeParse({ DEEPSEEK_TIMEOUT_MS: value }).success).toBe(
        false,
      );
    },
  );

  it('rejects an explicitly empty model', () => {
    expect(schema.safeParse({ DEEPSEEK_MODEL: ' ' }).success).toBe(false);
  });
});
