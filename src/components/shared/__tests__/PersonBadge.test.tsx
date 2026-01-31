/**
 * Component tests for PersonBadge
 *
 * Tests badge rendering, color handling, contrast calculation,
 * and interactive behavior.
 *
 * @module components/shared/__tests__/PersonBadge.test
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PersonBadge } from '@/components/shared/PersonBadge';
import type { Person, PersonId, TripId } from '@/types';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Creates a test person object with optional overrides.
 */
function createTestPerson(overrides?: Partial<Person>): Person {
  return {
    id: 'person-1' as PersonId,
    tripId: 'trip-1' as TripId,
    name: 'Test Person',
    color: '#3b82f6', // Blue
    ...overrides,
  };
}

// ============================================================================
// Rendering Tests
// ============================================================================

describe('PersonBadge Rendering', () => {
  it('renders person name from Person object', () => {
    const person = createTestPerson({ name: 'Alice' });

    render(<PersonBadge person={person} />);

    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders person name from individual props', () => {
    render(<PersonBadge name="Bob" color="#ef4444" />);

    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('applies background color from person', () => {
    const person = createTestPerson({ color: '#ef4444' });

    render(<PersonBadge person={person} />);

    const badge = screen.getByText(person.name);
    expect(badge).toHaveStyle({ backgroundColor: '#ef4444' });
  });

  it('applies background color from individual props', () => {
    render(<PersonBadge name="Test" color="#22c55e" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ backgroundColor: '#22c55e' });
  });

  it('applies custom className', () => {
    render(<PersonBadge name="Test" color="#000" className="custom-class" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveClass('custom-class');
  });
});

// ============================================================================
// Size Variant Tests
// ============================================================================

describe('PersonBadge Size Variants', () => {
  it('applies default size classes', () => {
    render(<PersonBadge name="Test" color="#000" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveClass('text-sm');
    expect(badge).toHaveClass('px-2.5');
    expect(badge).toHaveClass('py-0.5');
  });

  it('applies small size classes', () => {
    render(<PersonBadge name="Test" color="#000" size="sm" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveClass('text-xs');
    expect(badge).toHaveClass('px-1.5');
    expect(badge).toHaveClass('py-0');
  });
});

// ============================================================================
// Text Color Contrast Tests
// ============================================================================

describe('PersonBadge Contrast Calculation', () => {
  it('uses dark text for light backgrounds', () => {
    // White background should have black text
    render(<PersonBadge name="Test" color="#ffffff" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ color: '#000000' });
  });

  it('uses light text for dark backgrounds', () => {
    // Black background should have white text
    render(<PersonBadge name="Test" color="#000000" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ color: '#FFFFFF' });
  });

  it('uses dark text for yellow background (high luminance)', () => {
    // Yellow is bright, should have dark text
    render(<PersonBadge name="Test" color="#ffff00" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ color: '#000000' });
  });

  it('uses light text for dark blue background', () => {
    // Dark blue should have white text
    render(<PersonBadge name="Test" color="#1e3a5f" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ color: '#FFFFFF' });
  });

  it('handles 3-character hex colors', () => {
    // #fff should expand to #ffffff (white)
    render(<PersonBadge name="Test" color="#fff" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ color: '#000000' }); // Dark text on white
  });

  it('handles hex colors without # prefix', () => {
    render(<PersonBadge name="Test" color="000000" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ color: '#FFFFFF' }); // White text on black
  });

  it('handles 8-character hex colors (with alpha)', () => {
    // Strip alpha channel and use the RGB
    render(<PersonBadge name="Test" color="#000000ff" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ color: '#FFFFFF' }); // White text on black
  });
});

// ============================================================================
// Invalid Color Handling Tests
// ============================================================================

describe('PersonBadge Invalid Color Handling', () => {
  it('falls back to gray for invalid hex color', () => {
    render(<PersonBadge name="Test" color="not-a-color" />);

    const badge = screen.getByText('Test');
    // Should use fallback color #6B7280 (gray)
    expect(badge).toHaveStyle({ backgroundColor: '#6B7280' });
  });

  it('falls back to gray for empty string', () => {
    render(<PersonBadge name="Test" color="" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ backgroundColor: '#6B7280' });
  });

  it('falls back to gray for partial hex', () => {
    render(<PersonBadge name="Test" color="#ab" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveStyle({ backgroundColor: '#6B7280' });
  });
});

// ============================================================================
// Interactive Behavior Tests
// ============================================================================

describe('PersonBadge Interactive Behavior', () => {
  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<PersonBadge name="Test" color="#000" onClick={onClick} />);

    const badge = screen.getByText('Test');
    await user.click(badge);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Enter key press', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<PersonBadge name="Test" color="#000" onClick={onClick} />);

    const badge = screen.getByText('Test');
    badge.focus();
    await user.keyboard('{Enter}');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('calls onClick on Space key press', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<PersonBadge name="Test" color="#000" onClick={onClick} />);

    const badge = screen.getByText('Test');
    badge.focus();
    await user.keyboard(' ');

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has cursor-pointer class when interactive', () => {
    const onClick = vi.fn();

    render(<PersonBadge name="Test" color="#000" onClick={onClick} />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveClass('cursor-pointer');
  });

  it('is focusable when interactive', () => {
    const onClick = vi.fn();

    render(<PersonBadge name="Test" color="#000" onClick={onClick} />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveAttribute('tabIndex', '0');
  });

  it('is not focusable when not interactive', () => {
    render(<PersonBadge name="Test" color="#000" />);

    const badge = screen.getByText('Test');
    expect(badge).not.toHaveAttribute('tabIndex');
  });
});

// ============================================================================
// Accessibility Tests
// ============================================================================

describe('PersonBadge Accessibility', () => {
  it('has role="button" when interactive', () => {
    const onClick = vi.fn();

    render(<PersonBadge name="Test" color="#000" onClick={onClick} />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveAttribute('role', 'button');
  });

  it('has role="status" when not interactive', () => {
    render(<PersonBadge name="Test" color="#000" />);

    const badge = screen.getByText('Test');
    expect(badge).toHaveAttribute('role', 'status');
  });

  it('has aria-label when interactive', () => {
    const onClick = vi.fn();

    render(<PersonBadge name="Alice" color="#000" onClick={onClick} />);

    const badge = screen.getByText('Alice');
    expect(badge).toHaveAttribute('aria-label', 'Alice - click to interact');
  });

  it('has no aria-label when not interactive', () => {
    render(<PersonBadge name="Test" color="#000" />);

    const badge = screen.getByText('Test');
    expect(badge).not.toHaveAttribute('aria-label');
  });
});

// ============================================================================
// Person Object vs Individual Props Tests
// ============================================================================

describe('PersonBadge Prop Patterns', () => {
  it('prefers Person object over individual props', () => {
    const person = createTestPerson({ name: 'From Person', color: '#ff0000' });

    // TypeScript would prevent this, but testing defensive behavior
    render(<PersonBadge person={person} />);

    expect(screen.getByText('From Person')).toBeInTheDocument();
    expect(screen.getByText('From Person')).toHaveStyle({ backgroundColor: '#ff0000' });
  });

  it('renders empty name gracefully', () => {
    const person = createTestPerson({ name: '' });

    render(<PersonBadge person={person} />);

    // Badge should render but be empty
    const badge = screen.getByRole('status');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('');
  });
});
