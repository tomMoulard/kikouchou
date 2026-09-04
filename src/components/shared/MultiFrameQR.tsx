/**
 * @fileoverview QR code display for export payloads that fit in one code.
 * When the payload is split into multiple frames (too large for one QR), only
 * copy-as-text is offered so users are not asked to scan a sequence of codes.
 *
 * @module components/shared/MultiFrameQR
 */

import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeCanvas } from 'qrcode.react';
import { Check, ClipboardCopy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { statusVariants } from '@/components/ui/status.variants';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

interface MultiFrameQRProps {
  /** Array of frame strings (1 for single QR, N when payload was split — then QR is hidden) */
  readonly frames: readonly string[];
  /** Size of the QR code in pixels */
  readonly size?: number;
  /** The full encoded payload for copy-as-text */
  readonly rawPayload: string;
  /** Additional CSS classes */
  readonly className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_SIZE = 280;

// ============================================================================
// Component
// ============================================================================

export const MultiFrameQR = memo(function MultiFrameQR({
  frames,
  size = DEFAULT_SIZE,
  rawPayload,
  className,
}: MultiFrameQRProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const isMultiFrame = frames.length > 1;
  const singleFrameData = frames[0] ?? '';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawPayload);
      setCopied(true);
      // Deliberately a raw toast, not the offline-aware one: nothing was
      // written to the database, so "Saved on this device" would be a lie.
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

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      {isMultiFrame ? (
        <p className="max-w-md text-center text-sm text-muted-foreground">
          {t(
            'sharing.sync.payloadTooLargeForQr',
            'This export is too large for a scannable QR code. Copy the text below and paste it on the other device to import.',
          )}
        </p>
      ) : (
        // eslint-disable-next-line kikouchou/no-raw-palette-class -- Literal white, not `bg-card`: a QR code needs a light quiet zone to scan, in either theme.
        <div className="rounded-xl bg-white p-4 shadow-md">
          <QRCodeCanvas
            value={singleFrameData}
            size={size}
            level="L"
            marginSize={2}
          />
        </div>
      )}

      {/* Copy full payload (required when multi-frame; also offered for single-frame) */}
      <Button
        variant="outline"
        onClick={handleCopy}
        className="w-full max-w-xs"
      >
        {copied ? (
          <>
            <Check className={cn('mr-2 h-4 w-4', statusVariants({ tone: 'success', emphasis: 'text' }))} />
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
