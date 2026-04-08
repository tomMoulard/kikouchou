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
});
