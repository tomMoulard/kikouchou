import type { ReactNode } from 'react';

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';

const mockLoadModel = vi.fn().mockResolvedValue(undefined);
const mockGenerate = vi.fn();
const mockInterrupt = vi.fn();
const mockUnload = vi.fn().mockResolvedValue(undefined);
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn().mockResolvedValue(undefined);

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

vi.mock('../../hooks/useWebLLM', () => ({
  useWebLLM: (...args: unknown[]) => mockUseWebLLM(...args),
}));

import { AssistantPage } from '../AssistantPage';

describe('AssistantPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
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

  it('renders the assistant model selector and load button', async () => {
    render(<AssistantPage />, { withProviders: false });

    expect(
      screen.getByRole('combobox', { name: 'assistant.modelLabel' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'assistant.loadModel' }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mockGetSettings).toHaveBeenCalledTimes(1);
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
    await user.click(await screen.findByText('assistant.models.gemma-3-1b.name'));

    await waitFor(() => {
      expect(mockUnload).toHaveBeenCalledTimes(1);
      expect(mockUpdateSettings).toHaveBeenCalledWith({
        assistantModelId: 'gemma-3-1b',
      });
    });
  });
});
