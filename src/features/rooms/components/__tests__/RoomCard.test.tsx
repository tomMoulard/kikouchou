import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@/test/utils';
import { RoomCard } from '../RoomCard';
import type { Person, Room } from '@/types';

const mockRoom: Room = {
  id: 'r1' as Room['id'],
  tripId: 't1' as Room['tripId'],
  name: 'Main Bedroom',
  capacity: 4,
  description: 'Large bedroom with two double beds',
  order: 0,
};

const mockPerson: Person = {
  id: 'p1' as Person['id'],
  tripId: 't1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

describe('RoomCard', () => {
  it('renders room name and capacity', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('Main Bedroom')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders room description when present', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('Large bedroom with two double beds')).toBeInTheDocument();
  });

  it('renders occupants when provided', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[mockPerson]}
        peakOccupancy={1}
        availableSpots={3}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('calls a full room complete, not full', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={4}
        availableSpots={0}
        isFull={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.complete')).toBeInTheDocument();
    expect(screen.queryByText('rooms.overCapacity')).not.toBeInTheDocument();
  });

  it('shows the over capacity badge instead when more people than beds', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={5}
        availableSpots={0}
        isFull={true}
        isOverCapacity={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.overCapacity')).toBeInTheDocument();
    expect(screen.queryByText('rooms.complete')).not.toBeInTheDocument();
  });

  it('shows available spots text when spots are open', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={2}
        availableSpots={2}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.spotsOpen')).toBeInTheDocument();
  });

  it('calls onClick when card is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: /Main Bedroom/ }));
    expect(onClick).toHaveBeenCalledWith(mockRoom);
  });

  it('does not call onClick when disabled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isDisabled
      />,
      { withProviders: false },
    );
    await user.click(screen.getByText('Main Bedroom'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('calls onDuplicate when the duplicate menu item is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onDuplicate={onDuplicate}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByLabelText('common.openMenu'));
    await user.click(screen.getByText('rooms.duplicate'));
    expect(onDuplicate).toHaveBeenCalledWith(mockRoom);
  });

  it('leaves the duplicate menu item out when no handler is given', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByLabelText('common.openMenu'));
    expect(screen.queryByText('rooms.duplicate')).not.toBeInTheDocument();
  });

  it('calls onEdit when edit menu item is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByLabelText('common.openMenu'));
    await user.click(screen.getByText('common.edit'));
    expect(onEdit).toHaveBeenCalledWith(mockRoom);
  });

  it('calls onEdit when the room name is double-clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onClick={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.dblClick(screen.getByText('Main Bedroom'));
    expect(onEdit).toHaveBeenCalledWith(mockRoom);
  });

  it('does not call onEdit when the name is double-clicked while disabled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onClick={vi.fn()}
        onEdit={onEdit}
        onDelete={vi.fn()}
        isDisabled
      />,
      { withProviders: false },
    );
    await user.dblClick(screen.getByText('Main Bedroom'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  // The name is lifted above the full-card activation button so the double
  // click can reach it at all. A single click on it must still expand the card,
  // which it only does by bubbling to the card's own handler.
  it('still calls onClick for a single click on the room name', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onEdit = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onClick={onClick}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByText('Main Bedroom'));
    expect(onClick).toHaveBeenCalledWith(mockRoom);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('shows the assignment button when onClaim is provided and spots available', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onClaim={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.assignGuest')).toBeInTheDocument();
  });

  // The button opens a dialog with a guest selector listing everyone, so
  // "Claim this room" only tells the truth for a browser that has become one
  // of the guests. For a host arranging the trip it is somebody else's room.
  it('offers to claim the room only when the browser is one of the guests', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onClaim={vi.fn()}
        claimsForSelf
      />,
      { withProviders: false },
    );
    expect(screen.getByText('rooms.claimRoom')).toBeInTheDocument();
    expect(screen.queryByText('rooms.assignGuest')).not.toBeInTheDocument();
  });

  it('renders expanded content when isExpanded and expandedContent are provided', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isExpanded={true}
        expandedContent={<div data-testid="expanded-content">Expanded!</div>}
      />,
      { withProviders: false },
    );
    expect(screen.getByTestId('expanded-content')).toBeInTheDocument();
  });

  it('hides description when not provided', () => {
    const roomNoDesc = { ...mockRoom, description: undefined };
    render(
      <RoomCard
        room={roomNoDesc}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.queryByText('Large bedroom')).not.toBeInTheDocument();
  });

  it('does not show available spots text when no spots open', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={4}
        availableSpots={0}
        isFull={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.queryByText('rooms.spotsOpen')).not.toBeInTheDocument();
  });

  it('does not show claim button when no onClaim provided', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.queryByText('rooms.assignGuest')).not.toBeInTheDocument();
  });

  it('does not show claim button when room is full even if onClaim provided', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={4}
        availableSpots={0}
        isFull={true}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onClaim={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.queryByText('rooms.assignGuest')).not.toBeInTheDocument();
  });

  it('calls onClaim when claim button is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClaim = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        onClaim={onClaim}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByText('rooms.assignGuest'));
    expect(onClaim).toHaveBeenCalledWith(mockRoom);
  });

  it('activates card on Enter key', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    const card = screen.getByRole('button', { name: /Main Bedroom/ });
    card.focus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledWith(mockRoom);
  });

  it('activates card on Space key', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onClick={onClick}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    const card = screen.getByRole('button', { name: /Main Bedroom/ });
    card.focus();
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledWith(mockRoom);
  });

  it('does not render expanded content when isExpanded is false', () => {
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        isExpanded={false}
        expandedContent={<div data-testid="expanded-content">Expanded!</div>}
      />,
      { withProviders: false },
    );
    expect(screen.queryByTestId('expanded-content')).not.toBeInTheDocument();
  });

  it('shows chevron when expandedContent is provided', () => {
    const { container } = render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        expandedContent={<div>Content</div>}
      />,
      { withProviders: false },
    );
    // ChevronDown icon should be present (has rotate-180 class when expanded)
    expect(container.querySelector('svg.lucide-chevron-down')).toBeInTheDocument();
  });

  it('shows amber progress bar when room is half full', () => {
    const { container } = render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={2}
        availableSpots={2}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    const progressBar = container.querySelector('[role="progressbar"]');
    expect(progressBar).toBeInTheDocument();
  });

  it('handles zero capacity room without error', () => {
    const zeroCapRoom = { ...mockRoom, capacity: 0 };
    render(
      <RoomCard
        room={zeroCapRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={0}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText(zeroCapRoom.name)).toBeInTheDocument();
  });

  it('shows delete confirmation dialog when delete menu item is clicked', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(
      <RoomCard
        room={mockRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    await user.click(screen.getByLabelText('common.openMenu'));
    // Click the "delete" menu item
    const deleteItems = screen.getAllByText('common.delete');
    await user.click(deleteItems[0]!);
    // Confirm dialog should appear
    expect(screen.getByText('confirm.deleteRoom')).toBeInTheDocument();
  });

  it('renders room with custom icon', () => {
    const roomWithIcon: Room = { ...mockRoom, icon: 'tent' };
    render(
      <RoomCard
        room={roomWithIcon}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={4}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );
    expect(screen.getByText('Main Bedroom')).toBeInTheDocument();
  });

  // jsdom does not lay anything out, so these pin the arrangement that decides
  // where the ellipsis falls rather than the pixel it falls on. A long name
  // used to share a flex row with the capacity badge inside a grid track that
  // could not hold it: the badge took a third of the row away from the name on
  // a phone, and the row grew past the card, so the page scrolled sideways.
  describe('room name width', () => {
    const longRoom: Room = {
      ...mockRoom,
      name: 'Chambre des enfants tout au fond du couloir du premier étage',
    };

    function renderLongRoom() {
      return render(
        <RoomCard
          room={longRoom}
          occupants={[]}
          peakOccupancy={0}
          availableSpots={4}
          isFull={false}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />,
        { withProviders: false },
      );
    }

    it('keeps the whole name in the DOM and in its tooltip', () => {
      renderLongRoom();
      const name = screen.getByText(longRoom.name);
      expect(name).toBeInTheDocument();
      expect(name.getAttribute('title')).toContain(longRoom.name);
    });

    it('gives the name a row of its own, as wide as the card', () => {
      renderLongRoom();
      const name = screen.getByText(longRoom.name);
      const header = name.parentElement;

      // A direct child of the card header's grid: no intermediate flex row to
      // grow past the track, and no sibling on the line to shorten it.
      expect(header?.dataset.slot).toBe('card-header');
      expect(header?.className).not.toContain('pr-12');

      // `min-w-0` lets it shrink to the track, `truncate` ends it with an
      // ellipsis there, and `pr-12` is the only width it gives up — the corner
      // the menu button floats over.
      expect(name).toHaveClass('min-w-0', 'truncate', 'pr-12');
    });

    it('puts the capacity badge below the name, not beside it', () => {
      renderLongRoom();
      const name = screen.getByText(longRoom.name);
      const badge = screen.getByText(String(longRoom.capacity));

      expect(badge).not.toHaveClass('pr-12');
      expect(name.contains(badge)).toBe(false);
      expect(
        name.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });
});

// ============================================================================
// What the card draws for each state, and the handlers of the latest render
// ============================================================================

describe('RoomCard states', () => {
  type CardProps = Parameters<typeof RoomCard>[0];

  function cardProps(overrides: Partial<CardProps> = {}): CardProps {
    return {
      room: mockRoom,
      occupants: [],
      peakOccupancy: 1,
      availableSpots: 3,
      isFull: false,
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      ...overrides,
    };
  }

  function cardOf(): HTMLElement {
    return screen.getByText('Main Bedroom').closest('[data-slot="card"]') as HTMLElement;
  }

  function bar(): HTMLElement {
    return screen.getByRole('progressbar').firstElementChild as HTMLElement;
  }

  it('fills the bar by the share of beds taken, in the colour of progress', () => {
    render(<RoomCard {...cardProps()} />, { withProviders: false });

    expect(bar()).toHaveStyle({ width: '25%' });
    expect(bar()).toHaveClass('h-full', 'rounded-full', 'bg-primary');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-label', 'rooms.spotsTaken');
    expect(cardOf()).toHaveClass('relative', 'transition-all');
    expect(cardOf()).not.toHaveClass('border-success/50');
    expect(cardOf()).not.toHaveClass('border-destructive/50');
    expect(cardOf()).not.toHaveClass('opacity-50');
  });

  it('turns the bar green, the edge green and says complete once every bed is taken', () => {
    render(
      <RoomCard {...cardProps({ peakOccupancy: 4, availableSpots: 0, isFull: true })} />,
      { withProviders: false },
    );

    expect(bar()).toHaveStyle({ width: '100%' });
    expect(bar()).toHaveClass('bg-success');
    expect(cardOf()).toHaveClass('border-success/50');
    expect(screen.getByText('rooms.complete')).toHaveClass('text-xs', 'bg-success-surface');
  });

  it('caps the bar and turns it red when more people than beds sleep there', () => {
    render(
      <RoomCard
        {...cardProps({ peakOccupancy: 6, availableSpots: 0, isFull: true, isOverCapacity: true })}
      />,
      { withProviders: false },
    );

    expect(bar()).toHaveStyle({ width: '100%' });
    expect(bar()).toHaveClass('bg-destructive');
    expect(cardOf()).toHaveClass('border-destructive/50');
    expect(cardOf()).not.toHaveClass('border-success/50');
    expect(screen.getByText('rooms.overCapacity')).toHaveClass('text-xs', 'bg-destructive-surface');
  });

  it('draws an empty bar for a room with no beds', () => {
    render(
      <RoomCard
        {...cardProps({ room: { ...mockRoom, capacity: 0 }, peakOccupancy: 0, availableSpots: 0 })}
      />,
      { withProviders: false },
    );

    expect(bar()).toHaveStyle({ width: '0%' });
  });

  it('says how many spots are open in green', () => {
    render(<RoomCard {...cardProps()} />, { withProviders: false });

    expect(screen.getByText('rooms.spotsOpen')).toHaveClass('text-xs', 'mt-1', 'text-success-on-surface');
  });

  it('draws no occupants row and no description when there are none', () => {
    const { container } = render(
      <RoomCard {...cardProps({ room: { ...mockRoom, description: undefined } })} />,
      { withProviders: false },
    );

    expect(container.querySelector('.flex-wrap')).toBeNull();
    expect(container.querySelector('[data-slot="card-description"]')).toBeNull();
  });

  it('names the double click in the room name’s tooltip', () => {
    render(<RoomCard {...cardProps()} />, { withProviders: false });

    expect(screen.getByText('Main Bedroom')).toHaveAttribute(
      'title',
      'Main Bedroom · rooms.doubleClickToEdit',
    );
  });

  it('makes the whole card a button while it can be clicked', () => {
    render(<RoomCard {...cardProps({ onClick: vi.fn() })} />, { withProviders: false });

    const overlay = screen.getByRole('button', { name: /Main Bedroom/ });
    expect(overlay).toHaveAttribute('tabindex', '0');
    expect(overlay).not.toHaveAttribute('aria-disabled');
    expect(overlay).not.toHaveAttribute('aria-expanded');
    expect(overlay).toHaveClass('absolute', 'inset-0', 'focus-visible:ring-2');
    expect(overlay).not.toHaveClass('cursor-not-allowed');
    expect(cardOf()).toHaveClass('cursor-pointer', 'hover:shadow-md');
  });

  it('takes the card out of the tab order, greyed, while it is disabled', () => {
    render(<RoomCard {...cardProps({ onClick: vi.fn(), isDisabled: true })} />, {
      withProviders: false,
    });

    const overlay = screen.getByRole('button', { name: /Main Bedroom/ });
    expect(overlay).toHaveAttribute('tabindex', '-1');
    expect(overlay).toHaveAttribute('aria-disabled', 'true');
    expect(overlay).toHaveClass('cursor-not-allowed');
    expect(cardOf()).toHaveClass('opacity-50', 'cursor-not-allowed');
    expect(cardOf()).not.toHaveClass('cursor-pointer');
  });

  it('starts folded, and turns its chevron when unfolded', () => {
    const { rerender, container } = render(
      <RoomCard {...cardProps({ onClick: vi.fn(), expandedContent: <p>stays</p> })} />,
      { withProviders: false },
    );

    expect(screen.queryByText('stays')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Main Bedroom/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    const chevron = container.querySelector('.lucide-chevron-down');
    expect(chevron).toHaveClass('size-4', 'transition-transform');
    expect(chevron).not.toHaveClass('rotate-180');

    rerender(
      <RoomCard
        {...cardProps({ onClick: vi.fn(), expandedContent: <p>stays</p>, isExpanded: true })}
      />,
    );
    expect(container.querySelector('.lucide-chevron-down')).toHaveClass('rotate-180');
  });

  it('keeps clicks and keys on its menu and its claim button away from the card', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onKeyDown = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a stand-in for the page around the card
      <div onKeyDown={onKeyDown}>
        <RoomCard {...cardProps({ onClick, onClaim: vi.fn() })} />
      </div>,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'rooms.assignGuest' }));
    await user.click(screen.getByRole('button', { name: 'common.openMenu' }));
    expect(onClick).not.toHaveBeenCalled();
    onKeyDown.mockClear();
    await user.keyboard('{Escape}');
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('acts on the props of the latest render', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const first = { onClick: vi.fn(), onEdit: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn() };
    const second = {
      onClick: vi.fn(),
      onEdit: vi.fn(),
      onDuplicate: vi.fn(),
      onDelete: vi.fn().mockResolvedValue(undefined),
    };
    const renamed = { ...mockRoom, name: 'Renamed' };
    const { rerender } = render(<RoomCard {...cardProps({ ...first, isDisabled: true })} />, {
      withProviders: false,
    });
    rerender(<RoomCard {...cardProps({ ...second, room: renamed })} />);

    await user.click(screen.getByRole('button', { name: /Renamed/ }));
    await user.dblClick(screen.getByText('Renamed'));
    await user.click(screen.getByRole('button', { name: 'common.openMenu' }));
    await user.click(await screen.findByRole('menuitem', { name: /rooms.duplicate/ }));
    await user.click(screen.getByRole('button', { name: 'common.openMenu' }));
    await user.click(await screen.findByRole('menuitem', { name: /common.delete/ }));
    const prompt = await screen.findByRole('alertdialog');
    expect(prompt).toHaveTextContent('confirm.deleteRoomDescription');
    await user.click(within(prompt).getByRole('button', { name: 'common.delete' }));

    expect(second.onClick).toHaveBeenCalledWith(renamed);
    expect(second.onEdit).toHaveBeenCalledWith(renamed);
    expect(second.onDuplicate).toHaveBeenCalledWith(renamed);
    await waitFor(() => {
      expect(second.onDelete).toHaveBeenCalledWith(renamed);
    });
    for (const handler of Object.values(first)) {
      expect(handler).not.toHaveBeenCalled();
    }
  });

  it('stops answering a click once it is disabled', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<RoomCard {...cardProps({ onClick })} />, {
      withProviders: false,
    });
    rerender(<RoomCard {...cardProps({ onClick, isDisabled: true })} />);

    await user.click(screen.getByText('Main Bedroom'));

    expect(onClick).not.toHaveBeenCalled();
  });

  it('closes the delete prompt when the reader backs out', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(<RoomCard {...cardProps({ onDelete })} />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'common.openMenu' }));
    await user.click(await screen.findByRole('menuitem', { name: /common.delete/ }));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: 'common.cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('RoomCard menu after a re-render', () => {
  it('edits the room of the latest render from the menu', async () => {
    const { userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const renamed = { ...mockRoom, name: 'Renamed' };
    const props = { occupants: [], peakOccupancy: 0, availableSpots: 4, isFull: false, onDelete: vi.fn() };
    const { rerender } = render(<RoomCard room={mockRoom} onEdit={first} {...props} />, {
      withProviders: false,
    });
    rerender(<RoomCard room={renamed} onEdit={second} {...props} />);

    await user.click(screen.getByRole('button', { name: 'common.openMenu' }));
    await user.click(await screen.findByRole('menuitem', { name: /common.edit/ }));

    expect(second).toHaveBeenCalledWith(renamed);
    expect(first).not.toHaveBeenCalled();
  });
});
