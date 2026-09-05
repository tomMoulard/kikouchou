/**
 * @fileoverview Renders the two `rooms.beds` call sites through a real i18next.
 *
 * Every other test in this repo runs against the setup-wide `react-i18next`
 * mock, which returns the key verbatim — so a call site naming a key that does
 * not resolve renders "fine" in every one of them and renders the raw key to
 * the user. That is exactly what `RoomOccupancyTimeline` did: it asked for the
 * literal `rooms.beds_plural`, which only worked because the catalogue still
 * carried the dead i18next-v3 suffix.
 *
 * These tests unmock i18next, load the shipped catalogues, and read the strings
 * off the DOM at count 1 and count 4.
 *
 * @module features/rooms/components/__tests__/RoomOccupancyTimeline.i18n.test
 */

import type { ReactElement, ReactNode } from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { enUS } from 'date-fns/locale';
import type { i18n as I18nInstance } from 'i18next';

import enTranslation from '@/locales/en/translation.json';
import frTranslation from '@/locales/fr/translation.json';
import type { ISODateString, Person, Room, RoomAssignment, Transport, Trip } from '@/types';

// The point of this suite is the real resolution path, so both mocks go.
vi.unmock('i18next');
vi.unmock('react-i18next');

// Strip the drag-and-drop and viewport machinery, as the sibling suite does.
vi.mock('@/features/rooms/components/DroppableRoom', () => ({
  DroppableRoom: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/features/rooms/components/DraggableGuest', () => ({
  DraggableGuest: () => null,
}));

vi.mock('@/features/rooms/components/DraggableRoomAssignment', () => ({
  DraggableRoomAssignment: ({ label }: { readonly label: string }) => <span>{label}</span>,
}));

vi.mock('@/features/rooms/components/DroppableAssignment', () => ({
  DroppableAssignment: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/shared/TripTimelineFrame', () => ({
  TripTimelineFrame: ({
    children,
  }: {
    readonly children: (viewport: Record<string, unknown>) => ReactNode;
  }) => (
    <div>
      {children({
        canvasWidth: 800,
        dayGridTemplateColumns: undefined,
        dayWidthPx: 80,
        useFractionalColumns: false,
        todayColumnIndex: -1,
        laneHeightPx: 36,
        labelColumnWidth: 140,
        labelsCollapsed: false,
      })}
    </div>
  ),
}));

// ============================================================================
// Imports after mocks
// ============================================================================

import { I18nextProvider } from 'react-i18next';

import { RoomOccupancyTimeline } from '@/features/rooms/components/RoomOccupancyTimeline';
import { RoomCard } from '@/features/rooms/components/RoomCard';

// ============================================================================
// Fixture
// ============================================================================

const TRIP: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-07-01' as ISODateString,
  endDate: '2026-07-10' as ISODateString,
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function makeRoom(name: string, capacity: number, order: number): Room {
  return {
    id: `room-${order}` as Room['id'],
    tripId: 'trip-1' as Room['tripId'],
    name,
    capacity,
    order,
  };
}

const FOUR_BED = makeRoom('Master Bedroom', 4, 0);
const ONE_BED = makeRoom('Box Room', 1, 1);

let i18n: I18nInstance;

beforeAll(async () => {
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  const { initReactI18next } = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr'],
    resources: {
      en: { translation: enTranslation },
      fr: { translation: frTranslation },
    },
    interpolation: { escapeValue: false },
  });
});

function renderWithI18n(ui: ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

function renderTimeline(rooms: readonly Room[]) {
  return renderWithI18n(
    <RoomOccupancyTimeline
      trip={TRIP}
      rooms={rooms}
      assignments={[] as RoomAssignment[]}
      arrivals={[] as Transport[]}
      departures={[] as Transport[]}
      persons={[] as Person[]}
      dateLocale={enUS}
      range={{ startDate: TRIP.startDate, endDate: TRIP.endDate }}
    />,
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('rooms.beds renders through i18next, not as a raw key', () => {
  it('labels a four-bed room "4 beds" on the timeline', async () => {
    await i18n.changeLanguage('en');
    renderTimeline([FOUR_BED]);

    expect(screen.getByTitle('Master Bedroom — 4 beds')).toBeInTheDocument();
  });

  it('labels a one-bed room "1 bed" on the timeline', async () => {
    await i18n.changeLanguage('en');
    renderTimeline([ONE_BED]);

    expect(screen.getByTitle('Box Room — 1 bed')).toBeInTheDocument();
  });

  it('never leaks a rooms.beds key into the timeline DOM', async () => {
    await i18n.changeLanguage('en');
    const { container } = renderTimeline([FOUR_BED, ONE_BED]);

    expect(container.innerHTML).not.toContain('rooms.beds');
  });

  it('labels the same rooms in French', async () => {
    await i18n.changeLanguage('fr');
    renderTimeline([FOUR_BED, ONE_BED]);

    expect(screen.getByTitle('Master Bedroom — 4 lits')).toBeInTheDocument();
    expect(screen.getByTitle('Box Room — 1 lit')).toBeInTheDocument();
    // No reset here: every test sets its own language before rendering, and
    // switching it while a component is still mounted trips React's act warning.
  });

  it('labels the room card footer with the same wording as the timeline', async () => {
    await i18n.changeLanguage('en');
    renderWithI18n(
      <RoomCard
        room={FOUR_BED}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('4 beds')).toBeInTheDocument();
  });

  it('labels a single-bed room card "1 bed"', async () => {
    await i18n.changeLanguage('en');
    renderWithI18n(
      <RoomCard
        room={ONE_BED}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={1}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('1 bed')).toBeInTheDocument();
  });
});
