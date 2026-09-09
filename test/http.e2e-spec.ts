import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Post,
  Sse,
  StreamableFile,
  type INestApplication,
  type MessageEvent,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { inspect } from 'node:util';
import { of, type Observable } from 'rxjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { MockInstance } from 'vitest';
import { z } from 'zod';
import { AppModule } from '../src/app.module.js';
import { Public } from '../src/auth/decorators/public.decorator.js';
import { RawResponse } from '../src/common/decorators/raw-response.decorator.js';
import { configureHttp } from '../src/common/http/configure-http.js';

const inputSchema = z.object({ name: z.string().min(3) });
const sensitiveSql = 'SELECT refresh_token_hash FROM auth_sessions';
const sensitiveToken = 'private-refresh-token-value';

@Public()
@Controller('http-probe')
class HttpProbeController {
  @Get('object')
  object() {
    return { data: { original: true }, label: 'original' };
  }

  @Post('validate')
  validate(@Body({ schema: inputSchema }) body: z.infer<typeof inputSchema>) {
    return body;
  }

  @Get('unsafe-error')
  unsafeError(): never {
    throw new Error(sensitiveSql, { cause: new Error(sensitiveToken) });
  }

  @Post('no-content')
  @HttpCode(204)
  noContent(): void {}

  @Get('file')
  file(): StreamableFile {
    return new StreamableFile(Buffer.from('streamed-file-content'), {
      type: 'text/plain',
    });
  }

  @Sse('events')
  events(): Observable<MessageEvent> {
    return of({ data: { event: 'ready' } });
  }

  @Get('raw')
  @RawResponse()
  raw() {
    return { original: true };
  }

  @Get('raw-error')
  @RawResponse()
  rawError(): never {
    throw new ForbiddenException();
  }

  @Post('items/:id')
  item() {
    return { accepted: true };
  }
}

interface RequestLog {
  event: 'http_request';
  requestId: string;
  method: string;
  path: string;
  statusCode: number | null;
  durationMs: number;
  outcome: 'completed' | 'aborted';
}

