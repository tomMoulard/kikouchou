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
import { getDateLocale } from '@/lib/i18n/date-locale';
import { cn } from '@/lib/utils';
import { formatDateRange } from '@/lib/utils/date-format';
import type { Person, Trip } from '@/types';
import { PersonBadge } from '@/components/shared/PersonBadge';

// ============================================================================
// Utility Functions
// ============================================================================
const MAX_VISIBLE_PERSONS = 4;

/** How much of a trip's notes goes into the card's accessible name. */
const ARIA_DESCRIPTION_LENGTH = 120;

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
 * - Displays trip name, location, date range, notes and attendees
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
   overflowLabel = t('trips.moreGuests', { count: overflowCount }),

  // Trimmed here rather than at the source: a description of nothing but
  // whitespace is a description the card must not make room for.
   description = trip.description?.trim() ?? '',

  // Format the date range
   dateRange = useMemo(
    () => formatDateRange(trip.startDate, trip.endDate, locale),
    [trip.startDate, trip.endDate, locale],
  ),


  // Build aria-label for screen readers.
  //
  // The whole card is one `role="button"`, so its accessible name is all a
  // screen reader gets — the text inside it is not announced separately. The
  // guest count therefore has to be said here or not at all.
   ariaLabel = useMemo(() => {
    const parts = [trip.name];
    if (trip.location) {
      parts.push(trip.location);
    }
    parts.push(dateRange);
    parts.push(
      persons.length === 0
        ? t('trips.noGuests')
        : t('trips.guestCount', { count: persons.length }),
    );
    if (description) {
      // Clipped: the label is spoken in one breath, and a thousand-character
      // note would bury the trip it belongs to.
      parts.push(description.slice(0, ARIA_DESCRIPTION_LENGTH));
    }
    return parts.join(', ');
  }, [trip.name, trip.location, dateRange, persons.length, description, t]),

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
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- The div has no behaviour of its own: the handlers only stop propagation so the full-card activation button underneath does not swallow a click meant for the share or overflow button. The interactive elements are the ones inside it.
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
            className="md:size-8"
            aria-label={t('trips.shareTripAria')}
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
              className="md:size-8"
              aria-label={t('common.openMenu')}
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

        {/* Notes. The trip form has always captured these and nothing has ever
            shown them back — a field that went nowhere. Clamped rather than
            truncated so a long note stays readable in the tooltip. */}
        {description && (
          <p
            className="line-clamp-2 text-sm text-muted-foreground italic whitespace-pre-wrap break-words"
            title={description}
          >
            {description}
          </p>
        )}

        {/* Attendees */}
        <div className="flex items-center gap-1.5">
          <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          {persons.length === 0 ? (
            <span className="text-sm text-muted-foreground italic">
              {t('trips.noGuests')}
            </span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {visiblePersons.map((person) => (
                <PersonBadge key={person.id} person={person} size="sm" />
              ))}
              {overflowCount > 0 && (
                <span
                  className="text-xs text-muted-foreground px-1.5 py-0.5 bg-muted rounded-full"
                  title={overflowLabel}
                >
                  {/* "+3" is fine to look at and useless to hear. The card's
                      own aria-label carries the full guest count, since a
                      `role="button"` announces its name and not its contents;
                      this text is for the browse modes that do walk inside. */}
                  <span aria-hidden="true">+{overflowCount}</span>
                  <span className="sr-only">{overflowLabel}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Map Preview - only shown when coordinates are available */}
        {trip.coordinates && (
          // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- The div has no behaviour of its own: the handlers only stop propagation so the full-card activation button underneath does not swallow a drag or click meant for the map. The interactive elements are the ones inside it.
          <div
            // `relative z-20` lifts the map above the full-card activation
            // button, which would otherwise swallow every interaction with it.
            className="relative z-20"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Suspense
              fallback={
                // The one content-shaped loading state in the app; everything
                // else spins. It is deliberately kept: the placeholder is
                // exactly the height the map will be, so the card does not jump
                // when the chunk lands.
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
