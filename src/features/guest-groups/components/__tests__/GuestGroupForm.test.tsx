/**
 * @fileoverview Tests for GuestGroupForm.
 * @module features/guest-groups/components/__tests__/GuestGroupForm.test
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen, userEvent, waitFor } from '@/test/utils';
import { GuestGroupForm } from '@/features/guest-groups/components/GuestGroupForm';
import type { GuestGroup, GuestGroupId, GuestGroupMemberId, HexColor } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const familyGroup: GuestGroup = {
  id: 'group-1' as GuestGroupId,
  name: 'Family',
  members: [
    {
      id: 'member-1' as GuestGroupMemberId,
      name: 'Tom + Léa',
      color: '#ef4444' as HexColor,
      headcount: 2,
    },
    { id: 'member-2' as GuestGroupMemberId, name: 'Alice', color: '#3b82f6' as HexColor },
  ],
  createdAt: 1_000,
  updatedAt: 1_000,
};

// ============================================================================
// Tests
// ============================================================================

describe('GuestGroupForm', () => {
  it('shows the existing members in edit mode', () => {
    render(
      <GuestGroupForm group={familyGroup} onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(screen.getByDisplayValue('Family')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tom + Léa')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Alice')).toBeInTheDocument();
  });

  it('starts empty in create mode', () => {
    render(<GuestGroupForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText('guestGroups.membersEmpty')).toBeInTheDocument();
  });

  it('adds a member row', async () => {
    const user = userEvent.setup();
    render(<GuestGroupForm onSubmit={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'guestGroups.addMember' }));

    expect(
      screen.getByPlaceholderText('guestGroups.memberNamePlaceholder'),
    ).toBeInTheDocument();
  });

  it('gives a new row a colour picked at random, as the guest form does', async () => {
    const user = userEvent.setup(),
      colors = new Set<string>();

    // Ten fresh forms, one row each: with the palette untouched, a random pick
    // lands on several different swatches. The first implementation took the
    // first unused one, so every group ever created started red — which is what
    // this asserts is no longer true.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const onSubmit = vi.fn().mockResolvedValue(undefined),
        view = render(<GuestGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />);

      await user.click(screen.getByRole('button', { name: 'guestGroups.addMember' }));
      await user.type(
        screen.getByPlaceholderText('guestGroups.memberNamePlaceholder'),
        'Alice',
      );
      await user.type(screen.getByLabelText(/guestGroups.name/), 'Group');
      await user.click(screen.getByRole('button', { name: 'common.save' }));

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      colors.add(onSubmit.mock.calls[0]?.[0].members[0].color);

      view.unmount();
    }

    expect(colors.size).toBeGreaterThan(1);
  });

  it('does not repeat a colour already used by another row', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<GuestGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/guestGroups.name/), 'Family');
    for (const name of ['Alice', 'Bob', 'Camille']) {
      await user.click(screen.getByRole('button', { name: 'guestGroups.addMember' }));
      const fields = screen.getAllByPlaceholderText('guestGroups.memberNamePlaceholder');
      await user.type(fields[fields.length - 1]!, name);
    }
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    // Colour is how guests are told apart everywhere they are drawn, so a
    // duplicate inside one group is the feature failing quietly.
    const used = onSubmit.mock.calls[0]?.[0].members.map(
      (member: { color: string }) => member.color,
    );
    expect(new Set(used).size).toBe(3);
  });

  it('submits the name, colour and headcount of each member', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<GuestGroupForm group={familyGroup} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Family',
      members: [
        { name: 'Tom + Léa', color: '#ef4444', headcount: 2 },
        // A headcount of one is left off, so an imported guest matches a
        // hand-typed one field for field.
        { name: 'Alice', color: '#3b82f6' },
      ],
    });
  });

  it('keeps a member’s child seat through a save that touches nothing else', async () => {
    // The form rebuilds every member from its draft rows, so a field it does
    // not read back is a field the next save silently deletes — which would
    // strip the seat off a child the group was saved from a trip to remember.
    const user = userEvent.setup(),
      onSubmit = vi.fn().mockResolvedValue(undefined),
      withSeat: GuestGroup = {
        ...familyGroup,
        members: [
          {
            id: 'member-3' as GuestGroupMemberId,
            name: 'Lila',
            color: '#22c55e' as HexColor,
            childSeat: 'booster',
          },
        ],
      };

    render(<GuestGroupForm group={withSeat} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: 'Family',
        members: [{ name: 'Lila', color: '#22c55e', childSeat: 'booster' }],
      });
    });
  });

  it('leaves a member with no child seat when the picker stays on "none needed"', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<GuestGroupForm group={familyGroup} onSubmit={onSubmit} onCancel={vi.fn()} />);

    expect(
      screen.getAllByRole('combobox', { name: 'childSeats.label' })[0],
    ).toHaveTextContent('childSeats.none');

    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0].members[0]).not.toHaveProperty('childSeat');
  });

  it('refuses a group with no name', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn();

    render(<GuestGroupForm group={familyGroup} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.clear(screen.getByDisplayValue('Family'));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByText('common.required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('refuses a group with nobody in it', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn();

    render(<GuestGroupForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText(/guestGroups.name/), 'Empty');
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    expect(await screen.findByText('guestGroups.membersRequired')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('drops a row the user left blank rather than rejecting the save', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<GuestGroupForm group={familyGroup} onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'guestGroups.addMember' }));
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0].members).toHaveLength(2);
  });

  it('removes a member', async () => {
    const user = userEvent.setup(),
      onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<GuestGroupForm group={familyGroup} onSubmit={onSubmit} onCancel={vi.fn()} />);

    // The harness echoes translation keys, so both rows' remove buttons carry
    // the same accessible name; the first one is Tom + Léa's.
    const removeButtons = screen.getAllByRole('button', {
      name: 'guestGroups.removeMember',
    });
    await user.click(removeButtons[0]!);
    await user.click(screen.getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0].members).toEqual([
      { name: 'Alice', color: '#3b82f6' },
    ]);
  });

  it('reports the dirty state so the discard guard can fire', async () => {
    const user = userEvent.setup(),
      onDirtyChange = vi.fn();

    render(
      <GuestGroupForm
        group={familyGroup}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    await user.type(screen.getByDisplayValue('Family'), '!');

    await waitFor(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
  });

  it('cancels without submitting', async () => {
    const user = userEvent.setup(),
      onCancel = vi.fn(),
      onSubmit = vi.fn();

    render(
      <GuestGroupForm group={familyGroup} onSubmit={onSubmit} onCancel={onCancel} />,
    );

    await user.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
