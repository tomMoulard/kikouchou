/**
 * @fileoverview Unit tests for the api.kikouchou.app streaming client.
 * @module features/assistant/kikouchou-api/__tests__/client.test
 */

import { describe, expect, it, vi } from 'vitest';

import {
  KIKOUCHOU_CHAT_URL,
  KikouchouApiError,
  streamKikouchouChat,
} from '../client';

/** A 200 whose body arrives as the given raw pieces. */
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

function request(
  fetchImpl: typeof fetch,
  {
    token = 'access-token',
    onChunk,
    signal = new AbortController().signal,
  }: {
    readonly token?: string | null;
    readonly onChunk?: (text: string) => void;
    readonly signal?: AbortSignal;
  } = {},
) {
  return streamKikouchouChat({
    messages: [
      { role: 'system', content: 'You plan trips.' },
      { role: 'user', content: 'Plan a weekend in Lisbon' },
    ],
    signal,
    onChunk,
    getAccessToken: async () => token,
    fetchImpl,
  });
}

async function failure(promise: Promise<unknown>): Promise<KikouchouApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof KikouchouApiError) return error;
    throw error;
  }
  throw new Error('expected a KikouchouApiError');
}

describe('streamKikouchouChat', () => {
  it('posts the token and the messages, and nothing the server decides', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([`${delta('Done.')}data: [DONE]\n\n`]),
    );

    await request(fetchImpl);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(KIKOUCHOU_CHAT_URL);
    expect(KIKOUCHOU_CHAT_URL).toBe('https://api.kikouchou.app/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
    // The model and the token cap are the server's: a client cannot pick a
    // dearer model on the project's key.
    expect(JSON.parse(init?.body as string)).toEqual({
      messages: [
        { role: 'system', content: 'You plan trips.' },
        { role: 'user', content: 'Plan a weekend in Lisbon' },
      ],
    });
  });

  it('streams the whole answer so far, through the shared reader', async () => {
    const onChunk = vi.fn();
    const whole = `${delta('A weekend ')}${delta('in Lisbon.')}data: [DONE]\n\n`;
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([whole.slice(0, 40), whole.slice(40)]),
    );

    const answer = await request(fetchImpl, { onChunk });

    expect(answer).toBe('A weekend in Lisbon.');
    expect(onChunk.mock.calls.map(([text]) => text)).toEqual([
      'A weekend ',
      'A weekend in Lisbon.',
    ]);
  });

  it('asks for an account without calling the server when there is no session', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const error = await failure(request(fetchImpl, { token: null }));

    expect(error.kind).toBe('unauthorized');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'daily-limit'],
    [503, 'unavailable'],
    [502, 'provider'],
    [400, 'provider'],
  ] as const)('reads a %i as %s', async (status, kind) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'x', message: 'y' } }), { status }),
    );

    const error = await failure(request(fetchImpl));

    expect(error.kind).toBe(kind);
  });

  it('reports a network failure as such', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch'));

    const error = await failure(request(fetchImpl));

    expect(error.kind).toBe('network');
  });

  it('reports a provider error sent mid-stream', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      streamResponse([
        delta('Half '),
        `data: ${JSON.stringify({ error: { message: 'upstream overloaded' } })}\n\n`,
      ]),
    );

    const error = await failure(request(fetchImpl));

    expect(error.kind).toBe('provider');
    expect(error.message).toBe('upstream overloaded');
  });

  it('resolves empty when the request is aborted before an answer', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await expect(request(fetchImpl)).resolves.toBe('');
  });
});
