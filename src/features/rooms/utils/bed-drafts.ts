/**
 * @fileoverview The room form's drafts of a room's beds, and their conversion
 * to and from the stored layouts.
 *
 * A size stays text while it is typed, so a half-typed "16" is not stored or
 * rejected before the organiser has finished typing "160".
 *
 * @module features/rooms/utils/bed-drafts
 */

import { nanoid } from 'nanoid';

import {
  MAX_BED_COUNT,
  MAX_BED_LENGTH_CM,
  MAX_BED_WIDTH_CM,
  MIN_BED_LENGTH_CM,
  MIN_BED_WIDTH_CM,
} from '@/types';
import type { BedKind, RoomBed, RoomBedLayout } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** One bed line as the form edits it: sizes stay text until submit. */
export interface BedDraft {
  readonly key: string;
  readonly kind: BedKind;
  readonly count: number;
  readonly width: string;
  readonly length: string;
}

/** One layout as the form edits it. */
export interface LayoutDraft {
  readonly key: string;
  readonly name: string;
  readonly beds: readonly BedDraft[];
}


// ============================================================================
// Drafts
// ============================================================================

/** A new bed line. */
export function createBedDraft(kind: BedKind, count = 1): BedDraft {
  return { key: nanoid(), kind, count, width: '', length: '' };
}

/**
 * The first layout of a room that had only a number: one double for two
 * people, otherwise that many singles, so "Describe the beds" starts from what
 * the room already said.
 */
export function createLayoutFromCapacity(capacity: number): LayoutDraft {
  const bed =
    capacity === 2
      ? createBedDraft('double')
      : createBedDraft('single', Math.min(Math.max(capacity, 1), MAX_BED_COUNT));
  return { key: nanoid(), name: '', beds: [bed] };
}

/** The form's drafts for a stored room's layouts. */
export function toLayoutDrafts(layouts: readonly RoomBedLayout[] | undefined): LayoutDraft[] {
  return (layouts ?? []).map((layout) => ({
    key: nanoid(),
    name: layout.name ?? '',
    beds: layout.beds.map((bed) => ({
      key: nanoid(),
      kind: bed.kind,
      count: bed.count,
      width: bed.widthCm === undefined ? '' : String(bed.widthCm),
      length: bed.lengthCm === undefined ? '' : String(bed.lengthCm),
    })),
  }));
}

/** A typed size in whole centimetres, undefined when blank, null when invalid. */
function parseSize(value: string, min: number, max: number): number | undefined | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

/**
 * The layouts the drafts describe, and the bed lines whose size is invalid.
 * An invalid size is left out of the layout, so the capacity readout still
 * answers while the organiser fixes it; the submit refuses it.
 */
export function parseLayoutDrafts(drafts: readonly LayoutDraft[]): {
  layouts: RoomBedLayout[];
  invalidBedKeys: Set<string>;
} {
  const invalidBedKeys = new Set<string>();
  const layouts = drafts.map((draft) => {
    const name = draft.name.trim();
    const beds = draft.beds.map((bedDraft): RoomBed => {
      const widthCm = parseSize(bedDraft.width, MIN_BED_WIDTH_CM, MAX_BED_WIDTH_CM);
      const lengthCm = parseSize(bedDraft.length, MIN_BED_LENGTH_CM, MAX_BED_LENGTH_CM);
      if (widthCm === null || lengthCm === null) {
        invalidBedKeys.add(bedDraft.key);
      }
      return {
        kind: bedDraft.kind,
        count: bedDraft.count,
        ...(widthCm == null ? {} : { widthCm }),
        ...(lengthCm == null ? {} : { lengthCm }),
      };
    });
    return name ? { name, beds } : { beds };
  });
  return { layouts, invalidBedKeys };
}
