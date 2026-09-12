/**
 * @fileoverview The scanner's way out when the camera is not an option.
 *
 * A borrowed laptop, a denied permission, a desktop with no camera: the whole
 * sharing flow dead-ends there unless the exported data can be pasted in. The
 * sibling file covers the camera teardown; this one covers the escape hatch and
 * the message shown when the camera itself refuses.
 *
 * The library is faked, which is the only seam the component has — it never
 * touches `navigator.mediaDevices` itself.
 *
 * @module components/shared/__tests__/QRScanner.paste.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen, waitFor } from '@/test/utils';

// ============================================================================
// Camera boundary fake
// ============================================================================

/** What `start()` should do, set per test. */
let startBehaviour: 'ok' | 'error' | 'non-error' = 'ok';

class FakeHtml5Qrcode {
  public isScanning = false;
  private readonly elementId: string;

  constructor(elementId: string) {
    this.elementId = elementId;
  }

  async start(): Promise<void> {
    if (startBehaviour === 'error') {
      throw new Error('Permission denied');
    }
    if (startBehaviour === 'non-error') {
      throw 'nope';
    }

    const parent = document.getElementById(this.elementId);
    if (!parent) throw new Error(`missing scanner region ${this.elementId}`);

    const video = document.createElement('video');
    parent.appendChild(video);
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    Object.defineProperty(video, 'readyState', { value: 3, configurable: true });
    this.isScanning = true;
  }

  async stop(): Promise<void> {
    this.isScanning = false;
  }
}

vi.mock('html5-qrcode', () => ({ Html5Qrcode: FakeHtml5Qrcode }));

import { QRScanner } from '../QRScanner';

// ============================================================================
// Tests
// ============================================================================

describe('QRScanner — pasting instead of scanning', () => {
  beforeEach(() => {
    startBehaviour = 'ok';
  });

  it('offers the paste box and takes the pasted data', async () => {
    const onScan = vi.fn();
    const { user } = render(<QRScanner onScan={onScan} />);

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));

    const box = screen.getByRole('textbox');
    // Nothing to import yet.
    expect(screen.getByRole('button', { name: /sharing.sync.importPasted/i })).toBeDisabled();

    await user.type(box, '  pasted-payload  ');
    await user.click(screen.getByRole('button', { name: /sharing.sync.importPasted/i }));

    // Trimmed: a pasted blob usually arrives with a newline on the end.
    expect(onScan).toHaveBeenCalledWith('pasted-payload');
  });

  it('keeps the Import button dead for whitespace alone', async () => {
    const onScan = vi.fn();
    const { user } = render(<QRScanner onScan={onScan} />);

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));
    await user.type(screen.getByRole('textbox'), '   ');

    expect(screen.getByRole('button', { name: /sharing.sync.importPasted/i })).toBeDisabled();
    expect(onScan).not.toHaveBeenCalled();
  });

  it('goes back to the camera again', async () => {
    const { user } = render(<QRScanner onScan={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToCamera/i }));

    await waitFor(() => {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });
});

describe('QRScanner — when the camera refuses', () => {
  it('shows what the browser said and tells the caller', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    startBehaviour = 'error';
    const onError = vi.fn();

    render(<QRScanner onScan={vi.fn()} onError={onError} />);

    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(onError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('falls back to its own words when the failure says nothing', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    startBehaviour = 'non-error';

    render(<QRScanner onScan={vi.fn()} />);

    expect(await screen.findByText('Camera access denied')).toBeInTheDocument();
    consoleError.mockRestore();
  });

  it('still offers the paste box after the camera failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    startBehaviour = 'error';
    const onScan = vi.fn();

    const { user } = render(<QRScanner onScan={onScan} />);

    await screen.findByText('Permission denied');
    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));
    await user.type(screen.getByRole('textbox'), 'payload');
    await user.click(screen.getByRole('button', { name: /sharing.sync.importPasted/i }));

    expect(onScan).toHaveBeenCalledWith('payload');
    consoleError.mockRestore();
  });
});
