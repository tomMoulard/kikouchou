/**
 * @fileoverview How a room's beds read: "2 × Single · 80 × 200".
 *
 * One formatter for the card, the printed summary and the room form, so a bed
 * reads the same wherever a guest meets it.
 *
 * @module features/rooms/utils/bed-format
 */

import type { TFunction } from 'i18next';

import { BED_KIND_DEFAULT_SIZE } from '@/types';
import type { BedKind, RoomBed, RoomBedLayout } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * The translation key of each bed kind. `sofa-bed` is not a key i18next
 * reads well, so the kinds go through this map.
 */
const BED_KIND_KEYS: Readonly<Record<BedKind, string>> = {
  single: 'rooms.bedKinds.single',
  double: 'rooms.bedKinds.double',
  queen: 'rooms.bedKinds.queen',
  king: 'rooms.bedKinds.king',
  bunk: 'rooms.bedKinds.bunk',
  'sofa-bed': 'rooms.bedKinds.sofaBed',
  cot: 'rooms.bedKinds.cot',
};

// ============================================================================
// Formatters
// ============================================================================

/** The name of a bed kind, in the reader's language. */
export function formatBedKind(kind: BedKind, t: TFunction): string {
  return t(BED_KIND_KEYS[kind]);
}

/**
 * A bed's size in centimetres, width first: "160 × 200". A size the organiser
 * did not type reads as the kind's usual one.
 */
export function formatBedSize(bed: Pick<RoomBed, 'kind' | 'widthCm' | 'lengthCm'>): string {
  const fallback = BED_KIND_DEFAULT_SIZE[bed.kind];
  return `${bed.widthCm ?? fallback.widthCm} × ${bed.lengthCm ?? fallback.lengthCm}`;
}

/** One line of a layout: "Queen · 160 × 200", or "2 × Single · 80 × 200". */
export function formatBedLine(bed: RoomBed, t: TFunction): string {
  const label = `${formatBedKind(bed.kind, t)} · ${formatBedSize(bed)}`;
  return bed.count > 1 ? `${bed.count} × ${label}` : label;
}

/** Every line of a layout, comma-separated. */
export function formatBedLayout(layout: Pick<RoomBedLayout, 'beds'>, t: TFunction): string {
  return layout.beds.map((bed) => formatBedLine(bed, t)).join(', ');
}
