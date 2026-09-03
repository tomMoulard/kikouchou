/**
 * Component tests for ColorPicker
 *
 * Tests color selection, keyboard navigation, disabled state,
 * custom colors, and accessibility attributes.
 *
 * @module components/shared/__tests__/ColorPicker.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';

import { ColorPicker, DEFAULT_COLORS } from '@/components/shared/ColorPicker';

// ============================================================================
// Basic Rendering Tests
// ============================================================================

describe('ColorPicker Basic Rendering', () => {
  it('renders all default colors', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(DEFAULT_COLORS.length);
  });

  it('renders custom colors when provided', () => {
    const customColors = ['#ff0000', '#00ff00', '#0000ff'];
    const onChange = vi.fn();

    render(<ColorPicker colors={customColors} onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(3);
  });

  it('renders in 4-column grid', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveClass('grid-cols-4');
  });

  it('applies custom className', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} className="custom-class" />, { withProviders: false });

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveClass('custom-class');
  });

  it('renders empty div when colors array is empty', () => {
    const onChange = vi.fn();

    render(<ColorPicker colors={[]} onChange={onChange} />, { withProviders: false });

    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});

// ============================================================================
// Selection Tests
// ============================================================================

describe('ColorPicker Selection', () => {
  it('shows checkmark on selected color', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />, { withProviders: false });

    // Find the selected button
    const selectedButton = screen.getByRole('radio', { checked: true });
    const checkIcon = selectedButton.querySelector('svg');
    expect(checkIcon).toBeInTheDocument();
  });

  it('does not show checkmark on unselected colors', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />, { withProviders: false });

    // Counted rather than looped over: exactly one checkmark exists in the
    // whole group, so a component that ticked every swatch — or none — fails.
    const withCheck = screen
      .getAllByRole('radio')
      .filter((button) => button.querySelector('svg') !== null);

    expect(withCheck).toHaveLength(1);
    expect(withCheck[0]).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange when color clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    await user.click(buttons[0]!);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('has correct aria-checked for selected color', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />, { withProviders: false });

    // Find the blue color button
    const buttons = screen.getAllByRole('radio');
    const blueIndex = DEFAULT_COLORS.indexOf('#3b82f6');
    
    expect(buttons[blueIndex]).toHaveAttribute('aria-checked', 'true');
  });

  it('has aria-checked="false" for unselected colors', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    const blueIndex = DEFAULT_COLORS.indexOf('#3b82f6');

    // A guarded `expect` inside a loop asserts nothing when the guard never
    // opens; the counts pin down that exactly one swatch is checked and every
    // other one carries an explicit `false` rather than no attribute at all.
    const checked = buttons.filter((b) => b.getAttribute('aria-checked') === 'true');
    const unchecked = buttons.filter((b) => b.getAttribute('aria-checked') === 'false');

    expect(checked).toHaveLength(1);
    expect(unchecked).toHaveLength(DEFAULT_COLORS.length - 1);
    expect(checked[0]).toBe(buttons[blueIndex]);
  });

  it('handles case-insensitive color matching', () => {
    const onChange = vi.fn();

    // Uppercase hex should still match
    render(<ColorPicker value="#EF4444" onChange={onChange} />, { withProviders: false });

    // Which swatch matters: "something is checked" would also pass if the
    // lowercasing picked the wrong entry in the palette.
    const buttons = screen.getAllByRole('radio');
    const selectedButton = screen.getByRole('radio', { checked: true });

    expect(buttons.indexOf(selectedButton)).toBe(DEFAULT_COLORS.indexOf('#ef4444'));
  });
});

// ============================================================================
// Keyboard Navigation Tests
// ============================================================================

describe('ColorPicker Keyboard Navigation', () => {
  it('moves focus right with ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[1]);
  });

  it('moves focus left with ArrowLeft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value={DEFAULT_COLORS[1]} onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[1]!.focus();
    
    await user.keyboard('{ArrowLeft}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('moves focus down with ArrowDown', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('{ArrowDown}');

    // Grid is 4 columns, so down should go to index 4
    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[4]);
  });

  it('wraps ArrowDown past the last row back to the top', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // 12 colours in a 4-wide grid: index 8 is the last row, and +4 must wrap
    // to 0 rather than run off the end.
    const lastRowIndex = DEFAULT_COLORS.length - 4;

    render(<ColorPicker value={DEFAULT_COLORS[lastRowIndex]} onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[lastRowIndex]!.focus();

    await user.keyboard('{ArrowDown}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('wraps ArrowUp from the first row round to the last', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value={DEFAULT_COLORS[0]} onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();

    await user.keyboard('{ArrowUp}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[DEFAULT_COLORS.length - 4]);
  });

  it('starts navigation at the first colour when nothing is selected', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    // `selectedIndex` is -1 here; the handler treats that as index 0.
    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    screen.getAllByRole('radio')[0]!.focus();

    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[1]);
  });

  it('moves focus up with ArrowUp', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value={DEFAULT_COLORS[4]} onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[4]!.focus();
    
    await user.keyboard('{ArrowUp}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('wraps from end to start with ArrowRight', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const lastIndex = DEFAULT_COLORS.length - 1;

    render(<ColorPicker value={DEFAULT_COLORS[lastIndex]} onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[lastIndex]!.focus();
    
    await user.keyboard('{ArrowRight}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[0]);
  });

  it('wraps from start to end with ArrowLeft', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const lastIndex = DEFAULT_COLORS.length - 1;

    render(<ColorPicker value="#ef4444" onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('{ArrowLeft}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[lastIndex]);
  });

  it('selects color with Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[2]!.focus();
    
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith(DEFAULT_COLORS[2]);
  });

  it('ignores unhandled keyboard keys (default branch)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons[0]!.focus();
    
    await user.keyboard('a');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects color with Space', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

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

    render(<ColorPicker onChange={onChange} disabled />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    await user.click(buttons[0]!);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('has disabled attribute on buttons when disabled', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} disabled />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons.forEach((button) => {
      expect(button).toBeDisabled();
    });
  });

  it('does not respond to keyboard navigation when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(<ColorPicker value="#ef4444" onChange={onChange} disabled />, { withProviders: false });

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

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('has aria-label', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} label="Choose a color" />, { withProviders: false });

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveAttribute('aria-label', 'Choose a color');
  });

  it('uses default label when not provided', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const radiogroup = screen.getByRole('radiogroup');
    expect(radiogroup).toHaveAttribute('aria-label', 'Color selection');
  });

  it('selected color has tabIndex=0', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />, { withProviders: false });

    const selectedButton = screen.getByRole('radio', { checked: true });
    expect(selectedButton).toHaveAttribute('tabIndex', '0');
  });

  it('unselected colors have tabIndex=-1', () => {
    const onChange = vi.fn();

    render(<ColorPicker value="#3b82f6" onChange={onChange} />, { withProviders: false });

    // Roving tabindex has two halves and both matter: exactly one tab stop in
    // the group, AND an explicit -1 on the rest. Counting the 0s alone lets an
    // absent attribute through, which is a natural tab stop — 12 of them.
    const buttons = screen.getAllByRole('radio'),
     tabbable = buttons.filter((button) => button.getAttribute('tabIndex') === '0');

    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute('aria-checked', 'true');

    for (const button of buttons.filter((b) => b !== tabbable[0])) {
      expect(button).toHaveAttribute('tabIndex', '-1');
    }
  });

  it('first color has tabIndex=0 when no selection', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveAttribute('tabIndex', '0');
  });

  it('names each swatch with that colour, not just with something', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    // A bare `toHaveAttribute('aria-label')` passes when every swatch is
    // labelled "Custom color", which is what a broken `getColorKey` produces —
    // twelve identically-named radios in one group.
    const labels = screen
      .getAllByRole('radio')
      .map((button) => button.getAttribute('aria-label'));

    expect(labels).toEqual([
      'colors.red',
      'colors.orange',
      'colors.amber',
      'colors.yellow',
      'colors.lime',
      'colors.green',
      'colors.teal',
      'colors.cyan',
      'colors.blue',
      'colors.indigo',
      'colors.violet',
      'colors.pink',
    ]);
  });

  it('falls back to a generic name for a colour outside the palette', () => {
    const onChange = vi.fn();

    render(<ColorPicker colors={['#123456']} onChange={onChange} />, { withProviders: false });

    expect(screen.getByRole('radio')).toHaveAttribute(
      'aria-label',
      'colors.custom'
    );
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

    render(<ColorPicker colors={customColors} onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    expect(buttons).toHaveLength(2);

    await user.click(buttons[0]!);
    expect(onChange).toHaveBeenCalledWith('#123456');
  });

  it('applies custom color as background', () => {
    const onChange = vi.fn();
    const customColors = ['#abcdef'];

    render(<ColorPicker colors={customColors} onChange={onChange} />, { withProviders: false });

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

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    expect(buttons[0]).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  it('shows hover scale on non-disabled buttons', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} />, { withProviders: false });

    const buttons = screen.getAllByRole('radio');
    buttons.forEach((button) => {
      expect(button).toHaveClass('hover:scale-110');
    });
  });

  it('disabled buttons are disabled and cancel the hover scale', () => {
    const onChange = vi.fn();

    render(<ColorPicker onChange={onChange} disabled />, { withProviders: false });

    // The `disabled:` variant only does anything on a natively disabled
    // element, so the class alone — which is emitted unconditionally — says
    // nothing without the `disabled` half.
    const buttons = screen.getAllByRole('radio');
    for (const button of buttons) {
      expect(button).toBeDisabled();
      expect(button).toHaveClass('disabled:hover:scale-100');
    }
  });
});
