/**
 * @fileoverview Tests for MultiFrameQR component.
 * @module components/shared/__tests__/MultiFrameQR.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MultiFrameQR } from '../MultiFrameQR';

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

// Mock i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
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

  it('renders multi-frame with navigation controls', () => {
    render(<MultiFrameQR frames={['frame-1', 'frame-2', 'frame-3']} rawPayload="payload" />);

    expect(screen.getByLabelText('Previous frame')).toBeInTheDocument();
    expect(screen.getByLabelText('Next frame')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('navigates to next frame on button click', () => {
    render(<MultiFrameQR frames={['f1', 'f2', 'f3']} rawPayload="payload" autoAdvanceMs={0} />);

    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next frame'));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Next frame'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    // Wraps around
    fireEvent.click(screen.getByLabelText('Next frame'));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('navigates to previous frame on button click', () => {
    render(<MultiFrameQR frames={['f1', 'f2', 'f3']} rawPayload="payload" autoAdvanceMs={0} />);

    // Wraps around to last
    fireEvent.click(screen.getByLabelText('Previous frame'));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
  });

  it('auto-advances frames', () => {
    render(<MultiFrameQR frames={['f1', 'f2', 'f3']} rawPayload="payload" autoAdvanceMs={1000} />);

    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('2 / 3')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('does not auto-advance when autoAdvanceMs is 0', () => {
    render(<MultiFrameQR frames={['f1', 'f2']} rawPayload="payload" autoAdvanceMs={0} />);

    expect(screen.getByText('1 / 2')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('renders copy-as-text button', () => {
    render(<MultiFrameQR frames={['f1']} rawPayload="the-payload" />);

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

  it('shows copied state after successful copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MultiFrameQR frames={['f1']} rawPayload="payload" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy as text'));
    });

    expect(screen.getByText('Copied!')).toBeInTheDocument();

    // Resets after 2s
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Copy as text')).toBeInTheDocument();
  });

  it('falls back to execCommand when clipboard API fails', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.assign(navigator, { clipboard: { writeText } });

    // Define execCommand on document for the fallback path
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
