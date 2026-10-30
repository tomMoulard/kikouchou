/**
 * Unit tests for the create form's beds / guests / nights arithmetic.
 *
 * The case in the bug report leads: six guests, three rooms of two, three and
 * two beds, dates a week apart, and a form that said none of it.
 *
 * @module features/trips/lib/__tests__/trip-size-summary.test
 */
import { describe, it, expect } from 'vitest';

import { summarizeTripSize } from '@/features/trips/lib/trip-size-summary';

/** Six guest rows, none of them standing for more than one person. */
const SIX_GUESTS = [{}, {}, {}, {}, {}, {}] as const;

describe('summarizeTripSize', () => {
  it('adds the beds, the guests and the nights of the reported trip', () => {
    const summary = summarizeTripSize({
      rooms: [{ capacity: 2 }, { capacity: 3 }, { capacity: 2 }],
      guests: SIX_GUESTS,
      startDate: '2026-07-11',
      endDate: '2026-07-18',
    });

    expect(summary).toEqual({
      beds: 7,
      guests: 6,
      nights: 7,
      bedsShort: false,
    });
  });

  it('counts people rather than rows, so a couple takes two beds', () => {
    // A guest row can stand for a family under one name, which is exactly how
    // four people used to fit in a two-bed room without a word from the form.
    const summary = summarizeTripSize({
      rooms: [{ capacity: 2 }],
      guests: [{ headcount: 2 }, { headcount: 2 }],
      startDate: '',
      endDate: '',
    });

    expect(summary.guests).toBe(4);
    expect(summary.bedsShort).toBe(true);
  });

  it('flags a house one bed short', () => {
    const summary = summarizeTripSize({
      rooms: [{ capacity: 2 }, { capacity: 3 }],
      guests: SIX_GUESTS,
      startDate: '',
      endDate: '',
    });

    expect(summary).toEqual({ beds: 5, guests: 6, nights: null, bedsShort: true });
  });

  it('does not flag a house with beds to spare', () => {
    const summary = summarizeTripSize({
      rooms: [{ capacity: 4 }, { capacity: 4 }],
      guests: SIX_GUESTS,
      startDate: '',
      endDate: '',
    });

    expect(summary.bedsShort).toBe(false);
  });

  it('says nothing about beds before any room is typed in', () => {
    // No rooms yet is the starting state of the form, not a problem with it.
    const summary = summarizeTripSize({
      rooms: [],
      guests: SIX_GUESTS,
      startDate: '',
      endDate: '',
    });

    expect(summary).toEqual({ beds: 0, guests: 6, nights: null, bedsShort: false });
  });

  it('says nothing about beds before any guest is typed in', () => {
    const summary = summarizeTripSize({
      rooms: [{ capacity: 2 }],
      guests: [],
      startDate: '',
      endDate: '',
    });

    expect(summary.bedsShort).toBe(false);
  });

  describe('nights', () => {
    it('is null while either date is missing', () => {
      expect(
        summarizeTripSize({
          rooms: [],
          guests: [],
          startDate: '2026-07-11',
          endDate: '',
        }).nights,
      ).toBeNull();
    });

    it('is null when the end falls before the start', () => {
      // The date fields validate that on blur and submit; until then the line
      // has no honest number to show.
      expect(
        summarizeTripSize({
          rooms: [],
          guests: [],
          startDate: '2026-07-18',
          endDate: '2026-07-11',
        }).nights,
      ).toBeNull();
    });

    it('is zero for a day out, which is a real trip', () => {
      expect(
        summarizeTripSize({
          rooms: [],
          guests: [],
          startDate: '2026-07-11',
          endDate: '2026-07-11',
        }).nights,
      ).toBe(0);
    });

    it('counts one night for consecutive days', () => {
      expect(
        summarizeTripSize({
          rooms: [],
          guests: [],
          startDate: '2026-07-11',
          endDate: '2026-07-12',
        }).nights,
      ).toBe(1);
    });

    it('counts calendar nights across a daylight-saving change', () => {
      // Europe/Paris springs forward on 2026-03-29; the window still holds two
      // nights, not one and a fraction.
      expect(
        summarizeTripSize({
          rooms: [],
          guests: [],
          startDate: '2026-03-28',
          endDate: '2026-03-30',
        }).nights,
      ).toBe(2);
    });
  });
});
