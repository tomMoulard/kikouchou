/**
 * @fileoverview Tests for RoomIconPicker.
 *
 * `getRoomIconComponent` used to be checked with `expect(Icon).toBeDefined()`.
 * It always returns *some* component, so that assertion held with every key
 * mapped to the wrong icon — a room saved as a tent would have drawn a bath and
 * nothing would have said so. These pin the identities instead, against icons
 * the test names itself rather than re-reading `ROOM_ICONS`.
 *
 * @module components/shared/__tests__/RoomIconPicker.test
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@/test/utils';
import {
  Armchair,
  Baby,
  Bath,
  BedDouble,
  BedSingle,
  Caravan,
  DoorOpen,
  Home,
  Sofa,
  Tent,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

import {
  ICON_ORDER,
  RoomIconPicker,
  getRoomIconComponent,
  getRoomIconLabelKey,
} from '../RoomIconPicker';
import type { RoomIcon } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

/**
 * Every room icon key and the lucide component it must resolve to, spelled out
 * here so a swap in `ROOM_ICONS` has something to contradict.
 */
const EXPECTED_ICONS: ReadonlyArray<readonly [RoomIcon, string, LucideIcon]> = [
  ['bed-double', 'BedDouble', BedDouble],
  ['bed-single', 'BedSingle', BedSingle],
  ['bath', 'Bath', Bath],
  ['sofa', 'Sofa', Sofa],
  ['tent', 'Tent', Tent],
  ['caravan', 'Caravan', Caravan],
  ['warehouse', 'Warehouse', Warehouse],
  ['home', 'Home', Home],
  ['door-open', 'DoorOpen', DoorOpen],
  ['baby', 'Baby', Baby],
  ['armchair', 'Armchair', Armchair],
];

/** The paths a lucide icon draws, so a rendered glyph can be identified. */
function shapeOf(Icon: LucideIcon): string {
  const { container, unmount } = render(<Icon />, { withProviders: false });
  const markup = container.querySelector('svg')?.innerHTML ?? '';
  unmount();
  return markup;
}

// ============================================================================
// Tests
// ============================================================================

describe('getRoomIconComponent', () => {
  it.each(EXPECTED_ICONS)('resolves %s to the %s icon', (key, _name, Icon) => {
    expect(getRoomIconComponent(key)).toBe(Icon);
  });

  it('gives every key a distinct icon', () => {
    // Catches the whole table collapsing onto the default, which the per-key
    // assertions above would still report one at a time.
    const icons = new Set(ICON_ORDER.map((key) => getRoomIconComponent(key)));
    expect(icons.size).toBe(ICON_ORDER.length);
  });

  it('returns BedDouble for a room with no icon set', () => {
    // Rooms created before the picker existed carry no icon.
    expect(getRoomIconComponent(undefined)).toBe(BedDouble);
  });

  it('returns BedDouble for a key this build does not know', () => {
    // A row written by a peer running a newer build.
    expect(getRoomIconComponent('hammock' as RoomIcon)).toBe(BedDouble);
  });
});

describe('getRoomIconLabelKey', () => {
  it.each(ICON_ORDER)('returns a distinct rooms.icons.* key for %s', (key) => {
    expect(getRoomIconLabelKey(key)).toMatch(/^rooms\.icons\.[a-zA-Z]+$/);
  });

  it('returns correct label key for tent', () => {
    expect(getRoomIconLabelKey('tent')).toBe('rooms.icons.tent');
  });

  it('camel-cases the two-word keys rather than passing them through', () => {
    expect(getRoomIconLabelKey('bed-double')).toBe('rooms.icons.bedDouble');
    expect(getRoomIconLabelKey('bed-single')).toBe('rooms.icons.bedSingle');
    expect(getRoomIconLabelKey('door-open')).toBe('rooms.icons.doorOpen');
  });

  it('gives every key its own label, so no two buttons share a name', () => {
    const keys = new Set(ICON_ORDER.map((key) => getRoomIconLabelKey(key)));
    expect(keys.size).toBe(ICON_ORDER.length);
  });

  it('falls back to the default label for a key this build does not know', () => {
    expect(getRoomIconLabelKey('hammock' as RoomIcon)).toBe('rooms.icons.bedDouble');
  });
});

