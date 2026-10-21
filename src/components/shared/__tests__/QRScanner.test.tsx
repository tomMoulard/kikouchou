/**
 * @fileoverview Tests for QRScanner teardown against the camera boundary.
 *
 * The fake below stands in for html5-qrcode and reproduces the one browser
 * behaviour that matters here: the library calls `video.play()` and drops the
 * returned promise, so if the video leaves the document while playback is still
 * starting, Chrome rejects that promise with an unhandled
 * `DOMException: AbortError: The play() request was interrupted because the
 * media was removed from the document`. PostHog reported exactly that from
 * `/trips`.
 *
 * @module components/shared/__tests__/QRScanner.test
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/utils';
import { QRScanner } from '../QRScanner';

// ============================================================================
// Camera boundary fake
// ============================================================================

/** Milliseconds the fake camera takes before the video reports `playing`. */
const FAKE_CAMERA_WARMUP_MS = 50;

interface CameraProbe {
  /** Set when `play()` was still pending as the video left the document. */
  playAbortMessage: string | null;
  /** Number of videos the fake has mounted. */
  starts: number;
  /** Number of times the fake was stopped. */
  stops: number;
  /**
   * How the mounted video behaves: `warmup` plays after a short delay, `ready`
   * is already playing when `start()` resolves (with `readyState` below), and
   * `silent` stays paused and fires nothing, `paused-ready` has data but stays
   * paused, and `none` mounts no video at all.
   */
  videoMode: 'warmup' | 'ready' | 'silent' | 'paused-ready' | 'none';
  /** The `readyState` a `ready` video reports. */
  readyState: number;
  /** The video the fake mounted last. */
  lastVideo: HTMLVideoElement | null;
  /** The camera constraints the component asked for. */
  lastConstraints: unknown;
  /** The decode callback the component handed to `start()`. */
  onSuccess: ((decodedText: string) => void) | null;
}

const probe: CameraProbe = {
  playAbortMessage: null,
  starts: 0,
  stops: 0,
  videoMode: 'warmup',
  readyState: 3,
  lastVideo: null,
  lastConstraints: null,
  onSuccess: null,
};

class FakeHtml5Qrcode {
  public isScanning = false;
  private video: HTMLVideoElement | null = null;
  private readonly elementId: string;

  constructor(elementId: string) {
    this.elementId = elementId;
  }

  async start(
    constraints: unknown,
    _config: unknown,
    onSuccess: (decodedText: string) => void,
  ): Promise<void> {
    const parent = document.getElementById(this.elementId);
    if (!parent) throw new Error(`missing scanner region ${this.elementId}`);

    probe.starts += 1;
    probe.lastConstraints = constraints;
    probe.onSuccess = onSuccess;
    if (probe.videoMode === 'none') {
      this.isScanning = true;
      return;
    }
    const video = document.createElement('video');
    this.video = video;
    probe.lastVideo = video;
    parent.appendChild(video);

    if (probe.videoMode === 'ready') {
      Object.defineProperty(video, 'paused', { value: false, configurable: true });
      Object.defineProperty(video, 'readyState', { value: probe.readyState, configurable: true });
      this.isScanning = true;
      return;
    }
    if (probe.videoMode === 'silent') {
      this.isScanning = true;
      return;
    }
    if (probe.videoMode === 'paused-ready') {
      Object.defineProperty(video, 'readyState', { value: 3, configurable: true });
      this.isScanning = true;
      return;
    }

    // Chrome resolves play() once playback starts and rejects it with an
    // AbortError if the element is pulled out of the document first.
    let settled = false;
    const observer = new MutationObserver(() => {
      if (settled || video.isConnected) return;
      settled = true;
      observer.disconnect();
      probe.playAbortMessage =
        'AbortError: The play() request was interrupted because the media was removed from the document.';
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      // Real element state, so the component can tell playback started.
      Object.defineProperty(video, 'paused', { value: false, configurable: true });
      Object.defineProperty(video, 'readyState', { value: 3, configurable: true });
      video.dispatchEvent(new Event('playing'));
    }, FAKE_CAMERA_WARMUP_MS);

    this.isScanning = true;
  }

