/**
 * Shared display helpers for transport data used across wizard steps.
 *
 * @module features/sharing/components/transport-display-helpers
 */

import type { ReactElement } from 'react';
import { Bus, Car, MapPin, Plane, Train } from 'lucide-react';

import { getDateLocale } from '@/lib/i18n/date-locale';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
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
 * Formats a transport datetime for the wizard's review steps.
 *
 * The wizard used to render this with a native `Intl` `dateStyle`/`timeStyle`
 * pair, which put an imported departure on a 12-hour clock while every other
 * screen showed it on a 24-hour one. It now goes through the app-wide renderer,
 * in the roomiest variant — a review step is where the year matters.
 *
 * @param datetime - The stored ISO datetime (a UTC instant)
 * @param locale - The active i18next language, e.g. `i18n.language`
 * @returns The rendered datetime, or a fallback when it cannot be parsed
 */
export function formatDatetime(datetime: string, locale?: string): string {
  const formatted = formatTransportDatetime(
    datetime,
    getDateLocale(locale ?? ''),
    'fullDayAndTime',
  );
  return formatted || datetime || '—';
}
