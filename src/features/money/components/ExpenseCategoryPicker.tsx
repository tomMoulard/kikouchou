/**
 * @fileoverview The category of one money line, picked from a dialog.
 *
 * The form asks for a category with one icon-only button rather than a labelled
 * dropdown: the category is the least interesting field on the line, and on a
 * phone it was taking a full row above the title. The labels are not lost —
 * they are all there, next to their icon, in the dialog the button opens.
 *
 * @module features/money/components/ExpenseCategoryPicker
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExpenseCategoryIcon } from '@/features/money/components/ExpenseCategoryIcon';
import { cn } from '@/lib/utils';
import { EXPENSE_CATEGORIES } from '@/types';
import type { ExpenseCategory } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link ExpenseCategoryPicker}.
 */
interface ExpenseCategoryPickerProps {
  /** The category currently on the line. */
  readonly value: ExpenseCategory;
  /** Called with the category the user picked. */
  readonly onChange: (category: ExpenseCategory) => void;
  /** Whether the button is disabled. */
  readonly disabled?: boolean;
  /** Id for the button, so a form can point a label at it. */
  readonly id?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Icon-only button that opens the list of categories.
 *
 * The button shows the icon of the category on the line and nothing else. Its
 * accessible name says which one that is, because an icon is not a label to a
 * screen reader.
 *
 * @param props - Component props
 * @returns The picker element
 *
 * @example
 * ```tsx
 * <ExpenseCategoryPicker value="groceries" onChange={setCategory} />
 * ```
 */
const ExpenseCategoryPicker = memo(function ExpenseCategoryPicker({
  value,
  onChange,
  disabled = false,
  id,
}: ExpenseCategoryPickerProps): ReactElement {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);

  const currentLabel = t(`money.expense.categories.${value}`);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handlePick = useCallback(
    (category: ExpenseCategory) => {
      onChange(category);
      setIsOpen(false);
    },
    [onChange],
  );

  return (
    <>
      <Button
        id={id}
        type="button"
        variant="outline"
        size="icon"
        onClick={handleOpen}
        disabled={disabled}
        aria-label={t('money.expense.categoryNamed', { name: currentLabel })}
        title={currentLabel}
      >
        <ExpenseCategoryIcon category={value} />
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('money.expense.categoryPick')}</DialogTitle>
            <DialogDescription>
              {t('money.expense.categoryPickDescription')}
            </DialogDescription>
          </DialogHeader>

          <div role="radiogroup" aria-label={t('money.expense.category')} className="grid gap-1">
            {EXPENSE_CATEGORIES.map((category) => {
              const isSelected = category === value;
              const label = t(`money.expense.categories.${category}`);

              return (
                <button
                  key={category}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => handlePick(category)}
                  className={cn(
                    'flex items-center gap-3 rounded-md border px-3 py-2 text-left text-sm',
                    'transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                    isSelected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted',
                  )}
                >
                  <ExpenseCategoryIcon category={category} />
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ExpenseCategoryPicker };
export type { ExpenseCategoryPickerProps };
