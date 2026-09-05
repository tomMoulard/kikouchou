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
