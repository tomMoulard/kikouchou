/**
 * @fileoverview Tests for the cloud (OpenRouter) engine of useWebLLM.
 *
 * @module features/assistant/hooks/__tests__/useWebLLM.cloud
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAssistantModelPreset } from '@/features/assistant/models';
import { installLocalStorageDouble } from '@/test/local-storage';

import {
  OPENROUTER_KEY_STORAGE_KEY,
  OPENROUTER_PENDING_STORAGE_KEY,
} from '../../openrouter/auth';
import { useWebLLM } from '../useWebLLM';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/i18n', () => ({
  default: {
    t: (key: string, options?: { readonly defaultValue?: string }) =>
      options?.defaultValue ?? key,
  },
}));

const mockCapture = vi.fn();
vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  default: { capture: vi.fn(), captureException: vi.fn() },
  captureEvent: (...args: unknown[]) => mockCapture(...args),
}));

// ============================================================================
// Test Helpers
// ============================================================================

const storage = installLocalStorageDouble();
const preset = getAssistantModelPreset('cloud-claude-haiku');

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** A body that sends one event, then waits for the request to be aborted. */
function heldStream(first: string, signal: AbortSignal): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(first));
      signal.addEventListener('abort', () => {
        controller.error(new DOMException('Aborted', 'AbortError'));
      });
    },
  });
}

const fetchMock = vi.fn<typeof fetch>();

// ============================================================================
// Tests
// ============================================================================

describe('useWebLLM with a cloud preset', () => {
  beforeEach(() => {
    storage.clear();
    fetchMock.mockReset();
    mockCapture.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is idle until an account is connected, and never signs in on its own', async () => {
    const { result } = renderHook(() => useWebLLM(preset));

    expect(result.current.status).toBe('idle');
    await act(async () => {
      await result.current.loadModel();
    });

    // The auto-load effect calls loadModel; a redirect from there would take
    // the user off the page without a click.
    expect(result.current.status).toBe('idle');
    expect(storage.entries.has(OPENROUTER_PENDING_STORAGE_KEY)).toBe(false);
  });

  it('is ready at once when a key is stored, with nothing to download', () => {
    storage.entries.set(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-abc');

    const { result } = renderHook(() => useWebLLM(preset));

    expect(result.current.status).toBe('ready');
    expect(result.current.isCached).toBe(true);
  });

  it('streams the answer with the stored key and goes back to ready', async () => {
    storage.entries.set(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-abc');
    fetchMock.mockResolvedValue(
      new Response(`${delta('Alice ')}${delta('sleeps in the Attic.')}data: [DONE]\n\n`),
    );
    const onChunk = vi.fn();
    const { result } = renderHook(() => useWebLLM(preset));

    let answer = '';
    await act(async () => {
      answer = await result.current.generate(
        [{ role: 'user', content: 'Who sleeps where?' }],
        onChunk,
      );
    });

    expect(answer).toBe('Alice sleeps in the Attic.');
    expect(onChunk).toHaveBeenLastCalledWith('Alice sleeps in the Attic.');
    expect(result.current.status).toBe('ready');
    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sk-or-v1-abc',
    );
    expect(JSON.parse(init.body as string).model).toBe('anthropic/claude-haiku-4.5');
  });

  it('forgets a revoked key and goes back to the connect card with the reason', async () => {
    storage.entries.set(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-revoked');
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'User not found.' } }), {
        status: 401,
      }),
    );
    const { result } = renderHook(() => useWebLLM(preset));

    await act(async () => {
      await expect(
        result.current.generate([{ role: 'user', content: 'Hi' }]),
      ).rejects.toThrow(/no longer valid/);
    });

    expect(storage.entries.has(OPENROUTER_KEY_STORAGE_KEY)).toBe(false);
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.error).toMatch(/no longer valid/);
  });

  it('keeps the key on a failure the user can fix elsewhere', async () => {
    storage.entries.set(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-abc');
    fetchMock.mockResolvedValue(new Response('{}', { status: 402 }));
    const { result } = renderHook(() => useWebLLM(preset));

    await act(async () => {
      await expect(
        result.current.generate([{ role: 'user', content: 'Hi' }]),
      ).rejects.toThrow(/no credits/);
    });

    expect(storage.entries.get(OPENROUTER_KEY_STORAGE_KEY)).toBe('sk-or-v1-abc');
    expect(result.current.status).toBe('ready');
  });

  it('resolves with the partial answer when interrupted', async () => {
    storage.entries.set(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-abc');
    fetchMock.mockImplementation(async (_url, init) =>
      new Response(heldStream(delta('Partial'), init!.signal!)),
    );
    const { result } = renderHook(() => useWebLLM(preset));

    let pending!: Promise<string>;
    await act(async () => {
      pending = result.current.generate([{ role: 'user', content: 'Hi' }], () => {
        result.current.interrupt();
      });
      await expect(pending).resolves.toBe('Partial');
    });

    expect(result.current.status).toBe('ready');
  });

  it('sends the user to OpenRouter on connect, with the assistant as callback', async () => {
    const realLocation = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, origin: 'https://app.example', assign },
    });

    try {
      const { result } = renderHook(() => useWebLLM(preset));
      await act(async () => {
        await result.current.connect();
      });

      expect(assign).toHaveBeenCalledTimes(1);
      const url = new URL(assign.mock.calls[0]![0] as string);
      expect(url.origin).toBe('https://openrouter.ai');
      expect(new URL(url.searchParams.get('callback_url')!).pathname).toMatch(
        /\/assistant$/,
      );
      expect(storage.entries.has(OPENROUTER_PENDING_STORAGE_KEY)).toBe(true);
      expect(mockCapture).toHaveBeenCalledWith(
        'assistant_provider_connect_started',
        expect.objectContaining({ provider: 'openrouter' }),
      );
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: realLocation,
      });
    }
  });

  it('goes back to idle on disconnect', async () => {
    storage.entries.set(OPENROUTER_KEY_STORAGE_KEY, 'sk-or-v1-abc');
    const { result } = renderHook(() => useWebLLM(preset));

    act(() => {
      result.current.disconnect();
    });

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(storage.entries.has(OPENROUTER_KEY_STORAGE_KEY)).toBe(false);
  });
});
