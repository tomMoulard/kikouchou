/**
 * @fileoverview A room's beds as one line of plain text, both ways.
 *
 * The assistant reads a room's beds in its prompt and writes them back in an
 * action, and its action fields are strings and numbers only. So the beds
 * travel as one line the model can read and copy:
 *
 * ```text
 * Twin: 2 single 80x200 | Together: 1 queen
 * ```
 *
 * Layouts are split by `|`, an optional name ends with `:`, lines are split by
 * `,`, and each line is a count, a kind and an optional size in centimetres.
 * The text is not translated: it is for the model, which reads English, and
 * the kinds are the stored values.
 *
 * @module features/rooms/utils/bed-text
 */

import {
  BED_KINDS,
  MAX_BED_COUNT,
  MAX_BED_LENGTH_CM,
  MAX_BED_WIDTH_CM,
  MAX_BEDS_PER_LAYOUT,
  MAX_ROOM_BED_LAYOUTS,
  MIN_BED_LENGTH_CM,
  MIN_BED_WIDTH_CM,
} from '@/types';
import type { BedKind, RoomBed, RoomBedLayout } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Words a model or a person uses for each kind, longest first so "sofa bed"
 * wins over "bed" and "bunk bed" over "bunk".
 */
const KIND_ALIASES: readonly (readonly [string, BedKind])[] = [
  ['sofa-bed', 'sofa-bed'],
  ['sofa bed', 'sofa-bed'],
  ['sofabed', 'sofa-bed'],
  ['bunk bed', 'bunk'],
  ['bunk', 'bunk'],
  ['single', 'single'],
  ['twin', 'single'],
  ['double', 'double'],
  ['queen', 'queen'],
  ['king', 'king'],
  ['cot', 'cot'],
  ['crib', 'cot'],
];

/** Counts a model spells out instead of writing the digit. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Words that mean "no beds": the room goes back to a plain number. */
const CLEAR_WORDS = new Set(['', 'none', 'no beds']);

// ============================================================================
// Format
// ============================================================================

/** One line: "2 single 80x200", the size only when it was typed. */
function formatBedText(bed: RoomBed): string {
  const size =
    bed.widthCm !== undefined && bed.lengthCm !== undefined
      ? ` ${bed.widthCm}x${bed.lengthCm}`
      : '';
  return `${bed.count} ${bed.kind}${size}`;
}

/**
 * A room's beds as one line, or an empty string when it describes none.
 *
 * @example formatBedsText([{ name: 'Twin', beds: [{ kind: 'single', count: 2 }] }])
 * // 'Twin: 2 single'
 */
export function formatBedsText(layouts: readonly RoomBedLayout[] | undefined): string {
  return (layouts ?? [])
    .map((layout) => {
      const beds = layout.beds.map(formatBedText).join(', ');
      return layout.name ? `${layout.name}: ${beds}` : beds;
    })
    .join(' | ');
}

// ============================================================================
// Parse
// ============================================================================

/** The bed kind a line names, or undefined. */
function findKind(text: string): BedKind | undefined {
  for (const [alias, kind] of KIND_ALIASES) {
    if (text.includes(alias)) {
      return kind;
    }
  }
  return undefined;
}

/** One line of text as a bed, or null when it names no known kind. */
function parseBedLine(line: string): RoomBed | null {
  const text = line.trim().toLowerCase();
  const kind = findKind(text);
  if (kind === undefined || !BED_KINDS.includes(kind)) {
    return null;
  }

  const bed: RoomBed = { kind, count: 1 };

  // The size first, so its digits are not read as the count.
  const sizeMatch = /(\d+)\s*[x×]\s*(\d+)/.exec(text);
  let rest = text;
  if (sizeMatch) {
    const width = Number(sizeMatch[1]);
    const length = Number(sizeMatch[2]);
    if (
      width >= MIN_BED_WIDTH_CM && width <= MAX_BED_WIDTH_CM &&
      length >= MIN_BED_LENGTH_CM && length <= MAX_BED_LENGTH_CM
    ) {
      bed.widthCm = width;
      bed.lengthCm = length;
    }
    rest = text.replace(sizeMatch[0], ' ');
  }

  const countMatch = /(?:^|\s)(\d+)\s*(?:x|×)?(?:\s|$)/.exec(rest);
  const wordCount = /(?:^|\s)([a-z]+)\s/.exec(rest)?.[1];
  const count = countMatch
    ? Number(countMatch[1])
    : wordCount === undefined
      ? undefined
      : NUMBER_WORDS[wordCount];
  if (count !== undefined) {
    bed.count = Math.min(Math.max(count, 1), MAX_BED_COUNT);
  }
  return bed;
}

/**
 * Reads a room's beds out of one line of text.
 *
 * @param text - The line, as {@link formatBedsText} writes it
 * @returns The layouts, `[]` when the text says there are no beds, or null
 *   when a line names no known bed: an action that half-applies a list of beds
 *   would store a room nobody described.
 */
export function parseBedsText(text: string): RoomBedLayout[] | null {
  if (CLEAR_WORDS.has(text.trim().toLowerCase())) {
    return [];
  }

  const layouts: RoomBedLayout[] = [];
  for (const segment of text.split('|').slice(0, MAX_ROOM_BED_LAYOUTS)) {
    const colon = segment.indexOf(':');
    const name = colon === -1 ? '' : segment.slice(0, colon).trim();
    const body = colon === -1 ? segment : segment.slice(colon + 1);

    const beds: RoomBed[] = [];
    for (const line of body.split(',').slice(0, MAX_BEDS_PER_LAYOUT)) {
      if (line.trim() === '') {
        continue;
      }
      const bed = parseBedLine(line);
      if (bed === null) {
        return null;
      }
      beds.push(bed);
    }
    if (beds.length === 0) {
      return null;
    }
    layouts.push(name ? { name, beds } : { beds });
  }
  return layouts;
}
