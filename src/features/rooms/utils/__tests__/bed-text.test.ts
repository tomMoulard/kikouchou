/**
 * @module features/rooms/utils/__tests__/bed-text.test
 */
import { describe, expect, it } from 'vitest';

import { formatBedsText, parseBedsText } from '@/features/rooms/utils/bed-text';
import type { RoomBedLayout } from '@/types';

const TWIN_OR_TOGETHER: RoomBedLayout[] = [
  { name: 'Twin', beds: [{ kind: 'single', count: 2, widthCm: 80, lengthCm: 200 }] },
  { name: 'Together', beds: [{ kind: 'queen', count: 1 }] },
];

describe('formatBedsText', () => {
  it('writes each layout with its name, split by |', () => {
    expect(formatBedsText(TWIN_OR_TOGETHER)).toBe('Twin: 2 single 80x200 | Together: 1 queen');
  });

  it('writes nothing for a room without beds', () => {
    expect(formatBedsText(undefined)).toBe('');
    expect(formatBedsText([])).toBe('');
  });
});

describe('parseBedsText', () => {
  it('reads back what it writes', () => {
    expect(parseBedsText(formatBedsText(TWIN_OR_TOGETHER))).toEqual(TWIN_OR_TOGETHER);
  });

  it('reads several lines, the words a model uses, and a count spelled out', () => {
    expect(parseBedsText('two twin beds 90x190, 1 crib | one sofa bed')).toEqual([
      {
        beds: [
          { kind: 'single', count: 2, widthCm: 90, lengthCm: 190 },
          { kind: 'cot', count: 1 },
        ],
      },
      { beds: [{ kind: 'sofa-bed', count: 1 }] },
    ]);
  });

  it('does not read the size as the count', () => {
    expect(parseBedsText('queen 160x200')).toEqual([
      { beds: [{ kind: 'queen', count: 1, widthCm: 160, lengthCm: 200 }] },
    ]);
  });

  it('drops a size out of bounds and keeps the bed', () => {
    expect(parseBedsText('1 king 2000x2000')).toEqual([{ beds: [{ kind: 'king', count: 1 }] }]);
  });

  it('answers no beds for "none" or an empty line', () => {
    expect(parseBedsText('none')).toEqual([]);
    expect(parseBedsText('  ')).toEqual([]);
  });

  it('refuses the whole text when a line names no known bed', () => {
    expect(parseBedsText('2 single, 1 waterbed')).toBeNull();
    expect(parseBedsText('Twin: | 1 queen')).toBeNull();
  });
});
