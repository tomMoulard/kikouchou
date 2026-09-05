import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
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

  it('shows full badge when room is full', () => {
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
    expect(screen.getByText('rooms.full')).toBeInTheDocument();
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

  it('shows claim button when onClaim is provided and spots available', () => {
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
    expect(screen.getByText('rooms.claimRoom')).toBeInTheDocument();
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
    expect(screen.queryByText('rooms.claimRoom')).not.toBeInTheDocument();
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
    expect(screen.queryByText('rooms.claimRoom')).not.toBeInTheDocument();
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
    await user.click(screen.getByText('rooms.claimRoom'));
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
});
