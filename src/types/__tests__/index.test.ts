/**
 * Unit tests for type utilities in src/types/index.ts
 *
 * Tests the DEFAULT_PERSON_COLORS constant and getDefaultPersonColor function
 * that provides cyclic color assignment for trip participants.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_PERSON_COLORS, getDefaultPersonColor } from '../index';

// Shared regex pattern for hex color validation
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// ============================================================================
// DEFAULT_PERSON_COLORS Constant Tests
// ============================================================================

describe('DEFAULT_PERSON_COLORS', () => {
  it('contains exactly 8 colors', () => {
    expect(DEFAULT_PERSON_COLORS).toHaveLength(8);
  });

  it('contains valid hex color formats (#RRGGBB)', () => {
    for (const color of DEFAULT_PERSON_COLORS) {
      expect(color).toMatch(HEX_COLOR_PATTERN);
    }
  });

  it('has expected color values in order', () => {
    // Verify the exact palette order
    expect(DEFAULT_PERSON_COLORS).toEqual([
      '#ef4444', // Red
      '#f97316', // Orange
      '#eab308', // Yellow
      '#22c55e', // Green
      '#14b8a6', // Teal
      '#3b82f6', // Blue
      '#8b5cf6', // Violet
      '#ec4899', // Pink
    ]);
  });

  it('starts with Red (#ef4444)', () => {
    expect(DEFAULT_PERSON_COLORS[0]).toBe('#ef4444');
  });

  it('ends with Pink (#ec4899)', () => {
    expect(DEFAULT_PERSON_COLORS[7]).toBe('#ec4899');
  });

  it('is a readonly array (TypeScript enforced at compile time)', () => {
    // This test documents the readonly nature - actual enforcement is at compile time
    // The `as const satisfies readonly HexColor[]` ensures TypeScript immutability
    // Note: `as const` does NOT freeze the array at runtime - it's compile-time only
    expect(Array.isArray(DEFAULT_PERSON_COLORS)).toBe(true);
    // Verify it's an array of strings (runtime type check)
    expect(
      DEFAULT_PERSON_COLORS.every((color) => typeof color === 'string')
    ).toBe(true);
  });
});

// ============================================================================
// getDefaultPersonColor Function Tests
// ============================================================================

describe('getDefaultPersonColor', () => {
  describe('basic index access (0-7)', () => {
    it('returns Red (#ef4444) for index 0', () => {
      expect(getDefaultPersonColor(0)).toBe('#ef4444');
    });

    it('returns Orange (#f97316) for index 1', () => {
      expect(getDefaultPersonColor(1)).toBe('#f97316');
    });

    it('returns Yellow (#eab308) for index 2', () => {
      expect(getDefaultPersonColor(2)).toBe('#eab308');
    });

    it('returns Green (#22c55e) for index 3', () => {
      expect(getDefaultPersonColor(3)).toBe('#22c55e');
    });

    it('returns Teal (#14b8a6) for index 4', () => {
      expect(getDefaultPersonColor(4)).toBe('#14b8a6');
    });

    it('returns Blue (#3b82f6) for index 5', () => {
      expect(getDefaultPersonColor(5)).toBe('#3b82f6');
    });

    it('returns Violet (#8b5cf6) for index 6', () => {
      expect(getDefaultPersonColor(6)).toBe('#8b5cf6');
    });

    it('returns Pink (#ec4899) for index 7', () => {
      expect(getDefaultPersonColor(7)).toBe('#ec4899');
    });

    it('returns colors matching the palette for all indices 0-7', () => {
      for (let i = 0; i < DEFAULT_PERSON_COLORS.length; i++) {
        expect(getDefaultPersonColor(i)).toBe(DEFAULT_PERSON_COLORS[i]);
      }
    });
  });

  describe('returns colors cyclically based on index', () => {
    it('wraps to index 0 when index equals palette length (8)', () => {
      expect(getDefaultPersonColor(8)).toBe('#ef4444'); // Same as index 0
    });

    it('wraps to index 1 when index is 9', () => {
      expect(getDefaultPersonColor(9)).toBe('#f97316'); // Same as index 1
    });

    it('wraps to index 0 when index is 16 (2 full cycles)', () => {
      expect(getDefaultPersonColor(16)).toBe('#ef4444'); // Same as index 0
    });

    it('wraps to index 7 when index is 15', () => {
      expect(getDefaultPersonColor(15)).toBe('#ec4899'); // Same as index 7
    });

    it('wraps to index 7 when index is 23', () => {
      expect(getDefaultPersonColor(23)).toBe('#ec4899'); // Same as index 7
    });

    it('handles multiple full cycles correctly', () => {
      // Test 10 full cycles
      for (let cycle = 0; cycle < 10; cycle++) {
        for (let i = 0; i < 8; i++) {
          const index = cycle * 8 + i;
          expect(getDefaultPersonColor(index)).toBe(DEFAULT_PERSON_COLORS[i]);
        }
      }
    });
  });

  describe('handles negative indices using Math.abs (NOT Python-style negative indexing)', () => {
    // NOTE: This implementation uses Math.abs(), so -1 maps to index 1, NOT index 7.
    // This differs from Python where -1 means "last element".
    // The behavior is intentional: negative indices represent "distance from zero".

    it('returns Orange (#f97316) for index -1 (Math.abs(-1) = 1)', () => {
      // Math.abs(-1) % 8 = 1
      expect(getDefaultPersonColor(-1)).toBe('#f97316');
    });

    it('returns Red (#ef4444) for index -8 (Math.abs(-8) % 8 = 0)', () => {
      // Math.abs(-8) % 8 = 0
      expect(getDefaultPersonColor(-8)).toBe('#ef4444');
    });

    it('returns Orange (#f97316) for index -9 (Math.abs(-9) % 8 = 1)', () => {
      // Math.abs(-9) % 8 = 1
      expect(getDefaultPersonColor(-9)).toBe('#f97316');
    });

    it('returns correct color for various negative indices', () => {
      // Test a range of negative indices
      const testCases: Array<{ index: number; expectedIndex: number }> = [
        { index: -1, expectedIndex: 1 },
        { index: -2, expectedIndex: 2 },
        { index: -7, expectedIndex: 7 },
        { index: -8, expectedIndex: 0 },
        { index: -15, expectedIndex: 7 },
        { index: -16, expectedIndex: 0 },
        { index: -100, expectedIndex: 4 }, // Math.abs(-100) % 8 = 4
      ];

      for (const { index, expectedIndex } of testCases) {
        expect(getDefaultPersonColor(index)).toBe(
          DEFAULT_PERSON_COLORS[expectedIndex]
        );
      }
    });

    it('handles -0 same as 0', () => {
      // JavaScript treats -0 and 0 as equal
      expect(getDefaultPersonColor(-0)).toBe(getDefaultPersonColor(0));
      expect(getDefaultPersonColor(-0)).toBe('#ef4444');
    });
  });

  describe('handles index larger than palette size', () => {
    it('handles large index values correctly', () => {
      // Test some large indices
      expect(getDefaultPersonColor(100)).toBe(
        DEFAULT_PERSON_COLORS[100 % 8]
      ); // 100 % 8 = 4
      expect(getDefaultPersonColor(1000)).toBe(
        DEFAULT_PERSON_COLORS[1000 % 8]
      ); // 1000 % 8 = 0
      expect(getDefaultPersonColor(12345)).toBe(
        DEFAULT_PERSON_COLORS[12345 % 8]
      ); // 12345 % 8 = 1
    });

    it('handles Number.MAX_SAFE_INTEGER correctly', () => {
      // Number.MAX_SAFE_INTEGER % 8 = 7
      const result = getDefaultPersonColor(Number.MAX_SAFE_INTEGER);
      expect(result).toBe(DEFAULT_PERSON_COLORS[7]); // Pink
    });

    it('handles Number.MIN_SAFE_INTEGER correctly', () => {
      // Math.abs(Number.MIN_SAFE_INTEGER) % 8 = 7
      const result = getDefaultPersonColor(Number.MIN_SAFE_INTEGER);
      expect(result).toBe(DEFAULT_PERSON_COLORS[7]); // Pink
    });

    it('handles very large negative numbers correctly', () => {
      // Test large negative numbers
      const largeNegative = -1000000;
      const expectedIndex = Math.abs(largeNegative) % 8; // 0
      expect(getDefaultPersonColor(largeNegative)).toBe(
        DEFAULT_PERSON_COLORS[expectedIndex]
      );
    });
  });

  describe('return type and value validation', () => {
    it('always returns a valid hex color string', () => {
      // Test a variety of indices including boundaries and edge cases
      const testIndices = [
        0, 1, 7, 8, 15, 16, 100, -1, -8, -100,
        Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
      ];

      for (const index of testIndices) {
        const result = getDefaultPersonColor(index);
        expect(typeof result).toBe('string');
        expect(result).toMatch(HEX_COLOR_PATTERN);
      }
    });

    it('returns a string (HexColor type)', () => {
      const result = getDefaultPersonColor(0);
      expect(typeof result).toBe('string');
      expect(result).toHaveLength(7); // #RRGGBB = 7 characters
    });

    it('never returns undefined for valid integer inputs', () => {
      // This is the main purpose of the function - to avoid undefined with noUncheckedIndexedAccess
      // Test targeted edge cases rather than exhaustive iteration
      const testIndices = [
        -100, -9, -8, -1, 0, 1, 7, 8, 15, 16, 100,
        Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
      ];

      for (const index of testIndices) {
        expect(getDefaultPersonColor(index)).toBeDefined();
      }
    });
  });

  describe('edge cases', () => {
    it('handles 0 correctly', () => {
      expect(getDefaultPersonColor(0)).toBe('#ef4444');
    });

    it('handles the boundary between last and first color (7 to 8)', () => {
      expect(getDefaultPersonColor(7)).toBe('#ec4899'); // Last color (Pink)
      expect(getDefaultPersonColor(8)).toBe('#ef4444'); // Wraps to first (Red)
    });

    it('handles decimal numbers by implicit truncation', () => {
      // JavaScript modulo with non-integers may produce unexpected results
      // but Math.abs handles this by preserving the decimal
      // The modulo then produces a decimal which is used for array access
      // Due to array index coercion, this effectively truncates

      // Note: This tests the actual behavior, not necessarily the intended behavior
      // In practice, the function should only be called with integers
      expect(getDefaultPersonColor(0.5)).toBe(
        DEFAULT_PERSON_COLORS[Math.abs(0.5) % 8]
      );
      expect(getDefaultPersonColor(1.9)).toBe(
        DEFAULT_PERSON_COLORS[Math.abs(1.9) % 8]
      );
    });
  });
});
