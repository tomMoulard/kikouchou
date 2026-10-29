import { type ReactNode } from 'react';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@/test/utils';

const mockGenerate = vi.fn();
const mockInterrupt = vi.fn();

const mockCapture = vi.fn();
vi.mock('@/lib/posthog', () => ({
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(),
  // The real module exports `undefined` when the PostHog env vars are absent,
  // which they are in tests — so without this every capture is a no-op and
  // nothing here could observe one.
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
  captureEvent: (...args: unknown[]) => mockCapture(...args),
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

// A build with accounts: one without them shows no chat at all.
vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/client')>()),
  isSupabaseConfigured: () => true,
}));

// The page reads the session for the account. The chat hook is mocked, so
// its status, not this, decides what renders here.
vi.mock('@/features/auth', () => ({ useAuth: () => ({ session: null }) }));
vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: () => null,
}));

vi.mock('../../hooks/useTripSystemPrompt', () => ({
  useTripSystemPrompt: () => ({
    systemPrompt: 'system-prompt',
    buildSystemPrompt: () => 'system-prompt',
  }),
}));

vi.mock('../../hooks/useTripActions', async (importOriginal) => ({
  // The parser that names an answer's deletions stays real: the page asks
  // before running those, and a stub that lost it would fail every turn.
  ...(await importOriginal<typeof import('../../hooks/useTripActions')>()),
  useTripActions: () => ({
    executeActions: vi.fn().mockResolvedValue({ count: 0, summaries: [] }),
  }),
}));

// A view reads every trip context; the page tests render without providers,
// and what is under test here is which view the page asks for.
vi.mock('../../components/AssistantTripView', () => ({
  AssistantTripView: ({ view }: { readonly view: string }) => (
    <section aria-label={`view:${view}`} />
  ),
}));

const mockUseAssistantChat = vi.fn();

vi.mock('../../hooks/useAssistantChat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useAssistantChat')>()),
  useAssistantChat: (...args: unknown[]) => mockUseAssistantChat(...args),
}));

import { AssistantPage } from '../AssistantPage';
import { ASSISTANT_VIEWS, buildShowViewBlock } from '../../views';

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

function readyChat(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ready',
    error: null,
    generate: mockGenerate,
    interrupt: mockInterrupt,
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

// jsdom has no layout, so no `scrollIntoView`; the transcript calls it on every
// message.
beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('AssistantPage — request queue', () => {
  beforeEach(() => {
    mockUseAssistantChat.mockReturnValue(readyChat());
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

  it('saves the conversation on this device once the debounce has run', async () => {
    // Its own storage and scroll stub: the `AssistantPage` block above leaves
    // both in whatever state its mocks were restored to, and a test run on its
    // own with `-t` never sees that block's setup at all.
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => void saved.set(key, value),
      removeItem: (key: string) => void saved.delete(key),
    });
    Element.prototype.scrollIntoView = vi.fn();

    try {
      const { user } = render(<AssistantPage />, { withProviders: false });

      await sendPrompt(user, 'who drives on Friday?', 'assistant.send');

      // Waited for on purpose: left to the end of some other test, whether the
      // 400 ms save ran depended on the runner's speed, and the coverage floor
      // moved with it.
      await waitFor(
        () => {
          expect(saved.get('kikouchou.assistant.chat.v1')).toContain('who drives on Friday?');
        },
        { timeout: 2_000 },
      );
    } finally {
      vi.unstubAllGlobals();
    }
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

  it('opens a view at once, with no model turn', async () => {
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(
      await screen.findByRole('button', { name: 'assistant.views.planning.shortcut' }),
    );

    expect(screen.getByText('assistant.views.planning.request')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'view:planning' })).toBeInTheDocument();
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith('assistant_view_shown', {
      view: 'planning',
      via: 'shortcut',
    });
  });

  it('offers one shortcut per view', async () => {
    render(<AssistantPage />, { withProviders: false });

    const group = await screen.findByRole('group', {
      name: 'assistant.views.shortcutsLabel',
    });
    expect(
      Array.from(group.querySelectorAll('button')).map((button) => button.textContent),
    ).toEqual(ASSISTANT_VIEWS.map((view) => `assistant.views.${view}.shortcut`));
  });

  it('keeps a shortcut out of what the model reads next', async () => {
    const calls = useDeferredGenerate();
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(
      await screen.findByRole('button', { name: 'assistant.views.rooms.shortcut' }),
    );
    await sendPrompt(user, 'who is in the attic?', 'assistant.send');

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.messages).toEqual([
      { role: 'system', content: 'system-prompt' },
      { role: 'user', content: 'who is in the attic?' },
    ]);
  });

  it('waits while an answer runs, so the view does not split a turn', async () => {
    const calls = useDeferredGenerate();
    const { user } = render(<AssistantPage />, { withProviders: false });

    await sendPrompt(user, 'first', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(1));

    expect(
      screen.getByRole('button', { name: 'assistant.views.money.shortcut' }),
    ).toBeDisabled();

    await act(async () => {
      calls[0]!.resolve('done');
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'assistant.views.money.shortcut' }),
      ).toBeEnabled();
    });
  });

  it('draws the view a model answer asks for, and counts it', async () => {
    const calls = useDeferredGenerate();
    const { user } = render(<AssistantPage />, { withProviders: false });

    await sendPrompt(user, 'show me the planning', 'assistant.send');
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0]!.resolve(`Here it is.\n\n${buildShowViewBlock('planning')}`);
    });

    expect(
      await screen.findByRole('region', { name: 'view:planning' }),
    ).toBeInTheDocument();
    expect(mockCapture).toHaveBeenCalledWith('assistant_view_shown', {
      view: 'planning',
      via: 'model',
    });
  });
});
