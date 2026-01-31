/**
 * Component tests for ColorPicker
 *
 * Tests color selection, keyboard navigation, disabled state,
 * custom colors, and accessibility attributes.
 *
 * @module components/shared/__tests__/ColorPicker.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ColorPicker, DEFAULT_COLORS } from '@/components/shared/ColorPicker';

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('ColorPicker Basic Rendering', () => {
  it('renders all default colors', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(DEFAULT_COLORS.length);
  });

  it('renders custom colors when provided', () => {
    const customColors = ['#ff0000', '#00ff00', '#0000ff'];
    const onChange = vi.fn();

    render(<ColorPicker colors={customColors} onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(3);
  });

  it('renders in 4-column grid', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveClass('grid-cols-4');
  });

  it('applies custom className', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} className="custom-class" />);

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveClass('custom-class');
  });

  it('renders empty div when colors array is empty', () => {
    const onChange = vi.fn();

    render(<ColorPicker colors={[]} onChange={onChange} />);

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Selection Tests
// ============================================================================

describe('ColorPicker Selection', () => {
  it('shows checkmark on selected color', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />);

    // Find the selected button
    const selectedButton = screen.getByRole('radio', { checked: true });
    const checkIcon = selectedButton.querySelector('svg');
    expect(checkIcon).toBeInTheDocument();
  });

  it('does not show checkmark on unselected colors', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />);

    // Get all unselected buttons
    const unselectedButtons = screen.getAllByRole('radio', { checked: false });
    unselectedButtons.forEach((button) => {
      const checkIcon = button.querySelector('svg');
      expect(checkIcon).not.toBeInTheDocument();
    });
  });

  it('calls onChange when color clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    await user.click(buttons[0]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('has correct aria-checked for selected color', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />);

    // Find the blue color button
    const buttons = screen.getAllByRole('radio');
    const blueIndex = DEFAULT_COLORS.indexOf('#3b82f6');
    
    expect(buttons[blueIndex]).toHaveAttribute('aria-checked', 'true');
  });

  it('has aria-checked="false" for unselected colors', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    const blueIndex = DEFAULT_COLORS.indexOf('#3b82f6');
    
    buttons.forEach((button, index) => {
      if (index !== blueIndex) {
        expect(button).toHaveAttribute('aria-checked', 'false');
      }
    });
  });

  it('handles case-insensitive color matching', () => {
    const onChange = vi.fn();

    // Uppercase hex should still match
    render(<ColorPicker value="#EF4444" onChange={onChange} />);

    const selectedButton = screen.getByRole('radio', { checked: true });
    expect(selectedButton).toBeInTheDocument();
  });
});

// ============================================================================
// Keyboard Navigation Tests
// ============================================================================

describe('ColorPicker Keyboard Navigation', () => {
  it('moves focus right with ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[1]);
  });

  it('moves focus left with ArrowLeft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value={DEFAULT_COLORS[1]} onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[1]!.focus();
    
    await user.keyboard('{ArrowLeft}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('moves focus down with ArrowDown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('{ArrowDown}');

    // Grid is 4 columns, so down should go to index 4
    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[4]);
  });

  it('moves focus up with ArrowUp', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value={DEFAULT_COLORS[4]} onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[4]!.focus();
    
    await user.keyboard('{ArrowUp}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('wraps from end to start with ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const lastIndex = DEFAULT_COLORS.length - 1;

    render(<ColorPicker value={DEFAULT_COLORS[lastIndex]} onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[lastIndex]!.focus();
    
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('wraps from start to end with ArrowLeft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const lastIndex = DEFAULT_COLORS.length - 1;

    render(<ColorPicker value="#ef4444" onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('{ArrowLeft}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[lastIndex]);
  });

  it('selects color with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[2]!.focus();
    
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[2]);
  });

  it('selects color with Space', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons[3]!.focus();
    
    await user.keyboard(' ');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[3]);
  });
});

// ============================================================================
// Disabled State Tests
// ============================================================================

describe('ColorPicker Disabled State', () => {
  it('does not call onChange when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} disabled />);

    const buttons = screen.getAllByRole('radio');
    await user.click(buttons[0]!);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('has disabled attribute on buttons when disabled', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} disabled />);

    const buttons = screen.getAllByRole('radio');
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it('does not respond to keyboard navigation when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} disabled />);

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('{ArrowRight}');

    expect(onChange).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('ColorPicker Accessibility', () => {
  it('has role="radiogroup"', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('has aria-label', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} label="Choose a color" />);

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveAttribute('aria-label', 'Choose a color');
  });

  it('uses default label when not provided', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveAttribute('aria-label', 'Color selection');
  });

  it('each color button has role="radio"', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('selected color has tabIndex=0', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />);

    const selectedButton = screen.getByRole('radio', { checked: true });
    expect(selectedButton).toHaveAttribute('tabIndex', '0');
  });

  it('unselected colors have tabIndex=-1', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />);

    const unselectedButtons = screen.getAllByRole('radio', { checked: false });
    unselectedButtons.forEach((button) => {
      expect(button).toHaveAttribute('tabIndex', '-1');
    });
  });

  it('first color has tabIndex=0 when no selection', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveAttribute('tabIndex', '0');
  });

  it('color buttons have aria-label for screen readers', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons.forEach((button) => {
      expect(button).toHaveAttribute('aria-label');
    });
  });
});

// ============================================================================
// Custom Colors Tests
// ============================================================================

describe('ColorPicker Custom Colors', () => {
  it('uses custom colors when provided', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const customColors = ['#123456', '#654321'];

    render(<ColorPicker colors={customColors} onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(2);

    await user.click(buttons[0]!);
    expect(onChange).toHaveBeenCalledWith('#123456');
  });

  it('applies custom color as background', () => {
    const onChange = vi.fn();
    const customColors = ['#abcdef'];

    render(<ColorPicker colors={customColors} onChange={onChange} />);

    const button = screen.getByRole('radio');
    expect(button).toHaveStyle({ backgroundColor: '#abcdef' });
  });
});

// ============================================================================
// Visual Tests
// ============================================================================

describe('ColorPicker Visual', () => {
  it('applies background color to button', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  it('shows hover scale on non-disabled buttons', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />);

    const buttons = screen.getAllByRole('radio');
    buttons.forEach((button) => {
      expect(button).toHaveClass('hover:scale-110');
    });
  });

  it('disabled buttons do not scale on hover', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} disabled />);

    const buttons = screen.getAllByRole('radio');
    buttons.forEach((button) => {
      expect(button).toHaveClass('disabled:hover:scale-100');
    });
  });
});
