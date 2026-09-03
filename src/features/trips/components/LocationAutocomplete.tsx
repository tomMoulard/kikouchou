/**
 * @fileoverview Location autocomplete for trips.
 *
 * Merges two suggestion sources behind one input:
 * - **previous trips** — selecting one imports its location, description,
 *   coordinates and rooms;
 * - **map places** (OpenStreetMap Nominatim) — selecting one opens a map with a
 *   draggable pin, and confirming stores the coordinates on the trip.
 *
 * Free text still works: typing without picking a suggestion keeps the trip
 * unpinned, and editing the text drops a pin that no longer matches it.
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
import { Import, Loader2, MapPin, Pencil, X } from 'lucide-react';

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
  PopoverAnchor,
} from '@/components/ui/popover';
import { LocationMapConfirm } from '@/components/shared/LocationMapConfirm';
import { cn } from '@/lib/utils';
import { getTripsByLocation, getRoomsByTripId } from '@/lib/db';
import {
  GEOCODING_MIN_QUERY_LENGTH,
  GeocodingError,
  type Coordinates,
  type GeocodingPlace,
  formatCoordinates,
  searchPlaces,
} from '@/lib/geocoding';
import type { Room, Trip, TripId } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/** Debounce delay for location search in milliseconds */
const DEBOUNCE_MS = 300;

/** Minimum characters before searching previous trips */
const MIN_SEARCH_LENGTH = 2;

/** Number of map places offered alongside previous trips */
const MAX_PLACE_RESULTS = 5;

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
  /** Coordinates currently pinned for this location, if any */
  readonly coordinates?: Coordinates;
  /** Callback when the location changes (free text, or a confirmed map place) */
  readonly onChange: (value: string, coordinates?: Coordinates) => void;
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

/**
 * A place awaiting confirmation on the map.
 */
