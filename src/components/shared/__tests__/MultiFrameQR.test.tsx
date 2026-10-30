/**
 * @fileoverview Tests for MultiFrameQR component.
 * @module components/shared/__tests__/MultiFrameQR.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MultiFrameQR } from '../MultiFrameQR';
import { statusVariants } from '@/components/ui/status.variants';
import { notify } from '@/lib/notifications';

// Mock QRCodeCanvas
vi.mock('qrcode.react', () => ({
  QRCodeCanvas: vi.fn(({ value }: { value: string }) => (
    <canvas data-testid="qr-canvas" data-value={value} />
  )),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock i18next: the English fallback on screen, and the key on record.
const { translate } = vi.hoisted(() => ({
  translate: vi.fn((key: string, fallback?: string) => fallback ?? key),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

// The confirmation goes through the notification facade.
vi.mock('@/lib/notifications', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

describe('MultiFrameQR', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders single-frame QR code without navigation', () => {
    render(<MultiFrameQR frames={['frame-1']} rawPayload="payload" />);

    expect(screen.getByTestId('qr-canvas')).toBeInTheDocument();
    expect(screen.queryByLabelText('Previous frame')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Next frame')).not.toBeInTheDocument();
  });

  it('hides QR and navigation when payload is split into multiple frames', () => {
    render(<MultiFrameQR frames={['frame-1', 'frame-2', 'frame-3']} rawPayload="payload" />);

    expect(screen.queryByTestId('qr-canvas')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Previous frame')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Next frame')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'This export is too large for a scannable QR code. Copy the text below and paste it on the other device to import.',
      ),
    ).toBeInTheDocument();
  });

  it('renders copy-as-text button for single frame', () => {
    render(<MultiFrameQR frames={['f1']} rawPayload="the-payload" />);

    expect(screen.getByText('Copy as text')).toBeInTheDocument();
  });

  it('renders copy-as-text button when only copy mode (multi-frame)', () => {
    render(<MultiFrameQR frames={['a', 'b']} rawPayload="full" />);

    expect(screen.getByText('Copy as text')).toBeInTheDocument();
  });

  it('copies payload to clipboard on copy button click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MultiFrameQR frames={['f1']} rawPayload="the-payload" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(writeText).toHaveBeenCalledWith('the-payload');
  });

  it('copies full raw payload in multi-frame mode', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MultiFrameQR frames={['p1', 'p2']} rawPayload="FULL-PAYLOAD" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(writeText).toHaveBeenCalledWith('FULL-PAYLOAD');
  });

  it('shows copied state after successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MultiFrameQR frames={['f1']} rawPayload="payload" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(screen.getByText('Copied!')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Copy as text')).toBeInTheDocument();
  });

  it('falls back to execCommand when clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });

    const execCommandMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: execCommandMock,
      writable: true,
      configurable: true,
    });

    render(<MultiFrameQR frames={['f1']} rawPayload="test-data" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(execCommandMock).toHaveBeenCalledWith('copy');
  });

  it('applies custom className', () => {
    const { container } = render(
      <MultiFrameQR frames={['f1']} rawPayload="payload" className="custom-class" />,
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });
});

describe('MultiFrameQR, more of it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(notify.success).mockClear();
    vi.mocked(notify.error).mockClear();
    translate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Makes the clipboard API refuse, so the textarea fallback runs. */
  function refuseClipboard(): void {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
  }

  it('encodes the one frame it is given, and nothing for none', () => {
    const { unmount } = render(<MultiFrameQR frames={['frame-1']} rawPayload="payload" />);
    expect(screen.getByTestId('qr-canvas')).toHaveAttribute('data-value', 'frame-1');
    unmount();

    render(<MultiFrameQR frames={[]} rawPayload="payload" />);
    expect(screen.getByTestId('qr-canvas')).toHaveAttribute('data-value', '');
  });

  it('confirms a copy, with a tick in the success tone', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const { container } = render(<MultiFrameQR frames={['f1']} rawPayload="payload" />);
    expect(container.firstChild).toHaveClass('flex', 'flex-col', 'items-center', 'gap-4');
    expect(translate).toHaveBeenCalledWith('sharing.sync.copyAsText', 'Copy as text');
    expect(screen.getByRole('button').querySelector('svg')).toHaveClass('mr-2', 'h-4', 'w-4');

    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(notify.success).toHaveBeenCalledWith('Copied to clipboard');
    expect(translate).toHaveBeenCalledWith('sharing.sync.copiedToClipboard', 'Copied to clipboard');
    expect(translate).toHaveBeenCalledWith('sharing.sync.copied', 'Copied!');
    const tick = screen.getByRole('button').querySelector('svg');
    expect(tick).toHaveClass('mr-2', 'h-4', 'w-4');
    for (const cls of statusVariants({ tone: 'success', emphasis: 'text' }).split(/\s+/).filter(Boolean)) {
      expect(tick).toHaveClass(cls);
    }
  });

  it('names the reason there is no code under its key', () => {
    render(<MultiFrameQR frames={['a', 'b']} rawPayload="full" />);

    expect(translate).toHaveBeenCalledWith('sharing.sync.payloadTooLargeForQr', expect.any(String));
  });

  it('copies through a hidden, selected textarea when the clipboard API refuses', async () => {
    refuseClipboard();
    let seen: { value: string; position: string; opacity: string; inDocument: boolean; selected: string } | null = null;
    const execCommand = vi.fn(() => {
      const textarea = document.querySelector('textarea');
      seen = textarea
        ? {
            value: textarea.value,
            position: textarea.style.position,
            opacity: textarea.style.opacity,
            inDocument: textarea.isConnected,
            selected: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
          }
        : null;
      return true;
    });
    Object.defineProperty(document, 'execCommand', { value: execCommand, writable: true, configurable: true });

    render(<MultiFrameQR frames={['f1']} rawPayload="test-data" />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(seen).toEqual({
      value: 'test-data',
      position: 'fixed',
      opacity: '0',
      inDocument: true,
      selected: 'test-data',
    });
    expect(document.querySelector('textarea')).toBeNull();
    expect(screen.getByText('Copied!')).toBeInTheDocument();
    expect(notify.success).toHaveBeenCalledWith('Copied to clipboard');
    expect(translate).toHaveBeenCalledWith('sharing.sync.copiedToClipboard', 'Copied to clipboard');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Copy as text')).toBeInTheDocument();
  });

  it('says the copy failed when the fallback fails too', async () => {
    refuseClipboard();
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn(() => {
        throw new Error('no copy here');
      }),
      writable: true,
      configurable: true,
    });

    render(<MultiFrameQR frames={['f1']} rawPayload="test-data" />);
    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(notify.error).toHaveBeenCalledWith('Failed to copy');
    expect(translate).toHaveBeenCalledWith('sharing.sync.copyFailed', 'Failed to copy');
    expect(screen.queryByText('Copied!')).not.toBeInTheDocument();
  });

  it('copies the payload it holds now', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { rerender } = render(<MultiFrameQR frames={['f1']} rawPayload="old" />);
    rerender(<MultiFrameQR frames={['f1']} rawPayload="new" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(writeText).toHaveBeenCalledWith('new');
  });
});