  async stop(): Promise<void> {
    probe.stops += 1;
    this.isScanning = false;
    this.video?.remove();
    this.video = null;
  }
}

vi.mock('html5-qrcode', () => ({ Html5Qrcode: FakeHtml5Qrcode }));

// ============================================================================
// Tests
// ============================================================================

describe('QRScanner', () => {
  beforeEach(() => {
    probe.playAbortMessage = null;
    probe.starts = 0;
    probe.stops = 0;
    probe.videoMode = 'warmup';
    probe.readyState = 3;
    probe.lastVideo = null;
    probe.lastConstraints = null;
    probe.onSuccess = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for playback before tearing the camera down', async () => {
    const { unmount } = render(<QRScanner onScan={vi.fn()} />);

    // The camera is mounted but still warming up: play() has not resolved.
    await vi.waitFor(() => {
      expect(probe.starts).toBe(1);
    });

    unmount();

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, FAKE_CAMERA_WARMUP_MS * 4));
    });

    expect(probe.playAbortMessage).toBeNull();
  });

  it('does not abort playback when the scanner is deactivated mid-start', async () => {
    const { rerender } = render(<QRScanner onScan={vi.fn()} active />);

    await vi.waitFor(() => {
      expect(probe.starts).toBe(1);
    });

    rerender(<QRScanner onScan={vi.fn()} active={false} />);

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, FAKE_CAMERA_WARMUP_MS * 4));
    });

    expect(probe.playAbortMessage).toBeNull();
  });
});

// ============================================================================
// Camera layout and playback
// ============================================================================

/** The region the component hands to the library, found by its id prefix. */
function scannerRegion(): HTMLElement {
  const region = document.querySelector<HTMLElement>('[id^="qr-scanner-region-"]');
  if (!region) throw new Error('no scanner region');
  return region;
}

/** Waits for the loading tile to go, which is how the scanner says it started. */
async function waitForStarted(timeout = 1000): Promise<void> {
  await waitFor(
    () => {
      expect(screen.queryByText('sharing.sync.scannerLoading')).not.toBeInTheDocument();
    },
    { timeout },
  );
}

/** Lets pending promises and observer callbacks run. */
async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

