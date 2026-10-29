/**
 * @fileoverview Tests for the account engine of useWebLLM: api.kikouchou.app.
 *
 * @module features/assistant/hooks/__tests__/useWebLLM.kikouchou
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAssistantModelPreset } from '@/features/assistant/models';

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

const preset = getAssistantModelPreset('cloud-kikouchou');

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

const fetchMock = vi.fn<typeof fetch>();

// ============================================================================
// Tests
// ============================================================================

describe('useWebLLM with the account preset', () => {
  beforeEach(() => {
    session.token = 'access-token';
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is idle while signed out, and loadModel never signs in on its own', async () => {
    const { result } = renderHook(() => useWebLLM(preset, { accountSignedIn: false }));

    expect(result.current.status).toBe('idle');
    await act(async () => {
      await result.current.loadModel();
    });
    expect(result.current.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is ready as soon as an account is signed in, with nothing to download', () => {
    const { result, rerender } = renderHook(
      ({ signedIn }: { signedIn: boolean }) => useWebLLM(preset, { accountSignedIn: signedIn }),
      { initialProps: { signedIn: false } },
    );
    expect(result.current.status).toBe('idle');

    rerender({ signedIn: true });

    expect(result.current.status).toBe('ready');
    expect(result.current.isCached).toBe(true);
  });

  it('asks api.kikouchou.app with the session token and streams the answer', async () => {
    fetchMock.mockResolvedValue(new Response(`${delta('A weekend in ')}${delta('Lisbon.')}data: [DONE]\n\n`));
    const onChunk = vi.fn();
    const { result } = renderHook(() => useWebLLM(preset, { accountSignedIn: true }));

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

  it('says the daily limit is reached, and stays ready for another model or tomorrow', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 429 }));
    const { result } = renderHook(() => useWebLLM(preset, { accountSignedIn: true }));

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
    const { result } = renderHook(() => useWebLLM(preset, { accountSignedIn: true }));

    await act(async () => {
      await expect(
        result.current.generate([{ role: 'user', content: 'Plan it' }]),
      ).rejects.toThrow(/Sign in again/);
    });
  });

  it('keeps the OpenRouter key out of it: no key is needed or read', async () => {
    fetchMock.mockResolvedValue(new Response(`${delta('ok')}data: [DONE]\n\n`));
    const { result } = renderHook(() => useWebLLM(preset, { accountSignedIn: true }));

    await act(async () => {
      await result.current.generate([{ role: 'user', content: 'Plan it' }]);
    });

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain('openrouter.ai');
  });
});
