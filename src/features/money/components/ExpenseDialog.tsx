/**
 * @fileoverview Dialog for creating, viewing and editing one money line.
 * Wraps ExpenseForm in a shadcn/ui Dialog with unsaved-changes protection.
 *
 * @module features/money/components/ExpenseDialog
 */

import { type ReactElement, memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ExpenseForm } from '@/features/money/components/ExpenseForm';
import type { PersonNightCounts } from '@/features/money/lib/expense-split';
import { useOfflineAwareNotify } from '@/hooks';
import type {
  Expense,
  ExpenseFormData,
  ISODateString,
  Person,
  PersonId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the ExpenseDialog component.
 */
export interface ExpenseDialogProps {
  /** The line being viewed or edited. Undefined means create mode. */
  readonly expense?: Expense;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /** Guests available as payer and beneficiaries. */
  readonly persons: readonly Person[];
  /** Each guest's person nights, for a line split by nights. */
  readonly personNights: PersonNightCounts;
  /** Day pre-selected in create mode (YYYY-MM-DD). */
  readonly defaultDate?: ISODateString;
  /** Guest pre-selected as the payer in create mode. */
  readonly defaultPayerId?: PersonId;
  /** Saves the line. */
  readonly onSave: (data: ExpenseFormData, expense: Expense | undefined) => Promise<void>;
  /** Deletes the line being edited. */
  readonly onDelete: (expense: Expense) => Promise<void>;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Dialog for creating and editing one money line.
 *
 * Features:
 * - Dual mode: create (no expense) and edit (expense provided)
 * - Guards against losing unsaved edits when closing
 * - Deletes the line behind a confirmation
 * - Closes automatically on successful submission
 *
 * @param props - Component props
 * @returns The expense dialog element
 */
const ExpenseDialog = memo(function ExpenseDialog({
  expense,
  open,
  onOpenChange,
  persons,
  personNights,
  defaultDate,
  defaultPayerId,
  onSave,
  onDelete,
}: ExpenseDialogProps): ReactElement {
  const { t } = useTranslation();
  const { notifySuccess } = useOfflineAwareNotify();

  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset dirty state when the dialog opens (prevents stale state carrying over)
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional reset on dialog open */
  useEffect(() => {
    if (open) {
      setIsDirty(false);
      setShowDiscardConfirm(false);
      setShowDeleteConfirm(false);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isEditMode = expense !== undefined;

  const handleSubmit = useCallback(
    async (data: ExpenseFormData) => {
      await onSave(data, expense);
      notifySuccess(
        isEditMode ? t('money.expense.updateSuccess') : t('money.expense.createSuccess'),
      );
      onOpenChange(false);
    },
    [expense, isEditMode, notifySuccess, onOpenChange, onSave, t],
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

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const handleDeleteCancel = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      setShowDeleteConfirm(false);
    }
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!expense) {
      return;
    }
    await onDelete(expense);
    setShowDeleteConfirm(false);
    setIsDirty(false);
    onOpenChange(false);
  }, [expense, onDelete, onOpenChange]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? t('money.expense.edit') : t('money.expense.new')}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? t('money.expense.editDescription')
                : t('money.expense.newDescription')}
            </DialogDescription>
          </DialogHeader>

          <ExpenseForm
            expense={expense}
            persons={persons}
            personNights={personNights}
            defaultDate={isEditMode ? undefined : defaultDate}
            defaultPayerId={isEditMode ? undefined : defaultPayerId}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onDirtyChange={setIsDirty}
          />

          {isEditMode && (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={handleDeleteClick}
            >
              <Trash2 className="mr-2 size-4" aria-hidden="true" />
              {t('money.expense.delete')}
            </Button>
          )}
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

      {/* Delete confirmation */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={handleDeleteCancel}
        title={t('confirm.deleteExpense')}
        description={t('confirm.deleteExpenseDescription')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleDeleteConfirm}
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ExpenseDialog };
