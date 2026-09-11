import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { EnvironmentVariables } from '../config/env.schema.js';
import { LlmService } from './llm.service.js';

@Module({
  providers: [
    LlmService,
    {
      provide: OpenAI,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables>,
      ): OpenAI | null => {
        const apiKey = config.getOrThrow('DEEPSEEK_API_KEY', { infer: true });
        if (!apiKey) return null;

        return new OpenAI({
          apiKey,
          baseURL: 'https://api.deepseek.com',
          timeout: config.getOrThrow('DEEPSEEK_TIMEOUT_MS', { infer: true }),
          maxRetries: 0,
        });
      },
    },
  ],
  exports: [LlmService],
})
export class LlmModule {}
