/**
 * Shared display helpers for transport data used across wizard steps.
 *
 * @module features/sharing/components/transport-display-helpers
 */

import type { ReactElement } from 'react';

import { getTransportModeIcon } from '@/lib/utils/transport-icons';
import type { TransportMode } from '@/types';

/**
 * Returns the Lucide icon element for a transport mode.
 * Includes a visually-hidden screen reader label.
 */
export function getTransportIcon(
  mode: TransportMode | undefined,
  t: (key: string, fallback: string) => string,
): ReactElement {
  const Icon = getTransportModeIcon(mode);
  const label = mode ? t(`transports.modes.${mode}`, mode) : t('transports.modes.other', 'other');

  return (
    <>
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </>
  );
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
