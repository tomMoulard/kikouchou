/**
 * @fileoverview Share Dialog component for sharing trips via URL and QR code.
 * Displays a shareable link with copy-to-clipboard functionality and downloadable QR code.
 *
 * @module features/sharing/components/ShareDialog
 */

import {
  type ReactElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { QRCodeCanvas } from 'qrcode.react';
import {
  Check,
  Copy,
  Download,
  Link2,
  QrCode,
  Share2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useTripContext } from '@/contexts/TripContext';
import { cn } from '@/lib/utils';

// ============================================================================
// Constants
// ============================================================================

/**
 * Size of the QR code in pixels.
 */
const COPY_FEEDBACK_DURATION = 2000,

/**
 * Duration to show "copied" feedback in milliseconds.
 */
 QR_CANVAS_ID = 'share-qr-code-canvas',

/**
 * ID for the QR code canvas element (used for download).
 */
 QR_CODE_SIZE = 200;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ShareDialog component.
 */
export interface ShareDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Constructs the shareable URL for a trip.
 *
 * @param shareId - The trip's share ID
 * @returns Full shareable URL
 */
function constructShareUrl(shareId: string): string {
  // Guard for SSR - return empty string if window is not available
  if (typeof window === 'undefined') {
    return '';
  }
  return `${window.location.origin}/share/${shareId}`;
}

/**
 * Sanitizes a string for use in a filename.
 * Removes special characters and replaces spaces with hyphens.
 *
 * @param name - The string to sanitize
 * @returns Sanitized string safe for filename use
 */
function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50); // Limit length
}

/**
 * Downloads the QR code canvas as a PNG image.
 *
 * @param canvasId - The ID of the canvas element
 * @param filename - The filename for the download (without extension)
 * @returns true if download initiated, false if failed
 */
