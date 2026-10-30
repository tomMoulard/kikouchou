/**
 * @fileoverview The room menu on a timeline chip.
 *
 * @module features/rooms/components/__tests__/RoomPickerMenu.test
 */

import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen } from '@/test/utils';
import type { RoomId } from '@/types';

// Echoes the count, which the suite-wide mock drops, so "2 spots open" and
// "spots open" read differently.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      typeof options === 'object' && options !== null && 'count' in options
        ? `${key}#${String((options as { count: unknown }).count)}`
        : key,
    i18n: { language: 'en' },
  }),
}));

import { RoomPickerMenu } from '../RoomPickerMenu';

const ROOMS = [
  { id: 'r1' as RoomId, name: 'Attic', availableSpots: 2 },
  { id: 'r2' as RoomId, name: 'Barn', availableSpots: 0 },
];

describe('RoomPickerMenu', () => {
  it('draws a small focusable trigger under the label it is given', () => {
    render(
      <RoomPickerMenu
        triggerLabel="Move Alice"
        heading="Move to"
        rooms={ROOMS}
        onSelectRoom={vi.fn()}
        open={false}
        onOpenChange={vi.fn()}
        className="extra"
      />,
      { withProviders: false },
    );

    expect(screen.getByRole('button', { name: 'Move Alice' })).toHaveClass(
      'flex',
      'size-5',
      'opacity-70',
      'hover:opacity-100',
      'focus-visible:ring-2',
      'extra',
    );
  });

  it('lists each room with the beds it has left, or full', () => {
    render(
      <RoomPickerMenu
        triggerLabel="Move Alice"
        heading="Move to"
        rooms={ROOMS}
        onSelectRoom={vi.fn()}
        open
        onOpenChange={vi.fn()}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('Move to')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Attic/ })).toHaveTextContent('rooms.spotsOpen#2');
    expect(screen.getByRole('menuitem', { name: /Barn/ })).toHaveTextContent('rooms.full');
    expect(screen.getByRole('menuitem', { name: /Barn/ })).not.toHaveTextContent('rooms.spotsOpen');
  });

  it('hands back the room that was picked', async () => {
    const onSelectRoom = vi.fn();
    render(
      <RoomPickerMenu
        triggerLabel="Move Alice"
        heading="Move to"
        rooms={ROOMS}
        onSelectRoom={onSelectRoom}
        open
        onOpenChange={vi.fn()}
      />,
      { withProviders: false },
    );

    await userEvent.setup().click(screen.getByRole('menuitem', { name: /Barn/ }));

    expect(onSelectRoom).toHaveBeenCalledWith('r2');
  });
});
