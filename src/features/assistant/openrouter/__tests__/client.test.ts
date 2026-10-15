/**
 * @fileoverview Unit tests for the OpenRouter streaming client.
 * @module features/assistant/openrouter/__tests__/client.test
 */

import { describe, expect, it, vi } from 'vitest';

import {
  OPENROUTER_CHAT_URL,
  OpenRouterError,
  streamOpenRouterChat,
} from '../client';

/** A 200 whose body arrives as the given raw pieces, split where they are. */
function streamResponse(pieces: readonly string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function request(fetchImpl: typeof fetch, onChunk?: (text: string) => void) {
  return streamOpenRouterChat({
    apiKey: 'sk-or-v1-abc',
    model: 'anthropic/claude-haiku-4.5',
    messages: [{ role: 'user', content: 'Who sleeps where?' }],
    referer: 'https://app.example',
    signal: new AbortController().signal,
    onChunk,
    fetchImpl,
  });
}

describe('streamOpenRouterChat', () => {
  it('streams the whole answer so far, across events split between reads', async () => {
    const onChunk = vi.fn();
    const whole = `${delta('Alice ')}${delta('is in the Attic.')}data: [DONE]\n\n`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      // Cut in the middle of the second event's JSON.
      streamResponse([': OPENROUTER PROCESSING\n\n', whole.slice(0, 50), whole.slice(50)]),
    );

    const answer = await request(fetchImpl, onChunk);

    expect(answer).toBe('Alice is in the Attic.');
    expect(onChunk.mock.calls.map(([text]) => text)).toEqual([
      'Alice ',
      'Alice is in the Attic.',
    ]);
  });

  it('sends the key, the model and the conversation', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(streamResponse([delta('ok')]));

    await request(fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(OPENROUTER_CHAT_URL);
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-v1-abc');
    expect(JSON.parse(init!.body as string)).toMatchObject({
      model: 'anthropic/claude-haiku-4.5',
      stream: true,
      messages: [{ role: 'user', content: 'Who sleeps where?' }],
    });
  });

  it.each([
    [401, 'unauthorized'],
    [402, 'insufficient-credits'],
    [429, 'rate-limited'],
    [500, 'provider'],
  ] as const)('files a %i as %s', async (status, kind) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'nope' } }), { status }),
    );

    const error = await request(fetchImpl).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(OpenRouterError);
    expect((error as OpenRouterError).kind).toBe(kind);
    expect((error as OpenRouterError).message).toBe('nope');
  });

  it('turns an error sent mid-stream into a failure, not a short answer', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([delta('Half'), `data: ${JSON.stringify({ error: { message: 'overloaded' } })}\n\n`]),
    );

    await expect(request(fetchImpl)).rejects.toMatchObject({
      kind: 'provider',
      message: 'overloaded',
    });
  });

  it('reports an unreachable server as a network failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(request(fetchImpl)).rejects.toMatchObject({ kind: 'network' });
  });

  it('resolves with what arrived when the user stops the answer', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(encoder.encode(delta('Partial')));
        controller.signal.addEventListener('abort', () => {
          stream.error(new DOMException('Aborted', 'AbortError'));
        });
      },
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));

    const pending = streamOpenRouterChat({
      apiKey: 'k',
      model: 'm',
      messages: [],
      referer: 'https://app.example',
      signal: controller.signal,
      onChunk: () => controller.abort(),
      fetchImpl,
    });

    await expect(pending).resolves.toBe('Partial');
  });
});
