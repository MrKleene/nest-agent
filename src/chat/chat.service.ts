import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service.js';

@Injectable()
export class ChatService {
  constructor(private readonly llmService: LlmService) {}
}
