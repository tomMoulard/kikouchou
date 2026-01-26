/**
 * @fileoverview Reusable Person Card component with dropdown menu actions.
 * Displays person information, color indicator, transport summary,
 * and Edit/Delete actions in a dropdown menu.
 *
 * @module features/persons/components/PersonCard
 * @see RoomCard.tsx for reference implementation pattern
 */

import {
  memo,
  useCallback,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';
import { fr, enUS } from 'date-fns/locale';
import { MoreHorizontal, Plane, Pencil, Trash2 } from 'lucide-react';

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { cn } from '@/lib/utils';
import type { Person } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Transport summary for a person.
 */
export interface TransportSummary {
  /** Arrival transport info, if any */
  readonly arrival: {
    readonly datetime: string;
    readonly location: string;
  } | null;
  /** Departure transport info, if any */
  readonly departure: {
    readonly datetime: string;
    readonly location: string;
  } | null;
}

/**
 * Props for the PersonCard component.
 */
export interface PersonCardProps {
  /** The person to display */
  readonly person: Person;
  /** Transport summary (arrival/departure info) */
  readonly transportSummary: TransportSummary;
  /** Date locale for formatting (date-fns) */
  readonly dateLocale: typeof fr | typeof enUS;
  /** Whether the card interaction is currently disabled */
  readonly isDisabled?: boolean;
  /** Callback when the card body is clicked (not the menu) */
  readonly onClick?: (person: Person) => void;
  /** Callback when Edit is selected from the menu */
  readonly onEdit: (person: Person) => void;
  /** Callback when Delete is confirmed. Can be async. */
  readonly onDelete: (person: Person) => void | Promise<void>;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely formats a datetime string for display.
 * Returns formatted date or empty string on error.
 *
 * @param datetime - ISO datetime string
 * @param locale - date-fns locale object
 * @returns Formatted date string (e.g., "15 Jul")
 */
function formatTransportDate(
  datetime: string,
  locale: typeof fr | typeof enUS,
): string {
  try {
    const date = parseISO(datetime);
    if (isNaN(date.getTime())) return '';
    return format(date, 'd MMM', { locale });
  } catch {
    return '';
  }
}

/**
 * Gets the initials from a person's name.
 * Returns first letter of first and last word, uppercase.
 *
 * @param name - Person's full name
 * @returns Initials (1-2 characters)
 */
function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  
  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    return words[0]?.charAt(0).toUpperCase() ?? '?';
  }
  
  const first = words[0]?.charAt(0) ?? '';
  const last = words[words.length - 1]?.charAt(0) ?? '';
  return (first + last).toUpperCase();
}

// ============================================================================
// Component
// ============================================================================

/**
 * A reusable person card component with dropdown menu actions.
 *
 * Features:
 * - Displays person name with color indicator (avatar-style)
 * - Shows arrival and departure transport info when available
 * - Dropdown menu with Edit and Delete actions
 * - Delete confirmation via ConfirmDialog
 * - Full keyboard accessibility (Enter/Space to activate card)
 * - Event propagation control (menu clicks don't trigger card click)
 * - Disabled state support during async operations
 *
 * @param props - Component props
 * @returns The person card element
 *
 * @example
 * ```tsx
 * <PersonCard
 *   person={person}
 *   transportSummary={{ arrival: {...}, departure: {...} }}
 *   dateLocale={fr}
 *   onClick={(person) => navigate(`/persons/${person.id}`)}
 *   onEdit={(person) => setEditingPerson(person)}
 *   onDelete={async (person) => await deletePerson(person.id)}
 * />
 * ```
 */
