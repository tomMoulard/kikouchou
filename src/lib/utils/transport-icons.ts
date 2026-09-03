/**
 * @fileoverview The one mapping from a transport mode to its icon.
 *
 * There were three, and they disagreed about `other`: the shared
 * `TransportIcon` drew a person, the transport list a dot, and the sharing
 * wizard a map pin — so the same journey changed shape depending on which
 * screen showed it. `CircleDot` is the survivor: a person reads as "on foot"
 * and a pin as "a place", while a neutral marker is what "other" actually
 * means.
 *
 * @module lib/utils/transport-icons
 */

import { Bus, Car, CircleDot, Plane, Train } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { TransportMode } from '@/types';

/**
 * Every transport mode's icon.
 */
export const TRANSPORT_MODE_ICONS: Readonly<Record<TransportMode, LucideIcon>> = {
  plane: Plane,
  train: Train,
  car: Car,
  bus: Bus,
  other: CircleDot,
};

/**
 * Returns the icon component for a transport mode.
 *
 * Falls back to the `other` icon for an absent mode, and for a stored value
 * outside the union — rows written by an older build, or by a peer running one.
 *
 * @param mode - The transport mode, if known
 * @returns The Lucide icon component to render
 *
 * @example
 * ```tsx
 * const Icon = getTransportModeIcon(transport.transportMode);
 * return <Icon className="size-4" aria-hidden="true" />;
 * ```
 */
export function getTransportModeIcon(mode: TransportMode | undefined): LucideIcon {
  return (mode === undefined ? undefined : TRANSPORT_MODE_ICONS[mode]) ?? TRANSPORT_MODE_ICONS.other;
}
