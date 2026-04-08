/**
 * @fileoverview QR code scanner component using html5-qrcode.
 * Provides camera-based QR code scanning with error handling and fallback.
 *
 * @module components/shared/QRScanner
 */

import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, CameraOff, ClipboardPaste } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

interface QRScannerProps {
  /** Callback when a QR code is successfully scanned */
  readonly onScan: (data: string) => void;
  /** Optional callback for errors */
  readonly onError?: (error: string) => void;
  /** Whether the scanner is active */
  readonly active?: boolean;
  /** Additional CSS classes */
  readonly className?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum height for the imperative scanner mount (library needs non-zero layout). */
const SCANNER_MIN_HEIGHT_PX = 250;

/**
 * Omit `qrbox` so html5-qrcode does not insert `#qr-shaded-region` (thick dimming
 * borders + solid white “corner bracket” divs). Those read as a big pale block
 * beside letterboxed video; full-frame decode still works on the hidden canvas.
 */
const SCANNER_CONFIG = {
  fps: 10,
  // No aspectRatio: avoid track constraints fighting layout; we letterbox via CSS.
} as const;

/** html5-qrcode sets video width to parent.clientWidth in px; override after layout. */
function patchScannerVideo(region: HTMLElement): void {
  const video = region.querySelector('video');
  if (!video) return;
  video.style.setProperty('width', '100%', 'important');
  video.style.setProperty('max-width', 'none', 'important');
  video.style.setProperty('height', '100%', 'important');
  video.style.setProperty('object-fit', 'cover', 'important');
  video.style.setProperty('display', 'block', 'important');
}

// ============================================================================
// Component
// ============================================================================

export const QRScanner = memo(function QRScanner({
  onScan,
  onError,
  active = true,
  className,
}: QRScannerProps) {
  const { t } = useTranslation();
  const reactId = useId();
  const scannerRegionId = `qr-scanner-region-${reactId.replace(/:/g, '')}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<InstanceType<typeof import('html5-qrcode').Html5Qrcode> | null>(null);
  const startingRef = useRef(false);
  const disposedRef = useRef(false);
  const [isStarted, setIsStarted] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const stopScanner = useCallback(async () => {
    startingRef.current = false;
    const scanner = html5QrCodeRef.current;
    if (scanner) {
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch {
        // Ignore cleanup errors
      }
      html5QrCodeRef.current = null;
    }

    // Imperatively wipe the library-owned container so React never
    // encounters orphaned DOM nodes it didn't create.
    const scannerEl = containerRef.current?.querySelector(`#${scannerRegionId}`);
    if (scannerEl) {
      scannerEl.innerHTML = '';
    }

    if (isMountedRef.current) {
      setIsStarted(false);
    }
  }, [scannerRegionId]);

