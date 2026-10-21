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
import { fireEvent, render, screen, within } from '@/test/utils';
import {
  Armchair,
  Baby,
  Bath,
  Bed,
  BedDouble,
  BedSingle,
  Caravan,
  DoorOpen,
  Home,
  Hotel,
  RockingChair,
  Sailboat,
  ShowerHead,
  Sofa,
  Tent,
  TentTree,
  TreePalm,
  Van,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';

import { BedBunk, BedTwin } from '../room-bed-icons';
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
  ['bunk-bed', 'BedBunk', BedBunk],
  ['hammock', 'TreePalm', TreePalm],
  ['camper-van', 'Van', Van],
  ['campsite', 'TentTree', TentTree],
  ['hotel', 'Hotel', Hotel],
  ['rocking-chair', 'RockingChair', RockingChair],
  ['shower', 'ShowerHead', ShowerHead],
  ['boat', 'Sailboat', Sailboat],
  ['bed-twin', 'BedTwin', BedTwin],
];

/**
 * A key no build has ever written, for the unknown-key fallbacks. It has to be
 * something the list will not grow into: `hammock` used to serve here and then
 * became a real icon, which quietly turned two fallback tests green for the
 * wrong reason.
 */
const UNKNOWN_ICON = 'igloo' as RoomIcon;

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

  it('draws the bunk and twin beds with shapes of their own', () => {
    // lucide has neither, and the bunks used to borrow its plain `Bed`.
    const lucideBeds = [Bed, BedDouble, BedSingle].map(shapeOf);
    for (const Icon of [BedBunk, BedTwin]) {
      const shape = shapeOf(Icon);
      expect(shape).toContain('<path');
      expect(lucideBeds).not.toContain(shape);
    }
    expect(shapeOf(BedBunk)).not.toBe(shapeOf(BedTwin));
  });

  it('returns BedDouble for a room with no icon set', () => {
    // Rooms created before the picker existed carry no icon.
    expect(getRoomIconComponent(undefined)).toBe(BedDouble);
  });

  it('returns BedDouble for a key this build does not know', () => {
    // A row written by a peer running a newer build.
    expect(getRoomIconComponent(UNKNOWN_ICON)).toBe(BedDouble);
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
    expect(getRoomIconLabelKey(UNKNOWN_ICON)).toBe('rooms.icons.bedDouble');
  });
});

