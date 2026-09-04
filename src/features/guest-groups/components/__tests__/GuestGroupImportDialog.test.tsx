/**
 * @fileoverview Tests for GuestGroupImportDialog — the member selector.
 * @module features/guest-groups/components/__tests__/GuestGroupImportDialog.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { GuestGroupImportDialog } from '@/features/guest-groups/components/GuestGroupImportDialog';
import { createGuestGroup } from '@/lib/db/repositories/guest-group-repository';
import { hexColor } from '@/test/utils';

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

    expect(onConfirm).toHaveBeenCalledWith({
      group: expect.objectContaining({ id: group.id }),
      memberIds: [group.members[0]!.id, group.members[1]!.id],
    });
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

    expect(onConfirm.mock.calls[0]?.[0].memberIds).toEqual([
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

  it('offers a choice when there are several groups', async () => {
    await seedFamily();
    await createGuestGroup({
      name: 'Ski crew',
      members: [{ name: 'Bob', color: hexColor('#eab308') }],
    });

    render(
      <GuestGroupImportDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />,
    );

    expect(await screen.findByRole('button', { name: /Family/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ski crew/ })).toBeInTheDocument();
    // Nothing is picked yet, so there is nothing to confirm.
    expect(
      screen.queryByRole('button', { name: /guestGroups.importConfirm/ }),
    ).not.toBeInTheDocument();
  });
});
