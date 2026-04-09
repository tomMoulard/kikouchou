import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import { RoomIconPicker, getRoomIconComponent, getRoomIconLabelKey } from '../RoomIconPicker';

describe('getRoomIconComponent', () => {
  it('returns default BedDouble for undefined', () => {
    const Icon = getRoomIconComponent(undefined);
    expect(Icon).toBeDefined();
  });

  it('returns the matching icon for bed-single', () => {
    const Icon = getRoomIconComponent('bed-single');
    expect(Icon).toBeDefined();
  });
});

describe('getRoomIconLabelKey', () => {
  it('returns correct label key for tent', () => {
    expect(getRoomIconLabelKey('tent')).toBe('rooms.icons.tent');
  });

  it('returns default label key for bed-double', () => {
    expect(getRoomIconLabelKey('bed-double')).toBe('rooms.icons.bedDouble');
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
