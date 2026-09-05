/**
 * @fileoverview Dialog wrapper for creating and editing activities.
 * Wraps ActivityForm in a shadcn/ui Dialog with unsaved-changes protection.
 *
 * @module features/activities/components/ActivityDialog
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOfflineAwareToast } from '@/hooks';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useActivityContext } from '@/contexts/ActivityContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { ActivityForm } from '@/features/activities/components/ActivityForm';
import { captureUsage } from '@/lib/posthog';
import type { Activity, ActivityFormData, ActivityId, ISODateString } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ActivityDialog component.
 */
export interface ActivityDialogProps {
  /** Activity ID for edit mode. If undefined, the dialog is in create mode. */
  readonly activityId?: ActivityId;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /** Day pre-selected in create mode (YYYY-MM-DD) */
  readonly defaultDate?: ISODateString;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for creating and editing an activity.
 *
 * Features:
 * - Dual mode: create (no activityId) and edit (activityId provided)
 * - Guards against losing unsaved edits when closing
 * - Success/error toasts, offline-aware
 * - Closes automatically on successful submission
 *
 * @param props - Component props
 * @returns The activity dialog element
 *
 * @example
 * ```tsx
 * <ActivityDialog open={isOpen} onOpenChange={setIsOpen} defaultDate={dayKey} />
 * ```
 */
const ActivityDialog = memo(function ActivityDialog({
  activityId,
  open,
  onOpenChange,
  defaultDate,
}: ActivityDialogProps) {
  const { t } = useTranslation();
  const { activities, createActivity, updateActivity } = useActivityContext();
  const { persons } = usePersonContext();
  const { successToast } = useOfflineAwareToast();

  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Reset dirty state when the dialog opens (prevents stale state carrying over)
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional reset on dialog open */
  useEffect(() => {
    if (open) {
      setIsDirty(false);
      setShowDiscardConfirm(false);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isEditMode = Boolean(activityId);

  const activity = useMemo((): Activity | undefined => {
    if (!activityId) {
      return undefined;
    }
    return activities.find((candidate) => candidate.id === activityId);
  }, [activityId, activities]);

  const dialogTitle = isEditMode ? t('activities.edit') : t('activities.new');
  const dialogDescription = isEditMode
    ? t('activities.editDescription')
    : t('activities.newDescription');

  const handleSubmit = useCallback(
    async (data: ActivityFormData) => {
      if (activityId) {
        await updateActivity(activityId, data);
        successToast(t('activities.updateSuccess'));
        captureUsage('activity_saved', {
          operation: 'updated',
          category: data.category,
          is_all_day: data.allDay,
          participant_count: data.participantIds.length,
        });
      } else {
        await createActivity(data);
        successToast(t('activities.createSuccess'));
        captureUsage('activity_saved', {
          operation: 'created',
          category: data.category,
          is_all_day: data.allDay,
          participant_count: data.participantIds.length,
        });
      }
      onOpenChange(false);
    },
    [activityId, updateActivity, createActivity, t, onOpenChange, successToast],
  );

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      onOpenChange(newOpen);
    },
    [isDirty, onOpenChange],
  );

  const handleDiscardConfirm = useCallback(() => {
    setShowDiscardConfirm(false);
    setIsDirty(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleDiscardCancel = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      setShowDiscardConfirm(false);
    }
  }, []);

  // Edit mode with a missing activity: it was deleted, or the ID is stale.
  if (isEditMode && !activity && open) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('activities.edit')}</DialogTitle>
            <DialogDescription>
              {t('errors.activityNotFound', 'Activity not found. Please try again.')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <ActivityForm
            activity={activity}
            persons={persons}
            defaultDate={isEditMode ? undefined : defaultDate}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onDirtyChange={setIsDirty}
          />
        </DialogContent>
      </Dialog>

      {/* Discard changes confirmation */}
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

export { ActivityDialog };