function downloadQrCode(canvasId: string, filename: string): boolean {
  const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
  if (!canvas) {
    console.error('QR code canvas not found');
    return false;
  }

  try {
    const dataUrl = canvas.toDataURL('image/png'),
     link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${filename}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (error) {
    console.error('Failed to download QR code:', error);
    return false;
  }
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog component for sharing a trip via URL and QR code.
 *
 * Features:
 * - Displays shareable URL constructed from trip's shareId
 * - Copy-to-clipboard button with visual feedback
 * - QR code generation using qrcode.react
 * - QR code download as PNG image
 * - Handles empty state when no trip is selected
 * - Full accessibility support
 * - Responsive design
 *
 * @param props - Component props
 * @returns The share dialog element
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false);
 * <ShareDialog open={isOpen} onOpenChange={setIsOpen} />
 * ```
 */
const ShareDialog = memo(({
  open,
  onOpenChange,
}: ShareDialogProps): ReactElement => {
  const { t } = useTranslation(),
   { currentTrip } = useTripContext(),

  // Track mounted state to prevent state updates after unmount
   isMountedRef = useRef(true),

  // Track copied state for visual feedback
   [isCopied, setIsCopied] = useState(false),

  // Timer ref for cleanup
   copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Cleanup on unmount
  useEffect(() => () => {
      isMountedRef.current = false;
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    }, []);

  // Reset copied state when dialog closes
  useEffect(() => {
    if (!open) {
      setIsCopied(false);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
    }
  }, [open]);

  // ============================================================================
  // Derived Values
  // ============================================================================

  /**
   * Construct the shareable URL from the current trip's shareId.
   */
  const shareUrl = useMemo(() => {
    if (!currentTrip?.shareId) {return '';}
    return constructShareUrl(currentTrip.shareId);
  }, [currentTrip?.shareId]),

  /**
   * Generate a sanitized filename for QR code download.
   */
   qrFilename = useMemo(() => {
    if (!currentTrip?.name) {return 'trip-qrcode';}
    return `${sanitizeFilename(currentTrip.name)}-qrcode`;
  }, [currentTrip?.name]),

  /**
   * Check if sharing is available (trip is selected and has shareId).
   */
   canShare = Boolean(currentTrip?.shareId && shareUrl),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Sets the copied state and schedules reset after feedback duration.
   * Clears any existing timeout to prevent accumulation.
   */
   setCopiedWithTimeout = useCallback(() => {
    if (!isMountedRef.current) {return;}
    
    // Clear any existing timeout to prevent accumulation
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }
    
    setIsCopied(true);
    copyTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setIsCopied(false);
      }
    }, COPY_FEEDBACK_DURATION);
  }, []),

  /**
   * Handles copying the share URL to clipboard.
   */
   handleCopy = useCallback(async () => {
    if (!shareUrl || isCopied) {return;}

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedWithTimeout();
      toast.success(t('sharing.copied'));
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Fallback for older browsers (deprecated but kept for legacy support)
      try {
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopiedWithTimeout();
        toast.success(t('sharing.copied'));
      } catch (fallbackError) {
        console.error('Fallback copy also failed:', fallbackError);
        toast.error(t('sharing.copyError'));
      }
    }
  }, [shareUrl, isCopied, setCopiedWithTimeout, t]),

  /**
   * Handles downloading the QR code as PNG.
   */
   handleDownloadQr = useCallback(() => {
    const success = downloadQrCode(QR_CANVAS_ID, qrFilename);
    if (success) {
      toast.success(t('sharing.downloadSuccess'));
    } else {
      toast.error(t('sharing.downloadError'));
    }
  }, [qrFilename, t]);

  // ============================================================================
  // Render: Empty State (No Trip Selected)
  // ============================================================================

  if (!canShare && open) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="size-5" aria-hidden="true" />
              {t('sharing.title')}
            </DialogTitle>
            <DialogDescription>
              {t('errors.tripNotFound', 'No trip selected. Please select a trip first.')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // ============================================================================
  // Render: Main Content
  // ============================================================================

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-5" aria-hidden="true" />
            {t('sharing.title')}
          </DialogTitle>
          <DialogDescription>
            {t('sharing.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Share Link Section */}
          <div className="space-y-3">
            <Label htmlFor="share-url" className="flex items-center gap-2 text-sm font-medium">
              <Link2 className="size-4" aria-hidden="true" />
              {t('sharing.link')}
            </Label>
            <div className="flex gap-2">
              <Input
                id="share-url"
                type="text"
                value={shareUrl}
                readOnly
                className="font-mono text-sm"
                aria-describedby="share-url-description"
              />
              <Button
                type="button"
                variant={isCopied ? 'default' : 'outline'}
                size="icon"
                onClick={handleCopy}
                disabled={!shareUrl}
                className={cn(
                  'shrink-0 transition-colors',
                  isCopied && 'bg-green-600 hover:bg-green-700 text-white',
                )}
                aria-label={isCopied ? t('sharing.copied') : t('sharing.copy')}
              >
                {isCopied ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </Button>
            </div>
            {/* Aria-live region for copy status announcement */}
            <p
              id="share-url-description"
              className="sr-only"
              aria-live="polite"
              aria-atomic="true"
            >
              {isCopied ? t('sharing.copied') : ''}
            </p>
          </div>

          <Separator />

          {/* QR Code Section */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2 text-sm font-medium">
              <QrCode className="size-4" aria-hidden="true" />
              {t('sharing.qrCode')}
            </Label>
            <div className="flex flex-col items-center gap-4">
              {/* QR Code Display */}
              <div
                className={cn(
                  'p-4 bg-white rounded-lg shadow-sm border',
                  'flex items-center justify-center',
                )}
                role="img"
                aria-label={t('sharing.scanToView')}
              >
                <QRCodeCanvas
                  id={QR_CANVAS_ID}
                  value={shareUrl}
                  size={QR_CODE_SIZE}
                  level="M"
                  includeMargin={false}
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                {t('sharing.scanToView')}
              </p>

              {/* Download Button */}
              <Button
                type="button"
                variant="outline"
                onClick={handleDownloadQr}
                className="w-full sm:w-auto"
              >
                <Download className="size-4 mr-2" aria-hidden="true" />
                {t('sharing.downloadQr', 'Download QR Code')}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

ShareDialog.displayName = 'ShareDialog';

// ============================================================================
// Exports
// ============================================================================

export { ShareDialog };
