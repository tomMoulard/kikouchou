/**
 * @fileoverview Tests for the share dialog's roster, and the hook behind it.
 *
 * Dexie is real (fake-indexeddb), so the names come from the trip's guests the
 * way they do in the app. The server is the mocked `lib/sync/members`.
 *
 * @module features/sharing/components/__tests__/TripMembersPanel.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TripMembersPanel } from '../TripMembersPanel';
import { db } from '@/lib/db/database';
import { listTripMembers, removeTripMember } from '@/lib/sync/members';
import {
  createTestPerson,
  createTestTrip,
  render,
  screen,
  userEvent,
  waitFor,
} from '@/test/utils';
import type { TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const auth = vi.hoisted(() => ({ value: { user: { id: 'owner-1' } as { id: string } | null } }));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth.value }));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/sync/members', () => ({
  listTripMembers: vi.fn(),
  removeTripMember: vi.fn(),
}));

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ notify: notifications }));

const mockedList = vi.mocked(listTripMembers);
const mockedRemove = vi.mocked(removeTripMember);

// ============================================================================
// Fixtures
// ============================================================================

async function sharedTrip(): Promise<{ tripId: TripId; aliceId: string }> {
  const tripId = await createTestTrip({ name: 'Brittany', startDate: '2026-07-15' });
  await db.trips.update(tripId, { remoteTripId: 'remote-1' });
  const aliceId = await createTestPerson(tripId, { name: 'Alice' });
  return { tripId, aliceId: String(aliceId) };
}

function roster(ownerId: string, members: { userId: string; personId: string | null }[]) {
  return {
    status: 'ok' as const,
    ownerId,
    members: members.map((member, index) => ({
      ...member,
      joinedAt: `2026-01-0${index + 1}T00:00:00Z`,
    })),
  };
}

beforeEach(() => {
  auth.value = { user: { id: 'owner-1' } };
  mockedList.mockReset();
  mockedRemove.mockReset();
  notifications.success.mockReset();
  notifications.error.mockReset();
});

// ============================================================================
// Tests
// ============================================================================

describe('TripMembersPanel', () => {
  it('names each account by its guest, and offers the organiser a Remove for the others', async () => {
    const { tripId, aliceId } = await sharedTrip();
    mockedList.mockResolvedValue(
      roster('owner-1', [
        { userId: 'owner-1', personId: null },
        { userId: 'guest-1', personId: aliceId },
        { userId: 'guest-2', personId: null },
      ]),
    );

    render(<TripMembersPanel tripId={tripId} active />, { withProviders: false });

    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('sharing.members.you')).toBeInTheDocument();
    expect(screen.getByText('sharing.members.unnamed')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /sharing.members.remove/ })).toHaveLength(2);
    expect(mockedList).toHaveBeenCalledWith(expect.anything(), 'remote-1');
  });

  it('shows the roster without Remove to a member who is not the organiser', async () => {
    const { tripId, aliceId } = await sharedTrip();
    auth.value = { user: { id: 'guest-1' } };
    mockedList.mockResolvedValue(
      roster('owner-1', [
        { userId: 'owner-1', personId: null },
        { userId: 'guest-1', personId: aliceId },
      ]),
    );

    render(<TripMembersPanel tripId={tripId} active />, { withProviders: false });

    expect(await screen.findByText('sharing.members.organiser')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sharing.members.remove/ })).toBeNull();
    expect(screen.queryByText('sharing.members.removeHint')).toBeNull();
  });

  it('removes a member after the confirmation, and tells the dialog', async () => {
    const { tripId, aliceId } = await sharedTrip();
    mockedList
      .mockResolvedValueOnce(
        roster('owner-1', [
          { userId: 'owner-1', personId: null },
          { userId: 'guest-1', personId: aliceId },
        ]),
      )
      .mockResolvedValue(roster('owner-1', [{ userId: 'owner-1', personId: null }]));
    mockedRemove.mockResolvedValue({ status: 'removed' });
    const onMemberRemoved = vi.fn();

    render(<TripMembersPanel tripId={tripId} active onMemberRemoved={onMemberRemoved} />, {
      withProviders: false,
    });

    await userEvent.click(await screen.findByRole('button', { name: /sharing.members.remove/ }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      Array.from(dialog.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('sharing.members.remove'),
      )!,
    );

    await waitFor(() => expect(onMemberRemoved).toHaveBeenCalled());
    expect(mockedRemove).toHaveBeenCalledWith(expect.anything(), 'remote-1', 'guest-1');
    expect(notifications.success).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByText('Alice')).toBeNull());
  });

  it('explains a refusal and a failure', async () => {
    const { tripId, aliceId } = await sharedTrip();
    mockedList.mockResolvedValue(
      roster('owner-1', [
        { userId: 'owner-1', personId: null },
        { userId: 'guest-1', personId: aliceId },
      ]),
    );
    const onMemberRemoved = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<TripMembersPanel tripId={tripId} active onMemberRemoved={onMemberRemoved} />, {
      withProviders: false,
    });

    const confirm = async () => {
      await userEvent.click(await screen.findByRole('button', { name: /sharing.members.remove/ }));
      const dialog = await screen.findByRole('alertdialog');
      await userEvent.click(
        Array.from(dialog.querySelectorAll('button')).find((button) =>
          button.textContent?.includes('sharing.members.remove'),
        )!,
      );
    };

    mockedRemove.mockResolvedValueOnce({ status: 'not-owner' });
    await confirm();
    await waitFor(() => expect(notifications.error).toHaveBeenCalledTimes(1));

    mockedRemove.mockResolvedValueOnce({ status: 'error', message: 'offline' });
    await confirm();
    await waitFor(() => expect(notifications.error).toHaveBeenCalledTimes(2));
    expect(onMemberRemoved).not.toHaveBeenCalled();
  });

  it('says so when the roster cannot be read', async () => {
    const { tripId } = await sharedTrip();
    mockedList.mockResolvedValue({ status: 'error', message: 'offline' });

    render(<TripMembersPanel tripId={tripId} active />, { withProviders: false });

    expect(await screen.findByRole('alert')).toHaveTextContent('sharing.members.loadFailed');
  });

  it('renders nothing for a trip that is not on the server, or while inactive', async () => {
    const tripId = await createTestTrip({ name: 'Local', startDate: '2026-07-15' });

    const { container, rerender } = render(<TripMembersPanel tripId={tripId} active />, {
      withProviders: false,
    });
    rerender(<TripMembersPanel tripId={tripId} active={false} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('renders nothing when signed out', async () => {
    const { tripId } = await sharedTrip();
    auth.value = { user: null };

    const { container } = render(<TripMembersPanel tripId={tripId} active />, {
      withProviders: false,
    });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(mockedList).not.toHaveBeenCalled();
  });
});
