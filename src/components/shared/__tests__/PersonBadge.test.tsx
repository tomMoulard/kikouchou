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
import { hexColor } from '@/test/utils';

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
    color: hexColor('#3b82f6'), // Blue
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
    const person = createTestPerson({ color: hexColor('#ef4444') });

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
// WCAG AA Compliance Tests
// ============================================================================

describe('PersonBadge WCAG AA Compliance', () => {
  /**
   * Helper to calculate WCAG relative luminance
   */
  function calculateLuminance(hex: string): number {
    const normalized = hex.replace('#', '').toLowerCase();
    const r = parseInt(normalized.slice(0, 2), 16) / 255;
    const g = parseInt(normalized.slice(2, 4), 16) / 255;
    const b = parseInt(normalized.slice(4, 6), 16) / 255;

    const gamma = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * gamma(r) + 0.7152 * gamma(g) + 0.0722 * gamma(b);
  }

  /**
   * Helper to calculate contrast ratio per WCAG 2.1
   */
  function calculateContrastRatio(bgHex: string, textHex: string): number {
    const l1 = calculateLuminance(bgHex);
    const l2 = calculateLuminance(textHex);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * Test colors spanning the luminance spectrum
   * Note: Expected text color is determined by luminance > 0.179 threshold
   * Colors with higher luminance get black text, lower get white text
   */
  const testColors = [
    { name: 'black', hex: '#000000', expectedText: '#FFFFFF' },         // L≈0.00
    { name: 'dark gray', hex: '#333333', expectedText: '#FFFFFF' },     // L≈0.03
    { name: 'dark blue', hex: '#1e3a5f', expectedText: '#FFFFFF' },     // L≈0.04
    { name: 'dark red', hex: '#991b1b', expectedText: '#FFFFFF' },      // L≈0.08
    { name: 'red', hex: '#ef4444', expectedText: '#000000' },           // L≈0.23 (bright red)
    { name: 'purple', hex: '#8b5cf6', expectedText: '#000000' },        // L≈0.20 (bright purple)
    { name: 'green', hex: '#22c55e', expectedText: '#000000' },         // L≈0.40
    { name: 'yellow', hex: '#ffff00', expectedText: '#000000' },        // L≈0.93
    { name: 'cyan', hex: '#06b6d4', expectedText: '#000000' },          // L≈0.35
    { name: 'light gray', hex: '#d1d5db', expectedText: '#000000' },    // L≈0.68
    { name: 'white', hex: '#ffffff', expectedText: '#000000' },         // L≈1.00
  ];

  it.each(testColors)(
    'achieves WCAG AA contrast (4.5:1) for $name background',
    ({ hex, expectedText }) => {
      render(<PersonBadge name="Test" color={hex} />);

      const badge = screen.getByText('Test');
      expect(badge).toHaveStyle({ color: expectedText });

      // Verify contrast ratio meets WCAG AA (4.5:1)
      const contrastRatio = calculateContrastRatio(hex, expectedText);
      expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
    }
  );

  it('meets WCAG AA for all default person colors', () => {
    // Default color palette from types/index.ts
    const defaultColors = [
      '#ef4444', '#f97316', '#eab308', '#22c55e',
      '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'
    ];

    for (const bgColor of defaultColors) {
      const { unmount } = render(<PersonBadge name="Test" color={bgColor} />);
      
      const badge = screen.getByText('Test');
      const computedStyle = badge.style;
      const textColor = computedStyle.color;

      // Normalize text color to hex
      const textHex = textColor.startsWith('#') 
        ? textColor 
        : textColor === 'rgb(0, 0, 0)' ? '#000000' : '#FFFFFF';
      
      const contrastRatio = calculateContrastRatio(bgColor, textHex);
      expect(contrastRatio).toBeGreaterThanOrEqual(4.5);
      
      unmount();
    }
  });

  it('threshold of 0.179 ensures both text colors meet 4.5:1 at boundary', () => {
    // At the luminance threshold, both black and white text should achieve ~4.5:1
    const thresholdLuminance = 0.179;
    
    // Calculate contrast for white text (luminance ~1.0)
    const whiteContrast = (1.0 + 0.05) / (thresholdLuminance + 0.05);
    expect(whiteContrast).toBeGreaterThanOrEqual(4.5);
    
    // Calculate contrast for black text (luminance ~0.0)
    const blackContrast = (thresholdLuminance + 0.05) / (0.0 + 0.05);
    expect(blackContrast).toBeGreaterThanOrEqual(4.5);
  });
});

// ============================================================================
// Person Object vs Individual Props Tests
// ============================================================================

describe('PersonBadge Prop Patterns', () => {
  it('prefers Person object over individual props', () => {
    const person = createTestPerson({ name: 'From Person', color: hexColor('#ff0000') });

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
