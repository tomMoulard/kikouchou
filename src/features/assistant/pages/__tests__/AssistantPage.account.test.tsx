/**
 * @fileoverview AssistantPage with the account model: the onboarding arm's
 * landing, the starter questions and the sign-in they lead to.
 * @module features/assistant/pages/__tests__/AssistantPage.account.test
 */

import { type ReactNode } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

import { installLocalStorageDouble } from '@/test/local-storage';

import { PENDING_PROMPT_STORAGE_KEY } from '../../pending-prompt';

const mockGenerate = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();
const mockCapture = vi.fn();
const mockUseWebLLM = vi.fn();

const auth = vi.hoisted(() => ({ session: null as unknown }));
const entry = vi.hoisted(() => ({ via: 'other' as string }));

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

vi.mock('@/lib/db', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateSettings: (...args: unknown[]) => mockUpdateSettings(...args),
}));

vi.mock('@/lib/supabase/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/supabase/client')>()),
  isSupabaseConfigured: () => true,
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

vi.mock('@/hooks/useSampleTripViewReport', () => ({
  readVia: () => entry.via,
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

vi.mock('../../openrouter/callback', () => ({
  consumeOpenRouterCallback: () => null,
  onOpenRouterCallback: () => () => {},
}));

vi.mock('../../openrouter/auth', () => ({
  completeOpenRouterConnect: vi.fn(),
}));

vi.mock('../../hooks/useWebLLM', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useWebLLM')>()),
  useWebLLM: (...args: unknown[]) => mockUseWebLLM(...args),
}));

import { AssistantPage } from '../AssistantPage';

const storage = installLocalStorageDouble();

function engine(overrides: Record<string, unknown> = {}) {
  return {
    status: 'idle',
    loadProgress: null,
    error: null,
    isCached: false,
    loadModel: vi.fn().mockResolvedValue(undefined),
    cancelLoad: vi.fn(),
    generate: mockGenerate,
    interrupt: vi.fn(),
    unload: vi.fn().mockResolvedValue(undefined),
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  };
}

function lastPresetId(): string | undefined {
  const call = mockUseWebLLM.mock.calls.at(-1) as [{ id: string }] | undefined;
  return call?.[0].id;
}

describe('AssistantPage with the account model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    auth.session = null;
    entry.via = 'other';
    mockGetSettings.mockResolvedValue({});
    mockUpdateSettings.mockResolvedValue(undefined);
    mockGenerate.mockResolvedValue('Done.');
    mockUseWebLLM.mockReturnValue(engine());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens on the account model, with the starters, when `/` sent the visitor here', async () => {
    entry.via = 'entry';

    render(<AssistantPage />, { withProviders: false });

    await waitFor(() => expect(lastPresetId()).toBe('cloud-kikouchou'));
    expect(
      screen.getByRole('group', { name: 'assistant.starters.label' }),
    ).toBeInTheDocument();
    expect(screen.getByText('assistant.account.privacyNotice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'assistant.loadModel' })).not.toBeInTheDocument();
    // Shown, not saved: nothing was asked yet.
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('keeps the stored model over the arm, and the default for anyone else', async () => {
    entry.via = 'entry';
    mockGetSettings.mockResolvedValue({ assistantModelId: 'cloud-auto' });
    const { unmount } = render(<AssistantPage />, { withProviders: false });
    await waitFor(() => expect(lastPresetId()).toBe('cloud-auto'));
    unmount();

    entry.via = 'other';
    mockGetSettings.mockResolvedValue({});
    mockUseWebLLM.mockClear();
    render(<AssistantPage />, { withProviders: false });
    await waitFor(() => expect(mockGetSettings).toHaveBeenCalledTimes(2));
    expect(lastPresetId()).not.toBe('cloud-kikouchou');
  });

  it('asks for an account on a starter tap, and keeps the question for later', async () => {
    entry.via = 'entry';
    const { user } = render(<AssistantPage />, { withProviders: false });
    await waitFor(() => expect(lastPresetId()).toBe('cloud-kikouchou'));

    await user.click(screen.getByRole('button', { name: 'assistant.starters.createWeekend' }));

    expect(
      screen.getByRole('dialog', { name: 'assistant.account.signInTitle' }),
    ).toHaveTextContent('assistant.account.signInDetail');
    expect(JSON.parse(storage.entries.get(PENDING_PROMPT_STORAGE_KEY)!)).toMatchObject({
      text: 'assistant.starters.createWeekend',
      kind: 'create',
    });
    // The account model stays chosen through a sign-in that reloads the page.
    expect(mockUpdateSettings).toHaveBeenCalledWith({ assistantModelId: 'cloud-kikouchou' });
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalledWith('assistant_starter_picked', {
      starter_kind: 'create',
      model_id: 'cloud-kikouchou',
      needs_sign_in: true,
    });
  });

  it('opens the sign-in from its own button too', async () => {
    entry.via = 'entry';
    const { user } = render(<AssistantPage />, { withProviders: false });
    await waitFor(() => expect(lastPresetId()).toBe('cloud-kikouchou'));

    await user.click(screen.getByRole('button', { name: 'assistant.account.signIn' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mockCapture).toHaveBeenCalledWith('assistant_sign_in_requested', {
      model_id: 'cloud-kikouchou',
    });
  });

  it('sends the kept question once the account answers', async () => {
    auth.session = { user: { is_anonymous: false } };
    mockGetSettings.mockResolvedValue({ assistantModelId: 'cloud-kikouchou' });
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready', isCached: true }));
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
    expect(mockUseWebLLM).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'cloud-kikouchou' }),
      { accountSignedIn: true },
    );
  });

  it('sends a starter straight away once the chat is ready', async () => {
    auth.session = { user: { is_anonymous: false } };
    mockGetSettings.mockResolvedValue({ assistantModelId: 'cloud-kikouchou' });
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready', isCached: true }));
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

  it('does not count an anonymous session as an account', async () => {
    auth.session = { user: { is_anonymous: true } };
    mockGetSettings.mockResolvedValue({ assistantModelId: 'cloud-kikouchou' });

    render(<AssistantPage />, { withProviders: false });

    await waitFor(() =>
      expect(mockUseWebLLM).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'cloud-kikouchou' }),
        { accountSignedIn: false },
      ),
    );
  });

  it('reports an answer under the kikouchou provider', async () => {
    auth.session = { user: { is_anonymous: false } };
    mockGetSettings.mockResolvedValue({ assistantModelId: 'cloud-kikouchou' });
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready', isCached: true }));
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(
      await screen.findByRole('button', { name: 'assistant.starters.explorePlan' }),
    );

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith('$ai_generation', expect.anything());
    });
    const generation = mockCapture.mock.calls.find(([name]) => name === '$ai_generation')![1] as Record<string, unknown>;
    expect(generation.$ai_provider).toBe('kikouchou');
    expect(generation).not.toHaveProperty('$ai_total_cost_usd');
    // No OpenRouter disconnect on an account model.
    expect(screen.queryByRole('button', { name: 'assistant.cloud.disconnect' })).not.toBeInTheDocument();
  });
});
