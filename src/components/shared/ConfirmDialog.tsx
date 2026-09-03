/**
 * @fileoverview Reusable confirmation dialog for destructive or important actions.
 * Wraps the shadcn/ui AlertDialog primitives with standardized confirmation
 * patterns including loading state management for async operations.
 *
 * @module components/shared/ConfirmDialog
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Variant options for the confirm dialog.
 */
type ConfirmDialogVariant = 'default' | 'destructive';

/**
 * Props for the ConfirmDialog component.
 */
interface ConfirmDialogProps {
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /** Dialog title displayed in the header */
  readonly title: string;
  /** Dialog description explaining the action */
  readonly description: string;
  /** Label for the confirm button. Defaults to translated "Confirm" */
  readonly confirmLabel?: string;
  /** Label for the cancel button. Defaults to translated "Cancel" */
  readonly cancelLabel?: string;
  /** Callback invoked when the user confirms. Can be async. */
  readonly onConfirm: () => void | Promise<void>;
  /**
   * Visual variant for the dialog.
   * - `default`: Standard confirm button
   * - `destructive`: Red confirm button for dangerous actions like delete
   * @default 'default'
   */
  readonly variant?: ConfirmDialogVariant;
  /** Additional CSS classes for the dialog content */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A reusable confirmation dialog for important or destructive actions.
 *
 * Features:
 * - Supports both default and destructive (delete) variants
 * - Handles async confirmation with loading state
 * - Prevents double-submission during loading
 * - Announced as `role="alertdialog"`, so a screen reader treats "Delete this
 *   trip?" as the interruption it is rather than as another ordinary dialog
 * - Cannot be answered by a stray click on the backdrop (Radix AlertDialog)
 * - Accessible via Radix AlertDialog primitives (focus trap, escape to close)
 * - Internationalized default button labels
 *
 * @param props - Component props
 * @returns The confirmation dialog element
 *
 * @example
 * ```tsx
 * import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
 *
 * // Delete confirmation
 * function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
 *   const [open, setOpen] = useState(false);
 *
 *   return (
 *     <>
 *       <Button variant="destructive" onClick={() => setOpen(true)}>
 *         Delete
 *       </Button>
 *       <ConfirmDialog
 *         open={open}
 *         onOpenChange={setOpen}
 *         title="Delete item?"
 *         description="This action cannot be undone."
 *         variant="destructive"
 *         confirmLabel="Delete"
 *         onConfirm={onDelete}
 *       />
 *     </>
 *   );
 * }
 *
 * // Standard confirmation
 * <ConfirmDialog
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   title="Save changes?"
 *   description="Your changes will be saved."
 *   onConfirm={handleSave}
 * />
 * ```
 */
const ConfirmDialog = memo(function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  variant = 'default',
  className,
}: ConfirmDialogProps): React.ReactElement {
  const { t } = useTranslation(),
   [isLoading, setIsLoading] = useState(false),

  // Track mounted state to prevent state updates after unmount
   isMountedRef = useRef(true);

  // Reset loading state when dialog closes externally
  useEffect(() => {
    if (!open) {
      setIsLoading(false);
    }
  }, [open]);

  // Cleanup on unmount
  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false
    // forever, silently turning every guarded setState into a no-op.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Get button labels with i18n fallbacks
  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm', 'Confirm'),
   resolvedCancelLabel = cancelLabel ?? t('common.cancel', 'Cancel'),

  /**
   * Handle the confirm action with loading state management.
   * Closes the dialog on success, keeps it open on error for retry.
   */
   handleConfirm = useCallback(async (): Promise<void> => {
    if (isLoading) {return;} // Prevent double-click race condition
    setIsLoading(true);
    try {
      await onConfirm();
      // Close dialog on successful confirm (only if still mounted)
      if (isMountedRef.current) {
        onOpenChange(false);
      }
    } catch {
      // Don't close on error - let user retry or cancel
      // Error handling is the responsibility of onConfirm
    } finally {
      // Only update state if still mounted
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [isLoading, onConfirm, onOpenChange]),

  /**
   * Handle open change, preventing close during loading.
   */
   handleOpenChange = useCallback(
    (newOpen: boolean): void => {
      if (!isLoading) {
        onOpenChange(newOpen);
      }
    },
    [isLoading, onOpenChange],
  );

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        className={cn('sm:max-w-[425px]', className)}
        // Escape is the one dismissal Radix still allows; blocked mid-flight so
        // the dialog cannot vanish while the work it started is still running.
        onEscapeKeyDown={(event) => {
          if (isLoading) {
            event.preventDefault();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="gap-2 sm:gap-0">
          {/* Cancel button. AlertDialogCancel is what Radix focuses when the
              dialog opens, so it has to wrap the real button rather than sit
              beside it — an alert dialog without one opens with focus nowhere.
              It closes the dialog itself, through `handleOpenChange`; a second
              `onClick` here would call the consumer's `onOpenChange` twice, and
              at least one consumer (UnsavedChangesDialog) is not idempotent. */}
          <AlertDialogCancel asChild>
            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-9"
              disabled={isLoading}
            >
              {resolvedCancelLabel}
            </Button>
          </AlertDialogCancel>

          {/* Confirm button */}
          <Button
            type="button"
            variant={variant}
            className="h-11 md:h-9"
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2
                  className="mr-2 size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
                {resolvedConfirmLabel}
              </>
            ) : (
              resolvedConfirmLabel
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ConfirmDialog };
export type { ConfirmDialogProps, ConfirmDialogVariant };
