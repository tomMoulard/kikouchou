/**
 * @fileoverview Tests for useAssistantChat: the assistant's connection to
 * api.kikouchou.app.
 *
 * @module features/assistant/hooks/__tests__/useAssistantChat
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAssistantChat } from '../useAssistantChat';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/i18n', () => ({
  default: {
    t: (key: string, options?: { readonly defaultValue?: string }) =>
      options?.defaultValue ?? key,
  },
}));

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  default: { capture: vi.fn(), captureException: vi.fn() },
  captureEvent: vi.fn(),
}));

const session = vi.hoisted(() => ({ token: 'access-token' as string | null }));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: async () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: session.token === null ? null : { access_token: session.token },
        },
      }),
    },
  }),
}));

// ============================================================================
// Test Helpers
// ============================================================================

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const fetchMock = vi.fn<typeof fetch>();

// ============================================================================
// Tests
// ============================================================================

describe('useAssistantChat', () => {
  beforeEach(() => {
    session.token = 'access-token';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is idle while signed out, and ready as soon as an account signs in', () => {
    const { result, rerender } = renderHook(
      ({ signedIn }: { signedIn: boolean }) => useAssistantChat({ accountSignedIn: signedIn }),
      { initialProps: { signedIn: false } },
    );
    expect(result.current.status).toBe('idle');

    rerender({ signedIn: true });

    expect(result.current.status).toBe('ready');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks api.kikouchou.app with the session token and streams the answer', async () => {
    fetchMock.mockResolvedValue(new Response(`${delta('A weekend in ')}${delta('Lisbon.')}data: [DONE]\n\n`));
    const onChunk = vi.fn();
    const { result } = renderHook(() => useAssistantChat({ accountSignedIn: true }));

    let answer = '';
    await act(async () => {
      answer = await result.current.generate([{ role: 'user', content: 'Plan it' }], onChunk);
    });

    expect(answer).toBe('A weekend in Lisbon.');
    expect(onChunk).toHaveBeenLastCalledWith('A weekend in Lisbon.');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.kikouchou.app/v1/chat/completions');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
    expect(result.current.status).toBe('ready');
  });

  it('says the daily limit is reached, and stays ready for tomorrow', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    const { result } = renderHook(() => useAssistantChat({ accountSignedIn: true }));

    await act(async () => {
      await expect(
        result.current.generate([{ role: 'user', content: 'Plan it' }]),
      ).rejects.toThrow(/today's questions/);
    });

    expect(result.current.error).toMatch(/today's questions/);
    expect(result.current.status).toBe('ready');
  });

  it('asks to sign in again when the server refuses the session', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    const { result } = renderHook(() => useAssistantChat({ accountSignedIn: true }));

    await act(async () => {
      await expect(
        result.current.generate([{ role: 'user', content: 'Plan it' }]),
      ).rejects.toThrow(/Sign in again/);
    });
  });

  it('reports a server that cannot be reached as a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useAssistantChat({ accountSignedIn: true }));

    await act(async () => {
      await expect(
        result.current.generate([{ role: 'user', content: 'Plan it' }]),
      ).rejects.toThrow(/Could not reach the Kikouchou server/);
    });
    expect(result.current.status).toBe('ready');
  });

  it('stops an answer in flight and keeps what already arrived', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          streamController.enqueue(new TextEncoder().encode(delta('Half an ')));
          signal?.addEventListener('abort', () => {
            streamController.error(new DOMException('Aborted', 'AbortError'));
          });
        },
      });
      return new Response(stream);
    });
    const { result } = renderHook(() => useAssistantChat({ accountSignedIn: true }));

    let pending: Promise<string> = Promise.resolve('');
    act(() => {
      pending = result.current.generate([{ role: 'user', content: 'Plan it' }]);
    });
    expect(result.current.status).toBe('generating');

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      result.current.interrupt();
    });

    await expect(pending).resolves.toBe('Half an ');
    expect(result.current.status).toBe('ready');
  });

  it('clears the last error once an account signs in again', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }));
    const { result, rerender } = renderHook(
      ({ signedIn }: { signedIn: boolean }) => useAssistantChat({ accountSignedIn: signedIn }),
      { initialProps: { signedIn: true } },
    );
    await act(async () => {
      await result.current.generate([{ role: 'user', content: 'Plan it' }]).catch(() => undefined);
    });
    expect(result.current.error).toMatch(/Sign in again/);

    rerender({ signedIn: false });
    rerender({ signedIn: true });

    expect(result.current.error).toBeNull();
  });
});
