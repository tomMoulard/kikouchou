/**
 * @fileoverview LocationPicker against a faked geocoder and a faked map.
 *
 * The sibling file drives the real `searchPlaces` through a stubbed `fetch`.
 * This one replaces the geocoder at its module boundary instead, which is the
 * only way to hand the picker a failure `searchPlaces` itself never produces
 * (a plain `TypeError`) or a place with a secondary line, and replaces the
 * Leaflet map with a button that reports a dragged pin.
 *
 * @module components/shared/__tests__/LocationPicker.behaviour.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { act, fireEvent, render, screen, waitFor } from '@/test/utils';

import { GeocodingError, searchPlaces, type GeocodingPlace } from '@/lib/geocoding';

import { LocationPicker } from '../LocationPicker';

// ============================================================================
// Boundary fakes
// ============================================================================

vi.mock('@/lib/geocoding', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/geocoding')>();
  return { ...actual, searchPlaces: vi.fn() };
});

vi.mock('@/components/shared/LocationMapPicker', () => ({
  LocationMapPicker: ({
    coordinates,
    onCoordinatesChange,
  }: {
    readonly coordinates: { readonly lat: number; readonly lon: number };
    readonly onCoordinatesChange: (next: { lat: number; lon: number }) => void;
  }) => (
    <button
      type="button"
      data-testid="pin-map"
      data-lat={coordinates.lat}
      data-lon={coordinates.lon}
      onClick={() => onCoordinatesChange({ lat: 1.5, lon: 2.5 })}
    >
      map
    </button>
  ),
}));

/**
 * Translation keys as the suite's mock prints them, plus the `value` the
 * typed row interpolates, so that row's argument can be read off the screen.
 */
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options !== null && typeof options === 'object' && 'value' in options
        ? `${key}(${String((options as { value: unknown }).value)})`
        : key,
  }),
}));

const searchPlacesMock = vi.mocked(searchPlaces);

const PLACES: readonly GeocodingPlace[] = [
  {
    id: 'paris',
    label: 'Paris',
    detail: 'Île-de-France, France',
    typeLabel: 'City',
    coordinates: { lat: 48.85, lon: 2.35 },
  },
  {
    id: 'lyon',
    label: 'Lyon',
    detail: '',
    typeLabel: 'Town',
    coordinates: { lat: 45.76, lon: 4.83 },
  },
];

// ============================================================================
// Helpers
// ============================================================================

/** Moves the clock past the 300ms debounce and lets the search settle. */
async function pastDebounce(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(360);
  });
}

function combobox(): HTMLInputElement {
  return screen.getByRole('combobox') as HTMLInputElement;
}