describe('RoomIconPicker', () => {
  it('renders radiogroup with icon buttons', () => {
    render(
      <RoomIconPicker onChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    // Should have 11 icon buttons
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(11);
  });

  it('draws each button with the icon its key names', () => {
    render(<RoomIconPicker onChange={vi.fn()} />, { withProviders: false });

    for (const [key, , Icon] of EXPECTED_ICONS) {
      const button = screen.getByRole('radio', { name: getRoomIconLabelKey(key) });
      expect(button).toHaveAttribute('data-room-icon', key);
      // The grid renders `config.icon`, not `getRoomIconComponent`, so the two
      // can drift apart; this is the only assertion that would notice.
      expect(button.querySelector('svg')?.innerHTML).toBe(shapeOf(Icon));
    }
  });

  it('hides the glyph from screen readers, leaving the visible name', () => {
    render(<RoomIconPicker onChange={vi.fn()} />, { withProviders: false });

    const button = screen.getByRole('radio', { name: 'rooms.icons.tent' });
    // The button is already named by aria-label; an exposed icon would either
    // double it up or, with an empty accessible name, add noise.
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(button).getByText('rooms.icons.tent')).toBeInTheDocument();
  });

  it('marks the selected icon as checked', () => {
    render(
      <RoomIconPicker value="tent" onChange={vi.fn()} />,
      { withProviders: false },
    );
    const tentRadio = screen.getByRole('radio', { name: 'rooms.icons.tent' });
    expect(tentRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('defaults to bed-double when value is undefined', () => {
    render(
      <RoomIconPicker onChange={vi.fn()} />,
      { withProviders: false },
    );
    const defaultRadio = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });
    expect(defaultRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange when an icon is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker onChange={onChange} />,
      { withProviders: false },
    );
    const tentRadio = screen.getByRole('radio', { name: 'rooms.icons.tent' });
    await user.click(tentRadio);
    expect(onChange).toHaveBeenCalledWith('tent');
  });

  it('does not call onChange when disabled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker onChange={onChange} disabled />,
      { withProviders: false },
    );
    const tentRadio = screen.getByRole('radio', { name: 'rooms.icons.tent' });
    await user.click(tentRadio);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('handles keyboard navigation with ArrowRight', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-double" onChange={onChange} />,
      { withProviders: false },
    );
    const bedDouble = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });
    bedDouble.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('bed-single');
  });

  it('handles keyboard navigation with ArrowLeft', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-single" onChange={onChange} />,
      { withProviders: false },
    );
    const bedSingle = screen.getByRole('radio', { name: 'rooms.icons.bedSingle' });
    bedSingle.focus();
    await user.keyboard('{ArrowLeft}');
    expect(onChange).toHaveBeenCalledWith('bed-double');
  });

  it('handles keyboard navigation with ArrowDown', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-double" onChange={onChange} />,
      { withProviders: false },
    );
    const bedDouble = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });
    bedDouble.focus();
    await user.keyboard('{ArrowDown}');
    // Grid columns = 4, so ArrowDown moves 4 positions: bed-double(0) -> caravan(4+1=5)?
    // ICON_ORDER: 0:bed-double, 1:bed-single, 2:bath, 3:sofa, 4:tent, ...
    // So 0+4 = 4 which is 'tent'
    expect(onChange).toHaveBeenCalledWith('tent');
  });

  it('handles keyboard navigation with ArrowUp', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="tent" onChange={onChange} />,
      { withProviders: false },
    );
    const tent = screen.getByRole('radio', { name: 'rooms.icons.tent' });
    tent.focus();
    await user.keyboard('{ArrowUp}');
    // tent is index 4, ArrowUp = 4-4 = 0 -> bed-double
    expect(onChange).toHaveBeenCalledWith('bed-double');
  });

  it('handles keyboard navigation with Home', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="armchair" onChange={onChange} />,
      { withProviders: false },
    );
    const armchair = screen.getByRole('radio', { name: 'rooms.icons.armchair' });
    armchair.focus();
    await user.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith('bed-double');
  });

  it('handles keyboard navigation with End', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-double" onChange={onChange} />,
      { withProviders: false },
    );
    const bedDouble = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });
    bedDouble.focus();
    await user.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('armchair');
  });

  it('wraps around from first to last with ArrowLeft', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-double" onChange={onChange} />,
      { withProviders: false },
    );
    const bedDouble = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });
    bedDouble.focus();
    await user.keyboard('{ArrowLeft}');
    // Index 0 - 1 = -1, wraps to last (armchair, index 10)
    expect(onChange).toHaveBeenCalledWith('armchair');
  });

  it('wraps around from last to first with ArrowRight', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="armchair" onChange={onChange} />,
      { withProviders: false },
    );
    const armchair = screen.getByRole('radio', { name: 'rooms.icons.armchair' });
    armchair.focus();
    await user.keyboard('{ArrowRight}');
    // Index 10 + 1 = 11, wraps to 0 (bed-double)
    expect(onChange).toHaveBeenCalledWith('bed-double');
  });

  it('wraps around with ArrowUp from first row', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-single" onChange={onChange} />,
      { withProviders: false },
    );
    const bedSingle = screen.getByRole('radio', { name: 'rooms.icons.bedSingle' });
    bedSingle.focus();
    await user.keyboard('{ArrowUp}');
    // Index 1 - 4 = -3, wraps to 11 + (-3) = 8 -> 'door-open'
    expect(onChange).toHaveBeenCalledWith('door-open');
  });

  it('ignores unhandled keyboard keys (default branch)', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-double" onChange={onChange} />,
      { withProviders: false },
    );
    const bedDouble = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });
    bedDouble.focus();
    await user.keyboard('{Tab}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not navigate keyboard when disabled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <RoomIconPicker value="bed-double" onChange={onChange} disabled />,
      { withProviders: false },
    );
    const bedDouble = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });
    bedDouble.focus();
    await user.keyboard('{ArrowRight}');
    expect(onChange).not.toHaveBeenCalled();
  });
});
