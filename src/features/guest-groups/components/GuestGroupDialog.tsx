/**
 * @fileoverview Dialog wrapping {@link GuestGroupForm} for create and edit.
 *
 * @module features/guest-groups/components/GuestGroupDialog
 * @see PersonDialog.tsx for the pattern this follows
 */

import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useOfflineAwareToast } from '@/hooks';
import { GuestGroupForm } from '@/features/guest-groups/components/GuestGroupForm';
import { useGuestGroups } from '@/features/guest-groups/hooks/useGuestGroups';
import { captureUsage } from '@/lib/posthog';
import type { GuestGroup, GuestGroupFormData } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

export interface GuestGroupDialogProps {
  /** The group being edited. Undefined means create. */
  readonly group?: GuestGroup;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Create or edit a guest group.
 *
 * @param props - Component props
 * @returns The dialog element
 *
 * @example
 * ```tsx
 * <GuestGroupDialog group={editing} open={isOpen} onOpenChange={setIsOpen} />
 * ```
 */
const GuestGroupDialog = memo(function GuestGroupDialog({
  group,
  open,
  onOpenChange,
}: GuestGroupDialogProps) {
  const { t } = useTranslation();
  const { createGroup, updateGroup } = useGuestGroups();
  const { successToast } = useOfflineAwareToast();

  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- Intentional reset on dialog open, as PersonDialog does. */
  useEffect(() => {
    if (open) {
      setIsDirty(false);
      setShowDiscardConfirm(false);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isEditMode = group !== undefined;

  const handleSubmit = useCallback(
    async (data: GuestGroupFormData) => {
      if (isEditMode) {
        await updateGroup(group.id, data);
        successToast(t('guestGroups.updateSuccess', 'Group updated'));
      } else {
        await createGroup(data);
        successToast(t('guestGroups.createSuccess', 'Group created'));
      }

      // Counts only: who is in somebody's family is not analytics data.
      captureUsage('guest_group_saved', {
        operation: isEditMode ? 'updated' : 'created',
        member_count: data.members.length,
      });

      onOpenChange(false);
    },
    [createGroup, group, isEditMode, onOpenChange, successToast, t, updateGroup],
  );

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      onOpenChange(nextOpen);
    },
    [isDirty, onOpenChange],
  );

  const handleDiscardConfirm = useCallback(() => {
    setShowDiscardConfirm(false);
    setIsDirty(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleDiscardCancel = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setShowDiscardConfirm(false);
    }
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditMode
                ? t('guestGroups.edit', 'Edit group')
                : t('guestGroups.new', 'New group')}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? t(
                    'guestGroups.editDescription',
                    'Change who belongs to this group. Guests already added to a trip are not affected.',
                  )
                : t(
                    'guestGroups.newDescription',
                    'Group people you invite together, then add them to a trip in one go.',
                  )}
            </DialogDescription>
          </DialogHeader>

          <GuestGroupForm
            group={group}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onDirtyChange={setIsDirty}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={handleDiscardCancel}
        title={t('unsaved.discardChanges')}
        description={t('unsaved.discardDescription')}
        confirmLabel={t('unsaved.discard')}
        cancelLabel={t('unsaved.keepEditing')}
        onConfirm={handleDiscardConfirm}
        variant="default"
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { GuestGroupDialog };
