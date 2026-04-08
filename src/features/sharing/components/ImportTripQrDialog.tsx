/**
 * @fileoverview Dialog to import a shared trip by scanning a QR code or pasting a link.
 *
 * @module features/sharing/components/ImportTripQrDialog
 */

import { type ReactElement, memo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { QRScanner } from '@/components/shared/QRScanner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { decodeChangeset } from '@/lib/sharing';

import { extractShareIdFromScannedPayload } from '../utils/share-qr-parse';

// ============================================================================
// Types
// ============================================================================

export interface ImportTripQrDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

const ImportTripQrDialog = memo(function ImportTripQrDialog({
  open,
  onOpenChange,
}: ImportTripQrDialogProps): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const handledRef = useRef(false);

  const handleScan = useCallback(
    (data: string) => {
      if (handledRef.current) {
        return;
      }
      const trimmed = data.trim();

      const shareId = extractShareIdFromScannedPayload(trimmed);
      if (shareId) {
        handledRef.current = true;
        onOpenChange(false);
        navigate(`/share/${shareId}`);
        return;
      }

      try {
        decodeChangeset(trimmed);
        toast.error(
          t(
            'trips.importQrIsSyncPayload',
            'That text is a trip sync export (from Sync), not an invite link. Open the same trip, go to Settings → Sync, then use Import there — or paste the share link / scan the invite QR from Share.',
          ),
        );
        return;
      } catch {
        // Not a valid changeset either
      }

      toast.error(t('trips.importQrInvalid', 'This QR code or link is not a valid trip share.'));
    },
    [navigate, onOpenChange, t],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        handledRef.current = false;
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('trips.importFromQrTitle', 'Import a shared trip')}</DialogTitle>
          <DialogDescription>
            {t('trips.importFromQrDescription')}
          </DialogDescription>
        </DialogHeader>
        <QRScanner
          onScan={handleScan}
          onError={(message) => toast.error(message)}
          active={open}
          className="mt-2"
        />
      </DialogContent>
    </Dialog>
  );
});

export { ImportTripQrDialog };