const PersonCard = memo(function PersonCard({
  person,
  transportSummary,
  dateLocale,
  isDisabled = false,
  onClick,
  onEdit,
  onDelete,
}: PersonCardProps) {
  const { t } = useTranslation();

  // State for delete confirmation dialog
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // ============================================================================
  // Derived Values
  // ============================================================================

  const initials = useMemo(() => getInitials(person.name), [person.name]);

  const hasTransportInfo = transportSummary.arrival || transportSummary.departure;

  // Build aria-label for screen readers
  const ariaLabel = useMemo(() => {
    const parts = [person.name];
    if (transportSummary.arrival) {
      const arrivalDate = formatTransportDate(transportSummary.arrival.datetime, dateLocale);
      if (arrivalDate) {
        parts.push(`${t('transports.arrival')}: ${arrivalDate}`);
      }
    }
    if (transportSummary.departure) {
      const departureDate = formatTransportDate(transportSummary.departure.datetime, dateLocale);
      if (departureDate) {
        parts.push(`${t('transports.departure')}: ${departureDate}`);
      }
    }
    return parts.join(', ');
  }, [person.name, transportSummary, dateLocale, t]);

  // Determine if card should be interactive (has onClick handler)
  const isInteractive = Boolean(onClick) && !isDisabled;

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles card click - triggers onClick if interactive.
   */
  const handleCardClick = useCallback(() => {
    if (!isInteractive) return;
    onClick?.(person);
  }, [onClick, person, isInteractive]);

  /**
   * Handles keyboard activation (Enter or Space) on the card.
   */
  const handleCardKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!isInteractive) return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick?.(person);
      }
    },
    [onClick, person, isInteractive],
  );

  /**
   * Stops event propagation to prevent card click when interacting with menu.
   */
  const handleMenuAreaClick = useCallback((e: MouseEvent) => {
    e.stopPropagation();
  }, []);

  /**
   * Stops keyboard event propagation in menu area.
   */
  const handleMenuAreaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      e.stopPropagation();
    },
    [],
  );

  /**
   * Handles Edit menu item click.
   */
  const handleEditClick = useCallback(() => {
    onEdit(person);
  }, [onEdit, person]);

  /**
   * Opens the delete confirmation dialog.
   */
  const handleDeleteClick = useCallback(() => {
    setIsDeleteDialogOpen(true);
  }, []);

  /**
   * Handles delete confirmation - calls onDelete callback.
   */
  const handleConfirmDelete = useCallback(async () => {
    await onDelete(person);
  }, [onDelete, person]);

  /**
   * Handles delete dialog open state change.
   */
  const handleDeleteDialogOpenChange = useCallback((open: boolean) => {
    setIsDeleteDialogOpen(open);
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <>
      <Card
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? ariaLabel : undefined}
        aria-disabled={isDisabled || undefined}
        onClick={handleCardClick}
        onKeyDown={isInteractive ? handleCardKeyDown : undefined}
        className={cn(
          'relative transition-all duration-200',
          isInteractive && [
            'cursor-pointer',
            'hover:shadow-md hover:border-primary/20',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          ],
          isDisabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        {/* Dropdown Menu - positioned absolutely in top-right corner */}
        <div
          className="absolute top-2 right-2 z-10"
          onClick={handleMenuAreaClick}
          onKeyDown={handleMenuAreaKeyDown}
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
              <DropdownMenuItem
                variant="destructive"
                onSelect={handleDeleteClick}
              >
                <Trash2 className="mr-2 size-4" aria-hidden="true" />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Card Header - Color indicator and name */}
        <CardHeader className="pb-2 pr-12">
          <div className="flex items-center gap-3">
            {/* Avatar-style color indicator */}
            <div
              className="size-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm font-medium shadow-sm ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: person.color || '#6b7280' }}
              aria-hidden="true"
            >
              {initials}
            </div>
            <CardTitle className="text-lg truncate" title={person.name}>
              {person.name}
            </CardTitle>
          </div>
        </CardHeader>

        {/* Card Content - Transport summary */}
        <CardContent className="pt-0">
          {hasTransportInfo ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              {/* Arrival info */}
              {transportSummary.arrival && (
                <div className="flex items-center gap-2">
                  <Plane className="size-4 shrink-0" aria-hidden="true" />
                  <span className="font-medium text-foreground">
                    {formatTransportDate(transportSummary.arrival.datetime, dateLocale)}
                  </span>
                  <span className="truncate" title={transportSummary.arrival.location}>
                    {transportSummary.arrival.location}
                  </span>
                </div>
              )}

              {/* Departure info */}
              {transportSummary.departure && (
                <div className="flex items-center gap-2">
                  <Plane className="size-4 shrink-0 rotate-45" aria-hidden="true" />
                  <span className="font-medium text-foreground">
                    {formatTransportDate(transportSummary.departure.datetime, dateLocale)}
                  </span>
                  <span className="truncate" title={transportSummary.departure.location}>
                    {transportSummary.departure.location}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {t('transports.empty', 'No transport info')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={handleDeleteDialogOpenChange}
        title={t('persons.deleteConfirmTitle', 'Delete participant?')}
        description={t('persons.deleteConfirm', 'Do you really want to delete this participant?')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
});

PersonCard.displayName = 'PersonCard';

// ============================================================================
// Exports
// ============================================================================

export { PersonCard };
