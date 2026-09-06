/**
 * @fileoverview Tests for LocationPicker component.
 * Tests autocomplete behavior, keyboard navigation, and API integration.
 *
 * @module components/shared/__tests__/LocationPicker.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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
      await act(() => { vi.advanceTimersByTime(350); });

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
      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    it('shows results dropdown after search', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Three places, plus the "use what I typed" row that always closes the
      // list — a place the geocoder does not know is still enterable.
      expect(screen.getAllByRole('option')).toHaveLength(4);
      expect(screen.getByText('locationPicker.useTyped')).toBeInTheDocument();
    });

    it('offers the typed text when the geocoder knows nothing', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'zzzzzzz');

      await act(() => { vi.advanceTimersByTime(350); });

      // "No locations found" used to be the whole answer here, and it was a
      // dead end: `onChange` fired only on a confirmed result, so a place the
      // geocoder does not know could not be entered at all.
      await waitFor(() => {
        expect(screen.getByText('locationPicker.useTyped')).toBeInTheDocument();
      });
      expect(screen.queryByText('locationPicker.noResults')).not.toBeInTheDocument();
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

      await act(() => { vi.advanceTimersByTime(350); });

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

      await act(async () => {
        vi.advanceTimersByTime(350);
        // Flush the fetch promise chain so all state updates land inside act
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'locationPicker.searchError'
        );
      });

    });

    it('closes an open dropdown when the next search fails', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');

      // First search succeeds, so there is a dropdown on screen to go stale.
      // Without this the `setIsOpen(false)` in the catch branch is unreachable:
      // `isOpen` is false from initial state, and asserting it stays false
      // proves nothing.
      await user.type(input, 'Paris');
      await act(() => { vi.advanceTimersByTime(350); });
      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Second search fails.
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
      await user.type(input, 'x');
      await act(async () => {
        vi.advanceTimersByTime(350);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'locationPicker.searchError'
        );
      });

      // The old results must not stay on screen under the error.
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('reports a timed-out search differently from a failed one', async () => {
      // `searchPlaces` maps an AbortError raised by its own 10s timer — the
      // caller's signal is untouched — to `kind: 'timeout'`.
      const abortError = new Error('The operation was aborted.');
      abortError.name = 'AbortError';
      fetchMock.mockRejectedValueOnce(abortError);

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      await user.type(screen.getByRole('combobox'), 'Paris');

      await act(async () => {
        vi.advanceTimersByTime(350);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(
          'locationPicker.timeoutError'
        );
      });
    });
  });

  // ============================================================================
  // Selection Tests
  // ============================================================================

  describe('Selection', () => {
    it('selects location on click and shows map preview', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const firstOption = screen.getAllByRole('option')[0];
      fireEvent.mouseDown(firstOption!);

      // Map preview should be shown, onChange not called yet
      expect(mockOnChange).not.toHaveBeenCalled();

      // Input should show the selected location name
      expect(input).toHaveValue('Paris, Île-de-France, France');
    });

    it('calls onChange after confirming selection', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      const firstOption = screen.getAllByRole('option')[0];
      fireEvent.mouseDown(firstOption!);

      // Click the confirm button
      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      await user.click(confirmButton);

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

      await act(() => { vi.advanceTimersByTime(350); });

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

      await act(() => { vi.advanceTimersByTime(350); });

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

      await act(() => { vi.advanceTimersByTime(350); });

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

      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Three places and the typed row, so five presses wrap back to the top.
      // The typed row is part of the cycle deliberately: a keyboard user has to
      // be able to reach it, and it is the only way to enter a place the
      // geocoder does not know.
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');

      const firstOption = screen.getAllByRole('option')[0];
      expect(firstOption).toHaveAttribute('aria-selected', 'true');
    });

    it('selects with Enter and shows map preview', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      await user.keyboard('{ArrowDown}{Enter}');

      // Map preview should be shown, onChange not called yet
      expect(mockOnChange).not.toHaveBeenCalled();

      // Input should show the selected location name
      expect(input).toHaveValue('Paris, Île-de-France, France');

      // Click the confirm button to finalize selection
      const confirmButton = await screen.findByRole('button', { name: /confirm/i });
      await user.click(confirmButton);

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

      await act(() => { vi.advanceTimersByTime(350); });

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

      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(input).toHaveAttribute('aria-expanded', 'true');
      });
    });

    it('updates aria-activedescendant on navigation', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} id="loc" />);

      const input = screen.getByRole('combobox');
      await user.type(input, 'Paris');

      await act(() => { vi.advanceTimersByTime(350); });

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

    it('never issues a search when unmounted before the debounce elapses', async () => {
      const { unmount } = render(
        <LocationPicker value="" onChange={mockOnChange} />
      );

      // One synchronous `change`, not five keystrokes. `shouldAdvanceTime` ties
      // the fake clock to real time, so `user.type` spends real milliseconds
      // between keys — enough, on a loaded machine, for the 300ms debounce to
      // fire before `unmount()` and redden this for a reason that has nothing
      // to do with the cleanup it tests.
      fireEvent.change(screen.getByRole('combobox'), {
        target: { value: 'Paris' },
      });

      // Unmount before debounce completes
      unmount();

      await act(() => { vi.advanceTimersByTime(350); });

      // The cleanup clears the debounce timer. Without it the timer still
      // fires and Nominatim is queried on behalf of a component nobody can
      // see — the request the user walked away from.
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('aborts an in-flight request on unmount', async () => {
      // Capture the signal handed to fetch and never settle, so the request is
      // genuinely in flight when the component goes away.
      let requestSignal: AbortSignal | undefined;
      fetchMock.mockImplementation((_url: unknown, init?: RequestInit) => {
        requestSignal = init?.signal ?? undefined;
        return new Promise(() => {});
      });

      const { unmount } = render(
        <LocationPicker value="" onChange={mockOnChange} />
      );

      // Synchronous, for the same reason as the test above.
      fireEvent.change(screen.getByRole('combobox'), {
        target: { value: 'Paris' },
      });
      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
      expect(requestSignal).toBeInstanceOf(AbortSignal);
      expect(requestSignal?.aborted).toBe(false);

      unmount();

      // Drop `abortControllerRef.current?.abort()` from the cleanup and this
      // stays false: the socket stays open and the response lands on a
      // component that no longer exists.
      expect(requestSignal?.aborted).toBe(true);
    });

    it('hides clear button when disabled', () => {
      render(<LocationPicker value="Paris" onChange={mockOnChange} disabled />);

      expect(screen.queryByLabelText('locationPicker.clear')).not.toBeInTheDocument();
    });
  });

  // ==========================================================================
  // Using the Typed Text
  // ==========================================================================

  describe('using what was typed', () => {
    it('reports the text with no coordinates', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      await user.type(screen.getByRole('combobox'), 'chez Mamie');
      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByText('locationPicker.useTyped')).toBeInTheDocument();
      });

      await user.click(screen.getByText('locationPicker.useTyped'));

      // Undefined, not omitted and not a guess. A location with no coordinates
      // is a first-class state everywhere downstream — it is what every
      // transport had before geocoding existed.
      expect(mockOnChange).toHaveBeenCalledWith('chez Mamie', undefined);
    });

    it('trims what it commits', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      await user.type(screen.getByRole('combobox'), '  chez Mamie  ');
      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByText('locationPicker.useTyped')).toBeInTheDocument();
      });
      await user.click(screen.getByText('locationPicker.useTyped'));

      // The value is stored and rendered as a place name, and a trailing space
      // is not part of one.
      expect(mockOnChange).toHaveBeenCalledWith('chez Mamie', undefined);
    });

    it('skips the map confirmation, because there is no pin to nudge', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      await user.type(screen.getByRole('combobox'), 'chez Mamie');
      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByText('locationPicker.useTyped')).toBeInTheDocument();
      });
      await user.click(screen.getByText('locationPicker.useTyped'));

      // Confirming a *search result* opens a map so the user can drag the pin
      // the geocoder placed. There is no pin here, and an empty map asking to
      // be confirmed would be a step that does nothing.
      expect(screen.queryByText('locationPicker.confirmLocation')).not.toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('is reachable below the last place with the keyboard', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      await user.type(screen.getByRole('combobox'), 'Paris');
      await act(() => { vi.advanceTimersByTime(350); });

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      // Past the three places is the typed row; Enter there takes the text.
      await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

      expect(mockOnChange).toHaveBeenCalledWith('Paris', undefined);
    });

    it('offers nothing when the field is only whitespace', async () => {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      render(<LocationPicker value="" onChange={mockOnChange} />);

      await user.type(screen.getByRole('combobox'), '   ');
      await act(() => { vi.advanceTimersByTime(350); });

      expect(screen.queryByText('locationPicker.useTyped')).not.toBeInTheDocument();
    });
  });
});