/**
 * @fileoverview Multi-frame QR code display for large payloads.
 * Animates through QR frames if the payload exceeds single-QR capacity.
 * Also supports single-frame display with copy-as-text fallback.
 *
 * @module components/shared/MultiFrameQR
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeCanvas } from 'qrcode.react';
import { Check, ClipboardCopy, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

interface MultiFrameQRProps {
  /** Array of frame strings (1 for single QR, N for multi-frame) */
  readonly frames: readonly string[];
  /** Size of the QR code in pixels */
  readonly size?: number;
  /** Auto-advance interval in ms (0 = manual navigation) */
  readonly autoAdvanceMs?: number;
  /** The full encoded payload for copy-as-text fallback */
  readonly rawPayload: string;
  /** Additional CSS classes */
  readonly className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SIZE = 280;
const DEFAULT_AUTO_ADVANCE_MS = 1500;

// ============================================================================
// Component
// ============================================================================

export const MultiFrameQR = memo(function MultiFrameQR({
  frames,
  size = DEFAULT_SIZE,
  autoAdvanceMs = DEFAULT_AUTO_ADVANCE_MS,
  rawPayload,
  className,
}: MultiFrameQRProps) {
  const { t } = useTranslation();
  const [currentFrame, setCurrentFrame] = useState(0);
  const [copied, setCopied] = useState(false);
  const isMultiFrame = frames.length > 1;

  // Auto-advance timer for multi-frame
  useEffect(() => {
    if (!isMultiFrame || autoAdvanceMs <= 0) return;

    const interval = setInterval(() => {
      setCurrentFrame(prev => (prev + 1) % frames.length);
    }, autoAdvanceMs);

    return () => clearInterval(interval);
  }, [isMultiFrame, autoAdvanceMs, frames.length]);

  const goNext = useCallback(() => {
    setCurrentFrame(prev => (prev + 1) % frames.length);
  }, [frames.length]);

  const goPrev = useCallback(() => {
    setCurrentFrame(prev => (prev - 1 + frames.length) % frames.length);
  }, [frames.length]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawPayload);
      setCopied(true);
      toast.success(t('sharing.sync.copiedToClipboard', 'Copied to clipboard'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      try {
        const textarea = document.createElement('textarea');
        textarea.value = rawPayload;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        toast.success(t('sharing.sync.copiedToClipboard', 'Copied to clipboard'));
        setTimeout(() => setCopied(false), 2000);
      } catch {
        toast.error(t('sharing.sync.copyFailed', 'Failed to copy'));
      }
    }
  }, [rawPayload, t]);

  const currentFrameData = useMemo(() => frames[currentFrame] ?? '', [frames, currentFrame]);

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {/* QR Code */}
      <div className="rounded-xl bg-white p-4 shadow-md">
        <QRCodeCanvas
          value={currentFrameData}
          size={size}
          level="L"
          marginSize={2}
        />
      </div>

      {/* Multi-frame navigation */}
      {isMultiFrame && (
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={goPrev}
            aria-label={t('sharing.sync.previousFrame', 'Previous frame')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="text-sm text-muted-foreground tabular-nums">
            {currentFrame + 1} / {frames.length}
          </span>

          <Button
            variant="outline"
            size="icon"
            onClick={goNext}
            aria-label={t('sharing.sync.nextFrame', 'Next frame')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Copy as text fallback */}
      <Button
        variant="outline"
        onClick={handleCopy}
        className="w-full max-w-xs"
      >
        {copied ? (
          <>
            <Check className="mr-2 h-4 w-4 text-green-500" />
            {t('sharing.sync.copied', 'Copied!')}
          </>
        ) : (
          <>
            <ClipboardCopy className="mr-2 h-4 w-4" />
            {t('sharing.sync.copyAsText', 'Copy as text')}
          </>
        )}
      </Button>
    </div>
  );
});
