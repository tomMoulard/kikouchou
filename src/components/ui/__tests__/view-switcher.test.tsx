/**
 * Component tests for ViewSwitcher.
 *
 * Covers the radiogroup semantics that replaced Radix `Tabs` here, the roving
 * tabindex, and arrow-key movement.
 *
 * @module components/ui/__tests__/view-switcher.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ViewSwitcher } from '@/components/ui/view-switcher';

const OPTIONS = [
  { value: 'card', label: 'Month' },
  { value: 'timeline', label: 'Timeline' },
] as const;

function renderSwitcher(value: 'card' | 'timeline', onValueChange = vi.fn()) {
  render(
    <ViewSwitcher
      value={value}
      onValueChange={onValueChange}
      options={[...OPTIONS]}
      ariaLabel="Calendar view"
    />,
  );
  return onValueChange;
}

describe('ViewSwitcher', () => {
  it('exposes a labelled radiogroup', () => {
    renderSwitcher('card');

    expect(screen.getByRole('radiogroup', { name: 'Calendar view' })).toBeInTheDocument();
  });

  it('marks only the selected option as checked', () => {
    renderSwitcher('card');

    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Timeline' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  /**
   * The reason this component exists: Radix `Tabs` put `aria-controls` on every
   * trigger, naming a `TabsContent` panel these pages never rendered, so axe
   * failed them with `aria-valid-attr-value`.
   */
  it('never claims to control a panel', () => {
    renderSwitcher('card');

    for (const option of screen.getAllByRole('radio')) {
      expect(option).not.toHaveAttribute('aria-controls');
    }
  });

  it('keeps one tab stop for the whole group', () => {
    renderSwitcher('timeline');

    expect(screen.getByRole('radio', { name: 'Month' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'Timeline' })).toHaveAttribute('tabindex', '0');
  });

  it('reports the clicked option', async () => {
    const user = userEvent.setup();
    const onValueChange = renderSwitcher('card');

    await user.click(screen.getByRole('radio', { name: 'Timeline' }));

    expect(onValueChange).toHaveBeenCalledWith('timeline');
  });

  it('moves to the next option on ArrowRight', async () => {
    const user = userEvent.setup();
    const onValueChange = renderSwitcher('card');

    await user.click(screen.getByRole('radio', { name: 'Month' }));
    onValueChange.mockClear();
    await user.keyboard('{ArrowRight}');

    expect(onValueChange).toHaveBeenCalledWith('timeline');
  });

  it('wraps around on ArrowLeft from the first option', async () => {
    const user = userEvent.setup();
    const onValueChange = renderSwitcher('card');

    await user.click(screen.getByRole('radio', { name: 'Month' }));
    onValueChange.mockClear();
    await user.keyboard('{ArrowLeft}');

    expect(onValueChange).toHaveBeenCalledWith('timeline');
  });
});
