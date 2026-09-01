/**
 * @fileoverview Location picker component using OpenStreetMap Nominatim API.
 * Provides autocomplete suggestions for place search with keyboard navigation.
 * Enhanced with map preview for confirming and fine-tuning selected locations.
 *
 * @module components/shared/LocationPicker
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, MapPin, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LocationMapConfirm } from '@/components/shared/LocationMapConfirm';
import { cn } from '@/lib/utils';
import {
  GEOCODING_DEBOUNCE_MS,
  GEOCODING_MIN_QUERY_LENGTH,
  GeocodingError,
  type Coordinates,
  type GeocodingPlace,
  searchPlaces,
} from '@/lib/geocoding';

// ============================================================================
// Types
// ============================================================================

/**
 * Props for the LocationPicker component.
 */
export interface LocationPickerProps {
  /** Current location value (display name) */
  readonly value: string;
  /** Callback when location is selected or cleared */
  readonly onChange: (location: string, coordinates?: Coordinates) => void;
  /** Placeholder text */
  readonly placeholder?: string;
  /** Whether the picker is disabled */
  readonly disabled?: boolean;
  /** Additional CSS classes */
  readonly className?: string;
  /** Input id for form association */
  readonly id?: string;
  /** Input name for form association */
  readonly name?: string;
  /** ARIA label for accessibility */
  readonly 'aria-label'?: string;
  /** Error state for validation */
  readonly hasError?: boolean;
}

/**
 * Pending location selection before user confirmation.
 */
interface PendingSelection {
  displayName: string;
  coordinates: Coordinates;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Location picker with OpenStreetMap Nominatim autocomplete.
 *
 * @example
 * ```tsx
 * const [location, setLocation] = useState('');
 * const [coords, setCoords] = useState<Coordinates>();
 *
 * <LocationPicker
 *   value={location}
 *   onChange={(loc, coordinates) => {
 *     setLocation(loc);
 *     setCoords(coordinates);
 *   }}
 *   placeholder="Search for a location..."
 * />
 * ```
 */
export const LocationPicker = memo(function LocationPicker({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  id,
  name,
  'aria-label': ariaLabel,
  hasError = false,
}: LocationPickerProps) {
  const { t } = useTranslation();

  // ============================================================================
  // State
  // ============================================================================

  const [inputValue, setInputValue] = useState(value);
  const [results, setResults] = useState<readonly GeocodingPlace[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  // Pending selection - shown in map preview before confirmation
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);

  // ============================================================================
  // Refs
  // ============================================================================

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ============================================================================
  // Sync input with external value
  // ============================================================================

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // ============================================================================
  // Search Function
  // ============================================================================

  const search = useCallback(async (query: string) => {
    if (query.length < GEOCODING_MIN_QUERY_LENGTH) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    // Cancel any pending request
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      const places = await searchPlaces(query, { signal: controller.signal });
      setResults(places);
      // Keep dropdown open to show results or "no results" message
      setIsOpen(true);
      setHighlightedIndex(-1);
    } catch (err) {
      if (err instanceof GeocodingError && err.kind === 'aborted') {
        // Superseded by a newer query, or the component went away.
        return;
      }
      const message =
        err instanceof GeocodingError && err.kind === 'timeout'
          ? t('locationPicker.timeoutError', 'Search timed out. Please try again.')
          : t('locationPicker.searchError', 'Search failed. Please try again.');
      if (!(err instanceof GeocodingError)) {
        console.error('Location search error:', err);
      }
      setError(message);
      setResults([]);
      setIsOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  // ============================================================================
  // Debounced Search
  // ============================================================================

  const debouncedSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(() => {
        void search(query);
      }, GEOCODING_DEBOUNCE_MS);
    },
    [search]
  );

  // ============================================================================
  // Cleanup
  // ============================================================================

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

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = e.target.value;
      setInputValue(newValue);
      debouncedSearch(newValue);
    },
    [debouncedSearch]
  );

  const handleSelect = useCallback(
    (place: GeocodingPlace) => {
      // Set pending selection to show map preview
      setPendingSelection({
        displayName: place.label,
        coordinates: place.coordinates,
      });
      setInputValue(place.label);
      setIsOpen(false);
      setResults([]);
      setHighlightedIndex(-1);
    },
    []
  );

  /**
   * Confirms the pending selection and calls onChange with final values.
   */
  const handleConfirmSelection = useCallback(() => {
    if (pendingSelection) {
      onChange(pendingSelection.displayName, pendingSelection.coordinates);
      setPendingSelection(null);
    }
  }, [pendingSelection, onChange]);

