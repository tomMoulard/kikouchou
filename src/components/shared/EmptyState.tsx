/**
 * @fileoverview Reusable empty state component for displaying when lists or
 * collections have no data. Provides a consistent, accessible way to communicate
 * empty states with optional icon, descriptive text, and action button.
 *
 * @module components/shared/EmptyState
 */

import { memo } from 'react';
import { type LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Action configuration for the empty state call-to-action button.
 */
interface EmptyStateAction {
  /** Button label text */
  readonly label: string;
  /** Click handler for the action button */
  readonly onClick: () => void;
}

/**
 * Props for the EmptyState component.
 */
interface EmptyStateProps {
  /** Optional Lucide icon to display above the title */
  readonly icon?: LucideIcon;
  /** Main heading text describing the empty state */
  readonly title: string;
  /** Supporting text with additional context or instructions */
  readonly description: string;
  /** Optional action button configuration */
  readonly action?: EmptyStateAction;
  /** Optional additional CSS classes for the container */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A reusable empty state component for displaying when lists or collections
 * have no data.
 *
 * Provides a consistent, accessible way to communicate empty states with:
 * - Optional decorative icon
 * - Required title and description text
 * - Optional call-to-action button
 *
 * @param props - Component props
 * @returns The empty state display element
 *
 * @example
 * ```tsx
 * import { EmptyState } from '@/components/shared/EmptyState';
 * import { Users } from 'lucide-react';
 *
 * // Basic usage with icon and action
 * <EmptyState
 *   icon={Users}
 *   title="No participants"
 *   description="Add people who will participate in the trip"
 *   action={{
 *     label: "Add participant",
 *     onClick: () => setIsDialogOpen(true),
 *   }}
 * />
 *
 * // Minimal usage without icon or action
 * <EmptyState
 *   title="No results"
 *   description="Try adjusting your search criteria"
 * />
 * ```
 */
const EmptyState = memo(function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps): React.ReactElement {
  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center px-4 py-12 text-center',
        'max-w-md mx-auto',
        className,
      )}
    >
      {/* Icon */}
      {Icon && (
        <div className="mb-4">
          <Icon
            className="size-12 text-muted-foreground"
            aria-hidden="true"
            strokeWidth={1.5}
          />
        </div>
      )}

      {/* Title */}
      <h3 className="text-lg font-semibold text-foreground text-balance">
        {title}
      </h3>

      {/* Description */}
      <p className="mt-2 text-sm text-muted-foreground text-pretty">
        {description}
      </p>

      {/* Action button */}
      {action && (
        <div className="mt-6">
          <Button onClick={action.onClick}>{action.label}</Button>
        </div>
      )}
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { EmptyState };
export type { EmptyStateProps, EmptyStateAction };