/** Types `text` in one change and waits for the geocoded list. */
async function searchFor(text: string): Promise<void> {
  fireEvent.change(combobox(), { target: { value: text } });
  await pastDebounce();
  await screen.findByRole('listbox');
  await waitFor(() => {
    expect(screen.getAllByTestId('location-search-result').length).toBeGreaterThan(0);
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('LocationPicker with a faked geocoder', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    // Fake timers, ticking with real time so the queries can still poll: the
    // debounce and the blur delay are stepped over rather than slept through.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    onChange.mockReset();
    searchPlacesMock.mockReset();
    searchPlacesMock.mockResolvedValue(PLACES);
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('at rest', () => {
    it('starts closed, idle, valid and with nothing highlighted', () => {
      const { container } = render(
        <LocationPicker value="" onChange={onChange} className="extra" />,
        { withProviders: false },
      );

      const input = combobox();
      expect(input).toHaveAttribute('aria-invalid', 'false');
      expect(input).toHaveAttribute('aria-expanded', 'false');
      expect(input).not.toHaveAttribute('aria-activedescendant');
      expect(input).toHaveAttribute('id', 'location-picker');
      expect(input).toHaveAttribute('aria-controls', 'location-picker-listbox');
      expect(input).toHaveAttribute('aria-label', 'locationPicker.ariaLabel');
      expect(input).toHaveClass('pl-9');
      expect(input).not.toHaveClass('pr-16');
      expect(input).not.toHaveClass('pr-20');
      expect(container.querySelector('.animate-spin')).toBeNull();

      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveClass('relative', 'extra');
      expect(root.querySelector('svg')).toHaveClass(
        'absolute', 'left-3', 'top-1/2', 'size-4', 'text-muted-foreground', 'pointer-events-none',
      );
    });

    it('does not open an empty list on focus', () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.focus(combobox());

      expect(combobox()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('opens the typed row on focus when the field has text', () => {
      const { rerender } = render(<LocationPicker value="" onChange={onChange} />, {
        withProviders: false,
      });
      rerender(<LocationPicker value="Paris" onChange={onChange} />);

      fireEvent.focus(combobox());

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    });

    it('pads the input for its clear button', () => {
      render(<LocationPicker value="Paris" onChange={onChange} />, { withProviders: false });

      expect(combobox()).toHaveClass('pl-9', 'pr-16');
      const clear = screen.getByRole('button', { name: 'locationPicker.clear' });
      expect(clear).toHaveClass('absolute', 'right-1', 'top-1/2', 'h-9', 'w-9', 'p-0', 'md:h-7', 'md:w-7');
      expect(clear.querySelector('svg')).toHaveClass('size-4');
    });

    it('ignores the arrow keys while the list is shut', () => {
      render(<LocationPicker value="Paris" onChange={onChange} />, { withProviders: false });

      const notPrevented = fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      expect(notPrevented).toBe(true);
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    });
  });

  describe('searching', () => {
    it('asks the geocoder from three characters', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: 'abc' } });

      await waitFor(() => {
        expect(searchPlacesMock).toHaveBeenCalledWith('abc', expect.objectContaining({ signal: expect.any(AbortSignal) }));
      });
    });

    it('offers a two-letter place as typed, without asking the geocoder', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: 'Pa' } });
      await pastDebounce();

      expect(searchPlacesMock).not.toHaveBeenCalled();
      expect(combobox()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(screen.getByText('locationPicker.useTyped(Pa)')).toBeInTheDocument();
    });

    it('keeps the list shut for a short run of spaces', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: ' ' } });
      await pastDebounce();
      expect(combobox()).toHaveAttribute('aria-expanded', 'false');

      fireEvent.change(combobox(), { target: { value: '  ' } });
      await pastDebounce();
      expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    });

    it('drops the old places and the highlight when the query gets short', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
      expect(combobox()).toHaveAttribute('aria-activedescendant', 'location-picker-option-0');

      fireEvent.change(combobox(), { target: { value: 'Pa' } });
      await pastDebounce();

      expect(screen.getAllByRole('option')).toHaveLength(1);
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    });

    it('drops the highlight when new places arrive', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      fireEvent.change(combobox(), { target: { value: 'Paris 2' } });
      await waitFor(() => {
        expect(searchPlacesMock).toHaveBeenCalledTimes(2);
      });
      await waitFor(() => {
        expect(combobox()).not.toHaveAttribute('aria-activedescendant');
      });
    });

    it('shows a spinner and pads the input while the geocoder answers', async () => {
      let answer: (places: readonly GeocodingPlace[]) => void = () => undefined;
      searchPlacesMock.mockImplementationOnce(
        () => new Promise((resolve) => {
          answer = resolve;
        }),
      );
      const { container } = render(<LocationPicker value="" onChange={onChange} />, {
        withProviders: false,
      });

      fireEvent.change(combobox(), { target: { value: 'Paris' } });
      await waitFor(() => {
        expect(container.querySelector('.animate-spin')).not.toBeNull();
      });
      expect(container.querySelector('.animate-spin')).toHaveClass(
        'absolute', 'right-10', 'top-1/2', 'size-4', 'text-muted-foreground',
      );
      expect(combobox()).toHaveClass('pr-20');

      await act(async () => {
        answer(PLACES);
      });
      expect(container.querySelector('.animate-spin')).toBeNull();
      expect(combobox()).not.toHaveClass('pr-20');
    });

    it('says nothing about a search a newer one superseded', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      searchPlacesMock.mockRejectedValueOnce(new GeocodingError('aborted'));
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: 'Paris' } });
      await waitFor(() => {
        expect(searchPlacesMock).toHaveBeenCalledTimes(1);
      });
      await pastDebounce();

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('logs a failure that did not come from the geocoder', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const failure = new TypeError('boom');
      searchPlacesMock.mockRejectedValueOnce(failure);
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: 'Paris' } });

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('locationPicker.searchError');
      expect(alert).toHaveClass('mt-1', 'text-sm', 'text-destructive');
      expect(consoleError).toHaveBeenCalledWith('Location search error:', failure);
    });

    it('does not log a failure the geocoder already named', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      searchPlacesMock.mockRejectedValueOnce(new GeocodingError('network'));
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: 'Paris' } });

      await screen.findByRole('alert');
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('forgets the places and stops spinning when a search fails, and clears the error on the next', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container } = render(<LocationPicker value="" onChange={onChange} />, {
        withProviders: false,
      });
      await searchFor('Paris');

      searchPlacesMock.mockRejectedValueOnce(new GeocodingError('network'));
      fireEvent.change(combobox(), { target: { value: 'Parisx' } });
      await screen.findByRole('alert');
      expect(container.querySelector('.animate-spin')).toBeNull();

      // Focus reopens the list on what is left: the typed row only.
      fireEvent.focus(combobox());
      expect(screen.getAllByRole('option')).toHaveLength(1);

      fireEvent.change(combobox(), { target: { value: 'Lyon' } });
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
    });

    it('says no place was found for a query of spaces', async () => {
      searchPlacesMock.mockResolvedValue([]);
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: '   ' } });

      const status = await screen.findByRole('status');
      expect(status).toHaveTextContent('locationPicker.noResults');
      expect(status).toHaveClass(
        'absolute', 'z-50', 'mt-1', 'w-full', 'rounded-md', 'border', 'bg-popover', 'p-3', 'text-sm',
        'text-muted-foreground', 'shadow-md',
      );
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

      // Under three characters the message goes at once, before any search.
      fireEvent.change(combobox(), { target: { value: '  ' } });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('says nothing about results while the geocoder is still answering', async () => {
      searchPlacesMock.mockResolvedValueOnce([]);
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      fireEvent.change(combobox(), { target: { value: '   ' } });
      await screen.findByRole('status');

      searchPlacesMock.mockImplementationOnce(() => new Promise(() => undefined));
      fireEvent.change(combobox(), { target: { value: '    ' } });
      await waitFor(() => {
        expect(searchPlacesMock).toHaveBeenCalledTimes(2);
      });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('lists the places for a query of spaces without a typed row', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: '   ' } });

      await screen.findByRole('listbox');
      expect(screen.getAllByRole('option')).toHaveLength(2);
      expect(screen.queryByTestId('location-use-typed')).not.toBeInTheDocument();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  describe('the list', () => {
    it('labels the list and each row, and marks nothing as chosen yet', async () => {
      render(<LocationPicker value="" onChange={onChange} id="loc" />, { withProviders: false });
      await searchFor('Paris');

      const list = screen.getByRole('listbox');
      expect(list).toHaveAttribute('id', 'loc-listbox');
      expect(list).toHaveAttribute('aria-label', 'locationPicker.resultsLabel');
      expect(list).toHaveClass(
        'absolute', 'z-50', 'mt-1', 'w-full', 'overflow-hidden', 'rounded-md', 'border', 'bg-popover', 'shadow-md',
      );

      const [paris, lyon, typed] = screen.getAllByRole('option') as HTMLElement[];
      expect(paris).toHaveAttribute('id', 'loc-option-0');
      expect(lyon).toHaveAttribute('id', 'loc-option-1');
      expect(typed).toHaveAttribute('id', 'loc-option-2');
      for (const option of [paris, lyon, typed]) {
        expect(option).toHaveAttribute('aria-selected', 'false');
        expect(option).toHaveClass('cursor-pointer', 'px-3', 'py-2', 'text-sm', 'hover:bg-accent/50');
        expect(option).not.toHaveClass('bg-accent');
      }
      expect(typed).toHaveClass('border-t');
    });

    it('prints the place, its kind, and its secondary line only when it has one', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');

      const [paris, lyon] = screen.getAllByTestId('location-search-result') as HTMLElement[];
      const label = screen.getByText('Paris');
      expect(label).toHaveClass('truncate', 'font-medium');
      expect(label.parentElement).toHaveClass('flex', 'items-center', 'justify-between', 'gap-2');
      expect(screen.getByText('City')).toHaveClass('shrink-0', 'text-xs', 'text-muted-foreground');
      const detail = screen.getByText('Île-de-France, France');
      expect(detail.tagName).toBe('P');
      expect(detail).toHaveClass('mt-0.5', 'truncate', 'text-xs', 'text-muted-foreground');
      expect(paris).toContainElement(detail);
      expect(lyon?.querySelector('p')).toBeNull();
    });

    it('prints the typed row with its value, its hint and its icon', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');

      const typed = screen.getByTestId('location-use-typed');
      const text = screen.getByText('locationPicker.useTyped(Paris)');
      expect(text).toHaveClass('truncate', 'font-medium');
      expect(text.parentElement).toHaveClass('flex', 'items-center', 'gap-2');
      expect(typed.querySelector('svg')).toHaveClass('size-4', 'shrink-0');
      expect(screen.getByText('locationPicker.useTypedHint')).toHaveClass('mt-0.5', 'text-xs', 'text-muted-foreground');
    });

    it('highlights the row under the pointer', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      const [, lyon, typed] = screen.getAllByRole('option') as HTMLElement[];

      fireEvent.mouseEnter(lyon as HTMLElement);
      expect(lyon).toHaveAttribute('aria-selected', 'true');
      expect(lyon).toHaveClass('bg-accent', 'text-accent-foreground');
      expect(lyon).not.toHaveClass('hover:bg-accent/50');

      fireEvent.mouseEnter(typed as HTMLElement);
      expect(typed).toHaveAttribute('aria-selected', 'true');
      expect(typed).toHaveClass('bg-accent', 'text-accent-foreground');
      expect(typed).not.toHaveClass('hover:bg-accent/50');
      expect(lyon).toHaveAttribute('aria-selected', 'false');
    });

    it('scrolls the highlighted row into view', async () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      const [paris, lyon] = screen.getAllByRole('option');
      expect(scrollIntoView).not.toHaveBeenCalled();

      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(paris);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });

      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
      expect(scrollIntoView.mock.contexts[1]).toBe(lyon);
    });
  });

  describe('the keyboard', () => {
    it('keeps every key it handles from reaching the input', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');

      expect(fireEvent.keyDown(combobox(), { key: 'ArrowDown' })).toBe(false);
      expect(fireEvent.keyDown(combobox(), { key: 'ArrowUp' })).toBe(false);
      expect(fireEvent.keyDown(combobox(), { key: 'Escape' })).toBe(false);

      fireEvent.focus(combobox());
      expect(fireEvent.keyDown(combobox(), { key: 'Enter' })).toBe(false);
    });

    it('goes up from nothing to the last row, and from the first row back to the last', async () => {
      render(<LocationPicker value="" onChange={onChange} id="loc" />, { withProviders: false });
      await searchFor('Paris');

      fireEvent.keyDown(combobox(), { key: 'ArrowUp' });
      expect(combobox()).toHaveAttribute('aria-activedescendant', 'loc-option-2');

      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
      expect(combobox()).toHaveAttribute('aria-activedescendant', 'loc-option-0');
      fireEvent.keyDown(combobox(), { key: 'ArrowUp' });
      expect(combobox()).toHaveAttribute('aria-activedescendant', 'loc-option-2');
      fireEvent.keyDown(combobox(), { key: 'ArrowUp' });
      expect(combobox()).toHaveAttribute('aria-activedescendant', 'loc-option-1');
    });

    it('drops the highlight on Escape', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      fireEvent.keyDown(combobox(), { key: 'Escape' });

      expect(combobox()).toHaveAttribute('aria-expanded', 'false');
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    });

    it('takes nothing on Enter with no row highlighted', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');

      fireEvent.keyDown(combobox(), { key: 'Enter' });

      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
  });

  describe('closing on blur', () => {
    it('waits a moment for a click, then closes and drops the highlight', async () => {
      render(<LocationPicker value="Paris" onChange={onChange} />, { withProviders: false });
      fireEvent.focus(combobox());
      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      fireEvent.blur(combobox());
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(250);
      });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    });
  });

  describe('picking a place', () => {
    it('saves it, shows its pin, and leaves nothing highlighted or listed', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      fireEvent.mouseDown(screen.getByText('Paris'));

      expect(onChange).toHaveBeenCalledWith('Paris', { lat: 48.85, lon: 2.35 });
      expect(combobox()).toHaveValue('Paris');
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
      const map = screen.getByTestId('pin-map');
      expect(map).toHaveAttribute('data-lat', '48.85');
      expect(map).toHaveAttribute('data-lon', '2.35');

      fireEvent.focus(combobox());
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });

    it('saves a nudged pin under the picked name', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.mouseDown(screen.getByText('Lyon'));
      onChange.mockClear();

      fireEvent.click(screen.getByTestId('pin-map'));

      expect(onChange).toHaveBeenCalledWith('Lyon', { lat: 1.5, lon: 2.5 });
      expect(screen.getByTestId('pin-map')).toHaveAttribute('data-lat', '1.5');
      expect(screen.getByTestId('pin-map')).toHaveAttribute('data-lon', '2.5');
    });

    it('reports to the newest onChange', async () => {
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = render(<LocationPicker value="" onChange={first} />, {
        withProviders: false,
      });
      await searchFor('Paris');
      rerender(<LocationPicker value="Paris" onChange={second} />);
      fireEvent.change(combobox(), { target: { value: 'Paris' } });
      await screen.findByText('Lyon');

      fireEvent.mouseDown(screen.getByText('Lyon'));
      fireEvent.click(screen.getByTestId('pin-map'));
      fireEvent.focus(combobox());
      fireEvent.mouseDown(screen.getByTestId('location-use-typed'));
      fireEvent.click(screen.getByRole('button', { name: 'locationPicker.clear' }));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith('Lyon', { lat: 45.76, lon: 4.83 });
      expect(second).toHaveBeenCalledWith('Lyon', { lat: 1.5, lon: 2.5 });
      expect(second).toHaveBeenCalledWith('Lyon', undefined);
      expect(second).toHaveBeenCalledWith('', undefined);
    });
  });

  describe('taking the text as written', () => {
    it('shows the trimmed text, and leaves nothing highlighted or listed', async () => {
      searchPlacesMock.mockResolvedValue([]);
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      fireEvent.change(combobox(), { target: { value: '  chez Mamie  ' } });
      await screen.findByTestId('location-use-typed');
      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      fireEvent.mouseDown(screen.getByTestId('location-use-typed'));

      expect(onChange).toHaveBeenCalledWith('chez Mamie', undefined);
      expect(combobox()).toHaveValue('chez Mamie');
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
      expect(screen.queryByTestId('pin-map')).not.toBeInTheDocument();

      fireEvent.focus(combobox());
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
  });

  describe('clearing', () => {
    it('empties the field, closes the places, removes the pin and keeps the focus', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.mouseDown(screen.getByText('Paris'));
      expect(screen.getByTestId('pin-map')).toBeInTheDocument();

      await searchFor('Lyon');
      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
      fireEvent.click(screen.getByRole('button', { name: 'locationPicker.clear' }));

      expect(onChange).toHaveBeenLastCalledWith('', undefined);
      expect(combobox()).toHaveValue('');
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(screen.queryByTestId('pin-map')).not.toBeInTheDocument();
      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
      expect(document.activeElement).toBe(combobox());
    });

    it('does not announce a list it is not showing', async () => {
      // Clearing hands the focus back to the input, and the focus handler,
      // still holding the options of the text just cleared, reopened the
      // list. Nothing renders for an empty field, so the combobox told a
      // screen reader it was expanded over a listbox that did not exist.
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');

      fireEvent.click(screen.getByRole('button', { name: 'locationPicker.clear' }));

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    });

    it('leaves the dropdown shut for a short run of spaces, so a longer one is not answered early', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.change(combobox(), { target: { value: ' ' } });
      await pastDebounce();
      fireEvent.change(combobox(), { target: { value: '   ' } });

      // Before its own search has run, nothing may say nothing was found.
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('leaves the dropdown shut when an empty field takes the focus', () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });

      fireEvent.focus(combobox());
      fireEvent.change(combobox(), { target: { value: '   ' } });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('leaves the dropdown shut after clearing', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.click(screen.getByRole('button', { name: 'locationPicker.clear' }));

      // Typed before any search has run: an open dropdown would already say
      // that nothing was found.
      fireEvent.change(combobox(), { target: { value: '   ' } });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('forgets the places it cleared, so the field opens nothing when it takes the focus again', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.click(screen.getByRole('button', { name: 'locationPicker.clear' }));

      fireEvent.blur(combobox());
      await pastDebounce();
      fireEvent.focus(combobox());

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(combobox()).toHaveAttribute('aria-expanded', 'false');
    });

    it('moves no highlight while the dropdown only says nothing was found', async () => {
      // A query of spaces reaches the geocoder and opens the dropdown for its
      // "no locations found" line, which offers nothing to arrow to.
      searchPlacesMock.mockResolvedValueOnce([]);
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      fireEvent.change(combobox(), { target: { value: '    ' } });
      await pastDebounce();
      await screen.findByRole('status');

      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    });

    it('commits nothing when Enter lands on a typed row the text no longer has', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      // Two places, then the typed row at index 2.
      for (let press = 0; press < 3; press += 1) {
        fireEvent.keyDown(combobox(), { key: 'ArrowDown' });
      }
      expect(combobox()).toHaveAttribute('aria-activedescendant', 'location-picker-option-2');
      fireEvent.change(combobox(), { target: { value: '   ' } });
      onChange.mockClear();

      fireEvent.keyDown(combobox(), { key: 'Enter' });

      expect(onChange).not.toHaveBeenCalled();
      expect(combobox()).toHaveValue('   ');
    });

    it('does not move a highlight through a list it is not showing', async () => {
      render(<LocationPicker value="" onChange={onChange} />, { withProviders: false });
      await searchFor('Paris');
      fireEvent.click(screen.getByRole('button', { name: 'locationPicker.clear' }));

      fireEvent.keyDown(combobox(), { key: 'ArrowDown' });

      expect(combobox()).not.toHaveAttribute('aria-activedescendant');
    });
  });
});