describe('HTTP infrastructure (e2e)', () => {
  let app: INestApplication<App>;
  let logSpy: MockInstance;
  let errorSpy: MockInstance;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [HttpProbeController],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });

  beforeEach(() => {
    logSpy = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app?.close();
  });

  function requestId(response: request.Response): string {
    const id = response.headers['x-request-id'] as string;
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    return id;
  }

  function requestLogs(): RequestLog[] {
    return logSpy.mock.calls
      .map(([entry]) => entry as RequestLog)
      .filter((entry) => entry?.event === 'http_request');
  }

  function expectError(response: request.Response, code: string): string {
    const id = requestId(response);
    expect(response.body).toEqual({
      error: expect.objectContaining({ code, message: expect.any(String) }),
      meta: { requestId: id },
    });
    return id;
  }

  it('wraps existing data fields and exposes a fresh server request ID through CORS', async () => {
    const response = await request(app.getHttpServer())
      .get('/http-probe/object')
      .set('Origin', 'http://localhost:5173')
      .set('X-Request-Id', 'client-controlled-id')
      .expect(200);

    const id = requestId(response);
    expect(id).not.toBe('client-controlled-id');
    expect(response.body).toEqual({
      data: { data: { original: true }, label: 'original' },
      meta: { requestId: id },
    });
    expect(
      response.headers['access-control-expose-headers'].toLowerCase(),
    ).toContain('x-request-id');
  });

  it('returns validation details and logs the rejected request exactly once', async () => {
    const response = await request(app.getHttpServer())
      .post('/http-probe/validate')
      .send({ name: 'x' })
      .expect(400);

    const id = expectError(response, 'VALIDATION_ERROR');
    expect(response.body.error.details.length).toBeGreaterThan(0);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
    expect(requestLogs()).toEqual([
      {
        event: 'http_request',
        requestId: id,
        method: 'POST',
        path: '/http-probe/validate',
        statusCode: 400,
        durationMs: expect.any(Number),
        outcome: 'completed',
      },
    ]);
  });

  it('hides unknown exception messages and causes from responses and logs', async () => {
    const response = await request(app.getHttpServer())
      .get('/http-probe/unsafe-error')
      .expect(500);

    expectError(response, 'INTERNAL_SERVER_ERROR');
    expect(response.body.error.message).toBe('Internal Server Error');
    expect(errorSpy).toHaveBeenCalledOnce();
    const output = inspect(
      [response.body, logSpy.mock.calls, errorSpy.mock.calls],
      { depth: 10 },
    );
    expect(output).not.toContain(sensitiveSql);
    expect(output).not.toContain(sensitiveToken);
  });

  it('assigns a request ID before malformed JSON is rejected', async () => {
    const response = await request(app.getHttpServer())
      .post('/http-probe/validate')
      .set('Content-Type', 'application/json')
      .send('{"private-malformed-json":')
      .expect(400);

    expectError(response, 'BAD_REQUEST');
    expect(JSON.stringify(response.body)).not.toContain(
      'private-malformed-json',
    );
  });

  it('uses the error envelope and a sanitized log path for unknown routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/private-unmatched-path?token=private-query')
      .expect(404);

    const id = expectError(response, 'NOT_FOUND');
    expect(requestLogs()).toEqual([
      expect.objectContaining({
        requestId: id,
        path: '[unmatched]',
        statusCode: 404,
      }),
    ]);
  });

  it('includes a request ID and one completion log when the global guard rejects a request', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', 'Bearer private-invalid-token')
      .expect(401);

    const id = expectError(response, 'UNAUTHORIZED');
    expect(requestLogs()).toEqual([
      {
        event: 'http_request',
        requestId: id,
        method: 'GET',
        path: '/auth/me',
        statusCode: 401,
        durationMs: expect.any(Number),
        outcome: 'completed',
      },
    ]);
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
      'private-invalid-token',
    );
  });

  it('keeps 204 and HEAD responses empty while retaining their request IDs', async () => {
    const noContent = await request(app.getHttpServer())
      .post('/http-probe/no-content')
      .expect(204);
    const head = await request(app.getHttpServer())
      .head('/http-probe/object')
      .expect(200);

    expect(noContent.text).toBe('');
    expect(head.text ?? '').toBe('');
    expect(noContent.body).toEqual({});
    expect(head.body).toEqual({});
    expect(requestId(noContent)).not.toBe(requestId(head));
  });

  it('preserves StreamableFile content without an envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/http-probe/file')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toBe('streamed-file-content');
    requestId(response);
  });

  it('preserves finite SSE events without injecting an envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/http-probe/events')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('data: {"event":"ready"}');
    expect(response.text).not.toContain('"meta"');
    requestId(response);
  });

  it('lets RawResponse skip successful wrapping while keeping unified errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/http-probe/raw')
      .expect(200);
    expect(response.body).toEqual({ original: true });
    requestId(response);

    const failure = await request(app.getHttpServer())
      .get('/http-probe/raw-error')
      .expect(403);
    expectError(failure, 'FORBIDDEN');
  });

  it('logs a route template once without query, body, authorization, or cookies', async () => {
    const response = await request(app.getHttpServer())
      .post('/http-probe/items/private-route-value?token=private-query-value')
      .set('Authorization', 'Bearer private-access-value')
      .set('Cookie', 'refresh_token=private-cookie-value')
      .send({ password: 'private-body-value' })
      .expect(201);

    expect(requestLogs()).toEqual([
      {
        event: 'http_request',
        requestId: requestId(response),
        method: 'POST',
        path: '/http-probe/items/:id',
        statusCode: 201,
        durationMs: expect.any(Number),
        outcome: 'completed',
      },
    ]);
    const output = JSON.stringify(logSpy.mock.calls);
    for (const secret of [
      'private-route-value',
      'private-query-value',
      'private-access-value',
      'private-cookie-value',
      'private-body-value',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(requestLogs()[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('assigns a request ID before CORS finishes a preflight response', async () => {
    const response = await request(app.getHttpServer())
      .options('/http-probe/object')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);

    requestId(response);
    expect(response.text).toBe('');
    expect(response.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
  });
});
