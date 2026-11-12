import { describe, expect, it } from 'vitest';

import {
  buildBulkRoomNames,
  buildDuplicateRoomName,
  compareRoomsByName,
  roomNameStem,
} from '../room-naming';

describe('roomNameStem', () => {
  it('drops a trailing number', () => {
    expect(roomNameStem('Double bed 3')).toBe('Double bed');
  });

  it('keeps a name that ends in a word', () => {
    expect(roomNameStem('Double bed')).toBe('Double bed');
  });

  it('keeps a number that is the whole name', () => {
    expect(roomNameStem('12')).toBe('12');
  });

  it('drops only the last number', () => {
    expect(roomNameStem('Room 2 bis 4')).toBe('Room 2 bis');
  });
});

describe('buildBulkRoomNames', () => {
  it('leaves a single room named exactly as typed', () => {
    expect(buildBulkRoomNames('Double bed', 1, [])).toEqual(['Double bed']);
  });

  it('numbers every room when several are asked for', () => {
    expect(buildBulkRoomNames('Double bed', 3, [])).toEqual([
      'Double bed 1',
      'Double bed 2',
      'Double bed 3',
    ]);
  });

  it('skips numbers the trip already uses', () => {
    expect(
      buildBulkRoomNames('Double bed', 2, ['Double bed 1', 'Double bed 3']),
    ).toEqual(['Double bed 2', 'Double bed 4']);
  });

  it('numbers from the stem when the typed name already carries one', () => {
    expect(buildBulkRoomNames('Double bed 1', 2, ['Double bed 1'])).toEqual([
      'Double bed 2',
      'Double bed 3',
    ]);
  });

  it('trims the typed name', () => {
    expect(buildBulkRoomNames('  Attic  ', 2, [])).toEqual([
      'Attic 1',
      'Attic 2',
    ]);
  });

  it('keeps every name inside the stored length', () => {
    const long = 'a'.repeat(100),
     names = buildBulkRoomNames(long, 2, []);

    expect(names).toHaveLength(2);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(100);
    }
    expect(new Set(names).size).toBe(2);
  });

  it('returns nothing for a count below one', () => {
    expect(buildBulkRoomNames('Double bed', 0, [])).toEqual([]);
  });
});

describe('buildDuplicateRoomName', () => {
  it('numbers the copy after the original', () => {
    expect(buildDuplicateRoomName('Double bed', ['Double bed'])).toBe(
      'Double bed 2',
    );
  });

  it('continues the series when the original is numbered', () => {
    expect(
      buildDuplicateRoomName('Double bed 1', ['Double bed 1', 'Double bed 2']),
    ).toBe('Double bed 3');
  });

  it('never reuses a name the trip already holds', () => {
    expect(
      buildDuplicateRoomName('Attic', ['Attic', 'Attic 2', 'Attic 3']),
    ).toBe('Attic 4');
  });

  it('keeps the copy inside the stored length', () => {
    const name = buildDuplicateRoomName('a'.repeat(100), ['a'.repeat(100)]);

    expect(name.length).toBeLessThanOrEqual(100);
    expect(name).not.toBe('a'.repeat(100));
  });
});

describe('room names at the edges', () => {
  it('reads the stem of a name typed with spaces around it', () => {
    expect(roomNameStem('  Double bed 3 ')).toBe('Double bed');
  });

  it('trims a single room’s name too', () => {
    expect(buildBulkRoomNames('  Attic ', 1, [])).toEqual(['Attic']);
  });

  it('drops the space a shortened name would end on before its number', () => {
    const name = `${'a'.repeat(97)} b`;

    expect(buildBulkRoomNames(name, 2, [])[0]).toBe(`${'a'.repeat(97)} 1`);
  });
});

describe('room names when every number is taken', () => {
  // MAX_SUFFIX is documented as where the search gives up and reuses a name,
  // so a loop over input it did not choose still ends. This pins that bound.
  it('falls back on the first number once all ten thousand are in use', () => {
    const taken = Array.from({ length: 10_000 }, (_, index) => `Bunk ${index + 1}`);

    expect(buildBulkRoomNames('Bunk', 2, taken)[0]).toBe('Bunk 1');
  });
});

describe('compareRoomsByName', () => {
  const room = (name: string, order = 0, id = name) => ({ id, name, order });

  it('puts numbers in numeric order, not character order', () => {
    const names = ['Room 10', 'Room 2', 'Room 1']
      .map((name) => room(name))
      .sort(compareRoomsByName('en'))
      .map((r) => r.name);

    expect(names).toEqual(['Room 1', 'Room 2', 'Room 10']);
  });

  it('ignores case and accents', () => {
    const names = [room('salon'), room('Étage'), room('Attic'), room('cave')]
      .sort(compareRoomsByName('fr'))
      .map((r) => r.name);

    expect(names).toEqual(['Attic', 'cave', 'Étage', 'salon']);
  });

  it('falls back on the stored order, then the id, for the same name', () => {
    const ids = [room('Bunk', 2, 'c'), room('Bunk', 1, 'b'), room('bunk', 1, 'a')]
      .sort(compareRoomsByName('en'))
      .map((r) => r.id);

    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('accepts a language tag Intl does not know', () => {
    expect(() => compareRoomsByName('not a tag')).not.toThrow();
  });
});
