/**
 * @fileoverview Tests for the TransportIcon component.
 * @module components/shared/__tests__/TransportIcon.test
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/utils';
import { TransportIcon } from '@/components/shared/TransportIcon';
import type { TransportMode } from '@/types';

// ============================================================================
// Tests
// ============================================================================

describe('TransportIcon', () => {
  const modes: TransportMode[] = ['plane', 'train', 'car', 'bus', 'other'];

  it.each(modes)('renders without crashing for mode "%s"', (mode) => {
    const { container } = render(<TransportIcon mode={mode} />, { withProviders: false });
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('defaults to aria-hidden when no aria-label is provided', () => {
    const { container } = render(<TransportIcon mode="train" />, { withProviders: false });
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('is not aria-hidden when aria-label is provided', () => {
    const { container } = render(
      <TransportIcon mode="plane" aria-label="Airplane" />,
      { withProviders: false },
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-label', 'Airplane');
    expect(svg).not.toHaveAttribute('aria-hidden', 'true');
  });

  it('applies additional className', () => {
    const { container } = render(
      <TransportIcon mode="car" className="size-8 text-red-500" />,
      { withProviders: false },
    );
    const svg = container.querySelector('svg');
    expect(svg?.className.baseVal ?? svg?.getAttribute('class') ?? '').toContain('text-red-500');
  });

  it('always includes the default size class', () => {
    const { container } = render(<TransportIcon mode="bus" />, { withProviders: false });
    const svg = container.querySelector('svg');
    const classes = svg?.className.baseVal ?? svg?.getAttribute('class') ?? '';
    expect(classes).toContain('shrink-0');
  });

  it('falls back to User icon for unknown mode', () => {
    const { container } = render(
      <TransportIcon mode={'unknown' as TransportMode} />,
      { withProviders: false },
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
