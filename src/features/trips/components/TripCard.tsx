/**
 * @fileoverview Reusable Trip Card component with dropdown menu actions.
 * Displays trip information with Edit/Delete actions in a dropdown menu.
 *
 * @module features/trips/components/TripCard
 */

import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, format, parseISO } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import { Calendar, MapPin, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Trip } from '@/types';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Gets the date-fns locale object for the given language code.
 *
 * @param lang - Language code (e.g., 'fr', 'en')
 * @returns date-fns Locale object
 *
 * @example
 * ```typescript
 * const locale = getDateLocale('fr'); // Returns French locale
 * const locale = getDateLocale('de'); // Returns English locale (fallback)
 * ```
 */
export function getDateLocale(lang: string): Locale {
  return lang === 'fr' ? fr : enUS;
}

/**
 * Formats a date range for display.
 * Handles same month and different month cases for cleaner output.
 *
 * @param startDate - Start date in ISO format (YYYY-MM-DD)
 * @param endDate - End date in ISO format (YYYY-MM-DD)
 * @param locale - date-fns locale object
 * @returns Formatted date range string
 *
 * @example
 * ```typescript
 * // Same month
 * formatDateRange('2024-07-15', '2024-07-22', fr) // "15 - 22 juil. 2024"
 *
 * // Different months
 * formatDateRange('2024-07-28', '2024-08-05', fr) // "28 juil. - 5 août 2024"
 * ```
 */
export function formatDateRange(
  startDate: string,
  endDate: string,
  locale: Locale,
): string {
  try {
    const start = parseISO(startDate),
     end = parseISO(endDate);

    // Validate parsed dates (parseISO returns Invalid Date, doesn't throw)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return `${startDate} - ${endDate}`;
    }

    // Check if dates are in the same month and year
    const sameMonth =
      start.getMonth() === end.getMonth() &&
      start.getFullYear() === end.getFullYear();

    if (sameMonth) {
      // Same month: "15 - 22 juil. 2024"
      return `${format(start, 'd', { locale })} - ${format(end, 'd MMM yyyy', { locale })}`;
    }

    // Different months: "28 juil. - 5 août 2024"
    return `${format(start, 'd MMM', { locale })} - ${format(end, 'd MMM yyyy', { locale })}`;
  } catch {
    // Fallback to raw ISO strings if parsing fails
    return `${startDate} - ${endDate}`;
  }
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TripCard component.
 */
interface TripCardProps {
  /** The trip to display */
  readonly trip: Trip;
  /** Callback when the card is clicked (not the menu) */
  readonly onClick: () => void;
  /** Callback when Edit is selected from the menu */
  readonly onEdit: () => void;
  /** Callback when Delete is selected from the menu */
  readonly onDelete: () => void;
  /** Whether the card interaction is currently disabled */
  readonly isDisabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A reusable trip card component with dropdown menu actions.
 *
 * Features:
 * - Displays trip name, location, and date range
 * - Dropdown menu with Edit and Delete actions
 * - Full keyboard accessibility
 * - Event propagation control (menu clicks don't trigger card click)
 * - Disabled state support
 *
 * @param props - Component props
 * @returns The trip card element
 *
 * @example
 * ```tsx
 * <TripCard
 *   trip={trip}
 *   onClick={() => navigate(`/trips/${trip.id}/calendar`)}
 *   onEdit={() => navigate(`/trips/${trip.id}/edit`)}
 *   onDelete={() => setDeleteDialogOpen(true)}
 * />
 * ```
 */
const TripCard = memo(function TripCard({
  trip,
  onClick,
  onEdit,
  onDelete,
  isDisabled = false,
}: TripCardProps) {
  const { t, i18n } = useTranslation(),

  // Get locale based on current language
   locale = useMemo(() => getDateLocale(i18n.language), [i18n.language]),

  // Format the date range
   dateRange = useMemo(
    () => formatDateRange(trip.startDate, trip.endDate, locale),
    [trip.startDate, trip.endDate, locale],
  ),

  // Build aria-label for screen readers
   ariaLabel = useMemo(() => {
    const parts = [trip.name];
    if (trip.location) {
      parts.push(trip.location);
    }
    parts.push(dateRange);
    return parts.join(', ');
  }, [trip.name, trip.location, dateRange]),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles card click - triggers onClick if not disabled.
   */
   handleCardClick = useCallback(() => {
    if (isDisabled) {return;}
    onClick();
  }, [onClick, isDisabled]),

  /**
   * Handles keyboard activation (Enter or Space) on the card.
   */
   handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (isDisabled) {return;}

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    },
    [onClick, isDisabled],
  ),

  /**
   * Stops event propagation to prevent card click when interacting with menu.
   */
   handleMenuTriggerClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
  }, []),

  /**
   * Handles Edit menu item click.
   */
   handleEditClick = useCallback(() => {
    onEdit();
  }, [onEdit]),

  /**
   * Handles Delete menu item click.
   */
   handleDeleteClick = useCallback(() => {
    onDelete();
  }, [onDelete]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Card
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-disabled={isDisabled}
      onClick={handleCardClick}
      onKeyDown={handleCardKeyDown}
      className={cn(
        'relative cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isDisabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {/* Dropdown Menu - positioned absolutely in top-right corner */}
      <div
        className="absolute top-2 right-2 z-10"
        onClick={handleMenuTriggerClick}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t('common.openMenu', 'Open menu')}
              disabled={isDisabled}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={handleEditClick}>
              <Pencil className="mr-2 size-4" aria-hidden="true" />
              {t('common.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={handleDeleteClick}>
              <Trash2 className="mr-2 size-4" aria-hidden="true" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Card Content */}
      <CardHeader className="pr-12">
        <CardTitle className="text-lg truncate" title={trip.name}>
          {trip.name}
        </CardTitle>
        {trip.location && (
          <CardDescription className="flex items-center gap-1.5 truncate">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={trip.location}>
              {trip.location}
            </span>
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Calendar className="size-4 shrink-0" aria-hidden="true" />
          <span>{dateRange}</span>
        </div>
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripCard };
export type { TripCardProps };
