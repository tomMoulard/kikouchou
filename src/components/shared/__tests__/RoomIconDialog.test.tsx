/**
 * @fileoverview Tests for RoomIconDialog.
 *
 * The icon is one button now, so what needs pinning is the three things the
 * button owes: it draws the room's icon (the double bed when the room has
 * none), it opens the picker, and one tile both reports the pick and closes
 * the dialog.
 *
 * @module components/shared/__tests__/RoomIconDialog.test
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@/test/utils';

import { RoomIconDialog } from '../RoomIconDialog';

// ============================================================================
// Helpers
// ============================================================================

/** The trigger button. */
function iconButton(): HTMLElement {
  return screen.getByRole('button', { name: 'rooms.changeIcon' });
}

/** The glyph a button draws, by the class lucide stamps on its `svg`. */
function glyphOf(element: HTMLElement): string | undefined {
  return [...(element.querySelector('svg')?.classList ?? [])]
    .find((name) => name.startsWith('lucide-'))
    ?.replace('lucide-', '');
}

// ============================================================================
// Tests
// ============================================================================

describe('RoomIconDialog', () => {
  it('draws the double bed for a room with no icon of its own', () => {
    render(<RoomIconDialog onChange={vi.fn()} />, { withProviders: false });
    expect(glyphOf(iconButton())).toBe('bed-double');
  });

  it('draws the icon the room carries', () => {
    render(<RoomIconDialog value="caravan" onChange={vi.fn()} />, {
      withProviders: false,
    });
    expect(glyphOf(iconButton())).toBe('caravan');
  });

  it('opens the picker, with the current icon already chosen', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<RoomIconDialog value="tent" onChange={vi.fn()} />, {
      withProviders: false,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(iconButton());

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('radiogroup')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('radio', { name: 'rooms.icons.tent' }),
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('reports the pick and closes on one click', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RoomIconDialog onChange={onChange} />, { withProviders: false });

    await user.click(iconButton());
    await user.click(screen.getByRole('radio', { name: 'rooms.icons.hammock' }));

    expect(onChange).toHaveBeenCalledWith('hammock');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('hides the glyph from screen readers, which the name already covers', () => {
    render(<RoomIconDialog value="bath" onChange={vi.fn()} />, {
      withProviders: false,
    });
    expect(iconButton().querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('does not open while disabled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<RoomIconDialog onChange={vi.fn()} disabled />, {
      withProviders: false,
    });

    await user.click(iconButton());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
