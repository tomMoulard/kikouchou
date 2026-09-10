/**
 * @fileoverview Expense category icon component.
 * Maps expense categories to their Lucide icons.
 *
 * @module features/money/components/ExpenseCategoryIcon
 */

import { type CSSProperties, type ReactElement, memo } from 'react';
import {
  Car,
  House,
  type LucideIcon,
  Receipt,
  ShoppingCart,
  Sparkles,
  Ticket,
  UtensilsCrossed,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ExpenseCategory } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link ExpenseCategoryIcon}.
 */
interface ExpenseCategoryIconProps {
  /** The expense category to display an icon for */
  readonly category: ExpenseCategory | undefined;
  /** Additional CSS classes */
  readonly className?: string;
  /** Inline styles */
  readonly style?: CSSProperties;
  /** Accessible label for screen readers; omit to mark the icon decorative */
  readonly 'aria-label'?: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Maps expense categories to their corresponding Lucide icons.
 */
const EXPENSE_CATEGORY_ICONS: Readonly<Record<ExpenseCategory, LucideIcon>> = {
  lodging: House,
  groceries: ShoppingCart,
  meal: UtensilsCrossed,
  transport: Car,
  activity: Ticket,
  supplies: Sparkles,
  other: Receipt,
} as const;

// ============================================================================
// Component
// ============================================================================

/**
 * Displays the icon standing for an expense category.
 *
 * A line with an unknown category falls back to the generic icon, so a row
 * written by a newer build never renders a blank slot.
 *
 * @example
 * ```tsx
 * <ExpenseCategoryIcon category="groceries" />
 * ```
 */
const ExpenseCategoryIcon = memo(function ExpenseCategoryIcon({
  category,
  className,
  style,
  'aria-label': ariaLabel,
}: ExpenseCategoryIconProps): ReactElement {
  const Icon =
    (category && EXPENSE_CATEGORY_ICONS[category]) ?? EXPENSE_CATEGORY_ICONS.other;

  return (
    <Icon
      className={cn('size-4 shrink-0', className)}
      style={style}
      aria-label={ariaLabel}
      aria-hidden={!ariaLabel}
    />
  );
});

// ============================================================================
// Exports
// ============================================================================

export { ExpenseCategoryIcon };
export type { ExpenseCategoryIconProps };
