/**
 * AssistantTripView Tests
 *
 * Each view is drawn from the live trip, through the contexts its own page
 * reads, and links to that page. Without a selected trip it says so.
 *
 * @module features/assistant/components/__tests__/AssistantTripView.test
 */

import { describe, expect, it } from 'vitest';

import { createActivity } from '@/lib/db/repositories/activity-repository';
import { updateSettings } from '@/lib/db/repositories/settings-repository';
import { createTransport } from '@/lib/db/repositories/transport-repository';
import {
  createTestPerson,
  createTestRoom,
  createTestTrip,
  render,
  screen,
  waitFor,
  within,
} from '@/test/utils';
import type { ISODateTimeString, TripId } from '@/types';

import { AssistantTripView } from '../AssistantTripView';

// ============================================================================
// Test Helpers
// ============================================================================

/** A selected trip with one guest arriving by train, a room and an outing. */
async function seedSelectedTrip(): Promise<TripId> {
  const tripId = await createTestTrip({
    name: 'Summer house',
    startDate: '2024-07-15',
    endDate: '2024-07-20',
  });
  const aliceId = await createTestPerson(tripId, { name: 'Alice' });
  await createTestRoom(tripId, { name: 'Attic', capacity: 2 });
  await createTransport(tripId, {
    personId: aliceId,
    type: 'arrival',
    datetime: '2024-07-15T15:00:00.000Z' as ISODateTimeString,
    location: 'Lyon Part-Dieu',
    transportMode: 'train',
    needsPickup: true,
  });
  await createActivity(tripId, {
    title: 'Kayak',
    category: 'sport',
    startDatetime: '2024-07-16T09:00:00.000Z' as ISODateTimeString,
    allDay: false,
    participantIds: [],
  });
  await updateSettings({ currentTripId: tripId });
  return tripId;
}

// ============================================================================
// Tests
// ============================================================================

describe('AssistantTripView', () => {
  it('asks for a trip when none is selected, with nowhere to link to', async () => {
    render(<AssistantTripView view="planning" />);

    expect(await screen.findByText('assistant.views.noTrip')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it.each([
    ['planning', 'calendar'],
    ['rooms', 'rooms'],
    ['rides', 'transports'],
    ['activities', 'activities'],
    ['money', 'money'],
  ] as const)('links the %s view to the %s page', async (view, page) => {
    const tripId = await seedSelectedTrip();

    render(<AssistantTripView view={view} />);

    // Queried inside the wait: the providers mount the tree again once the
    // selected trip loads, so a section found earlier is a detached node.
    await waitFor(() => {
      const section = screen.getByRole('region', {
        name: `assistant.views.${view}.title`,
      });
      expect(
        within(section).getByRole('link', { name: /assistant\.views\.open/ }),
      ).toHaveAttribute('href', `/trips/${tripId}/${page}`);
    });
  });

  it('draws the guests on the planning', async () => {
    await seedSelectedTrip();

    render(<AssistantTripView view="planning" />);

    expect(await screen.findByText('Alice')).toBeInTheDocument();
  });

  it('draws the rooms', async () => {
    await seedSelectedTrip();

    render(<AssistantTripView view="rooms" />);

    expect(await screen.findByText('Attic')).toBeInTheDocument();
  });

  it('lists each arrival with who, how and the pickup it still needs', async () => {
    await seedSelectedTrip();

    render(<AssistantTripView view="rides" />);

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/transports\.modes\.train/)).toBeInTheDocument();
    expect(screen.getByText(/Lyon Part-Dieu/)).toBeInTheDocument();
    expect(screen.getByText('transports.needsPickup')).toBeInTheDocument();
    // Arrival or departure is said in words too, not only by the arrow.
    expect(screen.getByText(/transports\.arrival/)).toBeInTheDocument();
  });

  it('says so when nobody comes or goes yet', async () => {
    const tripId = await createTestTrip({ name: 'Empty', startDate: '2024-07-15' });
    await updateSettings({ currentTripId: tripId });

    render(<AssistantTripView view="rides" />);

    expect(
      await screen.findByText('assistant.views.rides.empty'),
    ).toBeInTheDocument();
  });

  it('draws the activities', async () => {
    await seedSelectedTrip();

    render(<AssistantTripView view="activities" />);

    expect(await screen.findByText(/Kayak/)).toBeInTheDocument();
  });

  it('draws the balances once the accounts are read, with no payment button', async () => {
    await seedSelectedTrip();

    render(<AssistantTripView view="money" />);

    await waitFor(() => {
      expect(screen.queryByText('common.loading')).not.toBeInTheDocument();
    });
    const section = screen.getByRole('region', { name: 'assistant.views.money.title' });
    // The only control in a read-only view is the link to the page.
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
  });
});