  /**
   * Cancels the pending selection and reverts to previous state.
   */
  const handleCancelSelection = useCallback(() => {
    setPendingSelection(null);
    setInputValue(value); // Revert to original value
  }, [value]);

  /**
   * Updates coordinates when user drags marker on the map.
   */
  const handleCoordinatesChange = useCallback((coordinates: Coordinates) => {
    setPendingSelection((prev) =>
      prev ? { ...prev, coordinates } : null
    );
  }, []);

  const handleClear = useCallback(() => {
    setInputValue('');
    setResults([]);
    setIsOpen(false);
    setHighlightedIndex(-1);
    setPendingSelection(null);
    onChange('', undefined);
    inputRef.current?.focus();
  }, [onChange]);

  const handleInputFocus = useCallback(() => {
    if (results.length > 0) {
      setIsOpen(true);
    }
  }, [results.length]);

  const handleInputBlur = useCallback(() => {
    // Delay closing to allow click on results
    setTimeout(() => {
      setIsOpen(false);
      setHighlightedIndex(-1);
    }, 200);
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!isOpen || results.length === 0) {
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : 0
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) =>
            prev > 0 ? prev - 1 : results.length - 1
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < results.length) {
            const result = results[highlightedIndex];
            if (result) {
              handleSelect(result);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
      }
    },
    [isOpen, results, highlightedIndex, handleSelect]
  );

  // ============================================================================
  // Scroll highlighted item into view
  // ============================================================================

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  // ============================================================================
  // Computed Values
  // ============================================================================

  const showClear = inputValue.length > 0 && !disabled && !pendingSelection;
  const inputId = id ?? 'location-picker';
  const listboxId = `${inputId}-listbox`;

  const defaultPlaceholder = useMemo(
    () => t('locationPicker.placeholder', 'Search for a location...'),
    [t]
  );

  const defaultAriaLabel = useMemo(
    () => t('locationPicker.ariaLabel', 'Location search'),
    [t]
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={cn('relative', className)}>
      {/* Input with icon and clear button */}
      <div className="relative">
        <MapPin
          className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
        <Input
          ref={inputRef}
          id={inputId}
          name={name}
          type="text"
          role="combobox"
          aria-label={ariaLabel ?? defaultAriaLabel}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            highlightedIndex >= 0 ? `${inputId}-option-${highlightedIndex}` : undefined
          }
          aria-invalid={hasError}
          autoComplete="off"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? defaultPlaceholder}
          disabled={disabled || pendingSelection !== null}
          className={cn(
            'pl-9',
            showClear && 'pr-16',
            isLoading && 'pr-20'
          )}
        />
        {/* Loading indicator */}
        {isLoading && (
          <Loader2
            className="absolute right-10 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin"
            aria-hidden="true"
          />
        )}
        {/* Clear button */}
        {showClear && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 p-0 md:h-7 md:w-7"
            onClick={handleClear}
            aria-label={t('locationPicker.clear', 'Clear location')}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-1 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Results dropdown */}
      {isOpen && results.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={t('locationPicker.resultsLabel', 'Search results')}
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md"
        >
          {results.map((place, index) => (
            <li
              key={place.id}
              id={`${inputId}-option-${index}`}
              role="option"
              aria-selected={highlightedIndex === index}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                highlightedIndex === index
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-accent/50'
              )}
              onMouseDown={() => handleSelect(place)}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{place.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {place.typeLabel}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {place.fullName}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* No results message */}
      {isOpen &&
        results.length === 0 &&
        !isLoading &&
        inputValue.length >= GEOCODING_MIN_QUERY_LENGTH && (
        <div
          className="absolute z-50 mt-1 w-full rounded-md border bg-popover p-3 text-sm text-muted-foreground shadow-md"
          role="status"
        >
          {t('locationPicker.noResults', 'No locations found')}
        </div>
      )}

      {/* Map preview for confirming selected location */}
      {pendingSelection && (
        <LocationMapConfirm
          coordinates={pendingSelection.coordinates}
          locationName={pendingSelection.displayName}
          onCoordinatesChange={handleCoordinatesChange}
          onConfirm={handleConfirmSelection}
          onCancel={handleCancelSelection}
        />
      )}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

// Re-exported so existing `import { type Coordinates } from '.../LocationPicker'`
// call sites keep working now that the type lives in lib/geocoding.
export type { Coordinates };
