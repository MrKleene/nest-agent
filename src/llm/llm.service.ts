import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  constructor(@Inject(OpenAI) private readonly client: OpenAI | null) {}
}
