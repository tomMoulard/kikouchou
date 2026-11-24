/**
 * @fileoverview An address that opens in the viewer's own maps app.
 *
 * An activity or a journey whose place was typed by hand has no coordinates,
 * and its "Directions" button only exists with them, so its address was text
 * with nothing to tap. This is the address itself as the way there: by its
 * coordinates when it was geocoded, by its text otherwise
 * (`buildPlaceMapsUrl`), opened through `openExternalUrl` so the store apps
 * hand it to the phone's maps app instead of their own web view.
 *
 * @module components/shared/AddressLink
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';

import { openExternalUrl } from '@/lib/native/external-links';
import { cn } from '@/lib/utils';
import { buildPlaceMapsUrl, type MapsLinkCoordinates } from '@/lib/utils/maps-link';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for {@link AddressLink}. */
export interface AddressLinkProps {
  /** The address or place name, as typed; also the pin's label. */
  readonly address: string;
  /** The point, when the place was geocoded. */
  readonly coordinates?: MapsLinkCoordinates | undefined;
  /** `sm` for a dense list, `md` (the default) for a detail row. */
  readonly size?: 'sm' | 'md';
  /** Additional classes for the row. */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * The address, with its pin, as a button that opens it in a maps app.
 *
 * @param props - See {@link AddressLinkProps}
 * @returns The address row
 */
export const AddressLink = memo(function AddressLink({
  address,
  coordinates,
  size = 'md',
  className,
}: AddressLinkProps): ReactElement {
  const { t } = useTranslation();

  const handleClick = useCallback(() => {
    openExternalUrl(buildPlaceMapsUrl(address, coordinates));
  }, [address, coordinates]);

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={t('map.openAddressInMaps', 'Open {{location}} in your maps app', {
        location: address,
      })}
      className={cn(
        'flex min-w-0 items-start text-left text-sm',
        size === 'sm' ? 'gap-2' : 'gap-3',
        'rounded-sm underline-offset-2 hover:underline',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <MapPin
        className={cn(
          'shrink-0 text-muted-foreground',
          size === 'sm' ? 'mt-0.5 size-3.5' : 'mt-0.5 size-4',
        )}
        aria-hidden="true"
      />
      {/* Underlined at rest, so it reads as something to tap on a phone,
          where there is no hover to say so. */}
      <span className="min-w-0 break-words underline decoration-muted-foreground/50">
        {address}
      </span>
    </button>
  );
});
