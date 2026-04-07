/**
 * @fileoverview Location autocomplete component with import suggestions from previous trips.
 * Shows a dropdown of previously used locations when the user types, allowing them to
 * import configuration (location, description, coordinates, rooms) from a past trip.
 *
 * @module features/trips/components/LocationAutocomplete
 */

import {
  type ChangeEvent,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Import, MapPin, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getTripsByLocation, getRoomsByTripId } from '@/lib/db';
import type { Room, Trip, TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay for location search in milliseconds */
const DEBOUNCE_MS = 300;

/** Minimum characters before triggering search */
const MIN_SEARCH_LENGTH = 2;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Data passed when a trip is selected for import.
 */
export interface TripImportData {
  /** The source trip to import from */
  readonly trip: Trip;
  /** Rooms from the source trip */
  readonly rooms: Room[];
}

/**
 * Props for the LocationAutocomplete component.
 */
interface LocationAutocompleteProps {
  /** Current location value */
  readonly value: string;
  /** Callback when the location value changes (free text or selection) */
  readonly onChange: (value: string) => void;
  /** Callback when a trip is selected for import */
  readonly onImportTrip: (data: TripImportData) => void;
  /** Whether the input is disabled */
  readonly disabled?: boolean;
  /** Placeholder text */
  readonly placeholder?: string;
  /** HTML id for label association */
  readonly id?: string;
  /** ID of the trip being edited (to exclude from suggestions) */
  readonly excludeTripId?: TripId;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Location input with autocomplete suggestions from previous trips.
 *
 * When the user types a location that matches a previous trip, a dropdown
 * appears showing matching trips. Selecting a trip triggers the import
 * callback with the trip data and its rooms.
 *
 * Free-text entry still works — suggestions are optional and non-intrusive.
 *
 * @param props - Component props
 * @returns The location autocomplete element
 */
const LocationAutocomplete = memo(function LocationAutocomplete({
  value,
  onChange,
  onImportTrip,
  disabled = false,
  placeholder,
  id,
  excludeTripId,
}: LocationAutocompleteProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Trip[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ============================================================================
  // Search Logic
  // ============================================================================

  /**
   * Searches for trips matching the given location query.
   */
  const searchTrips = useCallback(
    async (query: string) => {
      if (query.trim().length < MIN_SEARCH_LENGTH) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      setIsSearching(true);
      try {
        const results = await getTripsByLocation(query);
        // Filter out the current trip if editing
        const filtered = excludeTripId
          ? results.filter((trip) => trip.id !== excludeTripId)
          : results;
        setSuggestions(filtered);
        setIsOpen(filtered.length > 0);
      } catch (error) {
        console.error('Failed to search trips by location:', error);
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsSearching(false);
      }
    },
    [excludeTripId],
  );

  /**
   * Debounced search triggered on input change.
   */
  const debouncedSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        void searchTrips(query);
      }, DEBOUNCE_MS);
    },
    [searchTrips],
  );

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles input value change — updates parent and triggers debounced search.
   */
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      onChange(newValue);
      debouncedSearch(newValue);
    },
    [onChange, debouncedSearch],
  );

  /**
   * Handles selecting a trip from the suggestions dropdown.
   * Loads the trip's rooms and fires the import callback.
   */
  const handleSelectTrip = useCallback(
    async (trip: Trip) => {
      setIsOpen(false);
      setSuggestions([]);

      try {
        const rooms = await getRoomsByTripId(trip.id);
        onImportTrip({ trip, rooms });
      } catch (error) {
        console.error('Failed to load rooms for import:', error);
        // Still import trip-level data even if rooms fail
        onImportTrip({ trip, rooms: [] });
      }

      // Refocus the input for continued editing
      inputRef.current?.focus();
    },
    [onImportTrip],
  );

  /**
   * Handles popover open state — close on external click.
   */
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setIsOpen(false);
    }
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            id={id}
            type="text"
            value={value}
            onChange={handleInputChange}
            placeholder={placeholder}
            disabled={disabled}
            autoComplete="off"
            role="combobox"
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-autocomplete="list"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        onOpenAutoFocus={(e) => {
          // Prevent popover from stealing focus from the input
          e.preventDefault();
        }}
      >
        <Command shouldFilter={false}>
          <CommandList>
            {!isSearching && suggestions.length === 0 && (
              <CommandEmpty>{t('trips.noMatchingLocations')}</CommandEmpty>
            )}
            {suggestions.length > 0 && (
              <CommandGroup heading={t('trips.importSuggestion')}>
                {suggestions.map((trip) => (
                  <CommandItem
                    key={trip.id}
                    value={trip.id}
                    onSelect={() => void handleSelectTrip(trip)}
                    className="flex items-start gap-3 py-2"
                  >
                    <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate font-medium">
                        {trip.location}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {trip.name}
                      </span>
                    </div>
                    <Import className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
});

// ============================================================================
// Import Badge Sub-component
// ============================================================================

/**
 * Props for the ImportBadge component.
 */
interface ImportBadgeProps {
  /** Name of the trip being imported from */
  readonly tripName: string;
  /** Number of rooms that will be imported */
  readonly roomCount: number;
  /** Callback to remove/cancel the import */
  readonly onRemove: () => void;
  /** Whether the badge is disabled (e.g., during form submission) */
  readonly disabled?: boolean;
}

/**
 * Displays an indicator showing which trip's configuration is being imported.
 * Includes a remove button to cancel the import.
 */
const ImportBadge = memo(function ImportBadge({
  tripName,
  roomCount,
  onRemove,
  disabled = false,
}: ImportBadgeProps) {
  const { t } = useTranslation();

  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm',
      disabled && 'opacity-50',
    )}>
      <Import className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t('trips.importedFrom', { tripName })}
        {roomCount > 0 && (
          <span className="text-muted-foreground">
            {' '}({roomCount} {roomCount === 1 ? 'room' : 'rooms'})
          </span>
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="size-6 shrink-0 p-0"
        onClick={onRemove}
        disabled={disabled}
        aria-label={t('trips.removeImport')}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { LocationAutocomplete, ImportBadge };
export type { LocationAutocompleteProps, ImportBadgeProps };
