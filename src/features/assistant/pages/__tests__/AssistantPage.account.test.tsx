/**
 * @fileoverview AssistantPage and the account it answers for: the starter
 * questions, the sign-in they lead to, and a build with no accounts at all.
 * @module features/assistant/pages/__tests__/AssistantPage.account.test
 */

import { type ReactNode } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

import { installLocalStorageDouble } from '@/test/local-storage';

import { PENDING_PROMPT_STORAGE_KEY } from '../../pending-prompt';

const mockGenerate = vi.fn();
const mockCapture = vi.fn();
const mockUseAssistantChat = vi.fn();

const auth = vi.hoisted(() => ({ session: null as unknown }));
const supabase = vi.hoisted(() => ({ configured: true }));

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
  captureEvent: (...args: unknown[]) => mockCapture(...args),
  captureUsage: (action: string, properties?: unknown) => {
    mockCapture(action, properties);
  },
}));

vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/components/shared/PageHeader', () => ({
  PageHeader: ({ title, action }: { readonly title: string; readonly action?: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {action}
    </div>
  ),
}));

vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/client')>()),
  isSupabaseConfigured: () => supabase.configured,
}));

vi.mock('@/features/auth', () => ({ useAuth: () => ({ session: auth.session }) }));

vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: ({
    open,
    title,
    detail,
  }: {
    readonly open: boolean;
    readonly title?: string;
    readonly detail?: string;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {detail}
      </div>
    ) : null,
}));

vi.mock('../../hooks/useTripSystemPrompt', () => ({
  useTripSystemPrompt: () => ({
    systemPrompt: 'system-prompt',
    buildSystemPrompt: () => 'system-prompt',
  }),
}));

vi.mock('../../hooks/useTripActions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useTripActions')>()),
  useTripActions: () => ({
    executeActions: vi.fn().mockResolvedValue({ count: 0, summaries: [] }),
  }),
}));

vi.mock('../../hooks/useAssistantChat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useAssistantChat')>()),
  useAssistantChat: (...args: unknown[]) => mockUseAssistantChat(...args),
}));

import { AssistantPage } from '../AssistantPage';

const storage = installLocalStorageDouble();

function chat(overrides: Record<string, unknown> = {}) {
  return {
    status: 'idle',
    error: null,
    generate: mockGenerate,
    interrupt: vi.fn(),
    ...overrides,
  };
}

describe('AssistantPage and the account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    auth.session = null;
    supabase.configured = true;
    mockGenerate.mockResolvedValue('Done.');
    mockUseAssistantChat.mockReturnValue(chat());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the starters and an account to a signed-out visitor, with no model to pick', () => {
    render(<AssistantPage />, { withProviders: false });

    expect(
      screen.getByRole('group', { name: 'assistant.starters.label' }),
    ).toBeInTheDocument();
    expect(screen.getByText('assistant.account.privacyNotice')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'assistant.account.signIn' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(mockUseAssistantChat).toHaveBeenLastCalledWith({ accountSignedIn: false });
  });

  it('asks for an account on a starter tap, and keeps the question for later', async () => {
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'assistant.starters.createWeekend' }));

    expect(
      screen.getByRole('dialog', { name: 'assistant.account.signInTitle' }),
    ).toHaveTextContent('assistant.account.signInDetail');
    expect(JSON.parse(storage.entries.get(PENDING_PROMPT_STORAGE_KEY)!)).toMatchObject({
      text: 'assistant.starters.createWeekend',
      kind: 'create',
    });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith('assistant_starter_picked', {
      starter_kind: 'create',
      model_id: 'cloud-kikouchou',
      needs_sign_in: true,
    });
  });

  it('opens the sign-in from its own button too', async () => {
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'assistant.account.signIn' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockCapture).toHaveBeenCalledWith('assistant_sign_in_requested', {
      model_id: 'cloud-kikouchou',
    });
  });

  it('shows why the last answer failed on the sign-in card', () => {
    mockUseAssistantChat.mockReturnValue(chat({ error: 'Your session has ended.' }));

    render(<AssistantPage />, { withProviders: false });

    expect(screen.getByText('Your session has ended.')).toBeInTheDocument();
  });

  it('sends the kept question once the account answers', async () => {
    auth.session = { user: { is_anonymous: false } };
    mockUseAssistantChat.mockReturnValue(chat({ status: 'ready' }));
    storage.entries.set(
      PENDING_PROMPT_STORAGE_KEY,
      JSON.stringify({ text: 'Plan a weekend at the seaside', kind: 'create', at: Date.now() }),
    );

    render(<AssistantPage />, { withProviders: false });

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    const [messages] = mockGenerate.mock.calls[0] as [{ role: string; content: string }[]];
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'Plan a weekend at the seaside' });
    expect(storage.entries.has(PENDING_PROMPT_STORAGE_KEY)).toBe(false);
    // The hook is told the account is there.
    expect(mockUseAssistantChat).toHaveBeenLastCalledWith({ accountSignedIn: true });
  });

  it('sends a starter straight away once the chat is ready', async () => {
    auth.session = { user: { is_anonymous: false } };
    mockUseAssistantChat.mockReturnValue(chat({ status: 'ready' }));
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(
      await screen.findByRole('button', { name: 'assistant.starters.exploreRooms' }),
    );

    await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockCapture).toHaveBeenCalledWith('assistant_starter_picked', {
      starter_kind: 'explore',
      model_id: 'cloud-kikouchou',
      needs_sign_in: false,
    });
  });

  it('does not count an anonymous session as an account', () => {
    auth.session = { user: { is_anonymous: true } };

    render(<AssistantPage />, { withProviders: false });

    expect(mockUseAssistantChat).toHaveBeenLastCalledWith({ accountSignedIn: false });
  });

  it('reports an answer under the kikouchou provider, with no made-up cost', async () => {
    auth.session = { user: { is_anonymous: false } };
    mockUseAssistantChat.mockReturnValue(chat({ status: 'ready' }));
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(
      await screen.findByRole('button', { name: 'assistant.starters.explorePlan' }),
    );

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith('$ai_generation', expect.anything());
    });
    const generation = mockCapture.mock.calls.find(([name]) => name === '$ai_generation')![1] as Record<string, unknown>;
    expect(generation.$ai_provider).toBe('kikouchou');
    expect(generation.$ai_model).toBe('kikouchou/assistant');
    expect(generation).not.toHaveProperty('$ai_total_cost_usd');
  });

  it('says the assistant is unavailable in a build with no accounts', () => {
    supabase.configured = false;

    render(<AssistantPage />, { withProviders: false });

    expect(screen.getByText('assistant.unavailable.title')).toBeInTheDocument();
    expect(screen.getByText('assistant.unavailable.description')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'assistant.account.signIn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