describe('QRScanner camera', () => {
  beforeEach(() => {
    probe.playAbortMessage = null;
    probe.starts = 0;
    probe.stops = 0;
    probe.videoMode = 'warmup';
    probe.readyState = 3;
    probe.lastVideo = null;
    probe.lastConstraints = null;
    probe.onSuccess = null;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for the rear camera and hands every decoded code to onScan', async () => {
    const onScan = vi.fn();
    const { unmount } = render(<QRScanner onScan={onScan} />);

    await waitForStarted();
    expect(probe.lastConstraints).toEqual({ facingMode: 'environment' });

    act(() => {
      probe.onSuccess?.('qr-data');
    });
    expect(onScan).toHaveBeenCalledWith('qr-data');

    // A code the library decodes after the scanner is gone is not delivered.
    const lateDecode = probe.onSuccess;
    unmount();
    lateDecode?.('late');
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('hands a decoded code to the newest onScan', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<QRScanner onScan={first} />);
    await waitForStarted();

    rerender(<QRScanner onScan={second} />);
    await waitFor(() => {
      expect(probe.starts).toBe(2);
    });
    await waitForStarted();

    act(() => {
      probe.onSuccess?.('fresh');
    });
    expect(second).toHaveBeenCalledWith('fresh');
    expect(first).not.toHaveBeenCalled();
  });

  it('shows a centred loading tile in a sized box while the camera warms up', async () => {
    const { container } = render(<QRScanner onScan={vi.fn()} className="extra-class" />);

    await waitFor(() => {
      expect(probe.starts).toBe(1);
    });

    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass(
      'flex', 'w-full', 'min-w-0', 'max-w-full', 'flex-col', 'gap-4', 'overflow-x-clip', 'extra-class',
    );

    const region = scannerRegion();
    expect(region.id).toMatch(/^qr-scanner-region-[^:]+$/);
    // The library needs a non-zero box to lay itself out in.
    expect(region.style.width).toBe('100%');
    expect(region.style.minHeight).toBe('250px');
    expect(region.style.position).toBe('relative');
    expect(region.style.overflow).toBe('hidden');

    const box = region.parentElement as HTMLElement;
    expect(box).toHaveClass(
      'relative', 'mx-auto', 'w-full', 'min-w-0', 'max-w-sm', 'rounded-lg', 'overflow-hidden', 'bg-muted',
      'min-h-[280px]', 'flex', 'items-center', 'justify-center',
    );
    expect(box).not.toHaveClass('pointer-events-none');

    const loading = screen.getByText('sharing.sync.scannerLoading');
    expect(loading).toHaveClass('text-sm');
    expect(loading.parentElement).toHaveClass('flex', 'flex-col', 'items-center', 'gap-2', 'text-muted-foreground');
    expect(loading.parentElement?.querySelector('svg')).toHaveClass('h-8', 'w-8', 'animate-pulse');

    const toggle = screen.getByRole('button', { name: /sharing.sync.switchToPaste/i });
    expect(toggle).toHaveClass('w-full', 'min-w-0', 'max-w-full', 'shrink-0');
    expect(toggle.querySelector('svg')).toHaveClass('mr-2', 'h-4', 'w-4');
  });

  it('stretches the region and the video over the box once playing', async () => {
    // jsdom drops the priority of some properties it does not know, so the
    // calls are read at the CSSOM boundary rather than off the element.
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    render(<QRScanner onScan={vi.fn()} />);
    await waitForStarted();

    const region = scannerRegion();
    const box = region.parentElement as HTMLElement;
    expect(box).toHaveClass('min-h-[280px]');
    expect(box).not.toHaveClass('flex');
    expect(box).not.toHaveClass('justify-center');

    // jsdom lays nothing out, so the box measures 0 and the floor applies.
    expect(region.style.height).toBe('250px');
    expect(region.style.minHeight).toBe('250px');
    expect(region.style.width).toBe('100%');
    expect(region.style.overflow).toBe('hidden');

    const video = probe.lastVideo as HTMLVideoElement;
    const videoCalls = setProperty.mock.contexts
      .map((context, index) => ({ context, args: setProperty.mock.calls[index] }))
      .filter(({ context }) => context === video.style)
      .map(({ args }) => args);
    for (const [property, value] of [
      ['width', '100%'],
      ['max-width', 'none'],
      ['height', '100%'],
      ['object-fit', 'cover'],
      ['display', 'block'],
    ] as const) {
      expect(video.style.getPropertyValue(property)).toBe(value);
      expect(videoCalls).toContainEqual([property, value, 'important']);
    }
  });

  it('sizes the region to a box taller than the floor', async () => {
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    render(<QRScanner onScan={vi.fn()} />);
    await waitForStarted();

    expect(scannerRegion().style.height).toBe('400px');
    expect(scannerRegion().style.minHeight).toBe('400px');
    heightSpy.mockRestore();
  });

  it('lays the video out again when the library adds nodes, deep ones included', async () => {
    render(<QRScanner onScan={vi.fn()} />);
    await waitForStarted();

    const region = scannerRegion();
    const inner = document.createElement('div');
    region.appendChild(inner);
    await flush();

    region.style.height = '';
    inner.appendChild(document.createElement('span'));
    await waitFor(() => {
      expect(region.style.height).toBe('250px');
    });
  });

  it('lays the video out again when the box is resized, and stops watching in paste mode', async () => {
    const resizeCallbacks: Array<() => void> = [];
    const observed: Element[] = [];
    const disconnect = vi.fn();
    // The setup file defines the global as writable but not configurable, so
    // it is swapped by assignment rather than with vi.stubGlobal.
    const originalResizeObserver = window.ResizeObserver;
    onTestFinished(() => {
      window.ResizeObserver = originalResizeObserver;
    });
    window.ResizeObserver = class {
        constructor(callback: () => void) {
          resizeCallbacks.push(callback);
        }
        observe(target: Element): void {
          observed.push(target);
        }
        unobserve(): void {
          // Not used by the scanner.
        }
        disconnect(): void {
          disconnect();
        }
      } as unknown as typeof ResizeObserver;

    const { user } = render(<QRScanner onScan={vi.fn()} />);
    await waitForStarted();

    const region = scannerRegion();
    expect(observed).toContain(region.parentElement);

    region.style.height = '';
    act(() => {
      for (const callback of resizeCallbacks) callback();
    });
    expect(region.style.height).toBe('250px');

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));
    expect(disconnect).toHaveBeenCalled();

    // The region is gone, and nothing watches it any more.
    await waitFor(() => {
      expect(region.isConnected).toBe(false);
    });
    region.style.height = '';
    region.appendChild(document.createElement('div'));
    await flush();
    expect(region.style.height).toBe('');
  });

  it('collapses the scanner box and stops the camera in paste mode', async () => {
    const { user } = render(<QRScanner onScan={vi.fn()} />);
    await waitForStarted();
    const box = scannerRegion().parentElement as HTMLElement;

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));

    expect(box).toHaveClass('pointer-events-none', 'absolute', 'opacity-0', 'h-0', 'w-0', '-z-10');
    expect(box).not.toHaveClass('min-h-[280px]');
    expect(box).not.toHaveClass('flex');
    expect(screen.queryByText('sharing.sync.scannerLoading')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(probe.stops).toBe(1);
    });

    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('placeholder', 'sharing.sync.pasteHint');
    expect(textarea).toHaveClass(
      'font-mono', 'text-xs', 'break-all', 'overflow-x-hidden', 'overflow-y-auto', 'resize-y',
    );
    expect(textarea.parentElement).toHaveClass(
      'flex', 'min-w-0', 'w-full', 'max-w-full', 'flex-col', 'gap-3', 'overflow-hidden',
    );
    expect(screen.getByRole('button', { name: /sharing.sync.importPasted/i })).toHaveClass('w-full', 'shrink-0');
    const toggle = screen.getByRole('button', { name: /sharing.sync.switchToCamera/i });
    expect(toggle.querySelector('svg')).toHaveClass('mr-2', 'h-4', 'w-4');
  });

  it('does not open the camera while inactive, and opens it when activated', async () => {
    const { rerender } = render(<QRScanner onScan={vi.fn()} active={false} />);
    await flush(30);
    expect(probe.starts).toBe(0);

    rerender(<QRScanner onScan={vi.fn()} active />);
    await waitFor(() => {
      expect(probe.starts).toBe(1);
    });
  });

  it('starts at once when the video is already playing', async () => {
    probe.videoMode = 'ready';
    probe.readyState = 2;
    render(<QRScanner onScan={vi.fn()} />);

    // Well under the three-second playback wait.
    await waitForStarted(1000);
  });

  it('waits for a paused video until the playback timeout fires', async () => {
    probe.videoMode = 'silent';
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    render(<QRScanner onScan={vi.fn()} />);

    await waitFor(() => {
      expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 3000)).toBe(true);
    });
    await flush(30);
    expect(screen.getByText('sharing.sync.scannerLoading')).toBeInTheDocument();

    const index = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 3000);
    const [onTimeout] = setTimeoutSpy.mock.calls[index] as unknown as [() => void, number];
    act(() => {
      onTimeout();
    });
    await waitForStarted();
  });

  for (const eventName of ['playing', 'error', 'abort'] as const) {
    it(`stops waiting and lets go of the video on "${eventName}"`, async () => {
      probe.videoMode = 'silent';
      const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
      render(<QRScanner onScan={vi.fn()} />);

      await waitFor(() => {
        expect(setTimeoutSpy.mock.calls.some(([, delay]) => delay === 3000)).toBe(true);
      });
      const index = setTimeoutSpy.mock.calls.findIndex(([, delay]) => delay === 3000);
      const timer: unknown = setTimeoutSpy.mock.results[index]?.value;
      const video = probe.lastVideo as HTMLVideoElement;
      const removeSpy = vi.spyOn(video, 'removeEventListener');

      act(() => {
        video.dispatchEvent(new Event(eventName));
      });
      await waitForStarted();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(timer);
      const removed = removeSpy.mock.calls.map(([type]) => type);
      expect(removed).toEqual(expect.arrayContaining(['playing', 'error', 'abort']));
    });
  }

  it('parks the region off-screen on unmount until playback settles', async () => {
    const { unmount } = render(<QRScanner onScan={vi.fn()} />);
    await waitFor(() => {
      expect(probe.starts).toBe(1);
    });
    const region = scannerRegion();

    unmount();

    expect(region.parentElement).toBe(document.body);
    expect(region.hasAttribute('id')).toBe(false);
    expect(region.style.position).toBe('absolute');
    expect(region.style.left).toBe('-9999px');
    expect(region.style.top).toBe('0px');
    expect(region.style.width).toBe('1px');
    expect(region.style.height).toBe('1px');
    expect(region.style.overflow).toBe('hidden');
    expect(region.style.opacity).toBe('0');
    expect(region.style.pointerEvents).toBe('none');

    await waitFor(() => {
      expect(region.isConnected).toBe(false);
    });
  });
});

