/**
 * @fileoverview Reusable Trip Card component with dropdown menu actions.
 * Displays trip information with Edit/Delete actions in a dropdown menu.
 *
 * @module features/trips/components/TripCard
 */

import {
  type MouseEvent,
  Suspense,
  lazy,
  memo,
  useCallback,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { type Locale, format, parseISO } from 'date-fns';
import { enUS, fr } from 'date-fns/locale';
import { Calendar, MapPin, MoreHorizontal, Pencil, Share2, Trash2, Users } from 'lucide-react';

// Lazy load the map component for performance
const TripLocationMap = lazy(() =>
  import('./TripLocationMap').then((module) => ({
    default: module.TripLocationMap,
  }))
);

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
import type { Person, Trip } from '@/types';
import { PersonBadge } from '@/components/shared/PersonBadge';

// ============================================================================
// Utility Functions
// ============================================================================
const MAX_VISIBLE_PERSONS = 4;


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
  readonly onClick: (trip: Trip) => void;
  /** Callback when Edit is selected from the menu */
  readonly onEdit?: () => void;
  /** Callback when Delete is selected from the menu */
  readonly onDelete?: () => void;
  /** Opens share dialog (link + QR) for this trip — e.g. from the trip list */
  readonly onShare?: (trip: Trip) => void;
  /** Whether the card interaction is currently disabled    */
  readonly isDisabled?: boolean;
  readonly persons: readonly Person[];
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
  onShare,
  isDisabled = false,
  persons,
}: TripCardProps) {
  const { t, i18n } = useTranslation(),

  // Get locale based on current language
   locale = useMemo(() => getDateLocale(i18n.language), [i18n.language]),
   visiblePersons = useMemo(
    () => persons.slice(0, MAX_VISIBLE_PERSONS),
    [persons],
  ),
   overflowCount = useMemo(
    () => Math.max(0, persons.length - MAX_VISIBLE_PERSONS),
    [persons],
  ),

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
    onClick(trip);
  }, [onClick, isDisabled, trip]),

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
    onEdit?.();
  }, [onEdit]),

  /**
   * Handles Delete menu item click.
   */
   handleDeleteClick = useCallback(() => {
    onDelete?.();
  }, [onDelete]),

   handleShareClick = useCallback(
    (event: MouseEvent) => {
      event.stopPropagation();
      if (isDisabled) {return;}
      onShare?.(trip);
    },
    [isDisabled, onShare, trip],
  );

  // ============================================================================
  // Render
  // ============================================================================

  const showCornerMenu = Boolean(onEdit && onDelete);
  const showCornerActions = Boolean(onShare || showCornerMenu);

  return (
    <Card
      onClick={handleCardClick}
      className={cn(
        'relative cursor-pointer transition-all duration-200',
        'hover:shadow-md hover:border-primary/20',
        isDisabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      {/*
        The card's activation target, as a real button covering the card.

        The card used to carry `role="button"` itself, which made the share
        button, the overflow menu and the map preview controls buttons nested
        inside a button — not expressible in the accessibility tree, since a
        button's children are presentational, and the reason
        `nested-interactive` was disabled for the whole a11y suite.

        Rendered first so it keeps its place at the head of the card's tab
        order, and overlaid so the whole card stays clickable and the focus
        ring still frames the whole card. It carries no click handler of its
        own: its click — including the synthetic one a keyboard Enter/Space
        produces — bubbles to the card's `onClick`, which is also what a click
        on the card's text does.
      */}
      <button
        type="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-disabled={isDisabled}
        className={cn(
          'absolute inset-0 z-10 rounded-xl',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isDisabled && 'cursor-not-allowed',
        )}
      />

      {/* Share + overflow menu — top-right */}
      {showCornerActions && (
      <div
        className="absolute top-2 right-2 z-20 flex items-center gap-0.5"
        onClick={handleMenuTriggerClick}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {onShare && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 md:size-8"
            aria-label={t('trips.shareTripAria', 'Share trip — link and QR code')}
            disabled={isDisabled}
            onClick={handleShareClick}
          >
            <Share2 className="size-4" aria-hidden="true" />
          </Button>
        )}
        {showCornerMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11 md:size-8"
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
        )}
      </div>
      )}

      {/* Card Content */}
      <CardHeader
        className={cn(
          showCornerActions && (onShare && showCornerMenu ? 'pr-28' : 'pr-14'),
        )}
      >
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
      <CardContent className="space-y-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Calendar className="size-4 shrink-0" aria-hidden="true" />
          <span>{dateRange}</span>
        </div>

        {/* Attendees */}
        <div className="flex items-center gap-1.5">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {persons.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">
              {t('trips.noGuests', 'No guests yet')}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {visiblePersons.map((person) => (
                <PersonBadge key={person.id} person={person} size="sm" />
              ))}
              {overflowCount > 0 && (
                <span className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded-full">
                  +{overflowCount}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Map Preview - only shown when coordinates are available */}
        {trip.coordinates && (
          <div
            // `relative z-20` lifts the map above the full-card activation
            // button, which would otherwise swallow every interaction with it.
            className="relative z-20"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Suspense
              fallback={
                <div className="h-20 w-full rounded-md bg-muted animate-pulse" />
              }
            >
              <TripLocationMap
                location={trip.location ?? trip.name}
                coordinates={trip.coordinates}
                previewHeight={80}
              />
            </Suspense>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { TripCard };
export type { TripCardProps };
