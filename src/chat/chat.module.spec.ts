import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import OpenAI from 'openai';
import { LlmService } from '../llm/llm.service.js';
import { ChatModule } from './chat.module.js';
import { ChatService } from './chat.service.js';

describe('ChatModule and LlmModule integration', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function createModule(apiKey: string, timeout = 60000) {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          skipProcessEnv: true,
          load: [
            () => ({
              DEEPSEEK_API_KEY: apiKey,
              DEEPSEEK_TIMEOUT_MS: timeout,
            }),
          ],
        }),
        ChatModule,
      ],
    }).compile();
  }

  it('creates one configured client without making network requests', async () => {
    const fetch = vi.fn(() => {
      throw new Error('Unexpected network request');
    });
    vi.stubGlobal('fetch', fetch);
    const module = await createModule('test-only-deepseek-key', 30000);
    try {
      await module.init();
      const client = module.get(OpenAI);
      expect(client).toBeInstanceOf(OpenAI);
      expect(client.baseURL).toBe('https://api.deepseek.com');
      expect(client.apiKey).toBe('test-only-deepseek-key');
      expect(client.timeout).toBe(30000);
      expect(client.maxRetries).toBe(0);
      expect(module.get(OpenAI)).toBe(client);
      expect(module.get(ChatService)).toBeInstanceOf(ChatService);
      expect(module.get(LlmService)).toBeInstanceOf(LlmService);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await module.close();
    }
  });

  it('initializes ChatModule without an API key', async () => {
    const module = await createModule('');
    try {
      await module.init();
      expect(module.get(OpenAI)).toBeNull();
      expect(module.get(ChatService)).toBeInstanceOf(ChatService);
      expect(module.get(LlmService)).toBeInstanceOf(LlmService);
    } finally {
      await module.close();
    }
  });
});
