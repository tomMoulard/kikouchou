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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@/test/utils';
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
}

const probe: CameraProbe = { playAbortMessage: null, starts: 0 };

class FakeHtml5Qrcode {
  public isScanning = false;
  private video: HTMLVideoElement | null = null;
  private readonly elementId: string;

  constructor(elementId: string) {
    this.elementId = elementId;
  }

  async start(): Promise<void> {
    const parent = document.getElementById(this.elementId);
    if (!parent) throw new Error(`missing scanner region ${this.elementId}`);

    probe.starts += 1;
    const video = document.createElement('video');
    this.video = video;
    parent.appendChild(video);

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
