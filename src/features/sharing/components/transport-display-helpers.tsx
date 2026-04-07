/**
 * Shared display helpers for transport data used across wizard steps.
 *
 * @module features/sharing/components/transport-display-helpers
 */

import type { ReactElement } from 'react';
import { Bus, Car, MapPin, Plane, Train } from 'lucide-react';

import type { TransportMode } from '@/types';

/**
 * Returns the Lucide icon element for a transport mode.
 * Includes a visually-hidden screen reader label.
 */
export function getTransportIcon(
  mode: TransportMode | undefined,
  t: (key: string, fallback: string) => string,
): ReactElement {
  const iconProps = { className: 'size-4', 'aria-hidden': true as const };
  const label = mode ? t(`transports.modes.${mode}`, mode) : t('transports.modes.other', 'other');

  switch (mode) {
    case 'train':
      return <><Train {...iconProps} /><span className="sr-only">{label}</span></>;
    case 'plane':
      return <><Plane {...iconProps} /><span className="sr-only">{label}</span></>;
    case 'car':
      return <><Car {...iconProps} /><span className="sr-only">{label}</span></>;
    case 'bus':
      return <><Bus {...iconProps} /><span className="sr-only">{label}</span></>;
    default:
      return <><MapPin {...iconProps} /><span className="sr-only">{label}</span></>;
  }
}

/**
 * Formats a datetime string for display using the provided locale.
 * Returns a fallback string if the datetime is invalid.
 */
export function formatDatetime(datetime: string, locale?: string): string {
  try {
    const date = new Date(datetime);
    if (isNaN(date.getTime())) return datetime || '—';
    return date.toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return datetime || '—';
  }
}
