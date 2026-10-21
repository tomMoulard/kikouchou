/**
 * @fileoverview A month cell read through the real French bundle.
 *
 * The suite-wide mock returns each key as it is and drops the count, so it
 * cannot tell whether the cell hands i18next the number a plural needs. The
 * French bundle can: "2 personnes sur place" only comes out with the count.
 *
 * @module features/calendar/components/__tests__/CalendarDay.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { fr } from 'date-fns/locale';

import { renderWithRealI18n } from '@/test/utils';
import type {
  HexColor,
  ISODateString,
  ISODateTimeString,
  PersonId,
  TransportId,
  TripId,
} from '@/types';

import { CalendarDay } from '../CalendarDay';
import type { CalendarTransport } from '../../types';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Helpers
// ============================================================================

function makeTransport(id: string): CalendarTransport {
  return {
    transport: {
      id: id as TransportId,
      tripId: 'trip-1' as TripId,
      personId: 'person-1' as PersonId,
      type: 'arrival',
      datetime: '2026-07-15T14:30:00' as ISODateTimeString,
      location: 'Gare',
      needsPickup: false,
    },
    person: undefined,
    personName: 'Alice',
    color: '#3b82f6' as HexColor,
  };
}

async function renderDay(overrides: Partial<Parameters<typeof CalendarDay>[0]> = {}) {
  return renderWithRealI18n(
    <CalendarDay
      dateKey={'2026-07-15' as ISODateString}
      date={new Date(2026, 6, 15)}
      events={[]}
      transports={[]}
      activities={[]}
      isCurrentMonth
      isToday={false}
      isWithinTrip
      dateLocale={fr}
      onEventClick={vi.fn()}
      {...overrides}
    />,
    { language: 'fr', withProviders: false },
  );
}

function summaryText(): string | null {
  const id = screen.getByRole('gridcell').getAttribute('aria-describedby');
  return id === null ? null : (document.getElementById(id)?.textContent ?? null);
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarDay in French', () => {
  it('names the cell after its date in French', async () => {
    await renderDay();

    expect(screen.getByRole('gridcell')).toHaveAttribute('aria-label', 'mercredi 15 juillet 2026');
  });

  it('counts the people on site and what does not fit', async () => {
    await renderDay({
      isToday: true,
      headcount: { guests: 1, people: 2 },
      transports: [makeTransport('t1'), makeTransport('t2'), makeTransport('t3'), makeTransport('t4')],
    });

    expect(summaryText()).toBe(
      "Aujourd'hui. 2 personnes sur place. 2 autres éléments dans cette journée",
    );
    expect(screen.getByTestId('day-headcount-2026-07-15')).toHaveAttribute(
      'title',
      '2 personnes sur place',
    );
    expect(screen.getByText('+2')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('2 autres éléments dans cette journée')).toHaveClass('sr-only');
  });

  it('says a day is outside the month, or outside the trip', async () => {
    const { unmount } = await renderDay({ isCurrentMonth: false });
    expect(summaryText()).toBe('Hors du mois en cours');
    unmount();

    await renderDay({ isWithinTrip: false });
    expect(summaryText()).toBe('Hors des dates du voyage');
  });
});
