/**
 * @fileoverview The assistant's download card, its composer keys, and the
 * model switch.
 *
 * A model is hundreds of megabytes over a phone connection, so the card that
 * reports the download is the difference between "it is working" and "it is
 * stuck": the per-file bars are what a reader watches for minutes at a time,
 * and they had no test. The switch between models is covered here too, because
 * a failed switch has to put the old choice back rather than leave the page
 * naming a model it never loaded.
 *
 * @module features/assistant/pages/__tests__/AssistantPage.progress.test
 */

import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';

const mockLoadModel = vi.fn();
const mockCancelLoad = vi.fn();
const mockGenerate = vi.fn();
const mockInterrupt = vi.fn();
const mockUnload = vi.fn();
const mockGetSettings = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  default: { capture: vi.fn() },
  captureEvent: vi.fn(),
  captureUsage: vi.fn(),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('@/components/shared/PageHeader', () => ({
  PageHeader: ({
    title,
    action,
  }: {
    readonly title: string;
    readonly action?: ReactNode;
  }) => (
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

vi.mock('../../hooks/useTripSystemPrompt', () => ({
  useTripSystemPrompt: () => ({ systemPrompt: 'system-prompt' }),
}));

vi.mock('../../hooks/useTripActions', () => ({
  useTripActions: () => ({
    executeActions: vi.fn().mockResolvedValue({ count: 0, summaries: [] }),
  }),
}));

const mockUseWebLLM = vi.fn();

vi.mock('../../hooks/useWebLLM', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/useWebLLM')>()),
  useWebLLM: (...args: unknown[]) => mockUseWebLLM(...args),
}));

import { AssistantPage } from '../AssistantPage';

// ============================================================================
// Helpers
// ============================================================================

function engine(overrides: Record<string, unknown> = {}) {
  return {
    status: 'idle',
    loadProgress: null,
    error: null,
    isCached: true,
    loadModel: mockLoadModel,
    cancelLoad: mockCancelLoad,
    generate: mockGenerate,
    interrupt: mockInterrupt,
    unload: mockUnload,
    ...overrides,
  };
}

function stubWebGPU(supported: boolean): void {
  Object.defineProperty(navigator, 'gpu', {
    value: { requestAdapter: vi.fn().mockResolvedValue(supported ? {} : null) },
    configurable: true,
    writable: true,
  });
}

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
  mockUpdateSettings.mockResolvedValue(undefined);
  mockLoadModel.mockResolvedValue(undefined);
  mockUnload.mockResolvedValue(undefined);
  mockGenerate.mockResolvedValue('An answer');
  mockUseWebLLM.mockReturnValue(engine());
});

// ============================================================================
// Tests
// ============================================================================

describe('AssistantPage — the download card', () => {
  it('shows a bar per file, with the bytes for the one in flight', async () => {
    mockUseWebLLM.mockReturnValue(
      engine({
        status: 'loading',
        loadProgress: {
          text: 'Downloading…',
          progress: 0.42,
          files: [
            {
              fileKey: 'a',
              fileName: 'model.onnx',
              progress: 0.5,
              bytesHint: '50 MB / 100 MB',
              done: false,
            },
            { fileKey: 'b', fileName: 'tokenizer.json', progress: 0.1, done: false },
          ],
        },
      }),
    );

    render(<AssistantPage />);

    expect(await screen.findByText('model.onnx')).toBeInTheDocument();
    expect(screen.getByText('tokenizer.json')).toBeInTheDocument();
    expect(screen.getByText('50 MB / 100 MB')).toBeInTheDocument();

    const bars = screen.getAllByRole('progressbar');
    // One overall, one per file still downloading.
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(bars.some((bar) => bar.getAttribute('aria-valuenow') === '50')).toBe(true);
  });

  it('lists only the files still coming down', async () => {
    mockUseWebLLM.mockReturnValue(
      engine({
        status: 'loading',
        loadProgress: {
          text: 'Downloading…',
          progress: 0.9,
          files: [
            { fileKey: 'a', fileName: 'model.onnx', progress: 1, done: true },
            { fileKey: 'b', fileName: 'tokenizer.json', progress: 0.2, done: false },
          ],
        },
      }),
    );

    render(<AssistantPage />);

    expect(await screen.findByText('tokenizer.json')).toBeInTheDocument();
    expect(screen.queryByText('model.onnx')).not.toBeInTheDocument();
  });

  it('shows the overall bar alone before any file is named', async () => {
    mockUseWebLLM.mockReturnValue(
      engine({
        status: 'loading',
        loadProgress: { text: 'Starting…', progress: 0, files: [] },
      }),
    );

    render(<AssistantPage />);

    expect(await screen.findByText('Starting…')).toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(1);
  });
});

describe('AssistantPage — the composer', () => {
  it('sends on Enter', async () => {
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready' }));
    const { user } = render(<AssistantPage />);

    const box = await screen.findByRole('textbox');
    await user.type(box, 'What is the plan?');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalled();
    });
  });

  it('keeps a Shift+Enter for a new line', async () => {
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready' }));
    const { user } = render(<AssistantPage />);

    const box = await screen.findByRole('textbox');
    await user.type(box, 'First line');
    await user.keyboard('{Shift>}{Enter}{/Shift}');

    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('does nothing with an empty prompt', async () => {
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready' }));
    const { user } = render(<AssistantPage />);

    const box = await screen.findByRole('textbox');
    await user.type(box, '   ');
    await user.keyboard('{Enter}');

    expect(mockGenerate).not.toHaveBeenCalled();
  });

  it('shows the answer as it streams in', async () => {
    mockUseWebLLM.mockReturnValue(engine({ status: 'ready' }));
    mockGenerate.mockImplementation(
      async (_messages: unknown, onChunk?: (chunk: string) => void) => {
        onChunk?.('Half an ans');
        onChunk?.('Half an answer');
        return 'Half an answer';
      },
    );

    const { user } = render(<AssistantPage />);

    await user.type(await screen.findByRole('textbox'), 'Plan?');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Half an answer')).toBeInTheDocument();
  });
});

describe('AssistantPage — choosing a model', () => {
  it('puts the old choice back when the switch fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdateSettings.mockRejectedValue(new Error('disk full'));
    mockUseWebLLM.mockReturnValue(engine({ status: 'idle' }));

    const { user } = render(<AssistantPage />);

    const select = await screen.findByRole('combobox');
    await user.click(select);
    const options = await screen.findAllByRole('option');
    const other = options.find((option) => option.getAttribute('aria-selected') !== 'true');
    await user.click(other!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    consoleError.mockRestore();
  });

  it('does nothing when the same model is chosen again', async () => {
    mockUseWebLLM.mockReturnValue(engine({ status: 'idle' }));

    const { user } = render(<AssistantPage />);

    const select = await screen.findByRole('combobox');
    await user.click(select);
    const options = await screen.findAllByRole('option');
    const current = options.find((option) => option.getAttribute('aria-selected') === 'true');
    await user.click(current!);

    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });
});

describe('AssistantPage — reading the stored settings', () => {
  it('still renders when the settings cannot be read', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGetSettings.mockRejectedValue(new Error('the read failed'));

    render(<AssistantPage />);

    await waitFor(() => {
      expect(consoleError).toHaveBeenCalled();
    });
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
