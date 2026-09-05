import { useState, type ReactNode } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@/test/utils';

const mockLoadModel = vi.fn().mockResolvedValue(undefined);
const mockGenerate = vi.fn();
const mockInterrupt = vi.fn();
const mockUnload = vi.fn().mockResolvedValue(undefined);
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn().mockResolvedValue(undefined);

const mockCapture = vi.fn();
vi.mock('@/lib/posthog', () => ({
  // The real module exports `undefined` when the PostHog env vars are absent,
  // which they are in tests — so without this every capture is a no-op and
  // nothing here could observe one.
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
  // `captureUsage` fires the domain event *and* `app_used` beside it, and the
  // double is faithful to that: a mock that only forwarded the first would let
  // a call site lose the activity event without a single test noticing.
  captureUsage: (action: string, properties?: unknown) => {
    mockCapture(action, properties);
    mockCapture('app_used', { action });
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/components/shared/PageHeader', () => ({
  PageHeader: ({
    title,
    description,
    action,
  }: {
    readonly title: string;
    readonly description?: string;
    readonly action?: ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  ),
}));

vi.mock('@/lib/db', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

vi.mock('../../hooks/useTripSystemPrompt', () => ({
  useTripSystemPrompt: () => ({
    systemPrompt: 'system-prompt',
  }),
}));

vi.mock('../../hooks/useTripActions', () => ({
  useTripActions: () => ({
    executeActions: vi.fn().mockResolvedValue({ count: 0, summaries: [] }),
  }),
}));

const mockUseWebLLM = vi.fn();

// Keep the real `isFatalEngineError` — the crash-recovery path depends on it
// classifying errors exactly the way production does.
vi.mock('../../hooks/useWebLLM', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useWebLLM')>()),
  useWebLLM: (...args: unknown[]) => mockUseWebLLM(...args),
}));

import { AssistantPage } from '../AssistantPage';

// ============================================================================
// Test Helpers
// ============================================================================

interface GenerateCall {
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly resolve: (response: string) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Replaces `generate` with one that never settles on its own, so a test can
 * hold an answer open and send more prompts behind it.
 */
function useDeferredGenerate(): GenerateCall[] {
  const calls: GenerateCall[] = [];
  mockGenerate.mockImplementation(
    (messages: GenerateCall['messages']) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ messages, resolve, reject });
      }),
  );
  return calls;
}

function readyEngine(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    loadProgress: null,
    error: null,
    isCached: true,
    loadModel: mockLoadModel,
    generate: mockGenerate,
    interrupt: mockInterrupt,
    unload: mockUnload,
    ...overrides,
  };
}

async function sendPrompt(
  user: ReturnType<typeof render>['user'],
  text: string,
  buttonName: 'assistant.send' | 'assistant.queueMessage',
): Promise<void> {
  await user.type(screen.getByRole('textbox'), text);
  await user.click(screen.getByRole('button', { name: buttonName }));
}

/**
 * Gives jsdom — which ships no WebGPU at all — the device verdict a test wants.
 *
 * Every test that expects the assistant to be offered needs `true`: without it
 * the page correctly decides this browser cannot run a model and hides the
 * download behind an explanation.
 */
function stubWebGPU(supported: boolean): void {
  Object.defineProperty(navigator, 'gpu', {
    value: {
      requestAdapter: vi.fn().mockResolvedValue(supported ? {} : null),
    },
    configurable: true,
    writable: true,
  });
}

