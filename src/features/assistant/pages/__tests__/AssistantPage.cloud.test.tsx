/**
 * @fileoverview AssistantPage with a cloud (OpenRouter) preset selected.
 * @module features/assistant/pages/__tests__/AssistantPage.cloud.test
 */

import { type ReactNode } from 'react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

const mockConnect = vi.fn().mockResolvedValue(undefined);
const mockDisconnect = vi.fn();
const mockGenerate = vi.fn();
const mockGetSettings = vi.fn();
const mockCapture = vi.fn();
const mockNotifySuccess = vi.fn();
const mockNotifyError = vi.fn();
const mockConsumeCallback = vi.fn();
const mockCompleteConnect = vi.fn();
const mockUseWebLLM = vi.fn();

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  default: { capture: (...args: unknown[]) => mockCapture(...args) },
  captureEvent: (...args: unknown[]) => mockCapture(...args),
  captureUsage: (action: string, properties?: unknown) => {
    mockCapture(action, properties);
    mockCapture('app_used', { action });
  },
}));

vi.mock('@/lib/notifications', () => ({
  notify: {
    success: (...args: unknown[]) => mockNotifySuccess(...args),
    error: (...args: unknown[]) => mockNotifyError(...args),
  },
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
  updateSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../hooks/useTripSystemPrompt', () => ({
  useTripSystemPrompt: () => ({
    systemPrompt: 'system-prompt',
    buildSystemPrompt: () => 'system-prompt',
  }),
}));

vi.mock('../../hooks/useTripActions', () => ({
  useTripActions: () => ({
    executeActions: vi.fn().mockResolvedValue({ count: 0, summaries: [] }),
  }),
}));

vi.mock('../../openrouter/callback', () => ({
  consumeOpenRouterCallback: () => mockConsumeCallback(),
}));

vi.mock('../../openrouter/auth', () => ({
  completeOpenRouterConnect: (...args: unknown[]) => mockCompleteConnect(...args),
}));

vi.mock('../../hooks/useWebLLM', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useWebLLM')>()),
  useWebLLM: (...args: unknown[]) => mockUseWebLLM(...args),
}));

import { AssistantPage } from '../AssistantPage';

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
    connect: mockConnect,
    disconnect: mockDisconnect,
    ...overrides,
  };
}

describe('AssistantPage with a cloud model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    // No WebGPU at all: the cloud presets exist for exactly this device.
    Reflect.deleteProperty(navigator, 'gpu');
    mockGetSettings.mockResolvedValue({ assistantModelId: 'cloud-claude-haiku' });
    mockConsumeCallback.mockReturnValue(null);
    mockUseWebLLM.mockReturnValue(engine());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers the OpenRouter sign-in, with the privacy notice, on a device without WebGPU', async () => {
    const { user } = render(<AssistantPage />, { withProviders: false });

    const button = await screen.findByRole('button', { name: 'assistant.cloud.connect' });
    expect(screen.getByText('assistant.cloud.privacyNotice')).toBeInTheDocument();
    // Neither the download nor the device gate belongs to a cloud model.
    expect(screen.queryByRole('button', { name: 'assistant.loadModel' })).not.toBeInTheDocument();
    expect(screen.queryByText('assistant.deviceUnsupportedTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('assistant.modelDownloadSize')).not.toBeInTheDocument();

    await user.click(button);

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('names a cloud option once, without its id, and keeps the id on a local one', async () => {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    const { user } = render(<AssistantPage />, { withProviders: false });
    await screen.findByRole('button', { name: 'assistant.cloud.connect' });

    await user.click(screen.getByRole('combobox', { name: 'assistant.modelLabel' }));

    const auto = await screen.findByRole('option', { name: /assistant\.models\.cloud-auto\.name/ });
    expect(auto).toHaveTextContent(/^assistant\.models\.cloud-auto\.nameassistant\.cloud\.badge$/);
    expect(
      screen.getByRole('option', { name: /assistant\.models\.qwen3-1-7b\.name/ }),
    ).toHaveTextContent('(qwen3-1-7b)');
  });

  it('shows why the user is back on the connect card', async () => {
    mockUseWebLLM.mockReturnValue(engine({ error: 'Your OpenRouter connection is no longer valid.' }));

    render(<AssistantPage />, { withProviders: false });

    // The page opens on the default preset until settings load, and that card
    // shows the error too; wait for the cloud card before reading it.
    await screen.findByRole('button', { name: 'assistant.cloud.connect' });
    expect(
      screen.getByText('Your OpenRouter connection is no longer valid.'),
    ).toBeInTheDocument();
  });

  it('offers to disconnect once connected', async () => {
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready', isCached: true }));
    const { user } = render(<AssistantPage />, { withProviders: false });

    await user.click(
      await screen.findByRole('button', { name: 'assistant.cloud.disconnect' }),
    );

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('reports a cloud answer under the openrouter provider, with no made-up cost', async () => {
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready', isCached: true }));
    mockGenerate.mockResolvedValue('Alice sleeps in the Attic.');
    const { user } = render(<AssistantPage />, { withProviders: false });

    await waitFor(() => expect(mockUseWebLLM).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: 'cloud-claude-haiku' }),
    ));
    await user.type(screen.getByRole('textbox'), 'Who sleeps where?');
    await user.click(screen.getByRole('button', { name: 'assistant.send' }));

    await waitFor(() => {
      expect(mockCapture).toHaveBeenCalledWith('$ai_generation', expect.anything());
    });
    const generation = mockCapture.mock.calls.find(([name]) => name === '$ai_generation')![1] as Record<string, unknown>;
    expect(generation.$ai_provider).toBe('openrouter');
    expect(generation.$ai_model).toBe('anthropic/claude-haiku-4.5');
    expect(generation).not.toHaveProperty('$ai_total_cost_usd');
  });

  it('finishes a sign-in that came back from openrouter.ai', async () => {
    mockConsumeCallback.mockReturnValue({ code: 'c', state: 's' });
    mockCompleteConnect.mockResolvedValue({ ok: true });

    render(<AssistantPage />, { withProviders: false });

    await waitFor(() => expect(mockNotifySuccess).toHaveBeenCalledWith('assistant.cloud.connected'));
    expect(mockCompleteConnect).toHaveBeenCalledWith({ code: 'c', state: 's' });
    expect(mockCapture).toHaveBeenCalledWith('assistant_provider_connected', { provider: 'openrouter' });
  });

  it('says so when the sign-in could not be finished, and why in analytics', async () => {
    mockConsumeCallback.mockReturnValue({ code: 'c', state: 'forged' });
    mockCompleteConnect.mockResolvedValue({ ok: false, reason: 'state-mismatch' });

    render(<AssistantPage />, { withProviders: false });

    await waitFor(() => expect(mockNotifyError).toHaveBeenCalledWith('assistant.cloud.connectFailed'));
    expect(mockCapture).toHaveBeenCalledWith('assistant_provider_connect_failed', {
      provider: 'openrouter',
      reason: 'state-mismatch',
    });
  });
});
