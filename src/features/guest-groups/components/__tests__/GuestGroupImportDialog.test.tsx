/**
 * @fileoverview Tests for GuestGroupImportDialog — the member selector.
 * @module features/guest-groups/components/__tests__/GuestGroupImportDialog.test
 */

import { describe, expect, it, vi } from 'vitest';

import { hexColor, render, screen, userEvent, waitFor } from '@/test/utils';
import { GuestGroupImportDialog } from '@/features/guest-groups/components/GuestGroupImportDialog';
import { db } from '@/lib/db/database';
import { createGuestGroup } from '@/lib/db/repositories/guest-group-repository';

// ============================================================================
// Fixtures
// ============================================================================

async function seedFamily() {
  return createGuestGroup({
    name: 'Family',
    members: [
      { name: 'Tom + Léa', color: hexColor('#ef4444'), headcount: 2 },
      { name: 'Alice', color: hexColor('#3b82f6') },
      { name: 'Camille', color: hexColor('#22c55e') },
    ],
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('GuestGroupImportDialog', () => {
  it('shows the empty state when the account has no groups', async () => {
    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(await screen.findByText('guestGroups.emptyTitle')).toBeInTheDocument();
  });

  it('opens straight into the only group, with everybody ticked', async () => {
    await seedFamily();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(await screen.findByText('Family')).toBeInTheDocument();

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box).toBeChecked();
    }
  });

  it('imports only the people left ticked', async () => {
    const user = userEvent.setup(),
      onConfirm = vi.fn().mockResolvedValue(undefined),
      group = await seedFamily();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await screen.findByText('Family');

    // Untick Camille — "the girls are coming, grandma is not".
    await user.click(screen.getByLabelText(/Camille/));
    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    expect(onConfirm).toHaveBeenCalledWith([
      {
        group: expect.objectContaining({ id: group.id }),
        memberIds: [group.members[0]!.id, group.members[1]!.id],
      },
    ]);
  });

  it('sends member ids in the group order, not the order they were ticked', async () => {
    const user = userEvent.setup(),
      onConfirm = vi.fn().mockResolvedValue(undefined),
      group = await seedFamily();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await screen.findByText('Family');

    // Clear everything, then tick from the bottom up.
    await user.click(screen.getByRole('button', { name: 'guestGroups.selectNone' }));
    await user.click(screen.getByLabelText(/Camille/));
    await user.click(screen.getByLabelText(/Tom/));
    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    expect(onConfirm.mock.calls[0]?.[0][0].memberIds).toEqual([
      group.members[0]!.id,
      group.members[2]!.id,
    ]);
  });

  it('cannot confirm with nobody selected', async () => {
    const user = userEvent.setup();
    await seedFamily();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');
    await user.click(screen.getByRole('button', { name: 'guestGroups.selectNone' }));

    expect(screen.getByRole('button', { name: /guestGroups.importConfirm/ })).toBeDisabled();
  });

  it('closes once the import resolves', async () => {
    const user = userEvent.setup(),
      onOpenChange = vi.fn();
    await seedFamily();

    render(
      <GuestGroupImportDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByText('Family');
    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('stays open when the import fails, keeping the selection', async () => {
    const user = userEvent.setup(),
      onOpenChange = vi.fn(),
      onConfirm = vi.fn().mockRejectedValue(new Error('nope')),
      // The caller has already told the user; this is the dialog's own record.
      logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await seedFamily();

    render(
      <GuestGroupImportDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} />,
    );

    await screen.findByText('Family');
    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    // A failed import must not close the dialog: re-ticking four people because
    // the write failed once is the worst possible answer.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);

    logged.mockRestore();
  });

  it('keeps the selection when the groups table changes underneath it', async () => {
    const user = userEvent.setup(),
      onConfirm = vi.fn().mockResolvedValue(undefined),
      group = await seedFamily();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await screen.findByText('Family');
    await user.click(screen.getByLabelText(/Camille/));

    // A write to the table re-publishes `groups` with a fresh array identity —
    // which is what sync does when it records `remoteGroupId`, and what another
    // tab does on any edit. Re-running the picker's set-up on that used to
    // re-tick everybody, so the user imported people they had just cleared.
    await db.guestGroups.update(group.id, { remoteGroupId: 'remote-1' });

    await waitFor(async () => {
      expect((await db.guestGroups.get(group.id))?.remoteGroupId).toBe('remote-1');
    });

    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm.mock.calls[0]?.[0][0].memberIds).toEqual([
      group.members[0]!.id,
      group.members[1]!.id,
    ]);
  });

});

// ============================================================================
// Several groups at once
// ============================================================================

describe('GuestGroupImportDialog — more than one group', () => {
  /**
   * Opens every fold.
   *
   * Several groups start folded, so a test that reaches straight for a member
   * checkbox is asserting against a dialog no user ever sees.
   */
  async function expandAll(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    for (const toggle of screen.getAllByRole('button', { expanded: false })) {
      await user.click(toggle);
    }
  }

  /** A second roster, so "two families and a friend" is expressible. */
  async function seedSkiCrew() {
    return createGuestGroup({
      name: 'Ski crew',
      members: [
        { name: 'Bob', color: hexColor('#eab308') },
        { name: 'Dana', color: hexColor('#8b5cf6') },
      ],
    });
  }

  it('lists every group, folded, with nobody on screen yet', async () => {
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(await screen.findByText('Family')).toBeInTheDocument();
    expect(screen.getByText('Ski crew')).toBeInTheDocument();
    // Five people between them, none of them shown: that is the point of the
    // fold. Flat, this dialog was a scroll before the user decided anything.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('shows a group’s people once it is opened, and only that group’s', async () => {
    const user = userEvent.setup();
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await user.click(await screen.findByRole('button', { name: /Family/ }));

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByLabelText(/Alice/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Bob/)).not.toBeInTheDocument();
  });

  it('ticks nobody when there are several groups', async () => {
    const user = userEvent.setup();
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');
    await expandAll(user);

    // Pre-ticking three families so the user can un-tick two is not a default.
    for (const box of screen.getAllByRole('checkbox')) {
      expect(box).not.toBeChecked();
    }
    expect(
      screen.getByRole('button', { name: /guestGroups.importConfirm/ }),
    ).toBeDisabled();
  });

  it('imports people from two groups in one go', async () => {
    const user = userEvent.setup(),
      onConfirm = vi.fn().mockResolvedValue(undefined),
      family = await seedFamily(),
      ski = await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await screen.findByText('Family');
    await expandAll(user);

    await user.click(screen.getByLabelText(/Alice/));
    await user.click(screen.getByLabelText(/Dana/));
    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    const selections = onConfirm.mock.calls[0]?.[0];
    expect(selections).toHaveLength(2);
    expect(selections[0]).toMatchObject({
      group: expect.objectContaining({ id: family.id }),
      memberIds: [family.members[1]!.id],
    });
    expect(selections[1]).toMatchObject({
      group: expect.objectContaining({ id: ski.id }),
      memberIds: [ski.members[1]!.id],
    });
  });

  it('select-all ticks one group without touching the other', async () => {
    const user = userEvent.setup(),
      onConfirm = vi.fn().mockResolvedValue(undefined);
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await screen.findByText('Family');

    // Both sections carry the same button label under the key-echoing harness;
    // the first belongs to Family, which sorts before Ski crew.
    const [selectAllFamily] = screen.getAllByRole('button', {
      name: 'guestGroups.selectAll',
    });
    await user.click(selectAllFamily!);
    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    const selections = onConfirm.mock.calls[0]?.[0];
    expect(selections).toHaveLength(1);
    expect(selections[0].group.name).toBe('Family');
    expect(selections[0].memberIds).toHaveLength(3);
  });

  it('narrows the list to the groups whose name matches', async () => {
    const user = userEvent.setup();
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');
    await user.type(screen.getByLabelText('guestGroups.searchLabel'), 'ski');

    expect(screen.getByText('Ski crew')).toBeInTheDocument();
    expect(screen.queryByText('Family')).not.toBeInTheDocument();
  });

  it('finds a group by the name of somebody in it', async () => {
    const user = userEvent.setup();
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');
    // "Which group is Dana in again?" is the question the search exists for.
    await user.type(screen.getByLabelText('guestGroups.searchLabel'), 'dana');

    expect(screen.getByText('Ski crew')).toBeInTheDocument();
    expect(screen.queryByText('Family')).not.toBeInTheDocument();
    // …and it opens, because a group that matched on a hidden member would be
    // a worse answer than none.
    expect(screen.getByLabelText(/Dana/)).toBeInTheDocument();
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');
    await user.type(screen.getByLabelText('guestGroups.searchLabel'), 'nobody');

    expect(screen.getByText('guestGroups.searchEmpty')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('folds the groups again when the search is cleared', async () => {
    const user = userEvent.setup();
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');
    const search = screen.getByLabelText('guestGroups.searchLabel');

    await user.type(search, 'family');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);

    await user.clear(search);
    // A search that leaves everything hanging open defeats the fold.
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('keeps a tick made during a search after the search is cleared', async () => {
    const user = userEvent.setup(),
      onConfirm = vi.fn().mockResolvedValue(undefined),
      family = await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />,
    );

    await screen.findByText('Family');
    const search = screen.getByLabelText('guestGroups.searchLabel');

    await user.type(search, 'alice');
    await user.click(screen.getByLabelText(/Alice/));
    await user.clear(search);

    // Folding a group away must not un-tick the person inside it.
    await user.click(screen.getByRole('button', { name: /guestGroups.importConfirm/ }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm.mock.calls[0]?.[0][0].memberIds).toEqual([
      family.members[1]!.id,
    ]);
  });

  it('offers no search for a single group', async () => {
    await seedFamily();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');

    // Nothing to narrow, and the group is open already.
    expect(
      screen.queryByLabelText('guestGroups.searchLabel'),
    ).not.toBeInTheDocument();
  });

  it('counts people across groups, not rows', async () => {
    const user = userEvent.setup();
    await seedFamily();
    await seedSkiCrew();

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    await screen.findByText('Family');
    await expandAll(user);

    // Tom + Léa stands for two people, Bob for one.
    await user.click(screen.getByLabelText(/Tom/));
    await user.click(screen.getByLabelText(/Bob/));

    expect(
      screen.getByRole('button', { name: /guestGroups.importConfirm/ }),
    ).toBeEnabled();
  });
});
