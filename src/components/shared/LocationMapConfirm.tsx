/**
 * @fileoverview Map confirmation step for a picked location.
 * Shows the selected place on an OpenStreetMap tile layer with a draggable
 * marker so the user can nudge the pin before committing it.
 *
 * Shared by every location field: `LocationPicker` (transports, activities)
 * and `LocationAutocomplete` (trips).
 *
 * @module components/shared/LocationMapConfirm
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, MapPin, X } from 'lucide-react';
import { MapContainer, Marker, TileLayer, useMapEvents } from 'react-leaflet';
import { type LatLng, divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { type Coordinates, formatCoordinates } from '@/lib/geocoding';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the LocationMapConfirm component.
 */
export interface LocationMapConfirmProps {
  /** Coordinates currently under the marker */
  readonly coordinates: Coordinates;
  /** Place name displayed under the map */
  readonly locationName: string;
  /** Called whenever the marker moves (drag or map click) */
  readonly onCoordinatesChange: (coordinates: Coordinates) => void;
  /** Called when the user accepts the pin */
  readonly onConfirm: () => void;
  /** Called when the user backs out */
  readonly onCancel: () => void;
  /** Height of the map in pixels (default: 200) */
  readonly height?: number;
  /** Additional CSS classes for the container */
  readonly className?: string;
}

/**
 * Props for the DraggableMarker sub-component.
 */
interface DraggableMarkerProps {
  readonly position: [number, number];
  readonly onPositionChange: (lat: number, lon: number) => void;
}

/**
 * Props for the MapClickHandler sub-component.
 */
interface MapClickHandlerProps {
  readonly onMapClick: (lat: number, lon: number) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_MAP_HEIGHT = 200;
const MAP_ZOOM = 15;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Creates the draggable pin icon.
 */
function createDraggableMarkerIcon(): ReturnType<typeof divIcon> {
  const html = `
    <div style="
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      background-color: #3b82f6;
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      cursor: grab;
      transition: transform 0.1s ease;
    ">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
        <path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
      </svg>
    </div>
  `;

  return divIcon({
    html,
    className: 'draggable-marker-icon',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

// ============================================================================
// Internal Components
// ============================================================================

/**
 * A marker the user can drag to move the pin.
 */
function DraggableMarker({
  position,
  onPositionChange,
}: DraggableMarkerProps): ReactElement {
  const markerIcon = useMemo(() => createDraggableMarkerIcon(), []);

  const eventHandlers = useMemo(
    () => ({
      dragend: (e: { target: { getLatLng: () => LatLng } }) => {
        const latlng = e.target.getLatLng();
        onPositionChange(latlng.lat, latlng.lng);
      },
    }),
    [onPositionChange],
  );

  return (
    <Marker
      position={position}
      draggable={true}
      icon={markerIcon}
      eventHandlers={eventHandlers}
    />
  );
}

/**
 * Moves the pin to wherever the user clicks on the map.
 */
function MapClickHandler({ onMapClick }: MapClickHandlerProps): null {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Map preview with a draggable marker for confirming a picked location.
 *
 * @param props - Component props
 * @returns The map confirmation panel
 *
 * @example
 * ```tsx
 * <LocationMapConfirm
 *   coordinates={pending.coordinates}
 *   locationName={pending.label}
 *   onCoordinatesChange={(c) => setPending((p) => p && { ...p, coordinates: c })}
 *   onConfirm={() => commit(pending)}
 *   onCancel={() => setPending(null)}
 * />
 * ```
 */
export const LocationMapConfirm = memo(function LocationMapConfirm({
  coordinates,
  locationName,
  onCoordinatesChange,
  onConfirm,
  onCancel,
  height = DEFAULT_MAP_HEIGHT,
  className,
}: LocationMapConfirmProps): ReactElement {
  const { t } = useTranslation();

  const handlePositionChange = useCallback(
    (lat: number, lon: number) => {
      onCoordinatesChange({ lat, lon });
    },
    [onCoordinatesChange],
  );

  const position: [number, number] = [coordinates.lat, coordinates.lon];

  return (
    <div
      className={cn(
        'mt-2 rounded-md border border-border overflow-hidden',
        className,
      )}
    >
      {/* Map container */}
      <div className="relative" style={{ height }}>
        <MapContainer
          center={position}
          zoom={MAP_ZOOM}
          zoomControl={true}
          dragging={true}
          touchZoom={true}
          doubleClickZoom={false}
          scrollWheelZoom={true}
          className="h-full w-full"
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <DraggableMarker
            position={position}
            onPositionChange={handlePositionChange}
          />
          <MapClickHandler onMapClick={handlePositionChange} />
        </MapContainer>

        {/* Instruction overlay */}
        <div className="absolute top-2 left-2 right-2 z-[1000] pointer-events-none">
          <div className="bg-background/90 backdrop-blur-sm rounded-md px-2 py-1 text-xs text-muted-foreground text-center">
            {t('locationPicker.dragToAdjust', 'Drag marker or click to adjust location')}
          </div>
        </div>
      </div>

      {/* Location info and actions */}
      <div className="p-3 bg-muted/30 space-y-3">
        <div className="flex items-start gap-2">
          <MapPin className="size-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{locationName}</p>
            <p className="text-xs text-muted-foreground">
              {formatCoordinates(coordinates)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            className="flex-1"
          >
            <X className="size-4 mr-1" aria-hidden="true" />
            {t('common.cancel')}
          </Button>
          <Button type="button" size="sm" onClick={onConfirm} className="flex-1">
            <Check className="size-4 mr-1" aria-hidden="true" />
            {t('locationPicker.confirmLocation', 'Confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
});