interface PendingSelection {
  readonly displayName: string;
  readonly coordinates: Coordinates;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Location input with previous-trip and map-place suggestions.
 *
 * @param props - Component props
 * @returns The location autocomplete element
 */
const LocationAutocomplete = memo(function LocationAutocomplete({
  value,
  coordinates,
  onChange,
  onImportTrip,
  disabled = false,
  placeholder,
  id,
  excludeTripId,
}: LocationAutocompleteProps) {
  const { t } = useTranslation();
  const [suggestions, setSuggestions] = useState<readonly Trip[]>([]);
  const [places, setPlaces] = useState<readonly GeocodingPlace[]>([]);
  const [isTripSearching, setIsTripSearching] = useState(false);
  const [isPlaceSearching, setIsPlaceSearching] = useState(false);
  // Set when the user dismisses the dropdown (Escape, outside click, a pick);
  // cleared on the next keystroke. Keeping "should it be open" derived from the
  // two result lists is what lets the sources land independently.
  const [isDismissed, setIsDismissed] = useState(true);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const tripSearchIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // ============================================================================
  // Search Logic
  // ============================================================================

  /**
   * Searches previous trips for the given query.
   *
   * Runs against IndexedDB, so its results land immediately; a two-letter query
   * is already enough to recognise a trip the user created before.
   */
  const searchTrips = useCallback(
    async (query: string) => {
      const searchId = ++tripSearchIdRef.current;
      setIsTripSearching(true);
      try {
        const results = await getTripsByLocation(query);
        // A newer keystroke already owns the dropdown.
        if (searchId !== tripSearchIdRef.current) {
          return;
        }
        setSuggestions(
          excludeTripId ? results.filter((trip) => trip.id !== excludeTripId) : results,
        );
      } catch (error) {
        console.error('Failed to search trips by location:', error);
        if (searchId === tripSearchIdRef.current) {
          setSuggestions([]);
        }
      } finally {
        if (searchId === tripSearchIdRef.current) {
          setIsTripSearching(false);
        }
      }
    },
    [excludeTripId],
  );

  /**
   * Searches OpenStreetMap for places matching the query.
   *
   * Deliberately independent of {@link searchTrips}: a slow or unreachable
   * Nominatim must never hold back the local trip suggestions.
   */
  const searchPlaceResults = useCallback(async (query: string) => {
    // Supersede the in-flight lookup, if any.
    abortControllerRef.current?.abort();

    if (query.length < GEOCODING_MIN_QUERY_LENGTH) {
      setPlaces([]);
      setIsPlaceSearching(false);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsPlaceSearching(true);

    try {
      const results = await searchPlaces(query, {
        signal: controller.signal,
        limit: MAX_PLACE_RESULTS,
      });
      setPlaces(results);
    } catch (error) {
      // An abort is ours — a newer keystroke or an unmount — so the newer run
      // (or nobody) owns the state from here.
      if (error instanceof GeocodingError && error.kind === 'aborted') {
        return;
      }
      console.error('Failed to search places:', error);
      setPlaces([]);
    } finally {
      if (abortControllerRef.current === controller) {
        setIsPlaceSearching(false);
      }
    }
  }, []);

  /**
   * Fans a query out to both suggestion sources.
   */
  const runSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();

      if (trimmed.length < MIN_SEARCH_LENGTH) {
        tripSearchIdRef.current++;
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setSuggestions([]);
        setPlaces([]);
        setIsTripSearching(false);
        setIsPlaceSearching(false);
        return;
      }

      void searchTrips(trimmed);
      void searchPlaceResults(trimmed);
    },
    [searchTrips, searchPlaceResults],
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
        runSearch(query);
      }, DEBOUNCE_MS);
    },
    [runSearch],
  );

  // Cleanup debounce and in-flight request on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles input value change — updates parent and triggers debounced search.
   *
   * Editing the text drops any pin: the coordinates were resolved from the old
   * text, so keeping them would leave the trip pinned somewhere the name no
   * longer describes.
   */
  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      onChange(newValue, undefined);
      setIsDismissed(false);
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
      setIsDismissed(true);
      setSuggestions([]);
      setPlaces([]);

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
   * Handles selecting a map place — opens the map for confirmation.
   */
  const handleSelectPlace = useCallback((place: GeocodingPlace) => {
    setIsDismissed(true);
    setSuggestions([]);
    setPlaces([]);
    setPendingSelection({
      displayName: place.label,
      coordinates: place.coordinates,
    });
  }, []);

  /**
   * Re-opens the map on the location already pinned, to nudge the marker.
   */
  const handleAdjustPin = useCallback(() => {
    if (!coordinates) {
      return;
    }
    setPendingSelection({ displayName: value, coordinates });
  }, [coordinates, value]);

  /**
   * Drops the pin but keeps the typed location name.
   */
  const handleRemovePin = useCallback(() => {
    onChange(value, undefined);
  }, [onChange, value]);

  /**
   * Moves the pending pin as the user drags the marker or clicks the map.
   */
  const handleCoordinatesChange = useCallback((next: Coordinates) => {
    setPendingSelection((prev) => (prev ? { ...prev, coordinates: next } : null));
  }, []);

  /**
   * Commits the pending place: name and coordinates go to the parent together.
   */
  const handleConfirmSelection = useCallback(() => {
    if (!pendingSelection) {
      return;
    }
    onChange(pendingSelection.displayName, pendingSelection.coordinates);
    setPendingSelection(null);
    inputRef.current?.focus();
  }, [onChange, pendingSelection]);

  /**
   * Abandons the pending place, leaving the field as it was.
   */
  const handleCancelSelection = useCallback(() => {
    setPendingSelection(null);
    inputRef.current?.focus();
  }, []);

  /**
   * Handles popover open state — close on external click.
   */
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setIsDismissed(true);
    }
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  const hasSuggestions = suggestions.length > 0 || places.length > 0;
  const isSearching = isTripSearching || isPlaceSearching;
  // Derived rather than stored: whichever source answers first opens the list,
  // and a slow one filling in later never re-opens a dropdown the user closed.
  const isOpen = !isDismissed && hasSuggestions;

  return (
    <div className="space-y-2">
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        {/*
          `PopoverAnchor`, not a trigger.

          `PopoverTrigger asChild` merges a button's semantics onto whatever it
          wraps, and what it wrapped here is a plain `<div>`. The rendered
          markup was `<div class="relative" type="button" aria-haspopup="dialog"
          aria-expanded="false" aria-controls="...">`, which axe reports as
          `aria-allowed-attr` (critical): a div with no role may carry none of
          those. It also contradicted the control inside it — the `Input` is the
          combobox, announcing `aria-haspopup="listbox"` with its own
          `aria-expanded` — so a screen reader was told about a dialog popup
          that does not exist, wrapping a listbox that does.

          Nothing here ever wanted trigger behaviour: the list opens from typing
          (`isOpen` is derived from the suggestions), never from clicking the
          box. `PopoverAnchor` is the primitive for that. It adds no semantics
          at all, and it is still what Radix measures for
          `--radix-popover-trigger-width`, so the dropdown keeps matching the
          input's width.
        */}
        <PopoverAnchor asChild>
          <div className="relative">
            <Input
              ref={inputRef}
              id={id}
              type="text"
              value={value}
              onChange={handleInputChange}
              placeholder={placeholder}
              disabled={disabled || pendingSelection !== null}
              autoComplete="off"
              role="combobox"
              aria-expanded={isOpen}
              aria-haspopup="listbox"
              aria-autocomplete="list"
              className={cn(isSearching && 'pr-10')}
            />
            {isSearching && (
              <Loader2
                className="absolute right-3 top-1/2 -translate-y-1/2 size-4 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </div>
        </PopoverAnchor>
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
              {!isSearching && !hasSuggestions && (
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
              {places.length > 0 && (
                <CommandGroup heading={t('trips.placeSuggestions')}>
                  {places.map((place) => (
                    <CommandItem
                      key={place.id}
                      value={`place:${place.id}`}
                      onSelect={() => handleSelectPlace(place)}
                      className="flex items-start gap-3 py-2"
                    >
                      <MapPin className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium">{place.label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {place.fullName}
                        </span>
                      </div>
                      <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">
                        {place.typeLabel}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Map confirmation for a place the user just picked */}
      {pendingSelection && (
        <LocationMapConfirm
          coordinates={pendingSelection.coordinates}
          locationName={pendingSelection.displayName}
          onCoordinatesChange={handleCoordinatesChange}
          onConfirm={handleConfirmSelection}
          onCancel={handleCancelSelection}
        />
      )}

      {/* Standing pin for an already-located trip */}
      {!pendingSelection && coordinates && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <MapPin className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t('trips.pinnedAt', { coordinates: formatCoordinates(coordinates) })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2"
            onClick={handleAdjustPin}
            disabled={disabled}
          >
            <Pencil className="mr-1 size-3.5" aria-hidden="true" />
            {t('trips.adjustPin')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-7 shrink-0 p-0"
            onClick={handleRemovePin}
            disabled={disabled}
            aria-label={t('trips.removePin')}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
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
