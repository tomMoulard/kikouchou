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

import { act, render, screen, waitFor } from '@/test/utils';

// ============================================================================
// Camera boundary fake
// ============================================================================

/** What `start()` should do, set per test. */
let startBehaviour: 'ok' | 'blocked' | 'busy' | 'missing' | 'non-error' | 'gated' = 'ok';

/** How many times `start()` has been called, to see a retry actually retry. */
let startCalls = 0;

/** Settles a `gated` start: `true` lets the camera start, `false` refuses it. */
let releaseGate: ((allow: boolean) => void) | null = null;

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
    if (startBehaviour === 'gated') {
      const allow = await new Promise<boolean>((resolve) => {
        releaseGate = resolve;
      });
      if (!allow) {
        throw new Error('Error getting userMedia, error = NotAllowedError: denied');
      }
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

/**
 * Imported inside the first test rather than at the top of the file, so the
 * module's own constants (the failure copy table) are evaluated while a test
 * runs. Stryker can only test a mutant in module-level code against the tests
 * that were running when that code executed.
 */
let QRScanner: typeof import('../QRScanner').QRScanner;

beforeEach(async () => {
  ({ QRScanner } = await import('../QRScanner'));
});

// ============================================================================
// The words for each refusal
// ============================================================================

describe('QRScanner: its words for each refusal', () => {
  it('names each kind of camera failure with its own title and hint', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cases = [
      ['blocked', 'sharing.sync.cameraBlockedTitle', 'sharing.sync.cameraBlockedHint'],
      ['missing', 'sharing.sync.cameraMissingTitle', 'sharing.sync.cameraMissingHint'],
      ['busy', 'sharing.sync.cameraBusyTitle', 'sharing.sync.cameraBusyHint'],
      ['non-error', 'sharing.sync.cameraFailedTitle', 'sharing.sync.cameraFailedHint'],
    ] as const;

    for (const [behaviour, title, hint] of cases) {
      startBehaviour = behaviour;
      const onError = vi.fn();
      const { unmount } = render(<QRScanner onScan={vi.fn()} onError={onError} />);

      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.getByText(hint)).toBeInTheDocument();
      expect(onError).toHaveBeenCalledWith(title);
      unmount();
    }

    startBehaviour = 'ok';
    consoleWarn.mockRestore();
    consoleError.mockRestore();
  });
});

// ============================================================================
// Tests
// ============================================================================

