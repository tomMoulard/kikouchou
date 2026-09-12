/**
 * @fileoverview Tests for SaveGuestsAsGroupDialog.
 * @module features/guest-groups/components/__tests__/SaveGuestsAsGroupDialog.test
 */

import { describe, expect, it, vi } from 'vitest';

import { hexColor, isoDate, render, screen, userEvent, waitFor } from '@/test/utils';
import { SaveGuestsAsGroupDialog } from '@/features/guest-groups/components/SaveGuestsAsGroupDialog';
import { getAllGuestGroups } from '@/lib/db/repositories/guest-group-repository';
import type { Person, PersonId, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const couple: Person = {
  id: 'person-1' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Tom + Léa',
  color: hexColor('#ef4444'),
  headcount: 2,
  stayStartDate: isoDate('2026-07-02'),
  stayEndDate: isoDate('2026-07-08'),
};

const alice: Person = {
  id: 'person-2' as PersonId,
  tripId: 'trip-1' as TripId,
  name: 'Alice',
  color: hexColor('#3b82f6'),
  notes: 'Vegetarian',
};

const guests = [couple, alice];

// ============================================================================
// Tests
// ============================================================================

describe('SaveGuestsAsGroupDialog', () => {
  it('pre-fills the name and ticks every guest', async () => {
    render(
      <SaveGuestsAsGroupDialog
        persons={guests}
        defaultName="Brittany"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Brittany')).toBeInTheDocument();
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).toBeChecked();
    }
  });

  it('captures name, colour, headcount and notes — and nothing trip-specific', async () => {
    const user = userEvent.setup();

    render(
      <SaveGuestsAsGroupDialog
        persons={guests}
        defaultName="Family"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(async () => {
      expect(await getAllGuestGroups()).toHaveLength(1);
    });

    const [group] = await getAllGuestGroups(),
      storedCouple = group?.members.find((member) => member.name === 'Tom + Léa'),
      storedAlice = group?.members.find((member) => member.name === 'Alice');

    expect(group?.name).toBe('Family');
    expect(storedCouple?.headcount).toBe(2);
    expect(storedCouple?.color).toBe('#ef4444');
    expect(storedAlice?.notes).toBe('Vegetarian');
    // Stay dates belong to the trip, not the person.
    expect(storedCouple).not.toHaveProperty('stayStartDate');
  });

  it('saves only the guests left ticked', async () => {
    const user = userEvent.setup();

    render(
      <SaveGuestsAsGroupDialog
        persons={guests}
        defaultName="Family"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Alice/));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(async () => {
      expect(await getAllGuestGroups()).toHaveLength(1);
    });

    const [group] = await getAllGuestGroups();
    expect(group?.members.map((member) => member.name)).toEqual(['Tom + Léa']);
  });

  it('refuses an unnamed group', async () => {
    const user = userEvent.setup();

    render(
      <SaveGuestsAsGroupDialog persons={guests} open onOpenChange={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByText('common.required')).toBeInTheDocument();
    expect(await getAllGuestGroups()).toHaveLength(0);
  });

  it('cannot save with nobody ticked', async () => {
    const user = userEvent.setup();

    render(
      <SaveGuestsAsGroupDialog
        persons={guests}
        defaultName="Family"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Alice/));
    await user.click(screen.getByLabelText(/Tom/));

    expect(screen.getByRole('button', { name: 'common.save' })).toBeDisabled();
  });

  it('keeps the selection when the guest list re-publishes', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <SaveGuestsAsGroupDialog
        persons={guests}
        defaultName="Family"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await user.click(screen.getByLabelText(/Alice/));

    // The guest list publishes a fresh array whenever anything about the trip's
    // guests changes — a co-traveller's edit arriving over sync, say. Resetting
    // on that used to re-tick a guest the user had just cleared.
    rerender(
      <SaveGuestsAsGroupDialog
        persons={[...guests]}
        defaultName="Family"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/Alice/)).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(async () => {
      expect(await getAllGuestGroups()).toHaveLength(1);
    });

    const [group] = await getAllGuestGroups();
    expect(group?.members.map((member) => member.name)).toEqual(['Tom + Léa']);
  });

  it('closes once the group is stored', async () => {
    const user = userEvent.setup(),
      onOpenChange = vi.fn();

    render(
      <SaveGuestsAsGroupDialog
        persons={guests}
        defaultName="Family"
        open
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