describe('QRScanner camera edge cases', () => {
  beforeEach(() => {
    probe.playAbortMessage = null;
    probe.starts = 0;
    probe.stops = 0;
    probe.videoMode = 'warmup';
    probe.readyState = 3;
    probe.lastVideo = null;
    probe.lastConstraints = null;
    probe.onSuccess = null;
  });

  it('shows the loading tile from the very first frame', () => {
    render(<QRScanner onScan={vi.fn()} />);

    expect(screen.getByText('sharing.sync.scannerLoading')).toBeInTheDocument();
  });

  it('leaves the region its minimum height alone until the video plays', async () => {
    render(<QRScanner onScan={vi.fn()} />);
    await waitFor(() => {
      expect(probe.starts).toBe(1);
    });
    await flush();

    expect(scannerRegion().style.height).toBe('');
  });

  it('starts when the library mounts no video at all', async () => {
    probe.videoMode = 'none';
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<QRScanner onScan={vi.fn()} />);

    await waitForStarted();

    expect(screen.queryByText('sharing.sync.cameraFailedTitle')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(scannerRegion().style.height).toBe('250px');
    });
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('waits for a video that reports no data yet even though it is not paused', async () => {
    probe.videoMode = 'ready';
    probe.readyState = 1;
    render(<QRScanner onScan={vi.fn()} />);

    await waitFor(() => {
      expect(probe.starts).toBe(1);
    });
    await flush(30);
    expect(screen.getByText('sharing.sync.scannerLoading')).toBeInTheDocument();

    act(() => {
      probe.lastVideo?.dispatchEvent(new Event('playing'));
    });
    await waitForStarted();
  });

  it('waits for a video that has data but is still paused', async () => {
    probe.videoMode = 'paused-ready';
    render(<QRScanner onScan={vi.fn()} />);

    await waitFor(() => {
      expect(probe.starts).toBe(1);
    });
    await flush(30);
    expect(screen.getByText('sharing.sync.scannerLoading')).toBeInTheDocument();
  });

  it('shows the loading tile again when the camera comes back from paste mode', async () => {
    const { user } = render(<QRScanner onScan={vi.fn()} />);
    await waitForStarted();

    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToPaste/i }));
    await waitFor(() => {
      expect(probe.stops).toBe(1);
    });
    await user.click(screen.getByRole('button', { name: /sharing.sync.switchToCamera/i }));

    expect(await screen.findByText('sharing.sync.scannerLoading')).toBeInTheDocument();
    await waitForStarted();
  });

  it('does nothing at all when gone before the library has loaded', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<QRScanner onScan={vi.fn()} />);

    unmount();
    await flush(30);

    expect(probe.starts).toBe(0);
    expect(consoleError).not.toHaveBeenCalledWith('Failed to start QR scanner:', expect.anything());
    consoleError.mockRestore();
  });
});