  const startScanner = useCallback(async () => {
    if (!containerRef.current || disposedRef.current) return;
    // Prevent overlapping starts: ref is null until after dynamic import, so two
    // concurrent calls would otherwise both create Html5Qrcode (double camera).
    if (startingRef.current || html5QrCodeRef.current) return;
    startingRef.current = true;

    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (disposedRef.current || !containerRef.current) return;

      // Create an imperative child div for html5-qrcode to own.
      // This isolates the library's direct DOM mutations from React's
      // virtual DOM, preventing "removeChild" errors on unmount.
      // It must have explicit size so the library can calculate its layout
      // (it rejects qrbox configs when the container is 0px).
      let scannerEl = containerRef.current.querySelector<HTMLDivElement>(`#${scannerRegionId}`);
      if (!scannerEl) {
        scannerEl = document.createElement('div');
        scannerEl.id = scannerRegionId;
        scannerEl.style.width = '100%';
        scannerEl.style.minHeight = `${SCANNER_MIN_HEIGHT_PX}px`;
        scannerEl.style.position = 'relative';
        scannerEl.style.overflow = 'hidden';
        containerRef.current.appendChild(scannerEl);
      }

      const scanner = new Html5Qrcode(scannerRegionId);
      html5QrCodeRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        SCANNER_CONFIG,
        (decodedText) => {
          if (isMountedRef.current) {
            onScan(decodedText);
          }
        },
        () => {
          // Ignore scan failures (expected while finding QR)
        },
      );

      if (isMountedRef.current && !disposedRef.current) {
        setIsStarted(true);
        setCameraError(null);
      }
    } catch (error) {
      console.error('Failed to start QR scanner:', error);
      html5QrCodeRef.current = null;
      if (isMountedRef.current) {
        const message = error instanceof Error ? error.message : 'Camera access denied';
        setCameraError(message);
        onError?.(message);
      }
    } finally {
      startingRef.current = false;
    }
  }, [onError, onScan, scannerRegionId]);

  // Start/stop scanner when active changes
  useEffect(() => {
    disposedRef.current = false;

    async function run() {
      await stopScanner();
      if (disposedRef.current) return;
      if (active && !showPaste) {
        await startScanner();
      }
    }

    void run();

    return () => {
      disposedRef.current = true;
      void stopScanner();
    };
  }, [active, showPaste, startScanner, stopScanner]);

  // Library pins <video> to an initial clientWidth (inline px). Wider containers leave a
  // bg-muted strip; keep width/object-fit in sync on resize and when nodes mount.
  useEffect(() => {
    if (!isStarted || showPaste || cameraError || !containerRef.current) return;

    const container = containerRef.current;
    const region = container.querySelector<HTMLElement>(`#${scannerRegionId}`);
    if (!region) return;

    const syncLayout = () => {
      // Definite height so video { height: 100% } resolves (min-height alone is not enough).
      const h = Math.max(SCANNER_MIN_HEIGHT_PX, container.clientHeight);
      region.style.height = `${h}px`;
      region.style.minHeight = `${h}px`;
      region.style.width = '100%';
      region.style.overflow = 'hidden';
      patchScannerVideo(region);
    };

    syncLayout();
    const resizeObserver = new ResizeObserver(() => {
      syncLayout();
    });
    resizeObserver.observe(container);
    const mutationObserver = new MutationObserver(() => {
      syncLayout();
    });
    mutationObserver.observe(region, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [isStarted, showPaste, cameraError, scannerRegionId]);

  const handlePasteSubmit = useCallback(() => {
    const trimmed = pasteValue.trim();
    if (trimmed) {
      onScan(trimmed);
    }
  }, [pasteValue, onScan]);

  const togglePasteMode = useCallback(() => {
    setShowPaste(prev => !prev);
  }, []);

  return (
    <div
      className={cn(
        'flex w-full min-w-0 max-w-full flex-col gap-4 overflow-x-clip',
        className,
      )}
    >
      {/* The container div is always mounted so html5-qrcode's async cleanup
          can finish against a still-attached DOM node. We hide it visually
          when paste mode is active instead of unmounting it. */}
      <div
        ref={containerRef}
        className={cn(
          'relative mx-auto w-full min-w-0 max-w-sm rounded-lg overflow-hidden bg-muted',
          // Stable height so video % height resolves; loading state centers inside the same box
          !showPaste && 'min-h-[280px]',
          !isStarted && !cameraError && !showPaste && 'flex items-center justify-center',
          // Collapse scanner slot in paste mode so library-injected nodes cannot widen the dialog
          showPaste &&
            'pointer-events-none absolute left-0 top-0 -z-10 h-0 max-h-0 min-h-0 w-0 max-w-0 overflow-hidden border-0 p-0 opacity-0',
        )}
      >
        {!isStarted && !cameraError && !showPaste && (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Camera className="h-8 w-8 animate-pulse" />
            <p className="text-sm">{t('sharing.sync.scannerLoading', 'Starting camera...')}</p>
          </div>
        )}
      </div>

      {!showPaste && cameraError && (
        <div className="flex flex-col items-center gap-3 p-4 rounded-lg bg-destructive/10 text-destructive">
          <CameraOff className="h-8 w-8" />
          <p className="text-sm text-center">{cameraError}</p>
        </div>
      )}

      {showPaste && (
        <div className="flex min-w-0 w-full max-w-full flex-col gap-3 overflow-hidden">
          <Textarea
            value={pasteValue}
            onChange={(e) => setPasteValue(e.target.value)}
            placeholder={t('sharing.sync.pasteHint', 'Paste the exported data here...')}
            className={cn(
              'block min-h-[120px] max-h-[min(40vh,280px)] min-w-0 w-full max-w-full resize-y font-mono text-xs',
              'break-all [overflow-wrap:anywhere] [field-sizing:fixed]',
              'overflow-x-hidden overflow-y-auto',
            )}
          />
          <Button
            onClick={handlePasteSubmit}
            disabled={!pasteValue.trim()}
            className="w-full shrink-0"
          >
            {t('sharing.sync.importPasted', 'Import')}
          </Button>
        </div>
      )}

      <Button
        variant="outline"
        onClick={togglePasteMode}
        className="w-full min-w-0 max-w-full shrink-0"
      >
        {showPaste ? (
          <>
            <Camera className="mr-2 h-4 w-4" />
            {t('sharing.sync.switchToCamera', 'Use camera instead')}
          </>
        ) : (
          <>
            <ClipboardPaste className="mr-2 h-4 w-4" />
            {t('sharing.sync.switchToPaste', 'Paste data manually')}
          </>
        )}
      </Button>
    </div>
  );
});