describe('AssistantPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    stubWebGPU(true);
    mockGetSettings.mockResolvedValue({});
    mockUseWebLLM.mockReturnValue({
      status: 'idle',
      loadProgress: null,
      error: null,
      isCached: false,
      loadModel: mockLoadModel,
      generate: mockGenerate,
      interrupt: mockInterrupt,
      unload: mockUnload,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'gpu');
    vi.restoreAllMocks();
  });

  it('renders the assistant model selector and load button', async () => {
    render(<AssistantPage />, { withProviders: false });

    expect(
      screen.getByRole('combobox', { name: 'assistant.modelLabel' }),
    ).toBeInTheDocument();
    // `find`, not `get`: the button waits on the WebGPU probe now.
    expect(
      await screen.findByRole('button', { name: 'assistant.loadModel' }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('WebGPU device gate', () => {
    it('offers no download when the device cannot supply a GPU adapter', async () => {
      // Android Chrome off the driver allowlist: the API is there, the adapter
      // is not. This is the session that produced "no available backend found".
      stubWebGPU(false);

      render(<AssistantPage />, { withProviders: false });

      expect(
        await screen.findByText('assistant.deviceUnsupportedTitle'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'assistant.loadModel' }),
      ).not.toBeInTheDocument();
      expect(mockLoadModel).not.toHaveBeenCalled();
    });

    it('offers no download when the browser has no WebGPU API', async () => {
      Reflect.deleteProperty(navigator, 'gpu');

      render(<AssistantPage />, { withProviders: false });

      expect(
        await screen.findByText('assistant.deviceUnsupportedTitle'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'assistant.loadModel' }),
      ).not.toBeInTheDocument();
    });

    it('does not auto-load cached weights on a device that cannot run them', async () => {
      // Cached files prove the download once worked, not that a session can be
      // built now — the same phone on a browser that has since lost WebGPU, or
      // weights cached before a driver update.
      stubWebGPU(false);
      mockUseWebLLM.mockReturnValue({
        status: 'idle',
        loadProgress: null,
        error: null,
        isCached: true,
        loadModel: mockLoadModel,
        generate: mockGenerate,
        interrupt: mockInterrupt,
        unload: mockUnload,
      });

      render(<AssistantPage />, { withProviders: false });

      await screen.findByText('assistant.deviceUnsupportedTitle');
      expect(mockLoadModel).not.toHaveBeenCalled();
    });

    it('reports the unsupported device to PostHog exactly once', async () => {
      stubWebGPU(false);

      render(<AssistantPage />, { withProviders: false });

      await screen.findByText('assistant.deviceUnsupportedTitle');

      await waitFor(() => {
        const reports = mockCapture.mock.calls.filter(
          ([event]) => event === 'assistant_device_unsupported',
        );
        expect(reports).toHaveLength(1);
        expect(reports[0]?.[1]).toMatchObject({
          reason: 'no-adapter',
          device: 'webgpu',
        });
      });
    });

    it('still auto-loads cached weights when the device is supported', async () => {
      mockUseWebLLM.mockReturnValue({
        status: 'idle',
        loadProgress: null,
        error: null,
        isCached: true,
        loadModel: mockLoadModel,
        generate: mockGenerate,
        interrupt: mockInterrupt,
        unload: mockUnload,
      });

      render(<AssistantPage />, { withProviders: false });

      await waitFor(() => {
        expect(mockLoadModel).toHaveBeenCalled();
      });
    });
  });

  it('hydrates the saved model preference from settings', async () => {
    mockGetSettings.mockResolvedValue({ assistantModelId: 'gemma-4-e4b' });

    render(<AssistantPage />, { withProviders: false });

    await waitFor(() => {
      expect(
        screen.getByText('assistant.models.gemma-4-e4b.description'),
      ).toBeInTheDocument();
    });
  });

  it('persists a model switch and unloads the current model when needed', async () => {
    mockUseWebLLM.mockReturnValue({
      status: 'ready',
      loadProgress: null,
      error: null,
      isCached: false,
      loadModel: mockLoadModel,
      generate: mockGenerate,
      interrupt: mockInterrupt,
      unload: mockUnload,
    });

    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(
      screen.getByRole('combobox', { name: 'assistant.modelLabel' }),
    );
    await user.click(
      await screen.findByText(/assistant\.models\.gemma-3-1b\.name/),
    );

    await waitFor(() => {
      expect(mockUnload).toHaveBeenCalledTimes(1);
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        assistantModelId: 'gemma-3-1b',
      });
    });
  });
});

