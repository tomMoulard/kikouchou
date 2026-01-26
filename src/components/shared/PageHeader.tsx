/**
 * @fileoverview Consistent page header component with title, description,
 * optional action slot, and optional back navigation.
 *
 * @module components/shared/PageHeader
 */

import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the PageHeader component.
 */
interface PageHeaderProps {
  /** Page title displayed as the primary heading */
  readonly title: string;
  /** Optional description text displayed below the title */
  readonly description?: string;
  /** Optional action slot for buttons or other interactive elements */
  readonly action?: React.ReactNode;
  /** Optional URL for back navigation link */
  readonly backLink?: string;
  /** Additional CSS classes for the header container */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A consistent page header component for displaying page titles with optional
 * description, action slot, and back navigation.
 *
 * Features:
 * - Semantic HTML structure with `<header>` and `<h1>`
 * - Responsive layout (stacked on mobile, side-by-side on desktop)
 * - Optional back link using React Router
 * - Flexible action slot for buttons
 * - Internationalized back link text
 *
 * @param props - Component props
 * @returns The page header element
 *
 * @example
 * ```tsx
 * import { PageHeader } from '@/components/shared/PageHeader';
 * import { Button } from '@/components/ui/button';
 *
 * // Simple header with just a title
 * <PageHeader title="Dashboard" />
 *
 * // Header with description
 * <PageHeader
 *   title="Settings"
 *   description="Manage your account preferences and application settings"
 * />
 *
 * // Header with back link and action
 * <PageHeader
 *   title="Edit Room"
 *   description="Update room details and capacity"
 *   backLink="/rooms"
 *   action={
 *     <Button variant="destructive">Delete Room</Button>
 *   }
 * />
 *
 * // Header with multiple actions
 * <PageHeader
 *   title="Trip Details"
 *   backLink="/trips"
 *   action={
 *     <>
 *       <Button variant="outline">Share</Button>
 *       <Button>Save Changes</Button>
 *     </>
 *   }
 * />
 * ```
 */
const PageHeader = memo(({
  title,
  description,
  action,
  backLink,
  className,
}: PageHeaderProps): React.ReactElement => {
  const { t } = useTranslation();

  return (
    <header className={cn('flex flex-col gap-4 pb-4 md:pb-6', className)}>
      {/* Back navigation link */}
      {backLink && (
        <div>
          <Link
            to={backLink}
            className={cn(
              'inline-flex items-center gap-1.5 text-sm text-muted-foreground',
              'transition-colors hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'rounded-sm',
            )}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>{t('common.back', 'Back')}</span>
          </Link>
        </div>
      )}

      {/* Title row with action slot */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        {/* Title and description */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground md:text-base max-w-2xl text-pretty">
              {description}
            </p>
          )}
        </div>

        {/* Action slot */}
        {action && (
          <div className="flex items-center gap-2 shrink-0">{action}</div>
        )}
      </div>
    </header>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { PageHeader };
export type { PageHeaderProps };
