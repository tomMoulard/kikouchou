/**
 * @fileoverview A timeline row read through the real French bundle.
 *
 * The sibling test mocks `t` to return each inline English default, which
 * cannot tell one key from another. Every name here is the French one, which
 * only the right key produces.
 *
 * @module features/calendar/components/__tests__/CalendarTimelineRow.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { fr } from 'date-fns/locale';

import type { TripTimelineViewportContext } from '@/components/shared/TripTimelineFrame';
import {
  TimelineScrollContext,
  type TimelineScrollApi,
} from '@/components/shared/timeline-scroll-context';
import type { ResolvedRide } from '@/features/transports/utils/ride-model';
import { renderWithRealI18n } from '@/test/utils';
import { columnsFromDays } from '@/lib/utils/timeline-scale';
import { toDayKeys } from '@/lib/utils/trip-days';
import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  RoomAssignmentId,
  RoomId,
  TransportId,
  TripId,
} from '@/types';

import { CalendarTimelineRow } from '../CalendarTimelineRow';
import type {
  CalendarTimelineRowModel,
  CalendarTransport,
  TimelineItemWithLane,
} from '../../types';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Helpers
// ============================================================================

const days = Array.from({ length: 6 }, (_, index) => new Date(2026, 0, 5 + index));
const columns = columnsFromDays(days, toDayKeys(days), fr);

const viewport: TripTimelineViewportContext = {
  canvasWidth: 600,
  dayCount: 6,
  cellWidthPx: 100,
  dayWidthPx: 100,
  useFractionalColumns: false,
  labelColumnWidth: 140,
  labelsCollapsed: false,
  laneHeightPx: 32,
  todayColumnIndex: undefined,
  dayGridTemplateColumns: undefined,
  columns,
};

function makePerson(name: string, headcount?: number): Person {
  return {
    id: 'p1' as PersonId,
    tripId: 'trip-1' as TripId,
    name,
    color: '#1d4ed8' as HexColor,
    ...(headcount === undefined ? {} : { headcount }),
  };
}

const leg = {
  id: 'leg-1' as TransportId,
  tripId: 'trip-1' as TripId,
  personId: 'p1' as PersonId,
  type: 'arrival' as const,
  // Offset-less, so the printed clock is the same on every runner.
  datetime: '2026-01-06T09:00:00',
  location: 'Gare',
  needsPickup: false,
};

const stay: TimelineItemWithLane = {
  kind: 'assignment',
  id: 'a1',
  startIndex: 1,
  endIndex: 2,
  assignment: {
    id: 'a1' as RoomAssignmentId,
    tripId: 'trip-1' as TripId,
    roomId: 'r1' as RoomId,
    personId: 'p1' as PersonId,
    startDate: '2026-01-06' as ISODateString,
    endDate: '2026-01-08' as ISODateString,
  },
  person: makePerson('Alice'),
  room: undefined,
  label: 'Chambre bleue',
  color: '#1d4ed8' as HexColor,
  textColor: 'white',
  laneIndex: 0,
  timelineTransports: [{ transport: leg, dayIndex: 1 }],
};

const ownLeg: TimelineItemWithLane = {
  kind: 'transport',
  id: 'leg-2',
  startIndex: 4,
  endIndex: 4,
  transport: { ...leg, id: 'leg-2' as TransportId },
  person: undefined,
  label: 'Gare',
  laneIndex: 0,
};

const scrollApi: TimelineScrollApi = {
  subscribeVisibleRange: (listener) => {
    listener({ start: 0, end: 600 });
    return () => undefined;
  },
  scrollCanvasPositionIntoView: vi.fn(),
};

async function renderInFrench(
  model: Partial<CalendarTimelineRowModel>,
  extra: {
    readonly rideForTransport?: (id: TransportId) => ResolvedRide | undefined;
    readonly onTransportClick?: (transport: CalendarTransport) => void;
  } = {},
): Promise<void> {
  await renderWithRealI18n(
    <TimelineScrollContext.Provider value={scrollApi}>
      <CalendarTimelineRow
        model={{
          person: makePerson('Alice'),
          laneCount: 1,
          items: [],
          staySpan: undefined,
          checkoutDayIndex: undefined,
          ...model,
        }}
        viewport={viewport}
        dateLocale={fr}
        onAssignmentClick={vi.fn()}
        {...extra}
      />
    </TimelineScrollContext.Provider>,
    { language: 'fr', withProviders: false },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarTimelineRow in French', () => {
  it('names the row, the stay, its days and the car on its leg', async () => {
    const ride = { isLegacy: false, driver: makePerson('Bruno') } as unknown as ResolvedRide;
    await renderInFrench({ items: [stay] }, { rideForTransport: () => ride });

    expect(screen.getByRole('group', { name: 'Chronologie de Alice' })).toBeInTheDocument();
    const pill = screen.getByRole('button', { name: /^Chambre bleue\. Séjour/ });
    // "janv." already ends the sentence: the legs follow it without a second period.
    expect(pill.getAttribute('title')).toMatch(/^Chambre bleue, 6 janv\. \S 8 janv\. ↓ 09:00/u);
    expect(pill).toHaveAccessibleName(
      /^Chambre bleue\. Séjour 6 janv\. \S 8 janv\. ↓ 09:00 · Gare · Trajet partagé, Bruno au volant$/u,
    );
    expect(screen.getByTitle('Gare · Trajet partagé, Bruno au volant')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-offscreen-left')).toHaveAttribute(
      'title',
      'Alice est réservé plus tôt. Revenir en arrière',
    );
    expect(screen.getByTestId('timeline-offscreen-right')).toHaveAttribute(
      'title',
      'Alice est réservé plus tard. Avancer',
    );
  });

  it('ends a stay with no legs on a single period', async () => {
    await renderInFrench({ items: [{ ...stay, timelineTransports: undefined } as TimelineItemWithLane] });

    expect(screen.getByRole('button')).toHaveAccessibleName(
      /^Chambre bleue\. Séjour 6 janv\. \S 8 janv\.$/u,
    );
  });

  it('names a car nobody drives yet, and a leg with no guest', async () => {
    const ride = { isLegacy: false } as unknown as ResolvedRide;
    const onTransportClick = vi.fn();
    await renderInFrench({ items: [ownLeg] }, { rideForTransport: () => ride, onTransportClick });

    const pill = screen.getByRole('button', { name: /Gare/ });
    expect(pill).toHaveAttribute('title', '09:00 · Gare · Trajet partagé');

    fireEvent.click(pill);
    expect(onTransportClick).toHaveBeenCalledWith(
      expect.objectContaining({ personName: 'Inconnu' }),
    );
  });

  it('says how many people a guest entry counts for, and names a nameless guest', async () => {
    await renderInFrench({ person: { ...makePerson('', 3) } });

    expect(screen.getByTitle('Compte pour 3 personnes')).toHaveTextContent('×3');
    expect(screen.getByRole('group', { name: 'Chronologie de Inconnu' })).toBeInTheDocument();
  });
});