describe('AssistantPage — request queue', () => {
  beforeEach(() => {
    mockUseWebLLM.mockReturnValue(readyEngine());
  });

  it('reports the prompt to analytics', async () => {
    const { user } = render(<AssistantPage />, { withProviders: false });
    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    await sendPrompt(user, 'who is sleeping in the attic?', 'assistant.send');

    // The prompt text is the point of this event: it is the only way to tell
    // whether the assistant answers the questions people actually have.
    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith(
        'assistant_prompt_sent',
        expect.objectContaining({ prompt: 'who is sleeping in the attic?' }),
      );
    });

    // Found by name, not by position. `calls.at(-1)` broke the moment
    // `assistant_answer_received` started firing after it.
    const call = mockCapture.mock.calls.find(
      ([event]) => event === 'assistant_prompt_sent',
    ) as [string, Record<string, unknown>] | undefined;
    expect(call).toBeDefined();
    const properties = call?.[1] ?? {};
    // Kept alongside the text so the volume question stays answerable if the
    // text is ever dropped for privacy.
    expect(properties.prompt_length).toBe('who is sleeping in the attic?'.length);
    // Zero, not one: read before the prompt joins the queue, so it describes
    // what it waited behind rather than counting itself.
    expect(properties.queue_depth).toBe(0);
  });

  it('accepts a prompt while answering and keeps it out of the answer in flight', async () => {
    const calls = useDeferredGenerate();
    const { user } = render(<AssistantPage />, { withProviders: false });

    await sendPrompt(user, 'first', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(1));

    // The composer stays usable — that is the whole point of the queue.
    expect(screen.getByRole('textbox')).not.toBeDisabled();

    await sendPrompt(user, 'second', 'assistant.queueMessage');

    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.getByText('assistant.queuedBadge')).toBeInTheDocument();
    expect(screen.getByText('assistant.queuedCount')).toBeInTheDocument();

    // Still exactly one generation, and it never saw the queued prompt.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.messages).toEqual([
      { role: 'system', content: 'system-prompt' },
      { role: 'user', content: 'first' },
    ]);
  });

  it('answers queued prompts in order, with the earlier exchange in history', async () => {
    const calls = useDeferredGenerate();
    const { user } = render(<AssistantPage />, { withProviders: false });

    await sendPrompt(user, 'first', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(1));
    await sendPrompt(user, 'second', 'assistant.queueMessage');

    await act(async () => {
      calls[0]!.resolve('answer one');
    });

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.messages).toEqual([
      { role: 'system', content: 'system-prompt' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer one' },
      { role: 'user', content: 'second' },
    ]);
    expect(screen.queryByText('assistant.queuedBadge')).not.toBeInTheDocument();
  });

  it('drops waiting prompts when the queue is cleared', async () => {
    const calls = useDeferredGenerate();
    const { user } = render(<AssistantPage />, { withProviders: false });

    await sendPrompt(user, 'first', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(1));
    await sendPrompt(user, 'second', 'assistant.queueMessage');

    await user.click(screen.getByRole('button', { name: 'assistant.clearQueue' }));
    expect(screen.queryByText('second')).not.toBeInTheDocument();

    await act(async () => {
      calls[0]!.resolve('answer one');
    });

    await waitFor(() => expect(screen.getByText('answer one')).toBeInTheDocument());
    expect(calls).toHaveLength(1);
  });

  it('abandons an answer whose conversation was cleared mid-flight', async () => {
    const calls = useDeferredGenerate();
    const { user } = render(<AssistantPage />, { withProviders: false });

    await sendPrompt(user, 'first', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(1));

    await user.click(
      screen.getByRole('button', { name: 'assistant.clearConversation' }),
    );
    expect(mockInterrupt).toHaveBeenCalled();

    await act(async () => {
      calls[0]!.resolve('answer nobody asked for any more');
    });

    expect(
      screen.queryByText('answer nobody asked for any more'),
    ).not.toBeInTheDocument();

    // The abandoned turn must leave no trace in the history the next one sends.
    await sendPrompt(user, 'fresh start', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]!.messages).toEqual([
      { role: 'system', content: 'system-prompt' },
      { role: 'user', content: 'fresh start' },
    ]);
  });

  it('holds the queue when the engine dies and resumes once it reloads', async () => {
    const calls = useDeferredGenerate();
    // `AssistantPage` is memoized, so a re-render has to come from inside it:
    // give the mocked hook real state and drive the status from there.
    let setEngineStatus: (status: string) => void = () => {};
    mockUseWebLLM.mockImplementation(() => {
      const [status, setStatus] = useState('ready');
      setEngineStatus = setStatus;
      return readyEngine({ status });
    });

    const { user } = render(<AssistantPage />, { withProviders: false });

    await sendPrompt(user, 'first', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(1));
    await sendPrompt(user, 'second', 'assistant.queueMessage');

    // The WebGPU session dies mid-answer.
    await act(async () => {
      calls[0]!.reject(
        Object.assign(new Error('failed to call OrtRun()'), { fatal: true }),
      );
    });

    await waitFor(() =>
      expect(screen.getByText('assistant.engineCrashed')).toBeInTheDocument(),
    );
    // The queued prompt is held rather than thrown at the dead session.
    expect(calls).toHaveLength(1);
    expect(screen.getByText('assistant.queuedBadge')).toBeInTheDocument();

    // useWebLLM drops to `idle` and reloads the cached model; the queue must
    // pick up again when it reports ready.
    await act(async () => {
      setEngineStatus('loading');
    });
    expect(calls).toHaveLength(1);

    await act(async () => {
      setEngineStatus('ready');
    });

    await waitFor(() => expect(calls).toHaveLength(2));
    // The failed exchange left no dangling user turn behind it.
    expect(calls[1]!.messages).toEqual([
      { role: 'system', content: 'system-prompt' },
      { role: 'user', content: 'second' },
    ]);
  });
});
