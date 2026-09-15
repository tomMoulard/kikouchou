/**
 * @fileoverview Tests for GuestGroupListPage.
 * @module features/guest-groups/pages/__tests__/GuestGroupListPage.test
 */

import { describe, expect, it } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { GuestGroupListPage } from '@/features/guest-groups/pages/GuestGroupListPage';
import {
  createGuestGroup,
  getAllGuestGroups,
} from '@/lib/db/repositories/guest-group-repository';
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
    ],
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('GuestGroupListPage', () => {
  it('shows the empty state before any group exists', async () => {
    render(<GuestGroupListPage />);

    expect(await screen.findByText('guestGroups.emptyTitle')).toBeInTheDocument();
  });

  it('lists a group with its people', async () => {
    await seedFamily();

    render(<GuestGroupListPage />);

    expect(await screen.findByText('Family')).toBeInTheDocument();
    expect(screen.getByText('Tom + Léa')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('marks a member standing for several people', async () => {
    await seedFamily();

    render(<GuestGroupListPage />);

    await screen.findByText('Family');
    expect(screen.getByText('×2')).toBeInTheDocument();
  });

  it('opens the create dialog from the empty state', async () => {
    const user = userEvent.setup();
    render(<GuestGroupListPage />);

    await user.click(await screen.findByRole('button', { name: 'guestGroups.new' }));

    expect(await screen.findByLabelText(/guestGroups.name/)).toBeInTheDocument();
  });

  it('creates a group end to end', async () => {
    const user = userEvent.setup();
    render(<GuestGroupListPage />);

    await user.click(await screen.findByRole('button', { name: 'guestGroups.new' }));
    await user.type(await screen.findByLabelText(/guestGroups.name/), 'Ski crew');
    await user.click(screen.getByRole('button', { name: 'guestGroups.addMember' }));
    await user.type(
      screen.getByPlaceholderText('guestGroups.memberNamePlaceholder'),
      'Bob',
    );
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(async () => {
      const stored = await getAllGuestGroups();
      expect(stored).toHaveLength(1);
    });

    const [stored] = await getAllGuestGroups();
    expect(stored?.name).toBe('Ski crew');
    expect(stored?.members.map((member) => member.name)).toEqual(['Bob']);
  });

  it('deletes a group once the confirmation is accepted', async () => {
    const user = userEvent.setup();
    await seedFamily();

    render(<GuestGroupListPage />);

    await user.click(
      await screen.findByRole('button', { name: 'guestGroups.deleteNamed' }),
    );
    await user.click(await screen.findByRole('button', { name: 'common.delete' }));

    await waitFor(async () => {
      expect(await getAllGuestGroups()).toHaveLength(0);
    });
  });

  it('keeps the group when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    await seedFamily();

    render(<GuestGroupListPage />);

    await user.click(
      await screen.findByRole('button', { name: 'guestGroups.deleteNamed' }),
    );
    await user.click(await screen.findByRole('button', { name: 'common.cancel' }));

    expect(await getAllGuestGroups()).toHaveLength(1);
  });

  it('edits a group through the dialog', async () => {
    const user = userEvent.setup();
    await seedFamily();

    render(<GuestGroupListPage />);

    await user.click(await screen.findByRole('button', { name: 'guestGroups.editNamed' }));

    const nameField = await screen.findByDisplayValue('Family');
    await user.clear(nameField);
    await user.type(nameField, 'The Family');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(async () => {
      const [stored] = await getAllGuestGroups();
      expect(stored?.name).toBe('The Family');
    });
  });
});
