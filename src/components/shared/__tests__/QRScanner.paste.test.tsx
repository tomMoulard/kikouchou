/**
 * @fileoverview The scanner's way out when the camera is not an option.
 *
 * A borrowed laptop, a denied permission, a desktop with no camera: the whole
 * sharing flow dead-ends there unless the exported data can be pasted in. The
 * sibling file covers the camera teardown; this one covers the escape hatch and
 * what the scanner says when the camera itself refuses — which is its own words
 * per kind of refusal, and never the library's.
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
let startBehaviour: 'ok' | 'blocked' | 'busy' | 'missing' | 'non-error' = 'ok';

/** How many times `start()` has been called, to see a retry actually retry. */
let startCalls = 0;

class FakeHtml5Qrcode {
  public isScanning = false;
  private readonly elementId: string;

  constructor(elementId: string) {
    this.elementId = elementId;
  }

  async start(): Promise<void> {
    startCalls += 1;
    if (startBehaviour === 'blocked') {
      // The shape html5-qrcode actually rejects with: the DOMException's name
      // inside the text of a plain Error, not on `error.name`.
      throw new Error(
        'Error getting userMedia, error = NotAllowedError: The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.',
      );
    }
    if (startBehaviour === 'missing') {
      throw new Error('Error getting userMedia, error = NotFoundError: Requested device not found');
    }
    if (startBehaviour === 'busy') {
      throw new Error('Error getting userMedia, error = NotReadableError: Could not start video source');
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
    startCalls = 0;
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
  beforeEach(() => {
    startCalls = 0;
  });

  it('says the camera is blocked, and how to lift it, rather than quoting the library', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    startBehaviour = 'blocked';
    const onError = vi.fn();

    render(<QRScanner onScan={vi.fn()} onError={onError} />);

    expect(await screen.findByText('sharing.sync.cameraBlockedTitle')).toBeInTheDocument();
    expect(screen.getByText('sharing.sync.cameraBlockedHint')).toBeInTheDocument();
    expect(screen.queryByText(/NotAllowedError/)).not.toBeInTheDocument();
    expect(onError).toHaveBeenCalledWith('sharing.sync.cameraBlockedTitle');

    // A permission the visitor turned down is not an error this app can fix,
    // and `console.error` is what files a PostHog issue.
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });

  it('sends a device with no camera straight to the paste box', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'missing';

    render(<QRScanner onScan={vi.fn()} />);

    expect(await screen.findByText('sharing.sync.cameraMissingTitle')).toBeInTheDocument();
    expect(screen.getByText('sharing.sync.cameraMissingHint')).toBeInTheDocument();
    consoleWarn.mockRestore();
  });

  it('names the camera another app is holding', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'busy';

    render(<QRScanner onScan={vi.fn()} />);

    expect(await screen.findByText('sharing.sync.cameraBusyTitle')).toBeInTheDocument();
    consoleWarn.mockRestore();
  });

  it('keeps its own words, and the console.error, for a failure it cannot name', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    startBehaviour = 'non-error';

    render(<QRScanner onScan={vi.fn()} />);

    expect(await screen.findByText('sharing.sync.cameraFailedTitle')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('asks the camera again when the tile is tapped', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';

    const { user } = render(<QRScanner onScan={vi.fn()} />);

    await screen.findByText('sharing.sync.cameraBlockedTitle');
    const callsBeforeRetry = startCalls;

    await user.click(screen.getByRole('button', { name: /cameraBlockedTitle/i }));

    await waitFor(() => {
      expect(startCalls).toBeGreaterThan(callsBeforeRetry);
    });
    // Still blocked, so the tile comes back rather than leaving an empty box.
    expect(await screen.findByText('sharing.sync.cameraBlockedTitle')).toBeInTheDocument();
    consoleWarn.mockRestore();
  });

  it('still offers the paste box after the camera failed', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';
    const onScan = vi.fn();

    const { user } = render(<QRScanner onScan={onScan} />);

    await screen.findByText('sharing.sync.cameraBlockedTitle');
    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));
    await user.type(screen.getByRole('textbox'), 'payload');
    await user.click(screen.getByRole('button', { name: /sharing.sync.importPasted/i }));

    expect(onScan).toHaveBeenCalledWith('payload');
    consoleWarn.mockRestore();
  });
});
