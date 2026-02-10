/**
 * @fileoverview Reusable dialog for warning about unsaved changes.
 * Used with `useUnsavedChanges` hook to intercept navigation when forms are dirty.
 *
 * @module components/shared/UnsavedChangesDialog
 */

import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the UnsavedChangesDialog component.
 */
interface UnsavedChangesDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback when user chooses to stay */
  readonly onStay: () => void;
  /** Callback when user chooses to leave */
  readonly onLeave: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog that warns about unsaved changes when navigating away from a form.
 *
 * Uses the existing `ConfirmDialog` component with `variant="default"` (not destructive)
 * since the action is "leave and lose changes", not "delete data".
 *
 * @param props - Component props
 * @returns The unsaved changes dialog element
 *
 * @example
 * ```tsx
 * const { isBlocked, proceed, reset } = useUnsavedChanges(isDirty);
 *
 * <UnsavedChangesDialog
 *   open={isBlocked}
 *   onStay={reset}
 *   onLeave={proceed}
 * />
 * ```
 */
const UnsavedChangesDialog = memo(function UnsavedChangesDialog({
  open,
  onStay,
  onLeave,
}: UnsavedChangesDialogProps) {
  const { t } = useTranslation();

  // Track whether user chose to leave, so handleOpenChange doesn't call onStay
  // after ConfirmDialog auto-closes on confirm. Without this, both proceed() and
  // reset() would be called — proceed() from onConfirm, reset() from onOpenChange.
  const isLeavingRef = useRef(false);

  const handleLeave = useCallback(() => {
    isLeavingRef.current = true;
    onLeave();
  }, [onLeave]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen) {
        if (isLeavingRef.current) {
          // User chose to leave — don't call onStay, just reset the flag
          isLeavingRef.current = false;
        } else {
          // Dialog closed via cancel, escape, or overlay — treat as "stay"
          onStay();
        }
      }
    },
    [onStay],
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('unsaved.title')}
      description={t('unsaved.description')}
      confirmLabel={t('unsaved.leave')}
      cancelLabel={t('unsaved.stay')}
      onConfirm={handleLeave}
      variant="default"
    />
  );
});

// ============================================================================
// Exports
// ============================================================================

export { UnsavedChangesDialog };
export type { UnsavedChangesDialogProps };
