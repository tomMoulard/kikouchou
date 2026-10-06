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
 * The heading levels an empty state may render its title at.
 *
 * A union rather than an enum: `erasableSyntaxOnly` forbids enums.
 */
type EmptyStateHeadingLevel = 2 | 3 | 4;

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
  /**
   * Optional second call to action, rendered beside {@link EmptyStateProps.action}
   * as an outline button.
   *
   * For empty states where two different next steps are equally reasonable —
   * the calendar has nothing on it until the trip has both guests and rooms,
   * and neither one is the obvious first stop. Requires `action`: a lone
   * secondary button would render the less prominent of the two styles with
   * nothing to be secondary to.
   */
  readonly secondaryAction?: EmptyStateAction;
  /** Optional additional CSS classes for the container */
  readonly className?: string;
  /**
   * Heading level for the title.
   *
   * This is not decoration: the level has to match where the empty state
   * actually sits, or the document outline skips a level and screen-reader
   * users lose the structure. It used to be a hardcoded `h3`, which is why
   * `heading-order` was switched off for the whole a11y suite.
   *
   * Defaults to `2`, which is what every current caller needs — each one
   * renders directly under a page's `PageHeader`, and that renders the `h1`.
   * Pass `3` when the empty state sits inside a section that already has its
   * own `h2`.
   *
   * @default 2
   */
  readonly headingLevel?: EmptyStateHeadingLevel;
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
  secondaryAction,
  className,
  headingLevel = 2,
}: EmptyStateProps): React.ReactElement {
  // Rendered as a variable so the level follows the page's outline instead of
  // being fixed at `h3` wherever the component happens to be dropped.
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';

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
      <Heading className="text-lg font-semibold text-foreground text-balance">
        {title}
      </Heading>

      {/* Description */}
      <p className="mt-2 text-sm text-muted-foreground text-pretty">
        {description}
      </p>

      {/* Action buttons */}
      {action && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={action.onClick}>{action.label}</Button>
          {secondaryAction && (
            <Button variant="outline" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { EmptyState };
export type { EmptyStateProps, EmptyStateAction, EmptyStateHeadingLevel };