describe('QRScanner — pasting instead of scanning', () => {
  beforeEach(() => {
    startBehaviour = 'ok';
    startCalls = 0;
    releaseGate = null;
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
    releaseGate = null;
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

  it('logs a recognised refusal as a warning that names it', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';

    render(<QRScanner onScan={vi.fn()} />);

    await screen.findByText('sharing.sync.cameraBlockedTitle');
    expect(consoleWarn).toHaveBeenCalledWith('QR scanner camera unavailable:', 'blocked', expect.any(Error));
    consoleWarn.mockRestore();
  });

  it('logs an unrecognised failure as an error that says what failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    startBehaviour = 'non-error';

    render(<QRScanner onScan={vi.fn()} />);

    await screen.findByText('sharing.sync.cameraFailedTitle');
    expect(screen.getByText('sharing.sync.cameraFailedHint')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith('Failed to start QR scanner:', 'nope');
    consoleError.mockRestore();
  });

  it('turns the whole scanner box into the retry tile', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'busy';

    render(<QRScanner onScan={vi.fn()} />);

    const title = await screen.findByText('sharing.sync.cameraBusyTitle');
    expect(title).toHaveClass('text-sm', 'font-medium', 'text-foreground');
    const hint = screen.getByText('sharing.sync.cameraBusyHint');
    expect(hint).toHaveClass('max-w-xs', 'text-xs');
    const retry = screen.getByText('sharing.sync.cameraRetry');
    expect(retry).toHaveClass('text-xs', 'font-medium', 'text-primary');

    const tile = screen.getByRole('button', { name: /cameraBusyTitle/i });
    expect(tile).toHaveAttribute('type', 'button');
    expect(tile).toHaveClass(
      'absolute', 'inset-0', 'flex', 'h-full', 'w-full', 'flex-col', 'items-center', 'justify-center', 'gap-2', 'p-4',
      'text-center', 'text-muted-foreground',
      'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-ring',
    );
    expect(tile.querySelector('svg')).toHaveClass('h-8', 'w-8');

    // The box keeps its height but no longer centres a loading tile.
    const box = tile.parentElement as HTMLElement;
    expect(box).toHaveClass('min-h-[280px]');
    expect(box).not.toHaveClass('flex');
    expect(box).not.toHaveClass('items-center');
    expect(screen.queryByText('sharing.sync.scannerLoading')).not.toBeInTheDocument();
    consoleWarn.mockRestore();
  });

  it('hides the failure tile in paste mode', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';

    const { user } = render(<QRScanner onScan={vi.fn()} />);
    await screen.findByText('sharing.sync.cameraBlockedTitle');

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));

    expect(screen.queryByText('sharing.sync.cameraBlockedTitle')).not.toBeInTheDocument();
    consoleWarn.mockRestore();
  });

  it('reuses the scanner region when the camera is asked again', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';

    const { user } = render(<QRScanner onScan={vi.fn()} />);
    await screen.findByText('sharing.sync.cameraBlockedTitle');

    await user.click(screen.getByRole('button', { name: /cameraBlockedTitle/i }));
    await waitFor(() => {
      expect(startCalls).toBe(2);
    });
    await screen.findByText('sharing.sync.cameraBlockedTitle');

    expect(document.querySelectorAll('[id^="qr-scanner-region-"]')).toHaveLength(1);
    consoleWarn.mockRestore();
  });

  it('shows the loading tile at once while a retry is pending', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';

    const { user } = render(<QRScanner onScan={vi.fn()} />);
    await screen.findByText('sharing.sync.cameraBlockedTitle');

    startBehaviour = 'gated';
    await user.click(screen.getByRole('button', { name: /cameraBlockedTitle/i }));

    expect(screen.queryByText('sharing.sync.cameraBlockedTitle')).not.toBeInTheDocument();
    expect(screen.getByText('sharing.sync.scannerLoading')).toBeInTheDocument();

    await waitFor(() => {
      expect(releaseGate).not.toBeNull();
    });
    act(() => {
      releaseGate?.(true);
    });
    await waitFor(() => {
      expect(screen.queryByText('sharing.sync.scannerLoading')).not.toBeInTheDocument();
    });
    consoleWarn.mockRestore();
  });

  it('clears the failure when the camera starts after a trip through paste mode', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';

    const { user } = render(<QRScanner onScan={vi.fn()} />);
    await screen.findByText('sharing.sync.cameraBlockedTitle');

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));
    startBehaviour = 'ok';
    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToCamera/i }));

    await waitFor(() => {
      expect(startCalls).toBe(2);
    });
    await waitFor(() => {
      expect(screen.queryByText('sharing.sync.cameraBlockedTitle')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('sharing.sync.scannerLoading')).not.toBeInTheDocument();
    consoleWarn.mockRestore();
  });

  it('says nothing through onError once the scanner is gone', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'gated';
    const onError = vi.fn();

    const { unmount } = render(<QRScanner onScan={vi.fn()} onError={onError} />);
    await waitFor(() => {
      expect(releaseGate).not.toBeNull();
    });

    unmount();
    await act(async () => {
      releaseGate?.(false);
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    expect(onError).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('reports a failure to the newest onError, on a restart and on a retry', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    startBehaviour = 'blocked';
    const first = vi.fn();
    const second = vi.fn();

    const { rerender, user } = render(<QRScanner onScan={vi.fn()} onError={first} />);
    await waitFor(() => {
      expect(first).toHaveBeenCalledTimes(1);
    });

    rerender(<QRScanner onScan={vi.fn()} onError={second} />);
    await waitFor(() => {
      expect(second).toHaveBeenCalledTimes(1);
    });

    await user.click(await screen.findByRole('button', { name: /cameraBlockedTitle/i }));
    await waitFor(() => {
      expect(second).toHaveBeenCalledTimes(2);
    });
    expect(first).toHaveBeenCalledTimes(1);
    consoleWarn.mockRestore();
  });
});
