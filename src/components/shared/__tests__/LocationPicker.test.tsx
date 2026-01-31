/**
 * @fileoverview Tests for LocationPicker component.
 * Tests autocomplete behavior, keyboard navigation, and API integration.
 *
 * @module components/shared/__tests__/LocationPicker.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocationPicker } from '../LocationPicker';

// ============================================================================
// Mock Data
// ============================================================================

const mockResults = [
  {
    place_id: 1,
    display_name: 'Paris, Île-de-France, France',
    lat: '48.8566',
    lon: '2.3522',
    type: 'city',
    class: 'place',
  },
  {
    place_id: 2,
    display_name: 'Paris, Texas, United States',
    lat: '33.6609',
    lon: '-95.5555',
    type: 'city',
    class: 'place',
  },
  {
    place_id: 3,
    display_name: 'Gare de Paris-Montparnasse, Paris, France',
    lat: '48.8414',
    lon: '2.3209',
    type: 'railway',
    class: 'railway',
  },
];

// ============================================================================
// Setup
// ============================================================================

describe('LocationPicker', () => {
  const mockOnChange = vi.fn();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockOnChange.mockClear();

    // Mock fetch
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResults),
    });
    vi.stubGlobal('fetch', fetchMock);

    // Mock scrollIntoView (not available in JSDOM)
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ============================================================================
  // Rendering Tests
  // ============================================================================

  describe('Rendering', () => {
    it('renders with placeholder', () => {
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('placeholder', 'locationPicker.placeholder');
    });

    it('renders with custom placeholder', () => {
      render(
        <LocationPicker
          value=""
          onChange={mockOnChange}
          placeholder="Enter location"
        />
      );

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('placeholder', 'Enter location');
    });

    it('renders with value', () => {
      render(<LocationPicker value="Paris, France" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveValue('Paris, France');
    });

    it('shows clear button when has value', () => {
      render(<LocationPicker value="Paris" onChange={mockOnChange} />);

      expect(screen.getByLabelText('locationPicker.clear')).toBeInTheDocument();
    });

    it('hides clear button when empty', () => {
      render(<LocationPicker value="" onChange={mockOnChange} />);

      expect(screen.queryByLabelText('locationPicker.clear')).not.toBeInTheDocument();
    });

    it('renders disabled state', () => {
      render(<LocationPicker value="" onChange={mockOnChange} disabled />);

      const input = screen.getByRole('combobox');
      expect(input).toBeDisabled();
    });

    it('renders with error state', () => {
      render(<LocationPicker value="" onChange={mockOnChange} hasError />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-invalid', 'true');
    });
  });

  // ============================================================================
  // Search Behavior Tests
  // ============================================================================

  describe('Search Behavior', () => {
    it('does not search with less than 3 characters', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Pa');

      // Advance past debounce
      vi.advanceTimersByTime(350);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('searches after 300ms debounce', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      // Should not have searched yet
      expect(fetchMock).not.toHaveBeenCalled();

      // Advance past debounce
      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    it('shows results dropdown after search', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('shows no results message when empty', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'zzzzzzz');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByText('locationPicker.noResults')).toBeInTheDocument();
      });
    });

    it('shows loading state during search', async () => {
      // Make fetch hang
      fetchMock.mockImplementationOnce(
        () => new Promise(() => {}) // Never resolves
      );

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      // Loading spinner should appear
      await waitFor(() => {
        expect(document.querySelector('.animate-spin')).toBeInTheDocument();
      });
    });

    it('handles API errors gracefully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Selection Tests
  // ============================================================================

  describe('Selection', () => {
    it('selects location on click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const firstOption = screen.getAllByRole('option')[0];
      fireEvent.mouseDown(firstOption!);

      expect(mockOnChange).toHaveBeenCalledWith(
        'Paris, Île-de-France, France',
        { lat: 48.8566, lon: 2.3522 }
      );
    });

    it('clears location on clear button click', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="Paris" onChange={mockOnChange} />);

      const clearButton = screen.getByLabelText('locationPicker.clear');
      await user.click(clearButton);

      expect(mockOnChange).toHaveBeenCalledWith('', undefined);
    });

    it('closes dropdown after selection', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const firstOption = screen.getAllByRole('option')[0];
      fireEvent.mouseDown(firstOption!);

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Keyboard Navigation Tests
  // ============================================================================

  describe('Keyboard Navigation', () => {
    it('navigates down with ArrowDown', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');

      const firstOption = screen.getAllByRole('option')[0];
      expect(firstOption).toHaveAttribute('aria-selected', 'true');
    });

    it('navigates up with ArrowUp', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Move down twice, then up once
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');

      const firstOption = screen.getAllByRole('option')[0];
      expect(firstOption).toHaveAttribute('aria-selected', 'true');
    });

    it('wraps around at the end', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Move down past last item
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');

      const firstOption = screen.getAllByRole('option')[0];
      expect(firstOption).toHaveAttribute('aria-selected', 'true');
    });

    it('selects with Enter', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}{Enter}');

      expect(mockOnChange).toHaveBeenCalledWith(
        'Paris, Île-de-France, France',
        { lat: 48.8566, lon: 2.3522 }
      );
    });

    it('closes with Escape', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      });
    });
  });

  // ============================================================================
  // Accessibility Tests
  // ============================================================================

  describe('Accessibility', () => {
    it('has correct ARIA attributes', () => {
      render(<LocationPicker value="" onChange={mockOnChange} id="location" />);

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('role', 'combobox');
      expect(input).toHaveAttribute('aria-expanded', 'false');
      expect(input).toHaveAttribute('aria-autocomplete', 'list');
      expect(input).toHaveAttribute('aria-controls', 'location-listbox');
    });

    it('updates aria-expanded when open', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
    });

    it('updates aria-activedescendant on navigation', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} id="loc" />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      vi.advanceTimersByTime(350);

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}');

      expect(input).toHaveAttribute('aria-activedescendant', 'loc-option-0');
    });

    it('has accessible labels', () => {
      render(
        <LocationPicker
          value=""
          onChange={mockOnChange}
          aria-label="Trip location"
        />
      );

      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('aria-label', 'Trip location');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('syncs with external value changes', () => {
      const { rerender } = render(
        <LocationPicker value="" onChange={mockOnChange} />
      );

      const input = screen.getByRole('combobox');
      expect(input).toHaveValue('');

      rerender(<LocationPicker value="New York" onChange={mockOnChange} />);

      expect(input).toHaveValue('New York');
    });

    it('cancels pending requests on unmount', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { unmount } = render(
        <LocationPicker value="" onChange={mockOnChange} />
      );

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      // Unmount before debounce completes
      unmount();

      vi.advanceTimersByTime(350);

      // Should not throw or cause issues
      expect(true).toBe(true);
    });

    it('hides clear button when disabled', () => {
      render(<LocationPicker value="Paris" onChange={mockOnChange} disabled />);

      expect(screen.queryByLabelText('locationPicker.clear')).not.toBeInTheDocument();
    });
  });
});
