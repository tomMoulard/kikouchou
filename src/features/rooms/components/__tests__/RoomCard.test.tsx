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
});