describe('RoomIconPicker', () => {
  it('renders radiogroup with icon buttons', () => {
    render(
      <RoomIconPicker onChange={vi.fn()} />,
      { withProviders: false },
    );
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    // One tile per key, in the order the grid draws them. The original eleven
    // lead: somebody who has always picked the fourth tile still finds it
    // there now the list has grown.
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(ICON_ORDER.length);
    expect(radios.map((tile) => tile.dataset.roomIcon)).toEqual([...ICON_ORDER]);
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
    expect(onChange).toHaveBeenCalledWith(ICON_ORDER.at(-1));
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
    // Index 0 - 1 = -1, wraps to the last tile
    expect(onChange).toHaveBeenCalledWith(ICON_ORDER.at(-1));
  });

  it('wraps around from last to first with ArrowRight', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onChange = vi.fn();
    const last = ICON_ORDER.at(-1)!;
    render(
      <RoomIconPicker value={last} onChange={onChange} />,
      { withProviders: false },
    );
    const lastTile = screen.getByRole('radio', { name: getRoomIconLabelKey(last) });
    lastTile.focus();
    await user.keyboard('{ArrowRight}');
    // One past the end wraps to 0 (bed-double)
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
    // Index 1 - 4 = -3, wraps to ICON_ORDER.length - 3
    expect(onChange).toHaveBeenCalledWith(ICON_ORDER.at(-3));
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

describe('RoomIconPicker keys', () => {
  it('keeps the keys it handles from scrolling the page, and leaves the others alone', () => {
    render(<RoomIconPicker value="bed-double" onChange={vi.fn()} />, { withProviders: false });
    const bedDouble = screen.getByRole('radio', { name: 'rooms.icons.bedDouble' });

    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
      expect(fireEvent.keyDown(bedDouble, { key })).toBe(false);
    }
    expect(fireEvent.keyDown(bedDouble, { key: 'a' })).toBe(true);
  });
});

describe('RoomIconPicker drawing and freshness', () => {
  it('shows its label by default, ties it to the group, and hides it on request', () => {
    const { unmount } = render(<RoomIconPicker onChange={vi.fn()} id="pick" className="extra" />, {
      withProviders: false,
    });
    const label = screen.getByText('rooms.icon');
    expect(label).toHaveAttribute('id', 'pick-label');
    expect(label).not.toHaveClass('sr-only');
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-labelledby', 'pick-label');
    expect(screen.getByRole('radiogroup')).toHaveClass('grid', 'grid-cols-3', 'gap-2', 'sm:grid-cols-6');
    expect(label.parentElement).toHaveClass('space-y-2', 'extra');
    unmount();

    render(<RoomIconPicker onChange={vi.fn()} showLabel={false} />, { withProviders: false });
    const hidden = screen.getByText('rooms.icon');
    expect(hidden).toHaveClass('sr-only');
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-labelledby', hidden.id);
  });

  it('draws the chosen tile in the primary colour, the others muted, and only the chosen one tabbable', () => {
    render(<RoomIconPicker value="tent" onChange={vi.fn()} />, { withProviders: false });

    const tent = screen.getByRole('radio', { name: 'rooms.icons.tent' });
    expect(tent).toHaveAttribute('tabindex', '0');
    expect(tent).toHaveClass(
      'flex', 'min-h-20', 'flex-col', 'items-center', 'justify-center', 'gap-1', 'p-2', 'rounded-lg', 'border-2',
      'hover:bg-accent', 'focus-visible:ring-2', 'border-primary', 'bg-primary/10', 'text-primary',
    );
    expect(tent).not.toHaveClass('opacity-50');
    expect(tent.querySelector('svg')).toHaveClass('size-6', 'text-primary');
    expect(within(tent).getByText('rooms.icons.tent')).toHaveClass('text-xs', 'text-center', 'leading-tight');

    const bath = screen.getByRole('radio', { name: 'rooms.icons.bath' });
    expect(bath).toHaveAttribute('tabindex', '-1');
    expect(bath).toHaveClass('border-border', 'bg-background', 'text-muted-foreground');
    expect(bath.querySelector('svg')).toHaveClass('text-muted-foreground');
  });

  it('dims every tile while disabled, and ignores keys on them', () => {
    const onChange = vi.fn();
    render(<RoomIconPicker value="tent" onChange={onChange} disabled />, { withProviders: false });

    const tent = screen.getByRole('radio', { name: 'rooms.icons.tent' });
    expect(tent).toHaveClass('opacity-50', 'cursor-not-allowed');
    fireEvent.keyDown(tent, { key: 'ArrowRight' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves the choice and the focus with the keys, wrapping at both ends, for the newest onChange', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<RoomIconPicker value={ICON_ORDER[0]} onChange={first} />, {
      withProviders: false,
    });
    rerender(<RoomIconPicker value={ICON_ORDER[0]} onChange={second} />);
    const radios = screen.getAllByRole('radio');
    const firstTile = radios[0] as HTMLElement;
    const last = ICON_ORDER.length - 1;

    fireEvent.keyDown(firstTile, { key: 'ArrowRight' });
    expect(second).toHaveBeenLastCalledWith(ICON_ORDER[1]);
    expect(document.activeElement).toBe(radios[1]);

    fireEvent.keyDown(firstTile, { key: 'ArrowLeft' });
    expect(second).toHaveBeenLastCalledWith(ICON_ORDER[last]);

    fireEvent.keyDown(radios[last] as HTMLElement, { key: 'ArrowRight' });
    expect(second).toHaveBeenLastCalledWith(ICON_ORDER[0]);

    fireEvent.keyDown(firstTile, { key: 'End' });
    expect(second).toHaveBeenLastCalledWith(ICON_ORDER[last]);

    expect(first).not.toHaveBeenCalled();
  });

  it('reports a click to the newest onChange', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<RoomIconPicker onChange={first} />, { withProviders: false });
    rerender(<RoomIconPicker onChange={second} />);

    fireEvent.click(screen.getByRole('radio', { name: 'rooms.icons.tent' }));

    expect(second).toHaveBeenCalledWith('tent');
    expect(first).not.toHaveBeenCalled();
  });
});
